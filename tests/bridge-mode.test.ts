import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import bridgeExtension from "../src/extension/bridge.js";
import {
	discover,
	readQuestions,
	readStatus,
	sendStop,
	sendRename,
	sendText,
} from "../src/gateway/peer.js";
import { ownerStat } from "../src/shared/runtime.js";
import { questionChannels } from "../src/extension/questions.js";
import { context, questionBus, questionRequest } from "./fixture.js";

type Lifecycle =
	| "session_start"
	| "session_shutdown"
	| "agent_start"
	| "agent_end"
	| "agent_settled";
type Handler = (
	event: { type: Lifecycle },
	ctx: ExtensionContext,
) => void | Promise<void>;
const headlessModes = ["print", "json", "rpc"] as const;
function modeContext(mode: ExtensionContext["mode"]) {
	return Object.assign(context(), {
		mode,
		hasUI: mode === "rpc",
		abort: vi.fn(),
	});
}
function extensionFixture() {
	const handlers = new Map<Lifecycle, Handler>();
	const events = questionBus(),
		send = vi.fn(),
		settings = vi.fn(() => ({})),
		setSessionName = vi.fn();
	const api = {
		on: (name: Lifecycle, handler: Handler) => {
			handlers.set(name, handler);
		},
		events,
		sendUserMessage: send,
		getSettings: settings,
		setSessionName,
	} as unknown as ExtensionAPI;
	return {
		load: () => bridgeExtension(api),
		events,
		send,
		settings,
		setSessionName,
		emit: async (type: Lifecycle, ctx = modeContext("print")) => {
			await handlers.get(type)?.({ type }, ctx);
		},
	};
}

