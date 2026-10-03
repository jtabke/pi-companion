import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Identity, View } from "../../src/shared/protocol.js";
import type { useBrowserSession } from "./use-browser-session.js";

type ComposerProps = Pick<
	ReturnType<typeof useBrowserSession>,
	| "paired"
	| "selected"
	| "selectedKey"
	| "reachable"
	| "inputIdle"
	| "held"
	| "operating"
	| "composerAvailability"
	| "inputNotice"
	| "inputReceipt"
	| "outstanding"
	| "stopAttempt"
	| "stopReceipt"
	| "draft"
	| "attachment"
	| "preview"
	| "editDraft"
	| "pickImage"
	| "removeImage"
	| "commands"
	| "canSend"
	| "canBusyText"
	| "canRetryInput"
	| "canControl"
	| "canStop"
	| "sendText"
	| "requestStop"
> & {
	draftInput: React.RefObject<HTMLTextAreaElement | null>;
	conflict: View["conflict"];
	controller: View["controller"];
	observedQuestions: number;
	onReviewQuestions: () => void;
};

export function ActionReceipt({
	identity,
	requestId,
	message,
}: {
	identity: Identity;
	requestId: string;
	message: string;
}) {
	return (
		<div className="action-receipt">
			<p role="status">{message}</p>
			<details>
				<summary>Details</summary>
				<p>
					Instance {identity.instance}
					<br />
					Generation {identity.generation}
					<br />
					Request {requestId}
				</p>
			</details>
		</div>
	);
}
export function Composer({
	paired,
	selected,
	selectedKey,
	reachable,
	inputIdle,
	held,
	operating,
	composerAvailability,
	inputNotice,
	inputReceipt,
	outstanding,
	stopAttempt,
	stopReceipt,
	draft,
	attachment,
	preview,
	editDraft,
	pickImage,
	removeImage,
	commands,
	canSend,
	canBusyText,
	canRetryInput,
	canControl,
	canStop,
	sendText,
	requestStop,
	draftInput,
	conflict,
	controller,
	observedQuestions,
	onReviewQuestions,
}: ComposerProps) {
	const composing = useRef(false);
	const keyboardSwipe = useRef<
		| {
				id: number;
				x: number;
				y: number;
				started: number;
				caret: number;
		  }
		| undefined
	>(undefined);

	const sendOptions = useRef<HTMLDetailsElement>(null);
	const followUpButton = useRef<HTMLButtonElement>(null);
	const sendHold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const sendPointer = useRef<{ id: number; x: number; y: number } | undefined>(
		undefined,
	);
	// Allow small finger jitter, but cancel a deliberate drag within the 44px target.
	const sendTapSlop = 12;
	const suppressSendClick = useRef(false);
	const busyOptions =
		!inputIdle && canBusyText && !attachment && !outstanding && !!draft.trim();
	const sendEnabled =
		(inputIdle ? canSend : canBusyText && !attachment) &&
		!outstanding &&
		(!!draft.trim() || !!attachment);
	function clearSendHold() {
		clearTimeout(sendHold.current);
		sendHold.current = undefined;
	}
	function closeSendOptions(restoreEditorFocus: boolean) {
		if (sendOptions.current) sendOptions.current.open = false;
		// Pointer submission must not reopen a dismissed software keyboard.
		if (restoreEditorFocus) draftInput.current?.focus({ preventScroll: true });
	}
	useEffect(() => {
		return () => {
			clearSendHold();
			sendPointer.current = undefined;
			suppressSendClick.current = true;
			if (sendOptions.current) sendOptions.current.open = false;
		};
	}, [selectedKey, busyOptions, paired]);
	const [closedSlash, setClosedSlash] = useState("");
	const [slashChoice, setSlashChoice] = useState({ key: "", index: 0 });
	const slashKey = `${selectedKey}:${draft}`;
	const prefix = draft.startsWith("/")
		? draft.slice(1).split(" ", 1)[0]
		: undefined;
	const suggestions =
		prefix !== undefined && closedSlash !== slashKey
			? (commands
					?.filter((command) => command.name.startsWith(prefix))
					.slice(0, 8) ?? [])
			: [];
	const slashIndex =
		slashChoice.key === slashKey
			? Math.min(slashChoice.index, suggestions.length - 1)
			: 0;
	function selectSlash(index: number) {
		const command = suggestions[index];
		if (!command || !reachable || !commands?.includes(command)) return;
		const space = draft.indexOf(" ");
		const text = `/${command.name}${space < 0 ? " " : draft.slice(space)}`;
		editDraft(text);
		setClosedSlash(`${selectedKey}:${text}`);
		draftInput.current?.focus({ preventScroll: true });
	}
	useLayoutEffect(() => {
		const input = draftInput.current;
		if (!input) return;
		const sizeDraft = () => {
			// Measure native wrapping at the actual available editor width.
			input.style.height = "44px";
			const style = getComputedStyle(input);
			const singleLine =
				parseFloat(style.lineHeight) +
				parseFloat(style.paddingTop) +
				parseFloat(style.paddingBottom);

			const height = input.value ? input.scrollHeight : singleLine;
			input.style.height = `${Math.min(136, Math.max(44, height))}px`;
		};
		sizeDraft();
		let width = input.clientWidth;
		const resize = new ResizeObserver(() => {
			if (input.clientWidth === width) return;
			sizeDraft();
			width = input.clientWidth;
		});
		resize.observe(input);
		// Root text-size changes and loaded fonts can change wrapping without a resize.
		const textSize = new MutationObserver(sizeDraft);
		textSize.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["style", "class"],
		});
		document.fonts.addEventListener("loadingdone", sizeDraft);
		return () => {
			resize.disconnect();
			textSize.disconnect();
			document.fonts.removeEventListener("loadingdone", sizeDraft);
		};
	}, [draft, selectedKey, paired]);
	// The receipt owns the uncertain outcome. Keep a separate ownership blocker
	// visible when it is also true, rather than repeating the outcome warning.
	const receiptShowsOutcome =
		!!outstanding?.uncertain &&
		!!inputReceipt &&
		!inputReceipt.routine &&
		reachable &&
		!operating &&
		!conflict;
	const otherBrowserHoldsInput =
		receiptShowsOutcome && !!controller?.held && !held;
	const composerStatus = otherBrowserHoldsInput
		? "Another browser has control — take over explicitly to send."
		: composerAvailability;
	return (
		<>
			{paired && selected && (
				<section className="composer" aria-label="Browser text input">
					<div className="composer-notices">
						{!!observedQuestions && (
							<div className="needs-answer">
								<span>
									{observedQuestions}{" "}
									{observedQuestions === 1 ? "question" : "questions"}
								</span>
								<button
									aria-label="Review questions"
									aria-controls="question-review"
									onClick={onReviewQuestions}
								>
									Review
								</button>
							</div>
						)}
						<p
							id="composer-availability"
							role="status"
							className={
								conflict ||
								(outstanding?.uncertain && !receiptShowsOutcome) ||
								otherBrowserHoldsInput ||
								((!!draft.trim() || !!attachment) &&
									!sendEnabled &&
									!operating &&
									!outstanding)
									? "composer-availability"
									: "visually-hidden"
							}
						>
							{composerStatus}
						</p>
						<p id="attachment-guidance" className="visually-hidden">
							Up to four still PNG, JPEG or WebP images · 4 MB total
						</p>
						{inputNotice && !inputNotice.routine && (
							<p className="input-notice" role="status">
								{inputNotice.message}
							</p>
						)}
						{attachment && (
							<div
								className="attachments"
								aria-label="Local images, not uploaded"
							>
								{attachment.map((file, index) => (
									<div className="attachment" key={index}>
										{preview[index] && (
											<img
												src={preview[index]}
												alt="Local attachment preview"
											/>
										)}
										<span className="visually-hidden">
											{file.name} · local, not uploaded
										</span>
										<button
											aria-label={`Remove image ${index + 1}: ${file.name}`}
											onClick={() => {
												removeImage(index);
												draftInput.current?.focus({ preventScroll: true });
											}}
										>
											<span aria-hidden="true">×</span>
										</button>
									</div>
								))}
							</div>
						)}
						{!!suggestions.length && (
							<div
								id="slash-suggestions"
								role="listbox"
								aria-label="Selected Pi slash commands"
								className="slash-suggestions"
							>
								{suggestions.map((command, index) => (
									<button
										key={command.name}
										id={`slash-option-${index}`}
										role="option"
										aria-selected={index === slashIndex}
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => selectSlash(index)}
									>
										<strong>/{command.name}</strong>
										<span>{command.description}</span>
										<small>
											{command.source === "extension"
												? "Extension · terminal only / browser unverified"
												: command.source === "prompt"
													? "Prompt template · idle text only"
													: "Skill · idle text only"}
										</small>
									</button>
								))}
							</div>
						)}

						{inputReceipt && !inputReceipt.routine && (
							<ActionReceipt {...inputReceipt} />
						)}
						{outstanding && !inputReceipt && (
							<ActionReceipt
								{...outstanding}
								message="Input belongs to another session. Original retained; switch back to review."
							/>
						)}
						{outstanding?.uncertain && (
							<button
								disabled={
									!canRetryInput ||
									`${outstanding.identity.instance}:${outstanding.identity.generation}` !==
										selectedKey
								}
								onClick={() => void sendText(true)}
							>
								Retry same outstanding input
							</button>
						)}
						{stopReceipt && !stopReceipt.routine && (
							<ActionReceipt {...stopReceipt} />
						)}
						{stopAttempt && !stopReceipt && (
							<ActionReceipt
								{...stopAttempt}
								message="Stop belongs to another session. Original retained; switch back to review."
							/>
						)}
						{stopAttempt?.uncertain && (
							<button
								disabled={
									!canControl ||
									`${stopAttempt.identity.instance}:${stopAttempt.identity.generation}` !==
										selectedKey
								}
								onClick={() => void requestStop(true)}
							>
								Retry same Stop request
							</button>
						)}
					</div>
					<div className="composer-bar">
						<div className="attachment-picker">
							<label htmlFor="attachment">
								<span aria-hidden="true">+</span>
								<span className="visually-hidden">
									Images for selected Pi (local picker)
								</span>
							</label>
							<input
								id="attachment"
								type="file"
								multiple
								accept="image/png,image/jpeg,image/webp"
								aria-describedby="attachment-guidance"
								onChange={(event) => {
									pickImage(Array.from(event.target.files ?? []));
									event.target.value = "";
								}}
							/>
						</div>
						<label className="visually-hidden" htmlFor="draft">
							Text for selected Pi (local draft)
						</label>
						<textarea
							ref={draftInput}
							id="draft"
							placeholder="Message Pi"
							aria-describedby="composer-availability"
							rows={1}
							maxLength={16000}
							role="combobox"
							aria-expanded={!!suggestions.length}
							aria-autocomplete="list"
							aria-controls={
								suggestions.length ? "slash-suggestions" : undefined
							}
							aria-activedescendant={
								suggestions.length ? `slash-option-${slashIndex}` : undefined
							}
							value={draft}
							onCompositionStart={() => {
								composing.current = true;
								keyboardSwipe.current = undefined;
							}}
							onCompositionEnd={() => {
								composing.current = false;
							}}
							onBlur={() => {
								keyboardSwipe.current = undefined;
								composing.current = false;
							}}
							onTouchStart={(event) => {
								const input = event.currentTarget;
								keyboardSwipe.current = undefined;
								// Leave native text scrolling, selection and long-press editing alone.
								if (
									document.activeElement !== input ||
									composing.current ||
									event.touches.length !== 1 ||
									input.scrollTop > 0 ||
									input.selectionStart !== input.selectionEnd ||
									(input.closest(".composer")?.scrollTop ?? 0) > 0
								)
									return;
								const touch = event.touches[0];
								keyboardSwipe.current = {
									id: touch.identifier,
									x: touch.clientX,
									y: touch.clientY,
									started: event.timeStamp,
									caret: input.selectionStart,
								};
							}}
							onTouchMove={(event) => {
								const swipe = keyboardSwipe.current;
								const touch = event.touches[0];
								if (
									swipe &&
									(event.touches.length !== 1 ||
										touch.identifier !== swipe.id ||
										touch.clientY < swipe.y - 8 ||
										Math.abs(touch.clientX - swipe.x) > 32)
								)
									keyboardSwipe.current = undefined;
							}}
							onTouchCancel={() => {
								keyboardSwipe.current = undefined;
							}}
							onTouchEnd={(event) => {
								const swipe = keyboardSwipe.current;
								keyboardSwipe.current = undefined;
								const input = event.currentTarget;
								const touch = event.changedTouches[0];
								if (
									!swipe ||
									!touch ||
									touch.identifier !== swipe.id ||
									event.touches.length ||
									composing.current ||
									document.activeElement !== input ||
									event.timeStamp - swipe.started >= 500 ||
									input.scrollTop > 0 ||
									(input.closest(".composer")?.scrollTop ?? 0) > 0 ||
									input.selectionStart !== swipe.caret ||
									input.selectionEnd !== swipe.caret
								)
									return;
								const down = touch.clientY - swipe.y;
								if (down >= 64 && down >= 2 * Math.abs(touch.clientX - swipe.x))
									input.blur();
							}}
							onChange={(event) => {
								keyboardSwipe.current = undefined;
								editDraft(event.target.value);
							}}
							onKeyDown={(event) => {
								if (
									event.nativeEvent.isComposing ||
									event.nativeEvent.keyCode === 229 ||
									event.repeat
								)
									return;
								if (!suggestions.length) {
									if (
										event.key === "Enter" &&
										!event.shiftKey &&
										!event.ctrlKey &&
										!event.metaKey &&
										(!event.altKey || busyOptions)
									) {
										event.preventDefault();
										closeSendOptions(true);
										void sendText(false, event.altKey ? "followUp" : undefined);
									}
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									setClosedSlash(slashKey);
								} else if (
									event.key === "ArrowDown" ||
									event.key === "ArrowUp"
								) {
									event.preventDefault();
									const index =
										(slashIndex +
											(event.key === "ArrowDown" ? 1 : -1) +
											suggestions.length) %
										suggestions.length;
									setSlashChoice({ key: slashKey, index });
									document
										.getElementById(`slash-option-${index}`)
										?.scrollIntoView({ block: "nearest" });
								} else if (
									(event.key === "Enter" &&
										!event.shiftKey &&
										!event.ctrlKey &&
										!event.metaKey &&
										!event.altKey) ||
									(event.key === "Tab" && !event.shiftKey)
								) {
									event.preventDefault();
									selectSlash(slashIndex);
								}
							}}
							onPaste={(event) => {
								const images = Array.from(event.clipboardData.files).filter(
									(file) => file.type.startsWith("image/"),
								);
								if (!images.length) return;
								event.preventDefault();
								pickImage(images);
							}}
						/>
						{busyOptions && (
							<details
								ref={sendOptions}
								className="send-options"
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										if (sendOptions.current) sendOptions.current.open = false;
										sendOptions.current
											?.querySelector("summary")
											?.focus({ preventScroll: true });
									}
								}}
							>
								<summary aria-label="Send options">
									<span aria-hidden="true">⋯</span>
								</summary>
								<div
									className="busy-text-controls"
									aria-label="Busy text requests"
								>
									<button
										ref={followUpButton}
										onClick={(event) => {
											closeSendOptions(event.detail === 0);
											void sendText(false, "followUp");
										}}
									>
										Follow-up
									</button>
								</div>
							</details>
						)}
						<button
							className="stop-button"
							aria-label="Stop"
							hidden={inputIdle}
							disabled={!canStop}
							onClick={() => void requestStop()}
						>
							<svg
								aria-hidden="true"
								width="16"
								height="16"
								viewBox="0 0 16 16"
								fill="currentColor"
							>
								<rect x="2" y="2" width="12" height="12" rx="2" />
							</svg>
						</button>
						<button
							className="send-button"
							aria-label="Send"
							disabled={!sendEnabled}
							onPointerDown={(event) => {
								if (!event.isPrimary) {
									if (sendPointer.current) {
										clearSendHold();
										suppressSendClick.current = true;
									}
									return;
								}
								if (event.button !== 0) return;
								clearSendHold();
								suppressSendClick.current = false;
								sendPointer.current = {
									id: event.pointerId,
									x: event.clientX,
									y: event.clientY,
								};
								event.currentTarget.setPointerCapture(event.pointerId);
								if (!busyOptions) return;
								sendHold.current = setTimeout(() => {
									sendHold.current = undefined;
									suppressSendClick.current = true;
									if (sendOptions.current) sendOptions.current.open = true;
									followUpButton.current?.focus({ preventScroll: true });
								}, 500);
							}}
							onPointerMove={(event) => {
								const press = sendPointer.current;
								if (press?.id !== event.pointerId) return;
								const box = event.currentTarget.getBoundingClientRect();
								if (
									Math.hypot(event.clientX - press.x, event.clientY - press.y) >
										sendTapSlop ||
									event.clientX < box.left ||
									event.clientX > box.right ||
									event.clientY < box.top ||
									event.clientY > box.bottom
								) {
									clearSendHold();
									suppressSendClick.current = true;
								}
							}}
							onPointerUp={(event) => {
								if (sendPointer.current?.id !== event.pointerId) return;
								clearSendHold();
								const box = event.currentTarget.getBoundingClientRect();
								if (
									event.clientX < box.left ||
									event.clientX > box.right ||
									event.clientY < box.top ||
									event.clientY > box.bottom
								)
									suppressSendClick.current = true;
								sendPointer.current = undefined;
							}}
							onPointerCancel={() => {
								clearSendHold();
								sendPointer.current = undefined;
								suppressSendClick.current = true;
							}}
							onLostPointerCapture={() => {
								clearSendHold();
								if (sendPointer.current !== undefined)
									suppressSendClick.current = true;
								sendPointer.current = undefined;
							}}
							onClick={(event) => {
								if (event.detail !== 0 && suppressSendClick.current) {
									suppressSendClick.current = false;
									// Native touch's compatibility click can focus Send after the hold.
									if (sendOptions.current?.open)
										followUpButton.current?.focus({ preventScroll: true });
									return;
								}
								closeSendOptions(event.detail === 0);
								void sendText();
							}}
						>
							<svg
								aria-hidden="true"
								width="22"
								height="22"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M12 19V5m-6 6 6-6 6 6" />
							</svg>
						</button>
					</div>
				</section>
			)}
		</>
	);
}
