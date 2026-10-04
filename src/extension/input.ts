import { createHash } from "node:crypto";
import { nativeCommands } from "./commands.js";
import type { NativeCommands } from "./native-commands.js";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	Identity,
	Receipt,
	TextRequest,
	ImageRequest,
	StopRequest,
	RenameRequest,
	Summary,
} from "../shared/protocol.js";

// One ledger per actual bridge generation. Never evict an attempted ID and reinvoke it.
export function nativeInput(
	identity: Identity,
	ctx: ExtensionContext,
	send: ExtensionAPI["sendUserMessage"] | undefined,
	current: () => boolean,
	settings?: ExtensionAPI["getSettings"],
	getCommands?: ExtensionAPI["getCommands"],
	setSessionName?: ExtensionAPI["setSessionName"],
	native?: NativeCommands,
) {
	const ledger = new Map<
		string,
		{
			kind: "stop" | "image" | "text" | "rename";
			hash: string;
			receipt: Receipt;
		}
	>();
	let stop: Summary["stop"],
		sequence = 0,
		attemptedAt = -1;
	const manager = ctx.sessionManager;
	const sessionId = manager.getSessionId(),
		sessionFile = manager.getSessionFile();
	function sameContext(observed: ExtensionContext) {
		try {
			return (
				current() &&
				observed.sessionManager === manager &&
				manager.getSessionId() === sessionId &&
				manager.getSessionFile() === sessionFile
			);
		} catch {
			return false;
		}
	}
	function observe(
		event: "agent_start" | "agent_end" | "agent_settled",
		observed: ExtensionContext,
	) {
		if (!sameContext(observed)) return;
		const order = ++sequence;
		if (event === "agent_start" && stop === "parent-settled") stop = undefined;
		if (
			event === "agent_settled" &&
			stop === "stopping" &&
			order > attemptedAt &&
			observed.isIdle() &&
			!observed.hasPendingMessages()
		)
			stop = "parent-settled";
	}
	function observation(): Summary["stop"] {
		if (
			stop === "parent-settled" &&
			(!ctx.isIdle() || ctx.hasPendingMessages())
		)
			stop = undefined;
		return stop;
	}
	const dispatch = (
		request: TextRequest | ImageRequest | StopRequest | RenameRequest,
	): Receipt => {
		const renaming = "name" in request;
		const stopping = !("text" in request) && !renaming;
		const image = "images" in request;
		const textRequest: TextRequest | undefined =
			"text" in request ? request : undefined;
		const kind = renaming
			? "rename"
			: stopping
				? "stop"
				: image
					? "image"
					: "text";
		const reject = (reason: Receipt["reason"]): Receipt => ({
			requestId: request.requestId,
			status: "rejected",
			reason,
		});
		if (
			!sameContext(ctx) ||
			request.instance !== identity.instance ||
			request.generation !== identity.generation
		)
			return reject("stale");
		// JSON preserves lone UTF-16 surrogates that raw UTF-8 encoding replaces.
		const hash = createHash("sha256")
			.update(
				renaming
					? JSON.stringify(["rename", request.name])
					: stopping
						? JSON.stringify(["stop"])
						: image
							? JSON.stringify([
									"image",
									textRequest!.text,
									request.images.map(({ mime, sourceDigest }) => [
										mime,
										sourceDigest,
									]),
								])
							: JSON.stringify([
									"text",
									textRequest!.text,
									textRequest!.deliverAs ?? null,
								]),
			)
			.digest("hex");
		const prior = ledger.get(request.requestId);
		if (prior)
			return prior.kind === kind && prior.hash === hash
				? prior.receipt
				: reject("mismatch");
		if (ledger.size >= 256) return reject("ledger-full");
		let imagePolicy: Receipt["reason"] | undefined;
		if (image) {
			try {
				const isSettingsObject = (
					value: unknown,
				): value is Record<string, unknown> =>
					typeof value === "object" &&
					value !== null &&
					(Object.getPrototypeOf(value) === Object.prototype ||
						Object.getPrototypeOf(value) === null);
				const snapshot: unknown = settings?.();
				if (
					!settings ||
					!isSettingsObject(snapshot) ||
					(snapshot.images !== undefined && !isSettingsObject(snapshot.images))
				)
					throw Error("Image settings unavailable");
				const block = snapshot.images?.blockImages;
				if (!ctx.model) imagePolicy = "image-policy-unknown";
				else if (!ctx.model.input.includes("image"))
					imagePolicy = "model-no-images";
				else if (block === true) imagePolicy = "images-blocked";
				// Pi 0.99.2 omits defaults; documented blockImages default is false.
				else if (block !== undefined && block !== false)
					imagePolicy = "image-policy-unknown";
			} catch {
				imagePolicy = "image-policy-unknown";
			}
		}
		const slash =
			!stopping && !renaming && textRequest!.text.trimStart().startsWith("/");
		// Pi parses the token at a literal space; never normalize authored arguments.
		const command =
			slash && "text" in request && textRequest!.text.startsWith("/")
				? nativeCommands(getCommands, native?.available())?.find(
						(c) => c.name === textRequest!.text.slice(1).split(" ", 1)[0],
					)
				: undefined;
		const builtin = command?.source === "builtin";
		const nativeText = builtin ? textRequest!.text.trim() : "";
		const slashUnsupported =
			slash &&
			(image ||
				!!textRequest?.deliverAs ||
				!ctx.isIdle() ||
				ctx.hasPendingMessages() ||
				!command ||
				command.source === "extension" ||
				(builtin && !native?.accepts(nativeText)));
		// First matching guard wins. Rejections enter the same ledger as attempts.
		let reason: Receipt["reason"] | undefined;
		if (renaming) {
			if (!request.name.trim() || request.name.length > 120) reason = "invalid";
			else if (typeof setSessionName !== "function") reason = "unavailable";
		} else if (stop === "stopping") reason = "stopping";
		else if (stopping) {
			if (typeof ctx.abort !== "function") reason = "unavailable";
			else if (ctx.isIdle() && !ctx.hasPendingMessages()) reason = "idle";
		} else if (slashUnsupported) reason = "slash-unsupported";
		else if (!image && !textRequest!.text.trim()) reason = "invalid";
		else if (builtin) reason = native?.blocked();
		else if (!builtin && !send) reason = "unavailable";
		else if (
			(image || !textRequest!.deliverAs) &&
			(!ctx.isIdle() || ctx.hasPendingMessages())
		)
			reason = "busy";
		else reason = imagePolicy;
		if (reason) {
			const receipt = reject(reason);
			ledger.set(request.requestId, { kind, hash, receipt });
			return receipt;
		}
		// Policy reads above may call host code. Recheck captured native identity at the attempt boundary.
		if (!sameContext(ctx)) return reject("stale");
		const receipt: Receipt = {
			requestId: request.requestId,
			status: "uncertain",
			reason: "outcome-unconfirmed",
		};
		ledger.set(request.requestId, { kind, hash, receipt }); // Before attempting either void public call.
		if (stopping) {
			stop = "stopping";
			attemptedAt = sequence; // Synchronous callbacks must see the marker and receipt.
		}
		try {
			if (renaming) setSessionName!(request.name);
			else if (stopping) ctx.abort();
			else if (builtin) native!.submit(nativeText);
			else
				send!(
					image
						? [
								...(textRequest!.text
									? [{ type: "text" as const, text: textRequest!.text }]
									: []),
								...request.images.map(({ image, mime }) => ({
									type: "image" as const,
									data: image,
									mimeType: mime,
								})),
							]
						: textRequest!.text,
					{
						expandPromptTemplates: slash,
						...(!image && textRequest!.deliverAs
							? { deliverAs: textRequest!.deliverAs }
							: {}),
					},
				);
			receipt.status = "dispatched";
		} catch {
			/* A throw after attempting a public call is not proof of non-delivery. */
		}
		return receipt;
	};
	return Object.assign(dispatch, { observe, observation });
}
