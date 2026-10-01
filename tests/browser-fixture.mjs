import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { createBridge } from "../dist/extension/bridge.js";
import { createGateway } from "../dist/gateway/server.js";
const runtime = mkdtempSync("/tmp/c2-b-");
chmodSync(runtime, 0o700);
const png = Buffer.from(
	"89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc0000003010100c9fe92ef0000000049454e44ae426082",
	"hex",
);
import { EventEmitter } from "node:events";
import { questionChannels } from "../dist/extension/questions.js";
const emitter = new EventEmitter();
const bus = { on(channel, handler) { emitter.on(channel, handler); return () => emitter.off(channel, handler); }, emit: (channel, value) => emitter.emit(channel, value) };
let question, questionMode = "accept", replies = [];
bus.on(questionChannels.reply, reply => {
 if (!question || reply.invocationId !== question.invocationId) return;
 replies.push(reply);
 if (questionMode === "lost") return;
 if (questionMode === "invalid") { bus.emit(questionChannels.outcome, { invocationId: reply.invocationId, replyId: reply.replyId, accepted: false, reason: "invalid_reply" }); return; }
 bus.emit(questionChannels.outcome, { invocationId: reply.invocationId, replyId: reply.replyId, accepted: true });
 bus.emit(questionChannels.closed, { invocationId: reply.invocationId, reason: "external" }); question = undefined;
});
let dispatches = 0, aborts = 0, working = false, pending = false, throwAbort = false;
const bridge = createBridge(runtime, undefined, () => {
	dispatches++;
}, () => ({ images: { blockImages: false } }), bus);
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
primary.isIdle = () => !working;
primary.hasPendingMessages = () => pending;
primary.abort = () => { aborts++; if (throwAbort) throw Error("after public attempt"); }; // Deliberately ignores abort: never native proof.
const other = createBridge(runtime);
await bridge.start(primary);
let app;
// Fixture mutations finish only after lightweight discovery publishes the replacement generation.
async function waitPublishedGeneration(reg, req) {
 const deadline = performance.now() + 3000;
 while (true) {
  const view = (await app.inject({ url: '/api/snapshot', headers: { host: req.headers.host, cookie: req.headers.cookie } })).json();
  if (view.sessions.some(owner => owner.instance === reg.instance && owner.generation === reg.generation)) return;
  if (performance.now() >= deadline) throw Error('Fixture generation publication deadline');
  await new Promise(resolve => setTimeout(resolve, 20));
 }
}
async function startGateway() {
	app = await createGateway({
		runtime,
		port: 4393,
		secret: "browser-fixture-secret",
	});

 app.post('/api/fixture/question', async req => {
  const { action } = req.body;
  if (action === 'new') {
   question = { invocationId: globalThis.crypto.randomUUID(), questions: [
    { question: 'Full **authored** question? <script>evil()</script> ![remote](https://example.invalid/secret.png) [bad](javascript:evil())', header: 'Single', multiSelect: false, options: [{ label: 'Exact A', description: 'Description A', preview: '```text\nFull preview A\n```' }, { label: 'Exact B', description: 'Description B' }] },
    { question: 'Multiple choices?', header: 'Multi', multiSelect: true, options: [{ label: 'One', description: 'First' }, { label: 'Two', description: 'Second' }] }
   ] }; questionMode = 'accept'; bus.emit(questionChannels.request, question);
  }
  if (action === 'terminal' && question) { bus.emit(questionChannels.closed, { invocationId: question.invocationId, reason: 'terminal' }); question = undefined; }
  if (action === 'lost' || action === 'invalid' || action === 'accept') questionMode = action;
  if (action === 'reload') {
question = undefined; await waitPublishedGeneration(await bridge.start(primary), req);
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
	app.get("/api/fixture/dispatches", async () => ({ dispatches, aborts }));
	app.post("/api/fixture/stop-state", async req => {
		const action = req.body.action;
		if (action === "reset") { working = false; pending = false; throwAbort = false; await waitPublishedGeneration(await bridge.start(primary), req); }
		if (action === "work") { working = true; bridge.observe("agent_start", primary); }
		if (action === "throw") throwAbort = true;
		if (action === "idle" || action === "end" || action === "settled") working = false;
		if (action === "pending") pending = true;
		if (action === "no-pending") pending = false;
		if (action === "end") bridge.observe("agent_end", primary);
		if (action === "settled") bridge.observe("agent_settled", primary);
		return { ok: true, aborts };
	});
	app.post("/api/fixture/restart", async () => {
		const old = app;
		setTimeout(() => {
			void old.close().then(startGateway).catch((error) => { console.error(error); process.exitCode = 1; });
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
await other.start(secondary);
await startGateway();
process.once(
	"SIGTERM",
	() =>
		void app
			.close()
			.then(() => bridge.close())
			.then(() => other.close())
			.then(() => {
				rmSync(runtime, { recursive: true, force: true });
				process.exit(0);
			}),
);
