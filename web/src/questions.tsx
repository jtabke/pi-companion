import React, { useRef, useState } from "react";
import type {
	Identity,
	QuestionRequest,
	Questions,
	QuestionReply,
} from "../../src/shared/protocol.js";
import type { QuestionnaireCommand } from "./use-browser-session.js";
type Fields = {
	kind: "decline" | "option" | "multi" | "custom" | "null";
	answer: string;
	selected: string[];
	notes: string;
};
type Form = { fields: Fields[]; globalNote: string };
const keyOf = (owner?: Identity) =>
	owner ? `${owner.instance}:${owner.generation}` : "";
function QuestionForm({
	request,
	disabled,
	submitDisabled,
	submit,
	Markdown,
}: {
	request: QuestionRequest;
	disabled: boolean;
	submitDisabled: boolean;
	submit: (reply: Omit<QuestionReply, "replyId">) => void;
	Markdown: React.ComponentType<{ text: string }>;
}) {
	const [form, setForm] = useState<Form>(() => ({
		fields: request.questions.map(() => ({
			kind: "decline",
			answer: "",
			selected: [],
			notes: "",
		})),
		globalNote: "",
	}));
	const [reviewing, setReviewing] = useState(false);
	const change = (index: number, update: Partial<Fields>) => {
		setReviewing(false);
		setForm((old) => ({
			...old,
			fields: old.fields.map((field, i) =>
				i === index ? { ...field, ...update } : field,
			),
		}));
	};
	function reply(cancelled: boolean): Omit<QuestionReply, "replyId"> {
		const answers: QuestionReply["answers"] = [];
		form.fields.forEach((field, questionIndex) => {
			const base = {
				questionIndex,
				...(field.notes ? { notes: field.notes } : {}),
			};
			if (
				field.kind === "option" &&
				request.questions[questionIndex].options.some(
					(option) => option.label === field.answer,
				)
			)
				answers.push({ ...base, kind: "option", answer: field.answer });
			else if (field.kind === "multi")
				answers.push({
					...base,
					kind: "multi",
					answer: null,
					selected: [...field.selected],
				});
			else if (field.kind === "custom" || field.kind === "null" || field.notes)
				answers.push({
					...base,
					kind: "custom",
					answer: field.kind === "custom" ? field.answer : null,
				});
		});
		return {
			invocationId: request.invocationId,
			cancelled,
			answers,
			...(form.globalNote ? { globalNote: form.globalNote } : {}),
		};
	}
	const currentReply = reply(false);
	const unanswered = request.questions.filter(
		(_, index) =>
			!currentReply.answers.some((answer) => answer.questionIndex === index),
	);
	return (
		<form
			className="question-form"
			aria-label="Pending questionnaire"
			onSubmit={(e) => {
				e.preventDefault();
				if (submitDisabled) return;
				if (unanswered.length) setReviewing(true);
				else submit(reply(false));
			}}
		>
			{request.questions.map((question, index) => {
				const field = form.fields[index],
					prefix = `${request.invocationId}-${index}`;
				return (
					<fieldset key={index}>
						<legend>{question.header}</legend>
						<Markdown text={question.question} />
						<p>
							{question.multiSelect
								? "Select any options, or choose another response."
								: "Select one option, or choose another response."}
						</p>
						{question.options.map((option, i) => {
							const selected = question.multiSelect
								? field.kind === "multi" &&
									field.selected.includes(option.label)
								: field.kind === "option" && field.answer === option.label;
							const select = () =>
								change(
									index,
									question.multiSelect
										? {
												kind: "multi",
												selected: selected
													? field.selected.filter(
															(label) => label !== option.label,
														)
													: [...field.selected, option.label],
											}
										: { kind: "option", answer: option.label },
								);
							return (
								<div className="question-option" key={i}>
									<div
										className={`question-card${selected ? " selected" : ""}`}
										onClick={(e) => {
											// Authored links and native labels retain their own interaction; prose selects the card.
											if (
												!(e.target as Element).closest(
													"a, input, label, button, summary",
												)
											) {
												e.preventDefault();
												if (!disabled) select();
											}
										}}
									>
										<label htmlFor={`${prefix}-${i}`}>
											<input
												id={`${prefix}-${i}`}
												type={question.multiSelect ? "checkbox" : "radio"}
												name={prefix}
												disabled={disabled}
												aria-describedby={`${prefix}-${i}-description`}
												checked={selected}
												onChange={select}
											/>
											{option.label}
										</label>
										<div id={`${prefix}-${i}-description`}>
											<Markdown text={option.description} />
										</div>
									</div>
									{option.preview !== undefined && (
										<details className="question-preview">
											<summary>Preview: {option.label}</summary>
											<Markdown text={option.preview} />
										</details>
									)}
								</div>
							);
						})}
						<button
							type="button"
							disabled={disabled}
							aria-label={`Free response for ${question.header}`}
							aria-pressed={field.kind === "custom"}
							onClick={() => change(index, { kind: "custom" })}
						>
							Free response
						</button>
						<details>
							<summary aria-label={`Other responses for ${question.header}`}>
								Other responses
							</summary>
							<div className="question-response-modes">
								{(
									[
										"decline",
										question.multiSelect ? "multi" : "option",
										"null",
									] as const
								).map((kind) => {
									const label = {
										decline: "Leave unanswered",
										option: "Choose options",
										multi: "Choose options",
										null: "Decline (null response)",
									}[kind];
									return (
										<button
											key={kind}
											type="button"
											disabled={disabled}
											aria-label={`${label} for ${question.header}`}
											aria-pressed={field.kind === kind}
											onClick={() => change(index, { kind })}
										>
											{label}
										</button>
									);
								})}
							</div>
						</details>
						{field.kind === "custom" && (
							<label>
								Free response for {question.header}
								<textarea
									disabled={disabled}
									maxLength={8192}
									value={field.answer}
									onChange={(e) =>
										change(index, { kind: "custom", answer: e.target.value })
									}
								/>
							</label>
						)}
						<details>
							<summary>Optional note for {question.header}</summary>
							<label>
								Optional note for {question.header}
								<textarea
									disabled={disabled}
									maxLength={8192}
									value={field.notes}
									onChange={(e) => change(index, { notes: e.target.value })}
								/>
							</label>
						</details>
					</fieldset>
				);
			})}
			<details>
				<summary>Optional questionnaire note</summary>
				<label>
					Optional questionnaire note
					<textarea
						disabled={disabled}
						maxLength={8192}
						value={form.globalNote}
						onChange={(e) => {
							setReviewing(false);
							setForm((old) => ({ ...old, globalNote: e.target.value }));
						}}
					/>
				</label>
			</details>
			{reviewing && (
				<div
					role="group"
					aria-label="Review unanswered questions"
					className="unanswered-review"
				>
					<p>These questions will be left unanswered. Nothing has been sent.</p>
					<ul>
						{unanswered.map((question, index) => (
							<li key={index}>{question.header}</li>
						))}
					</ul>
					<button
						type="button"
						disabled={submitDisabled}
						onClick={() => submit(reply(false))}
					>
						Forward with unanswered questions
					</button>
					<button type="button" onClick={() => setReviewing(false)}>
						Keep editing
					</button>
				</div>
			)}
			<button disabled={submitDisabled}>Submit questionnaire</button>{" "}
			<button
				type="button"
				disabled={submitDisabled}
				onClick={() => submit(reply(true))}
			>
				Cancel questionnaire
			</button>
		</form>
	);
}

