import { createHmac } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
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
	return {
		instance,
		generation,
		project: basename(ctx.cwd).slice(0, 120),
		session: (ctx.sessionManager.getSessionName() ?? "Unnamed session").slice(
			0,
			120,
		),
		parent: ctx.isIdle() ? "idle" : "working",
		background: "unobserved",
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
) {
	const snapshot: Snapshot = {
		...nativeSummary(ctx, instance, generation),
		truncated: false,
		items: [],
	};
	const media = new Map<string, ReturnType<typeof inspectImage>>();
	const entries = ctx.sessionManager.getBranch();
	let textRemaining: number = limits.text,
		imageBytes = 0;
	const selected = entries.slice(-limits.items);
	if (selected.length !== entries.length) snapshot.truncated = true;
	for (const entry of selected) {
		const message =
			entry.type === "message"
				? entry.message
				: entry.type === "custom_message" && entry.display
					? { role: "custom" as const, content: entry.content, display: true }
					: entry.type === "compaction" || entry.type === "branch_summary"
						? { role: entry.type, content: entry.summary }
						: undefined;
		if (!message || (message.role === "custom" && !message.display)) continue;
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
		for (
			let index = 0;
			index < Math.min(content.length, limits.blocks);
			index++
		) {
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
				const text = raw.slice(0, Math.min(textRemaining, limits.blockText));
				textRemaining -= text.length;
				blocks.push({ type: block.type, text });
				if (text.length < raw.length) {
					snapshot.truncated = true;
					if (blocks.length < limits.blocks - 1)
						blocks.push({
							type: "unavailable",
							text: "Text truncated by observer budget",
						});
				}
			} else if (block.type === "toolCall")
				blocks.push({
					type: "tool",
					text: `Tool call: ${block.name.slice(0, 100)}`,
				});
			if (blocks.length >= limits.blocks - 1) {
				snapshot.truncated = true;
				break;
			}
		}
		if (content.length > limits.blocks) snapshot.truncated = true;
		snapshot.items.push({
			id: `${generation}:${entry.id}`.slice(0, 200),
			role:
				message.role === "toolResult"
					? `tool: ${message.toolName.slice(0, 30)}`
					: message.role,
			blocks,
		});
	}
	// JSON escaping and many small blocks can exceed a character-only budget.
	while (
		Buffer.byteLength(JSON.stringify(snapshot)) > limits.snapshotBytes &&
		snapshot.items.length
	) {
		snapshot.truncated = true;
		const removed = snapshot.items.shift()!;
		for (const block of removed.blocks)
			if (block.type === "image") media.delete(block.ref);
	}
	return { snapshot, media };
}
