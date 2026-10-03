import { createHmac } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { nativeCommands } from "./commands.js";
import {
	limits,
	type Snapshot,
	type Block,
	type Summary,
	type Status,
} from "../shared/protocol.js";
import { inspectImage, type NativeImage } from "./media.js";
export function nativeSummary(
	ctx: ExtensionContext,
	instance: string,
	generation: string,
): Summary {
	// Native conversation messages only: observation clocks and branch metadata are not interactions.
	let lastInteraction: number | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || typeof entry.timestamp !== "string")
			continue;
		const timestamp = Date.parse(entry.timestamp);
		if (
			Number.isSafeInteger(timestamp) &&
			timestamp >= 0 &&
			(lastInteraction === undefined || timestamp > lastInteraction)
		)
			lastInteraction = timestamp;
	}
	const nativeName = ctx.sessionManager.getSessionName();
	return {
		instance,
		generation,
		project: basename(ctx.cwd).slice(0, 120),
		// Do not truncate a directory identity or merge distinct paths under one label.
		...(ctx.cwd.length > 0 && ctx.cwd.length <= limits.cwdCharacters
			? { cwd: ctx.cwd }
			: {}),
		session: (nativeName ?? "Unnamed session").slice(0, 120),
		unnamed: nativeName === undefined,
		parent: ctx.isIdle() ? "idle" : "working",
		background: "unobserved",
		...(lastInteraction !== undefined ? { lastInteraction } : {}),
	};
}
export function nativeStatus(
	ctx: ExtensionContext,
	instance: string,
	generation: string,
): Status {
	const file = ctx.sessionManager.getSessionFile();
	let canonicalSession: string | null = null;
	if (file) {
		try {
			canonicalSession = realpathSync(file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			// Pi can advertise its native file before the first write. Resolve its existing parent.
			canonicalSession = join(realpathSync(dirname(file)), basename(file));
		}
		if (canonicalSession.length > 4096)
			throw new Error("Native identity exceeds limit");
	}
	return {
		summary: nativeSummary(ctx, instance, generation),
		canonicalSession,
	};
}
export function nativeSnapshot(
	ctx: ExtensionContext,
	instance: string,
	generation: string,
	capability: string,
	getCommands?: ExtensionAPI["getCommands"],
) {
	const { project, session, parent, background } = nativeSummary(
		ctx,
		instance,
		generation,
	);
	// Snapshot has a separate strict schema; summary-only observations must not enter it.
	const snapshot: Snapshot = {
		instance,
		generation,
		project,
		session,
		parent,
		background,
		truncated: false,
		omittedItems: 0,
		items: [],
	};
	const commands = nativeCommands(getCommands);
	if (commands) snapshot.commands = commands;
	const media = new Map<string, ReturnType<typeof inspectImage>>();
	const entries = ctx.sessionManager.getBranch();
	const selected = [];
	let messageCount = 0;
	for (let position = entries.length - 1; position >= 0; position--) {
		const entry = entries[position];
		const message =
			entry.type === "message"
				? entry.message
				: entry.type === "custom_message" && entry.display
					? { role: "custom" as const, content: entry.content, display: true }
					: entry.type === "compaction" || entry.type === "branch_summary"
						? { role: entry.type, content: entry.summary }
						: undefined;
		if (!message || (message.role === "custom" && !message.display)) continue;
		messageCount++;
		// Count earlier display entries without allocating another full-history projection.
		if (selected.length < limits.items) selected.push({ entry, message });
	}
	selected.reverse();
	let textRemaining: number = limits.text,
		imageBytes = 0;
	snapshot.omittedItems = messageCount - selected.length;
	if (snapshot.omittedItems) snapshot.truncated = true;
	// Allocate to the newest messages first, then restore chronological display order.
	for (let position = selected.length - 1; position >= 0; position--) {
		if (!textRemaining) {
			snapshot.omittedItems += position + 1;
			snapshot.truncated = true;
			break;
		}
		const { entry, message } = selected[position];
		// Native branch messages are finalized; live partial assistant messages are not read here.
		const blocks: Block[] = [];
		const rawContent =
			"content" in message
				? message.content
				: "summary" in message
					? message.summary
					: `Terminal command: ${message.command}\n${message.output}`;
		const content =
			typeof rawContent === "string"
				? [{ type: "text" as const, text: rawContent }]
				: rawContent;
		const contentLimit =
			content.length > limits.blocks ? limits.blocks - 1 : content.length;
		let contentOmitted = content.length > contentLimit;
		// Collapsed reasoning must not consume the space needed by this message's answer.
		let reservedText = Math.min(
			textRemaining,
			content
				.slice(0, contentLimit)
				.reduce(
					(total, block) =>
						total + (block.type === "text" ? block.text.length : 0),
					0,
				),
		);
		for (let index = 0; index < contentLimit; index++) {
			const block = content[index];
			if (block.type === "image") {
				const image =
					media.size < limits.images && imageBytes < limits.totalImageBytes
						? inspectImage(block as NativeImage)
						: undefined;
				if (
					!image ||
					media.size >= limits.images ||
					imageBytes + image.bytes.length > limits.totalImageBytes
				) {
					blocks.push({
						type: "unavailable",
						text: "Image unavailable: unsupported, invalid or exceeds observer budget",
					});
					snapshot.truncated = true;
				} else {
					const ref = createHmac("sha256", capability)
						.update(`${generation}:${entry.id}:${index}`)
						.digest("hex")
						.slice(0, 32);
					media.set(ref, image);
					imageBytes += image.bytes.length;
					blocks.push({
						type: "image",
						ref,
						mime: image.mime,
						width: image.width,
						height: image.height,
					});
				}
			} else if (block.type === "text" || block.type === "thinking") {
				const raw = block.type === "text" ? block.text : block.thinking;
				const available =
					block.type === "thinking"
						? textRemaining - reservedText
						: textRemaining;
				const text = raw.slice(0, Math.min(available, limits.blockText));
				textRemaining -= text.length;
				if (block.type === "text") reservedText -= text.length;
				const omittedChars = raw.length - text.length;
				if (omittedChars) snapshot.truncated = true;
				if (!text.length && raw.length && block.type === "text")
					contentOmitted = true;
				else
					blocks.push({
						type: block.type,
						text,
						...(omittedChars ? { omittedChars } : {}),
					});
			} else if (block.type === "toolCall")
				blocks.push({
					type: "tool",
					text: `Tool call: ${block.name.slice(0, 100)}`,
				});
		}
		if (contentOmitted) {
			snapshot.truncated = true;
			blocks.push({
				type: "unavailable",
				text: "Additional content omitted from this message.",
			});
		}
		snapshot.items.push({
			id: `${generation}:${entry.id}`.slice(0, 200),
			role:
				message.role === "toolResult"
					? `tool: ${message.toolName.slice(0, 30)}`
					: message.role,
			blocks,
		});
	}
	snapshot.items.reverse();
	// JSON escaping and many small blocks can exceed a character-only budget.
	while (
		Buffer.byteLength(JSON.stringify(snapshot)) > limits.snapshotBytes &&
		snapshot.items.length
	) {
		snapshot.truncated = true;
		const removed = snapshot.items.shift()!;
		snapshot.omittedItems++;
		for (const block of removed.blocks)
			if (block.type === "image") media.delete(block.ref);
	}
	return { snapshot, media };
}
