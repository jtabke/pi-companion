import { it, expect, vi } from "vitest";
import {
	mkdtempSync,
	rmSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { request, type IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import * as fs from "node:fs";
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
import { createGateway } from "../src/gateway/server.js";
import { createBridge } from "../src/extension/bridge.js";
import * as peers from "../src/gateway/peer.js";
import { context, png } from "./fixture.js";

const port = 4396,
	host = `127.0.0.1:${port}`,
	origin = `http://${host}`;
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
async function fixture() {
	const runtime = mkdtempSync(join("/tmp", "c2-pa-"));
	const stateDirectory = join(runtime, "auth");
	let calls = 0;
	const bridge = createBridge(runtime, undefined, () => {
		calls++;
	});
	const registration = await bridge.start(context());
	const identity = {
		instance: registration.instance,
		generation: registration.generation,
	};
	const app = await createGateway({
		runtime,
		stateDirectory,
		port,
		pollMs: 60_000,
	});
	const post = (
		url: string,
		payload: unknown,
		cookie?: string,
		csrf = url === "/api/pair" ? "pair" : "input",
	) =>
		app.inject({
			method: "POST",
			url,
			headers: {
				host,
				origin,
				"x-c2-csrf": csrf,
				...(cookie ? { cookie } : {}),
			},
			payload: payload as object,
		});
	async function pair(remember = false) {
		const response = await post("/api/pair", {
			code: app.pairing.issueCode().code,
			remember,
		});
		expect(response.statusCode).toBe(200);
		return String(response.headers["set-cookie"]).split(";")[0];
	}
	const query = `?instance=${identity.instance}&generation=${identity.generation}`;
	return {
		runtime,
		stateDirectory,
		app,
		post,
		pair,
		identity,
		query,
		registration,
		get calls() {
			return calls;
		},
		cleanup: async () => {
			await app.close();
			await bridge.close();
			rmSync(runtime, { recursive: true, force: true });
		},
	};
}

it("strict short-code exchange preserves exact-origin/CSRF, cookie safety, reissue, expiry, single use and bounded attempts/sessions", async () => {
	const f = await fixture();
	try {
		let issued = f.app.pairing.issueCode();
		expect(issued.code).toMatch(/^[0-9]{6}$/);
		expect(issued.expires - Date.now()).toBeGreaterThan(299_000);
		for (const payload of [
			{ secret: issued.code },
			{ code: Number(issued.code), remember: false },
			{ code: issued.code, remember: "false" },
			{ code: issued.code },
			{ code: issued.code, remember: false, secret: "extra" },
			null,
		])
			expect((await f.post("/api/pair", payload)).statusCode).toBe(400);
		for (const headers of [
			{ host, origin, "x-c2-csrf": "input" },
			{ host, "x-c2-csrf": "pair" },
			{ host, origin: origin + "/", "x-c2-csrf": "pair" },
		])
			expect(
				(
					await f.app.inject({
						method: "POST",
						url: "/api/pair",
						headers,
						payload: { code: issued.code, remember: false },
					})
				).statusCode,
			).toBe(403);
		const replacement = f.app.pairing.issueCode();
		expect(
			(await f.post("/api/pair", { code: issued.code, remember: false }))
				.statusCode,
		).toBe(401);
		const paired = await f.post("/api/pair", {
			code: replacement.code,
			remember: false,
		});
		expect(paired.json()).toEqual({ paired: true });
		for (const url of ["/api/devices", "/api/code", "/api/issue-code"])
			expect(
				(
					await f.app.inject({
						url,
						headers: {
							host,
							cookie: String(paired.headers["set-cookie"]).split(";")[0],
						},
					})
				).statusCode,
			).toBe(404);
		const cookie = String(paired.headers["set-cookie"]);
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Strict");
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("Max-Age=28800");
		expect(cookie).not.toMatch(/Domain=|Secure/);
		expect(
			(await f.post("/api/pair", { code: replacement.code, remember: false }))
				.statusCode,
		).toBe(401);
		issued = f.app.pairing.issueCode();
		const clock = vi.spyOn(Date, "now").mockReturnValue(issued.expires);
		try {
			expect(
				(await f.post("/api/pair", { code: issued.code, remember: true }))
					.statusCode,
			).toBe(401);
		} finally {
			clock.mockRestore();
		}
		// Expiry moved the attempt window; five wrong guesses lock this code without touching sessions.
		issued = f.app.pairing.issueCode();
		const wrong = issued.code === "000000" ? "000001" : "000000";
		for (let i = 0; i < 5; i++)
			expect(
				(await f.post("/api/pair", { code: wrong, remember: false }))
					.statusCode,
			).toBe(401);
		expect(
			(await f.post("/api/pair", { code: issued.code, remember: false }))
				.statusCode,
		).toBe(401);
		for (let i = 0; i < 3; i++) {
			issued = f.app.pairing.issueCode();
			expect(
				(await f.post("/api/pair", { code: issued.code, remember: false }))
					.statusCode,
			).toBe(200);
		}
		issued = f.app.pairing.issueCode();
		expect(
			(await f.post("/api/pair", { code: issued.code, remember: false }))
				.statusCode,
		).toBe(429);
		const next = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 360_001);
		try {
			for (let i = 0; i < 4; i++) await f.pair();
			issued = f.app.pairing.issueCode();
			expect(
				(await f.post("/api/pair", { code: issued.code, remember: false }))
					.statusCode,
			).toBe(429);
			expect(
				(await f.post("/api/pair", { code: issued.code, remember: false }))
					.statusCode,
			).toBe(401); // Capacity refusal consumed the code.
			expect(f.app.pairing.devices()).toHaveLength(8);
		} finally {
			next.mockRestore();
		}
	} finally {
		await f.cleanup();
	}
});

it("remembered cookie is namespace-bound; self-forget is strict, authenticated, durable and never accepts a target", async () => {
	const f = await fixture();
	let alternate: Awaited<ReturnType<typeof createGateway>> | undefined;
	const otherRuntime = mkdtempSync(join("/tmp", "c2-po-"));
	try {
		const result = await f.post("/api/pair", {
			code: f.app.pairing.issueCode().code,
			remember: true,
		});
		expect(result.statusCode).toBe(200);
		expect(result.headers["set-cookie"]).toContain("Max-Age=2592000");
		const cookie = String(result.headers["set-cookie"]).split(";")[0];
		const devices = f.app.pairing.devices();
		expect(Object.keys(devices[0]).sort()).toEqual([
			"created",
			"expires",
			"id",
		]);
		const state = readFileSync(
			join(f.stateDirectory, readdirSync(f.stateDirectory)[0]),
			"utf8",
		);
		expect(state).not.toContain(cookie.split("=")[1]);
		alternate = await createGateway({
			runtime: f.runtime,
			stateDirectory: f.stateDirectory,
			port: port + 1,
		});
		expect(
			(
				await alternate.inject({
					url: "/api/snapshot",
					headers: { host: `127.0.0.1:${port + 1}`, cookie },
				})
			).statusCode,
		).toBe(401);
		await alternate.close();
		alternate = await createGateway({
			runtime: otherRuntime,
			stateDirectory: f.stateDirectory,
			port,
		});
		expect(
			(
				await alternate.inject({
					url: "/api/snapshot",
					headers: { host, cookie },
				})
			).statusCode,
		).toBe(401);
		for (const payload of [{ id: devices[0].id }, { token: cookie }, [], null])
			expect((await f.post("/api/forget", payload, cookie)).statusCode).toBe(
				400,
			);
		expect((await f.post("/api/forget", {}, cookie, "pair")).statusCode).toBe(
			403,
		);
		expect(
			(
				await f.app.inject({
					method: "POST",
					url: "/api/forget",
					headers: { host, cookie, "x-c2-csrf": "input" },
					payload: {},
				})
			).statusCode,
		).toBe(403);
		expect((await f.post("/api/forget", {})).statusCode).toBe(401);
		const forgot = await f.post("/api/forget", {}, cookie);
		expect(forgot.statusCode).toBe(200);
		expect(forgot.json()).toEqual({ forgotten: true });
		expect(forgot.headers["set-cookie"]).toContain("Max-Age=0");
		expect(
			(await f.app.inject({ url: "/api/snapshot", headers: { host, cookie } }))
				.statusCode,
		).toBe(401);
		await f.app.close();
		await alternate.close();
		alternate = await createGateway({
			runtime: f.runtime,
			stateDirectory: f.stateDirectory,
			port,
		});
		expect(
			(
				await alternate.inject({
					url: "/api/snapshot",
					headers: { host, cookie },
				})
			).statusCode,
		).toBe(401);
		expect(alternate.pairing.devices()).toEqual([]);
	} finally {
		await alternate?.close();
		await f.cleanup();
		rmSync(otherRuntime, { recursive: true, force: true });
	}
});

it("revoke blocks pending snapshot, SSE-before-hijack and media-before-stream without disclosing native bytes", async () => {
	for (const route of ["/api/snapshot", "/api/events", "/api/media"]) {
		const f = await fixture();
		const hold = deferred(),
			started = deferred();
		const original = peers.readSnapshot;
		let stub: ReturnType<typeof vi.spyOn> | undefined;
		try {
			const cookie = await f.pair();
			const snapshot = await original(f.runtime, f.registration);
			const ref = snapshot.items
				.flatMap((item) => item.blocks)
				.find((block) => block.type === "image")!;
			stub = vi
				.spyOn(peers, "readSnapshot")
				.mockImplementation(async (...args) => {
					started.resolve();
					await hold.promise;
					return original(...args);
				});
			const url =
				route === "/api/media"
					? `${route}/${f.identity.instance}/${f.identity.generation}/${ref.type === "image" ? ref.ref : ""}`
					: route + f.query;
			const pending = f.app.inject({ url, headers: { host, cookie } });
			void pending.then(() => {});
			await started.promise;
			expect(f.app.pairing.revoke(f.app.pairing.devices()[0].id)).toBe(true);
			hold.resolve();
			const response = await pending;
			expect(response.statusCode).toBe(401);
			expect(response.body).not.toContain("C2 controlled fixture");
			expect(response.headers["content-type"]).not.toMatch(
				/image|event-stream/,
			);
		} finally {
			hold.resolve();
			stub?.mockRestore();
			await f.cleanup();
		}
	}
});

it("final media header await also denies revoked authority and destroys the upstream", async () => {
	const f = await fixture(),
		hold = deferred(),
		started = deferred();
	const media = Object.assign(new PassThrough(), {
		statusCode: 200,
		headers: { "content-type": "image/png", "content-length": "100" },
	});
	let stub: ReturnType<typeof vi.spyOn> | undefined;
	try {
		const cookie = await f.pair();
		const snapshot = await peers.readSnapshot(f.runtime, f.registration);
		const image = snapshot.items
			.flatMap((item) => item.blocks)
			.find((block) => block.type === "image")!;
		stub = vi.spyOn(peers, "peerResponse").mockImplementation(async () => {
			started.resolve();
			await hold.promise;
			return media as unknown as IncomingMessage;
		});
		const pending = f.app.inject({
			url: `/api/media/${f.identity.instance}/${f.identity.generation}/${image.type === "image" ? image.ref : ""}`,
			headers: { host, cookie },
		});
		void pending.then(() => {});
		await started.promise;
		f.app.pairing.revoke(f.app.pairing.devices()[0].id);
		hold.resolve();
		expect((await pending).statusCode).toBe(401);
		expect(media.destroyed).toBe(true);
	} finally {
		hold.resolve();
		stub?.mockRestore();
		media.destroy();
		await f.cleanup();
	}
});

it("revoke blocks every not-yet-forwarded input after discovery and releases admission; dispatched attempts remain uncertain", async () => {
	for (const route of [
		"/api/text",
		"/api/stop",
		"/api/image",
		"/api/question-reply",
		"/api/control",
	]) {
		const f = await fixture(),
			hold = deferred(),
			started = deferred();
		let stub: ReturnType<typeof vi.spyOn> | undefined;
		try {
			const cookie = await f.pair();
			const lease = (
				await f.post("/api/control", { ...f.identity, action: "claim" }, cookie)
			).json().lease;
			const original = peers.discover;
			stub = vi.spyOn(peers, "discover").mockImplementation(async (...args) => {
				started.resolve();
				await hold.promise;
				return original(...args);
			});
			const body =
				route === "/api/control"
					? { ...f.identity, action: "renew", lease }
					: route === "/api/question-reply"
						? {
								...f.identity,
								lease,
								reply: {
									invocationId: "pending",
									replyId: "reply",
									cancelled: true,
									answers: [],
								},
							}
						: {
								...f.identity,
								lease,
								requestId: "a".repeat(32),
								...(route === "/api/stop" ? {} : { text: "do not dispatch" }),
								...(route === "/api/image"
									? {
											images: [
												{ mime: "image/png", source: png.toString("base64") },
											],
										}
									: {}),
							};
			const pending = f.post(route, body, cookie);
			void pending.then(() => {});
			await started.promise;
			expect(
				(
					await f.post(
						"/api/control",
						{ ...f.identity, action: "claim" },
						cookie,
					)
				).statusCode,
			).toBe(429);
			f.app.pairing.revoke(f.app.pairing.devices()[0].id);
			hold.resolve();
			expect((await pending).statusCode).toBe(409);
			expect(f.calls).toBe(0);
			stub.mockRestore();
			const next = await f.pair();
			expect(
				(await f.post("/api/control", { ...f.identity, action: "claim" }, next))
					.statusCode,
			).toBe(200);
		} finally {
			hold.resolve();
			stub?.mockRestore();
			await f.cleanup();
		}
	}
	const f = await fixture(),
		hold = deferred(),
		dispatched = deferred();
	const stub = vi.spyOn(peers, "sendText").mockImplementation(async () => {
		dispatched.resolve();
		await hold.promise;
		throw Error("unconfirmed");
	});
	try {
		const cookie = await f.pair();
		const lease = (
			await f.post("/api/control", { ...f.identity, action: "claim" }, cookie)
		).json().lease;
		const pending = f.post(
			"/api/text",
			{
				...f.identity,
				lease,
				requestId: "b".repeat(32),
				text: "already dispatched",
			},
			cookie,
		);
		void pending.then(() => {});
		await dispatched.promise;
		f.app.pairing.revoke(f.app.pairing.devices()[0].id);
		hold.resolve();
		expect((await pending).json()).toEqual({
			requestId: "b".repeat(32),
			status: "uncertain",
			reason: "outcome-unconfirmed",
		});
		expect(stub).toHaveBeenCalledTimes(1);
	} finally {
		hold.resolve();
		stub.mockRestore();
		await f.cleanup();
	}
});

it("local revoke, browser forget and state failure close active SSE/media and remove leases immediately", async () => {
	for (const action of ["revoke", "forget", "state-failure"]) {
		const f = await fixture();
		const media = Object.assign(new PassThrough(), {
			statusCode: 200,
			headers: { "content-type": "image/png", "content-length": "100" },
		});
		const sockets: ReturnType<typeof request>[] = [];
		let stub: ReturnType<typeof vi.spyOn> | undefined;
		try {
			const cookie = await f.pair(true);
			const token = cookie.split("=")[1];
			await f.post("/api/control", { ...f.identity, action: "claim" }, cookie);
			await f.app.listen({ host: "127.0.0.1", port });
			const open = (url: string) =>
				new Promise<{ response: IncomingMessage; closed: Promise<void> }>(
					(resolve, reject) => {
						const req = request(
							origin + url,
							{ headers: { cookie } },
							(response) => {
								const closed = new Promise<void>((r) =>
									response.once("close", r),
								);
								response.on("error", () => {});
								response.on("data", () => resolve({ response, closed }));
							},
						);
						sockets.push(req);
						req.on("error", reject);
						req.end();
					},
				);
			const sse = await open("/api/events" + f.query);
			expect(sse.response.statusCode).toBe(200);
			const snapshot = await peers.readSnapshot(f.runtime, f.registration);
			const image = snapshot.items
				.flatMap((item) => item.blocks)
				.find((block) => block.type === "image")!;
			stub = vi
				.spyOn(peers, "peerResponse")
				.mockResolvedValue(media as unknown as IncomingMessage);
			const streaming = open(
				`/api/media/${f.identity.instance}/${f.identity.generation}/${image.type === "image" ? image.ref : ""}`,
			);
			const tick = setInterval(() => media.write(Buffer.from([1])), 10);
			const active = await streaming;
			clearInterval(tick);
			expect(active.response.statusCode).toBe(200);
			if (action === "revoke")
				expect(f.app.pairing.revoke(f.app.pairing.devices()[0].id)).toBe(true);
			if (action === "forget")
				expect((await f.post("/api/forget", {}, cookie)).statusCode).toBe(200);
			if (action === "state-failure") {
				const file = join(f.stateDirectory, readdirSync(f.stateDirectory)[0]);
				writeFileSync(file, "corrupt", { mode: 0o600 });
				const failure = await f.app.inject({
					url: "/api/snapshot",
					headers: { host, cookie },
				});
				expect(failure.statusCode).toBe(503);
				expect(failure.body).not.toContain(token);
				expect(failure.body).not.toContain("corrupt");
			}
			await Promise.all([sse.closed, active.closed]);
			expect(media.destroyed).toBe(true);
			if (action !== "state-failure") {
				const next = await f.pair();
				expect(
					(
						await f.post(
							"/api/control",
							{ ...f.identity, action: "claim" },
							next,
						)
					).statusCode,
				).toBe(200);
			} else {
				expect(
					(
						await f.app.inject({
							url: "/api/snapshot",
							headers: { host, cookie },
						})
					).body,
				).not.toContain("C2 controlled fixture");
				expect(() => f.app.pairing.devices()).toThrow(
					"Credential state unavailable",
				);
			}
		} finally {
			for (const socket of sockets) socket.destroy();
			stub?.mockRestore();
			media.destroy();
			await f.cleanup();
		}
	}
}, 15000);

it("failed durable self-forget never confirms or clears a cookie and latches all authority closed", async () => {
	const f = await fixture();
	try {
		const cookie = await f.pair(true);
		const file = join(f.stateDirectory, readdirSync(f.stateDirectory)[0]),
			before = readFileSync(file, "utf8");
		vi.mocked(fs.renameSync).mockImplementationOnce(() => {
			throw Error("credential details must not escape");
		});
		const response = await f.post("/api/forget", {}, cookie);
		expect(response.statusCode).toBe(503);
		expect(response.json()).toEqual({ error: "Authentication unavailable" });
		expect(response.headers["set-cookie"]).toBeUndefined();
		expect(readFileSync(file, "utf8")).toBe(before);
		expect(
			(await f.app.inject({ url: "/api/snapshot", headers: { host, cookie } }))
				.statusCode,
		).toBe(503);
	} finally {
		await f.cleanup();
	}
});

it("cookie expiry keeps established read < versus mutation <= equality for temporary and remembered access", async () => {
	for (const remember of [false, true]) {
		const f = await fixture();
		let clock: ReturnType<typeof vi.spyOn> | undefined;
		try {
			const cookie = await f.pair(remember),
				expires = f.app.pairing.devices()[0].expires;
			clock = vi.spyOn(Date, "now").mockReturnValue(expires);
			expect(
				(
					await f.app.inject({
						url: "/api/snapshot",
						headers: { host, cookie },
					})
				).statusCode,
			).toBe(200);
			expect((await f.post("/api/forget", {}, cookie)).statusCode).toBe(401);
			clock.mockReturnValue(expires + 1);
			expect(
				(
					await f.app.inject({
						url: "/api/snapshot",
						headers: { host, cookie },
					})
				).statusCode,
			).toBe(401);
		} finally {
			clock?.mockRestore();
			await f.cleanup();
		}
	}
});
