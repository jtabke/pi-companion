import { describe, it, expect, vi } from "vitest";
import sharp, { type Sharp } from "sharp";
import { normalizeImage, imageDecodeMs } from "../src/gateway/upload.js";
import { sendImage, sendText, sendStop, readStatus } from "../src/gateway/peer.js";
import { nativeInput } from "../src/extension/input.js";
import * as peerCalls from "../src/gateway/peer.js";
import {
	mkdtempSync,
	readFileSync,
	renameSync,
	chmodSync,
	rmSync,
	symlinkSync,
	writeFileSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { deflateSync, inflateSync } from "node:zlib";
import { createBridge } from "../src/extension/bridge.js";
import { createGateway } from "../src/gateway/server.js";
import { runtimeDirectory } from "../src/shared/runtime.js";
import { discover, readSnapshot } from "../src/gateway/peer.js";
import { inspectImage } from "../src/extension/media.js";
import { nativeSnapshot } from "../src/extension/snapshot.js";
import { limits } from "../src/shared/protocol.js";
import { readQuestions, sendQuestionReply } from "../src/gateway/peer.js";
import { questionChannels } from "../src/extension/questions.js";
import { questionBus, questionRequest, context, png } from "./fixture.js";
const port = 4391,
	host = `127.0.0.1:${port}`,
	origin = `http://${host}`,
	secret = "controlled-pairing-secret";
function runtime() {
	const path = mkdtempSync(join("/tmp", "c2-"));
	chmodSync(path, 0o700);
	return runtimeDirectory(path);
}
function largeNativePng() {
	const width = 1150,
		height = 1150;
	const pixels = Buffer.alloc(height * (1 + width * 3)); // RGB black, filter 0 on each row.
	function chunk(kind: string, data: Buffer) {
		const body = Buffer.concat([Buffer.from(kind), data]);
		let crc = 0xffffffff;
		for (const byte of body) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++)
				crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
		}
		const size = Buffer.alloc(4),
			checksum = Buffer.alloc(4);
		size.writeUInt32BE(data.length);
		checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
		return Buffer.concat([size, body, checksum]);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	const compressed = deflateSync(pixels, { level: 0 });
	expect(inflateSync(compressed).equals(pixels)).toBe(true);
	return Buffer.concat([
		png.subarray(0, 8),
		chunk("IHDR", header),
		chunk("IDAT", compressed),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
describe("C4 Stop native observation and shared receipts", () => {
	const identity = { instance: "1".repeat(32), generation: "2".repeat(32) };
	const body = (n = 0) => ({ ...identity, requestId: n.toString(16).padStart(32, "0") });
	it("records before abort, deduplicates synchronous settlement, and observes later work without upgrading receipts", () => {
		const ctx = context(); ctx.isIdle = () => false;
		let calls = 0;
		const dispatch = nativeInput(identity, ctx, undefined, () => true);
		ctx.abort = () => {
			calls++;
			expect(dispatch.observation()).toBe("stopping");
			expect(dispatch(body()).status).toBe("uncertain");
			ctx.isIdle = () => true;
			dispatch.observe("agent_settled", ctx);
		};
		expect(dispatch(body()).status).toBe("dispatched");
		expect(dispatch.observation()).toBe("parent-settled");
		expect(dispatch(body()).status).toBe("dispatched");
		expect(calls).toBe(1);
		ctx.isIdle = () => false;
		dispatch.observe("agent_start", ctx);
		expect(dispatch.observation()).toBeUndefined();
		expect(dispatch(body()).status).toBe("dispatched");
		expect(calls).toBe(1);
	});
	it("idle polls, agent_end, pending or foreign settled events never confirm ignored/throwing abort", () => {
		for (const throws of [false, true]) {
			const ctx = context(); ctx.isIdle = () => false;
			let calls = 0, current = true;
			ctx.abort = () => { calls++; if (throws) throw Error("after attempt"); };
			const dispatch = nativeInput(identity, ctx, () => { throw Error("no input"); }, () => current);
			dispatch.observe("agent_settled", ctx); // Prior observations cannot confirm a later Stop.
			expect(dispatch(body()).status).toBe(throws ? "uncertain" : "dispatched");
			ctx.isIdle = () => true;
			expect(dispatch.observation()).toBe("stopping");
			dispatch.observe("agent_end", ctx);
			dispatch.observe("agent_settled", context());
			const originalId = ctx.sessionManager.getSessionId;
			ctx.sessionManager.getSessionId = () => "replacement-session";
			dispatch.observe("agent_settled", ctx);
			expect(dispatch(body()).reason).toBe("stale");
			ctx.sessionManager.getSessionId = originalId;
			ctx.hasPendingMessages = () => true;
			dispatch.observe("agent_settled", ctx);
			expect(dispatch.observation()).toBe("stopping");
			ctx.hasPendingMessages = () => false;
			expect(dispatch({ ...body(1), text: "idle input" }).reason).toBe("stopping");
			expect(dispatch({ ...body(3), text: "", mime: "image/png", sourceDigest: "0".repeat(64), image: png.toString("base64") }).reason).toBe("stopping");
			expect(dispatch(body(2)).reason).toBe("stopping");
			expect(dispatch(body()).status).toBe(throws ? "uncertain" : "dispatched");
			current = false; dispatch.observe("agent_settled", ctx);
			expect(dispatch.observation()).toBe("stopping");
			expect(dispatch(body()).reason).toBe("stale");
			current = true; dispatch.observe("agent_settled", ctx);
			expect(dispatch.observation()).toBe("parent-settled");
			expect(calls).toBe(1);
		}
	});
	it("shares the 256-ID bound and keeps Stop/text/image fingerprints distinct including rejected IDs", () => {
		const ctx = context(); let calls = 0;
		ctx.abort = () => { calls++; };
		const dispatch = nativeInput(identity, ctx, () => {}, () => true, () => ({}));
		expect(dispatch(body()).reason).toBe("idle");
		ctx.isIdle = () => false;
		expect(dispatch(body()).reason).toBe("idle");
		expect(dispatch({ ...body(), text: "different kind" }).reason).toBe("mismatch");
		expect(dispatch({ ...body(), text: "", mime: "image/png", sourceDigest: "0".repeat(64), image: png.toString("base64") }).reason).toBe("mismatch");
		expect(dispatch({ ...body(1), text: "text" }).reason).toBe("busy");
		expect(dispatch(body(1)).reason).toBe("mismatch");
		for (let n = 2; n < 256; n++) expect(dispatch(body(n)).reason).toBe(n === 2 ? "outcome-unconfirmed" : "stopping");
		expect(dispatch(body(256)).reason).toBe("ledger-full");
		expect(dispatch(body(2)).status).toBe("dispatched");
		expect(calls).toBe(1);
	});
	it("uses the authenticated fixed UDS, retains stopping across gateway observation, invalidates replacement and never aborts on close", async () => {
		const path = runtime(), ctx = context(); ctx.isIdle = () => false;
		let calls = 0; ctx.abort = () => { calls++; };
		const bridge = createBridge(path);
		try {
			const reg = await bridge.start(ctx), input = { instance: reg.instance, generation: reg.generation, requestId: "a".repeat(32) };
			expect((await sendStop(path, reg, input)).status).toBe("dispatched");
			ctx.isIdle = () => true; bridge.observe("agent_end", ctx);
			expect((await readStatus(path, reg)).summary.stop).toBe("stopping");
			expect((await sendStop(path, reg, input)).status).toBe("dispatched");
			bridge.observe("agent_settled", context());
			expect((await readStatus(path, reg)).summary.stop).toBe("stopping");
			bridge.observe("agent_settled", ctx);
			expect((await readStatus(path, reg)).summary.stop).toBe("parent-settled");
			const nextCtx = context(); nextCtx.isIdle = () => false;
			const next = await bridge.start(nextCtx);
			bridge.observe("agent_settled", ctx);
			expect((await readStatus(path, next)).summary.stop).toBeUndefined();
			expect((await sendStop(path, next, input)).reason).toBe("stale");
			expect((await sendStop(path, next, { ...input, generation: next.generation })).reason).toBe("unavailable");
			await bridge.close(); expect(calls).toBe(1);
		} finally { await bridge.close(); rmSync(path, { recursive: true, force: true }); }
	});
});

describe("C4 Stop gateway authority", () => {
	async function fixture() {
		const path = runtime(), ctx = context(); ctx.isIdle = () => false;
		let aborts = 0; ctx.abort = () => { aborts++; };
		const bridge = createBridge(path), reg = await bridge.start(ctx);
		let app = await createGateway({ runtime: path, port, secret, assets: join(process.cwd(), "dist/web"), pollMs: 60_000 });
		let cookie = "";
		const pair = async () => { cookie = String((await app.inject({ method: "POST", url: "/api/pair", headers: { host, origin, "x-c2-csrf": "pair" }, payload: { secret } })).headers["set-cookie"]).split(";")[0]; };
		await pair();
		const identity = { instance: reg.instance, generation: reg.generation };
		const post = (url: string, payload: Record<string, unknown>, overrides: Record<string, string | undefined> = {}) => app.inject({ method: "POST", url, payload, headers: { host, origin, cookie, "x-c2-csrf": "input", ...overrides } });
		let lease = (await post("/api/control", { ...identity, action: "claim" })).json().lease;
		return { path, ctx, bridge, reg, identity, post, aborts: () => aborts, app: () => app,
			headers: () => ({ host, origin, cookie, "x-c2-csrf": "input", "content-type": "application/json" }),
			body: (n = 0) => ({ ...identity, requestId: n.toString(16).padStart(32, "0"), lease }),
			restart: async () => { await app.close(); app = await createGateway({ runtime: path, port, secret, assets: join(process.cwd(), "dist/web"), pollMs: 60_000 }); await pair(); lease = (await post("/api/control", { ...identity, action: "claim" })).json().lease; },
			cleanup: async () => { await app.close(); await bridge.close(); rmSync(path, { recursive: true, force: true }); },
		};
	}
	it("rejects exact route/auth/query/schema/lease violations, serializes Stop, and recovers lost response under fresh restart authority", async () => {
		const f = await fixture();
		try {
			for (const headers of [{ cookie: "" }, { host: "localhost:" + port }, { origin: "https://evil.invalid" }, { origin: "" }, { "x-c2-csrf": "" }])
				expect((await f.post("/api/stop", f.body(), headers)).statusCode).not.toBe(200);
			for (const payload of [{ ...f.body(), text: "forbidden" }, { ...f.body(), requestId: 123 }, { ...f.body(), extra: true }, { ...f.body(), lease: "x" }, { ...f.body(), requestId: "x".repeat(2000) }])
				expect((await f.post("/api/stop", payload)).statusCode).toBeGreaterThanOrEqual(400);
			expect((await f.post("/api/stop?foo=1", f.body())).statusCode).toBe(400);
			await f.app().listen({ host: "127.0.0.1", port });
			const bareQuery = await new Promise<number>((resolve, reject) => {
				const req = request({ host: "127.0.0.1", port, path: "/api/stop?", method: "POST", headers: f.headers() }, res => {
					res.resume(); res.on("end", () => resolve(res.statusCode!));
				}); req.on("error", reject); req.end(JSON.stringify(f.body()));
			});
			expect(bareQuery).toBe(400);
			expect((await f.post("/api/stop", { ...f.body(), lease: "0".repeat(64) })).statusCode).toBe(409);
			expect(f.aborts()).toBe(0);
			const original = peerCalls.sendStop;
			const lost = vi.spyOn(peerCalls, "sendStop").mockImplementationOnce(async (...args) => { await original(...args); throw Error("lost receipt"); });
			const concurrent = await Promise.all([f.post("/api/stop", f.body()), f.post("/api/stop", f.body(1))]);
			expect(concurrent.map(r => r.statusCode).sort()).toEqual([200, 429]);
			expect(concurrent.find(r => r.statusCode === 200)!.json().status).toBe("uncertain");
			lost.mockRestore(); expect(f.aborts()).toBe(1);
			expect((await f.post("/api/stop", f.body(2))).json().reason).toBe("stopping");
			const old = f.body(); await f.restart();
			expect((await f.post("/api/stop", old)).statusCode).toBe(409);
			expect((await f.post("/api/stop", f.body())).json().status).toBe("dispatched");
			expect(f.aborts()).toBe(1);
			f.ctx.isIdle = () => true;
			expect((await f.post("/api/text", { ...f.body(3), text: "not yet" })).json().reason).toBe("stopping");
			f.bridge.observe("agent_settled", f.ctx);
			expect((await f.post("/api/stop", f.body(4))).json().reason).toBe("idle");
			const view = (await f.app().inject({ url: `/api/snapshot?instance=${f.reg.instance}&generation=${f.reg.generation}`, headers: f.headers() })).body;
			expect(view).not.toContain(f.reg.capability);
			expect(view).not.toContain(f.body().lease);
			expect(JSON.parse(view).sessions.find((s: { instance: string }) => s.instance === f.reg.instance).stop).toBe("stopping"); // Poll cache is not a settlement acknowledgement.
			const revoked = f.body();
			const takeover = (await f.post("/api/control", { ...f.identity, action: "takeover" })).json();
			expect((await f.post("/api/stop", revoked)).statusCode).toBe(409);
			await f.post("/api/control", { ...f.identity, lease: takeover.lease, action: "release" });
			expect((await f.post("/api/stop", { ...revoked, lease: takeover.lease })).statusCode).toBe(409);
			expect(f.aborts()).toBe(1);
		} finally { vi.restoreAllMocks(); await f.cleanup(); }
	});
	it("drops a departed real TCP Stop before forwarding and rejects fixed private route/auth/schema violations", async () => {
		const f = await fixture();
		try {
			const raw = (path: string, payload: string, headers: Record<string, string> = {}) => new Promise<number>((resolve, reject) => {
				const req = request({ socketPath: join(f.path, `b-${f.reg.generation}.sock`), path, method: "POST", headers: { "x-c2-capability": f.reg.capability, "content-type": "application/json", ...headers } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
				req.on("error", reject); req.end(payload);
			});
			const privateBody = { instance: f.reg.instance, generation: f.reg.generation, requestId: "e".repeat(32) };
			expect(await raw("/stop", JSON.stringify(privateBody), { "x-c2-capability": "0".repeat(64) })).toBe(401);
			expect(await raw("/stop", JSON.stringify(privateBody), { "content-type": "text/plain" })).toBe(400);
			expect(await raw("/stop", JSON.stringify({ ...privateBody, text: "no" }))).toBe(400);
			expect(await raw("/stop?", JSON.stringify(privateBody))).toBe(405);
			expect(await raw("/stop", "x".repeat(1025))).toBe(413);
			expect(f.aborts()).toBe(0);
			await f.app().listen({ host: "127.0.0.1", port });
			const actual = peerCalls.discover;
			let release!: () => void, entered!: () => void, returned!: () => void;
			const ready = new Promise<void>(r => { entered = r; }), hold = new Promise<void>(r => { release = r; }), done = new Promise<void>(r => { returned = r; });
			vi.spyOn(peerCalls, "discover").mockImplementationOnce(async path => { entered(); await hold; const result = await actual(path); returned(); return result; });
			const forwarding = vi.spyOn(peerCalls, "sendStop");
			const req = request({ host: "127.0.0.1", port, path: "/api/stop", method: "POST", headers: f.headers() });
			req.on("error", () => {}); req.end(JSON.stringify(f.body()));
			await ready; req.destroy(); await new Promise(r => setTimeout(r, 20)); release(); await done;
			await new Promise(r => setTimeout(r, 20));
			expect(forwarding).not.toHaveBeenCalled(); expect(f.aborts()).toBe(0);
		} finally { vi.restoreAllMocks(); await f.cleanup(); }
	});
	it("rechecks expiry, replacement and canonical conflict after awaited discovery without abort", async () => {
		for (const action of ["expiry", "cookie-expiry", "replacement", "conflict", "shutdown"])  {
			const f = await fixture(), other = createBridge(f.path);
			let clock: ReturnType<typeof vi.spyOn> | undefined;
			try {
				const actual = peerCalls.discover;
				let release!: () => void, entered!: () => void;
				const ready = new Promise<void>(r => { entered = r; }), hold = new Promise<void>(r => { release = r; });
				const gate = vi.spyOn(peerCalls, "discover").mockImplementationOnce(async (path) => { entered(); await hold; return actual(path); });
				const response = f.post("/api/stop", f.body()).then(r => r);
				await ready;
				// No waiting mutation queue: even release/takeover cannot overlap this attempt.
				expect((await f.post("/api/control", { ...f.identity, action: "takeover" })).statusCode).toBe(429);
				if (action === "expiry" || action === "cookie-expiry") { const now = Date.now(); clock = vi.spyOn(Date, "now").mockReturnValue(now + (action === "expiry" ? 60_001 : 8 * 60 * 60 * 1000 + 1)); }
				if (action === "replacement") await f.bridge.start(context());
				if (action === "conflict") { const file = join(f.path, "native.jsonl"); writeFileSync(file, "fixture", { mode: 0o600 }); f.ctx.sessionManager.getSessionFile = () => file; const ctx = context(); ctx.sessionManager.getSessionFile = () => file; await other.start(ctx); }
				let closing: Promise<void> | undefined;
				if (action === "shutdown") closing = f.app().close();
				release(); expect((await response).statusCode).toBe(409); await closing;
				gate.mockRestore(); expect(f.aborts()).toBe(0);
			} finally { clock?.mockRestore(); vi.restoreAllMocks(); await other.close(); await f.cleanup(); }
		}
	});
});

describe("native snapshot and private resources", () => {
	it("accepts a valid near-cap native PNG and isolates within-cap bad base64/container without losing status or text", () => {
		const valid = largeNativePng();
		expect(valid.length).toBeGreaterThan(3_900_000);
		expect(valid.length).toBeLessThan(limits.imageBytes);
		const image = inspectImage({
			type: "image",
			data: valid.toString("base64"),
			mimeType: "image/png",
		});
		expect(image?.bytes.equals(valid)).toBe(true);
		expect([image?.width, image?.height]).toEqual([1150, 1150]);
		const canonicalBadContainer = "A".repeat(5_333_332);
		expect(Buffer.from(canonicalBadContainer, "base64").length).toBe(3_999_999);
		for (const invalid of [
			canonicalBadContainer,
			canonicalBadContainer.slice(0, -1) + "%",
		]) {
			expect(
				inspectImage({ type: "image", data: invalid, mimeType: "image/png" }),
			).toBeUndefined();
			const ctx = context(valid, "Remaining conversation is observable");
			ctx.isIdle = () => false;
			const entry = ctx.sessionManager.getBranch()[0];
			if (entry.type !== "message" || entry.message.role !== "toolResult")
				throw Error("fixture type");
			entry.message.content.push({
				type: "image",
				data: invalid,
				mimeType: "image/png",
			});
			const result = nativeSnapshot(
				ctx,
				"a".repeat(32),
				"b".repeat(32),
				"c".repeat(64),
			);
			expect(result.snapshot.parent).toBe("working");
			expect(result.snapshot.items[0].blocks).toContainEqual({
				type: "text",
				text: "Remaining conversation is observable",
			});
			expect(
				result.snapshot.items[0].blocks.some(
					(block) => block.type === "unavailable",
				),
			).toBe(true);
			expect(result.media.size).toBe(1);
			expect([...result.media.values()][0]?.bytes.equals(valid)).toBe(true);
		}
	});
	it("validates MIME, size and structural format; explicit unavailable/truncation", () => {
		expect(
			inspectImage({
				type: "image",
				data: png.toString("base64"),
				mimeType: "image/png",
			})?.bytes,
		).toEqual(png);
		for (const image of [
			{ data: png.toString("base64"), mimeType: "image/jpeg" },
			{ data: "%%%%", mimeType: "image/png" },
			{ data: png.subarray(0, 30).toString("base64"), mimeType: "image/png" },
			{
				data: "A".repeat(Math.ceil(limits.imageBytes / 3) * 4 + 4),
				mimeType: "image/png",
			},
		])
			expect(inspectImage({ type: "image", ...image })).toBeUndefined();
		const result = nativeSnapshot(
			context(Buffer.from("bad"), "x".repeat(limits.blockText + 1)),
			"a".repeat(32),
			"b".repeat(32),
			"c".repeat(64),
		);
		expect(result.snapshot.truncated).toBe(true);
		expect(
			result.snapshot.items[0].blocks.some(
				(block) => block.type === "unavailable",
			),
		).toBe(true);
		expect(JSON.stringify(result.snapshot)).not.toContain("base64");
	});
	it("bounds history, blocks, escaped JSON and image retention without duplicate item IDs", () => {
		const ctx = context();
		const original = ctx.sessionManager.getBranch()[0];
		if (original.type !== "message" || original.message.role !== "toolResult")
			throw Error("fixture type");
		ctx.sessionManager.getBranch = () =>
			Array.from({ length: limits.items + 1 }, (_, index) => ({
				...original,
				id: `entry-${index}`,
				message: {
					...original.message,
					content: Array.from({ length: limits.blocks }, () => ({
						type: "text" as const,
						text: "\u0000".repeat(limits.blockText),
					})),
				},
			}));
		const result = nativeSnapshot(
			ctx,
			"a".repeat(32),
			"b".repeat(32),
			"c".repeat(64),
		);
		expect(result.snapshot.truncated).toBe(true);
		expect(result.snapshot.items.length).toBeLessThanOrEqual(limits.items);
		expect(
			Buffer.byteLength(JSON.stringify(result.snapshot)),
		).toBeLessThanOrEqual(limits.snapshotBytes);
		expect(new Set(result.snapshot.items.map((item) => item.id)).size).toBe(
			result.snapshot.items.length,
		);
	});

	it("rejects unsafe modes, symlink leaf and long Darwin paths", () => {
		const path = runtime();
		try {
			chmodSync(path, 0o755);
			expect(() => runtimeDirectory(path)).toThrow();
			chmodSync(path, 0o700);
			const link = path + "-link";
			symlinkSync(path, link);
			try {
				expect(() => runtimeDirectory(link)).toThrow();
			} finally {
				rmSync(link);
			}
			expect(() => runtimeDirectory("/tmp/" + "a".repeat(100))).toThrow();
		} finally {
			rmSync(path, { recursive: true, force: true });
		}
	});
	it("does not remove a registration inode it no longer owns", async () => {
		const path = runtime(),
			bridge = createBridge(path);
		try {
			const registration = await bridge.start(context());
			const file = join(path, `b-${registration.instance}.json`);
			renameSync(file, join(path, "saved-registration"));
			writeFileSync(file, "foreign fixture resource", {
				mode: 0o600,
				flag: "wx",
			});
			await bridge.close();
			expect(readFileSync(file, "utf8")).toBe("foreign fixture resource");
		} finally {
			await bridge.close();
			rmSync(path, { recursive: true, force: true });
		}
	});

	it("authenticates real UDS; generation invalidation and disconnect never changes owner", async () => {
		const path = runtime(),
			bridge = createBridge(path),
			ctx = context();
		try {
			const first = await bridge.start(ctx);
			const snapshot = await readSnapshot(path, first);
			expect(snapshot.items).toHaveLength(1);
			const unauthorized = await new Promise<number>((resolve) => {
				const req = request(
					{
						socketPath: join(path, `b-${first.generation}.sock`),
						path: "/snapshot",
					},
					(res) => {
						res.resume();
						resolve(res.statusCode!);
					},
				);
				req.end();
			});
			expect(unauthorized).toBe(401);
			const second = await bridge.start(ctx);
			expect(second.instance).toBe(first.instance);
			expect(second.generation).not.toBe(first.generation);
			await expect(readSnapshot(path, first)).rejects.toThrow();
			const live = await discover(path);
			expect(live.peers).toHaveLength(1);
			expect(ctx.isIdle()).toBe(true);
			writeFileSync(
				join(path, `b-${"d".repeat(32)}.json`),
				JSON.stringify({ ...first, instance: "d".repeat(32) }),
				{ mode: 0o600 },
			);
			expect((await discover(path)).peers).toHaveLength(1);
			writeFileSync(
				join(path, `b-${"d".repeat(32)}.json`),
				JSON.stringify({ ...second, instance: "d".repeat(32) }),
				{ mode: 0o600 },
			);
			// Reachable socket and valid capability are insufficient without exact status identity.
			expect((await discover(path)).peers).toHaveLength(1);
		} finally {
			await bridge.close();
			rmSync(path, { recursive: true, force: true });
		}
	});
});
describe("C5 private HTTPS origin boundary", () => {
	const publicOrigin = "https://companion.example.ts.net", publicHost = "companion.example.ts.net";
	it("rejects authored noncanonical or non-device origins before gateway creation", async () => {
		const path = runtime();
		try {
			for (const invalid of [
				"", "http://companion.example.ts.net", "https://example.com", "https://localhost", "https://127.0.0.1",
				"https://example.ts.net", "https://a.b.c.ts.net", "https://*.example.ts.net",
				"https://user@companion.example.ts.net", "https://companion.example.ts.net/",
				"https://companion.example.ts.net/path", "https://companion.example.ts.net?", "https://companion.example.ts.net#",
				"https://companion.example.ts.net:443", "https://companion.example.ts.net:8443",
				"HTTPS://companion.example.ts.net", "https://Companion.example.ts.net", " https://companion.example.ts.net",
				"https://companion.example.ts.net\n", "https://companion.example.ts.net.", "https://companion%2eexample.ts.net",
				"https://companıon.example.ts.net", "https://companion。example.ts.net", "https://-companion.example.ts.net",
				"https://companion-.example.ts.net", "https://companion.ex_ample.ts.net", `https://${"a".repeat(64)}.example.ts.net`,
			]) {
				// Close an unexpectedly accepted app too, keeping red runs resource-safe.
				let error: unknown;
				try { const app = await createGateway({ runtime: path, port, secret, publicOrigin: invalid, assets: join(process.cwd(), "dist/web") }); await app.close(); }
				catch (caught) { error = caught; }
				expect(error, JSON.stringify(invalid)).toBeInstanceOf(Error);
				expect((error as Error).message).toContain("C2_PUBLIC_ORIGIN");
			}
		} finally { rmSync(path, { recursive: true, force: true }); }
	});
	it("preserves exact default loopback origin, non-Secure cookies and absent HSTS despite forwarded HTTPS", async () => {
		const path = runtime(), app = await createGateway({ runtime: path, port, secret, assets: join(process.cwd(), "dist/web") });
		try {
			const pair = await app.inject({ method: "POST", url: "/api/pair", headers: { host, origin, "x-c2-csrf": "pair", "x-forwarded-host": publicHost, "x-forwarded-proto": "https" }, payload: { secret } });
			expect(pair.statusCode).toBe(200);
			expect(pair.headers["set-cookie"]).not.toContain("Secure");
			expect(pair.headers["set-cookie"]).not.toContain("Domain=");
			expect(pair.headers["strict-transport-security"]).toBeUndefined();
			expect((await app.inject({ url: "/", headers: { host: publicHost } })).statusCode).toBe(403);
			expect((await app.inject({ url: "/", headers: { host, origin: publicOrigin } })).statusCode).toBe(403);
		} finally { await app.close(); rmSync(path, { recursive: true, force: true }); }
	});
	it("selects only HTTPS raw Host/Origin, retains pairing/session/CSRF and leased native authority without trusting proxy identity", async () => {
		const path = runtime(), sentTexts: unknown[] = [], bridge = createBridge(path, undefined, text => { sentTexts.push(text); });
		const reg = await bridge.start(context());
		const app = await createGateway({ runtime: path, port, secret, publicOrigin, assets: join(process.cwd(), "dist/web") });
		const spoof = { forwarded: `host=${publicHost};proto=https`, "x-forwarded-host": publicHost, "x-forwarded-proto": "https", "x-forwarded-for": "100.64.0.1", "tailscale-user-login": "owner@example.invalid", "tailscale-user-name": "Owner", "x-c2-capability": reg.capability };
		const pairHeaders = { host: publicHost, origin: publicOrigin, "x-c2-csrf": "pair" };
		const present = (headers: Record<string, string | undefined>) => Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined));
		try {
			for (const headers of [{ ...pairHeaders, origin: undefined }, { ...pairHeaders, origin }, { ...pairHeaders, "x-c2-csrf": undefined }])
				expect((await app.inject({ method: "POST", url: "/api/pair", headers: present(headers), payload: { secret } })).statusCode).toBe(403);
			expect((await app.inject({ method: "POST", url: "/api/pair", headers: { ...pairHeaders, host, ...spoof }, payload: { secret } })).statusCode).toBe(403);
			expect((await app.inject({ method: "POST", url: "/api/pair", headers: { ...pairHeaders, ...spoof }, payload: { secret: "wrong" } })).statusCode).toBe(401);
			const pair = await app.inject({ method: "POST", url: "/api/pair", headers: pairHeaders, payload: { secret } });
			expect(pair.statusCode).toBe(200);
			const setCookie = String(pair.headers["set-cookie"]);
			for (const flag of ["Secure", "HttpOnly", "SameSite=Strict", "Path=/"]) expect(setCookie).toContain(flag);
			expect(setCookie).not.toContain("Domain=");
			expect(pair.headers["strict-transport-security"]).toBe("max-age=31536000");
			const cookie = setCookie.split(";")[0], headers = { host: publicHost, cookie };
			const selected = `?instance=${reg.instance}&generation=${reg.generation}`;
			const snapshot = (await app.inject({ url: "/api/snapshot" + selected, headers })).json().snapshot;
			const image = snapshot.items[0].blocks.find((b: { type: string }) => b.type === "image");
			const mediaUrl = `/api/media/${reg.instance}/${reg.generation}/${image.ref}`;
			for (const url of ["/", "/api/snapshot", "/api/events", mediaUrl]) {
				for (const badHost of [host, "localhost", "evil.invalid", publicHost.toUpperCase(), publicHost + ":443", publicHost + ".", publicHost + ",evil.invalid", "user@" + publicHost, ""]) {
					const denied = await app.inject({ url, headers: { ...headers, host: badHost, ...spoof } });
					expect(denied.statusCode, `${url} ${badHost}`).toBe(403);
				}
				for (const badOrigin of [origin, "https://evil.invalid", publicOrigin + "/", publicOrigin + ":443", "null"])
					expect((await app.inject({ url, headers: { ...headers, origin: badOrigin, ...spoof } })).statusCode).toBe(403);
			}
			for (const url of ["/api/snapshot", "/api/events", mediaUrl])
				for (const invalidCookie of ["", "c2=" + "0".repeat(64)])
					expect((await app.inject({ url, headers: { host: publicHost, cookie: invalidCookie, ...spoof } })).statusCode).toBe(401);
			for (const url of ["/", "/api/snapshot", mediaUrl]) {
				const response = await app.inject({ url, headers: { ...headers, "x-forwarded-host": "evil.invalid", "x-forwarded-proto": "http" } });
				expect(response.statusCode).toBe(200);
				expect(response.headers["strict-transport-security"]).toBe("max-age=31536000");
				expect(response.headers["access-control-allow-origin"]).toBeUndefined();
				expect(response.headers["content-security-policy"]).toContain("img-src 'self' blob:");
			}
			expect((await app.inject({ url: mediaUrl, headers })).rawPayload).toEqual(png);
			for (const url of ["/api/control", "/api/text", "/api/image", "/api/stop", "/api/question-reply"]) {
				for (const override of [{ origin: undefined }, { origin }, { "x-c2-csrf": undefined }, { host }, { origin: "https://evil.invalid" }])
					expect((await app.inject({ method: "POST", url, headers: present({ ...headers, origin: publicOrigin, "x-c2-csrf": "input", ...spoof, ...override }), payload: {} })).statusCode).toBe(403);
				expect((await app.inject({ method: "POST", url, headers: { host: publicHost, origin: publicOrigin, "x-c2-csrf": "input", ...spoof }, payload: {} })).statusCode).toBe(401);
			}
			const mutationHeaders = { ...headers, origin: publicOrigin, "x-c2-csrf": "input", "x-forwarded-host": "evil.invalid", "x-forwarded-proto": "http" };
			const identity = { instance: reg.instance, generation: reg.generation };
			const claim = await app.inject({ method: "POST", url: "/api/control", headers: mutationHeaders, payload: { ...identity, action: "claim" } });
			expect(claim.statusCode).toBe(200);
			const input = { ...identity, requestId: "a".repeat(32), lease: claim.json().lease, text: "HTTPS boundary fixture" };
			expect((await app.inject({ method: "POST", url: "/api/text", headers: mutationHeaders, payload: { ...input, lease: "0".repeat(64) } })).statusCode).toBe(409);
			const sent = await app.inject({ method: "POST", url: "/api/text", headers: mutationHeaders, payload: input });
			expect(sent.statusCode).toBe(200); expect(sent.json().status).toBe("dispatched");
			await bridge.start(context());
			expect((await app.inject({ method: "POST", url: "/api/text", headers: mutationHeaders, payload: input })).statusCode).toBe(409);
			expect(sentTexts).toEqual(["HTTPS boundary fixture"]);
			const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now + 8 * 60 * 60 * 1000 + 1);
			try { expect((await app.inject({ url: "/api/snapshot", headers })).statusCode).toBe(401); }
			finally { clock.mockRestore(); }
		} finally { await app.close(); await bridge.close(); rmSync(path, { recursive: true, force: true }); }
	});
});

describe("public gateway", () => {
	it("denies unauthorized/cross-site and arbitrary file/remote media; authenticates and streams native bytes", async () => {
		const path = runtime(),
			bridge = createBridge(path);
		await bridge.start(context());
		const app = await createGateway({
			runtime: path,
			port,
			secret,
			assets: join(process.cwd(), "dist/web"),
		});
		try {
			for (const url of ["/api/snapshot", "/api/events", "/api/media/a/b/c"])
				expect((await app.inject({ url, headers: { host } })).statusCode).toBe(
					401,
				);
			for (const headers of [
				{ host: "localhost:" + port },
				{ host, origin: "https://evil.invalid" },
				{ host, "sec-fetch-site": "cross-site" },
			])
				expect(
					(await app.inject({ url: "/api/snapshot", headers })).statusCode,
				).toBe(403);
			expect(
				(
					await app.inject({
						method: "POST",
						url: "/api/pair",
						headers: { host },
						payload: { secret },
					})
				).statusCode,
			).toBe(403);
			expect(
				(
					await app.inject({
						method: "POST",
						url: "/api/pair",
						headers: { host, origin, "x-c2-csrf": "pair" },
						payload: { secret: "bad" },
					})
				).statusCode,
			).toBe(401);
			expect(
				(
					await app.inject({
						method: "POST",
						url: "/api/pair",
						headers: { host, origin, "x-c2-csrf": "pair" },
						payload: { secret: "x".repeat(2048) },
					})
				).statusCode,
			).toBe(413);
			const auth = await app.inject({
				method: "POST",
				url: "/api/pair",
				headers: { host, origin, "x-c2-csrf": "pair" },
				payload: { secret },
			});
			expect(auth.statusCode).toBe(200);
			expect(auth.headers["set-cookie"]).toContain("HttpOnly");
			expect(auth.headers["set-cookie"]).toContain("SameSite=Strict");
			const cookie = String(auth.headers["set-cookie"]).split(";")[0],
				headers = { host, cookie };
			const live = (await app.inject({ url: "/api/snapshot", headers })).json();
			const choice = live.sessions[0];
			const response = await app.inject({
				url: `/api/snapshot?instance=${choice.instance}&generation=${choice.generation}`,
				headers,
			});
			expect(response.statusCode).toBe(200);
			expect(response.headers["cache-control"]).toBe("no-store");
			expect(response.headers["content-security-policy"]).toContain(
				"object-src 'none'",
			);
			const snapshot = response.json().snapshot,
				block = snapshot.items[0].blocks.find(
					(block: { type: string }) => block.type === "image",
				);
			const url = `/api/media/${snapshot.instance}/${snapshot.generation}/${block.ref}`;
			expect(
				(
					await app.inject({
						url: url + "?path=/private/native.jsonl",
						headers,
					})
				).statusCode,
			).toBe(400);
			const media = await app.inject({ url, headers });
			expect(media.rawPayload).toEqual(png);
			expect(media.headers["content-type"]).toBe("image/png");
			expect(media.headers["x-content-type-options"]).toBe("nosniff");
			expect(
				(
					await app.inject({
						url: url.replace(snapshot.generation, "e".repeat(32)),
						headers,
					})
				).statusCode,
			).toBe(410);
			for (const url of [
				"/api/media/../../etc/passwd",
				"/api/media?path=/etc/passwd",
				"/api/media?url=https://example.invalid/a.png",
			])
				expect((await app.inject({ url, headers })).statusCode).not.toBe(200);
		} finally {
			await app.close();
			await bridge.close();
			rmSync(path, { recursive: true, force: true });
		}
	});
	it("lists multiple authenticated owners without implicitly fetching or selecting details", async () => {
		const path = runtime(),
			one = createBridge(path),
			two = createBridge(path);
		await one.start(context());
		await two.start(context());
		const app = await createGateway({
			runtime: path,
			port,
			secret,
			assets: join(process.cwd(), "dist/web"),
		});
		try {
			const pair = await app.inject({
				method: "POST",
				url: "/api/pair",
				headers: { host, origin, "x-c2-csrf": "pair" },
				payload: { secret },
			});
			const res = await app.inject({
				url: "/api/snapshot",
				headers: {
					host,
					cookie: String(pair.headers["set-cookie"]).split(";")[0],
				},
			});
			expect(res.json().connection).toBe("disconnected");
			expect(res.json().sessions).toHaveLength(2);
			expect(res.json().snapshot).toBeUndefined();
			expect(
				res.json().sessions.every((s: { conflict: boolean }) => !s.conflict),
			).toBe(true);
		} finally {
			await app.close();
			await one.close();
			await two.close();
			rmSync(path, { recursive: true, force: true });
		}
	});
});

describe("C3 authenticated selection and native ownership", () => {
	it("keeps unselected discovery lightweight, rejects stale/schema/crosssite selection and isolates identical native image IDs", async () => {
		const path = runtime(),
			one = createBridge(path),
			two = createBridge(path);
		const a = context(png, "Owner A"),
			b = context(png, "Owner B");
		let readsA = 0,
			readsB = 0;
		const branchA = a.sessionManager.getBranch,
			branchB = b.sessionManager.getBranch;
		a.sessionManager.getBranch = () => {
			readsA++;
			return branchA();
		};
		b.sessionManager.getBranch = () => {
			readsB++;
			return branchB();
		};
		const first = await one.start(a);
		const app = await createGateway({
			runtime: path,
			port,
			secret,
			assets: join(process.cwd(), "dist/web"),
			pollMs: 20,
		});
		try {
			const auth = await app.inject({
				method: "POST",
				url: "/api/pair",
				headers: { host, origin, "x-c2-csrf": "pair" },
				payload: { secret },
			});
			const headers = {
				host,
				cookie: String(auth.headers["set-cookie"]).split(";")[0],
			};
			expect(readsA).toBe(0);
			const second = await two.start(b); // Bridge starts after gateway.
			await expect
				.poll(
					async () =>
						(await app.inject({ url: "/api/snapshot", headers })).json()
							.sessions.length,
				)
				.toBe(2);
			expect([readsA, readsB]).toEqual([0, 0]);
			const query = (p: typeof first) =>
				`?instance=${p.instance}&generation=${p.generation}`;
			const sameReaders = await Promise.all([
				app.inject({ url: "/api/snapshot" + query(first), headers }),
				app.inject({ url: "/api/snapshot" + query(first), headers }),
			]);
			const av = sameReaders[0].json();
			expect(sameReaders[1].json()).toEqual(av);
			expect(readsA).toBe(1);
			expect(readsB).toBe(0);
			const bv = (
				await app.inject({ url: "/api/snapshot" + query(second), headers })
			).json();
			expect(av.snapshot.items[0].blocks[0].text).toBe("Owner A");
			expect(bv.snapshot.items[0].blocks[0].text).toBe("Owner B");
			expect(av.snapshot.items[0].id).not.toBe(bv.snapshot.items[0].id);
			const imageA = av.snapshot.items[0].blocks.find(
				(x: { type: string }) => x.type === "image",
			);
			const imageB = bv.snapshot.items[0].blocks.find(
				(x: { type: string }) => x.type === "image",
			);
			expect(imageA.ref).not.toBe(imageB.ref);
			expect(
				(
					await app.inject({
						url: `/api/media/${second.instance}/${second.generation}/${imageA.ref}`,
						headers,
					})
				).statusCode,
			).toBe(410);
			for (const url of [
				"/api/snapshot?instance=" + first.instance,
				"/api/events?generation=" + first.generation,
				"/api/snapshot" + query(first) + "&path=/private/native.jsonl",
				"/api/events?instance=invalid&generation=invalid",
			]) {
				expect((await app.inject({ url, headers })).statusCode).toBe(400);
			}
			for (const url of [
				"/api/snapshot" + query(first),
				"/api/events" + query(first),
				`/api/media/${first.instance}/${first.generation}/${imageA.ref}`,
			]) {
				expect((await app.inject({ url, headers: { host } })).statusCode).toBe(
					401,
				);
				expect(
					(
						await app.inject({
							url,
							headers: { ...headers, "sec-fetch-site": "cross-site" },
						})
					).statusCode,
				).toBe(403);
			}
			const replacement = await one.start(context(png, "Replacement"));
			await expect
				.poll(
					async () =>
						(await app.inject({ url: "/api/snapshot", headers }))
							.json()
							.sessions.find(
								(s: { instance: string }) => s.instance === first.instance,
							)?.generation,
				)
				.toBe(replacement.generation);
			const stale = (
				await app.inject({ url: "/api/snapshot" + query(first), headers })
			).json();
			expect(stale.connection).toBe("disconnected");
			expect(stale.snapshot).toBeUndefined();
			expect(stale.selected).toEqual({
				instance: first.instance,
				generation: first.generation,
			});
			expect(
				(
					await app.inject({
						url: `/api/media/${first.instance}/${first.generation}/${imageA.ref}`,
						headers,
					})
				).statusCode,
			).toBe(410);
			expect(
				(
					await app.inject({ url: "/api/snapshot" + query(second), headers })
				).json().snapshot.items[0].id,
			).toBe(bv.snapshot.items[0].id);
			await one.close();
			await expect
				.poll(
					async () =>
						(await app.inject({ url: "/api/snapshot", headers })).json()
							.sessions.length,
				)
				.toBe(1);
			expect(
				(
					await app.inject({
						url: "/api/snapshot" + query(replacement),
						headers,
					})
				).json().snapshot,
			).toBeUndefined();
		} finally {
			await app.close();
			await one.close();
			await two.close();
			rmSync(path, { recursive: true, force: true });
		}
	});
	it("marks duplicate canonical public-context session files only for reachable owners and never publishes private metadata", async () => {
		const path = runtime(),
			one = createBridge(path),
			two = createBridge(path);
		const native = join(path, "private-native-session.jsonl"),
			alias = join(path, "private-alias.jsonl");
		writeFileSync(native, "native fixture, not parsed", { mode: 0o600 });
		symlinkSync(native, alias);
		const a = context(),
			b = context();
		a.sessionManager.getSessionFile = () => native;
		b.sessionManager.getSessionFile = () => alias;
		const first = await one.start(a),
			second = await two.start(b);
		const app = await createGateway({
			runtime: path,
			port,
			secret,
			assets: join(process.cwd(), "dist/web"),
			pollMs: 20,
		});
		try {
			const pair = await app.inject({
				method: "POST",
				url: "/api/pair",
				headers: { host, origin, "x-c2-csrf": "pair" },
				payload: { secret },
			});
			const headers = {
				host,
				cookie: String(pair.headers["set-cookie"]).split(";")[0],
			};
			const list = await app.inject({ url: "/api/snapshot", headers });
			expect(
				list.json().sessions.every((s: { conflict: boolean }) => s.conflict),
			).toBe(true);
			const selected = await app.inject({
				url: `/api/snapshot?instance=${first.instance}&generation=${first.generation}`,
				headers,
			});
			expect(selected.json().conflict).toBe(true);
			expect(selected.json().snapshot.items).toHaveLength(1);
			for (const response of [list, selected])
				for (const privateValue of [
					native,
					alias,
					path,
					first.capability,
					second.capability,
					"canonicalSession",
				])
					expect(response.body).not.toContain(privateValue);
			await two.close();
			// An apparently valid stale registration cannot keep ownership conflict alive.
			writeFileSync(
				join(path, `b-${second.instance}.json`),
				JSON.stringify(second),
				{ mode: 0o600 },
			);
			await expect
				.poll(
					async () =>
						(await app.inject({ url: "/api/snapshot", headers })).json()
							.sessions,
				)
				.toEqual([
					expect.objectContaining({
						instance: first.instance,
						conflict: false,
					}),
				]);
		} finally {
			await app.close();
			await one.close();
			await two.close();
			rmSync(path, { recursive: true, force: true });
		}
	});
});

describe("C4-A generation-owned text and browser control", () => {
	it("preserves authored lone-surrogate identity across native UDS receipt retries", async () => {
		const path = runtime(),
			calls: string[] = [],
			bridge = createBridge(path, undefined, (text) => calls.push(String(text)));
		try {
			const registration = await bridge.start(context());
			const { sendText } = await import("../src/gateway/peer.js");
			const body = {
				instance: registration.instance,
				generation: registration.generation,
				requestId: "a".repeat(32),
				text: "\ud800",
			};
			const receipt = await sendText(path, registration, body);
			expect(receipt).toEqual({
				requestId: body.requestId,
				status: "dispatched",
				reason: "outcome-unconfirmed",
			});
			expect(await sendText(path, registration, body)).toEqual(receipt);
			expect(calls).toEqual([body.text]);
			for (const text of ["\ud801", "\ufffd"]) {
				expect(await sendText(path, registration, { ...body, text })).toEqual({
					requestId: body.requestId,
					status: "rejected",
					reason: "mismatch",
				});
				expect(calls).toEqual([body.text]);
			}
		} finally {
			await bridge.close();
			rmSync(path, { recursive: true, force: true });
		}
	});

	it("deduplicates native IDs without eviction, rejects mismatches/busy/stale and records uncertainty after a throw", async () => {
		const path = runtime(),
			calls: string[] = [],
			ctx = context();
		const bridge = createBridge(path, undefined, (text, options) => {
			expect(options).toEqual({ expandPromptTemplates: false });
			calls.push(String(text));
			if (text === "throw") throw Error("synthetic post-attempt failure");
		});
		try {
			const registration = await bridge.start(ctx);
			const { sendText } = await import("../src/gateway/peer.js");
			const raw = (payload: string, headers: Record<string, string> = {}) =>
				new Promise<number>((resolve, reject) => {
					const req = request(
						{
							socketPath: join(path, `b-${registration.generation}.sock`),
							path: "/text",
							method: "POST",
							headers: {
								"x-c2-capability": registration.capability,
								"content-type": "application/json",
								...headers,
							},
						},
						(res) => {
							res.resume();
							res.on("end", () => resolve(res.statusCode!));
						},
					);
					req.on("error", reject);
					req.end(payload);
				});
			expect(await raw("{}", { "x-c2-capability": "0".repeat(64) })).toBe(401);
			expect(await raw("{}", { "content-type": "text/plain" })).toBe(400);
			expect(await raw("{")).toBe(400);
			expect(await raw("{}")).toBe(400);
			expect(await raw("x".repeat(100001))).toBe(413);
			expect(calls).toEqual([]);

			const body = {
				instance: registration.instance,
				generation: registration.generation,
				requestId: "a".repeat(32),
				text: "/not-a-command",
			};
			expect((await sendText(path, registration, body)).status).toBe(
				"dispatched",
			);
			expect((await sendText(path, registration, body)).status).toBe(
				"dispatched",
			);
			expect(calls).toEqual(["/not-a-command"]);
			expect(
				(await sendText(path, registration, { ...body, text: "different" }))
					.reason,
			).toBe("mismatch");
			ctx.isIdle = () => false;
			expect(
				(
					await sendText(path, registration, {
						...body,
						requestId: "b".repeat(32),
					})
				).reason,
			).toBe("busy");
			ctx.isIdle = () => true;
			ctx.hasPendingMessages = () => true;
			expect(
				(
					await sendText(path, registration, {
						...body,
						requestId: "b".repeat(32),
					})
				).reason,
			).toBe("busy");
			ctx.hasPendingMessages = () => false;
			expect(
				(
					await sendText(path, registration, {
						...body,
						generation: "c".repeat(32),
					})
				).reason,
			).toBe("stale");
			expect(
				(
					await sendText(path, registration, {
						...body,
						requestId: "b".repeat(32),
						text: "different busy payload",
					})
				).reason,
			).toBe("mismatch");
			const thrown = { ...body, requestId: "e".repeat(32), text: "throw" };
			expect((await sendText(path, registration, thrown)).status).toBe(
				"uncertain",
			);
			expect((await sendText(path, registration, thrown)).status).toBe(
				"uncertain",
			);
			for (let i = 0; i < 253; i++)
				expect(
					(
						await sendText(path, registration, {
							...body,
							requestId: i.toString(16).padStart(32, "0"),
						})
					).status,
				).toBe("dispatched");
			expect(
				(
					await sendText(path, registration, {
						...body,
						requestId: "d".repeat(32),
					})
				).reason,
			).toBe("ledger-full");
			expect((await sendText(path, registration, body)).status).toBe(
				"dispatched",
			);
			expect(calls.length).toBe(255);
			const next = await bridge.start(ctx);
			await expect(sendText(path, registration, body)).rejects.toThrow();
			expect(
				(await sendText(path, next, { ...body, generation: next.generation }))
					.status,
			).toBe("dispatched");
			expect(calls.length).toBe(256);
		} finally {
			await bridge.close();
			rmSync(path, { recursive: true, force: true });
		}
	});

	it("gates every mutation, separates same-cookie holders, serializes admission, and recovers dedup after gateway restart", async () => {
		const path = runtime(),
			calls: string[] = [],
			ctx = context();
		const bridge = createBridge(path, undefined, (text) =>
			calls.push(String(text)),
		);
		const reg = await bridge.start(ctx);
		let app = await createGateway({
			runtime: path,
			port,
			secret,
			assets: join(process.cwd(), "dist/web"),
		});
		const identity = { instance: reg.instance, generation: reg.generation };
		const pair = async () =>
			String(
				(
					await app.inject({
						method: "POST",
						url: "/api/pair",
						headers: { host, origin, "x-c2-csrf": "pair" },
						payload: { secret },
					})
				).headers["set-cookie"],
			).split(";")[0];
		let cookie = await pair();
		const post = (
			url: string,
			payload: Record<string, unknown>,
			overrides: Record<string, string | undefined> = {},
		) =>
			app.inject({
				method: "POST",
				url,
				headers: { host, origin, cookie, "x-c2-csrf": "input", ...overrides },
				payload,
			});
		try {
			const claim = { ...identity, action: "claim" };
			for (const headers of [
				{ cookie: "" },
				{ origin: "http://evil.invalid" },
				{ origin: "" },
				{ "x-c2-csrf": "" },
				{ host: "localhost:" + port },
			]) {
				for (const url of ["/api/control", "/api/text"])
					expect((await post(url, claim, headers)).statusCode).not.toBe(200);
			}
			expect(
				(await post("/api/control", { ...claim, secret: "not-allowed" }))
					.statusCode,
			).toBe(400);
			expect(
				(await post("/api/control?lease=forbidden", claim)).statusCode,
			).toBe(400);
			expect(
				(await post("/api/control?", claim, { "x-c2-csrf": "" })).statusCode,
			).toBe(403);
			expect(
				(await post("/api/text?", claim, { "x-c2-csrf": "" })).statusCode,
			).toBe(403);
			const first = (await post("/api/control", claim)).json();
			expect(first.lease).toMatch(/^[a-f0-9]{64}$/);
			expect((await post("/api/control", claim)).statusCode).toBe(409); // Same cookie is not authority.
			const input = {
				...identity,
				lease: first.lease,
				requestId: "a".repeat(32),
				text: "authored text",
			};
			expect(
				(await post("/api/text", { ...input, text: "x".repeat(16001) }))
					.statusCode,
			).toBe(400);
			expect(
				(await post("/api/text", { ...input, text: "x".repeat(100001) }))
					.statusCode,
			).toBe(413);
			expect(
				(await post("/api/text", { ...input, text: " " })).statusCode,
			).toBe(409);
			expect(
				(await post("/api/text", { ...input, extra: true })).statusCode,
			).toBe(400);
			expect(
				(await post("/api/text", { ...input, lease: "0".repeat(64) }))
					.statusCode,
			).toBe(409);
			const two = (
				await post("/api/control", { ...identity, action: "takeover" })
			).json();
			expect(two.lease).not.toBe(first.lease);
			expect((await post("/api/text", input)).statusCode).toBe(409);
			expect(
				(
					await post("/api/control", {
						...identity,
						action: "renew",
						lease: first.lease,
					})
				).statusCode,
			).toBe(409);
			for (const action of ["renew", "release"])
				expect(
					(
						await post("/api/control", {
							...identity,
							action,
							lease: two.revision.padEnd(64, "0"),
						})
					).statusCode,
				).toBe(409);
			expect(
				(
					await post("/api/text", {
						...input,
						lease: two.revision.padEnd(64, "0"),
					})
				).statusCode,
			).toBe(409);
			const body = { ...input, lease: two.lease };
			const concurrent = await Promise.all([
				post("/api/text", body),
				post("/api/text", { ...body, requestId: "b".repeat(32) }),
			]);
			expect(concurrent.map((r) => r.statusCode).sort()).toEqual([200, 429]);
			expect(calls).toHaveLength(1);
			expect((await post("/api/text", body)).json().status).toBe("dispatched");
			expect(calls).toHaveLength(1);
			const publicView = await app.inject({
				url: `/api/snapshot?instance=${reg.instance}&generation=${reg.generation}`,
				headers: { host, cookie },
			});
			expect(publicView.json().controller.held).toBe(true);
			for (const privateValue of [
				first.lease,
				two.lease,
				cookie.split("=")[1],
				reg.capability,
				"capability",
			])
				expect(publicView.body).not.toContain(privateValue);
			expect(
				(
					await post("/api/control", {
						...identity,
						action: "release",
						lease: two.lease,
					})
				).statusCode,
			).toBe(200);
			expect((await post("/api/text", body)).statusCode).toBe(409);
			const beforeRestart = (await post("/api/control", claim)).json();
			await app.close();
			app = await createGateway({
				runtime: path,
				port,
				secret,
				assets: join(process.cwd(), "dist/web"),
			});
			expect(
				(await post("/api/text", { ...body, lease: beforeRestart.lease }))
					.statusCode,
			).toBe(401);
			cookie = await pair();
			expect(
				(await post("/api/text", { ...body, lease: beforeRestart.lease }))
					.statusCode,
			).toBe(409);
			const fresh = (await post("/api/control", claim)).json();
			expect(
				(await post("/api/text", { ...body, lease: fresh.lease })).json()
					.status,
			).toBe("dispatched");
			expect(calls).toHaveLength(1); // Native bridge, not gateway dedup, owns this receipt.
		} finally {
			await app.close();
			await bridge.close();
			rmSync(path, { recursive: true, force: true });
		}
	});

	it("freshly rejects canonical conflict, stale generation and unreachable owner without native dispatch", async () => {
		const path = runtime(),
			calls: string[] = [],
			ctx = context(),
			otherCtx = context();
		const file = join(path, "private-native.jsonl");
		writeFileSync(file, "fixture", { mode: 0o600 });
		ctx.sessionManager.getSessionFile = () => file;
		otherCtx.sessionManager.getSessionFile = () => file;
		const bridge = createBridge(path, undefined, (text) =>
				calls.push(String(text)),
			),
			other = createBridge(path);
		const reg = await bridge.start(ctx);
		const app = await createGateway({
			runtime: path,
			port,
			secret,
			assets: join(process.cwd(), "dist/web"),
			pollMs: 60_000,
		});
		try {
			const pair = await app.inject({
				method: "POST",
				url: "/api/pair",
				headers: { host, origin, "x-c2-csrf": "pair" },
				payload: { secret },
			});
			const headers = {
				host,
				origin,
				cookie: String(pair.headers["set-cookie"]).split(";")[0],
				"x-c2-csrf": "input",
			};
			const identity = { instance: reg.instance, generation: reg.generation };
			const claim = () =>
				app.inject({
					method: "POST",
					url: "/api/control",
					headers,
					payload: { ...identity, action: "claim" },
				});
			const lease = (await claim()).json().lease;
			const send = () =>
				app.inject({
					method: "POST",
					url: "/api/text",
					headers,
					payload: {
						...identity,
						lease,
						text: "never dispatch",
						requestId: "a".repeat(32),
					},
				});
			await other.start(otherCtx); // Gateway's periodic cache has not discovered this conflict.
			expect((await send()).statusCode).toBe(409);
			expect((await claim()).statusCode).toBe(409);
			await other.close();
			await bridge.start(ctx);
			expect((await send()).statusCode).toBe(409);
			expect((await claim()).statusCode).toBe(409);
			await bridge.close();
			expect((await send()).statusCode).toBe(409);
			expect(calls).toEqual([]);
		} finally {
			await app.close();
			await bridge.close();
			await other.close();
			rmSync(path, { recursive: true, force: true });
		}
	});

	it("rechecks an expired lease after fresh asynchronous reachability before forwarding", async () => {
		const { vi } = await import("vitest");
		const path = runtime(),
			calls: string[] = [],
			ctx = context();
		const bridge = createBridge(path, undefined, (text) =>
			calls.push(String(text)),
		);
		const reg = await bridge.start(ctx);
		const app = await createGateway({
			runtime: path,
			port,
			secret,
			assets: join(process.cwd(), "dist/web"),
			pollMs: 60_000,
		});
		let clock = Date.now();
		const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);
		try {
			const pair = await app.inject({
				method: "POST",
				url: "/api/pair",
				headers: { host, origin, "x-c2-csrf": "pair" },
				payload: { secret },
			});
			const headers = {
				host,
				origin,
				cookie: String(pair.headers["set-cookie"]).split(";")[0],
				"x-c2-csrf": "input",
			};
			const identity = { instance: reg.instance, generation: reg.generation };
			const lease = (
				await app.inject({
					method: "POST",
					url: "/api/control",
					headers,
					payload: { ...identity, action: "claim" },
				})
			).json();
			ctx.isIdle = () => {
				clock = lease.expires + 1;
				return true;
			}; // Native status read occurs inside awaited fresh discovery.
			expect(
				(
					await app.inject({
						method: "POST",
						url: "/api/text",
						headers,
						payload: {
							...identity,
							lease: lease.lease,
							requestId: "a".repeat(32),
							text: "must not dispatch",
						},
					})
				).statusCode,
			).toBe(409);
			expect(
				(
					await app.inject({
						method: "POST",
						url: "/api/control",
						headers,
						payload: { ...identity, action: "renew", lease: lease.lease },
					})
				).statusCode,
			).toBe(409);
			expect(calls).toEqual([]);
		} finally {
			spy.mockRestore();
			await app.close();
			await bridge.close();
			rmSync(path, { recursive: true, force: true });
		}
	});

	it("bounds lease records/operation admission, explicit renewal cannot revive expiry, and unrelated owners stay independent", async () => {
		const { controllers } = await import("../src/gateway/controller.js");
		const { vi } = await import("vitest");
		const policy = controllers(),
			now = Date.now();
		let clock = now;
		const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);
		const identity = { instance: "a".repeat(32), generation: "b".repeat(32) };
		try {
			const first = policy.change({ ...identity, action: "claim" }, "cookie")!;
			expect(policy.valid(identity, "other-cookie", first.lease!)).toBe(false);
			const taken = policy.change(
				{ ...identity, action: "takeover" },
				"cookie",
			)!;
			expect(taken.expires).toBe(first.expires);
			expect(taken.revision).not.toBe(first.revision);
			expect(policy.valid(identity, "cookie", first.lease!)).toBe(false);
			clock += 10_000;
			expect(
				policy.change(
					{ ...identity, action: "renew", lease: taken.lease! },
					"cookie",
				)!.expires,
			).toBe(clock + 60_000);
			clock += 60_001;
			expect(policy.valid(identity, "cookie", first.lease!)).toBe(false);
			expect(
				policy.change(
					{ ...identity, action: "renew", lease: taken.lease! },
					"cookie",
				),
			).toBeUndefined();
			for (let i = 0; i < 32; i++) {
				const instance = i.toString(16).padStart(32, "0");
				expect(policy.enter(instance)).toBe(true);
				expect(
					policy.change(
						{ instance, generation: identity.generation, action: "claim" },
						"cookie",
					),
				).toBeDefined();
			}
			expect(policy.enter(identity.instance)).toBe(false);
			expect(policy.enter("0".repeat(32))).toBe(false);
			expect(
				policy.change({ ...identity, action: "claim" }, "cookie"),
			).toBeUndefined();
			policy.leave("0".repeat(32));
			expect(policy.enter(identity.instance)).toBe(true);
			policy.reconcile([], new Map([["cookie", clock + 1]]));
			expect(policy.project(identity).held).toBe(false);
		} finally {
			spy.mockRestore();
			policy.clear();
		}
	});
});

