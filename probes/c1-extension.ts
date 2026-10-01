// Disposable C1 instrumentation; the runner replaces only the public package entry path.
import questionnaire, { ASK_USER_PROMPT_EVENT, ASK_USER_BLOCKED_EVENT } from __QUESTIONNAIRE_ENTRY__;
import { appendFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const root = process.env.C1_RUNTIME!;
  const tag = process.env.C1_TAG!;
  const record = (type: string, data: object = {}) =>
    appendFileSync(join(root, "evidence.jsonl"), JSON.stringify({ type, ...data }) + "\n", { mode: 0o600 });
  let tool: ToolDefinition | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const counters = { beforeAgentStart: 0, agentStart: 0, providerRequest: 0 };
  const receipts: string[] = [];
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

  // Capture the public definition, forwarding registration unchanged. No ctx.ui patch.
  questionnaire({ ...pi, registerTool(definition: ToolDefinition) {
    pi.registerTool(definition);
    if (definition.name === "ask_user_question") tool = definition;
  } });
  pi.events.on(ASK_USER_PROMPT_EVENT, (payload: any) => record("question_prompt", { payload }));
  pi.events.on(ASK_USER_BLOCKED_EVENT, (payload: any) => record("question_blocked", { active: payload.active }));
  pi.on("ui_prompt_start", (event) => record("ui_start", { kind: event.kind }));
  pi.on("ui_prompt_end", (event) => record("ui_end", { kind: event.kind }));
  pi.on("before_agent_start", () => { counters.beforeAgentStart++; });
  pi.on("agent_start", () => { counters.agentStart++; });
  pi.on("before_provider_request", () => { counters.providerRequest++; });
  pi.on("input", (event) => {
    const label = ["external", "terminal-before", "terminal-after"].find((label) => event.text === `${tag}:${label}`);
    if (!label) return { action: "continue" };
    receipts.push(label);
    record("input_handled", {
      label, source: event.source, imageCount: event.images?.length ?? 0,
      imageMatches: label === "external" ? event.images?.[0]?.data === png && event.images?.[0]?.mimeType === "image/png" : undefined,
    });
    return { action: "handled" };
  });
  pi.on("session_start", (_event, ctx) => {
    record("ready", {
      mode: ctx.mode, hasUI: ctx.hasUI, toolCaptured: !!tool,
      sessionIdAvailable: !!ctx.sessionManager.getSessionId(),
      ephemeral: ctx.sessionManager.getSessionFile() === undefined,
      branchAvailable: Array.isArray(ctx.sessionManager.getBranch()),
    });
    // A one-shot file trigger from the owning runner; no endpoint or product protocol.
    timer = setInterval(() => {
      const trigger = join(root, "deliver");
      if (!existsSync(trigger)) return;
      unlinkSync(trigger);
      clearInterval(timer);
      timer = undefined;
      const result = pi.sendUserMessage([
        { type: "text", text: `${tag}:external` },
        { type: "image", data: png, mimeType: "image/png" },
      ]);
      record("send_return", { isUndefined: result === undefined });
    }, 50);
  });
  pi.registerCommand("c1-question", {
    description: "Run the published questionnaire without a model (C1 instrumentation)",
    handler: async (_args, ctx) => {
      if (!tool || ctx.mode !== "tui") throw new Error("C1 requires the captured tool and TUI");
      // Direct definition invocation bypasses normal tool hooks/persistence. This tool
      // uses ExtensionContext fields only; no fabricated executeTool/tools methods.
      const result = await tool.execute("c1-disposable", { questions: [{
        question: "C1 fixture: which surface answers?", header: "C1 fixture",
        options: [
          { label: "Terminal", description: "Normal PTY Enter key", preview: "C1 fixture preview" },
          { label: "Browser", description: "Not a supported reply interface" },
        ],
      }] }, undefined, undefined, ctx as ExtensionToolContext);
      record("question_result", { details: result.details });
    },
  });
  pi.registerCommand("c1-finish", {
    description: "Record bounded C1 checks and shut down",
    handler: async (_args, ctx) => {
      const branch = ctx.sessionManager.getBranch();
      record("finished", {
        counters, receipts,
        nativeUserMessages: branch.filter((entry) => entry.type === "message" && entry.message.role === "user").length,
        pending: ctx.hasPendingMessages(),
      });
      ctx.shutdown();
    },
  });
  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer);
    record("shutdown");
  });
}
