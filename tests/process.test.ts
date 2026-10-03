import { it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import {
	mkdtempSync,
	chmodSync,
	rmSync,
	statSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { createBridge } from "../src/extension/bridge.js";
import { context } from "./fixture.js";
import { discover } from "../src/gateway/peer.js";
import { createGateway } from "../src/gateway/server.js";
import { limits } from "../src/shared/protocol.js";
function start(runtime: string, publicOrigin?: string) {
	return spawn(process.execPath, ["dist/gateway/cli.js"], {
		env: {
			PATH: process.env.PATH,
			C2_RUNTIME: runtime,
			C2_AUTH_DIR: join(runtime, "auth"),
			C2_PORT: "4392",
			...(publicOrigin === undefined ? {} : { C2_PUBLIC_ORIGIN: publicOrigin }),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
}
function ready(child: ChildProcess) {
	return new Promise<string>((resolve, reject) => {
		let text = "";
		child.stdout!.on("data", (data) => {
			text += data;
			if (text.includes("Pairing code"))
				resolve(text.match(/browser\): (\S+)/)![1]);
		});
		child.once("exit", () => reject(new Error("Gateway exited before ready")));
	});
}
function exit(child: ChildProcess) {
	return new Promise<number | null>((resolve) =>
		child.exitCode !== null
			? resolve(child.exitCode)
			: child.once("exit", resolve),
	);
}
it("parallel launch exclusion, retained inode and crash kernel release; real SSE admission/replay/disconnect ownership", async () => {
	const path = mkdtempSync(join("/tmp", "c2-p-"));
	chmodSync(path, 0o700);
	const bridge = createBridge(path);
	const nativeContext = context();
	await bridge.start(nativeContext);
	let child: ChildProcess | undefined;
	const connections: import("node:http").ClientRequest[] = [];
	try {
		child = start(path);
		const code = await ready(child);
		const inode = statSync(join(path, "gateway.lock")).ino;
		const second = start(path);
		expect(await exit(second)).toBe(1);
		const url = "http://127.0.0.1:4392";
		const pair = await fetch(url + "/api/pair", {
			method: "POST",
			headers: {
				origin: url,
				"x-c2-csrf": "pair",
				"content-type": "application/json",
			},
			body: JSON.stringify({ code, remember: false }),
		});
		expect(pair.status).toBe(200);
		const cookie = pair.headers.get("set-cookie")!.split(";")[0];
		const open = (last?: string) =>
			new Promise<{ status: number; id?: string }>((resolve) => {
				const req = request(
					url + "/api/events",
					{ headers: { cookie, ...(last ? { "last-event-id": last } : {}) } },
					(res) => {
						let text = "";
						if (res.statusCode !== 200) {
							res.resume();
							resolve({ status: res.statusCode! });
							return;
						}
						res.on("data", (data) => {
							text += data;
							if (text.includes(": connected"))
								resolve({ status: 200, id: /id: (\S+)/.exec(text)?.[1] });
						});
					},
				);
				connections.push(req);
				req.end();
			});
		const first = await open();
		expect(first.id).toMatch(/^[a-f0-9]+-\d+$/);
		for (let i = 0; i < 3; i++) expect((await open()).status).toBe(200);
		expect((await open()).status).toBe(429);
		for (const req of connections) req.destroy();
		connections.length = 0;
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect((await open("unknown-old-id")).id).toBe(first.id);
		child.kill("SIGKILL");
		await exit(child);
		for (const req of connections) req.destroy();
		connections.length = 0;
		child = start(path);
		await ready(child);
		expect(statSync(join(path, "gateway.lock")).ino).toBe(inode);
		expect(nativeContext.isIdle()).toBe(true);
		expect((await discover(path)).peers).toHaveLength(1);
		child.kill("SIGTERM");
		expect(await exit(child)).toBe(0);
		expect((await bridge.start(context())).generation).toHaveLength(32);
	} finally {
		for (const req of connections) req.destroy();
		if (child && child.exitCode === null && child.signalCode === null) {
			child.kill("SIGKILL");
			await exit(child);
		}
		await bridge.close();
		rmSync(path, { recursive: true, force: true });
	}
}, 20000);

it("C5 production CLI selects the private HTTPS URL over loopback TCP, rejects invalid env and releases flock on exit", async () => {
	const path = mkdtempSync("/tmp/c5-cli-");
	chmodSync(path, 0o700);
	const publicOrigin = "https://companion.example.ts.net",
		host = "companion.example.ts.net";
	const children: ChildProcess[] = [],
		connections: import("node:http").ClientRequest[] = [];
	const launch = (origin?: string) => {
		const child = start(path, origin);
		children.push(child);
		const output = { stdout: "", stderr: "" };
		child.stdout!.on("data", (data) => {
			output.stdout += data;
		});
		child.stderr!.on("data", (data) => {
			output.stderr += data;
		});
		return { child, output };
	};
	const tcp = (
		url: string,
		headers: Record<string, string>,
		payload?: object,
	) =>
		new Promise<{
			status: number;
			headers: import("node:http").IncomingHttpHeaders;
			body: string;
			address?: string;
		}>((resolve, reject) => {
			const req = request(
				{
					host: "127.0.0.1",
					port: 4392,
					path: url,
					method: payload ? "POST" : "GET",
					headers: {
						...headers,
						...(payload ? { "content-type": "application/json" } : {}),
					},
				},
				(res) => {
					const address = res.socket.remoteAddress;
					let body = "";
					res.setEncoding("utf8");
					res.on("data", (chunk) => {
						body += chunk;
					});
					res.on("end", () =>
						resolve({
							status: res.statusCode!,
							headers: res.headers,
							body,
							address,
						}),
					);
				},
			);
			connections.push(req);
			req.on("error", reject);
			req.end(payload ? JSON.stringify(payload) : undefined);
		});
	try {
		for (const invalid of [
			"",
			publicOrigin + "/",
			publicOrigin + ":443",
			"http://companion.example.ts.net",
		]) {
			const { child, output } = launch(invalid);
			const result = await Promise.race([
				exit(child),
				ready(child).then(
					() => "unexpected-ready",
					() => exit(child),
				),
			]);
			if (result === "unexpected-ready") {
				child.kill("SIGTERM");
				await exit(child);
			}
			expect(result).toBe(1);
			expect(output.stdout).toBe("");
			expect(output.stderr).toBe(
				"Gateway blocked: unsafe runtime, occupied port, or unavailable local build.\n",
			);
		}
		const { child, output } = launch(publicOrigin),
			code = await ready(child);
		expect(output.stdout).toBe(
			`Pi observer: ${publicOrigin}\nPairing code (submit in browser): ${code}\nExpires: ${output.stdout.split("Expires: ")[1]}`,
		);
		expect(output.stderr).toBe("");
		const inode = statSync(join(path, "gateway.lock")).ino;
		const pair = await tcp(
			"/api/pair",
			{
				host,
				origin: publicOrigin,
				"x-c2-csrf": "pair",
				"x-forwarded-host": host,
				"x-forwarded-proto": "https",
			},
			{ code, remember: false },
		);
		expect(pair.address).toBe("127.0.0.1");
		expect(pair.status).toBe(200);
		expect(JSON.parse(pair.body)).toEqual({ paired: true });
		expect(pair.headers["set-cookie"]![0]).toContain("Secure");
		expect(pair.headers["strict-transport-security"]).toBe("max-age=31536000");
		const cookie = pair.headers["set-cookie"]![0].split(";")[0];
		expect((await tcp("/api/snapshot", { host, cookie })).status).toBe(200);
		expect((await tcp("/api/snapshot", { host })).status).toBe(401);
		expect(
			(
				await tcp("/api/snapshot", {
					host: "127.0.0.1:4392",
					cookie,
					"x-forwarded-host": host,
					"x-forwarded-proto": "https",
					"tailscale-user-login": "owner@example.invalid",
				})
			).status,
		).toBe(403);
		expect(
			(
				await tcp(
					"/api/pair",
					{ host, "x-c2-csrf": "pair" },
					{ code, remember: false },
				)
			).status,
		).toBe(403);
		const sse = request({
			host: "127.0.0.1",
			port: 4392,
			path: "/api/events",
			headers: {
				host,
				cookie,
				"x-forwarded-host": "evil.invalid",
				"x-forwarded-proto": "http",
			},
		});
		connections.push(sse);
		const stream = await new Promise<import("node:http").IncomingMessage>(
			(resolve, reject) => {
				sse.once("response", resolve);
				sse.on("error", reject);
				sse.end();
			},
		);
		expect(stream.statusCode).toBe(200);
		expect(stream.headers["strict-transport-security"]).toBe(
			"max-age=31536000",
		);
		await new Promise<void>((resolve) => {
			let body = "";
			stream.on("data", (chunk) => {
				body += chunk;
				if (body.includes(": connected")) resolve();
			});
		});
		sse.destroy();
		const second = launch(publicOrigin);
		expect(await exit(second.child)).toBe(1);
		expect(second.output.stderr).toBe(
			"Gateway blocked: another gateway owns this runtime directory.\n",
		);
		child.kill("SIGTERM");
		expect(await exit(child)).toBe(0);
		const local = launch(),
			localCode = await ready(local.child);
		expect(local.output.stdout).toBe(
			`Pi observer: http://127.0.0.1:4392\nPairing code (submit in browser): ${localCode}\nExpires: ${local.output.stdout.split("Expires: ")[1]}`,
		);
		expect(statSync(join(path, "gateway.lock")).ino).toBe(inode);
		expect((await tcp("/", { host })).status).toBe(403);
		local.child.kill("SIGTERM");
		expect(await exit(local.child)).toBe(0);
	} finally {
		for (const req of connections) req.destroy();
		for (const child of children)
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
				await exit(child);
			}
		rmSync(path, { recursive: true, force: true });
	}
}, 20000);

// Real HTTP/EventSource-equivalent framing: keep only bounded complete events plus
// the unfinished frame, and do not confuse a TCP chunk with an SSE message.
async function selectedUrl(url: string, cookie: string) {
	const view = await (
		await fetch(url + "/api/snapshot", { headers: { cookie } })
	).json();
	const peer = view.sessions[0];
	return peer ? `?instance=${peer.instance}&generation=${peer.generation}` : "";
}
async function openSse(
	url: string,
	cookie: string,
	last?: string,
	paused = false,
	selected?: { instance: string; generation: string },
) {
	const events: {
		id: string;
		data: import("../src/shared/protocol.js").View;
	}[] = [];
	const errors: string[] = [];
	const query = selected
		? `?instance=${selected.instance}&generation=${selected.generation}`
		: await selectedUrl(url, cookie);
	const req = request(url + "/api/events" + query, {
		headers: { cookie, ...(last ? { "last-event-id": last } : {}) },
	});
	const res = await new Promise<import("node:http").IncomingMessage>(
		(resolve, reject) => {
			req.once("response", resolve);
			req.on("error", (error) => {
				errors.push(error.name);
				reject(error);
			});
			req.end();
		},
	);
	res.on("error", (error) => errors.push(error.name));
	if (paused) res.pause();
	else {
		let pending = "";
		res.setEncoding("utf8");
		res.on("data", (chunk: string) => {
			pending += chunk;
			let end: number;
			while ((end = pending.indexOf("\n\n")) >= 0) {
				const frame = pending.slice(0, end);
				pending = pending.slice(end + 2);
				const id = /^id: (.+)$/m.exec(frame)?.[1],
					data = /^data: (.+)$/m.exec(frame)?.[1];
				if (id && data) {
					events.push({ id, data: JSON.parse(data) });
					if (events.length > limits.replay + 1) events.shift();
				}
			}
			if (Buffer.byteLength(pending) > limits.snapshotBytes + 1024) {
				errors.push("Oversized SSE frame");
				req.destroy();
			}
		});
	}
	return { req, res, events, errors };
}
function largeTextContext(escaped = false) {
	const ctx = context();
	let marker = "a";
	ctx.sessionManager.getBranch = () => [
		{
			type: "message",
			id: "large-native-user",
			parentId: null,
			timestamp: new Date(0).toISOString(),
			message: {
				role: "user",
				timestamp: 0,
				content: Array.from({ length: 8 }, (_, index) => ({
					type: "text",
					text:
						(index === 0 ? marker : "x") +
						(escaped ? "\u0000" : "x").repeat(limits.text / 8 - 1),
				})),
			},
		},
	];
	return {
		ctx,
		setMarker: (next: string) => {
			marker = next;
		},
	};
}
async function pairTcp(
	url: string,
	app: Awaited<ReturnType<typeof createGateway>>,
) {
	const pair = await fetch(url + "/api/pair", {
		method: "POST",
		headers: {
			origin: url,
			"x-c2-csrf": "pair",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			code: app.pairing.issueCode().code,
			remember: false,
		}),
	});
	expect(pair.status).toBe(200);
	return pair.headers.get("set-cookie")!.split(";")[0];
}
function markerOf(view: import("../src/shared/protocol.js").View) {
	const block = view.snapshot?.items[0]?.blocks[0];
	return block?.type === "text" ? block.text[0] : undefined;
}
it("delivers complete large SSE initial state, publications, ordered replay latest state and native regeneration over real TCP", async () => {
	const path = mkdtempSync("/tmp/c2-sse-");
	chmodSync(path, 0o700);
	const bridge = createBridge(path),
		fixture = largeTextContext();
	await bridge.start(fixture.ctx);
	const app = await createGateway({
		runtime: path,
		port: 4395,
		stateDirectory: join(path, "auth"),
		assets: join(process.cwd(), "dist/web"),
		pollMs: 20,
	});
	const readers: Awaited<ReturnType<typeof openSse>>[] = [];
	try {
		await app.listen({ host: "127.0.0.1", port: 4395 });
		const url = "http://127.0.0.1:4395",
			cookie = await pairTcp(url, app);
		const first = await openSse(url, cookie);
		readers.push(first);
		expect(first.res.statusCode).toBe(200);
		await expect.poll(() => first.events.length, { timeout: 5000 }).toBe(1);
		const initial = first.events[0];
		expect(JSON.stringify(initial.data).length).toBeGreaterThan(limits.text);
		expect(initial.data.snapshot?.items[0].blocks).toHaveLength(8);
		for (const block of initial.data.snapshot!.items[0].blocks)
			expect(block.type === "text" && block.text.length).toBe(limits.text / 8);
		const generation = initial.data.snapshot!.generation;
		for (const marker of ["b", "c", "d"]) {
			fixture.setMarker(marker);
			await expect
				.poll(() => markerOf(first.events.at(-1)!.data), { timeout: 5000 })
				.toBe(marker);
		}
		const replayed = await openSse(url, cookie, initial.id);
		readers.push(replayed);
		await expect.poll(() => replayed.events.length, { timeout: 5000 }).toBe(3);
		expect(replayed.events.map((event) => markerOf(event.data))).toEqual([
			"b",
			"c",
			"d",
		]);
		expect(replayed.events.map((event) => event.id)).toEqual(
			first.events.slice(1).map((event) => event.id),
		);
		await bridge.start(fixture.ctx);
		await expect
			.poll(() => first.events.at(-1)?.data.connection, { timeout: 5000 })
			.toBe("disconnected");
		await expect
			.poll(() => replayed.events.at(-1)?.data.connection, { timeout: 5000 })
			.toBe("disconnected");
		expect(first.events.at(-1)?.data.snapshot).toBeUndefined();
		const fallback = await openSse(url, cookie, "expired-id");
		readers.push(fallback);
		await expect.poll(() => fallback.events.length, { timeout: 5000 }).toBe(1);
		expect(fallback.events[0].data.snapshot?.instance).toBe(
			initial.data.snapshot!.instance,
		);
		expect(fallback.events[0].data.snapshot?.generation).not.toBe(generation);
		expect(markerOf(fallback.events[0].data)).toBe("d");
		for (const reader of readers) expect(reader.errors).toEqual([]);
		for (const reader of readers) reader.req.destroy();
		await app.close();
		expect((await discover(path)).peers).toHaveLength(1);
	} finally {
		for (const reader of readers) reader.req.destroy();
		await app.close();
		await bridge.close();
		rmSync(path, { recursive: true, force: true });
	}
}, 30000);

it("bounds paused TCP readers by queued bytes and drain deadline, releases admission and preserves the owner", async () => {
	const path = mkdtempSync("/tmp/c2-slow-");
	chmodSync(path, 0o700);
	const bridge = createBridge(path),
		fixture = largeTextContext(true);
	await bridge.start(fixture.ctx);
	const app = await createGateway({
		runtime: path,
		port: 4396,
		stateDirectory: join(path, "auth"),
		assets: join(process.cwd(), "dist/web"),
		pollMs: 20,
	});
	const responses: import("node:http").ServerResponse[] = [];
	app.server.on("request", (req, res) => {
		if (req.url?.startsWith("/api/events")) responses.push(res);
	});
	const readers: Awaited<ReturnType<typeof openSse>>[] = [];
	try {
		await app.listen({ host: "127.0.0.1", port: 4396 });
		const url = "http://127.0.0.1:4396",
			cookie = await pairTcp(url, app);
		const slow = await openSse(url, cookie, undefined, true);
		readers.push(slow);
		const response = responses.at(-1)!;
		// Publish enough bounded ~768k frames to exceed socket/kernel buffering plus the
		// per-reader byte allowance, without allowing publication to reset a drain deadline.
		let marker = 65;
		for (let update = 0; update < 40 && !response.destroyed; update++) {
			const next = String.fromCharCode(marker++);
			fixture.setMarker(next);
			await expect
				.poll(
					async () =>
						markerOf(
							await (
								await fetch(
									url + "/api/snapshot" + (await selectedUrl(url, cookie)),
									{ headers: { cookie } },
								)
							).json(),
						),
					{ timeout: 5000 },
				)
				.toBe(next);
			expect(response.writableLength).toBeLessThanOrEqual(
				limits.sseBufferedBytes,
			);
		}
		expect(response.destroyed).toBe(true);
		slow.req.destroy();
		// A returning reader must receive the latest complete state, not an old queued frame.
		const fast = await openSse(url, cookie);
		readers.push(fast);
		await expect.poll(() => fast.events.length, { timeout: 5000 }).toBe(1);
		expect(markerOf(fast.events[0].data)).toBe(String.fromCharCode(marker - 1));
		const last = fast.events[0].id;
		for (let update = 0; update < 7; update++) {
			const next = String.fromCharCode(marker++);
			fixture.setMarker(next);
			await expect
				.poll(() => markerOf(fast.events.at(-1)!.data), { timeout: 5000 })
				.toBe(next);
		}
		fast.req.destroy();
		const stalled = await openSse(url, cookie, last, true);
		readers.push(stalled);
		const stalledResponse = responses.at(-1)!;
		// Initial multi-frame replay fills a genuinely paused TCP connection. Wait for
		// sustained backpressure, not the transient false of a healthy large write.
		await expect
			.poll(
				async () => {
					await new Promise((resolve) => setTimeout(resolve, 250));
					return stalledResponse.writableNeedDrain;
				},
				{ timeout: 5000 },
			)
			.toBe(true);
		const blockedAt = Date.now();
		await expect
			.poll(() => stalledResponse.destroyed, {
				timeout: limits.sseDrainMs + 5000,
				interval: 250,
			})
			.toBe(true);
		expect(Date.now() - blockedAt).toBeGreaterThan(limits.sseDrainMs - 2000);
		stalled.req.destroy();
		const admitted = [];
		for (let i = 0; i < limits.streams; i++) {
			const reader = await openSse(url, cookie);
			readers.push(reader);
			admitted.push(reader);
			expect(reader.res.statusCode).toBe(200);
		}
		const denied = await openSse(url, cookie);
		readers.push(denied);
		expect(denied.res.statusCode).toBe(429);
		for (const reader of admitted) reader.req.destroy();
		await app.close();
		expect((await discover(path)).peers).toHaveLength(1);
	} finally {
		for (const reader of readers) reader.req.destroy();
		await app.close();
		await bridge.close();
		rmSync(path, { recursive: true, force: true });
	}
}, 45000);

it("C3 same-cookie readers keep independent selection/replay, unknown cross-scope IDs fall back, disappeared owner is not replaced", async () => {
	const path = mkdtempSync("/tmp/c3-tabs-");
	chmodSync(path, 0o700);
	const one = createBridge(path),
		two = createBridge(path);
	const a = largeTextContext(),
		b = largeTextContext();
	b.setMarker("B");
	const first = await one.start(a.ctx);
	const app = await createGateway({
		runtime: path,
		port: 4395,
		stateDirectory: join(path, "auth"),
		assets: join(process.cwd(), "dist/web"),
		pollMs: 20,
	});
	const readers: Awaited<ReturnType<typeof openSse>>[] = [];
	try {
		await app.listen({ host: "127.0.0.1", port: 4395 });
		const url = "http://127.0.0.1:4395",
			cookie = await pairTcp(url, app);
		const ar = await openSse(url, cookie, undefined, false, first);
		readers.push(ar);
		await expect
			.poll(() =>
				markerOf(
					ar.events.at(-1)?.data ?? {
						connection: "disconnected",
						sessions: [],
					},
				),
			)
			.toBe("a");
		const second = await two.start(b.ctx);
		await expect.poll(() => ar.events.at(-1)?.data.sessions.length).toBe(2);
		const br = await openSse(url, cookie, ar.events.at(-1)!.id, false, second);
		readers.push(br);
		await expect.poll(() => br.events.length).toBe(1);
		expect(markerOf(br.events[0].data)).toBe("B");
		expect(br.events[0].id).not.toBe(ar.events.at(-1)!.id);
		const before = ar.events.at(-1)!.id;
		a.setMarker("c");
		b.setMarker("D");
		await expect.poll(() => markerOf(ar.events.at(-1)!.data)).toBe("c");
		await expect.poll(() => markerOf(br.events.at(-1)!.data)).toBe("D");
		ar.req.destroy();
		const returning = await openSse(url, cookie, before, false, first);
		readers.push(returning);
		await expect.poll(() => returning.events.length).toBe(1);
		expect(markerOf(returning.events[0].data)).toBe("c");
		expect(returning.events[0].id).toBe(ar.events.at(-1)!.id);
		const replaced = await one.start(a.ctx);
		await expect
			.poll(() => returning.events.at(-1)?.data.connection)
			.toBe("disconnected");
		expect(returning.events.at(-1)?.data.selected?.generation).toBe(
			first.generation,
		);
		expect(returning.events.at(-1)?.data.snapshot).toBeUndefined();
		returning.req.destroy();
		const staleReconnect = await openSse(url, cookie, before, false, first);
		readers.push(staleReconnect);
		await expect.poll(() => staleReconnect.events.length).toBe(1);
		expect(staleReconnect.events[0].data.connection).toBe("disconnected");
		expect(staleReconnect.events[0].data.snapshot).toBeUndefined();
		staleReconnect.req.destroy();
		const fresh = await openSse(url, cookie, before, false, replaced);
		readers.push(fresh);
		await expect.poll(() => fresh.events.length).toBe(1);
		expect(fresh.events[0].data.snapshot?.generation).toBe(replaced.generation);
		expect(
			new Set(fresh.events[0].data.snapshot?.items.map((item) => item.id)).size,
		).toBe(fresh.events[0].data.snapshot?.items.length);
		expect(br.events.at(-1)?.data.snapshot?.generation).toBe(second.generation);
		returning.req.destroy();
		fresh.req.destroy();
		await two.close();
		await expect
			.poll(() => br.events.at(-1)?.data.connection)
			.toBe("disconnected");
		expect(br.events.at(-1)?.data.snapshot).toBeUndefined();
		expect(br.events.at(-1)?.data.selected?.instance).toBe(second.instance);
		expect(br.errors).toEqual([]);
		for (const reader of readers)
			expect(reader.errors).not.toContain("Oversized SSE frame");
	} finally {
		for (const reader of readers) reader.req.destroy();
		await app.close();
		await one.close();
		await two.close();
		rmSync(path, { recursive: true, force: true });
	}
}, 20000);

it("restart launcher builds before dispatch from its own root and propagates build/CLI failures and signals", async () => {
	const root = realpathSync(mkdtempSync("/tmp/c2-restart-launcher-"));
	try {
		mkdirSync(join(root, "scripts"));
		mkdirSync(join(root, "dist/gateway"), { recursive: true });
		writeFileSync(
			join(root, "scripts/restart.mjs"),
			readFileSync("scripts/restart.mjs"),
		);
		writeFileSync(
			join(root, "build.mjs"),
			`import fs from 'node:fs'; fs.appendFileSync('journal', JSON.stringify({step:'build', args:process.argv.slice(2), cwd:process.cwd()})+'\\n'); if(process.env.MODE==='hang'){console.log('build waiting');setInterval(()=>{},1000)}else process.exitCode=process.env.MODE==='build-fail'?7:0;`,
		);
		writeFileSync(
			join(root, "dist/gateway/cli.js"),
			`const fs=require('node:fs');fs.appendFileSync('journal',JSON.stringify({step:'restart',args:process.argv.slice(2),cwd:process.cwd()})+'\\n');process.exitCode=process.env.MODE==='restart-fail'?9:0;`,
		);
		for (const [mode, expected] of [
			["good", 0],
			["build-fail", 7],
			["restart-fail", 9],
			["hang", null],
			["unsupported-arguments", 1],
		] as const) {
			writeFileSync(join(root, "journal"), "");
			const child = spawn(
				process.execPath,
				[
					join(root, "scripts/restart.mjs"),
					...(mode === "unsupported-arguments" ? ["--port", "4318"] : []),
				],
				{
					cwd: "/tmp",
					env: {
						PATH: root,
						npm_execpath: join(root, "build.mjs"),
						MODE: mode,
					},
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			let output = "",
				error = "";
			child.stdout!.on("data", (data) => (output += data));
			child.stderr!.on("data", (data) => (error += data));
			try {
				if (mode === "hang") {
					await expect.poll(() => output).toContain("build waiting");
					child.kill("SIGTERM");
				}
				expect(await exit(child)).toBe(expected);
				if (mode === "unsupported-arguments") {
					expect(error).toBe("Pi companion: restart accepts no arguments\n");
					expect(readFileSync(join(root, "journal"), "utf8")).toBe("");
					continue;
				}
				if (mode === "hang") expect(child.signalCode).toBe("SIGTERM");
				const journal = readFileSync(join(root, "journal"), "utf8")
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line));
				expect(journal).toEqual(
					mode === "build-fail" || mode === "hang"
						? [{ step: "build", args: ["run", "build"], cwd: root }]
						: [
								{ step: "build", args: ["run", "build"], cwd: root },
								{ step: "restart", args: ["restart"], cwd: root },
							],
				);
			} finally {
				if (child.exitCode === null && child.signalCode === null) {
					child.kill("SIGTERM");
					await exit(child);
				}
			}
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}, 10000);

it("restart launcher native path selection preserves fixtures/non-Darwin and replaces only missing CLI or the known macOS shim", () => {
	const source =
		readFileSync("scripts/restart.mjs", "utf8")
			.split("\nlet child;")[0]
			.replace(/^import .*;\n/gm, "") + "\nglobalThis.selectedPath = env.PATH;";
	const native = "/Applications/Tailscale.app/Contents/MacOS";
	const shim =
		'#!/bin/sh\n/Applications/Tailscale.app/Contents/MacOS/tailscale "$@"\n';
	for (const [platform, path, files, expected] of [
		[
			"darwin",
			"/usr/local/bin:/usr/bin:/bin",
			{ "/usr/local/bin/tailscale": shim, [native + "/tailscale"]: "" },
			native + ":/usr/local/bin:/usr/bin:/bin",
		],
		[
			"darwin",
			"/usr/bin:/bin",
			{ [native + "/tailscale"]: "" },
			native + ":/usr/bin:/bin",
		],
		["darwin", "/usr/bin:/bin", {}, "/usr/bin:/bin"],
		["darwin", "/fixture", { [native + "/tailscale"]: "" }, "/fixture"],
		[
			"darwin",
			"/fixture:/usr/bin",
			{ "/fixture/tailscale": "fixture", [native + "/tailscale"]: "" },
			"/fixture:/usr/bin",
		],
		[
			"darwin",
			"/usr/local/bin:/bin",
			{ "/usr/local/bin/tailscale": "native", [native + "/tailscale"]: "" },
			"/usr/local/bin:/bin",
		],
		[
			"linux",
			"/usr/bin:/bin",
			{ [native + "/tailscale"]: "" },
			"/usr/bin:/bin",
		],
	] as const) {
		const sandbox = {
			process: { platform, env: { PATH: path } },
			delimiter: ":",
			join,
			fileURLToPath: () => "/repo/",
			URL,
			constants: { X_OK: 1 },
			accessSync: (name: string) => {
				if (!(name in files)) throw new Error("missing");
			},
			readFileSync: (name: string) => (files as Record<string, string>)[name],
			selectedPath: "",
		};
		runInNewContext(
			source.replace("import.meta.url", '"file:///repo/scripts/restart.mjs"'),
			sandbox,
		);
		expect(sandbox.selectedPath).toBe(expected);
	}
});