describe("C4-B original authoring and image admission", () => {
	it("honors omitted native blockImages defaults through authenticated UDS while rejecting unknown settings", async () => {
		const path = runtime(), calls: unknown[] = [];
		const cases: { name: string; getter?: () => unknown; reason?: string }[] = [
			{ name: "omitted images", getter: () => ({}) },
			{ name: "omitted block with native autoResize", getter: () => ({ images: { autoResize: false } }) },
			{ name: "empty images", getter: () => ({ images: {} }) },
			{ name: "explicit false", getter: () => ({ images: { blockImages: false } }) },
			{ name: "optional undefined block", getter: () => ({ images: { blockImages: undefined } }) },
			{ name: "explicit true", getter: () => ({ images: { blockImages: true } }), reason: "images-blocked" },
			{ name: "unavailable getter", reason: "image-policy-unknown" },
			{ name: "throwing getter", getter: () => { throw Error("fixture getter failed"); }, reason: "image-policy-unknown" },
			...[undefined, null, false, 0, "settings", [], new Date(), { images: null }, { images: false }, { images: 0 }, { images: "images" }, { images: [] }, { images: new Map() }, { images: { blockImages: null } }, { images: { blockImages: "false" } }, { images: { blockImages: 0 } }, { images: { blockImages: [] } }].map((snapshot, index) => ({ name: `malformed snapshot ${index}`, getter: () => snapshot, reason: "image-policy-unknown" })),
		];
		try {
			for (const testCase of cases) {
				const bridge = createBridge(path, undefined, (content) => { calls.push(content); }, testCase.getter as Parameters<typeof createBridge>[3]);
				try {
					const reg = await bridge.start(context());
					const body = { instance: reg.instance, generation: reg.generation, requestId: "d".repeat(32), text: "", mime: "image/png" as const, image: png.toString("base64"), sourceDigest: "e".repeat(64) };
					const before = calls.length, receipt = await sendImage(path, reg, body);
					expect(receipt.status, testCase.name).toBe(testCase.reason ? "rejected" : "dispatched");
					expect(receipt.reason, testCase.name).toBe(testCase.reason ?? "outcome-unconfirmed");
					expect(await sendImage(path, reg, body), testCase.name).toEqual(receipt);
					expect(calls.length - before, testCase.name).toBe(testCase.reason ? 0 : 1);
				} finally { await bridge.close(); }
			}
		} finally { rmSync(path, { recursive: true, force: true }); }
	});

	it("uses one native ledger for image/raw identity and text kinds, checks current model/effective settings only for new attempts", async () => {
		const path = runtime(), ctx = context(), calls: unknown[] = [];
		let blocked: boolean | undefined = false;
		const bridge = createBridge(path, undefined, (content, options) => { expect(options).toEqual({ expandPromptTemplates: false }); calls.push(content); }, () => ({ images: { blockImages: blocked } }));
		try {
			const reg = await bridge.start(ctx);
			const body = { instance: reg.instance, generation: reg.generation, requestId: "a".repeat(32), text: "", mime: "image/png" as const, image: png.toString("base64"), sourceDigest: "b".repeat(64) };
			expect((await sendImage(path, reg, body)).status).toBe("dispatched");
			expect(calls).toEqual([[{ type: "image", data: body.image, mimeType: body.mime }]]);
			blocked = true; ctx.isIdle = () => false;
			expect((await sendImage(path, reg, { ...body, image: body.image /* normalized payload is not raw identity */ })).status).toBe("dispatched");
			const text = { instance: reg.instance, generation: reg.generation, requestId: body.requestId, text: "text" };
			expect((await sendText(path, reg, text)).reason).toBe("mismatch");
			for (const change of [{ text: "changed" }, { mime: "image/jpeg" as const }, { sourceDigest: "c".repeat(64) }])
				expect((await sendImage(path, reg, { ...body, ...change })).reason).toBe("mismatch");
			ctx.isIdle = () => true;
			const attempt = (id: string) => sendImage(path, reg, { ...body, requestId: id.repeat(32) });
			expect((await attempt("1")).reason).toBe("images-blocked");
			blocked = false; expect((await attempt("1")).reason).toBe("images-blocked"); // Recovery never upgrades rejection.
			const model = ctx.model; ctx.model = undefined;
			expect((await attempt("2")).reason).toBe("image-policy-unknown");
			ctx.model = { ...model!, input: ["text"] };
			expect((await attempt("3")).reason).toBe("model-no-images");
			ctx.model = model; blocked = undefined;
			expect((await attempt("4")).status).toBe("dispatched"); // Omitted optional field uses Pi's documented default.
			expect((await sendText(path, reg, { ...text, requestId: "5".repeat(32) })).status).toBe("dispatched");
			expect(calls).toHaveLength(3);
			// Actual authenticated fixed UDS rejects malformed normalized payload and unauthorized digest authority.
			const raw = (data: unknown, capability = reg.capability, url = "/image") => new Promise<number>((resolve, reject) => {
				const req = request({ socketPath: join(path, `b-${reg.generation}.sock`), path: url, method: "POST", headers: { "content-type": "application/json", "x-c2-capability": capability } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
				req.on("error", reject); req.end(JSON.stringify(data));
			});
			expect(await raw(body, "0".repeat(64))).toBe(401);
			expect(await raw({ ...body, image: "bad!" })).toBe(400);
			expect(await raw({ ...body, extra: true })).toBe(400);
			expect(await raw(body, reg.capability, "/image?x=1")).toBe(405);
			expect(await raw({ ...body, image: "A".repeat(5_500_001) })).toBe(413);
			expect(calls).toHaveLength(3);
		} finally { await bridge.close(); rmSync(path, { recursive: true, force: true }); }
	});
});

async function imageGatewayFixture() {
	const path = runtime(), ctx = context(), calls: unknown[] = [];
	const bridge = createBridge(path, undefined, (content) => { calls.push(content); }, () => ({ images: { blockImages: false } }));
	const reg = await bridge.start(ctx);
	let app = await createGateway({ runtime: path, port, secret, assets: join(process.cwd(), "dist/web"), pollMs: 60_000 });
	let cookie = "";
	const identity = { instance: reg.instance, generation: reg.generation };
	const headers = () => ({ host, origin, cookie, "x-c2-csrf": "input" });
	const post = (url: string, payload: unknown, overrides: Record<string, string | undefined> = {}) => app.inject({ method: "POST", url, headers: { ...headers(), ...overrides }, payload: payload as never });
	const pair = async () => { cookie = String((await post("/api/pair", { secret }, { "x-c2-csrf": "pair" })).headers["set-cookie"]).split(";")[0]; };
	await pair();
	let lease = (await post("/api/control", { ...identity, action: "claim" })).json().lease;
	const body = () => ({ ...identity, requestId: "a".repeat(32), text: "authored image", source: png.toString("base64"), mime: "image/png", lease });
	return {
		path, ctx, calls, bridge, reg, identity, headers, post, body,
		app: () => app,
		restart: async () => { await app.close(); app = await createGateway({ runtime: path, port, secret, assets: join(process.cwd(), "dist/web"), pollMs: 60_000 }); await pair(); lease = (await post("/api/control", { ...identity, action: "claim" })).json().lease; },
		cleanup: async () => { await app.close(); await bridge.close(); rmSync(path, { recursive: true, force: true }); },
	};
}
describe("C4-B production gateway/UDS", () => {
	it("guards image auth/Host/Origin/CSRF/query/schema/size before decode and preserves original retry across restart", async () => {
		const f = await imageGatewayFixture(), spy = vi.spyOn(sharp.prototype, "metadata");
		try {
			for (const override of [{ cookie: "" }, { host: "localhost:" + port }, { origin: "http://evil.invalid" }, { origin: "" }, { "x-c2-csrf": "" }]) {
				expect((await f.post("/api/image", f.body(), override)).statusCode).not.toBe(200);
			}
			for (const url of ["/api/image?extra=1"]) expect((await f.post(url, f.body())).statusCode, url).toBe(400); // Empty-query framing is checked over real TCP below.
			for (const change of [{ sourceDigest: "b".repeat(64) }, { mime: "image/heic" }, { text: 123 }, { source: 1234 }, { source: "" }, { text: "x".repeat(16001) }, { image: png.toString("base64") }]) expect((await f.post("/api/image", { ...f.body(), ...change })).statusCode).toBe(400);
			expect((await f.post("/api/image", "x".repeat(5_500_001), { "content-type": "application/json" })).statusCode).toBe(413);
			expect((await f.post("/api/image", { ...f.body(), lease: "0".repeat(64) })).statusCode).toBe(409);
			expect(spy).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
			for (const source of [Buffer.from("GIF89a"), Buffer.from("<svg/>"), png.subarray(0, -1), Buffer.from("corrupt")])
				expect((await f.post("/api/image", { ...f.body(), source: source.toString("base64") })).statusCode).toBe(400);
			expect((await f.post("/api/image", { ...f.body(), mime: "image/jpeg" })).statusCode).toBe(400);
			expect(f.calls).toEqual([]);
			const original = f.body(), first = (await f.post("/api/image", original)).json();
			expect(first.status).toBe("dispatched"); expect(f.calls).toHaveLength(1);
			await f.restart();
			expect((await f.post("/api/image", { ...original, lease: f.body().lease })).json()).toEqual(first);
			expect(f.calls).toHaveLength(1);
			// Differing raw EXIF metadata disappears in normalization, but cannot alias authored identity.
			const make = (artist: string) => sharp(png).withExif({ IFD0: { Artist: artist } }).png().toBuffer();
			const a = await make("author-a"), b = await make("author-b");
			const normalizedA = await normalizeImage({ mime: "image/png", source: a.toString("base64") }, () => false);
			const normalizedB = await normalizeImage({ mime: "image/png", source: b.toString("base64") }, () => false);
			expect(normalizedA.image).toBe(normalizedB.image); expect(normalizedA.sourceDigest).not.toBe(normalizedB.sourceDigest);
			expect(Buffer.from(normalizedA.image, "base64").equals(png)).toBe(false); // The later mocked recovery really changes normalized bytes.
			const metadataInput = { ...f.body(), requestId: "b".repeat(32), source: a.toString("base64") };
			expect((await f.post("/api/image", metadataInput)).json().status).toBe("dispatched");
			expect((await f.post("/api/image", { ...metadataInput, source: b.toString("base64") })).json().reason).toBe("mismatch");
			expect((await f.post("/api/image", { ...metadataInput, text: "changed" })).json().reason).toBe("mismatch");
			expect((await f.post("/api/text", { ...f.identity, requestId: metadataInput.requestId, text: "authored image", lease: f.body().lease })).json().reason).toBe("mismatch");
			// A decoder producing different normalized bytes on recovery must not reinvoke public send.
			const output = vi.spyOn(sharp.prototype, "toBuffer").mockImplementationOnce(async () => ({ data: png, info: { width: 1, height: 1 } }) as never);
			try { expect((await f.post("/api/image", metadataInput)).json().status).toBe("dispatched"); } finally { output.mockRestore(); }
			expect(f.calls).toHaveLength(2);
		} finally { spy.mockRestore(); await f.cleanup(); }
	});

	it("reserves the gateway-global image slot before collecting an unfinished body, rejects immediately without queue, and releases departed body", async () => {
		const f = await imageGatewayFixture();
		try {
			await f.app().listen({ host: "127.0.0.1", port });
			const emptyQuery = await new Promise<number>((resolve, reject) => {
				const req = request({ host: "127.0.0.1", port, path: "/api/image?", method: "POST", headers: { ...f.headers(), "content-type": "application/json" } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); }); req.on("error", reject); req.end(JSON.stringify(f.body()));
			});
			expect(emptyQuery).toBe(400);
			const slow = request({ host: "127.0.0.1", port, path: "/api/image", method: "POST", headers: { ...f.headers(), "content-type": "application/json", "content-length": "1000" } });
			slow.on("error", () => {}); slow.write('{"instance":');
			await new Promise((r) => setTimeout(r, 30));
			expect((await f.post("/api/image", f.body())).statusCode).toBe(429);
			expect(f.calls).toEqual([]); slow.destroy();
			await new Promise((r) => setTimeout(r, 30));
			expect((await f.post("/api/image", f.body())).json().status).toBe("dispatched");
			expect(f.calls).toHaveLength(1);
			const expired = request({ host: "127.0.0.1", port, path: "/api/image", method: "POST", headers: { ...f.headers(), "content-type": "application/json", "content-length": "1000" } });
			const deadline = new Promise<void>((resolve) => { expired.on("error", () => {}); expired.on("close", resolve); });
			expired.write('{"instance":');
			await deadline; await new Promise((r) => setTimeout(r, 30));
			expect((await f.post("/api/image", f.body())).json().status).toBe("dispatched");
			expect(f.calls).toHaveLength(1); // Timed-out body never reached the native ledger.
		} finally { await f.cleanup(); }
	}, 10_000);

	it("retains admission through awaited decoder settlement and rejects expiry/takeover/conflict/reload/disconnect/stop without native forwarding", async () => {
		for (const action of ["deadline", "expiry", "cookie-expiry", "takeover", "conflict", "reload", "disconnect", "stop"] as const) {
			const f = await imageGatewayFixture();
			let otherCalls = 0;
			const other = createBridge(f.path, undefined, () => { otherCalls++; });
			let otherIdentity: { instance: string; generation: string } | undefined, otherLease: string | undefined;
			if (action === "deadline") {
				const reg = await other.start(context()); otherIdentity = { instance: reg.instance, generation: reg.generation };
				otherLease = (await f.post("/api/control", { ...otherIdentity, action: "claim" })).json().lease;
			}
			let release!: () => void, started!: () => void;
			const wait = new Promise<void>((r) => { started = r; }), hold = new Promise<void>((r) => { release = r; });
			const phase = ["disconnect", "stop", "cookie-expiry"].includes(action) ? "toBuffer" : "metadata";
			const original = sharp.prototype[phase];
			const stub = vi.spyOn(sharp.prototype, phase).mockImplementationOnce(function(this: Sharp, ...args: unknown[]) { started(); return hold.then(() => (original as Function).apply(this, args)); } as never);
			let clock: ReturnType<typeof vi.spyOn> | undefined, closed: Promise<void> | undefined;
			let response: Promise<unknown>;
			try {
				if (action === "disconnect") {
					await f.app().listen({ host: "127.0.0.1", port });
					let req!: ReturnType<typeof request>;
					response = new Promise((resolve) => { req = request({ host: "127.0.0.1", port, path: "/api/image", method: "POST", headers: { ...f.headers(), "content-type": "application/json" } }, (res) => { res.resume(); res.on("end", resolve); }); req.on("error", resolve); req.end(JSON.stringify(f.body())); });
					await wait; req.destroy(); await response;
				} else { response = f.post("/api/image", f.body()); await wait; }
				expect((await f.post("/api/image", f.body())).statusCode).toBe(429);
				expect((await f.post("/api/text", { ...f.identity, requestId: "c".repeat(32), text: "cannot overlap", lease: f.body().lease })).statusCode).toBe(429);
				if (action === "deadline") {
					expect((await f.post("/api/text", { ...otherIdentity, requestId: "d".repeat(32), text: "unrelated owner remains usable", lease: otherLease })).json().status).toBe("dispatched");
					expect(otherCalls).toBe(1);
				}
				if (action === "deadline") { const now = performance.now(); clock = vi.spyOn(performance, "now").mockReturnValue(now + imageDecodeMs + 1); expect((await f.post("/api/image", f.body())).statusCode).toBe(429); }
				if (action === "expiry" || action === "cookie-expiry") { const now = Date.now(); clock = vi.spyOn(Date, "now").mockReturnValue(now + (action === "expiry" ? 60_001 : 8 * 60 * 60 * 1000 + 1)); }
				if (action === "takeover") {
					// Own operation serializes this owner, so takeover waits nowhere; revoke via expiry after refused overlap.
					expect((await f.post("/api/control", { ...f.identity, action: "takeover" })).statusCode).toBe(429);
					const now = Date.now(); clock = vi.spyOn(Date, "now").mockReturnValue(now + 60_001);
				}
				if (action === "conflict") { const file = join(f.path, "native.jsonl"); writeFileSync(file, "fixture", { mode: 0o600 }); f.ctx.sessionManager.getSessionFile = () => file; const ctx = context(); ctx.sessionManager.getSessionFile = () => file; await other.start(ctx); }
				if (action === "reload") await f.bridge.start(f.ctx);
				if (action === "stop") closed = f.app().close();
				await new Promise((r) => setTimeout(r, 10)); expect(f.calls).toEqual([]);
				release(); await response!; await closed;
				if (action === "disconnect") await new Promise((r) => setTimeout(r, 30));
				expect(f.calls).toEqual([]);
				clock?.mockRestore(); clock = undefined;
				if (["expiry", "cookie-expiry", "conflict", "reload", "takeover"].includes(action)) await f.restart();
				if (["deadline", "disconnect", "expiry", "cookie-expiry", "takeover"].includes(action)) { const next = await f.post("/api/image", f.body()); expect(next.json().status, `${action}: ${next.body}`).toBe("dispatched"); }
			} finally { release(); clock?.mockRestore(); stub.mockRestore(); await other.close(); await f.cleanup(); }
		}
	});
});

describe('C4 questionnaire public observation and fixed leased transport', () => {
 const makeReply = (reg: { instance: string; generation: string }, invocationId = 'controlled-live-invocation', replyId = 'first') => ({ instance: reg.instance, generation: reg.generation, reply: { invocationId, replyId, cancelled: false, answers: [{ questionIndex: 0, kind: 'option' as const, answer: 'Browser' }] } });
 it('rejects entire invalid/oversized observations, projects public fields, never evicts/replaces active, clears only exact closure and guards captured listeners', async () => {
  const path = runtime(), bus = questionBus(), bridge = createBridge(path, undefined, undefined, undefined, bus);
  try {
   const reg = await bridge.start(context());
   const captured = [...bus.handlers.get(questionChannels.request)!][0];
   bus.emit(questionChannels.request, { ...questionRequest(), appended: 'not projected' });
   bus.emit(questionChannels.request, { ...questionRequest(), questions: questionRequest().questions.map(q => ({ ...q, question: 'replacement' })) });
   expect((await readQuestions(path, reg)).pending[0].questions[0].question).toBe('Which surface?');
   expect(JSON.stringify(await readQuestions(path, reg))).not.toContain('not projected');
   for (let n = 1; n <= 4; n++) bus.emit(questionChannels.request, questionRequest(String(n)));
   expect((await readQuestions(path, reg)).pending).toHaveLength(4);
   expect((await readQuestions(path, reg)).terminalOnly).toBe(true);
   bus.emit(questionChannels.closed, { invocationId: 'unknown', reason: 'terminal' });
   bus.emit(questionChannels.closed, { invocationId: '1', reason: 'forged' });
   expect((await readQuestions(path, reg)).pending).toHaveLength(4);
   bus.emit(questionChannels.closed, { invocationId: '1', reason: 'terminal' });
   const bad = questionRequest('bad'); bad.questions[0].question = '😀'.repeat(8001);
   bus.emit(questionChannels.request, bad);
   bus.emit(questionChannels.request, { ...questionRequest('bad2'), appended: 'x'.repeat(65536) });
   bus.emit(questionChannels.request, { ...questionRequest('bad3'), questions: [] });
   expect((await readQuestions(path, reg)).pending).toHaveLength(3);
   const next = await bridge.start(context()); captured(questionRequest('captured-old'));
   expect((await readQuestions(path, next)).pending).toEqual([]);
   expect((await readQuestions(path, next)).terminalOnly).toBe(false);
   await bridge.close(); expect([...bus.handlers.values()].every(set => !set.size)).toBe(true);
  } finally { await bridge.close(); rmSync(path, { recursive: true, force: true }); }
 });
 it('captures synchronous accepted outcome+closure, invalid leaves pending; stale invocation/generation/session never emits; missing outcome stays uncertain with cleanup', async () => {
  const path = runtime(), ctx = context(), bus = questionBus(), bridge = createBridge(path, undefined, undefined, undefined, bus);
  try {
   const reg = await bridge.start(ctx); bus.emit(questionChannels.request, questionRequest());
   let calls = 0, mode = 'invalid';
   const off = bus.on(questionChannels.reply, value => {
    calls++; const reply = value as ReturnType<typeof makeReply>['reply'];
    if (mode === 'lost') { bus.emit(questionChannels.closed, { invocationId: reply.invocationId, reason: 'external' }); return; }
    bus.emit(questionChannels.outcome, { invocationId: reply.invocationId, replyId: reply.replyId, accepted: mode === 'accepted', ...(mode === 'invalid' ? { reason: 'invalid_reply' } : {}) });
    if (mode === 'accepted') bus.emit(questionChannels.closed, { invocationId: reply.invocationId, reason: 'external' });
   });
   ctx.isIdle = () => false; ctx.hasPendingMessages = () => true; // Questionnaire replies do not use native idle/Stop gates.
   expect((await sendQuestionReply(path, reg, makeReply(reg), new AbortController().signal)).status).toBe('invalid');
   expect((await readQuestions(path, reg)).pending).toHaveLength(1);
   expect((await sendQuestionReply(path, reg, makeReply(reg, 'unknown'), new AbortController().signal)).status).toBe('not-pending');
   expect((await sendQuestionReply(path, reg, { ...makeReply(reg), generation: 'e'.repeat(32) }, new AbortController().signal)).status).toBe('not-pending');
   const original = ctx.sessionManager.getSessionId; ctx.sessionManager.getSessionId = () => 'changed';
   expect((await sendQuestionReply(path, reg, makeReply(reg), new AbortController().signal)).status).toBe('not-pending'); ctx.sessionManager.getSessionId = original;
   expect(calls).toBe(1); mode = 'accepted';
   expect((await sendQuestionReply(path, reg, makeReply(reg), new AbortController().signal)).status).toBe('accepted');
   expect((await readQuestions(path, reg)).pending).toEqual([]);
   expect((await sendQuestionReply(path, reg, makeReply(reg), new AbortController().signal)).status).toBe('not-pending');
   bus.emit(questionChannels.request, questionRequest('lost')); mode = 'lost';
   expect((await sendQuestionReply(path, reg, makeReply(reg, 'lost'), new AbortController().signal)).status).toBe('uncertain');
   expect(bus.handlers.get(questionChannels.outcome)?.size).toBe(0);
   bus.emit(questionChannels.request, questionRequest('departed')); off();
   const abort = new AbortController(); const wait = sendQuestionReply(path, reg, makeReply(reg, 'departed'), abort.signal);
   await vi.waitFor(() => expect(bus.handlers.get(questionChannels.outcome)?.size).toBe(1)); abort.abort(); await expect(wait).rejects.toThrow();
   await vi.waitFor(() => expect(bus.handlers.get(questionChannels.outcome)?.size).toBe(0));
   expect((await readQuestions(path, reg)).pending).toHaveLength(1);
  } finally { await bridge.close(); rmSync(path, { recursive: true, force: true }); }
 });
 it('preserves authored null and empty answers through the authenticated gateway and native public bus without coercion', async () => {
  const path = runtime(), bus = questionBus(), bridge = createBridge(path, undefined, undefined, undefined, bus);
  let app: Awaited<ReturnType<typeof createGateway>> | undefined;
  const forwarded: unknown[] = [];
  try {
   const reg = await bridge.start(context());
   bus.on(questionChannels.reply, value => {
    forwarded.push(value);
    const reply = value as ReturnType<typeof makeReply>['reply'];
    bus.emit(questionChannels.outcome, { invocationId: reply.invocationId, replyId: reply.replyId, accepted: true });
    bus.emit(questionChannels.closed, { invocationId: reply.invocationId, reason: 'external' });
   });
   app = await createGateway({ runtime: path, port, secret, assets: join(process.cwd(), 'dist/web') });
   const paired = await app.inject({ method: 'POST', url: '/api/pair', headers: { host, origin, 'x-c2-csrf': 'pair' }, payload: { secret } });
   const cookie = paired.headers['set-cookie']!.toString().split(';')[0];
   const headers = { host, origin, cookie, 'x-c2-csrf': 'input' };
   const lease = (await app.inject({ method: 'POST', url: '/api/control', headers, payload: { instance: reg.instance, generation: reg.generation, action: 'claim' } })).json().lease;
   const answers = [
    { questionIndex: 0, kind: 'custom' as const, answer: null, notes: 'Authored null note' },
    { questionIndex: 0, kind: 'custom' as const, answer: '' },
    { questionIndex: 0, kind: 'multi' as const, answer: null, selected: ['Browser'] },
    { questionIndex: 0, kind: 'custom' as const, answer: null, notes: 'Cancelled null note' },
   ];
   for (const [index, answer] of answers.entries()) {
    const invocationId = `authored-value-${index}`, request = questionRequest(invocationId);
    request.questions[0].multiSelect = answer.kind === 'multi';
    bus.emit(questionChannels.request, request);
    const reply = { invocationId, replyId: `authored-reply-${index}`, cancelled: index === 3, answers: [answer], globalNote: 'Global note retained' };
    const result = await app.inject({ method: 'POST', url: '/api/question-reply', headers, payload: { instance: reg.instance, generation: reg.generation, lease, reply } });
    expect(result.statusCode).toBe(200); expect(result.json().status).toBe('accepted');
    expect(forwarded.at(-1)).toEqual(reply);
   }
   const valid = { ...makeReply(reg), lease };
   for (const reply of [
    { ...valid.reply, cancelled: 'false' },
    { ...valid.reply, answers: [{ questionIndex: '0', kind: 'custom', answer: null }] },
    { ...valid.reply, answers: [{ questionIndex: 0, kind: 'custom', answer: false }] },
    { ...valid.reply, unexpected: true },
   ]) expect((await app.inject({ method: 'POST', url: '/api/question-reply', headers, payload: { ...valid, reply } })).statusCode).toBe(400);
   expect(forwarded).toHaveLength(4);
  } finally { await app?.close(); await bridge.close(); rmSync(path, { recursive: true, force: true }); }
 });
 it('selected only, authenticated capability, byte/schema/query/lease/conflict gates, one no-wait admission and actual gateway restart recovery', async () => {
  const path = runtime(), bus = questionBus(), bridge = createBridge(path, undefined, undefined, undefined, bus);
  let app: Awaited<ReturnType<typeof createGateway>> | undefined;
  try {
   const reg = await bridge.start(context()); bus.emit(questionChannels.request, questionRequest());
   let calls = 0, lost = true;
   bus.on(questionChannels.reply, value => {
    calls++; if (lost) return; const p = value as ReturnType<typeof makeReply>['reply'];
    bus.emit(questionChannels.outcome, { invocationId: p.invocationId, replyId: p.replyId, accepted: true }); bus.emit(questionChannels.closed, { invocationId: p.invocationId, reason: 'external' });
   });
   const start = () => createGateway({ runtime: path, port, secret, assets: join(process.cwd(), 'dist/web') });
   app = await start();
   const pair = async () => { const res = await app!.inject({ method: 'POST', url: '/api/pair', headers: { host, origin, 'x-c2-csrf': 'pair' }, payload: { secret } }); return res.headers['set-cookie']!.toString().split(';')[0]; };
   let cookie = await pair();
   const headers = () => ({ host, origin, cookie, 'x-c2-csrf': 'input' });
   const selected = `/api/snapshot?instance=${reg.instance}&generation=${reg.generation}`;
   expect((await app.inject({ url: '/api/snapshot', headers: headers() })).body).not.toContain('Which surface?');
   const view = (await app.inject({ url: selected, headers: headers() })).json();
   expect(view.questions.pending).toHaveLength(1); expect(JSON.stringify(view)).not.toContain(reg.capability);
   const claim = async () => (await app!.inject({ method: 'POST', url: '/api/control', headers: headers(), payload: { instance: reg.instance, generation: reg.generation, action: 'claim' } })).json().lease as string;
   let lease = await claim();
   const post = (payload: unknown, url = '/api/question-reply', h = headers()) => app!.inject({ method: 'POST', url, headers: h, payload: payload as object });
   const body = () => ({ ...makeReply(reg), lease });
   expect((await post(body(), '/api/question-reply?extra=x')).statusCode).toBe(400);
   expect((await post(body(), '/api/question-reply', { ...headers(), cookie: '' })).statusCode).toBe(401);
   expect((await post(body(), '/api/question-reply', { ...headers(), origin: 'http://bad.invalid' })).statusCode).toBe(403);
   expect((await post(body(), '/api/question-reply', { ...headers(), 'x-c2-csrf': '' })).statusCode).toBe(403);
   expect((await post({ ...body(), lease: '0'.repeat(64) })).statusCode).toBe(409);
   expect((await post({ ...body(), reply: { ...body().reply, cancelled: 'false' } })).statusCode).toBe(400);
   expect((await post({ ...body(), reply: { ...body().reply, answers: [{ questionIndex: 0, kind: 'custom', answer: '😀'.repeat(4097) }] } })).statusCode).toBe(400);
   expect((await post({ ...body(), reply: { ...body().reply, answers: [0,1,2,3].map(questionIndex => ({ questionIndex, kind: 'custom', answer: 'é'.repeat(8192) })) } })).statusCode).toBe(400);
   expect(calls).toBe(0);
   const first = post(body()); await vi.waitFor(() => expect(calls).toBe(1));
   expect((await post(body())).statusCode).toBe(429); expect((await first).json().status).toBe('uncertain');
   expect((await app.inject({ url: selected, headers: headers() })).json().questions.pending).toHaveLength(1);
   await app.close(); app = await start(); cookie = await pair(); lease = await claim();
   expect((await app.inject({ url: selected, headers: headers() })).json().questions.pending).toHaveLength(1);
   lost = false; expect((await post(body())).json().status).toBe('accepted');
   expect((await post(body())).json().status).toBe('not-pending'); expect(calls).toBe(2);
  } finally { await app?.close(); await bridge.close(); rmSync(path, { recursive: true, force: true }); }
 });
});

describe('C4 questionnaire limits and post-await authority', () => {
 const replyFor = (reg: { instance: string; generation: string }) => ({ instance: reg.instance, generation: reg.generation, reply: { invocationId: 'controlled-live-invocation', replyId: 'bounded', cancelled: false, answers: [] } });
 it('checks every public field/count as UTF-16 and bytes, accepts exact 65,536-byte requests and retains four without eviction', async () => {
  const path = runtime(), bus = questionBus(), bridge = createBridge(path, undefined, undefined, undefined, bus);
  try {
   const reg = await bridge.start(context());
   const invalids = [
    (p: ReturnType<typeof questionRequest>) => { p.questions[0].header = 'x'.repeat(17); },
    (p: ReturnType<typeof questionRequest>) => { p.questions[0].options[0].label = 'x'.repeat(61); },
    (p: ReturnType<typeof questionRequest>) => { p.questions[0].options[0].description = 'x'.repeat(16001); },
    (p: ReturnType<typeof questionRequest>) => { p.questions[0].options[0].preview = 'x'.repeat(16001); },
    (p: ReturnType<typeof questionRequest>) => { p.questions = Array(5).fill(p.questions[0]); },
    (p: ReturnType<typeof questionRequest>) => { p.questions[0].options = Array(5).fill(p.questions[0].options[0]); },
   ];
   for (const mutate of invalids) { const p = questionRequest(); mutate(p); bus.emit(questionChannels.request, p); }
   expect((await readQuestions(path, reg)).pending).toEqual([]);
   for (let n = 0; n < 4; n++) {
    const p = { ...questionRequest(String(n)), future: '' }; p.future = 'x'.repeat(65536 - Buffer.byteLength(JSON.stringify(p)));
    expect(Buffer.byteLength(JSON.stringify(p))).toBe(65536); bus.emit(questionChannels.request, p);
   }
   bus.emit(questionChannels.request, questionRequest('overflow')); const state = await readQuestions(path, reg);
   expect(state.pending.map(p => p.invocationId)).toEqual(['0','1','2','3']); expect(state.terminalOnly).toBe(true);
   expect(Buffer.byteLength(JSON.stringify(state))).toBeLessThanOrEqual(270000);
   for (const p of state.pending) bus.emit(questionChannels.closed, { invocationId: p.invocationId, reason: 'terminal' });
   expect((await readQuestions(path, reg)).terminalOnly).toBe(true);
  } finally { await bridge.close(); rmSync(path, { recursive: true, force: true }); }
 });
 it('enforces inner bytes independently of the 70,000-byte authenticated UDS envelope; preserves partial/empty/null/multi/custom/cancel/notes without echoed fields', async () => {
  const path = runtime(), bus = questionBus(), bridge = createBridge(path, undefined, undefined, undefined, bus);
  try {
   const reg = await bridge.start(context()); bus.emit(questionChannels.request, questionRequest());
   const forwarded: unknown[] = [];
   bus.on(questionChannels.reply, value => { forwarded.push(value); const p = value as { invocationId: string; replyId: string }; bus.emit(questionChannels.outcome, { ...p, accepted: false, reason: 'invalid_reply' }); });
   const raw = (body: unknown, pathUrl = '/question-reply', auth = reg.capability, type = 'application/json') => new Promise<number>((resolve, reject) => {
    const req = request({ socketPath: join(path, `b-${reg.generation}.sock`), path: pathUrl, method: 'POST', headers: { 'x-c2-capability': auth, 'content-type': type } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); }); req.on('error', reject); req.end(typeof body === 'string' ? body : JSON.stringify(body));
   });
   expect(await raw(replyFor(reg), '/question-reply', '0'.repeat(64))).toBe(401);
   expect(await raw(replyFor(reg), '/question-reply', reg.capability, 'text/plain')).toBe(400);
   expect(await raw(replyFor(reg), '/question-reply?')).toBe(405);
   expect(await raw(' '.repeat(70001))).toBe(413);
   expect(await raw({ ...replyFor(reg), reply: { ...replyFor(reg).reply, echoed: 'forged' } })).toBe(400);
   expect(await raw({ ...replyFor(reg), reply: { ...replyFor(reg).reply, answers: [{ questionIndex: 0, kind: 'custom', answer: '😀'.repeat(4097) }] } })).toBe(400);
   const max = { ...replyFor(reg), reply: { ...replyFor(reg).reply, answers: [0,1,2,3].map(questionIndex => ({ questionIndex, kind: 'custom' as const, answer: 'x'.repeat(8192), notes: 'x'.repeat(8192) })) } };
   const excess = Buffer.byteLength(JSON.stringify(max.reply)) - 65536; max.reply.answers[3].notes = max.reply.answers[3].notes.slice(excess);
   expect(Buffer.byteLength(JSON.stringify(max.reply))).toBe(65536); expect(await raw(max)).toBe(200);
   max.reply.answers[3].notes += 'x'; expect(await raw(max)).toBe(400); expect(forwarded).toHaveLength(1);
   for (const reply of [
    { ...replyFor(reg).reply, cancelled: true, globalNote: 'cancel note' },
    { ...replyFor(reg).reply, answers: [{ questionIndex: 0, kind: 'custom' as const, answer: null, notes: 'note exact' }] },
    { ...replyFor(reg).reply, answers: [{ questionIndex: 0, kind: 'custom' as const, answer: '' }] },
    { ...replyFor(reg).reply, answers: [{ questionIndex: 0, kind: 'multi' as const, answer: null, selected: ['Browser', 'Terminal'] }] },
   ]) {
    expect((await sendQuestionReply(path, reg, { ...replyFor(reg), reply }, new AbortController().signal)).status).toBe('invalid'); expect(forwarded.at(-1)).toEqual(reply);
   }
   expect((await readQuestions(path, reg)).pending).toHaveLength(1);
  } finally { await bridge.close(); rmSync(path, { recursive: true, force: true }); }
 });
 it('rechecks lease/cookie expiry, canonical conflict, generation and shutdown after awaited discovery; takeover has no waiting queue', async () => {
  for (const action of ['expiry','cookie-expiry','conflict','generation','shutdown']) {
   const path = runtime(), ctx = context(), bus = questionBus(), bridge = createBridge(path, undefined, undefined, undefined, bus), other = createBridge(path);
   let app: Awaited<ReturnType<typeof createGateway>> | undefined;
   try {
    const reg = await bridge.start(ctx); bus.emit(questionChannels.request, questionRequest());
    app = await createGateway({ runtime: path, port, secret, assets: join(process.cwd(), 'dist/web'), pollMs: 60000 });
    const paired = await app.inject({ method: 'POST', url: '/api/pair', headers: { host, origin, 'x-c2-csrf': 'pair' }, payload: { secret } });
    const headers = { host, origin, cookie: String(paired.headers['set-cookie']).split(';')[0], 'x-c2-csrf': 'input' };
    const identity = { instance: reg.instance, generation: reg.generation };
    const lease = (await app.inject({ method: 'POST', url: '/api/control', headers, payload: { ...identity, action: 'claim' } })).json().lease;
    let release!: () => void, entered!: () => void; const ready = new Promise<void>(r => entered = r), hold = new Promise<void>(r => release = r);
    const actual = peerCalls.discover; vi.spyOn(peerCalls, 'discover').mockImplementationOnce(async path => { entered(); await hold; return actual(path); });
    const forward = vi.spyOn(peerCalls, 'sendQuestionReply');
    const response = app.inject({ method: 'POST', url: '/api/question-reply', headers, payload: { ...replyFor(reg), lease } }).then(r => r); await ready;
    expect((await app.inject({ method: 'POST', url: '/api/control', headers, payload: { ...identity, action: 'takeover' } })).statusCode).toBe(429);
    if (action === 'expiry' || action === 'cookie-expiry') { const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + (action === 'expiry' ? 60001 : 8 * 60 * 60 * 1000 + 1)); }
    if (action === 'generation') await bridge.start(context());
    if (action === 'conflict') { const file = join(path, 'canonical.jsonl'); writeFileSync(file, 'fixture', { mode: 0o600 }); ctx.sessionManager.getSessionFile = () => file; const second = context(); second.sessionManager.getSessionFile = () => file; await other.start(second); }
    const closing = action === 'shutdown' ? app.close() : undefined;
    release(); expect((await response).statusCode).toBe(409); await closing; expect(forward).not.toHaveBeenCalled();
   } finally { vi.restoreAllMocks(); await app?.close(); await bridge.close(); await other.close(); rmSync(path, { recursive: true, force: true }); }
  }
 });
 it('departed real HTTP reply cleans observers and never forwards after asynchronous reachability', async () => {
  const path = runtime(), bus = questionBus(), bridge = createBridge(path, undefined, undefined, undefined, bus);
  let app: Awaited<ReturnType<typeof createGateway>> | undefined;
  try {
   const reg = await bridge.start(context()); bus.emit(questionChannels.request, questionRequest());
   app = await createGateway({ runtime: path, port, secret, assets: join(process.cwd(), 'dist/web'), pollMs: 60000 }); await app.listen({ host: '127.0.0.1', port });
   const paired = await app.inject({ method: 'POST', url: '/api/pair', headers: { host, origin, 'x-c2-csrf': 'pair' }, payload: { secret } }); const headers = { host, origin, cookie: String(paired.headers['set-cookie']).split(';')[0], 'x-c2-csrf': 'input', 'content-type': 'application/json' };
   const lease = (await app.inject({ method: 'POST', url: '/api/control', headers, payload: { instance: reg.instance, generation: reg.generation, action: 'claim' } })).json().lease;
   let release!: () => void, entered!: () => void, returned!: () => void;
   const ready = new Promise<void>(r => entered = r), hold = new Promise<void>(r => release = r), done = new Promise<void>(r => returned = r);
   const actual = peerCalls.discover; vi.spyOn(peerCalls, 'discover').mockImplementationOnce(async path => { entered(); await hold; const result = await actual(path); returned(); return result; });
   const forwarding = vi.spyOn(peerCalls, 'sendQuestionReply');
   const req = request({ host: '127.0.0.1', port, path: '/api/question-reply', method: 'POST', headers }); req.on('error', () => {}); req.end(JSON.stringify({ ...replyFor(reg), lease }));
   await ready; req.destroy(); await new Promise(r => setTimeout(r, 20)); release(); await done; await new Promise(r => setTimeout(r, 20));
   expect(forwarding).not.toHaveBeenCalled(); expect((await readQuestions(path, reg)).pending).toHaveLength(1);
  } finally { vi.restoreAllMocks(); await app?.close(); await bridge.close(); rmSync(path, { recursive: true, force: true }); }
 });
 it('selected state only fetches selected questions and budgets the full SSE frame without mutating a shared native snapshot', async () => {
  const path = runtime(), bus = questionBus(), bridge = createBridge(path, undefined, undefined, undefined, bus), other = createBridge(path);
  let app: Awaited<ReturnType<typeof createGateway>> | undefined;
  try {
   const reg = await bridge.start(context()); const second = await other.start(context()); bus.emit(questionChannels.request, questionRequest());
   app = await createGateway({ runtime: path, port, secret, assets: join(process.cwd(), 'dist/web'), pollMs: 60000 });
   const cookie = String((await app.inject({ method: 'POST', url: '/api/pair', headers: { host, origin, 'x-c2-csrf': 'pair' }, payload: { secret } })).headers['set-cookie']).split(';')[0]; const headers = { host, cookie };
   const calls = vi.spyOn(peerCalls, 'readQuestions');
   await app.inject({ url: '/api/snapshot', headers }); expect(calls).not.toHaveBeenCalled();
   const shared = nativeSnapshot(context(), reg.instance, reg.generation, reg.capability).snapshot;
   shared.items = Array.from({ length: 60 }, (_, i) => ({ id: String(i), role: 'user', blocks: [{ type: 'text', text: 'x'.repeat(16000) }] }));
   const originalSize = shared.items.length; vi.spyOn(peerCalls, 'readSnapshot').mockResolvedValue(shared);
   const view = await app.inject({ url: `/api/snapshot?instance=${reg.instance}&generation=${reg.generation}`, headers });
   expect(calls).toHaveBeenCalledTimes(1); expect(calls.mock.calls[0][1].instance).toBe(reg.instance);
   expect(view.json().questions.pending).toHaveLength(1); expect(Buffer.byteLength(view.body) + 128).toBeLessThanOrEqual(900000); expect(shared.items).toHaveLength(originalSize);
   const different = await app.inject({ url: `/api/snapshot?instance=${second.instance}&generation=${second.generation}`, headers });
   expect(different.json().questions.pending).toEqual([]); expect(different.body).not.toContain('Which surface?');
  } finally { vi.restoreAllMocks(); await app?.close(); await bridge.close(); await other.close(); rmSync(path, { recursive: true, force: true }); }
 });
});

