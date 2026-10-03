import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { nativeSnapshot } from "../src/extension/snapshot.js";
import {
	limits,
	SnapshotSchema,
	type Snapshot,
} from "../src/shared/protocol.js";
import { context, png } from "./fixture.js";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createBridge } from "../src/extension/bridge.js";
import { readSnapshot } from "../src/gateway/peer.js";

type Content =
	{ type: "text"; text: string } | { type: "thinking"; thinking: string };
type Message = { role?: string; content: Content[] };
function project(messages: Message[]) {
	const ctx = context();
	ctx.sessionManager.getBranch = () =>
		messages.map((message, index) => ({
			type: "message",
			id: `message-${index}`,
			message: {
				role: message.role ?? "toolResult",
				toolName: "codemode",
				content: message.content,
			},
		})) as unknown as ReturnType<typeof ctx.sessionManager.getBranch>;
	return nativeSnapshot(ctx, "a".repeat(32), "b".repeat(32), "c".repeat(64));
}
function bounded(snapshot: Snapshot) {
	expect(Value.Check(SnapshotSchema, snapshot)).toBe(true);
	expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(
		limits.snapshotBytes,
	);
	expect(
		snapshot.items
			.flatMap((item) => item.blocks)
			.reduce(
				(sum, block) =>
					sum +
					(block.type === "text" || block.type === "thinking"
						? block.text.length
						: 0),
				0,
			),
	).toBeLessThanOrEqual(limits.text);
}

