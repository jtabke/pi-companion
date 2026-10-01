/** Disposable C1-M instrumentation. Loaded only by run-native-media.py. */
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAssistantMessageEventStream, getCurrentTools,
  type AssistantMessage, type AssistantMessageEvent, type ImageContent,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const provider = "c1m-disposable-script";
const api = "c1m-disposable-stream";
const callId = "c1m-owned-read";
const finalText = "C1-M fixed final response.";

export default function (pi: ExtensionAPI) {
  const root = process.env.C1M_RUNTIME!;
  const phase = process.env.C1M_PHASE!;
  const tag = process.env.C1M_TAG!;
  if (!root || !tag || !["first", "reopen"].includes(phase)) throw new Error("probe environment required");
  const fixture = join(root, "cwd", "fixture.png");
  const bytes = readFileSync(fixture);
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const records: Record<string, unknown>[] = [];
  let requests = 0;
  let dispatched = false;
  let toolCalls = 0;
  let owner: ExtensionContext | undefined;
  function record(type: string, data: Record<string, unknown> = {}) {
    if (records.length >= 64) throw new Error("evidence bound");
    records.push({ type, ...data });
    const file = join(root, `${phase}-evidence.json`);
    writeFileSync(file + ".tmp", JSON.stringify(records), { mode: 0o600 });
    renameSync(file + ".tmp", file);
  }
  function requireCheck(condition: unknown, label: string): asserts condition {
    if (!condition) {
      record("failure", { label });
      owner?.shutdown();
      throw new Error("probe assertion failed");
    }
  }
  function imageSummary(content: unknown) {
    requireCheck(Array.isArray(content), "content array");
    const images = content.filter((block): block is ImageContent => block.type === "image");
    requireCheck(images.length === 1, "one image");
    const image = images[0];
    const decoded = Buffer.from(image.data, "base64");
    requireCheck(image.mimeType === "image/png" && decoded.equals(bytes), "exact PNG bytes");
    return { imageCount: 1, mimeType: image.mimeType, bytes: decoded.length, sha256: hash(decoded) };
  }
  function branch(ctx: ExtensionContext) {
    const entries = ctx.sessionManager.getBranch();
    const results = entries.filter(entry => entry.type === "message" && entry.message.role === "toolResult");
    requireCheck(results.length === 1, "one branch tool result");
    const entry = results[0];
    requireCheck(entry.type === "message" && entry.message.role === "toolResult", "tool result role");
    requireCheck(entry.message.toolName === "read" && entry.message.toolCallId === callId && !entry.message.isError, "branch native read");
    const messages = entries.filter(entry => entry.type === "message").map(entry => entry.message);
    requireCheck(messages.filter(message => message.role === "user").length === 1, "one native user message");
    const assistants = messages.filter(message => message.role === "assistant");
    requireCheck(assistants.length === 2 && assistants[0].stopReason === "toolUse" && assistants[1].stopReason === "stop", "two assistant responses");
    requireCheck(JSON.stringify(assistants[0].content) === JSON.stringify([{ type: "toolCall", id: callId, name: "read", arguments: { path: fixture } }]), "branch tool call");
    requireCheck(JSON.stringify(assistants[1].content) === JSON.stringify([{ type: "text", text: finalText }]), "branch final response");
    return {
      sessionId: ctx.sessionManager.getSessionId(),
      sessionFileSha256: hash(ctx.sessionManager.getSessionFile()!),
      entries: entries.map(entry => ({ id: entry.id, parentId: entry.parentId, type: entry.type, sha256: hash(JSON.stringify(entry)) })),
      resultEntryId: entry.id, toolCallId: callId, ...imageSummary(entry.message.content),
    };
  }
  pi.registerProvider(provider, {
    baseUrl: "http://c1m.invalid", // Metadata only: this adapter has no network implementation.
    apiKey: "c1m-dummy-not-a-secret", api,
    models: [{ id: "fixed", name: "Disposable fixed script", reasoning: false, input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 128 }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const number = ++requests;
      const output: AssistantMessage = {
        role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "pending", timestamp: Date.now(),
      };
      void (async () => {
        const emit = async (event: AssistantMessageEvent) => {
          if (options?.signal?.aborted) throw new Error("aborted");
          await options?.onProviderStreamEvent?.({ scripted: true, type: event.type }, model);
          stream.push(event);
        };
        try {
          requireCheck(phase === "first" && dispatched && number <= 2, "bounded scripted requests");
          requireCheck(model.provider === provider && model.id === "fixed" && model.api === api, "scripted model identity");
          requireCheck(getCurrentTools(context.messages).map(tool => tool.name).join() === "read", "only built-in read declared");
          const last = context.messages.at(-1);
          if (number === 1) {
            requireCheck(last?.role === "user" && JSON.stringify(last.content).includes(tag + ":native-read"), "first request input");
          } else {
            requireCheck(last?.role === "toolResult" && last.toolCallId === callId && !last.isError, "follow-up genuine result");
            record("provider_image", imageSummary(last.content));
          }
          const payload = { scripted: true, response: number };
          const replacement = await options?.onPayload?.(payload, model);
          requireCheck(replacement === undefined || JSON.stringify(replacement) === JSON.stringify(payload), "fixed payload");
          await options?.onResponse?.({ status: 200, headers: { "x-c1m-scripted": "true" } }, model);
          record("scripted_request", { number });
          await emit({ type: "start", partial: output });
          if (number === 1) {
            const toolCall = { type: "toolCall" as const, id: callId, name: "read", arguments: {} };
            output.content.push(toolCall);
            await emit({ type: "toolcall_start", contentIndex: 0, partial: output });
            toolCall.arguments = { path: fixture };
            await emit({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(toolCall.arguments), partial: output });
            await emit({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
            output.stopReason = "toolUse";
          } else {
            const text = { type: "text" as const, text: "" };
            output.content.push(text);
            await emit({ type: "text_start", contentIndex: 0, partial: output });
            text.text = finalText;
            await emit({ type: "text_delta", contentIndex: 0, delta: finalText, partial: output });
            await emit({ type: "text_end", contentIndex: 0, content: finalText, partial: output });
            output.stopReason = "stop";
          }
          await emit({ type: "done", reason: output.stopReason, message: output });
        } catch {
          record("stream_error", { number });
          output.stopReason = options?.signal?.aborted ? "aborted" : "error";
          output.errorMessage = "Disposable script rejected request";
          stream.push({ type: "error", reason: output.stopReason, error: output });
        } finally {
          stream.end();
        }
      })();
      return stream;
    },
  });
  pi.on("session_start", (_event, ctx) => {
    owner = ctx;
    requireCheck(ctx.mode === "tui" && ctx.hasUI && ctx.sessionManager.getSessionFile(), "persistent real TUI");
    requireCheck(pi.getActiveTools().join() === "read", "active read only");
    record("ready", { realTUI: true, phase, fixtureSha256: hash(bytes), ...(phase === "reopen" ? { branch: branch(ctx) } : {}) });
  });
  pi.on("input", (event) => {
    const label = ["terminal-before", "terminal-after"].find(label => event.text === tag + ":" + label);
    if (label) {
      requireCheck(event.source === "interactive" && !event.images?.length, "terminal fixture input");
      record("terminal", { label, source: event.source });
      return { action: "handled" };
    }
    requireCheck(phase === "first" && dispatched && event.source === "extension" && event.text === tag + ":native-read", "normal native input only");
    record("native_input", { source: event.source });
    return { action: "continue" };
  });
  pi.on("tool_call", event => {
    toolCalls++;
    requireCheck(phase === "first" && toolCalls === 1 && event.toolName === "read" && event.toolCallId === callId && !event.parentToolCallId && JSON.stringify(event.input) === JSON.stringify({ path: fixture }), "owned native tool call only");
    record("tool_call", { toolName: event.toolName, toolCallId: event.toolCallId });
  });
  pi.on("tool_execution_end", event => {
    requireCheck(event.toolName === "read" && event.toolCallId === callId && !event.parentToolCallId && !event.isError, "native tool execution");
    record("tool_image", { toolCallId: event.toolCallId, ...imageSummary(event.result.content) });
  });
  pi.on("message_end", event => {
    if (event.message.role === "toolResult") {
      requireCheck(event.message.toolCallId === callId && event.message.toolName === "read" && !event.message.isError, "finalized native read result");
      record("message_image", { toolCallId: event.message.toolCallId, ...imageSummary(event.message.content) });
    }
  });
  pi.on("agent_settled", (_event, ctx) => {
    requireCheck(phase === "first" && requests === 2 && toolCalls === 1 && !ctx.hasPendingMessages(), "settled bounded turn");
    record("settled", { requests, toolCalls, branch: branch(ctx) });
  });
  pi.registerCommand("c1m-read", {
    description: "Run the one owned native image read",
    handler: async (_args, ctx) => {
      requireCheck(phase === "first" && !dispatched && ctx.isIdle(), "one dispatch");
      dispatched = true;
      const returned = pi.sendUserMessage(tag + ":native-read");
      record("dispatch", { returnedVoid: returned === undefined });
    },
  });
  pi.registerCommand("c1m-finish", {
    description: "Inspect branch and shut down disposable owner",
    handler: async (_args, ctx) => {
      requireCheck(ctx.isIdle() && !ctx.hasPendingMessages(), "idle shutdown");
      record("finished", { requests, toolCalls, branch: branch(ctx) });
      ctx.shutdown();
    },
  });
  pi.on("session_shutdown", () => record("shutdown", { requests, toolCalls }));
}
