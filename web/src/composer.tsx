import React, { useLayoutEffect, useRef, useState } from "react";
import { ImagePreview } from "./image-preview.js";
import type { Identity, TextRequest } from "../../src/shared/protocol.js";
import type { useBrowserSession } from "./use-browser-session.js";

type ComposerProps = {
	session: ReturnType<typeof useBrowserSession>["composer"];
	draftInput: React.RefObject<HTMLTextAreaElement | null>;
	observedQuestions: number;
	onReviewQuestions: () => void;
};

export function ActionReceipt({
	identity,
	requestId,
	message,
	text,
	deliverAs,
}: {
	identity: Identity;
	requestId: string;
	message: string;
	text?: string;
	deliverAs?: TextRequest["deliverAs"];
}) {
	return (
		<div className="action-receipt">
			<p role="status">{message}</p>
			{text !== undefined && (
				<p className="receipt-preview">
					{text.length > 240 ? `${text.slice(0, 240)}…` : text}
				</p>
			)}
			<details>
				<summary>Details</summary>
				{deliverAs && (
					<>
						<p>Mode: {deliverAs === "steer" ? "Steer" : "Follow-up"}</p>
						<p>
							Request receipt, not Pi’s live queue. Queue position and
							consumption are unknown.
						</p>
						<p className="receipt-text">{text}</p>
					</>
				)}
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
	session,
	draftInput,
	observedQuestions,
	onReviewQuestions,
}: ComposerProps) {
	const {
		paired,
		selected,
		selectedKey,
		reachable,
		inputIdle,
		held,
		operating,
		composerAvailability,
		inputNotice,
		reloadNotice,
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
		commandModels,
		acknowledgeCommand,
		canSend,
		canBusyText,
		canRetryInput,
		canControl,
		canStop,
		sendText,
		requestStop,
		conflict,
		controller,
	} = session;
	const modelDialog = useRef<HTMLDialogElement>(null);
	const [modelPickerOwner, setModelPickerOwner] = useState<string>();
	const [modelChoice, setModelChoice] = useState("");
	const modelPickerOpen =
		modelPickerOwner === selectedKey && reachable && inputIdle;
	useLayoutEffect(() => {
		const dialog = modelDialog.current;
		if (modelPickerOpen && !dialog?.open) dialog?.showModal();
		else if (!modelPickerOpen && dialog?.open) dialog.close();
	}, [modelPickerOpen]);
	function openModelPicker() {
		setModelChoice(commandModels?.[0]?.reference ?? "");
		setModelPickerOwner(selectedKey);
	}
	function submitText(retry = false, mode?: TextRequest["deliverAs"]) {
		if (
			!retry &&
			sendEnabled &&
			draft.trim() === "/model" &&
			commands?.some((c) => c.name === "model" && c.source === "builtin")
		) {
			openModelPicker();
			return;
		}
		void sendText(retry, mode);
	}
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

	const [busyMode, setBusyMode] = useState<"steer" | "followUp">("steer");
	const showBusyMode = !inputIdle && canBusyText;
	const sendEnabled =
		(inputIdle ? canSend : canBusyText && !attachment) &&
		!outstanding &&
		(!!draft.trim() || !!attachment);
	useLayoutEffect(() => {
		setBusyMode("steer");
	}, [selectedKey, inputIdle]);
	const [closedSlash, setClosedSlash] = useState("");
	const [slashChoice, setSlashChoice] = useState({ key: "", index: 0 });
	const slashKey = `${selectedKey}:${draft}`;
	const prefix = draft.startsWith("/")
		? draft.slice(1).split(" ", 1)[0]
		: undefined;
	const suggestions =
		prefix !== undefined && closedSlash !== slashKey
			? (commands
					?.filter(
						(command) =>
							command.source !== "extension" && command.name.startsWith(prefix),
					)
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
		if (
			command.name === "model" &&
			command.source === "builtin" &&
			text.trim() === "/model" &&
			inputIdle &&
			!attachment &&
			!operating &&
			!outstanding
		)
			openModelPicker();
		else draftInput.current?.focus({ preventScroll: true });
	}
	useLayoutEffect(() => {
		const input = draftInput.current;
		if (!input) return;
		const sizeDraft = () => {
			const bar = input.closest<HTMLElement>(".composer-bar")!;
			// Measure the compact editor first; nonempty text alone must not move the controls.
			bar.dataset.expanded = "false";
			input.style.height = "44px";
			const style = getComputedStyle(input);
			const singleLine =
				parseFloat(style.lineHeight) +
				parseFloat(style.paddingTop) +
				parseFloat(style.paddingBottom);
			if (
				innerWidth < 640 &&
				input.value &&
				(input.value.includes("\n") ||
					input.scrollHeight > Math.ceil(singleLine))
			)
				bar.dataset.expanded = "true";
			// Expanded mobile text gets the full row before measuring its final height.
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
	}, [draft, selectedKey, paired, showBusyMode]);
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
	const browsingCommands =
		reachable &&
		inputIdle &&
		!attachment &&
		!conflict &&
		!operating &&
		!outstanding &&
		(!controller?.held || held) &&
		(draft === "/" || suggestions.length > 0);
	const composerStatus = otherBrowserHoldsInput
		? "Control held elsewhere"
		: browsingCommands
			? ""
			: composerAvailability;
	return (
		<>
			{paired && selected && (
				<section className="composer" aria-label="Browser text input">
					<div className="composer-notices">
						<p id="send-choice-guidance" className="visually-hidden">
							Choose Steer or Follow-up beside the image picker, then Send.
							Alt+Enter in the editor requests Follow-up directly.
						</p>
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
									!(canBusyText && !inputIdle && !!attachment) &&
									!operating &&
									!outstanding &&
									!browsingCommands)
									? "composer-availability"
									: "visually-hidden"
							}
						>
							{composerStatus}
						</p>
						<p id="attachment-guidance" className="visually-hidden">
							Up to four still PNG, JPEG or WebP images · 4 MB total
						</p>
						{reloadNotice && (
							<p className="input-notice" role="status">
								Pi reloaded
							</p>
						)}
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
											<ImagePreview
												src={preview[index]}
												alt="Local attachment preview"
												label={`Enlarge attachment ${index + 1}: ${file.name}`}
												className="attachment-preview"
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

						{inputReceipt && !inputReceipt.routine && (
							<ActionReceipt {...inputReceipt} />
						)}
						{outstanding && !inputReceipt && (
							<ActionReceipt
								{...outstanding}
								message="Input belongs to another session. Original retained; switch back to review."
							/>
						)}
						{outstanding?.uncertain && outstanding.nativeCommand && (
							<button disabled={operating} onClick={acknowledgeCommand}>
								Dismiss command receipt without retrying
							</button>
						)}
						{outstanding?.uncertain && !outstanding.nativeCommand && (
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
								</button>
							))}
						</div>
					)}
					<div className="composer-bar" data-busy={showBusyMode}>
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
						{showBusyMode && (
							<select
								className="busy-mode"
								aria-label="Busy delivery mode"
								value={busyMode}
								disabled={operating || !!outstanding || !!attachment}
								onChange={(event) =>
									setBusyMode(
										event.target.value === "followUp" ? "followUp" : "steer",
									)
								}
							>
								<option value="steer">Steer</option>
								<option value="followUp">Follow-up</option>
							</select>
						)}
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
										(!event.altKey || showBusyMode)
									) {
										event.preventDefault();
										submitText(
											false,
											inputIdle
												? undefined
												: event.altKey
													? "followUp"
													: busyMode,
										);
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
							aria-label={
								inputIdle
									? "Send"
									: busyMode === "steer"
										? "Steer"
										: "Send Follow-up"
							}
							aria-describedby={
								showBusyMode ? "send-choice-guidance" : undefined
							}
							title={
								inputIdle
									? "Send"
									: busyMode === "steer"
										? "Steer the current run"
										: "Request Follow-up after the run"
							}
							disabled={!sendEnabled}
							onMouseDown={(event) => {
								// iOS may move focus despite a canceled pointerdown; cancel the
								// compatibility mouse focus instead (webkit.org/b/316402).
								// Native click still owns dispatch and cancels a scrolling tap.
								if (
									event.button === 0 &&
									document.activeElement === draftInput.current
								)
									event.preventDefault();
							}}
							onClick={() => {
								submitText(false, inputIdle ? undefined : busyMode);
								draftInput.current?.blur();
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
			<dialog
				ref={modelDialog}
				className="model-picker"
				aria-labelledby="model-picker-title"
				onClose={() => setModelPickerOwner(undefined)}
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (
							!modelPickerOpen ||
							!canSend ||
							!commandModels?.some((m) => m.reference === modelChoice)
						)
							return;
						const text = `/model ${modelChoice}`;
						editDraft(text);
						setClosedSlash(`${selectedKey}:${text}`);
						setModelPickerOwner(undefined);
					}}
				>
					<h2 id="model-picker-title">Choose Pi model</h2>
					{commandModels?.length ? (
						<div
							className="model-options"
							role="radiogroup"
							aria-label="Available models"
						>
							{commandModels.map((model) => (
								<label className="model-option" key={model.reference}>
									<input
										className="visually-hidden"
										type="radio"
										name="command-model"
										value={model.reference}
										checked={modelChoice === model.reference}
										onChange={() => setModelChoice(model.reference)}
									/>
									<span>
										<strong>{model.name}</strong>
										<small>{model.reference}</small>
									</span>
									<svg
										className="model-option-check"
										aria-hidden="true"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d="m5 12 4 4 10-10" />
									</svg>
								</label>
							))}
						</div>
					) : (
						<p role="status">No models available.</p>
					)}
					<div className="model-picker-actions">
						<button
							type="button"
							onClick={() => setModelPickerOwner(undefined)}
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={
								!modelPickerOpen ||
								!canSend ||
								!commandModels?.some((m) => m.reference === modelChoice)
							}
						>
							Use model
						</button>
					</div>
				</form>
			</dialog>
		</>
	);
}
