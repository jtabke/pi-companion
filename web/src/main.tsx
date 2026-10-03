import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Conversation, SafeMarkdown } from "./conversation.js";
import { useBrowserSession } from "./use-browser-session.js";
import { useSessionDrawer } from "./use-session-drawer.js";
import "./style.css";
import { QuestionPanel } from "./questions.js";
import { ChatViewport } from "./chat-viewport.js";
import type { Identity, Summary, View } from "../../src/shared/protocol.js";
// Positive subagent work augments activity, never parent input admission.
function sessionActivity(
	summary: Summary | undefined,
	connected: boolean,
	conflict: boolean,
) {
	if (!connected || !summary) return "Unavailable";
	if (conflict) return "Ownership conflict";
	if (summary.stop === "stopping") return "Stopping";
	if (summary.stop === "parent-settled") return "Stopped (observed)";
	if (summary.pending) return "Input pending";
	if (summary.needsInput) return "Needs answer";
	if (summary.parent === "working") return "Pi is working";
	return summary.subagents ? "Subagent work active" : "Pi idle";
}
function ExtensionDisplays({ summary }: { summary: Summary }) {
	return summary.display?.length ? (
		<section className="extension-displays" aria-label="Extension displays">
			{summary.display.map((card) => (
				<details
					className="extension-card"
					key={`${card.provider}/${card.key}`}
				>
					<summary>
						<strong>{card.title}</strong>
						<span>{card.status}</span>
					</summary>
					<div>
						{card.lines.map((line, index) => (
							<p key={index}>{line}</p>
						))}
					</div>
				</details>
			))}
		</section>
	) : null;
}
function SessionList({
	sessions,
	selected,
	connected,
	onChoose,
}: {
	sessions: View["sessions"];
	selected?: Identity;
	connected: boolean;
	onChoose: (instance: string) => void;
}) {
	// Summaries arrive newest-first; exact cwd keys preserve directory/session recency.
	const directories = new Map<string, View["sessions"]>();
	for (const session of sessions) {
		const cwd = session.cwd ?? "";
		const group = directories.get(cwd);
		if (group) group.push(session);
		else directories.set(cwd, [session]);
	}
	return (
		<nav aria-label="Terminal sessions">
			<p className="session-list-note muted">
				{sessions.length} live terminals · Background unobserved
			</p>
			{[...directories].map(([cwd, group]) => (
				<section
					className="session-directory"
					key={cwd}
					aria-label={cwd || "Working directory unavailable"}
				>
					{cwd ? (
						<details className="directory-details">
							<summary aria-label={`Working directory: ${cwd}`}>
								<h3>{cwd.split("/").filter(Boolean).pop() || cwd}</h3>
							</summary>
							<p>{cwd}</p>
						</details>
					) : (
						<h3>Working directory unavailable</h3>
					)}
					{group.map((session) => {
						const activity = sessionActivity(
							session,
							connected,
							session.conflict,
						);
						return (
							<div
								role="group"
								key={session.instance}
								className="session-card"
								aria-label={`${session.session} · ${session.project}`}
							>
								<button
									aria-label={`${session.session} ${session.project} ${activity}`}
									aria-current={
										session.instance === selected?.instance &&
										session.generation === selected?.generation
											? "true"
											: undefined
									}
									onClick={() => onChoose(session.instance)}
								>
									<strong>{session.session}</strong>
									<small className="session-activity" data-activity={activity}>
										<i className="session-dot" aria-hidden="true" />
										{activity}
									</small>
								</button>
							</div>
						);
					})}
				</section>
			))}
			{!sessions.length && (
				<p role="status">
					{connected
						? "No live sessions. Load the companion extension in your terminal."
						: "Waiting for live sessions from the gateway."}
				</p>
			)}
		</nav>
	);
}
function ActionReceipt({
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
function App() {
	const [code, setCode] = useState(""),
		[remember, setRemember] = useState(true);
	const standalone =
		matchMedia("(display-mode: standalone)").matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true;
	const [offlineSetupNotice, setOfflineSetupNotice] = useState("");
	useEffect(() => {
		let active = true;
		let registration: ServiceWorkerRegistration | undefined;
		let installing: ServiceWorker | null = null;
		const failed = () => {
			if (active)
				setOfflineSetupNotice(
					"Offline recovery setup could not be confirmed. You can still use Pi Companion online.",
				);
		};
		const checkInstall = () => {
			if (installing?.state === "redundant" && !registration?.active) failed();
		};
		const watchInstall = () => {
			installing?.removeEventListener("statechange", checkInstall);
			installing = registration?.installing ?? null;
			installing?.addEventListener("statechange", checkInstall);
			checkInstall();
		};
		// Only public offline assets are prepared; online use never depends on registration.
		if ("serviceWorker" in navigator) {
			void Promise.resolve()
				.then(() =>
					navigator.serviceWorker.register("/sw.js", {
						scope: "/",
						updateViaCache: "none",
					}),
				)
				.then((value) => {
					if (!active) return;
					registration = value;
					registration.addEventListener("updatefound", watchInstall);
					watchInstall();
				}, failed);
		} else
			setOfflineSetupNotice(
				"Offline recovery is not supported in this browser. You can still use Pi Companion online.",
			);
		return () => {
			active = false;
			registration?.removeEventListener("updatefound", watchInstall);
			installing?.removeEventListener("statechange", checkInstall);
		};
	}, []);
	const draftInput = useRef<HTMLTextAreaElement>(null);
	const [questionReview, setQuestionReview] = useState(0);
	const {
		paired,
		selected,
		view,
		transport,
		snapshot,
		checkingDevice,
		error,
		forgetStatus,
		choose,
		pair,
		forget,
		selectedKey,
		current,
		reachable,
		selectedSummary,
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
		controlAction,
		answerQuestionnaire,
		renameEditor,
		renameLocked,
		canRename,
		canSaveRename,
		openRename,
		editRename,
		cancelRename,
		saveRename,
	} = useBrowserSession({
		onAccessDeparture: () => dismissSessions(),
		// Only the owner can confirm a forwarded input cleared this current draft.
		onInputCleared: () => draftInput.current?.blur(),
	});
	const {
		app,
		sidebar,
		sessionsToggle,
		openSessions,
		closeSessions,
		dismissSessions,
		cancelSessions,
		restoreSessionFocus,
	} = useSessionDrawer(paired);

	useEffect(() => {
		const viewport = window.visualViewport;
		const root = app.current;
		if (!viewport || !root) return;
		const restore = () => {
			root.style.removeProperty("--visible-height");
			root.style.removeProperty("--visible-top");
			root.style.removeProperty("--visible-bottom-padding");
		};
		const syncViewport = () => {
			// The visual viewport shrinks for overlay keyboards; zoom is not a keyboard.
			if (Math.abs(viewport.scale - 1) > 0.01) {
				restore();
				return;
			}
			// Safari may already reduce innerHeight for the keyboard. The pan offset
			// positions the visible area; it must not also reduce its reported height.
			const top = Math.max(0, viewport.offsetTop);
			const height = viewport.height;
			if (height <= 0 || !Number.isFinite(height + top)) return;
			root.style.setProperty("--visible-height", `${height}px`);
			root.style.setProperty("--visible-top", `${top}px`);
			if (
				document.activeElement === draftInput.current &&
				height < document.documentElement.clientHeight
			)
				root.style.setProperty("--visible-bottom-padding", "8px");
			else root.style.removeProperty("--visible-bottom-padding");
		};
		syncViewport();
		viewport.addEventListener("resize", syncViewport);
		viewport.addEventListener("scroll", syncViewport);
		// A restored page or layout resize can update metrics without a visual
		// viewport event. Re-read the same native metrics, never infer a keyboard.
		window.addEventListener("resize", syncViewport);
		window.addEventListener("pageshow", syncViewport);
		document.addEventListener("visibilitychange", syncViewport);
		return () => {
			viewport.removeEventListener("resize", syncViewport);
			viewport.removeEventListener("scroll", syncViewport);
			window.removeEventListener("resize", syncViewport);
			window.removeEventListener("pageshow", syncViewport);
			document.removeEventListener("visibilitychange", syncViewport);
			restore();
		};
	}, [app]);
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
	useEffect(() => {
		// The fragment is a per-address view pointer, never a credential or input payload.
		// Reuse normal authenticated read-only attachment and generation reconciliation.
		const url = new URL(location.href);
		if (selectedKey) url.hash = `session=${selectedKey}`;
		else if (url.hash.startsWith("#session=")) url.hash = "";
		if (url.href !== location.href)
			history.replaceState(history.state, "", url);
	}, [selectedKey]);
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
	const renameButton = useRef<HTMLButtonElement>(null);
	function dismissRename() {
		cancelRename();
		if (renameButton.current && !renameButton.current.disabled)
			renameButton.current.focus({ preventScroll: true });
		else
			sidebar.current
				?.querySelector<HTMLButtonElement>('[aria-label="Close sessions"]')
				?.focus({ preventScroll: true });
	}
	const observedQuestions =
		reachable &&
		view.questions &&
		view.questions.instance === selected?.instance &&
		view.questions.generation === selected?.generation
			? view.questions.pending.reduce(
					(count, request) => count + request.questions.length,
					0,
				)
			: 0;
	// The receipt owns the uncertain outcome. Keep a separate ownership blocker
	// visible when it is also true, rather than repeating the outcome warning.
	const receiptShowsOutcome =
		!!outstanding?.uncertain &&
		!!inputReceipt &&
		!inputReceipt.routine &&
		reachable &&
		!operating &&
		!view.conflict;
	const otherBrowserHoldsInput =
		receiptShowsOutcome && !!view.controller?.held && !held;
	const composerStatus = otherBrowserHoldsInput
		? "Another browser has control — take over explicitly to send."
		: composerAvailability;
	const sessionName =
		snapshot?.session ??
		selectedSummary?.session ??
		(selected ? "Selected terminal" : "Pi Companion");
	const projectName = snapshot?.project ?? selectedSummary?.project;
	const selectedActivity = sessionActivity(
		selectedSummary ?? snapshot,
		!!current && view.connection === "connected" && transport === "Connected",
		!!view.conflict || !!selectedSummary?.conflict,
	);
	return (
		<main ref={app}>
			{paired && (
				<dialog
					className="session-sidebar"
					ref={sidebar}
					aria-label="Live sessions"
					onCancel={(event) => {
						if (renameEditor?.editing) {
							event.preventDefault();
							dismissRename();
						} else cancelSessions(event);
					}}
					onClose={restoreSessionFocus}
				>
					<div className="sidebar-heading">
						<h2>Live sessions</h2>
						<button aria-label="Close sessions" onClick={closeSessions}>
							×
						</button>
					</div>
					<SessionList
						sessions={view.sessions}
						selected={selected}
						connected={
							transport === "Connected" && view.connection !== "unavailable"
						}
						onChoose={(instance) => {
							choose(instance);
							closeSessions();
						}}
					/>
					{selected && (
						<button
							onClick={() => {
								choose("");
								closeSessions();
							}}
						>
							Leave session
						</button>
					)}
					{selected && (
						<section
							className="session-rename"
							aria-label="Rename selected session"
						>
							<button
								ref={renameButton}
								disabled={!canRename}
								onClick={openRename}
							>
								Rename session
							</button>
							{!reachable ? (
								<p>Disconnected — rename unavailable.</p>
							) : selectedSummary?.rename !== true ? (
								<p>
									Rename unavailable — fully restart the owning Pi to load the
									updated bridge.
								</p>
							) : null}
							{renameEditor?.editing && (
								<form
									onSubmit={(event) => {
										event.preventDefault();
										void saveRename();
									}}
								>
									<label htmlFor="session-name">Session name</label>
									<input
										id="session-name"
										autoFocus
										value={renameEditor.name}
										disabled={operating || renameLocked}
										onChange={(event) => editRename(event.target.value)}
										aria-describedby="rename-guidance"
									/>
									<p id="rename-guidance">
										Nonblank, at most 120 characters. Save changes native
										metadata only.
									</p>
									<div className="control-actions">
										<button
											type="submit"
											disabled={
												!canSaveRename ||
												!renameEditor.name.trim() ||
												renameEditor.name.length > 120
											}
										>
											Save
										</button>
										<button type="button" onClick={dismissRename}>
											Cancel
										</button>
									</div>
								</form>
							)}
							{renameEditor?.message && (
								<p role="status">{renameEditor.message}</p>
							)}
						</section>
					)}
					{selected && (
						<section className="input-details" aria-label="Input details">
							<h3>Input details</h3>
							<p>{composerAvailability}</p>
							<p>Up to four still PNG, JPEG or WebP images · 4 MB total</p>
							{inputNotice?.routine && (
								<p role="status">{inputNotice.message}</p>
							)}
							{inputReceipt?.routine && <ActionReceipt {...inputReceipt} />}
							{stopReceipt?.routine && <ActionReceipt {...stopReceipt} />}
						</section>
					)}
					{(held || (selected && view.controller?.held && !held)) && (
						<section className="controls" aria-label="Browser control">
							<h3>Browser controls</h3>
							{held && (
								<div className="control-actions">
									<button
										disabled={!reachable || operating}
										onClick={() => void controlAction("renew")}
										aria-label="Renew control (60s)"
									>
										Renew (60s)
									</button>
									<button
										disabled={operating}
										onClick={() => void controlAction("release")}
										aria-label="Release control"
									>
										Release
									</button>
								</div>
							)}
							{selected && view.controller?.held && !held && (
								<button
									disabled={!reachable || operating}
									aria-label="Take over browser control"
									onClick={() => void controlAction("takeover")}
								>
									Take over control
								</button>
							)}
						</section>
					)}
					<section className="device-management" aria-label="Device access">
						<h3>Device access</h3>
						<button disabled={operating} onClick={() => void forget()}>
							Forget this device
						</button>
						{forgetStatus && <p role="status">{forgetStatus}</p>}
						{offlineSetupNotice && (
							<p className="muted" role="status">
								{offlineSetupNotice}
							</p>
						)}
						<details className="install-help" hidden={standalone}>
							<summary>Install on this device</summary>
							<p>
								On iPhone, open this address in Safari, tap Share, then Add to
								Home Screen.
							</p>
							<p>
								In other supported browsers, use the browser menu’s Install app
								or Add to Home Screen option.
							</p>
							<p>
								Open the app once online before using the offline notice.
								Installation does not grant device access or browser control;
								the gateway and private network are still required.
							</p>
						</details>
					</section>
					<p className="sidebar-note">
						Selecting a session does not send input or take browser control.
						Background work remains unobserved.
					</p>
				</dialog>
			)}
			<header className="chat-header">
				<div className="identity-row">
					{!paired ? (
						<h1>Pi Companion</h1>
					) : (
						<div className="header-title">
							<button
								ref={sessionsToggle}
								className="sessions-toggle"
								aria-label={`Open sessions: ${sessionName}${projectName ? ` · ${projectName}` : ""}`}
								aria-describedby={
									observedQuestions ? "session-answer-count" : undefined
								}
								aria-haspopup="dialog"
								onClick={openSessions}
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
									<rect x="3" y="4" width="18" height="16" rx="2" />
									<path d="M9 4v16" />
								</svg>
								<span className="session-heading">
									<strong>{sessionName}</strong>
									<span className="header-metadata">
										{projectName && (
											<span className="header-project">{projectName}</span>
										)}
										{selected && (
											<span className="parent-status">{selectedActivity}</span>
										)}
									</span>
								</span>
								{!!observedQuestions && (
									<span className="session-answer-count" aria-hidden="true">
										{observedQuestions} to answer
									</span>
								)}
							</button>
							{!!observedQuestions && (
								<span id="session-answer-count" className="visually-hidden">
									{observedQuestions}{" "}
									{observedQuestions === 1
										? "question in this session needs"
										: "questions in this session need"}{" "}
									answers
								</span>
							)}
						</div>
					)}
				</div>
				{paired && !selected && transport !== "Connected" && (
					<p role="status">{transport}</p>
				)}
			</header>
			{paired && !selected && (
				<section className="session-home" aria-label="Live sessions">
					<h2>Live sessions</h2>
					<SessionList
						sessions={view.sessions}
						connected={
							transport === "Connected" && view.connection !== "unavailable"
						}
						onChoose={(instance) => {
							choose(instance);
							sessionsToggle.current?.focus({ preventScroll: true });
						}}
					/>
				</section>
			)}
			<ChatViewport
				owner={paired && snapshot ? selectedKey : ""}
				review={questionReview}
				pending={
					paired &&
					current &&
					view.connection === "connected" &&
					view.questions?.instance === selected?.instance &&
					view.questions?.generation === selected?.generation
						? view.questions?.pending.map((question) => question.invocationId)
						: undefined
				}
			>
				{checkingDevice ? (
					<section className="checking-device" aria-label="Device access">
						<p role="status">Checking this device…</p>
					</section>
				) : !paired ? (
					<form
						className="pairing"
						onSubmit={(event) => {
							event.preventDefault();
							void pair(code, remember).then((admitted) => {
								if (admitted) setCode("");
							});
						}}
					>
						<div className="welcome-mark" aria-hidden="true">
							π
						</div>
						<h2>Pair this device</h2>
						<p className="muted">
							Connect to your terminal to read conversations, share images, and
							reply on the go.
						</p>
						<p>
							In your terminal, run <code>npm start -- pair</code>. Each code
							expires in five minutes and works once.
						</p>
						<label htmlFor="pairing-code">Pairing code</label>
						<input
							id="pairing-code"
							type="text"
							inputMode="numeric"
							autoComplete="one-time-code"
							pattern="[0-9]{6}"
							value={code}
							onChange={(event) => setCode(event.target.value)}
							maxLength={6}
							disabled={operating}
							required
						/>
						<label className="remember-device" htmlFor="remember-device">
							<input
								id="remember-device"
								type="checkbox"
								checked={remember}
								disabled={operating}
								onChange={(event) => setRemember(event.target.checked)}
								aria-describedby="remember-expiry"
							/>
							<span>Remember this device</span>
						</label>
						<p id="remember-expiry">
							Remembered: expires 30 days after pairing, without renewal.
							Unchecked: eight-hour access, lost on gateway restart. Pairing
							never sends input or takes control.
						</p>
						<button disabled={operating}>
							{operating ? "Pairing…" : "Pair this device"}
						</button>
						<p role="alert">{error}</p>
					</form>
				) : selected && !snapshot ? (
					<section className="empty-state" aria-label="Selected conversation">
						<p role="status">
							{transport === "Connected" && view.connection === "connected"
								? "Loading conversation…"
								: "Selected conversation unavailable. Waiting for the terminal to reconnect."}
						</p>
					</section>
				) : null}
				{paired && <Conversation snapshot={snapshot} />}
				{paired &&
					(selectedActivity === "Pi is working" ||
						selectedActivity === "Subagent work active") && (
						<p className="working-feedback" role="status">
							<span className="working-marker" aria-hidden="true">
								<span />
								<span />
								<span />
							</span>
							<span className="visually-hidden">{selectedActivity}</span>
						</p>
					)}
				<div hidden={!paired}>
					<QuestionPanel
						identity={selected}
						session={sessionName}
						project={projectName}
						state={
							paired && current && view.connection === "connected"
								? view.questions
								: undefined
						}
						canEdit={paired && reachable}
						canAnswer={paired && canControl}
						answer={answerQuestionnaire}
						Markdown={SafeMarkdown}
					/>
				</div>
				{selectedSummary &&
					current &&
					view.connection === "connected" &&
					transport === "Connected" && (
						<ExtensionDisplays
							key={`${selectedSummary.instance}/${selectedSummary.generation}`}
							summary={selectedSummary}
						/>
					)}
			</ChatViewport>
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
									onClick={() => setQuestionReview((value) => value + 1)}
								>
									Review
								</button>
							</div>
						)}
						<p
							id="composer-availability"
							role="status"
							className={
								view.conflict ||
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
		</main>
	);
}
createRoot(document.getElementById("root")!).render(<App />);