export function QuestionPanel({
	identity,
	session,
	project,
	state,
	canEdit,
	canAnswer,
	answer,
	Markdown,
}: {
	identity?: Identity;
	session: string;
	project?: string;
	state?: Questions;
	canEdit: boolean;
	canAnswer: boolean;
	answer: QuestionnaireCommand;
	Markdown: React.ComponentType<{ text: string }>;
}) {
	const [attempt, setAttempt] = useState<{
		identity: Identity;
		original: Omit<QuestionReply, "replyId">;
		uncertain: boolean;
	}>();
	const [status, setStatus] = useState("");
	const [receiptOwner, setReceiptOwner] = useState<{
		identity: Identity;
		invocation: string;
		session: string;
		project?: string;
	}>();
	const sending = useRef(false);
	// Forms are bounded by the four observed live requests; exact generation/invocation keys own them.
	const currentState =
		state && keyOf(state) === keyOf(identity) ? state : undefined;
	const pendingOriginal =
		attempt &&
		keyOf(attempt.identity) === keyOf(identity) &&
		currentState?.pending.some(
			(p) => p.invocationId === attempt.original.invocationId,
		);
	async function send(
		original: Omit<QuestionReply, "replyId">,
		repeat = false,
	) {
		const owner = repeat ? attempt?.identity : identity;
		if (
			!owner ||
			!canAnswer ||
			sending.current ||
			(attempt?.uncertain && !repeat) ||
			!currentState?.pending.some(
				(p) => p.invocationId === original.invocationId,
			) ||
			keyOf(owner) !== keyOf(identity)
		)
			return;
		const frozen = JSON.parse(JSON.stringify(original)) as Omit<
			QuestionReply,
			"replyId"
		>;
		const receipt =
			repeat && receiptOwner
				? receiptOwner
				: {
						identity: { ...owner },
						invocation: original.invocationId,
						session,
						project,
					};
		const label = `Questionnaire for ${receipt.session}${receipt.project ? ` · ${receipt.project}` : ""}`;
		const pending = {
			identity: { ...owner },
			original: frozen,
			uncertain: !!repeat,
		};
		try {
			const outcome = await answer(
				{ identity: owner, original: frozen },
				(phase) => {
					if (phase === "submitting") {
						sending.current = true;
						setReceiptOwner(receipt);
						setStatus(`${label}: submitting; completion unknown`);
					} else setAttempt(pending);
				},
			);
			if (outcome === "blocked") return;
			setReceiptOwner(receipt);
			if (outcome === "too-large") {
				setStatus(
					`${label}: Not sent — reply exceeds 65,536 bytes; shorten notes or responses`,
				);
			} else if (outcome === "changed" || outcome === "preparation-failed") {
				setStatus(
					`${label}: ${repeat ? "Uncertain — original completion unknown; repeat not sent" : outcome === "changed" ? "Not sent — control or invocation changed" : "Not sent — acquisition failed"}`,
				);
			} else if (outcome === "rejected") {
				setAttempt(repeat ? { ...pending, uncertain: true } : undefined);
				setStatus(
					`${label}: ${repeat ? "Uncertain — repeat rejected; original completion unknown" : "Rejected before forwarding"}`,
				);
			} else if (outcome === "response-lost") {
				setAttempt({ ...pending, uncertain: true });
				setStatus(
					`${label}: Uncertain — response lost or authority changed; no automatic retry`,
				);
			} else if (
				outcome === "uncertain" ||
				(repeat && outcome !== "accepted")
			) {
				setAttempt({ ...pending, uncertain: true });
				setStatus(`${label}: Uncertain — no automatic retry`);
			} else {
				setAttempt(undefined);
				setStatus(
					`${label}: ${outcome === "accepted" ? "Answer completed — confirmed by live questionnaire callback" : outcome === "invalid" ? "Invalid reply — correct the form; still pending" : "No longer pending — no browser-won inference"}`,
				);
			}
		} finally {
			sending.current = false;
		}
	}
	const visible = !!(
		currentState?.terminalOnly ||
		currentState?.pending.length ||
		status ||
		attempt?.uncertain
	);
	return (
		<section
			aria-label="Supported questionnaires"
			className="questions"
			hidden={!visible}
		>
			{currentState?.terminalOnly && (
				<p role="status">
					Observation limit reached — some requests are terminal-only for this
					generation. No live request was evicted.
				</p>
			)}
			{!!currentState?.pending.length && (
				<details id="question-review">
					<summary>Supported questionnaires</summary>
					{currentState.pending.map((request) => (
						<QuestionForm
							key={`${keyOf(identity)}:${request.invocationId}`}
							request={request}
							disabled={!canEdit}
							submitDisabled={!canAnswer || !!attempt?.uncertain}
							submit={(reply) => void send(reply)}
							Markdown={Markdown}
						/>
					))}
				</details>
			)}
			{status && (
				<div className="action-receipt">
					{receiptOwner && keyOf(receiptOwner.identity) !== keyOf(identity) && (
						<p>Receipt from another session — not the selected terminal.</p>
					)}
					<p role="status">{status}</p>
					{receiptOwner && (
						<details>
							<summary>Details</summary>
							<p>Instance {receiptOwner.identity.instance}</p>
							<p>Generation {receiptOwner.identity.generation}</p>
							<p>Invocation {receiptOwner.invocation}</p>
							<p>
								Completion is the live questionnaire callback, not native
								dispatch or persistence. Closure elsewhere does not prove this
								browser answered.
							</p>
						</details>
					)}
				</div>
			)}
			{attempt?.uncertain && (
				<>
					<p>
						Original answer retained separately from form edits.{" "}
						{pendingOriginal
							? "Original invocation is still observed pending."
							: "Original invocation no longer observed here; completion remains unknown."}
					</p>
					<button
						disabled={!canAnswer || !pendingOriginal}
						onClick={() => void send(attempt.original, true)}
					>
						Repeat original questionnaire reply
					</button>
					<button
						disabled={sending.current}
						onClick={() => {
							setAttempt(undefined);
							setStatus("Uncertain reply dismissed locally; nothing sent");
						}}
					>
						Dismiss uncertain questionnaire reply locally
					</button>
				</>
			)}
		</section>
	);
}
