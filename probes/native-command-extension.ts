import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
	CustomEditor,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

// Isolated instrumentation only. Never load into a working terminal.
export default function (pi: ExtensionAPI) {
	const generation = randomUUID();
	const log = (type: string, fields: Record<string, unknown> = {}) =>
		appendFileSync(
			join(process.env.COMMAND_PROBE_ROOT!, "events.jsonl"),
			JSON.stringify({ type, generation, pid: process.pid, ...fields }) + "\n",
		);
	pi.registerProvider("command-fixture", {
		baseUrl: "http://fixture.invalid",
		api: "openai-completions",
		apiKey: "fixture-not-a-secret",
		models: ["first", "second"].map((id) => ({
			id,
			name: `Fixture ${id}`,
			reasoning: false,
			input: ["text" as const],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100000,
			maxTokens: 128,
		})),
		streamSimple() {
			log("provider_attempt");
			throw Error("Provider calls forbidden");
		},
	});
	class ExistingProbeEditor extends CustomEditor {
		handleInput(data: string) {
			log("terminal_editor_input");
			super.handleInput(data);
		}
	}
	pi.on("session_start", (event, ctx) => {
		ctx.ui.setEditorComponent(
			(tui, theme, keys) => new ExistingProbeEditor(tui, theme, keys),
		);
		if (event.reason === "startup") {
			pi.sendMessage({
				customType: "command-seed",
				content: "Previous conversation fixture",
				display: true,
			});
			ctx.ui.setEditorText("unsent terminal fixture");
		}
		log("ready", {
			reason: event.reason,
			session: ctx.sessionManager.getSessionId(),
		});
	});
	pi.on("session_shutdown", (event) => {
		log("shutdown", { reason: event.reason });
	});
	pi.on("input", (event) => {
		log("unexpected_input", { source: event.source, text: event.text });
		return { action: "handled" };
	});
	pi.on("before_agent_start", () => {
		log("before_agent_start");
	});
	pi.on("agent_start", () => {
		log("agent_start");
	});
	pi.registerCommand("command-probe-check", {
		description: "Observe disposable terminal state",
		handler: async (args, ctx) => {
			log("terminal_command", {
				args,
				session: ctx.sessionManager.getSessionId(),
				model: ctx.model?.id,
				seedPresent: ctx.sessionManager
					.getBranch()
					.some(
						(entry) =>
							entry.type === "custom_message" &&
							entry.customType === "command-seed",
					),
			});
		},
	});
}
