import { useEffect, useRef, useState } from "react";
import type {
	Command,
	Identity,
	Receipt,
	QuestionReply,
	QuestionReceipt,
	Snapshot,
	TextRequest,
	View,
} from "../../src/shared/protocol.js";

function selectedCommands(
	view: View,
	identity: Identity | undefined,
	reachable: boolean,
) {
	return reachable &&
		identity &&
		view.selected?.instance === identity.instance &&
		view.selected.generation === identity.generation &&
		view.snapshot?.instance === identity.instance &&
		view.snapshot.generation === identity.generation
		? view.snapshot.commands
		: undefined;
}
function slashGuidance(
	text: string,
	image: boolean,
	busy: boolean,
	commands: Command[] | undefined,
) {
	if (!text.trimStart().startsWith("/")) return;
	if (image) return "Remove images to use a command.";
	if (busy) return "Commands are available when Pi is idle.";
	const name = text.startsWith("/")
		? text.slice(1).split(" ", 1)[0]
		: undefined;
	const command = commands?.find((c) => c.name === name);
	if (!command && name && ["new", "reload", "model"].includes(name))
		return "Command not available in this Pi session.";
	if (!commands) return "Commands unavailable. Reload the bridge in Pi.";
	if (!command) return "Command not available.";
	if (command.source === "extension") return "Use this command in Pi.";
	if (
		command.source === "builtin" &&
		command.name !== "model" &&
		text.trim() !== `/${command.name}`
	)
		return "This command takes no arguments.";
}

function createRequestId() {
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}
async function readReceipt(response: Response, requestId: string) {
	const receipt = (await response.json()) as Receipt;
	if (
		receipt.requestId !== requestId ||
		!["dispatched", "uncertain", "rejected"].includes(receipt.status)
	)
		throw Error("Invalid receipt");
	return receipt;
}

function identityKey(identity?: Identity) {
	return identity ? `${identity.instance}:${identity.generation}` : "";
}
export type QuestionnaireOutcome =
	| "blocked"
	| "too-large"
	| "changed"
	| "preparation-failed"
	| "rejected"
	| "response-lost"
	| QuestionReceipt["status"];
export type QuestionnaireCommand = (
	intent: { identity: Identity; original: Omit<QuestionReply, "replyId"> },
	progress: (phase: "submitting" | "forwarding") => void,
) => Promise<QuestionnaireOutcome>;

type BrowserSession = {
	paired: boolean;
	selected?: Identity;
	view: View;
	cached?: Snapshot;
	transport: "connecting" | "open" | "disconnected";
	observed: boolean;
	readLifetime: number;
	reachable: boolean;
	held: boolean;
	checkingDevice: boolean;
	error: string;
	forgetStatus: string;
};

/** Synchronous scope, observation and command authority owner. React receives only projections.
 * Read lifetimes and lease invalidation epochs are deliberately separate.
 */
