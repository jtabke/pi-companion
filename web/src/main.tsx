import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";
import "./style.css";
import { QuestionPanel } from "./questions.js";
import type {
	Block,
	Identity,
	Snapshot,
	View,
	Receipt,
} from "../../src/shared/protocol.js";
function NativeImage({
	block,
	snapshot,
}: {
	block: Extract<Block, { type: "image" }>;
	snapshot: Snapshot;
}) {
	const [failed, setFailed] = useState(false);
	const viewer = useRef<PhotoSwipe | null>(null);
	const button = useRef<HTMLButtonElement>(null);
	const src = `/api/media/${snapshot.instance}/${snapshot.generation}/${block.ref}`;
	useEffect(
		() => () => {
			viewer.current?.destroy();
		},
		[],
	);
	function enlarge() {
		const pswp = new PhotoSwipe({
			dataSource: [
				{
					src,
					width: block.width,
					height: block.height,
					alt: "Native Pi image enlarged",
				},
			],
			index: 0,
			// Fit the viewing area even for small native screenshots; PhotoSwipe's default caps at 1:1.
			initialZoomLevel: (level) =>
				level.panAreaSize
					? Math.min(
							level.panAreaSize.x / block.width,
							level.panAreaSize.y / block.height,
						)
					: level.fit,
			showHideAnimationType: "none",
			loop: false,
			returnFocus: true,
		});
		viewer.current = pswp;
		pswp.on("destroy", () => {
			viewer.current = null;
			button.current?.focus();
		});
		pswp.init();
	}
	return failed ? (
		<p role="status">Native image unavailable</p>
	) : (
		<button
			ref={button}
			className="image"
			onClick={enlarge}
			aria-label="Enlarge native Pi image"
		>
			<img
				src={src}
				width={block.width}
				height={block.height}
				alt="Native Pi image"
				onError={() => setFailed(true)}
				loading="lazy"
			/>
			<span>Enlarge image</span>
		</button>
	);
}
function SafeMarkdown({ text }: { text: string }) {
	return (
		<Markdown
			remarkPlugins={[remarkGfm]}
			skipHtml
			components={{
				img: () => <span>[External image not loaded]</span>,
				a: ({ children, href }) =>
					href && /^https?:\/\//i.test(href) ? (
						<a href={href} rel="noreferrer noopener" target="_blank">
							{children}
						</a>
					) : (
						<span>{children}</span>
					),
			}}
		>
			{text}
		</Markdown>
	);
}
function App() {
	const [paired, setPaired] = useState(false),
		[secret, setSecret] = useState(""),
		[error, setError] = useState("");
	const [view, setView] = useState<View>({
			connection: "disconnected",
			sessions: [],
		}),
		[transport, setTransport] = useState("Connecting");
	const [selected, setSelected] = useState<Identity | undefined>();
	const [cached, setCached] = useState<Snapshot | undefined>();
	type Draft = { text: string; image?: File };
	const drafts = useRef(new Map<string, Draft>());
	const [draft, setDraft] = useState("");
	const [attachment, setAttachment] = useState<File | undefined>();
	const [preview, setPreview] = useState("");
	const authority = useRef<
		| { identity: Identity; lease: string; expires: number; revision: string }
		| undefined
	>(undefined);
	const [held, setHeld] = useState(false),
		[operating, setOperating] = useState(false),
		[inputStatus, setInputStatus] = useState("Read-only");
	const [outstanding, setOutstanding] = useState<
		| {
				identity: Identity;
				requestId: string;
				text: string;
				file?: File;
				source?: string;
				uncertain: boolean;
		  }
		| undefined
	>();
	const [stopAttempt, setStopAttempt] = useState<{ identity: Identity; requestId: string; uncertain: boolean }>();
	const [stopStatus, setStopStatus] = useState("");
	const liveKey = useRef("");
	const controlEpoch = useRef(0);
	const operation = useRef(false);
	const imageUpload = useRef<AbortController | undefined>(undefined);
	function dropControl() {
		imageUpload.current?.abort();
		controlEpoch.current++;
		const old = authority.current;
		authority.current = undefined;
		setHeld(false);
		if (old)
			void fetch("/api/control", {
				method: "POST",
				keepalive: true,
				headers: { "content-type": "application/json", "x-c2-csrf": "input" },
				body: JSON.stringify({
					...old.identity,
					action: "release",
					lease: old.lease,
				}),
			}).catch(() => {});
	}
	const selectedKey = selected
		? `${selected.instance}:${selected.generation}`
		: "";
	liveKey.current = selectedKey;
	useEffect(() => {
		setDraft(drafts.current.get(selectedKey)?.text ?? "");
		setAttachment(drafts.current.get(selectedKey)?.image);
		dropControl();
	}, [selectedKey, paired]);
	useEffect(() => {
		const url = paired && attachment ? URL.createObjectURL(attachment) : "";
		setPreview(url);
		return () => { if (url) URL.revokeObjectURL(url); };
	}, [attachment, selectedKey, paired]);
	useEffect(() => {
		const timer = setInterval(() => {
			if (authority.current && authority.current.expires <= Date.now()) {
				dropControl();
				setInputStatus("Lease expired — read-only; claim deliberately");
			}
		}, 500);
		const leave = () => dropControl();
		window.addEventListener("pagehide", leave);
		return () => {
			clearInterval(timer);
			window.removeEventListener("pagehide", leave);
		};
	}, []);
	useEffect(() => {
		if (!paired) return;
		let active = true;
		const query = selected
			? `?instance=${selected.instance}&generation=${selected.generation}`
			: "";
		const events = new EventSource(`/api/events${query}`);
		setTransport("Connecting");
		events.addEventListener("snapshot", (event) => {
			if (!active) return;
			const next = JSON.parse((event as MessageEvent).data) as View;
			if (
				(next.selected
					? `${next.selected.instance}:${next.selected.generation}`
					: "") !== selectedKey
			)
				return;
			setView(next);
			if (
				authority.current &&
				(!next.controller?.held ||
					next.controller.revision !== authority.current.revision ||
					next.controller.expires <= Date.now() ||
					next.connection !== "connected" ||
					next.conflict)
			) {
				dropControl();
				setInputStatus("Browser control lost — read-only");
			}
			if (next.snapshot) setCached(next.snapshot);
			setTransport("Connected");
			// Native replacement/reload permits only a fresh read-only attachment, not replay of old content.
			const replacement =
				selected && next.sessions.find((s) => s.instance === selected.instance);
			if (replacement && replacement.generation !== selected?.generation) {
				setCached(undefined);
				setSelected({
					instance: replacement.instance,
					generation: replacement.generation,
				});
			}
		});
		events.onopen = () => {
			if (active) setTransport("Connected");
		};
		events.onerror = () => {
			if (active) {
				setTransport("Disconnected — reconnecting; pair again if expired");
				dropControl();
			}
		};
		return () => {
			active = false;
			events.close();
		};
	}, [paired, selectedKey]);
	useEffect(() => {
		void fetch("/api/snapshot")
			.then(async (response) => {
				if (response.ok) {
					setView(await response.json());
					setPaired(true);
				}
			})
			.catch(() => {});
	}, []);
	async function pair(event: React.FormEvent) {
		event.preventDefault();
		setError("");
		try {
			const response = await fetch("/api/pair", {
				method: "POST",
				headers: { "content-type": "application/json", "x-c2-csrf": "pair" },
				body: JSON.stringify({ secret }),
			});
			setSecret("");
			if (!response.ok) {
				setError("Pairing failed or limited. Check terminal secret.");
				return;
			}
			setPaired(true);
		} catch {
			setSecret("");
			setError("Gateway unavailable");
		}
	}
	const snapshot =
		cached && `${cached.instance}:${cached.generation}` === selectedKey
			? cached
			: undefined;
	const current =
		view.selected &&
		`${view.selected.instance}:${view.selected.generation}` === selectedKey;

	const reachable =
		!!selected &&
		!!current &&
		view.connection === "connected" &&
		transport === "Connected" &&
		!view.conflict;
	const selectedSummary = view.sessions.find(
		(s) =>
			s.instance === selected?.instance &&
			s.generation === selected?.generation,
	);
	const inputIdle =
		selectedSummary?.parent === "idle" && !selectedSummary.pending && selectedSummary.stop !== "stopping";
	const canSend =
		reachable &&
		held &&
		!!authority.current &&
		authority.current.expires > Date.now() &&
		inputIdle &&
		!operating;
	const canControl = reachable && held && !!authority.current && authority.current.expires > Date.now() && !operating;
	const canStop = canControl && !!selectedSummary && selectedSummary.stop !== "stopping" &&
		(selectedSummary.parent === "working" || !!selectedSummary.pending) && !stopAttempt;
	async function requestStop(retry = false) {
		const auth = authority.current;
		if (!selected || !auth || !canControl || operation.current || (!retry && !canStop)) return;
		const pending = retry ? stopAttempt : {
			identity: selected,
			requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join(""),
			uncertain: false,
		};
		if (!pending || `${pending.identity.instance}:${pending.identity.generation}` !== selectedKey) return;
		setStopAttempt(pending);
		operation.current = true;
		setOperating(true);
		const owner = `instance ${pending.identity.instance.slice(0, 8)} · generation ${pending.identity.generation.slice(0, 8)}`;
		setStopStatus(`Stop for ${owner}: requesting; outcome unconfirmed`);
		try {
			const response = await fetch("/api/stop", {
				method: "POST",
				headers: { "content-type": "application/json", "x-c2-csrf": "input" },
				body: JSON.stringify({ ...pending.identity, requestId: pending.requestId, lease: auth.lease }),
			});
			if (!response.ok) {
				setStopAttempt(pending.uncertain ? pending : undefined);
				setStopStatus(`Stop for ${owner}: ${pending.uncertain ? "Uncertain — retry rejected; original outcome unknown" : "Rejected before dispatch"}`);
				if (authority.current === auth && (response.status === 401 || response.status === 409)) dropControl();
				return;
			}
			const receipt = await response.json() as Receipt;
			if (receipt.requestId !== pending.requestId || !["dispatched", "uncertain", "rejected"].includes(receipt.status)) throw Error("Invalid receipt");
			const uncertain = receipt.status === "uncertain" || (pending.uncertain && receipt.status === "rejected");
			setStopAttempt(uncertain ? { ...pending, uncertain: true } : undefined);
			setStopStatus(`Stop for ${owner}: ${uncertain ? "Uncertain — original ID retained; no automatic retry" : receipt.status === "dispatched" ? "Dispatched; outcome unconfirmed" : `Rejected: ${receipt.reason}`}`);
		} catch {
			setStopAttempt({ ...pending, uncertain: true });
			setStopStatus(`Stop for ${owner}: Uncertain — response lost; no automatic retry`);
		} finally {
			operation.current = false;
			setOperating(false);
		}
	}
	function saveDraft(value: Draft) {
		if (!selectedKey) return;
		// Existing <=32 generation budget; never discard the outstanding owner's draft.
		if (!drafts.current.has(selectedKey) && drafts.current.size >= 32) {
			const pendingKey = outstanding && `${outstanding.identity.instance}:${outstanding.identity.generation}`;
			const oldest = [...drafts.current.keys()].find((key) => key !== selectedKey && key !== pendingKey)!;
			drafts.current.delete(oldest);
			setInputStatus("Oldest inactive draft discarded (32 draft limit)");
		}
		drafts.current.set(selectedKey, value);
		setDraft(value.text);
		setAttachment(value.image);
	}
	function editDraft(text: string) { saveDraft({ text, image: attachment }); }
	function pickImage(file?: File) {
		if (!file) { saveDraft({ text: draft }); return; }
		if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > 4_000_000) {
			setInputStatus("Choose one still PNG/JPEG/WebP, at most 4,000,000 bytes; HEIC/SVG/GIF unsupported");
			return;
		}
		const total = () => {
			const files = new Set([...drafts.current.entries()].filter(([key]) => key !== selectedKey).map(([, value]) => value.image));
			files.add(file); files.add(outstanding?.file);
			return [...files].reduce((sum, image) => sum + (image?.size ?? 0), 0);
		};
		let discarded = false;
		while (total() > 16_000_000) {
			const inactive = [...drafts.current.entries()].find(([key, value]) => key !== selectedKey && value.image && value.image !== outstanding?.file);
			if (!inactive) { setInputStatus("Image draft budget exceeded (16,000,000 bytes)"); return; }
			drafts.current.set(inactive[0], { text: inactive[1].text });
			discarded = true;
		}
		saveDraft({ text: draft, image: file });
		setInputStatus(discarded ? "Oldest inactive attachment discarded (16,000,000-byte limit); text retained" : "Local image preview only — not uploaded");
	}
	async function controlAction(
		action: "claim" | "takeover" | "release" | "renew",
	) {
		if (!selected || operation.current) return;
		const identity = selected,
			key = selectedKey,
			epoch = controlEpoch.current;
		const lease = authority.current?.lease;
		operation.current = true;
		setOperating(true);
		try {
			const response = await fetch("/api/control", {
				method: "POST",
				headers: { "content-type": "application/json", "x-c2-csrf": "input" },
				body: JSON.stringify({
					...identity,
					action,
					...(["release", "renew"].includes(action) ? { lease } : {}),
				}),
			});
			const result = await response.json();
			if (key !== liveKey.current || epoch !== controlEpoch.current) {
				if (result.lease)
					void fetch("/api/control", {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"x-c2-csrf": "input",
						},
						body: JSON.stringify({
							...identity,
							action: "release",
							lease: result.lease,
						}),
					}).catch(() => {});
				return;
			}
			if (!response.ok) {
				dropControl();
				setInputStatus("Control request rejected — read-only");
				return;
			}
			// Keep the capability tentative/read-only until a fresh public projection confirms this revision.
			// A delayed pre-takeover response must never restore revoked authority.
			authority.current = result.lease
				? {
						identity,
						lease: result.lease,
						expires: result.expires,
						revision: result.revision,
					}
				: undefined;
			setHeld(false);
			if (result.lease) {
				const confirmation = await fetch(
					`/api/snapshot?instance=${identity.instance}&generation=${identity.generation}`,
				);
				const current = (await confirmation.json()) as View;
				if (key !== liveKey.current || epoch !== controlEpoch.current) return;
				if (
					!confirmation.ok ||
					current.connection !== "connected" ||
					current.conflict ||
					!current.controller?.held ||
					current.controller.revision !== result.revision ||
					current.controller.expires <= Date.now()
				) {
					dropControl();
					setInputStatus("Control changed before confirmation — read-only");
					return;
				}
				setHeld(true);
			}
			setInputStatus(
				result.lease
					? "Browser control held (60s) — terminal remains usable"
					: "Released — read-only",
			);
		} catch {
			dropControl();
			setInputStatus("Control response lost — read-only; no automatic claim");
		} finally {
			operation.current = false;
			setOperating(false);
		}
	}
	async function sendText(retry = false) {
		const auth = authority.current;
		if (
			!canSend ||
			operation.current ||
			!selected ||
			!auth ||
			(outstanding && !retry)
		)
			return;
		let pending = retry
			? outstanding
			: {
					identity: selected,
					requestId: Array.from(
						crypto.getRandomValues(new Uint8Array(16)),
						(byte) => byte.toString(16).padStart(2, "0"),
					).join(""),
					text: draft,
					file: attachment,
					source: undefined as string | undefined,
					uncertain: false,
				};
		if (
			!pending ||
			`${pending.identity.instance}:${pending.identity.generation}` !==
				selectedKey ||
			(!pending.text.trim() && !pending.file)
		)
			return;
		setOutstanding(pending);
		operation.current = true;
		setOperating(true);
		setInputStatus("Sending — outcome not yet known");
		const upload = pending.file ? new AbortController() : undefined;
		imageUpload.current = upload;
		try {
			if (pending.file && !pending.source) {
				const bytes = new Uint8Array(await pending.file.arrayBuffer());
				let binary = "";
				for (let offset = 0; offset < bytes.length; offset += 8192)
					binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
				pending = { ...pending, source: btoa(binary) };
				setOutstanding(pending);
			}
			if (liveKey.current !== selectedKey || authority.current !== auth || auth.expires <= Date.now()) {
				setOutstanding(pending.uncertain ? pending : undefined);
				setInputStatus("Control changed before dispatch; nothing sent");
				return;
			}
			const response = await fetch(pending.file ? "/api/image" : "/api/text", {
				method: "POST",
				...(upload ? { signal: upload.signal } : {}),
				headers: { "content-type": "application/json", "x-c2-csrf": "input" },
				body: JSON.stringify({
					...pending.identity,
					requestId: pending.requestId,
					text: pending.text,
					...(pending.file ? { source: pending.source, mime: pending.file.type } : {}),
					lease: auth.lease,
				}),
			});
			if (!response.ok) {
				// A prior uncertain attempt stays uncertain even if this retry fails before forwarding.
				if (pending.uncertain) {
					setOutstanding({ ...pending, uncertain: true });
					setInputStatus(
						"Uncertain — retry rejected; original outcome still unknown",
					);
				} else {
					setOutstanding(undefined);
					const result = await response.json();
					setInputStatus(`Rejected before dispatch: ${result.error ?? "Invalid input"}`);
				}
				if (response.status === 401 || response.status === 409) dropControl();
				return;
			}
			const receipt = (await response.json()) as Receipt;
			if (
				receipt.requestId !== pending.requestId ||
				!["dispatched", "uncertain", "rejected"].includes(receipt.status)
			)
				throw Error("Invalid receipt");
			if (
				receipt.status === "uncertain" ||
				(receipt.status === "rejected" && pending.uncertain)
			) {
				setOutstanding({ ...pending, uncertain: true });
				setInputStatus(
					"Uncertain — retain original ID/text; no automatic retry",
				);
			} else {
				setOutstanding(undefined);
				setInputStatus(
					receipt.status === "dispatched"
						? "Dispatched; outcome unconfirmed"
						: `Rejected: ${receipt.reason === "model-no-images" ? "Current Pi model does not support images" : receipt.reason === "images-blocked" ? "Pi settings block images" : receipt.reason === "image-policy-unknown" ? "Pi model/image policy unavailable or unknown" : receipt.reason}`, 
				);
				const key = `${pending.identity.instance}:${pending.identity.generation}`;
				if (
					receipt.status === "dispatched" &&
					drafts.current.get(key)?.text === pending.text &&
					drafts.current.get(key)?.image === pending.file
				) {
					drafts.current.set(key, { text: "" });
					if (key === liveKey.current) { setDraft(""); setAttachment(undefined); }
				}
			}
		} catch {
			setOutstanding({ ...pending, uncertain: true });
			setInputStatus("Uncertain — response lost; no automatic retry");
		} finally {
			if (imageUpload.current === upload) imageUpload.current = undefined;
			operation.current = false;
			setOperating(false);
		}
	}
	function choose(instance: string) {
		const session = view.sessions.find((s) => s.instance === instance);
		if (
			session?.instance === selected?.instance &&
			session?.generation === selected?.generation
		)
			return;
		setCached(undefined);
		setSelected(
			session
				? { instance: session.instance, generation: session.generation }
				: undefined,
		);
	}
	return (
		<main>
			<header>
				<h1>Pi observer</h1>
				<p>Read-only by default · terminal owns Pi</p>
				{paired && (
					<>
						<p role="status">
							{transport} ·{" "}
							{!selected
								? "no session selected"
								: current
									? view.connection
									: "connecting"}
						</p>
						{snapshot && (
							<>
								<h2>
									{snapshot.project} / {snapshot.session}
								</h2>
								<p>
									Parent:{" "}
									{current &&
									view.connection === "connected" &&
									transport === "Connected"
										? selectedSummary?.stop === "stopping" ? "Stopping" : selectedSummary?.stop === "parent-settled" ? "settled (observed)" : snapshot.parent
										: "unavailable"}
								</p>
								<p>
									Background work unobserved — parent idle does not mean all
									work finished.
								</p>
							</>
						)}
					</>
				)}
			</header>
			{!paired ? (
				<form onSubmit={pair}>
					<label htmlFor="secret">Terminal pairing secret</label>
					<input
						id="secret"
						type="password"
						autoComplete="off"
						value={secret}
						onChange={(event) => setSecret(event.target.value)}
						maxLength={128}
						required
					/>
					<button>Pair browser</button>
					<p role="alert">{error}</p>
				</form>
			) : (
				<>
					<button className="re-pair" onClick={() => setPaired(false)}>
						Pair again
					</button>
					<section aria-label="Live sessions" className="sessions">
						<label htmlFor="session">Select live session</label>
						<select
							id="session"
							value={selected?.instance ?? ""}
							onChange={(event) => choose(event.target.value)}
						>
							<option value="">Choose a terminal owner</option>
							{selected &&
								!view.sessions.some(
									(s) => s.instance === selected.instance,
								) && (
									<option value={selected.instance}>
										Selected owner disconnected ·{" "}
										{selected.instance.slice(0, 8)}
									</option>
								)}
							{view.sessions.map((session) => (
								<option key={session.instance} value={session.instance}>
									{session.project} / {session.session} · parent{" "}
									{session.parent} · {session.instance.slice(0, 8)}
									{session.conflict ? " · ownership conflict" : ""}
								</option>
							))}
						</select>
						<p>
							{view.sessions.length} reachable terminal owners. Background work
							unobserved.
						</p>
						{selected && (
							<p>
								Selected instance {selected.instance.slice(0, 8)} · generation{" "}
								{selected.generation.slice(0, 8)}
							</p>
						)}
					</section>
					{current && view.conflict && (
						<p role="alert">
							Ownership conflict: multiple reachable terminals share the same
							native session file. Observation is read-only; this does not
							prevent terminal writes.
						</p>
					)}
					{selected &&
						(transport !== "Connected" ||
							!current ||
							view.connection !== "connected") && (
							<p role="status">
								Selected conversation disconnected or unavailable. Cached
								content is not live.
							</p>
						)}
					{!snapshot && (
						<p>
							Choose a reachable Pi bridge. Explicitly load the extension in
							your terminal.
						</p>
					)}

					{selected && (
						<section className="composer" aria-label="Browser text input">
							<p role="status">
								{held ? "Controller held" : "Read-only"} · {inputStatus}
							</p>
							{held ? (
								<>
									<button
										disabled={!reachable || operating}
										onClick={() => void controlAction("renew")}
									>
										Renew control (60s)
									</button>{" "}
									<button
										disabled={operating}
										onClick={() => void controlAction("release")}
									>
										Release control
									</button>
								</>
							) : (
								<button
									disabled={!reachable || operating}
									onClick={() =>
										void controlAction(
											view.controller?.held ? "takeover" : "claim",
										)
									}
								>
									{view.controller?.held
										? "Take over browser control"
										: "Take control"}
								</button>
							)}
							<button disabled={!canStop} onClick={() => void requestStop()}>Stop</button>
							{stopStatus && <p role="status">{stopStatus}</p>}
							{stopAttempt?.uncertain && <button
								disabled={!canControl || `${stopAttempt.identity.instance}:${stopAttempt.identity.generation}` !== selectedKey}
								onClick={() => void requestStop(true)}>Retry same Stop request</button>}
							<p>Stop requests current parent abort only. Stopping awaits a subsequent public parent-settled observation; it does not confirm cancellation of queued, delayed or background work.</p>
							<label htmlFor="draft">Text for selected Pi (local draft)</label>
							<textarea
								id="draft"
								maxLength={16000}
								value={draft}
								onChange={(event) => editDraft(event.target.value)}
							/>
							<label htmlFor="attachment">One image for selected Pi (local picker)</label>
							<input id="attachment" type="file" accept="image/png,image/jpeg,image/webp"
								onChange={(event) => { pickImage(event.target.files?.[0]); event.target.value = ""; }} />
							{attachment && <div className="attachment">
								{preview && <img src={preview} alt="Local attachment preview" />}
								<p>{attachment.name} · {attachment.size} bytes · local, not uploaded</p>
								<button onClick={() => pickImage()}>Remove image</button>
							</div>}
							<button
								disabled={!canSend || !!outstanding || (!draft.trim() && !attachment)}
								onClick={() => void sendText()}
							>
								Send
							</button>
							{outstanding && (
								<p role="status">
									Outstanding input for instance{" "}
									{outstanding.identity.instance.slice(0, 8)} · generation{" "}
									{outstanding.identity.generation.slice(0, 8)}. Original
									text/file/MIME/ID retained in this view only.
								</p>
							)}
							{outstanding?.uncertain && (
								<button
									disabled={
										!canSend ||
										`${outstanding.identity.instance}:${outstanding.identity.generation}` !==
											selectedKey
									}
									onClick={() => void sendText(true)}
								>
									Retry same outstanding input
								</button>
							)}
							<p>
								{inputIdle
									? "Parent idle"
									: "Busy/pending or unavailable — send disabled"}
								. Idle text or one still PNG/JPEG/WebP (4 MB, 20 MP). Busy/pending input is rejected; Steer,
								Follow-up are deferred. No automatic send, retry, claim
								or renewal.
							</p>
						</section>
					)}
					{snapshot?.truncated && (
						<p role="status">
							Observer history/media budget reached. Content is truncated or
							unavailable; Pi remains the source.
						</p>
					)}
					{snapshot?.items.map((item) => (
						<article key={item.id} data-native-item={item.id}>
							<h3>{item.role}</h3>
							{item.blocks.map((block, index) =>
								block.type === "image" ? (
									<NativeImage
										key={`${item.id}:${index}`}
										block={block}
										snapshot={snapshot}
									/>
								) : block.type === "thinking" ? (
									<details key={index}>
										<summary>Thinking</summary>
										<SafeMarkdown text={block.text} />
									</details>
								) : block.type === "tool" ? (
									<details key={index}>
										<summary>Native tool</summary>
										<p>{block.text}</p>
									</details>
								) : block.type === "unavailable" ? (
									<p key={index} role="status">
										{block.text}
									</p>
								) : (
									<SafeMarkdown key={index} text={block.text} />
								),
							)}
						</article>
					))}
				</>
			)}
			<div hidden={!paired}>
                    <QuestionPanel identity={selected} state={paired && current && view.connection === "connected" ? view.questions : undefined}
                        canAnswer={paired && canControl} authority={() => authority.current ? { lease: authority.current.lease, epoch: controlEpoch.current } : undefined}
                        busy={value => { operation.current = value; setOperating(value); }} Markdown={SafeMarkdown} />
			</div>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(<App />);
