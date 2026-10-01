import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Value } from '@sinclair/typebox/value';
import { QuestionRequestSchema, questionLimits, type Identity, type QuestionRequest, type Questions, type PrivateQuestionReply, type QuestionReceipt } from '../shared/protocol.js';

// Documented package-specific channels, no runtime dependency on the questionnaire.
export const questionChannels = { request: 'rpiv:ask-user:request.v1', reply: 'rpiv:ask-user:reply.v1', outcome: 'rpiv:ask-user:reply-outcome.v1', closed: 'rpiv:ask-user:closed.v1' } as const;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function nativeQuestions(identity: Identity, ctx: ExtensionContext, events: ExtensionAPI['events'] | undefined, current: () => boolean) {
 const pending = new Map<string, { request: QuestionRequest; bytes: number }>();
 let alive = true, terminalOnly = false, bytes = 0, replying = false;
 const session = ctx.sessionManager.getSessionId(), file = ctx.sessionManager.getSessionFile();
 const valid = () => {
  try { return alive && current() && ctx.sessionManager.getSessionId() === session && ctx.sessionManager.getSessionFile() === file; }
  catch { return false; }
 };
 const waits = new Set<() => void>();
 const remove = [events?.on(questionChannels.request, (value) => {
  if (!valid()) return;
  try {
   // Count unknown append-only public fields too; never truncate a request's meaning.
   if (!Value.Check(QuestionRequestSchema, value)) { terminalOnly = true; return; }
   const json = JSON.stringify(value);
   if (!json || Buffer.byteLength(json) > questionLimits.requestBytes) { terminalOnly = true; return; }
   if (pending.has(value.invocationId)) return;
   const request: QuestionRequest = { invocationId: value.invocationId, questions: value.questions.map(q => ({ question: q.question, header: q.header, multiSelect: q.multiSelect, options: q.options.map(o => ({ label: o.label, description: o.description, ...(o.preview !== undefined ? { preview: o.preview } : {}) })) })) };
   const size = Buffer.byteLength(JSON.stringify(request));
   if (pending.size >= questionLimits.active || bytes + size > questionLimits.totalBytes) { terminalOnly = true; return; }
   pending.set(request.invocationId, { request, bytes: size }); bytes += size;
  } catch { terminalOnly = true; }
 }), events?.on(questionChannels.closed, (value) => {
  if (!valid() || !object(value) || typeof value.invocationId !== 'string' || !['terminal','external','aborted','shutdown','ended'].includes(String(value.reason))) return;
  const old = pending.get(value.invocationId);
  if (old) { bytes -= old.bytes; pending.delete(value.invocationId); }
 })];
 function state(): Questions { return { ...identity, terminalOnly, pending: valid() ? [...pending.values()].map(p => p.request) : [] }; }
 async function reply(body: PrivateQuestionReply, signal: AbortSignal): Promise<QuestionReceipt> {
  const payload = body.reply;
  const receipt = (status: QuestionReceipt['status']): QuestionReceipt => ({ invocationId: payload.invocationId, replyId: payload.replyId, status });
  if (!valid() || body.instance !== identity.instance || body.generation !== identity.generation || !pending.has(payload.invocationId)) return receipt('not-pending');
  if (replying || !events || signal.aborted) return receipt('uncertain');
  if (Buffer.byteLength(JSON.stringify(payload)) > questionLimits.replyBytes) return receipt('invalid');
  replying = true;
  // Subscribe before emit: public completion and closure can both occur synchronously.
  return new Promise(resolve => {
   let settled = false;
   let unsubscribe: (() => void) | undefined;
   const finish = (status: QuestionReceipt['status']) => {
    if (settled) return; settled = true; clearTimeout(timer); unsubscribe?.(); signal.removeEventListener('abort', abort); waits.delete(abort); replying = false; resolve(receipt(status));
   };
   const abort = () => finish('uncertain');
   const timer = setTimeout(abort, 1000); timer.unref();
   waits.add(abort); signal.addEventListener('abort', abort, { once: true });
   unsubscribe = events.on(questionChannels.outcome, value => {
    if (settled || !valid() || !object(value) || value.invocationId !== payload.invocationId || value.replyId !== payload.replyId) return;
    if (value.accepted === true && value.reason === undefined) finish('accepted');
    else if (value.accepted === false && value.reason === 'invalid_reply') finish('invalid');
   });
   try {
    if (!valid() || signal.aborted || !pending.has(payload.invocationId)) { finish('not-pending'); return; }
    events.emit(questionChannels.reply, payload);
   } catch { finish('uncertain'); }
  });
 }
 return { state, reply, close() { alive = false; for (const off of remove) off?.(); for (const end of [...waits]) end(); pending.clear(); bytes = 0; } };
}
