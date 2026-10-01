import React, { useRef, useState } from 'react';
import type { Identity, QuestionRequest, Questions, QuestionReply, QuestionReceipt } from '../../src/shared/protocol.js';
type Fields = { kind: 'decline' | 'option' | 'multi' | 'custom' | 'null'; answer: string; selected: string[]; notes: string };
type Form = { fields: Fields[]; globalNote: string };
const keyOf = (owner?: Identity) => owner ? `${owner.instance}:${owner.generation}` : '';
const freshId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
function QuestionForm({ request, disabled, submitDisabled, submit, Markdown }: { request: QuestionRequest; disabled: boolean; submitDisabled: boolean; submit: (reply: Omit<QuestionReply, 'replyId'>) => void; Markdown: React.ComponentType<{ text: string }> }) {
 const [form, setForm] = useState<Form>(() => ({ fields: request.questions.map(() => ({ kind: 'decline', answer: '', selected: [], notes: '' })), globalNote: '' }));
 const change = (index: number, update: Partial<Fields>) => setForm(old => ({ ...old, fields: old.fields.map((field, i) => i === index ? { ...field, ...update } : field) }));
 function send(cancelled: boolean) {
  const answers: QuestionReply['answers'] = [];
  form.fields.forEach((field, questionIndex) => {
   const base = { questionIndex, ...(field.notes ? { notes: field.notes } : {}) };
   if (field.kind === 'option' && request.questions[questionIndex].options.some(option => option.label === field.answer)) answers.push({ ...base, kind: 'option', answer: field.answer });
   else if (field.kind === 'multi') answers.push({ ...base, kind: 'multi', answer: null, selected: [...field.selected] });
   else if (field.kind === 'custom' || field.kind === 'null' || field.notes) answers.push({ ...base, kind: 'custom', answer: field.kind === 'custom' ? field.answer : null });
  });
  submit({ invocationId: request.invocationId, cancelled, answers, ...(form.globalNote ? { globalNote: form.globalNote } : {}) });
 }
 return <form className="question-form" aria-label="Pending questionnaire" onSubmit={e => { e.preventDefault(); if (!submitDisabled) send(false); }}>
  {request.questions.map((question, index) => {
   const field = form.fields[index], prefix = `${request.invocationId}-${index}`;
   return <fieldset key={index}>
    <legend>{question.header}</legend><Markdown text={question.question} />
    <label>Response for {question.header}<select disabled={disabled} value={field.kind} onChange={e => change(index, { kind: e.target.value as Fields['kind'] })}>
     <option value="decline">Leave unanswered</option><option value={question.multiSelect ? 'multi' : 'option'}>Choose options</option><option value="custom">Free response</option><option value="null">Decline (null response)</option>
    </select></label>
    {question.options.map((option, i) => <div className="question-option" key={i}>
     <label htmlFor={`${prefix}-${i}`}><input id={`${prefix}-${i}`} type={question.multiSelect ? 'checkbox' : 'radio'} name={prefix} disabled={disabled}
      checked={question.multiSelect ? field.kind === 'multi' && field.selected.includes(option.label) : field.kind === 'option' && field.answer === option.label}
      onChange={e => change(index, question.multiSelect ? { kind: 'multi', selected: e.target.checked ? [...field.selected, option.label] : field.selected.filter(label => label !== option.label) } : { kind: 'option', answer: option.label })} />{option.label}</label>
     <Markdown text={option.description} />{option.preview !== undefined && <div aria-label={`Preview: ${option.label}`} className="question-preview"><Markdown text={option.preview} /></div>}
    </div>)}
    <label>Free response for {question.header}<textarea disabled={disabled} maxLength={8192} value={field.answer} onChange={e => change(index, { kind: 'custom', answer: e.target.value })} /></label>
    <label>Optional note for {question.header}<textarea disabled={disabled} maxLength={8192} value={field.notes} onChange={e => change(index, { notes: e.target.value })} /></label>
   </fieldset>;
  })}
  <label>Optional questionnaire note<textarea disabled={disabled} maxLength={8192} value={form.globalNote} onChange={e => setForm(old => ({ ...old, globalNote: e.target.value }))} /></label>
  <button disabled={submitDisabled}>Submit questionnaire</button> <button type="button" disabled={submitDisabled} onClick={() => send(true)}>Cancel questionnaire</button>
 </form>;
}
export function QuestionPanel({ identity, state, canAnswer, authority, busy, Markdown }: {
 identity?: Identity; state?: Questions; canAnswer: boolean;
 authority: () => { lease: string; epoch: number } | undefined;
 busy: (value: boolean) => void;
 Markdown: React.ComponentType<{ text: string }>;
}) {
 const [attempt, setAttempt] = useState<{ identity: Identity; original: Omit<QuestionReply, 'replyId'>; uncertain: boolean }>();
 const [status, setStatus] = useState('');
 const active = useRef({ key: keyOf(identity), epoch: authority()?.epoch });
 active.current = { key: keyOf(identity), epoch: authority()?.epoch };
 const sending = useRef(false);
 // Forms are bounded by the four observed live requests; exact generation/invocation keys own them.
 const currentState = state && keyOf(state) === keyOf(identity) ? state : undefined;
 const pendingOriginal = attempt && keyOf(attempt.identity) === keyOf(identity) && currentState?.pending.some(p => p.invocationId === attempt.original.invocationId);
 async function send(original: Omit<QuestionReply, 'replyId'>, repeat = false) {
  const auth = authority(), owner = repeat ? attempt?.identity : identity;
  if (!owner || !auth || !canAnswer || sending.current || (attempt?.uncertain && !repeat) || !currentState?.pending.some(p => p.invocationId === original.invocationId) || keyOf(owner) !== keyOf(identity)) return;
  const frozen = JSON.parse(JSON.stringify(original)) as Omit<QuestionReply, 'replyId'>;
  const payload = { ...frozen, replyId: freshId() };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 65536) { setStatus('Reply exceeds 65,536 bytes; shorten notes or responses'); return; }
  const pending = { identity: { ...owner }, original: frozen, uncertain: !!repeat };
  setAttempt(pending); sending.current = true; busy(true);
  const label = `Questionnaire for instance ${owner.instance.slice(0,8)} · generation ${owner.generation.slice(0,8)} · invocation ${original.invocationId}`;
  setStatus(`${label}: submitting; completion unknown`);
  try {
   const response = await fetch('/api/question-reply', { method: 'POST', headers: { 'content-type': 'application/json', 'x-c2-csrf': 'input' }, body: JSON.stringify({ ...owner, lease: auth.lease, reply: payload }) });
   const result = await response.json() as QuestionReceipt;
   // A stale response may retain uncertainty, but cannot establish new-scope/reclaimed authority or success UI.
   if (active.current.key !== keyOf(owner) || active.current.epoch !== auth.epoch) throw Error('Authority changed');
   if (!response.ok) {
    setAttempt(repeat ? { ...pending, uncertain: true } : undefined);
    setStatus(`${label}: ${repeat ? 'Uncertain — repeat rejected; original completion unknown' : 'Rejected before forwarding'}`); return;
   }
   if (result.replyId !== payload.replyId || result.invocationId !== payload.invocationId || !['accepted','invalid','uncertain','not-pending'].includes(result.status)) throw Error('Invalid receipt');
   if (result.status === 'uncertain' || (repeat && result.status !== 'accepted')) {
    setAttempt({ ...pending, uncertain: true }); setStatus(`${label}: Uncertain — no automatic retry`);
   } else {
    setAttempt(undefined); setStatus(`${label}: ${result.status === 'accepted' ? 'Accepted by same live completion callback (not native dispatch or persistence)' : result.status === 'invalid' ? 'Invalid reply — correct the form; still pending' : 'No longer pending — no browser-won inference'}`);
   }
  } catch { setAttempt({ ...pending, uncertain: true }); setStatus(`${label}: Uncertain — response lost or authority changed; no automatic retry`); }
  finally { sending.current = false; busy(false); }
 }
 return <section aria-label="Supported questionnaires" className="questions">
  <h2>Supported questionnaires</h2>
  <p>Only opted-in supported requests observed by this bridge appear here. Other or missed prompts stay in the terminal.</p>
  {currentState?.terminalOnly && <p role="status">Observation limit reached — some requests are terminal-only for this generation. No live request was evicted.</p>}
  {currentState?.pending.map(request => <QuestionForm key={`${keyOf(identity)}:${request.invocationId}`} request={request} disabled={!canAnswer} submitDisabled={!canAnswer || !!attempt?.uncertain} submit={reply => void send(reply)} Markdown={Markdown} />)}
  {status && <p role="status">{status}</p>}
  {attempt?.uncertain && <>
   <p>Original answer retained separately from form edits. {pendingOriginal ? 'Original invocation is still observed pending.' : 'Original invocation no longer observed here; completion remains unknown.'}</p>
   <button disabled={!canAnswer || !pendingOriginal} onClick={() => void send(attempt.original, true)}>Repeat original questionnaire reply</button>
   <button disabled={sending.current} onClick={() => { setAttempt(undefined); setStatus('Uncertain reply dismissed locally; nothing sent'); }}>Dismiss uncertain questionnaire reply locally</button>
  </>}
 </section>;
}