it('C4 questionnaire ignores malformed correlatable public outcomes, captures asynchronous matching completion, and cleans captured observers on generation death', async () => {
 const path = runtime(), bus = questionBus(), bridge = createBridge(path, undefined, undefined, undefined, bus);
 try {
  const reg = await bridge.start(context()); bus.emit(questionChannels.request, questionRequest());
  const payload = { invocationId: 'controlled-live-invocation', replyId: 'async-public', cancelled: false, answers: [] };
  const post = () => sendQuestionReply(path, reg, { instance: reg.instance, generation: reg.generation, reply: payload }, new AbortController().signal);
  const response = post(); await vi.waitFor(() => expect(bus.handlers.get(questionChannels.outcome)?.size).toBe(1));
  for (const invalid of [{ accepted: false }, { accepted: true, reason: 'invalid_reply' }, { accepted: 'true' }, { accepted: true, replyId: 'another-reply' }, { accepted: true, invocationId: 'another-invocation' }]) bus.emit(questionChannels.outcome, { invocationId: payload.invocationId, replyId: payload.replyId, ...invalid });
  expect((await readQuestions(path, reg)).pending).toHaveLength(1); expect(bus.handlers.get(questionChannels.outcome)?.size).toBe(1);
  bus.emit(questionChannels.outcome, { invocationId: payload.invocationId, replyId: payload.replyId, accepted: true }); bus.emit(questionChannels.closed, { invocationId: payload.invocationId, reason: 'external' });
  expect((await response).status).toBe('accepted'); expect(bus.handlers.get(questionChannels.outcome)?.size).toBe(0);
  bus.emit(questionChannels.request, questionRequest()); const interrupted = post(); const rejected = expect(interrupted).rejects.toThrow();
  await vi.waitFor(() => expect(bus.handlers.get(questionChannels.outcome)?.size).toBe(1)); const captured = [...bus.handlers.get(questionChannels.outcome)!][0];
  await bridge.close(); await rejected; captured({ invocationId: payload.invocationId, replyId: payload.replyId, accepted: true });
  expect(bus.handlers.get(questionChannels.outcome)?.size).toBe(0);
 } finally { await bridge.close(); rmSync(path, { recursive: true, force: true }); }
});
