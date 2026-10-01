import { createHash } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Identity, Receipt, TextRequest, ImageRequest, StopRequest, Summary } from "../shared/protocol.js";

// One ledger per actual bridge generation. Never evict an attempted ID and reinvoke it.
export function nativeInput(
	identity: Identity,
	ctx: ExtensionContext,
	send: ExtensionAPI["sendUserMessage"] | undefined,
	current: () => boolean,
	settings?: ExtensionAPI["getSettings"],
) {
	const ledger = new Map<string, { kind: "stop" | "image" | "text"; hash: string; receipt: Receipt }>();
	let stop: Summary["stop"], sequence = 0, attemptedAt = -1;
	const manager = ctx.sessionManager;
	const sessionId = manager.getSessionId(), sessionFile = manager.getSessionFile();
	function sameContext(observed: ExtensionContext) {
		try {
			return current() && observed.sessionManager === manager &&
				manager.getSessionId() === sessionId && manager.getSessionFile() === sessionFile;
		} catch { return false; }
	}
	function observe(event: "agent_start" | "agent_end" | "agent_settled", observed: ExtensionContext) {
		if (!sameContext(observed)) return;
		const order = ++sequence;
		if (event === "agent_start" && stop === "parent-settled") stop = undefined;
		if (event === "agent_settled" && stop === "stopping" && order > attemptedAt &&
			observed.isIdle() && !observed.hasPendingMessages()) stop = "parent-settled";
	}
	function observation(): Summary["stop"] {
		if (stop === "parent-settled" && (!ctx.isIdle() || ctx.hasPendingMessages())) stop = undefined;
		return stop;
	}
	const dispatch = (request: TextRequest | ImageRequest | StopRequest): Receipt => {
		const stopping = !("text" in request);
		const image = "image" in request;
		const kind = stopping ? "stop" : image ? "image" : "text";
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
			.update(stopping ? JSON.stringify(["stop"]) : image
				? JSON.stringify(["image", request.text, request.mime, request.sourceDigest])
				: JSON.stringify(request.text))
			.digest("hex");
		const prior = ledger.get(request.requestId);
		if (prior) return prior.kind === kind && prior.hash === hash ? prior.receipt : reject("mismatch");
		if (ledger.size >= 256) return reject("ledger-full");
		let imagePolicy: Receipt["reason"] | undefined;
		if (image) {
			try {
				const isSettingsObject = (value: unknown): value is Record<string, unknown> =>
					typeof value === "object" && value !== null &&
					(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
				const snapshot: unknown = settings?.();
				if (!settings || !isSettingsObject(snapshot) ||
					(snapshot.images !== undefined && !isSettingsObject(snapshot.images)))
					throw Error("Image settings unavailable");
				const block = snapshot.images?.blockImages;
				imagePolicy = !ctx.model ? "image-policy-unknown"
					: !ctx.model.input.includes("image") ? "model-no-images"
					: block === true ? "images-blocked"
					// Pi 0.99.2 public settings snapshots omit defaults; documented blockImages default is false.
					: block !== undefined && block !== false ? "image-policy-unknown" : undefined;
			} catch { imagePolicy = "image-policy-unknown"; }
		}
		const reason = stop === "stopping" ? "stopping"
			: stopping ? typeof ctx.abort !== "function" ? "unavailable"
				: ctx.isIdle() && !ctx.hasPendingMessages() ? "idle" : undefined
			: !image && !request.text.trim() ? "invalid"
				: !send ? "unavailable"
					: !ctx.isIdle() || ctx.hasPendingMessages() ? "busy" : imagePolicy;
		if (reason) {
			const receipt = reject(reason);
			ledger.set(request.requestId, { kind, hash, receipt });
			return receipt;
		}
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
			if (stopping) ctx.abort();
			else send!(image ? [
				...(request.text ? [{ type: "text" as const, text: request.text }] : []),
				{ type: "image", data: request.image, mimeType: request.mime },
			] : request.text, { expandPromptTemplates: false });
			receipt.status = "dispatched";
		} catch {
			/* A throw after attempting a public call is not proof of non-delivery. */
		}
		return receipt;
	};
	return Object.assign(dispatch, { observe, observation });
}
