import {
	mkdtempSync,
	chmodSync,
	mkdirSync,
	lstatSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { createBridge } from "../dist/extension/bridge.js";
import { installNativeCommands } from "../dist/extension/native-commands.js";
import { createGateway } from "../dist/gateway/server.js";
import { createServer } from "node:net";
import { basename, dirname, isAbsolute, join } from "node:path";
const suppliedSocket = process.env.C2_PAIR_SOCKET;
if (
	!suppliedSocket ||
	!isAbsolute(suppliedSocket) ||
	basename(suppliedSocket) !== "issue.sock"
)
	throw Error("Fixture requires an absolute private issuance socket");
const suppliedRoot = dirname(suppliedSocket);
const ipcRoot = join(
	realpathSync(dirname(suppliedRoot)),
	basename(suppliedRoot),
);
// Exclusive creation is the only cleanup authority; an existing supplied root is never adopted.
mkdirSync(ipcRoot, { mode: 0o700 });
const rootIdentity = lstatSync(ipcRoot),
	issuancePath = join(ipcRoot, "issue.sock");
let socketIdentity,
	rootRemoved = false;
const sameIdentity = (stat, owned) =>
	stat.dev === owned.dev && stat.ino === owned.ino && stat.uid === owned.uid;
function ownsIssuanceRoot() {
	try {
		const root = lstatSync(ipcRoot);
		if (
			!root.isDirectory() ||
			root.uid !== process.getuid() ||
			(root.mode & 0o777) !== 0o700 ||
			!sameIdentity(root, rootIdentity)
		)
			return false;
		let socket;
		try {
			socket = lstatSync(issuancePath);
		} catch (error) {
			if (error.code === "ENOENT") return true;
			throw error;
		}
		return (
			!!socketIdentity &&
			socket.isSocket() &&
			(socket.mode & 0o777) === 0o600 &&
			sameIdentity(socket, socketIdentity)
		);
	} catch {
		return false;
	}
}
function removeOwnedRoot() {
	if (rootRemoved) return true;
	if (!ownsIssuanceRoot()) return false;
	rmSync(ipcRoot, { recursive: true });
	rootRemoved = true;
	return true;
}
// Startup failures also clean only our still-identical root, before any external root can be touched.
process.once("exit", () => {
	if (!removeOwnedRoot()) process.exitCode = 1;
});
const runtime = mkdtempSync(join(ipcRoot, "runtime-"));
chmodSync(runtime, 0o700);
const png = Buffer.from(
	"89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc0000003010100c9fe92ef0000000049454e44ae426082",
	"hex",
);
import { EventEmitter } from "node:events";
import { questionChannels } from "../dist/extension/questions.js";
const emitter = new EventEmitter();
const bus = {
	on(channel, handler) {
		emitter.on(channel, handler);
		return () => emitter.off(channel, handler);
	},
	emit: (channel, value) => emitter.emit(channel, value),
};
let question,
	questionMode = "accept",
	replies = [];
bus.on(questionChannels.reply, (reply) => {
	if (!question || reply.invocationId !== question.invocationId) return;
	replies.push(reply);
	if (questionMode === "lost") return;
	if (questionMode === "invalid") {
		bus.emit(questionChannels.outcome, {
			invocationId: reply.invocationId,
			replyId: reply.replyId,
			accepted: false,
			reason: "invalid_reply",
		});
		return;
	}
	bus.emit(questionChannels.outcome, {
		invocationId: reply.invocationId,
		replyId: reply.replyId,
		accepted: true,
	});
	bus.emit(questionChannels.closed, {
		invocationId: reply.invocationId,
		reason: "external",
	});
	question = undefined;
});
let dispatches = 0,
	aborts = 0,
	working = false,
	pending = false,
	throwAbort = false;
let lastText;
let primaryName = "Browser test",
	renames = 0,
	ignoreRename = false,
	secondaryName = "Browser other",
	otherRenames = 0,
	otherRenameCapable = false;
let nativeEnabled = false,
	terminalDraft = "";
const nativeRequests = [];
const commandModels = [
	{ provider: "fixture", id: "first", name: "Fixture first" },
	{ provider: "fixture", id: "second", name: "Fixture second" },
	...Array.from({ length: 18 }, (_, index) => ({
		provider: "fixture",
		id: `extra-${index + 3}`,
		name: `Fixture model ${index + 3}`,
	})),
];
const bridge = createBridge(
	runtime,
	undefined,
	(content, options) => {
		dispatches++;
		if (typeof content === "string")
			lastText = { text: content, options: { ...options } };
	},
	() => ({ images: { blockImages: false } }),
	bus,
	() => [
		{
			name: "review",
			description: "Review a controlled diff",
			source: "prompt",
			sourceInfo: { path: "/private/fixture/review.md" },
		},
		{
			name: "revise",
			description: "Revise controlled text",
			source: "prompt",
			sourceInfo: { path: "/private/fixture/revise.md" },
		},
		{
			name: "skill:fixture",
			description: "Controlled skill",
			source: "skill",
			sourceInfo: { path: "/private/fixture/SKILL.md" },
		},
		{
			name: "terminal",
			description: "Controlled extension UI",
			source: "extension",
			sourceInfo: { path: "/private/fixture/extension.ts" },
		},
	],
	(name) => {
		renames++;
		if (!ignoreRename) primaryName = name;
		else throw Error("after public rename attempt");
	},
	(ctx) => (nativeEnabled ? installNativeCommands(ctx) : undefined),
);
const entries = [
	{
		type: "message",
		id: "browser-native-tool",
		message: {
			role: "toolResult",
			toolName: "read",
			content: [
				{
					type: "text",
					text: "Controlled browser fixture\n\n![remote](https://example.invalid/image.png)\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
				},
				{ type: "image", mimeType: "image/png", data: png.toString("base64") },
				{ type: "image", mimeType: "image/png", data: "bad" },
			],
		},
	},
];
function fixture(name, text) {
	return {
		cwd: "/controlled/project",
		model: { input: ["text", "image"] },
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: {
			getSessionId: () => name,
			getBranch: () =>
				entries.map((entry) => ({
					...entry,
					message: {
						...entry.message,
						content: entry.message.content.map((block) =>
							block.type === "text"
								? { ...block, text: text + block.text }
								: block,
						),
					},
				})),
			getSessionFile: () => undefined,
			getSessionName: () => name,
		},
	};
}
const primary = fixture("Browser test", "Owner A · "),
	secondary = fixture("Browser other", "Owner B · ");
primary.sessionManager.getSessionName = () => primaryName;
secondary.sessionManager.getSessionName = () => secondaryName;
primary.isIdle = () => !working;
primary.hasPendingMessages = () => pending;
let editorFactory = () => ({
	onSubmit: (text) => {
		nativeRequests.push(text);
	},
});
primary.ui = {
	getEditorComponent: () => editorFactory,
	setEditorComponent: (factory) => {
		editorFactory = factory;
		factory({}, {}, {}).onSubmit = (text) => {
			nativeRequests.push(text);
		};
	},
	getEditorText: () => terminalDraft,
};
primary.modelRegistry = { getAvailable: () => commandModels };
primary.abort = () => {
	aborts++;
	if (throwAbort) throw Error("after public attempt");
}; // Deliberately ignores abort: never native proof.
let other = createBridge(runtime),
	otherRegistration;
await bridge.start(primary);
let app;
// Fixture mutations finish only after lightweight discovery publishes the replacement generation.
async function waitPublishedGeneration(reg, req) {
	const deadline = performance.now() + 3000;
	while (true) {
		const view = (
			await app.inject({
				url: "/api/snapshot",
				headers: { host: req.headers.host, cookie: req.headers.cookie },
			})
		).json();
		if (
			view.sessions.some(
				(owner) =>
					owner.instance === reg.instance &&
					owner.generation === reg.generation,
			)
		)
			return;
		if (performance.now() >= deadline)
			throw Error("Fixture generation publication deadline");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
async function startGateway() {
	app = await createGateway({
		runtime,
		port: 4393,
		stateDirectory: runtime + "/auth",
	});

	app.post("/api/fixture/question", async (req) => {
		const { action } = req.body;
		if (action === "new") {
			question = {
				invocationId: globalThis.crypto.randomUUID(),
				questions: [
					{
						question:
							"Full **authored** question? <script>evil()</script> ![remote](https://example.invalid/secret.png) [bad](javascript:evil())",
						header: "Single",
						multiSelect: false,
						options: [
							{
								label: "Exact A",
								description: "Description A",
								preview: "```text\nFull preview A\n```",
							},
							{ label: "Exact B", description: "Description B" },
						],
					},
					{
						question: "Multiple choices?",
						header: "Multi",
						multiSelect: true,
						options: [
							{ label: "One", description: "First" },
							{ label: "Two", description: "Second" },
						],
					},
				],
			};
			questionMode = "accept";
			bus.emit(questionChannels.request, question);
		}
		if (action === "terminal" && question) {
			bus.emit(questionChannels.closed, {
				invocationId: question.invocationId,
				reason: "terminal",
			});
			question = undefined;
		}
		if (action === "lost" || action === "invalid" || action === "accept")
			questionMode = action;
		if (action === "reload") {
			question = undefined;
			await waitPublishedGeneration(await bridge.start(primary, "reload"), req);
		}
		return { question, replies };
	});
	app.post("/api/fixture/reload", async () => {
		await other.start(secondary);
		return { ok: true };
	});
	app.post("/api/fixture/disconnect", async () => {
		await other.close();
		return { ok: true };
	});
	app.post("/api/fixture/restore", async () => {
		await other.start(secondary);
		return { ok: true };
	});
	app.post("/api/fixture/rename-state", async (req) => {
		if (req.body.action === "reset") {
			primaryName = "Browser test";
			renames = 0;
			ignoreRename = false;
			secondaryName = "Browser other";
			otherRenames = 0;
			if (otherRenameCapable) {
				await other.close();
				other = createBridge(runtime, otherRegistration.instance);
				otherRegistration = await other.start(secondary);
				otherRenameCapable = false;
				await waitPublishedGeneration(otherRegistration, req);
			}
		}
		if (req.body.action === "capable-other") {
			await other.close();
			other = createBridge(
				runtime,
				otherRegistration.instance,
				undefined,
				undefined,
				undefined,
				undefined,
				(name) => {
					otherRenames++;
					secondaryName = name;
				},
			);
			otherRegistration = await other.start(secondary);
			otherRenameCapable = true;
			await waitPublishedGeneration(otherRegistration, req);
		}
		if (req.body.action === "apply") ignoreRename = false;
		if (req.body.action === "terminal-name")
			primaryName = "Terminal changed title";
		if (req.body.action === "ignore") ignoreRename = true;
		if (req.body.action === "unnamed") primaryName = undefined;
		if (req.body.action === "literal") primaryName = "Unnamed session";
		return { ok: true };
	});
	app.get("/api/fixture/dispatches", async () => ({
		dispatches,
		renames,
		primaryName,
		otherRenames,
		secondaryName,
		aborts,
		lastText,
		nativeRequests,
	}));
	app.post("/api/fixture/native-state", async (req) => {
		if (req.body.action === "draft") {
			terminalDraft = req.body.text;
			return { ok: true };
		}
		nativeEnabled = req.body.action === "enable";
		terminalDraft = "";
		nativeRequests.length = 0;
		working = pending = false;
		editorFactory = () => ({
			onSubmit: (text) => {
				nativeRequests.push(text);
			},
		});
		await waitPublishedGeneration(await bridge.start(primary), req);
		return { ok: true };
	});
	app.post("/api/fixture/stop-state", async (req) => {
		const action = req.body.action;
		if (action === "reset") {
			working = false;
			pending = false;
			throwAbort = false;
			await waitPublishedGeneration(await bridge.start(primary), req);
		}
		if (action === "work") {
			working = true;
			bridge.observe("agent_start", primary);
		}
		if (action === "throw") throwAbort = true;
		if (action === "idle" || action === "end" || action === "settled")
			working = false;
		if (action === "pending") pending = true;
		if (action === "no-pending") pending = false;
		if (action === "end") bridge.observe("agent_end", primary);
		if (action === "settled") bridge.observe("agent_settled", primary);
		return { ok: true, aborts };
	});
	app.post("/api/fixture/restart", async () => {
		const old = app;
		setTimeout(() => {
			void old
				.close()
				.then(startGateway)
				.catch((error) => {
					console.error(error);
					process.exitCode = 1;
				});
		}, 50).unref();
		return { ok: true };
	});
	const publicSockets = new Set();
	app.server.on("connection", (socket) => {
		publicSockets.add(socket);
		socket.on("close", () => publicSockets.delete(socket));
	});
	app.post("/api/fixture/break-transport", async () => {
		const prior = [...publicSockets];
		setTimeout(() => {
			for (const socket of prior) socket.destroy();
		}, 50).unref();
		return { ok: true };
	});
	const realNow = Date.now;
	app.post("/api/fixture/clock", async (req) => {
		const now = realNow();
		Date.now = req.body?.freeze ? () => now : realNow;
		return { ok: true };
	});
	await app.listen({ host: "127.0.0.1", port: 4393 });
}
otherRegistration = await other.start(secondary);
await startGateway();
const issuance = createServer({ allowHalfOpen: true }, (socket) => {
	let text = "";
	socket.setTimeout(4000, () => socket.destroy());
	socket.on("error", () => {});
	socket.on("data", (chunk) => {
		text += chunk;
		if (text.length > 6) {
			socket.destroy();
			return;
		}
		if (text === "issue\n") {
			try {
				socket.end(app.pairing.issueCode().code + "\n");
			} catch {
				socket.destroy();
			}
		}
	});
});
issuance.maxConnections = 8;
const umask = process.umask(0o177);
try {
	await new Promise((resolve, reject) => {
		issuance.once("error", reject);
		issuance.listen(issuancePath, resolve);
	});
} finally {
	process.umask(umask);
}
socketIdentity = lstatSync(issuancePath);
process.once("SIGTERM", () => {
	if (!ownsIssuanceRoot()) process.exit(1);
	void app
		.close()
		.then(() => bridge.close())
		.then(() => other.close())
		.then(async () => {
			// Do not even close/unlink by path if the root or socket has been replaced.
			if (!ownsIssuanceRoot()) process.exit(1);
			await new Promise((resolve) => issuance.close(resolve));
			process.exit(removeOwnedRoot() ? 0 : 1);
		});
});
