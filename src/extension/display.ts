import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Value } from "@sinclair/typebox/value";
import {
	DisplayCardSchema,
	displayLimits,
	type DisplayCard,
	type Summary,
} from "../shared/protocol.js";

export const displayRequestEvent = "companion:display:v1:request";
// Trusted process-local opt-in API, not a sandbox. MUST NOT publish secrets.
// Contribute synchronously, from existing in-memory state only (no IO/actions).
// Omission/empty cards clears on the next status read. Duplicate providers discard
// both contributions; duplicate card keys discard that provider. `subagents` is reserved.
export interface DisplayRequest {
	readonly version: 1;
	readonly sessionId: string;
	readonly requestId: string;
	readonly contribute: (snapshot: {
		version: 1;
		sessionId: string;
		requestId: string;
		provider: string;
		cards: { key: string; title: string; status: string; lines: string[] }[];
	}) => void;
}
function plain(value: string): string {
	return value
		.replace(
			/(?:\u001b\]|\u009d)[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c|$)/g,
			"",
		)
		.replace(
			/(?:\u001b[P_^X]|[\u0090\u0098\u009e\u009f])[^\u001b\u009c]*(?:\u001b\\|\u009c|$)/g,
			"",
		)
		.replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\u001b[ -/]*[@-~]/g, "")
		.replace(
			/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
			"",
		);
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// All storage is request-local. The byte budget is serialized JSON (including escaping).
export function collectDisplay(
	events: ExtensionAPI["events"] | undefined,
	sessionId: string,
	current: () => boolean,
	subagents: Summary["subagents"],
): DisplayCard[] | undefined {
	const providers = new Map<string, DisplayCard[]>();
	const seen = new Set<string>();
	let open = true,
		attempts = 0;
	const contribute = (raw: unknown) => {
		if (!open || ++attempts > 32 || !current()) return;
		try {
			if (
				!record(raw) ||
				raw.version !== 1 ||
				raw.sessionId !== sessionId ||
				raw.requestId !== requestId ||
				typeof raw.provider !== "string" ||
				!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/.test(raw.provider) ||
				raw.provider === "subagents"
			)
				return;
			const provider = raw.provider;
			if (seen.has(provider)) {
				providers.delete(provider);
				return;
			}
			seen.add(provider);
			if (
				!Array.isArray(raw.cards) ||
				raw.cards.length > displayLimits.providerCards
			)
				return;
			const cards: DisplayCard[] = [];
			const keys = new Set<string>();
			for (let index = 0; index < Math.min(raw.cards.length, 4); index++) {
				const card: unknown = raw.cards[index];
				if (
					!record(card) ||
					typeof card.key !== "string" ||
					card.key.length > 48 ||
					typeof card.title !== "string" ||
					card.title.length > 80 ||
					typeof card.status !== "string" ||
					card.status.length > 160 ||
					!Array.isArray(card.lines) ||
					card.lines.length > 8
				)
					return;
				const lines: string[] = [];
				for (
					let lineIndex = 0;
					lineIndex < Math.min(card.lines.length, 8);
					lineIndex++
				) {
					const line: unknown = card.lines[lineIndex];
					if (typeof line !== "string" || line.length > 256) return;
					lines.push(plain(line));
				}
				const normalized = {
					provider,
					key: card.key,
					title: plain(card.title),
					status: plain(card.status),
					lines,
				};
				if (
					!Value.Check(DisplayCardSchema, normalized) ||
					keys.has(normalized.key)
				)
					return;
				keys.add(normalized.key);
				cards.push(normalized);
			}
			if (Buffer.byteLength(JSON.stringify(cards)) > displayLimits.bytes)
				return;
			providers.set(provider, cards);
		} catch {
			/* Malformed local contributions cannot invalidate native status. */
		}
	};
	const requestId = randomUUID();
	const request: DisplayRequest = Object.freeze({
		version: 1,
		sessionId,
		requestId,
		contribute,
	});
	if (events && sessionId && current()) {
		// Pi's public event bus isolates each listener's exception. No async wait.
		try {
			events.emit(displayRequestEvent, request);
		} catch {
			/* Native status remains available. */
		}
	}
	open = false;
	if (!current()) {
		providers.clear();
		seen.clear();
		return;
	}
	const cards: DisplayCard[] = subagents
		? [
				{
					provider: "subagents",
					key: "fleet",
					title: "Subagents",
					status: `${subagents.activeWork} active work items`,
					lines: [
						...subagents.labels.map(plain),
						"Other background status unknown",
					],
				},
			]
		: [];
	for (const contribution of providers.values()) {
		if (
			cards.length + contribution.length <= displayLimits.cards &&
			Buffer.byteLength(JSON.stringify([...cards, ...contribution])) <=
				displayLimits.bytes
		)
			cards.push(...contribution);
	}
	providers.clear();
	seen.clear();
	return cards.length ? cards : undefined;
}
