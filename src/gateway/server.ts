import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import staticFiles from "@fastify/static";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { discover, peerResponse, readSnapshot, sendText, sendImage, sendStop, readQuestions, sendQuestionReply } from "./peer.js";
import { controllers } from "./controller.js";
import { normalizeImage, ImageError } from "./upload.js";
import {
	BrowserQuestionReplySchema, questionLimits, type BrowserQuestionReply, type Questions,
	ControlSchema,
	BrowserTextSchema,
	BrowserStopSchema,
	type BrowserStop,
	BrowserImageSchema,
	imageBodyBytes,
	type BrowserImage,
	type ControlRequest,
	type BrowserText,
	limits,
	IdentitySchema,
	type Identity,
	type Snapshot,
	type View,
} from "../shared/protocol.js";
export async function createGateway(options: {
	runtime: string;
	port: number;
	secret: string;
	publicOrigin?: string;
	assets?: string;
	pollMs?: number;
}) {
	const secure = options.publicOrigin !== undefined;
	if (options.publicOrigin !== undefined) {
		// Validate authored ASCII spelling before URL parsing can normalize ports, case or Unicode.
		const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
		if (!new RegExp(`^https://${label}\\.${label}\\.ts\\.net$`).test(options.publicOrigin) ||
			new URL(options.publicOrigin).origin !== options.publicOrigin)
			throw new Error("C2_PUBLIC_ORIGIN must be a canonical HTTPS Tailscale device origin");
	}
	const origin = options.publicOrigin ?? `http://127.0.0.1:${options.port}`,
		host = secure ? new URL(origin).host : `127.0.0.1:${options.port}`;
	const app = Fastify({
		logger: false,
		ajv: { customOptions: { removeAdditional: false } },
		bodyLimit: 1024,
		requestTimeout: 5000,
		connectionTimeout: 10000,
		trustProxy: false,
		maxRequestsPerSocket: 100,
	});
	app.server.maxConnections = 64;
	await app.register(cookie);
	await app.register(helmet, {
		contentSecurityPolicy: {
			directives: {
				defaultSrc: ["'self'"],
				scriptSrc: ["'self'"],
				styleSrc: ["'self'"],
				imgSrc: ["'self'", "blob:"],
				connectSrc: ["'self'"],
				fontSrc: ["'self'"],
				objectSrc: ["'none'"],
				baseUri: ["'none'"],
				frameAncestors: ["'none'"],
				formAction: ["'self'"],
				upgradeInsecureRequests: null,
			},
		},
		hsts: secure ? { maxAge: 31536000, includeSubDomains: false, preload: false } : false,
	});
	const sessions = new Map<string, number>();
	const control = controllers();
	let attempts = 0,
		attemptWindow = Date.now();
	app.addHook("onRequest", async (req, reply) => {
		reply
			.header("Cache-Control", "no-store")
			.header("Referrer-Policy", "no-referrer");
		if (
			req.headers.host !== host ||
			(req.headers.origin !== undefined && req.headers.origin !== origin) ||
			req.headers["sec-fetch-site"] === "cross-site"
		)
			return reply.code(403).send({ error: "Origin denied" });
		if (
			["/api/control", "/api/text", "/api/image", "/api/stop", "/api/question-reply"].includes(req.url.split("?")[0]) &&
			(req.headers.origin !== origin || req.headers["x-c2-csrf"] !== "input")
		)
			return reply.code(403).send({ error: "Origin denied" });
		if (req.url.startsWith("/api/") && req.url !== "/api/pair") {
			const token = req.cookies.c2;
			if (!token || (sessions.get(token) ?? 0) < Date.now())
				return reply.code(401).send({ error: "Pair in this browser first" });
		}
	});
	app.post<{ Body: { secret: string } }>(
		"/api/pair",
		{
			schema: {
				body: Type.Object(
					{ secret: Type.String({ minLength: 1, maxLength: 128 }) },
					{ additionalProperties: false },
				),
			},
		},
		async (req, reply) => {
			// Same-origin header and explicit CSRF marker are required even before authentication.
			if (req.headers.origin !== origin || req.headers["x-c2-csrf"] !== "pair")
				return reply.code(403).send({ error: "Origin denied" });
			if (Date.now() - attemptWindow > 60_000) {
				attempts = 0;
				attemptWindow = Date.now();
			}
			if (++attempts > 10)
				return reply.code(429).send({ error: "Pairing rate limit" });
			const given = Buffer.from(req.body.secret),
				expected = Buffer.from(options.secret);
			if (given.length !== expected.length || !timingSafeEqual(given, expected))
				return reply.code(401).send({ error: "Pairing failed" });
			for (const [key, expires] of sessions)
				if (expires < Date.now()) sessions.delete(key);
			if (sessions.size >= 8)
				return reply.code(429).send({ error: "Browser session limit" });
			const token = randomBytes(32).toString("hex");
			sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
			return reply
				.setCookie("c2", token, {
					httpOnly: true,
					sameSite: "strict",
					path: "/",
					maxAge: 8 * 60 * 60,
					secure,
				})
				.send({ paired: true });
		},
	);
	type Scope = {
		selected?: Identity;
		view: View;
		replay: { id: string; frame: string }[];
		pending?: Promise<void>;
		readers: number;
	};
	let peers: Awaited<ReturnType<typeof discover>>["peers"] = [],
		unavailable = false;
	const scopes = new Map<string, Scope>();
	const scopeKey = (selected?: Identity) =>
		selected ? `${selected.instance}:${selected.generation}` : "list";
	const same = (a: Identity, b: Identity) =>
		a.instance === b.instance && a.generation === b.generation;
	function summaries(): View["sessions"] {
		const counts = new Map<string, number>();
		for (const peer of peers)
			if (peer.status.canonicalSession)
				counts.set(
					peer.status.canonicalSession,
					(counts.get(peer.status.canonicalSession) ?? 0) + 1,
				);
		return peers
			.map(({ status }) => ({
				...status.summary,
				conflict:
					status.canonicalSession !== null &&
					(counts.get(status.canonicalSession) ?? 0) > 1,
			}))
			.sort((a, b) => a.instance.localeCompare(b.instance));
	}
	function getScope(selected?: Identity): Scope | undefined {
		const key = scopeKey(selected);
		let scope = scopes.get(key);
		if (scope) {
			scopes.delete(key);
			scopes.set(key, scope);
			return scope;
		}
		// Four detailed selection/replay caches, plus one lightweight list. Never evict active readers.
		if (
			selected &&
			[...scopes.values()].filter((s) => s.selected).length >= limits.streams
		) {
			const disposable = [...scopes.entries()].find(
				([, s]) => s.selected && !s.pending && s.readers === 0,
			);
			if (!disposable) return undefined;
			scopes.delete(disposable[0]);
		}
		scope = {
			selected,
			view: {
				connection: "disconnected",
				sessions: [],
				...(selected ? { selected } : {}),
			},
			replay: [],
			readers: 0,
		};
		scopes.set(key, scope);
		return scope;
	}
	const streams = new Map<
		ServerResponse,
		{
			token: string;
			scope: Scope;
			enqueue: (frame: string) => void;
			close: () => void;
		}
	>();
	function addStream(res: ServerResponse, token: string, scope: Scope) {
		const queue: { frame: string; bytes: number }[] = [];
		let queuedBytes = 0,
			blocked = false,
			closed = false;
		let drainTimer: NodeJS.Timeout | undefined;
		function close() {
			if (closed) return;
			closed = true;
			clearTimeout(drainTimer);
			res.off("drain", drain);
			queue.length = 0;
			queuedBytes = 0;
			streams.delete(res);
			scope.readers--;
			res.destroy();
		}
		function flush() {
			while (!closed && !blocked && queue.length) {
				const next = queue.shift()!;
				queuedBytes -= next.bytes;
				// false means accepted, not failed: never retry or discard this frame.
				if (!res.write(next.frame)) {
					blocked = true;
					drainTimer = setTimeout(close, limits.sseDrainMs);
					drainTimer.unref();
				}
			}
		}
		function drain() {
			clearTimeout(drainTimer);
			drainTimer = undefined;
			blocked = false;
			flush();
		}
		function enqueue(frame: string) {
			if (closed) return;
			const bytes = Buffer.byteLength(frame) + 32; // Reserve HTTP chunk framing as well.
			if (queuedBytes + res.writableLength + bytes > limits.sseBufferedBytes) {
				close();
				return;
			}
			queue.push({ frame, bytes });
			queuedBytes += bytes;
			flush();
		}
		const stream = { token, scope, enqueue, close };
		streams.set(res, stream);
		res.on("drain", drain);
		res.once("close", close);
		res.once("error", close);
		return stream;
	}
	const epoch = randomBytes(8).toString("hex");
	let counter = 0;
	function publish(scope: Scope, next: View) {
		// Trim only a scope-owned snapshot; include SSE framing in the complete event budget.
		if (next.snapshot) next = { ...next, snapshot: { ...next.snapshot, items: [...next.snapshot.items] } };
		while (
			Buffer.byteLength(JSON.stringify(next)) + 128 > limits.snapshotBytes &&
			next.snapshot?.items.length
		) {
			next.snapshot.items.shift();
			next.snapshot.truncated = true;
		}
		if (
			JSON.stringify(next) === JSON.stringify(scope.view) &&
			scope.replay.length
		)
			return;
		scope.view = next;
		const id = `${epoch}-${++counter}`,
			frame = `id: ${id}\nevent: snapshot\ndata: ${JSON.stringify(next)}\n\n`;
		scope.replay.push({ id, frame });
		if (scope.replay.length > limits.replay) scope.replay.shift();
		for (const stream of streams.values())
			if (stream.scope === scope) stream.enqueue(frame);
	}
	async function updateScope(scope: Scope) {
		if (scope.pending) return scope.pending;
		scope.pending = (async () => {
			const selected = scope.selected;
			const current =
				selected && peers.find((p) => same(p.registration, selected));
			let snapshot: Snapshot | undefined;
			let questions: Questions | undefined;
			if (current)
				try {
					[snapshot, questions] = await Promise.all([readSnapshot(options.runtime, current.registration), readQuestions(options.runtime, current.registration)]);
				} catch {
					/* Companion data unavailable, never touch Pi lifecycle. */
				}
			if (stopped) return;
			const sessions = summaries(),
				reachable = selected && sessions.find((s) => same(s, selected));
			// Never replay a previously connected generation after liveness/detail validation fails.
			// Browsers may keep explicitly disconnected cached content, but stale requests get no details.
			if (selected && (!snapshot || !reachable) && scope.view.snapshot)
				scope.replay.length = 0;
			publish(scope, {
				sessions,
				...(selected
					? {
							selected,
							conflict: reachable?.conflict ?? false,
							controller: control.project(selected),
						}
					: {}),
				connection: unavailable
					? "unavailable"
					: snapshot && reachable
						? "connected"
						: "disconnected",
				...(snapshot && reachable ? { snapshot, questions } : {}),
			});
		})();
		try {
			await scope.pending;
		} finally {
			scope.pending = undefined;
		}
	}
	let polling = false,
		stopped = false;
	async function refresh() {
		if (polling || stopped) return;
		polling = true;
		try {
			const result = await discover(options.runtime);
			if (stopped) return;
			peers = result.peers;
			unavailable = result.overLimit;
			control.reconcile(
				peers.map((p) => p.registration),
				sessions,
			);
		} catch {
			peers = [];
			unavailable = true;
		}
		try {
			// Only readers' selected conversations decode native branch/media. One fetch per shared scope.
			const active = new Set(
				[...streams.values()].map((stream) => stream.scope),
			);
			for (const scope of scopes.values())
				if (!scope.selected) active.add(scope);
			await Promise.all([...active].map(updateScope));
		} finally {
			polling = false;
		}
	}
	await refresh();
	const timer = setInterval(() => void refresh(), options.pollMs ?? 1000);
	timer.unref();
	const heartbeat = setInterval(() => {
		for (const stream of streams.values()) {
			if ((sessions.get(stream.token) ?? 0) < Date.now()) stream.close();
			else stream.enqueue(": heartbeat\n\n");
		}
	}, 15000);
	heartbeat.unref();
	const selectionSchema = Type.Union([
		Type.Object({}, { additionalProperties: false }),
		IdentitySchema,
	]);
	function selection(query: {
		instance?: string;
		generation?: string;
	}): Identity | undefined {
		return query.instance && query.generation
			? { instance: query.instance, generation: query.generation }
			: undefined;
	}
	app.get<{ Querystring: { instance?: string; generation?: string } }>(
		"/api/snapshot",
		{ schema: { querystring: selectionSchema } },
		async (req, reply) => {
			const scope = getScope(selection(req.query));
			if (!scope)
				return reply.code(429).send({ error: "Observer selection limit" });
			await updateScope(scope);
			return scope.view;
		},
	);
	app.get<{ Querystring: { instance?: string; generation?: string } }>(
		"/api/events",
		{ schema: { querystring: selectionSchema } },
		async (req, reply) => {
			if (streams.size >= limits.streams)
				return reply.code(429).send({ error: "Observer stream limit" });
			const scope = getScope(selection(req.query));
			if (!scope)
				return reply.code(429).send({ error: "Observer selection limit" });
			// Reserve the scope before awaiting: another request must not evict this reader's replay cache.
			scope.readers++;
			try {
				await updateScope(scope);
			} catch (error) {
				scope.readers--;
				throw error;
			}
			// Admission and departure are rechecked after the asynchronous shared fetch.
			if (
				streams.size >= limits.streams ||
				req.raw.socket.destroyed ||
				stopped
			) {
				scope.readers--;
				return reply.code(429).send({ error: "Observer stream limit" });
			}
			reply.hijack();
			req.raw.socket.setTimeout(0);
			const res = reply.raw;
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
				connection: "keep-alive",
				"x-frame-options": "DENY",
				"referrer-policy": "no-referrer",
				// Hijacked SSE writes bypass Helmet's reply headers.
				...(secure ? { "strict-transport-security": "max-age=31536000" } : {}),
			});
			const stream = addStream(res, req.cookies.c2!, scope);
			const last = req.headers["last-event-id"];
			const index =
				typeof last === "string" && last.length < 80
					? scope.replay.findIndex((event) => event.id === last)
					: -1;
			const events =
				index >= 0 ? scope.replay.slice(index + 1) : scope.replay.slice(-1);
			for (const event of events) stream.enqueue(event.frame);
			stream.enqueue(": connected\n\n");
		},
	);

	// Every introduced mutation uses the same authenticated, origin/CSRF and instance admission boundary.
	app.setErrorHandler((error, req, reply) => {
		if (["/api/control", "/api/text", "/api/image", "/api/stop", "/api/question-reply"].includes(req.routeOptions.url ?? ""))
			return reply
				.code((error as { statusCode?: number }).statusCode ?? 500)
				.send({ error: "Invalid input" });
		return reply.send(error);
	});
	async function mutationGate(identity: Identity, cookie: string) {
		const fresh = await discover(options.runtime);
		if (stopped || fresh.overLimit || (sessions.get(cookie) ?? 0) <= Date.now())
			return undefined;
		const current = fresh.peers.find((p) => same(p.registration, identity));
		if (!current) return undefined;
		const canonical = current.status.canonicalSession;
		if (
			canonical &&
			fresh.peers.filter((p) => p.status.canonicalSession === canonical)
				.length !== 1
		)
			return undefined;
		return current.registration;
	}
	app.post<{ Body: ControlRequest }>(
		"/api/control",
		{
			schema: {
				body: ControlSchema,
				querystring: Type.Object({}, { additionalProperties: false }),
			},
		},
		async (req, reply) => {
			const body = req.body,
				cookie = req.cookies.c2!;
			if (!control.enter(body.instance))
				return reply.code(429).send({ error: "Input admission limit" });
			try {
				if (!(await mutationGate(body, cookie)))
					return reply
						.code(409)
						.send({ error: "Selected owner unavailable or conflicted" });
				if (stopped || (sessions.get(cookie) ?? 0) <= Date.now())
					return reply.code(409).send({ error: "Browser control unavailable" });
				const result = control.change(body, cookie);
				if (!result)
					return reply.code(409).send({ error: "Browser control unavailable" });
				return result;
			} catch {
				return reply.code(409).send({ error: "Selected owner unavailable" });
			} finally {
				control.leave(body.instance);
			}
		},
	);
	app.post<{ Body: BrowserText }>(
		"/api/text",
		{
			bodyLimit: 100_000,
			schema: {
				body: BrowserTextSchema,
				querystring: Type.Object({}, { additionalProperties: false }),
			},
		},
		async (req, reply) => {
			const body = req.body,
				cookie = req.cookies.c2!;
			if (!control.enter(body.instance))
				return reply.code(429).send({ error: "Input admission limit" });
			let attempted = false;
			try {
				if (!body.text.trim() || !control.valid(body, cookie, body.lease))
					return reply.code(409).send({ error: "Browser control unavailable" });
				const peer = await mutationGate(body, cookie);
				// Final gate after the only pre-forward asynchronous operation. No await before fixed POST initiation.
				if (
					!peer ||
					stopped ||
					(sessions.get(cookie) ?? 0) <= Date.now() ||
					!control.valid(body, cookie, body.lease)
				)
					return reply
						.code(409)
						.send({ error: "Selected owner or browser control unavailable" });
				attempted = true;
				return await sendText(options.runtime, peer, {
					instance: body.instance,
					generation: body.generation,
					requestId: body.requestId,
					text: body.text,
				});
			} catch {
				if (attempted)
					return {
						requestId: body.requestId,
						status: "uncertain",
						reason: "outcome-unconfirmed",
					};
				return reply.code(409).send({ error: "Selected owner unavailable" });
			} finally {
				control.leave(body.instance);
			}
		},
	);
	app.post<{ Body: BrowserStop }>("/api/stop", {
		bodyLimit: 1024,
		schema: { body: BrowserStopSchema, querystring: Type.Object({}, { additionalProperties: false }) },
		preValidation: async (req, reply) => {
			if (req.url !== "/api/stop" || !Value.Check(BrowserStopSchema, req.body))
				return reply.code(400).send({ error: "Invalid input" });
		},
	}, async (req, reply) => {
		const body = req.body, cookie = req.cookies.c2!;
		if (!control.enter(body.instance)) return reply.code(429).send({ error: "Input admission limit" });
		let attempted = false;
		const valid = () => !stopped && !req.raw.aborted && !reply.raw.destroyed &&
			(sessions.get(cookie) ?? 0) > Date.now() && control.valid(body, cookie, body.lease);
		try {
			if (!valid()) return reply.code(409).send({ error: "Browser control unavailable" });
			const peer = await mutationGate(body, cookie);
			if (!peer || !valid()) return reply.code(409).send({ error: "Selected owner or browser control unavailable" });
			attempted = true;
			return await sendStop(options.runtime, peer, {
				instance: body.instance, generation: body.generation, requestId: body.requestId,
			});
		} catch {
			if (attempted) return { requestId: body.requestId, status: "uncertain", reason: "outcome-unconfirmed" };
			return reply.code(409).send({ error: "Selected owner unavailable" });
		} finally { control.leave(body.instance); }
	});

    app.post<{ Body: BrowserQuestionReply }>("/api/question-reply", {
        bodyLimit: questionLimits.bodyBytes,
        // The strict TypeBox check below preserves authored nulls; AJV's union coercion does not.
        schema: { querystring: Type.Object({}, { additionalProperties: false }) },
        preValidation: async (req, reply) => {
            if (req.url !== "/api/question-reply" || !Value.Check(BrowserQuestionReplySchema, req.body) || Buffer.byteLength(JSON.stringify(req.body.reply)) > questionLimits.replyBytes)
                return reply.code(400).send({ error: "Invalid questionnaire reply" });
        },
    }, async (req, reply) => {
        const body = req.body, cookie = req.cookies.c2!;
        if (!control.enter(body.instance)) return reply.code(429).send({ error: "Input admission limit" });
        let attempted = false;
        const abort = new AbortController();
        const departed = () => abort.abort();
        reply.raw.once("close", departed);
        const valid = () => !stopped && !req.raw.aborted && !reply.raw.destroyed && !abort.signal.aborted &&
            (sessions.get(cookie) ?? 0) > Date.now() && control.valid(body, cookie, body.lease);
        try {
            if (!valid()) return reply.code(409).send({ error: "Browser control unavailable" });
            const peer = await mutationGate(body, cookie);
            if (!peer || !valid()) return reply.code(409).send({ error: "Selected owner or browser control unavailable" });
            attempted = true;
            return await sendQuestionReply(options.runtime, peer, { instance: body.instance, generation: body.generation, reply: body.reply }, abort.signal);
        } catch {
            if (attempted) return { invocationId: body.reply.invocationId, replyId: body.reply.replyId, status: "uncertain" };
            return reply.code(409).send({ error: "Selected owner unavailable" });
        } finally { reply.raw.off("close", departed); control.leave(body.instance); }
    });
	// Reserve before Fastify collects/parses the large JSON body. No decoder/body waiting queue.
	let imageActive = false;
	const imageOperations = new WeakMap<FastifyRequest, { processing: boolean; departed: boolean; release: () => void }>();
	app.addHook("onResponse", async (req) => { imageOperations.get(req)?.release(); });
	app.addHook("onError", async (req) => {
		const op = imageOperations.get(req);
		if (op && !op.processing) op.release();
	});
	app.post<{ Body: BrowserImage }>("/api/image", {
		bodyLimit: imageBodyBytes,
		schema: { body: BrowserImageSchema, querystring: Type.Object({}, { additionalProperties: false }) },
		preValidation: async (req, reply) => {
			// Reject type coercion of authored fields before Fastify's schema validator.
			if (!Value.Check(BrowserImageSchema, req.body)) return reply.code(400).send({ error: "Invalid image input" });
		},
		onRequest: async (req, reply) => {
			if (req.url !== "/api/image") return reply.code(400).send({ error: "Image input must be query-free" });
			if (stopped || imageActive) return reply.code(429).send({ error: "Image operation already active" });
			imageActive = true;
			let released = false;
			const bodyTimer = setTimeout(() => req.raw.destroy(), 5_000);
			bodyTimer.unref();
			const op = { processing: false, departed: false, release: () => {
				if (released) return;
				released = true;
				clearTimeout(bodyTimer);
				imageActive = false;
			} };
			imageOperations.set(req, op);
			req.raw.once("end", () => clearTimeout(bodyTimer));
			reply.raw.once("close", () => {
				op.departed = true;
				// A disconnected body/parser must finish unwinding before another image is admitted.
				if (!op.processing) setImmediate(() => { if (!op.processing) op.release(); });
			});
		},
	}, async (req, reply) => {
		const op = imageOperations.get(req)!, body = req.body, cookie = req.cookies.c2!;
		op.processing = true;
		let entered = false, attempted = false;
		const valid = () => !stopped && !op.departed && !req.raw.aborted && !reply.raw.destroyed &&
			(sessions.get(cookie) ?? 0) > Date.now() && control.valid(body, cookie, body.lease);
		try {
			entered = control.enter(body.instance);
			if (!entered) return reply.code(429).send({ error: "Input admission limit" });
			if (!valid() || !(await mutationGate(body, cookie)) || !valid())
				return reply.code(409).send({ error: "Selected owner or browser control unavailable" });
			const normalized = await normalizeImage(body, () => !valid());
			if (!valid()) return reply.code(409).send({ error: "Image request no longer authorized" });
			const peer = await mutationGate(body, cookie);
			// Fresh discovery plus final cookie/lease/departure/stop checks immediately before fixed forwarding.
			if (!peer || !valid()) return reply.code(409).send({ error: "Selected owner or browser control unavailable" });
			attempted = true;
			return await sendImage(options.runtime, peer, {
				instance: body.instance, generation: body.generation, requestId: body.requestId,
				text: body.text, mime: body.mime, ...normalized,
			});
		} catch (error) {
			if (attempted) return { requestId: body.requestId, status: "uncertain", reason: "outcome-unconfirmed" };
			return reply.code(error instanceof ImageError ? 400 : 409).send({ error: error instanceof ImageError ? error.message : "Selected owner unavailable" });
		} finally {
			if (entered) control.leave(body.instance);
			// All started native promises have settled; no Promise.race/destroy shortcut.
			op.release();
		}
	});
	let activeMedia = 0;
	app.get<{ Params: { instance: string; generation: string; ref: string } }>(
		"/api/media/:instance/:generation/:ref",
		{
			schema: {
				querystring: Type.Object({}, { additionalProperties: false }),
				params: Type.Object(
					{
						instance: Type.String({ pattern: "^[a-f0-9]{32}$" }),
						generation: Type.String({ pattern: "^[a-f0-9]{32}$" }),
						ref: Type.String({ pattern: "^[a-f0-9]{32}$" }),
					},
					{ additionalProperties: false },
				),
			},
		},
		async (req, reply) => {
			const peer = peers.find(
				(p) =>
					p.registration.instance === req.params.instance &&
					p.registration.generation === req.params.generation,
			)?.registration;
			if (
				!peer ||
				req.params.instance !== peer.instance ||
				req.params.generation !== peer.generation
			)
				return reply.code(410).send({ error: "Image generation unavailable" });
			if (activeMedia >= 4)
				return reply.code(429).send({ error: "Image connection limit" });
			activeMedia++;
			let released = false;
			const release = () => {
				if (!released) {
					released = true;
					activeMedia--;
				}
			};
			reply.raw.once("close", release);
			try {
				// Recheck peer generation and native active-branch membership, never accept a path or remote URL.
				const current = await readSnapshot(options.runtime, peer);
				if (
					!current.items.some((item) =>
						item.blocks.some(
							(block) => block.type === "image" && block.ref === req.params.ref,
						),
					)
				) {
					release();
					return reply
						.code(410)
						.send({ error: "Native image is no longer in the active branch" });
				}
				const media = await peerResponse(
					options.runtime,
					peer,
					`/media/${peer.generation}/${req.params.ref}`,
				);
				const length = Number(media.headers["content-length"]),
					mime = media.headers["content-type"];
				if (
					media.statusCode !== 200 ||
					!["image/png", "image/jpeg", "image/webp"].includes(mime ?? "") ||
					!Number.isInteger(length) ||
					length < 1 ||
					length > limits.imageBytes
				) {
					media.destroy();
					release();
					return reply
						.code(410)
						.send({ error: "Native image stream unavailable" });
				}
				let bytes = 0;
				media.on("data", (chunk) => {
					bytes += chunk.length;
					if (bytes > length) media.destroy();
				});
				reply.raw.once("close", () => media.destroy());
				media.once("close", release);
				return reply
					.type(mime!)
					.header("content-length", length)
					.header("content-disposition", "inline")
					.header("x-content-type-options", "nosniff")
					.send(media);
			} catch {
				release();
				return reply.code(410).send({ error: "Native image peer unavailable" });
			}
		},
	);
	await app.register(staticFiles, {
		root: options.assets ?? fileURLToPath(new URL("../web/", import.meta.url)),
		index: "index.html",
		cacheControl: false,
	});
	app.addHook("preClose", async () => {
		stopped = true;
		clearInterval(timer);
		clearInterval(heartbeat);
		for (const stream of streams.values()) stream.close();
		streams.clear();
	});
	app.addHook("onClose", async () => {
		control.clear();
		sessions.clear();
		scopes.clear();
		peers = [];
	});
	return app;
}