export function useBrowserSession({
	onAccessDeparture,
	onInputCleared,
}: {
	onAccessDeparture: () => void;
	onInputCleared: () => void;
}) {
	const [session, setSession] = useState<BrowserSession>(() => {
		const owner = new URLSearchParams(location.hash.slice(1)).get("session");
		const [instance, generation] =
			owner && /^[a-f0-9]{32}:[a-f0-9]{32}$/.test(owner)
				? owner.split(":")
				: [];
		return {
			paired: false,
			selected: instance && generation ? { instance, generation } : undefined,
			view: { connection: "disconnected", sessions: [] },
			transport: "connecting",
			observed: false,
			readLifetime: 0,
			reachable: false,
			held: false,
			checkingDevice: true,
			error: "",
			forgetStatus: "",
		};
	});
	const live = useRef(session);
	const forgetting = useRef(false);
	const { paired, selected, view, held, checkingDevice, error, forgetStatus } =
		session;
	const transport =
		session.transport === "open"
			? "Connected"
			: session.transport === "connecting"
				? "Connecting"
				: "Disconnected";
	function publishSession() {
		setSession({ ...live.current });
	}
	function setHeld(held: boolean) {
		live.current = { ...live.current, held };
		publishSession();
	}
	type Draft = { text: string; images?: File[] };
	const drafts = useRef(new Map<string, Draft>());
	const [draft, setDraft] = useState("");
	const [attachment, setAttachment] = useState<File[] | undefined>();
	const [preview, setPreview] = useState<string[]>([]);
	const authority = useRef<
		| { identity: Identity; lease: string; expires: number; revision: string }
		| undefined
	>(undefined);
	type Notice = { identity: Identity; message: string; routine?: boolean };
	type ActionReceipt = Notice & {
		requestId: string;
		text?: string;
		deliverAs?: TextRequest["deliverAs"];
	};
	const [operating, setOperating] = useState(false);
	const [inputNotice, setInputNotice] = useState<Notice>();
	const [inputReceipt, setInputReceipt] = useState<ActionReceipt>();
	const [reloadNotice, setReloadNotice] = useState<Identity>();
	const lastSnapshot = useRef<Identity | undefined>(undefined);
	useEffect(() => {
		if (!reloadNotice) return;
		const timer = setTimeout(() => setReloadNotice(undefined), 4000);
		return () => clearTimeout(timer);
	}, [reloadNotice]);
	function setInputStatus(
		message: string,
		identity = selected,
		routine = false,
	) {
		if (identity) setInputNotice({ identity, message, routine });
	}
	function inputResult(
		attempt: {
			identity: Identity;
			requestId: string;
			text?: string;
			deliverAs?: TextRequest["deliverAs"];
			nativeCommand?: boolean;
		},
		message: string,
		routine = false,
	) {
		setInputReceipt({
			identity: attempt.identity,
			requestId: attempt.requestId,
			message,
			routine,
			...(attempt.nativeCommand
				? { text: attempt.text }
				: routine && attempt.deliverAs
					? { text: attempt.text, deliverAs: attempt.deliverAs }
					: {}),
		});
	}
	const [outstanding, setOutstanding] = useState<
		| {
				identity: Identity;
				requestId: string;
				text: string;
				deliverAs?: TextRequest["deliverAs"];
				files?: File[];
				sources?: string[];
				uncertain: boolean;
				nativeCommand: boolean;
		  }
		| undefined
	>();
	const [stopAttempt, setStopAttempt] = useState<{
		identity: Identity;
		requestId: string;
		uncertain: boolean;
	}>();
	const [stopReceipt, setStopReceipt] = useState<ActionReceipt>();
	function stopResult(
		attempt: { identity: Identity; requestId: string },
		message: string,
		routine = false,
	) {
		setStopReceipt({
			identity: attempt.identity,
			requestId: attempt.requestId,
			message,
			routine,
		});
	}
	type RenameEditor = {
		identity: Identity;
		name: string;
		editing: boolean;
		message: string;
	};
	const [renameEditor, setRenameEditor] = useState<RenameEditor>();
	type RenameAttempt = {
		identity: Identity;
		name: string;
		requestId: string;
		message: string;
	};
	// Exact-generation unresolved intents, bounded like the existing volatile draft owners.
	// Never evict an uncertain intent just to admit a new rename.
	const renamePending = useRef(new Map<string, RenameAttempt>());
	const renamePreparation = useRef<{ canceled: boolean } | undefined>(
		undefined,
	);
	function openRename() {
		const owner = live.current.selected;
		if (
			!owner ||
			!live.current.reachable ||
			liveSummary(owner)?.rename !== true ||
			operation.current
		)
			return;
		const pending = renamePending.current.get(identityKey(owner));
		if (pending) {
			setRenameEditor({
				identity: pending.identity,
				name: pending.name,
				editing: true,
				message: pending.message,
			});
			return;
		}
		const summary = liveSummary(owner)!;
		setRenameEditor({
			identity: { ...owner },
			name: summary.unnamed === true ? "" : summary.session,
			editing: true,
			message: "",
		});
	}
	function editRename(name: string) {
		if (
			!renamePending.current.has(identityKey(renameEditor?.identity)) &&
			!operation.current
		)
			setRenameEditor((old) => old && { ...old, name, message: "" });
	}
	function cancelRename() {
		if (renamePreparation.current) renamePreparation.current.canceled = true;
		setRenameEditor((old) => old && { ...old, editing: false });
	}
	async function saveRename() {
		const editor = renameEditor;
		if (
			!editor ||
			renamePending.current.has(identityKey(editor.identity)) ||
			!editor.name.trim() ||
			editor.name.length > 120 ||
			!actionReady ||
			identityKey(editor.identity) !== identityKey(live.current.selected) ||
			liveSummary(editor.identity)?.rename !== true ||
			operation.current
		)
			return;
		if (renamePending.current.size >= 32) {
			setRenameEditor({
				...editor,
				message: "Check prior renames in Pi.",
			});
			return;
		}
		if (!beginOperation()) return;
		const preparation = { canceled: false };
		renamePreparation.current = preparation;
		const attempt: RenameAttempt = {
			identity: { ...editor.identity },
			name: editor.name,
			message: "",
			requestId: createRequestId(),
		};
		const epoch = controlEpoch.current;
		const key = identityKey(attempt.identity);
		const message = (message: string) => {
			attempt.message = message;
			setRenameEditor((old) =>
				old && identityKey(old.identity) === key ? { ...old, message } : old,
			);
		};
		let dispatched = false;
		message("Acquiring control");
		try {
			const auth = await acquireAuthority(attempt.identity, epoch);
			if (preparation.canceled) {
				message("Canceled");
				return;
			}
			if (
				!auth ||
				!validAuthority(auth, attempt.identity, epoch) ||
				liveSummary(attempt.identity)?.rename !== true
			) {
				message("Not sent");
				return;
			}
			renamePreparation.current = undefined;
			renamePending.current.set(key, attempt);
			dispatched = true;
			message("Saving");
			const response = await fetch("/api/rename", {
				method: "POST",
				headers: { "content-type": "application/json", "x-c2-csrf": "input" },
				body: JSON.stringify({
					...attempt.identity,
					name: attempt.name,
					requestId: attempt.requestId,
					lease: auth.lease,
				}),
			});
			if (!response.ok) {
				if (renamePending.current.get(key) === attempt)
					renamePending.current.delete(key);
				message("Rejected");
				if (
					authority.current === auth &&
					(response.status === 401 || response.status === 409)
				)
					dropControl();
				return;
			}
			const receipt = await readReceipt(response, attempt.requestId);
			// A newer native name observation wins over this void-call receipt.
			if (renamePending.current.get(key) !== attempt) return;
			if (receipt.status === "rejected") {
				renamePending.current.delete(key);
				message(`Rejected: ${receipt.reason}`);
			} else
				message(
					receipt.status === "uncertain"
						? "Rename uncertain. Check Pi."
						: "Pending",
				);
		} catch {
			if (!dispatched) message("Not sent");
			else if (renamePending.current.get(key) === attempt)
				message("Rename uncertain. Check Pi.");
		} finally {
			if (renamePreparation.current === preparation)
				renamePreparation.current = undefined;
			endOperation();
		}
	}
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
	const selectedKey = identityKey(selected);
	useEffect(() => {
		setDraft(drafts.current.get(selectedKey)?.text ?? "");
		setAttachment(drafts.current.get(selectedKey)?.images);
	}, [selectedKey, paired]);
	useEffect(() => {
		const urls =
			paired && attachment
				? attachment.map((file) => URL.createObjectURL(file))
				: [];
		setPreview(urls);
		return () => {
			urls.forEach((url) => URL.revokeObjectURL(url));
		};
	}, [attachment, selectedKey, paired]);
	useEffect(() => {
		const timer = setInterval(() => {
			if (authority.current && authority.current.expires <= Date.now()) {
				const expiredIdentity = authority.current.identity;
				dropControl();
				setInputStatus("Read-only", expiredIdentity, true);
			}
		}, 500);
		const leave = () => dropControl();
		window.addEventListener("pagehide", leave);
		return () => {
			clearInterval(timer);
			window.removeEventListener("pagehide", leave);
		};
	}, []);
	const current =
		view.selected &&
		`${view.selected.instance}:${view.selected.generation}` === selectedKey;

	const reachable = session.reachable;
	const selectedSummary = view.sessions.find(
		(s) =>
			s.instance === selected?.instance &&
			s.generation === selected?.generation,
	);
	const inputIdle =
		selectedSummary?.parent === "idle" &&
		!selectedSummary.pending &&
		selectedSummary.stop !== "stopping";
	// Public held state is only a conflict indicator, never browser authority.
	const actionReady =
		reachable &&
		!operating &&
		(!view.controller?.held ||
			(held && !!authority.current && authority.current.expires > Date.now()));
	const commands = selectedCommands(view, selected, reachable);
	const commandModels = commands ? view.snapshot?.commandModels : undefined;
	const slashNotice = slashGuidance(draft, !!attachment, !inputIdle, commands);
	const canSend = actionReady && inputIdle && !slashNotice;
	const canBusyText =
		actionReady &&
		selectedSummary?.busyText === true &&
		selectedSummary.stop !== "stopping" &&
		!draft.trimStart().startsWith("/");
	const canRetryInput =
		!outstanding?.nativeCommand &&
		actionReady &&
		(outstanding?.deliverAs
			? selectedSummary?.busyText === true &&
				selectedSummary.stop !== "stopping"
			: inputIdle) &&
		!slashGuidance(
			outstanding?.text ?? "",
			!!outstanding?.files,
			!inputIdle || !!outstanding?.deliverAs,
			commands,
		);
	const canControl = actionReady;
	const canStop =
		canControl &&
		!!selectedSummary &&
		selectedSummary.stop !== "stopping" &&
		(selectedSummary.parent === "working" || !!selectedSummary.pending) &&
		!stopAttempt;
	// Presentation follows native activity and admission, never receipt wording.
	let composerAvailability = "";
	if (
		!current ||
		view.connection !== "connected" ||
		!session.observed ||
		session.transport !== "open"
	) {
		composerAvailability = "Disconnected";
	} else if (view.conflict) {
		composerAvailability = "Read-only";
	} else if (operating) {
		const sendingHere =
			outstanding?.identity.instance === selected?.instance &&
			outstanding?.identity.generation === selected?.generation;
		composerAvailability =
			outstanding && !outstanding.uncertain
				? `${sendingHere ? "Sending" : "Sending elsewhere"}`
				: "Please wait";
	} else if (outstanding) {
		composerAvailability = "Delivery unknown";
	} else if (view.controller?.held && !held) {
		composerAvailability = "Control held elsewhere";
	} else if (!inputIdle) {
		composerAvailability =
			selectedSummary?.stop === "stopping"
				? "Stopping"
				: selectedSummary?.busyText !== true
					? "Busy text unavailable. Restart Pi."
					: attachment
						? "Remove images to send while busy."
						: "Choose Steer or Follow-up, then Send.";
	}
	if (reachable && !operating && !outstanding && slashNotice)
		composerAvailability = slashNotice;
	function beginOperation() {
		if (operation.current) return false;
		operation.current = true;
		setOperating(true);
		return true;
	}
	function endOperation() {
		operation.current = false;
		setOperating(false);
	}
	function validAuthority(
		auth: NonNullable<typeof authority.current>,
		identity: Identity,
		epoch: number,
	) {
		const now = live.current;
		return (
			now.paired &&
			now.reachable &&
			identityKey(live.current.selected) ===
				`${identity.instance}:${identity.generation}` &&
			controlEpoch.current === epoch &&
			authority.current === auth &&
			auth.identity.instance === identity.instance &&
			auth.identity.generation === identity.generation &&
			now.held &&
			auth.expires > Date.now() &&
			!!now.view.controller?.held &&
			now.view.controller.revision === auth.revision &&
			now.view.controller.expires > Date.now()
		);
	}
	function liveSummary(identity: Identity) {
		return live.current.view.sessions.find(
			(s) =>
				s.instance === identity.instance &&
				s.generation === identity.generation,
		);
	}
	async function acquireAuthority(identity: Identity, epoch: number) {
		const auth = authority.current;
		if (auth && validAuthority(auth, identity, epoch)) return auth;
		if (
			!live.current.paired ||
			!live.current.reachable ||
			live.current.view.controller?.held ||
			identityKey(live.current.selected) !==
				`${identity.instance}:${identity.generation}` ||
			controlEpoch.current !== epoch
		)
			return;
		return await requestControl("claim", identity, epoch);
	}
	async function requestStop(retry = false) {
		if (!selected || !canControl || operation.current || (!retry && !canStop))
			return;
		const pending = retry
			? stopAttempt
			: {
					identity: selected,
					requestId: createRequestId(),
					uncertain: false,
				};
		if (
			!pending ||
			`${pending.identity.instance}:${pending.identity.generation}` !==
				selectedKey
		)
			return;
		if (!beginOperation()) return;
		const epoch = controlEpoch.current;
		let dispatched = false;
		stopResult(pending, "Stop: Requesting");
		try {
			const auth = await acquireAuthority(pending.identity, epoch);
			const summary = liveSummary(pending.identity);
			if (
				!auth ||
				!validAuthority(auth, pending.identity, epoch) ||
				!summary ||
				(!retry &&
					(summary.stop === "stopping" ||
						(summary.parent !== "working" && !summary.pending)))
			) {
				stopResult(
					pending,
					`Stop: ${pending.uncertain ? "Outcome unknown. Retry not sent." : "Not sent"}`,
				);
				return;
			}
			setStopAttempt(pending);
			dispatched = true;
			const response = await fetch("/api/stop", {
				method: "POST",
				headers: { "content-type": "application/json", "x-c2-csrf": "input" },
				body: JSON.stringify({
					...pending.identity,
					requestId: pending.requestId,
					lease: auth.lease,
				}),
			});
			if (!response.ok) {
				setStopAttempt(pending.uncertain ? pending : undefined);
				stopResult(
					pending,
					`Stop: ${pending.uncertain ? "Outcome unknown. Retry rejected." : "Rejected before dispatch"}`,
				);
				if (
					authority.current === auth &&
					(response.status === 401 || response.status === 409)
				)
					dropControl();
				return;
			}
			const receipt = await readReceipt(response, pending.requestId);
			const uncertain =
				receipt.status === "uncertain" ||
				(pending.uncertain && receipt.status === "rejected");
			setStopAttempt(uncertain ? { ...pending, uncertain: true } : undefined);
			stopResult(
				pending,
				`Stop: ${uncertain ? "Outcome unknown. Check Pi before retrying." : receipt.status === "dispatched" ? "Pending" : `Rejected: ${receipt.reason}`}`,
				!uncertain && receipt.status === "dispatched",
			);
		} catch {
			if (!dispatched) {
				stopResult(pending, `Stop: Not sent`);
				return;
			}
			setStopAttempt({ ...pending, uncertain: true });
			stopResult(pending, `Stop: Outcome unknown. Check Pi before retrying.`);
		} finally {
			endOperation();
		}
	}
	function saveDraft(value: Draft) {
		if (!selectedKey) return;
		// Existing <=32 generation budget; never discard the outstanding owner's draft.
		if (!drafts.current.has(selectedKey) && drafts.current.size >= 32) {
			const pendingKey =
				outstanding &&
				`${outstanding.identity.instance}:${outstanding.identity.generation}`;
			const oldest = [...drafts.current.keys()].find(
				(key) => key !== selectedKey && key !== pendingKey,
			)!;
			drafts.current.delete(oldest);
			setInputStatus("Oldest inactive draft discarded (32 draft limit)");
		}
		drafts.current.set(selectedKey, value);
		setDraft(value.text);
		setAttachment(value.images);
	}
	function editDraft(text: string) {
		saveDraft({ text, images: attachment });
	}
	function removeImage(index: number) {
		const images = attachment?.filter((_, position) => position !== index);
		saveDraft({ text: draft, images: images?.length ? images : undefined });
	}
	function pickImage(files: File[]) {
		if (!files.length) return;
		const images = [...(attachment ?? []), ...files];
		if (
			images.length > 4 ||
			images.reduce((sum, file) => sum + file.size, 0) > 4_000_000 ||
			files.some(
				(file) =>
					!["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
					!file.size,
			)
		) {
			setInputStatus(
				"Choose up to four still PNG/JPEG/WebP images, at most 4,000,000 bytes total; HEIC/SVG/GIF unsupported",
			);
			return;
		}
		const total = () => {
			const retained = new Set(
				[...drafts.current.entries()]
					.filter(([key]) => key !== selectedKey)
					.flatMap(([, value]) => value.images ?? []),
			);
			images.forEach((file) => retained.add(file));
			outstanding?.files?.forEach((file) => retained.add(file));
			return [...retained].reduce((sum, file) => sum + file.size, 0);
		};
		let discarded = false;
		while (total() > 16_000_000) {
			const inactive = [...drafts.current.entries()].find(
				([key, value]) =>
					key !== selectedKey &&
					value.images &&
					!value.images.some((file) => outstanding?.files?.includes(file)),
			);
			if (!inactive) {
				setInputStatus("Image draft budget exceeded (16,000,000 bytes)");
				return;
			}
			drafts.current.set(inactive[0], { text: inactive[1].text });
			discarded = true;
		}
		saveDraft({ text: draft, images });
		if (discarded)
			setInputStatus(
				"Oldest inactive attachments discarded (16,000,000-byte limit); text retained",
			);
		else setInputNotice(undefined);
	}
	async function requestControl(
		action: "claim" | "takeover" | "release" | "renew",
		identity: Identity,
		epoch: number,
	) {
		const key = `${identity.instance}:${identity.generation}`;
		const lease = authority.current?.lease;
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
			if (
				key !== identityKey(live.current.selected) ||
				epoch !== controlEpoch.current ||
				!live.current.paired ||
				!live.current.reachable
			) {
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
				setInputStatus("Read-only", identity);
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
				const beforeConfirmation = live.current.view;
				const scope = live.current.readLifetime;
				const confirmation = await fetch(
					`/api/snapshot?instance=${identity.instance}&generation=${identity.generation}`,
				);
				const current = (await confirmation.json()) as View;
				if (
					key !== identityKey(live.current.selected) ||
					epoch !== controlEpoch.current ||
					!live.current.paired ||
					!live.current.reachable
				)
					return;
				if (
					!confirmation.ok ||
					current.selected?.instance !== identity.instance ||
					current.selected?.generation !== identity.generation ||
					current.connection !== "connected" ||
					current.conflict ||
					!current.controller?.held ||
					current.controller.revision !== result.revision ||
					current.controller.expires <= Date.now()
				) {
					dropControl();
					setInputStatus("Read-only", identity);
					return;
				}
				// Do not rewind activity or pending questions observed by SSE while confirmation waited.
				if (live.current.view === beforeConfirmation)
					observeView(current, scope);
				if (epoch !== controlEpoch.current || !authority.current) return;
				setHeld(true);
			}
			setInputStatus(
				result.lease ? "Control acquired" : "Read-only",
				identity,
				true,
			);
			return authority.current;
		} catch {
			dropControl();
			setInputStatus("Control unconfirmed. Read-only.", identity);
		}
	}
	async function controlAction(action: "takeover" | "release" | "renew") {
		if (!selected || !reachable || !beginOperation()) return;
		try {
			await requestControl(action, selected, controlEpoch.current);
		} finally {
			endOperation();
		}
	}
	async function sendText(retry = false, deliverAs?: TextRequest["deliverAs"]) {
		// Capture the default before acquiring authority; retries keep their original mode.
		const mode = retry
			? outstanding?.deliverAs
			: (deliverAs ?? (inputIdle ? undefined : "steer"));
		if (
			!(retry ? canRetryInput : mode ? canBusyText : canSend) ||
			operation.current ||
			!selected ||
			(outstanding && !retry)
		)
			return;
		let pending = retry
			? outstanding
			: {
					identity: selected,
					requestId: createRequestId(),
					text: draft,
					deliverAs: mode,
					files: attachment,
					sources: undefined as string[] | undefined,
					uncertain: false,
					nativeCommand:
						commands?.some(
							(c) =>
								c.source === "builtin" &&
								c.name === draft.slice(1).split(" ", 1)[0],
						) ?? false,
				};
		if (
			!pending ||
			`${pending.identity.instance}:${pending.identity.generation}` !==
				selectedKey ||
			(!pending.text.trim() && !pending.files) ||
			(!!pending.deliverAs && !!pending.files) ||
			slashGuidance(
				pending.text,
				!!pending.files,
				!inputIdle || !!pending.deliverAs,
				commands,
			)
		)
			return;
		if (!beginOperation()) return;
		setOutstanding(pending);
		const epoch = controlEpoch.current;
		let dispatched = false;
		inputResult(pending, "Acquiring control");
		const upload = pending.files ? new AbortController() : undefined;
		imageUpload.current = upload;
		try {
			const auth = await acquireAuthority(pending.identity, epoch);
			if (!auth) {
				inputResult(
					pending,
					pending.uncertain ? "Outcome unknown. Retry not sent." : "Not sent",
				);
				return;
			}
			if (pending.files && !pending.sources) {
				const sources = [];
				for (const file of pending.files) {
					const bytes = new Uint8Array(await file.arrayBuffer());
					let binary = "";
					for (let offset = 0; offset < bytes.length; offset += 8192)
						binary += String.fromCharCode(
							...bytes.subarray(offset, offset + 8192),
						);
					sources.push(btoa(binary));
				}
				pending = { ...pending, sources };
			}
			const summary = liveSummary(pending.identity);
			if (
				!validAuthority(auth, pending.identity, epoch) ||
				!summary ||
				summary.stop === "stopping" ||
				(pending.deliverAs
					? summary.busyText !== true
					: summary.parent !== "idle" || summary.pending) ||
				slashGuidance(
					pending.text,
					!!pending.files,
					summary.parent !== "idle" || !!summary.pending || !!pending.deliverAs,
					selectedCommands(
						live.current.view,
						pending.identity,
						live.current.reachable,
					),
				)
			) {
				setOutstanding(pending.uncertain ? pending : undefined);
				inputResult(
					pending,
					pending.uncertain
						? "Outcome unknown. Retry not sent."
						: "Control changed before dispatch; nothing sent",
				);
				return;
			}
			setOutstanding(pending);
			inputResult(pending, "Sending");
			dispatched = true;
			const sourcesForSend = pending.sources;
			const response = await fetch(pending.files ? "/api/image" : "/api/text", {
				method: "POST",
				...(upload ? { signal: upload.signal } : {}),
				headers: { "content-type": "application/json", "x-c2-csrf": "input" },
				body: JSON.stringify({
					...pending.identity,
					requestId: pending.requestId,
					text: pending.text,
					...(pending.deliverAs ? { deliverAs: pending.deliverAs } : {}),
					...(pending.files
						? {
								images: pending.files.map((file, index) => ({
									source: sourcesForSend![index],
									mime: file.type,
								})),
							}
						: {}),
					lease: auth.lease,
				}),
			});
			if (!response.ok) {
				// A prior uncertain attempt stays uncertain even if this retry fails before forwarding.
				if (pending.uncertain) {
					setOutstanding({ ...pending, uncertain: true });
					inputResult(pending, "Delivery unknown. Retry rejected.");
				} else {
					setOutstanding(undefined);
					const result = await response.json();
					inputResult(
						pending,
						`Rejected before dispatch: ${result.error ?? "Invalid input"}`,
					);
				}
				if (response.status === 401 || response.status === 409) dropControl();
				return;
			}
			const receipt = await readReceipt(response, pending.requestId);
			if (
				receipt.status === "uncertain" ||
				(receipt.status === "rejected" && pending.uncertain)
			) {
				setOutstanding({ ...pending, uncertain: true });
				inputResult(pending, "Delivery unknown. Check Pi before retrying.");
			} else {
				setOutstanding(undefined);
				inputResult(
					pending,
					receipt.status === "dispatched"
						? pending.deliverAs === "steer"
							? "Steer requested"
							: pending.deliverAs === "followUp"
								? "Follow-up requested"
								: "Pending"
						: `Rejected: ${receipt.reason === "terminal-draft" ? "Clear or send the unsent draft in the Pi terminal first" : receipt.reason === "model-no-images" ? "Current Pi model does not support images" : receipt.reason === "images-blocked" ? "Pi settings block images" : receipt.reason === "image-policy-unknown" ? "Pi model/image policy unavailable or unknown" : receipt.reason}`,
					receipt.status === "dispatched",
				);
				const key = `${pending.identity.instance}:${pending.identity.generation}`;
				if (
					receipt.status === "dispatched" &&
					drafts.current.get(key)?.text === pending.text &&
					drafts.current.get(key)?.images === pending.files
				) {
					drafts.current.set(key, { text: "" });
					if (key === identityKey(live.current.selected)) {
						setDraft("");
						setAttachment(undefined);
						onInputCleared();
					}
				}
			}
		} catch {
			if (!dispatched) {
				inputResult(
					pending,
					pending.uncertain ? "Outcome unknown. Retry not sent." : "Not sent",
				);
				return;
			}
			setOutstanding({ ...pending, uncertain: true });
			inputResult(pending, "Delivery unknown. Check Pi before retrying.");
		} finally {
			if (!dispatched) setOutstanding(pending.uncertain ? pending : undefined);
			if (imageUpload.current === upload) imageUpload.current = undefined;
			endOperation();
		}
	}
	// All scope departures and observations apply here, before any awaited action can resume.
	function transition(next: BrowserSession, depart = false) {
		const previous = live.current;
		if (depart || next.selected?.instance !== previous.selected?.instance) {
			lastSnapshot.current = undefined;
			setReloadNotice(undefined);
		}
		const scopeChanged =
			depart ||
			next.paired !== previous.paired ||
			identityKey(next.selected) !== identityKey(previous.selected);
		if (scopeChanged)
			next = {
				...next,
				observed: false,
				readLifetime: previous.readLifetime + 1,
			};
		next = {
			...next,
			reachable:
				next.paired &&
				next.transport === "open" &&
				next.observed &&
				!!next.selected &&
				identityKey(next.view.selected) === identityKey(next.selected) &&
				next.view.connection === "connected" &&
				!next.view.conflict,
		};
		live.current = next;
		if (
			scopeChanged ||
			!next.reachable ||
			(authority.current &&
				(!next.view.controller?.held ||
					next.view.controller.revision !== authority.current.revision ||
					next.view.controller.expires <= Date.now()))
		) {
			dropControl();
			setInputNotice(undefined);
		}
		publishSession();
	}
	function observeView(
		next: View,
		scope: number,
		transport = live.current.transport,
		establishAccess = false,
	) {
		if (
			scope !== live.current.readLifetime ||
			identityKey(next.selected) !== identityKey(live.current.selected)
		)
			return false;
		if (
			next.connection === "connected" &&
			!next.conflict &&
			next.snapshot &&
			identityKey(next.snapshot) === identityKey(next.selected)
		) {
			const snapshot = next.snapshot;
			if (
				lastSnapshot.current?.instance === snapshot.instance &&
				lastSnapshot.current.generation !== snapshot.generation &&
				snapshot.generationReason === "reload"
			)
				setReloadNotice({
					instance: snapshot.instance,
					generation: snapshot.generation,
				});
			lastSnapshot.current = {
				instance: snapshot.instance,
				generation: snapshot.generation,
			};
		}
		const pendingRename = renamePending.current.get(identityKey(next.selected));
		if (
			pendingRename &&
			next.connection === "connected" &&
			!next.conflict &&
			identityKey(next.selected) === identityKey(pendingRename.identity) &&
			next.sessions.some(
				(s) =>
					identityKey(s) === identityKey(pendingRename.identity) &&
					s.session === pendingRename.name &&
					s.unnamed !== true,
			)
		) {
			renamePending.current.delete(identityKey(pendingRename.identity));
			setRenameEditor((old) =>
				old && identityKey(old.identity) === identityKey(pendingRename.identity)
					? { ...old, message: "Native name observed" }
					: old,
			);
		}
		const selected = live.current.selected;
		const replacement =
			selected && next.sessions.find((s) => s.instance === selected.instance);
		transition({
			...live.current,
			view: next,
			transport,
			observed: true,
			...(establishAccess ? { paired: true, checkingDevice: false } : {}),
			cached: next.snapshot ?? live.current.cached,
			...(replacement && replacement.generation !== selected?.generation
				? {
						selected: {
							instance: replacement.instance,
							generation: replacement.generation,
						},
						cached: undefined,
					}
				: {}),
		});
		return true;
	}
	function choose(instance: string) {
		const session = live.current.view.sessions.find(
			(s) => s.instance === instance,
		);
		const selected = session
			? { instance: session.instance, generation: session.generation }
			: undefined;
		if (identityKey(selected) === identityKey(live.current.selected)) return;
		transition({
			...live.current,
			selected,
			cached: undefined,
			transport: "connecting",
		});
	}
	function unpair(message: string) {
		transition(
			{
				...live.current,
				paired: false,
				cached: undefined,
				view: { connection: "disconnected", sessions: [] },
				error: message,
			},
			true,
		);
		onAccessDeparture();
	}
	useEffect(() => {
		if (!paired) return;
		let active = true;
		let probing = false;
		let transportDeparture = 0;
		const scope = live.current.readLifetime;
		const query = selected
			? `?instance=${selected.instance}&generation=${selected.generation}`
			: "";
		const events = new EventSource(`/api/events${query}`);
		transition({ ...live.current, transport: "connecting", observed: false });
		const valid = () => active && scope === live.current.readLifetime;
		events.addEventListener("snapshot", (event) => {
			if (valid())
				observeView(
					JSON.parse((event as MessageEvent).data) as View,
					scope,
					"open",
				);
		});
		events.onopen = () => {
			if (valid())
				transition({
					...live.current,
					transport: "open",
				});
		};
		events.onerror = () => {
			if (!valid()) return;
			transition({
				...live.current,
				transport: "disconnected",
				observed: false,
			});
			const departure = ++transportDeparture;
			// One authenticated read per failed connection; Forget owns its uncertain outcome.
			if (probing || forgetting.current) return;
			probing = true;
			const beforeProbe = live.current.view;
			const validProbe = () =>
				valid() && !forgetting.current && departure === transportDeparture;
			void fetch(`/api/snapshot${query}`)
				.then(async (response) => {
					if (!validProbe()) return;
					if (response.status === 401) {
						unpair(
							"This device is no longer paired. Get a new pairing code in your terminal.",
						);
						return;
					}
					if (!response.ok) return;
					const next = (await response.json()) as View;
					// Replay-only reopen may have no SSE snapshot. A successful native read,
					// not transport opening, restores observation; newer SSE always wins.
					if (validProbe() && live.current.view === beforeProbe)
						observeView(next, scope);
				})
				.catch(() => {})
				.finally(() => {
					probing = false;
				});
		};
		return () => {
			active = false;
			events.close();
		};
	}, [paired, selectedKey, session.readLifetime]);
	useEffect(() => {
		let active = true;
		const scope = live.current.readLifetime;
		const probe = new AbortController();
		const timeout = setTimeout(() => probe.abort(), 8000);
		const selected = live.current.selected;
		const query = selected
			? `?instance=${selected.instance}&generation=${selected.generation}`
			: "";
		void fetch(`/api/snapshot${query}`, { signal: probe.signal })
			.then(async (response) => {
				if (response.status === 401) return;
				if (!response.ok) throw Error("Access check unavailable");
				const next = (await response.json()) as View;
				if (!active || scope !== live.current.readLifetime) return;
				// Access is established before applying this scoped read; opening SSE is not native reachability.
				observeView(next, scope, live.current.transport, true);
			})
			.catch(() => {
				if (active && scope === live.current.readLifetime)
					transition({
						...live.current,
						error: "Gateway unavailable. Refresh to check access.",
					});
			})
			.finally(() => {
				clearTimeout(timeout);
				if (active && scope === live.current.readLifetime)
					transition({ ...live.current, checkingDevice: false });
			});
		return () => {
			active = false;
			clearTimeout(timeout);
			probe.abort();
		};
	}, []);
	function setAccessError(error: string) {
		transition({ ...live.current, error });
	}
	function setForgetStatus(forgetStatus: string) {
		transition({ ...live.current, forgetStatus });
	}
	// Reports admission, not pairing success, so a blocked caller does not clear its code.
	async function pair(code: string, remember: boolean) {
		if (!beginOperation()) return false;
		transition({ ...live.current }, true);
		setAccessError("");
		try {
			const response = await fetch("/api/pair", {
				method: "POST",
				headers: { "content-type": "application/json", "x-c2-csrf": "pair" },
				body: JSON.stringify({ code, remember }),
			});
			if (!response.ok) {
				setAccessError(
					response.status === 401
						? "Code invalid, expired, already used or locked. Run npm start -- pair in your terminal for a fresh code."
						: response.status === 429
							? "Pairing limit reached. Wait a minute before trying again; if eight devices are paired, revoke one in your terminal."
							: response.status === 503
								? "Pairing unavailable. Check your gateway, then try again explicitly."
								: "Pairing rejected. Check the six-digit code and gateway, then try again.",
				);
				return true;
			}
			if ((await response.json()).paired !== true)
				throw Error("Unconfirmed pairing");
			setForgetStatus("");
			transition({ ...live.current, paired: true });
		} catch {
			setAccessError("Pairing unconfirmed. Refresh to check access.");
		} finally {
			endOperation();
		}
		return true;
	}
	async function forget() {
		if (!beginOperation()) return;
		forgetting.current = true;
		transition({ ...live.current }, true);
		setForgetStatus("Removing device");
		try {
			const response = await fetch("/api/forget", {
				method: "POST",
				headers: { "content-type": "application/json", "x-c2-csrf": "input" },
				body: JSON.stringify({}),
			});
			if (response.status === 401) {
				unpair(
					"This device is already unpaired. Native attempts are not cancelled.",
				);
				return;
			}
			if (!response.ok) {
				setForgetStatus("Removal unconfirmed. Retry explicitly.");
				return;
			}
			if ((await response.json()).forgotten !== true)
				throw Error("Unconfirmed forget");
			unpair("This device was forgotten. Native attempts are not cancelled.");
		} catch {
			setForgetStatus("Removal unconfirmed. Retry explicitly.");
		} finally {
			forgetting.current = false;
			endOperation();
		}
	}
	function questionPending(owner: Identity, invocation: string) {
		return (
			identityKey(live.current.view.questions) === identityKey(owner) &&
			!!live.current.view.questions?.pending.some(
				(p) => p.invocationId === invocation,
			)
		);
	}
	const answerQuestionnaire: QuestionnaireCommand = async (
		intent,
		progress,
	) => {
		const owner = { ...intent.identity };
		if (
			!canControl ||
			operation.current ||
			identityKey(owner) !== identityKey(live.current.selected) ||
			!questionPending(owner, intent.original.invocationId)
		)
			return "blocked";
		const original = JSON.parse(JSON.stringify(intent.original)) as Omit<
			QuestionReply,
			"replyId"
		>;
		const payload = {
			...original,
			replyId: createRequestId(),
		};
		if (new TextEncoder().encode(JSON.stringify(payload)).length > 65536)
			return "too-large";
		if (!beginOperation()) return "blocked";
		const epoch = controlEpoch.current;
		let dispatched = false;
		progress("submitting");
		try {
			const auth = await acquireAuthority(owner, epoch);
			if (
				!auth ||
				!validAuthority(auth, owner, epoch) ||
				!questionPending(owner, original.invocationId)
			)
				return "changed";
			progress("forwarding");
			dispatched = true;
			const response = await fetch("/api/question-reply", {
				method: "POST",
				headers: { "content-type": "application/json", "x-c2-csrf": "input" },
				body: JSON.stringify({ ...owner, lease: auth.lease, reply: payload }),
			});
			const result = (await response.json()) as QuestionReceipt;
			// Closure is not proof of browser completion; only a correlated callback receipt can confirm it.
			if (!validAuthority(auth, owner, epoch)) throw Error("Authority changed");
			if (!response.ok) return "rejected";
			if (
				result.replyId !== payload.replyId ||
				result.invocationId !== payload.invocationId ||
				!["accepted", "invalid", "uncertain", "not-pending"].includes(
					result.status,
				)
			)
				throw Error("Invalid receipt");
			return result.status;
		} catch {
			return dispatched ? "response-lost" : "preparation-failed";
		} finally {
			endOperation();
		}
	};
	return {
		paired,
		selected,
		view,
		transport,
		checkingDevice,
		error,
		forgetStatus,
		snapshot:
			session.cached && identityKey(session.cached) === selectedKey
				? session.cached
				: undefined,
		choose,
		pair,
		forget,
		selectedKey,
		current,
		reachable,
		selectedSummary,
		held,
		operating,
		canControl,
		composer: {
			paired,
			selected,
			selectedKey,
			reachable,
			conflict: view.conflict,
			controller: view.controller,
			inputIdle,
			held,
			operating,
			composerAvailability,
			reloadNotice:
				reachable &&
				!!reloadNotice &&
				identityKey(reloadNotice) === selectedKey,
			inputNotice:
				inputNotice &&
				`${inputNotice.identity.instance}:${inputNotice.identity.generation}` ===
					selectedKey
					? inputNotice
					: undefined,
			inputReceipt:
				inputReceipt &&
				`${inputReceipt.identity.instance}:${inputReceipt.identity.generation}` ===
					selectedKey
					? inputReceipt
					: undefined,
			stopReceipt:
				stopReceipt &&
				`${stopReceipt.identity.instance}:${stopReceipt.identity.generation}` ===
					selectedKey
					? stopReceipt
					: undefined,
			outstanding,
			stopAttempt,
			draft,
			attachment,
			preview,
			editDraft,
			pickImage,
			removeImage,
			commands,
			commandModels,
			acknowledgeCommand: () => {
				if (!operating && outstanding?.nativeCommand && outstanding.uncertain) {
					inputResult(outstanding, "Command outcome unknown. Check Pi.");
					const key = identityKey(outstanding.identity);
					if (drafts.current.get(key)?.text === outstanding.text) {
						drafts.current.set(key, { text: "" });
						if (key === selectedKey) setDraft("");
					}
					setOutstanding(undefined);
				}
			},
			canSend,
			canBusyText,
			canRetryInput,
			canControl,
			canStop,
			sendText,
			requestStop,
		},
		controlAction,
		answerQuestionnaire,
		renameEditor:
			renameEditor && identityKey(renameEditor.identity) === selectedKey
				? renameEditor
				: undefined,
		renameLocked: renamePending.current.has(selectedKey),
		canRename: reachable && selectedSummary?.rename === true && !operating,
		canSaveRename:
			actionReady &&
			selectedSummary?.rename === true &&
			!renamePending.current.has(selectedKey),
		openRename,
		editRename,
		cancelRename,
		saveRename,
	};
}