describe("recent-first bounded native snapshots", () => {
	for (const length of [20_000, 100_000])
		it(`preserves a ${length}-character answer without a per-block warning`, () => {
			const { snapshot } = project([
				{
					role: "assistant",
					content: [{ type: "text", text: "x".repeat(length) }],
				},
			]);
			expect(snapshot.items[0].blocks).toEqual([
				{ type: "text", text: "x".repeat(length) },
			]);
			expect(snapshot.truncated).toBe(false);
			expect(snapshot.omittedItems).toBe(0);
			bounded(snapshot);
		});
	it("keeps current user/assistant text, drops older history once, and never emits empty old text placeholders", () => {
		const messages: Message[] = Array.from({ length: 20 }, () => ({
			content: [{ type: "text", text: "x".repeat(limits.text) }],
		}));
		messages.push({
			role: "user",
			content: [{ type: "text", text: "Current question" }],
		});
		messages.push({
			role: "assistant",
			content: [{ type: "text", text: "Current answer" }],
		});
		const { snapshot } = project(messages);
		expect(snapshot.items.map((item) => item.id)).toEqual(
			["message-19", "message-20", "message-21"].map(
				(id) => `${"b".repeat(32)}:${id}`,
			),
		);
		expect(snapshot.items[1].blocks).toEqual([
			{ type: "text", text: "Current question" },
		]);
		expect(snapshot.items[2].blocks).toEqual([
			{ type: "text", text: "Current answer" },
		]);
		expect(snapshot.omittedItems).toBe(19);
		expect(snapshot.items[0].blocks[0]).toMatchObject({
			type: "text",
			omittedChars: expect.any(Number),
		});
		expect(
			snapshot.items
				.flatMap((item) => item.blocks)
				.some((block) => block.type === "text" && !block.text),
		).toBe(false);
		bounded(snapshot);
	});
	it("reserves answer text before collapsed reasoning in the same message", () => {
		const { snapshot } = project([
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "r".repeat(100_000) },
					{ type: "text", text: "a".repeat(40_000) },
				],
			},
		]);
		expect(snapshot.items[0].blocks).toEqual([
			{ type: "thinking", text: "r".repeat(88_000), omittedChars: 12_000 },
			{ type: "text", text: "a".repeat(40_000) },
		]);
		expect(snapshot.omittedItems).toBe(0);
		bounded(snapshot);
	});
	it("attaches exact shortening metadata instead of a repeated unavailable block", () => {
		const { snapshot } = project([
			{ content: [{ type: "text", text: "x".repeat(limits.text + 17) }] },
		]);
		expect(snapshot.items[0].blocks).toEqual([
			{ type: "text", text: "x".repeat(limits.text), omittedChars: 17 },
		]);
		expect(snapshot.truncated).toBe(true);
		expect(snapshot.omittedItems).toBe(0);
		bounded(snapshot);
	});
	it("keeps exactly 64 blocks without false truncation and marks larger messages once", () => {
		for (const count of [64, 65]) {
			const { snapshot } = project([
				{
					content: Array.from({ length: count }, () => ({
						type: "text",
						text: "small block",
					})),
				},
			]);
			expect(snapshot.items[0].blocks).toHaveLength(64);
			expect(snapshot.truncated).toBe(count === 65);
			expect(
				snapshot.items[0].blocks.filter(
					(block) => block.type === "unavailable",
				),
			).toHaveLength(count === 65 ? 1 : 0);
			bounded(snapshot);
		}
	});
	it("does not count non-display branch events against the message window", () => {
		const ctx = context();
		const message = ctx.sessionManager.getBranch()[0];
		ctx.sessionManager.getBranch = () =>
			[
				message,
				...Array.from({ length: limits.items + 1 }, (_, index) => ({
					type: "model_change",
					id: `event-${index}`,
				})),
			] as ReturnType<typeof ctx.sessionManager.getBranch>;
		const { snapshot } = nativeSnapshot(
			ctx,
			"a".repeat(32),
			"b".repeat(32),
			"c".repeat(64),
		);
		expect(snapshot.items).toHaveLength(1);
		expect(snapshot.truncated).toBe(false);
		expect(snapshot.omittedItems).toBe(0);
		bounded(snapshot);
	});
	it("reserves the image budget for recent messages and retains only published media references", () => {
		const ctx = context();
		const original = ctx.sessionManager.getBranch()[0];
		ctx.sessionManager.getBranch = () =>
			Array.from({ length: limits.images + 1 }, (_, index) => ({
				...original,
				id: `image-${index}`,
			}));
		const { snapshot, media } = nativeSnapshot(
			ctx,
			"a".repeat(32),
			"b".repeat(32),
			"c".repeat(64),
		);
		expect(media.size).toBe(limits.images);
		expect(
			snapshot.items[0].blocks.some((block) => block.type === "image"),
		).toBe(false);
		for (const item of snapshot.items.slice(1)) {
			const image = item.blocks.find((block) => block.type === "image");
			expect(image?.type === "image" && media.has(image.ref)).toBe(true);
		}
		expect(snapshot.omittedItems).toBe(0);
		bounded(snapshot);
	});
	it("delivers long text and exact preview metadata through authenticated bridge IPC and gateway validation", async () => {
		const path = mkdtempSync("/tmp/c2-budget-");
		chmodSync(path, 0o700);
		const bridge = createBridge(path);
		try {
			for (const length of [100_000, limits.text + 7]) {
				const registration = await bridge.start(
					context(png, "x".repeat(length)),
				);
				const snapshot = await readSnapshot(path, registration);
				expect(snapshot.items[0].blocks[0]).toEqual({
					type: "text",
					text: "x".repeat(Math.min(length, limits.text)),
					...(length > limits.text ? { omittedChars: 7 } : {}),
				});
				bounded(snapshot);
			}
		} finally {
			await bridge.close();
			rmSync(path, { recursive: true, force: true });
		}
	});
	it("I3 attaches byte-bounded command metadata before JSON trimming and preserves the existing history policy", () => {
		const ctx = context();
		ctx.sessionManager.getBranch = () =>
			Array.from({ length: 300 }, (_, n) => ({
				type: "message",
				id: "x".repeat(180) + n,
				message: {
					role: "assistant",
					content: Array.from({ length: 64 }, () => ({
						type: "text",
						text: "\u0000".repeat(7),
					})),
				},
			})) as unknown as ReturnType<typeof ctx.sessionManager.getBranch>;
		const getCommands: NonNullable<Parameters<typeof createBridge>[5]> = () =>
			Array.from({ length: 128 }, (_, n) => ({
				name: `bounded-${n}`,
				description: "🙂".repeat(256),
				source: "prompt",
				sourceInfo: {
					path: "/private/secret",
					source: "local",
					scope: "user",
					origin: "top-level",
				},
			}));
		const { snapshot } = nativeSnapshot(
			ctx,
			"a".repeat(32),
			"b".repeat(32),
			"c".repeat(64),
			getCommands,
		);
		expect(snapshot.commands?.length).toBeGreaterThan(0);
		expect(snapshot.commands?.length).toBeLessThan(128);
		expect(
			Buffer.byteLength(JSON.stringify(snapshot.commands)),
		).toBeLessThanOrEqual(65_536);
		expect(snapshot.commands?.[0]).toEqual({
			name: "bounded-0",
			description: "🙂".repeat(256),
			source: "prompt",
		});
		expect(snapshot.commands?.at(-1)?.name).toBe(
			`bounded-${snapshot.commands!.length - 1}`,
		);
		expect(JSON.stringify(snapshot)).not.toMatch(/sourceInfo|private|secret/);
		expect(snapshot.truncated).toBe(true);
		expect(snapshot.omittedItems).toBeGreaterThan(0);
		expect(snapshot.items.at(-1)?.id).toBe(
			`${"b".repeat(32)}:${"x".repeat(180)}299`.slice(0, 200),
		);
		bounded(snapshot);
	});
	it("bounds escaped Unicode and keeps image-specific errors separate from omitted history", () => {
		const ctx = context(
			Buffer.from("invalid image"),
			"\u0000".repeat(limits.text),
		);
		const { snapshot } = nativeSnapshot(
			ctx,
			"a".repeat(32),
			"b".repeat(32),
			"c".repeat(64),
		);
		expect(snapshot.truncated).toBe(true);
		expect(snapshot.omittedItems).toBe(0);
		expect(snapshot.items[0].blocks).toContainEqual({
			type: "unavailable",
			text: "Image unavailable: unsupported, invalid or exceeds observer budget",
		});
		bounded(snapshot);
	});
});