describe("bridgeExtension terminal-only lifecycle", () => {
	let root: string, runtime: string;
	let extensions: ReturnType<typeof extensionFixture>[];
	beforeEach(() => {
		// Keep actual UDS paths below the platform limit, including Darwin's canonical /private prefix.
		root = mkdtempSync("/tmp/bm-");
		runtime = join(root, "runtime");
		extensions = [];
		vi.stubEnv("C2_RUNTIME", runtime);
	});
	afterEach(async () => {
		try {
			await Promise.all(
				extensions.map((extension) => extension.emit("session_shutdown")),
			);
		} finally {
			vi.unstubAllEnvs();
			rmSync(root, { recursive: true, force: true });
		}
	});

	function load() {
		const extension = extensionFixture();
		extensions.push(extension); // Cleanup remains registered even if loading or an assertion fails.
		extension.load();
		return extension;
	}
	async function published() {
		const found = await discover(runtime);
		expect(found.overLimit).toBe(false);
		expect(found.peers).toHaveLength(1);
		return found.peers[0]!.registration;
	}
	function noSubscriptions(extension: ReturnType<typeof extensionFixture>) {
		expect(
			[...extension.events.handlers.values()].every(
				(handlers) => handlers.size === 0,
			),
		).toBe(true);
	}

	it("declares only the built bridge as a Pi resource", () => {
		const manifest = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		);
		expect(manifest.pi).toEqual({ extensions: ["./dist/extension/bridge.js"] });
	});

	it("factory registration and shutdown leave a nonexistent runtime untouched", async () => {
		const extension = load();
		expect(existsSync(runtime)).toBe(false);
		noSubscriptions(extension);
		await extension.emit("session_shutdown");
		await extension.emit("session_shutdown");
		expect(readdirSync(root)).toEqual([]);
		expect(extension.send).not.toHaveBeenCalled();
		expect(extension.settings).not.toHaveBeenCalled();
	});

	it.each(headlessModes)(
		"%s lifecycle creates no runtime, socket, registration or native owner",
		async (mode) => {
			const extension = load(),
				ctx = modeContext(mode);
			await extension.emit("session_start", ctx);
			for (const event of [
				"agent_start",
				"agent_end",
				"agent_settled",
				"session_shutdown",
				"session_shutdown",
			] as const)
				await extension.emit(event, ctx);
			expect(readdirSync(root)).toEqual([]);
			noSubscriptions(extension);
			expect(extension.send).not.toHaveBeenCalled();
			expect(extension.settings).not.toHaveBeenCalled();
			expect(ctx.abort).not.toHaveBeenCalled();
		},
	);

	it("factory and non-TUI modes do not even validate the runtime path", async () => {
		vi.stubEnv("C2_RUNTIME", "not-an-absolute-runtime");
		const extension = load();
		for (const mode of headlessModes)
			await extension.emit("session_start", modeContext(mode));
		await extension.emit("session_shutdown");
		expect(readdirSync(root)).toEqual([]);
		noSubscriptions(extension);
	});

	it("TUI publishes a reachable private owner, wires native events, and shuts down idempotently", async () => {
		const extension = load(),
			ctx = modeContext("tui"); // hasUI is deliberately false: mode owns the gate.
		await extension.emit("session_start", ctx);
		const reg = await published();
		ownerStat(runtime, "directory");
		ownerStat(join(runtime, `b-${reg.instance}.json`), "file");
		ownerStat(join(runtime, `b-${reg.generation}.sock`), "socket");
		expect((await readStatus(runtime, reg)).summary.parent).toBe("idle");
		expect((await readStatus(runtime, reg)).summary.rename).toBe(true);
		const rename = {
			instance: reg.instance,
			generation: reg.generation,
			requestId: "c".repeat(32),
			name: "Public API manual title",
		};
		expect((await sendRename(runtime, reg, rename)).status).toBe("dispatched");
		expect((await sendRename(runtime, reg, rename)).status).toBe("dispatched");
		expect(extension.setSessionName).toHaveBeenCalledExactlyOnceWith(
			"Public API manual title",
		);
		expect(extension.send).not.toHaveBeenCalled();
		const body = {
			instance: reg.instance,
			generation: reg.generation,
			requestId: "a".repeat(32),
			text: "terminal fixture input",
		};
		expect((await sendText(runtime, reg, body)).status).toBe("dispatched");
		expect((await sendText(runtime, reg, body)).status).toBe("dispatched");
		expect(extension.send).toHaveBeenCalledExactlyOnceWith(body.text, {
			expandPromptTemplates: false,
		});
		extension.events.emit(questionChannels.request, questionRequest());
		expect((await readQuestions(runtime, reg)).pending).toEqual([
			questionRequest(),
		]);
		ctx.isIdle = () => false;
		expect(
			(
				await sendStop(runtime, reg, {
					instance: reg.instance,
					generation: reg.generation,
					requestId: "b".repeat(32),
				})
			).status,
		).toBe("dispatched");
		expect(ctx.abort).toHaveBeenCalledOnce();
		ctx.isIdle = () => true;
		await extension.emit("agent_end", ctx);
		expect((await readStatus(runtime, reg)).summary.stop).toBe("stopping");
		await extension.emit("agent_settled", ctx);
		expect((await readStatus(runtime, reg)).summary.stop).toBe(
			"parent-settled",
		);
		await extension.emit("session_shutdown", ctx);
		await extension.emit("session_shutdown", ctx);
		expect(readdirSync(runtime)).toEqual([]);
		expect((await discover(runtime)).peers).toEqual([]);
		await expect(readStatus(runtime, reg)).rejects.toThrow();
		noSubscriptions(extension);
	});

	it("new TUI generations invalidate the prior socket, input ledger and pending questions", async () => {
		const extension = load();
		await extension.emit("session_start", modeContext("tui"));
		const old = await published();
		const body = {
			instance: old.instance,
			generation: old.generation,
			requestId: "a".repeat(32),
			text: "first generation",
		};
		await sendText(runtime, old, body);
		extension.events.emit(questionChannels.request, questionRequest());
		await extension.emit("session_start", modeContext("tui"));
		const next = await published();
		expect(next.instance).toBe(old.instance);
		expect(next.generation).not.toBe(old.generation);
		expect(next.capability).not.toBe(old.capability);
		expect(existsSync(join(runtime, `b-${old.generation}.sock`))).toBe(false);
		await expect(readStatus(runtime, old)).rejects.toThrow();
		expect((await readQuestions(runtime, next)).pending).toEqual([]);
		expect((await sendText(runtime, next, body)).reason).toBe("stale");
		expect(
			(
				await sendText(runtime, next, {
					...body,
					generation: next.generation,
					text: "new generation",
				})
			).status,
		).toBe("dispatched");
		expect(extension.send).toHaveBeenCalledTimes(2);
		expect(readdirSync(runtime).sort()).toEqual(
			[`b-${next.generation}.sock`, `b-${next.instance}.json`].sort(),
		);
	});

	it.each(headlessModes)(
		"TUI to %s removes the active owner before non-TUI lifecycle and permits a fresh TUI",
		async (mode) => {
			const extension = load();
			await extension.emit("session_start", modeContext("tui"));
			const old = await published();
			const ctx = modeContext(mode);
			await extension.emit("session_start", ctx);
			expect(readdirSync(runtime)).toEqual([]);
			expect((await discover(runtime)).peers).toEqual([]);
			await expect(readStatus(runtime, old)).rejects.toThrow();
			noSubscriptions(extension);
			rmSync(runtime, { recursive: true });
			for (const event of [
				"agent_start",
				"agent_end",
				"agent_settled",
				"session_start",
				"session_shutdown",
			] as const)
				await extension.emit(event, ctx);
			expect(existsSync(runtime)).toBe(false);
			await extension.emit("session_start", modeContext("tui"));
			const next = await published();
			expect(next.instance).toBe(old.instance);
			expect(next.generation).not.toBe(old.generation);
		},
	);

	it("reload factory stays lazy while preserving process identity and replacing native generation", async () => {
		const oldExtension = load();
		await oldExtension.emit("session_start", modeContext("tui"));
		const old = await published();
		await oldExtension.emit("session_shutdown");
		rmSync(runtime, { recursive: true });
		const reloaded = load();
		expect(existsSync(runtime)).toBe(false);
		await reloaded.emit("session_start", modeContext("tui"));
		const next = await published();
		expect(next.instance).toBe(old.instance);
		expect(next.generation).not.toBe(old.generation);
		await oldExtension.emit("session_shutdown");
		expect(await published()).toEqual(next);
	});
});
