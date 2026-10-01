/** Opt-in C4 fixture: two child responses/one read; background parent gets one completion acknowledgement. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
	createAssistantMessageEventStream,
	getCurrentTools,
	type AssistantMessage,
	type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const root = process.env.C1M_RUNTIME!,
		tag = process.env.C1M_TAG!;
	if (!root || !tag || process.env.C1M_PHASE !== "first")
		throw Error("isolated input fixture required");
	const backgroundMode = process.env.C4_BACKGROUND === "1";
	const childMode = backgroundMode && process.env.PI_SUBAGENT_CHILD === "1";
	const fixture = join(root, "cwd", "fixture.png"),
		bytes = readFileSync(fixture);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const imageMode = process.env.C4_IMAGE === "1", stopMode = process.env.C4_STOP === "1";
	if (Number(imageMode) + Number(stopMode) + Number(backgroundMode) > 1) throw Error("isolated modes required");
	const submitted = () => readFileSync(join(root, "submitted-normalized.png"));
	const inputImage = (content: { type: string; data?: string; mimeType?: string }[]) => {
		const images = content.filter((block) => block.type === "image");
		check(imageMode ? images.length === 1 && images[0].mimeType === "image/png" && Buffer.from(images[0].data!, "base64").equals(submitted()) : images.length === 0);
		return imageMode ? createHash("sha256").update(submitted()).digest("hex") : undefined;
	};
	const records: Record<string, unknown>[] = [];
	let requests = 0,
		toolCalls = 0,
		inputs = 0,
		responses = 0;
	let completionNotice: string | undefined;
	async function ownedCompletion() {
		const starts = records.filter(r => r.type === "subagent:async-started");
		const child = starts.filter(r => r.mode === "single"), workflow = starts.filter(r => r.mode === "workflow");
		check(child.length === 1 && workflow.length === 1 && starts.length === 2);
		const childId = child[0].id as string, workflowId = workflow[0].id as string;
		check(child[0].parentWorkflowRunId === workflowId);
		const statusFiles = [child[0], workflow[0]].map(start => {
			const directory = resolve(start.asyncDir as string);
			check(directory.startsWith(resolve(root) + sep));
			return join(directory, "status.json");
		});
		const cleanup = existsSync(join(root, "cleanup-child"));
		const deadline = Date.now() + 15_000;
		let statuses: { runId: string; state: string; parentWorkflowRunId?: string; steps?: { runId?: string }[] }[];
		for (;;) {
			statuses = statusFiles.map(file => {
				check(statSync(file).size <= 65536);
				return JSON.parse(readFileSync(file, "utf8"));
			});
			check(statuses[0].runId === childId && statuses[1].runId === workflowId);
			if (statuses.every(status => ["complete", "stopped", "failed"].includes(status.state))) break;
			check(Date.now() < deadline, "native terminal acknowledgement deadline");
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		check(statuses[0].parentWorkflowRunId === workflowId && statuses[1].steps?.length === 1 && statuses[1].steps[0].runId === childId);
		const outcome = statuses[1].state;
		check(records.some(r => r.type === "subagent:async-complete" && r.runId === workflowId && r.state === outcome));
		if (cleanup) {
			check(["stopped", "failed"].includes(outcome) && statuses.every(status => ["stopped", "failed"].includes(status.state)), "cleanup acknowledges failed/stopped native work only");
		} else {
			check(statuses.every(status => status.state === "complete") && existsSync(join(root, "release-child")));
			check(records.some(r => r.type === "subagent:async-complete" && r.runId === childId && r.success === true && r.awaitedByWorkflow === true && r.parentWorkflowRunId === workflowId));
			check(records.some(r => r.type === "subagent:async-complete" && r.runId === workflowId && r.success === true));
			const evidenceFile = join(root, "child-evidence.json");
			check(statSync(evidenceFile).size <= 65536);
			const childRecords = JSON.parse(readFileSync(evidenceFile, "utf8")) as Record<string, unknown>[];
			check(childRecords.some(r => r.type === "settled" && r.requests === 2 && r.responses === 2 && r.toolCalls === 1 && r.inputs === 1));
			check(!childRecords.some(r => r.type === "failure" || r.type === "stream_error"));
		}
		return { childId, workflowId, outcome, cleanup };
	}
	function record(type: string, data: Record<string, unknown> = {}) {
		if (records.length >= 64) throw Error("evidence limit");
		records.push({ type, ...data });
		const file = join(root, childMode ? "child-evidence.json" : "first-evidence.json");
		writeFileSync(file + ".tmp", JSON.stringify(records), { mode: 0o600 });
		renameSync(file + ".tmp", file);
	}
	function check(condition: unknown, constraint = "fixed fixture contract") {
		if (!condition) {
			record("failure", backgroundMode ? { constraint } : {});
			throw Error("fixed input fixture rejected event");
		}
	}
	function branch(ctx: ExtensionContext) {
		const entries = ctx.sessionManager.getBranch();
		const users = entries.filter(
			(e) => e.type === "message" && e.message.role === "user",
		);
		const result = entries.find(
			(e) => e.type === "message" && e.message.role === "toolResult",
		);
		check(
			users.length === 1 &&
				result?.type === "message" &&
				result.message.role === "toolResult",
		);
		if (
			!result ||
			result.type !== "message" ||
			result.message.role !== "toolResult"
		)
			throw Error("native result missing");
		check(
			result.message.toolCallId === "c4-owned-read" && !result.message.isError,
		);
		const image = result.message.content.find((b) => b.type === "image");
		check(
			image?.type === "image" &&
				Buffer.from(image.data, "base64").equals(bytes),
		);
		const user = users[0];
		check(user?.type === "message" && user.message.role === "user");
		if (user.type !== "message" || user.message.role !== "user") throw Error("native user missing");
		const submittedSha256 = inputImage(Array.isArray(user.message.content) ? user.message.content : []);
		return { resultEntryId: result.id, userEntryId: user.id, sha256, userCount: users.length, ...(imageMode ? { submittedSha256 } : {}) };
	}
	pi.registerProvider("c1m-disposable-script", {
		baseUrl: "http://c4.invalid",
		apiKey: "fixture-only",
		api: "c4-fixed-stream",
		models: [
			{
				id: "fixed",
				name: "C4 fixed local responses",
				reasoning: false,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100000,
				maxTokens: 128,
			},
		],
		streamSimple(model, context, options) {
			const stream = createAssistantMessageEventStream(),
				number = ++requests;
			const output: AssistantMessage = {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "pending",
				timestamp: Date.now(),
			};
			void (async () => {
				const emit = async (event: AssistantMessageEvent) => {
					if (childMode && existsSync(join(root, "cleanup-child")) && options?.signal?.aborted) throw Error("native cleanup abort");
					check(!options?.signal?.aborted);
					await options?.onProviderStreamEvent?.(
						{ scripted: true, type: event.type },
						model,
					);
					stream.push(event);
				};
				try {
					const acknowledgement = backgroundMode && !childMode;
					check(
						(acknowledgement ? inputs === 0 && toolCalls === 0 && number === 1 : inputs === 1) &&
							number <= 2 &&
							model.provider === "c1m-disposable-script" &&
							model.id === "fixed" &&
							model.api === "c4-fixed-stream",
					);
					if (!acknowledgement) check(
						getCurrentTools(context.messages).map(t => t.name).sort().join() === (childMode ? "contact_supervisor,read" : "read"),
						"provider tool declaration must match the exact native fixture loadout",
					);
					const last = context.messages.at(-1);
					if (acknowledgement) {
						const completion = await ownedCompletion();
						check(completionNotice && records.filter(r => r.type === "native_completion_notice").length === 1 && last?.role === "user" && Array.isArray(last.content) && last.content.length === 1 && last.content[0].type === "text" && last.content[0].text === completionNotice, "one native matching completion wake only");
						record(completion.cleanup ? "cleanup_parent_acknowledgement" : "parent_acknowledgement", completion);
					} else check(
						number === 1
							? last?.role === "user" &&
									JSON.stringify(last.content).includes(tag + ":native-read")
							: last?.role === "toolResult" &&
									last.toolCallId === "c4-owned-read" &&
									!last.isError,
					);
					if (!acknowledgement && number === 1 && last?.role === "user" && Array.isArray(last.content)) {
						const submittedSha256 = inputImage(last.content);
						if (imageMode) record("provider_image", { submittedSha256 });
					}
					const payload = { scripted: true, response: number };
					const replacement = await options?.onPayload?.(payload, model);
					check(
						replacement === undefined ||
							JSON.stringify(replacement) === JSON.stringify(payload),
					);
					await options?.onResponse?.(
						{ status: 200, headers: { "x-c4-fixed": "true" } },
						model,
					);
					record("scripted_request", { number });
					await emit({ type: "start", partial: output });
					if (number === 1 && !acknowledgement) {
						const toolCall = {
							type: "toolCall" as const,
							id: "c4-owned-read",
							name: "read",
							arguments: {},
						};
						output.content.push(toolCall);
						await emit({
							type: "toolcall_start",
							contentIndex: 0,
							partial: output,
						});
						toolCall.arguments = { path: fixture };
						await emit({
							type: "toolcall_delta",
							contentIndex: 0,
							delta: JSON.stringify(toolCall.arguments),
							partial: output,
						});
						await emit({
							type: "toolcall_end",
							contentIndex: 0,
							toolCall,
							partial: output,
						});
						output.stopReason = "toolUse";
					} else {
						const text = { type: "text" as const, text: "" };
						output.content.push(text);
						await emit({
							type: "text_start",
							contentIndex: 0,
							partial: output,
						});
						text.text = acknowledgement ? "C4 fixed parent acknowledgement." : stopMode ? "C4 held response." : "C4 fixed final response.";
						await emit({
							type: "text_delta",
							contentIndex: 0,
							delta: text.text,
							partial: output,
						});
						await emit({
							type: "text_end",
							contentIndex: 0,
							content: text.text,
							partial: output,
						});
						if (childMode) {
							record("held_response");
							const deadline = Date.now() + 180_000;
							while (!existsSync(join(root, "release-child"))) {
								if (existsSync(join(root, "cleanup-child")) && options?.signal?.aborted) throw Error("native cleanup abort");
								check(Date.now() < deadline && !options?.signal?.aborted);
								await new Promise(resolve => setTimeout(resolve, 50));
							}
							record("released_response");
						}
						if (stopMode) {
							const signal = options?.signal;
							check(signal && !signal.aborted);
							record("held_response");
							await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true }));
							record("provider_aborted", { number });
							output.stopReason = "aborted";
							output.errorMessage = "Fixed held response aborted";
							stream.push({ type: "error", reason: "aborted", error: output });
							return;
						}
						output.stopReason = "stop";
					}
					await emit({
						type: "done",
						reason: output.stopReason,
						message: output,
					});
					if (backgroundMode) record("fixed_response", { number, responses: ++responses });
				} catch {
					const cleanupAbort = childMode && existsSync(join(root, "cleanup-child")) && options?.signal?.aborted;
					record(cleanupAbort ? "cleanup_provider_aborted" : "stream_error", { number });
					output.stopReason = cleanupAbort ? "aborted" : "error";
					output.errorMessage = cleanupAbort ? "Native fixture cleanup stop" : "Fixed fixture rejected input";
					stream.push({ type: "error", reason: cleanupAbort ? "aborted" : "error", error: output });
				} finally {
					stream.end();
				}
			})();
			return stream;
		},
	});
	pi.on("session_start", (_event, ctx) => {
		if (childMode) record("child_contract", { mode: ctx.mode, hasUI: ctx.hasUI, nativeSessionPresent: !!ctx.sessionManager.getSessionFile(), toolNames: pi.getActiveTools().slice(0, 10) });
		check(
			(childMode ? ctx.mode === "print" && !ctx.hasUI : ctx.mode === "tui" && ctx.hasUI) &&
				ctx.sessionManager.getSessionFile() &&
				(backgroundMode && !childMode ? pi.getActiveTools().includes("read") : pi.getActiveTools().slice().sort().join() === (childMode ? "contact_supervisor,read" : "read")),
			"native mode/session and read-only fixture tool contract",
		);
		record("ready", backgroundMode ? { child: childMode, pid: process.pid } : {});
		if (childMode) pi.events.emit("subagent:acknowledge-extension", { id: "c4-fixed-provider" });
	});
	if (backgroundMode && !childMode) {
		for (const event of ["subagent:async-started", "subagent:async-complete"]) {
			pi.events.on(event, (value: unknown) => {
				const data = value as Record<string, unknown>;
				record(event, Object.fromEntries(["id", "runId", "pid", "mode", "asyncDir", "success", "state", "awaitedByWorkflow", "parentWorkflowRunId", "triggerTurn"].filter(key => data[key] !== undefined).map(key => [key, data[key]])));
			});
		}
		pi.on("message_start", async event => {
			if (event.message.role !== "custom" || event.message.customType !== "subagent-notify") return;
			const { childId, workflowId, outcome, cleanup } = await ownedCompletion();
			check(!completionNotice && typeof event.message.content === "string" && event.message.content.length <= 16000);
			const text = event.message.content as string;
			check(text.startsWith(`Background task ${outcome === "complete" ? "completed" : outcome}: **workflow**`) && text.includes(`Workflow run: ${workflowId}`) && (cleanup || text.includes(`run=${childId} status=completed`)), "native notification correlation");
			completionNotice = text; // In-memory only; never record notification text/paths.
			record("native_completion_notice", { childId, workflowId, outcome, cleanup });
		});
		// Documented owning-session status RPC, never a launch or private executor.
		pi.registerCommand("c4-status", {
			description: "Inspect this disposable run using public package status",
			handler: async (id, ctx) => {
				check(/^[A-Za-z0-9_-]{1,128}$/.test(id));
				const requestId = "c4-status-" + records.length;
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(() => { dispose(); reject(Error("status deadline")); }, 10_000);
					const dispose = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (value: unknown) => {
						clearTimeout(timer); dispose();
						const reply = value as { success: boolean; data?: { text?: string; details?: { mode?: string }; asyncSnapshot?: { runs: { id: string; state: string }[] } } };
						check(reply.success && reply.data?.asyncSnapshot && reply.data.details?.mode === "single" && typeof reply.data.text === "string" && reply.data.text.length <= 65536);
						// Targeted status exposes exact Run/State/Workflow parent text; snapshot roots are a separate projection.
						const text = reply.data!.text!;
						const runs = [...text.matchAll(/^Run: ([a-f0-9-]{36})$/gm)], states = [...text.matchAll(/^State: (running|complete|stopped|failed)$/gm)], parents = [...text.matchAll(/^Workflow parent: ([a-f0-9-]{36})(?: \([^\n]*\))?$/gm)];
						check(runs.length === 1 && runs[0][1] === id && states.length === 1 && parents.length === 1);
						record("package_status", { id, target: { runId: runs[0][1], state: states[0][1], parentWorkflowRunId: parents[0][1] }, snapshotRoots: reply.data!.asyncSnapshot!.runs.map(run => ({ id: run.id, state: run.state })), parentIdle: ctx.isIdle(), requests, toolCalls });
						resolve();
					});
					pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: "status", params: { id } });
				});
			},
		});
	}
	pi.on("input", (event) => {
		const label = ["terminal-before", "terminal-after"].find(
			(label) => event.text === tag + ":" + label,
		);
		if (label) {
			check(event.source === "interactive" && !event.images?.length);
			record("terminal", { label });
			return { action: "handled" };
		}
		check(
			++inputs === 1 &&
				(childMode ? event.source === "interactive" : event.source === "extension") &&
				(childMode ? event.text.includes(tag + ":native-read") : event.text === tag + ":native-read") &&
				(!backgroundMode || childMode) &&
				(imageMode ? event.images?.length === 1 : !event.images?.length),
		);
		const submittedSha256 = inputImage(event.images ?? []);
		record("native_input", { source: event.source, ...(imageMode ? { submittedSha256 } : {}) });
		return { action: "continue" };
	});
	pi.on("tool_call", (event) => {
		check(
			(!backgroundMode || childMode) && ++toolCalls === 1 &&
				event.toolName === "read" &&
				event.toolCallId === "c4-owned-read" &&
				!event.parentToolCallId &&
				JSON.stringify(event.input) === JSON.stringify({ path: fixture }),
		);
		record("tool_call");
	});
	pi.on("agent_settled", async (_event, ctx) => {
		if (backgroundMode && !childMode) {
			check(requests === 1 && responses === 1 && toolCalls === 0 && inputs === 0 && ctx.isIdle() && !ctx.hasPendingMessages());
			const completion = await ownedCompletion();
			record(completion.cleanup ? "cleanup_parent_acknowledgement_settled" : "parent_acknowledgement_settled", { requests, responses, toolCalls, inputs, ...completion });
			return;
		}
		if (childMode && existsSync(join(root, "cleanup-child"))) {
			check(requests <= 2 && responses <= requests && toolCalls <= 1 && inputs <= 1 && ctx.isIdle() && !ctx.hasPendingMessages());
			record("cleanup_child_settled", { requests, responses, toolCalls, inputs });
			return;
		}
		check(requests === 2 && toolCalls === 1 && ctx.isIdle() && !ctx.hasPendingMessages());
		if (stopMode) check(records.some(r => r.type === "provider_aborted"));
		record("settled", { requests, ...(backgroundMode ? { responses } : {}), toolCalls, inputs, parentIdle: ctx.isIdle(), pending: ctx.hasPendingMessages(), branch: branch(ctx) });
	});
	pi.registerCommand("c1m-finish", {
		description: "Finish disposable input fixture",
		handler: async (_args, ctx) => {
			check(ctx.isIdle() && !ctx.hasPendingMessages());
			if (backgroundMode) check(!childMode && requests === (completionNotice ? 1 : 0) && responses === requests && toolCalls === 0 && inputs === 0);
			record("finished", { requests, ...(backgroundMode ? { responses } : {}), toolCalls, inputs, ...(backgroundMode ? {} : { branch: branch(ctx) }) });
			ctx.shutdown();
		},
	});
	pi.on("session_shutdown", () =>
		record("shutdown", { requests, toolCalls, inputs }),
	);
}
