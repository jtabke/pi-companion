import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, writeFileSync, unlinkSync, lstatSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { runtimeDirectory, ownerStat } from "../shared/runtime.js";
import { nativeSnapshot, nativeStatus } from "./snapshot.js";
import { type Registration, TextRequestSchema, ImageRequestSchema, StopRequestSchema, imageBodyBytes, limits } from "../shared/protocol.js";
import { Value } from "@sinclair/typebox/value";
import { nativeQuestions } from "./questions.js";
import { PrivateQuestionReplySchema, questionLimits } from "../shared/protocol.js";
import { nativeInput } from "./input.js";
export function createBridge(
	runtime: string,
	instance = randomBytes(16).toString("hex"),
	send?: ExtensionAPI["sendUserMessage"],
	settings?: ExtensionAPI["getSettings"],
	events?: ExtensionAPI["events"],
) {
	let activeGeneration: string | undefined;
	let server: Server | undefined,
		registrationPath: string | undefined,
		socketPath: string | undefined;
	let socketInode: number | undefined, recordInode: number | undefined;
	const sockets = new Set<import("node:net").Socket>();
	let input: ReturnType<typeof nativeInput> | undefined;
	let questions: ReturnType<typeof nativeQuestions> | undefined;
	async function close() {
		activeGeneration = undefined;
		questions?.close(); questions = undefined;
		input = undefined;
		const old = server;
		server = undefined;
		for (const socket of sockets) socket.destroy();
		sockets.clear();
		if (old) await new Promise<void>((resolve) => old.close(() => resolve()));
		for (const [path, ino] of [
			[registrationPath, recordInode],
			[socketPath, socketInode],
		] as const) {
			if (path) {
				try {
					const st = lstatSync(path);
					if (st.ino === ino && st.uid === process.getuid!()) unlinkSync(path);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
			}
		}
		registrationPath = socketPath = undefined;
		recordInode = socketInode = undefined;
	}
	async function start(ctx: ExtensionContext) {
		await close();
		const generation = randomBytes(16).toString("hex"),
			capability = randomBytes(32).toString("hex");
		const registration: Registration = {
			version: 1,
			instance,
			generation,
			capability,
		};
		// Generation-specific pathname prevents an old listener close from unlinking a replacement listener.
		socketPath = join(runtime, `b-${generation}.sock`);
		registrationPath = join(runtime, `b-${instance}.json`);
		activeGeneration = generation;
		const dispatch = input = nativeInput(
			{ instance, generation },
			ctx,
			send,
			() => activeGeneration === generation,
			settings,
		);
		const questionOwner = questions = nativeQuestions({ instance, generation }, ctx, events, () => activeGeneration === generation);
		server = createServer((req, res) => {
			const auth = req.headers["x-c2-capability"];
			if (
				typeof auth !== "string" ||
				!/^[a-f0-9]{64}$/.test(auth) ||
				!timingSafeEqual(Buffer.from(auth), Buffer.from(capability))
			) {
				res.writeHead(401).end();
				return;
			}
			if (req.method === "GET" && req.url === "/questions") {
                res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(questionOwner.state())); return;
            }
            if (req.method === "POST" && req.url === "/question-reply") {
                let bytes = 0; const chunks: Buffer[] = []; const abort = new AbortController();
                res.once("close", () => abort.abort());
                if (req.headers["content-type"] !== "application/json") { res.writeHead(400).end(); req.resume(); return; }
                req.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > questionLimits.bodyBytes) { chunks.length = 0; if (!res.headersSent) res.writeHead(413).end(); } else chunks.push(chunk); });
                req.on("error", () => { chunks.length = 0; abort.abort(); });
                req.on("end", () => {
                    if (bytes > questionLimits.bodyBytes || req.aborted || res.destroyed) return;
                    try {
                        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                        if (!Value.Check(PrivateQuestionReplySchema, body) || Buffer.byteLength(JSON.stringify(body.reply)) > questionLimits.replyBytes) { res.writeHead(400).end(); return; }
                        void questionOwner.reply(body, abort.signal).then(receipt => { if (!res.destroyed) res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(receipt)); });
                    } catch { res.writeHead(400).end(); }
                }); return;
            }
			if (req.method === "POST" && (req.url === "/text" || req.url === "/image" || req.url === "/stop")) {
				const isImage = req.url === "/image", isStop = req.url === "/stop";
				const cap = isStop ? 1024 : isImage ? imageBodyBytes : 100_000;
				// Route-specific UTF-8/JSON allowance; admitted sockets are already bounded.
				let bytes = 0;
				const chunks: Buffer[] = [];
				const fail = (status: number) =>
					res
						.writeHead(status, { "content-type": "application/json" })
						.end('{"error":"Invalid input"}');
				if (req.headers["content-type"] !== "application/json") {
					fail(400);
					req.resume();
					return;
				}
				req.on("data", (chunk: Buffer) => {
					bytes += chunk.length;
					if (bytes > cap) {
						chunks.length = 0;
						if (!res.headersSent) fail(413);
					} else chunks.push(chunk);
				});
				req.on("error", () => {
					chunks.length = 0;
				});
				req.on("end", () => {
					if (bytes > cap || req.aborted || res.destroyed) return;
					try {
						const body: unknown = JSON.parse(
							Buffer.concat(chunks).toString("utf8"),
						);
						if (!(Value.Check(TextRequestSchema, body) && !isImage && !isStop) &&
							!(Value.Check(ImageRequestSchema, body) && isImage) &&
							!(Value.Check(StopRequestSchema, body) && isStop)) {
							fail(400);
							return;
						}
						if (Value.Check(ImageRequestSchema, body)) {
							const binary = Buffer.from(body.image, "base64");
							if (!binary.length || binary.length > limits.imageBytes ||
								binary.toString("base64") !== body.image) { fail(400); return; }
							res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(dispatch(body)));
						} else if (Value.Check(TextRequestSchema, body) || Value.Check(StopRequestSchema, body)) {
							res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(dispatch(body)));
						}
					} catch {
						if (!res.headersSent) fail(400);
					}
				});
				return;
			}
			if (req.method !== "GET") {
				res.writeHead(405).end();
				return;
			}
			try {
				if (req.url === "/status") {
					const status = nativeStatus(ctx, instance, generation);
					status.summary.pending = ctx.hasPendingMessages();
					const stop = dispatch.observation();
					if (stop) status.summary.stop = stop;
					res
						.writeHead(200, { "content-type": "application/json" })
						.end(JSON.stringify(status));
					return;
				}
				if (
					req.url !== "/snapshot" &&
					!/^\/media\/[a-f0-9]{32}\/[a-f0-9]{32}$/.test(req.url ?? "")
				) {
					res.writeHead(404).end();
					return;
				}
				const { snapshot, media } = nativeSnapshot(
					ctx,
					instance,
					generation,
					capability,
				);
				if (req.url === "/snapshot") {
					res
						.writeHead(200, { "content-type": "application/json" })
						.end(JSON.stringify(snapshot));
					return;
				}
				const match = /^\/media\/([a-f0-9]{32})\/([a-f0-9]{32})$/.exec(
					req.url ?? "",
				);
				if (!match || match[1] !== generation) {
					res.writeHead(404).end();
					return;
				}
				const image = media.get(match[2]);
				if (!image) {
					res.writeHead(410).end();
					return;
				}
				res.writeHead(200, {
					"content-type": image.mime,
					"content-length": image.bytes.length,
				});
				const stream = Readable.from(
					(function* () {
						for (let offset = 0; offset < image.bytes.length; offset += 65536)
							yield image.bytes.subarray(offset, offset + 65536);
					})(),
				);
				res.on("close", () => stream.destroy());
				stream.pipe(res);
			} catch {
				res.writeHead(503).end();
			}
		});
		server.maxConnections = 4;
		server.requestTimeout = 3000;
		server.headersTimeout = 3000;
		server.on("connection", (socket) => {
			sockets.add(socket);
			socket.setTimeout(5000, () => socket.destroy());
			socket.on("close", () => sockets.delete(socket));
		});
		try {
			await new Promise<void>((resolve, reject) => {
				server!.once("error", reject);
				server!.listen(socketPath!, resolve);
			});
			chmodSync(socketPath, 0o600);
			socketInode = ownerStat(socketPath, "socket").ino;
			writeFileSync(registrationPath, JSON.stringify(registration), {
				mode: 0o600,
				flag: "wx",
			});
			recordInode = ownerStat(registrationPath, "file").ino;
		} catch (error) {
			await close();
			throw error;
		}
		return registration;
	}
	return { start, close, observe: (event: "agent_start" | "agent_end" | "agent_settled", ctx: ExtensionContext) => input?.observe(event, ctx) };
}
export default function bridgeExtension(pi: ExtensionAPI) {
	// Extension modules are recreated on /reload; preserve only random process identity, not native state.
	const key = Symbol.for("pi-companion.c2.instance");
	const state = globalThis as typeof globalThis & {
		[key: symbol]: string | undefined;
	};
	const instance = state[key] ?? (state[key] = randomBytes(16).toString("hex"));
	const bridge = createBridge(runtimeDirectory(), instance,
		(text, options) => pi.sendUserMessage(text, options),
		() => pi.getSettings(),
		pi.events,
	);
	pi.on("session_start", async (_event, ctx) => {
		await bridge.start(ctx);
	});
	pi.on("agent_start", (_event, ctx) => bridge.observe("agent_start", ctx));
	pi.on("agent_end", (_event, ctx) => bridge.observe("agent_end", ctx));
	pi.on("agent_settled", (_event, ctx) => bridge.observe("agent_settled", ctx));
	pi.on("session_shutdown", async () => {
		await bridge.close();
	});
}
