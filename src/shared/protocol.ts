import { Type, type Static } from "@sinclair/typebox";
export const limits = {
	items: 300,
	text: 128_000,
	blockText: 16_000,
	blocks: 64,
	images: 24,
	imageBytes: 4_000_000,
	totalImageBytes: 16_000_000,
	pixels: 20_000_000,
	snapshotBytes: 900_000,
	peers: 32,
	streams: 4,
	replay: 8,
	// Eight maximum replay frames plus one in-flight frame, including SSE framing.
	sseBufferedBytes: 8_110_000,
	sseDrainMs: 15_000,
} as const;
export const opaque = "^[a-f0-9]{32}$";
const id = Type.String({ pattern: opaque });
const text = Type.String({ maxLength: limits.blockText });
export const BlockSchema = Type.Union([
	Type.Object({ type: Type.Literal("text"), text }),
	Type.Object({ type: Type.Literal("thinking"), text }),
	Type.Object({ type: Type.Literal("tool"), text }),
	Type.Object({ type: Type.Literal("unavailable"), text }),
	Type.Object({
		type: Type.Literal("image"),
		ref: id,
		mime: Type.Union([
			Type.Literal("image/png"),
			Type.Literal("image/jpeg"),
			Type.Literal("image/webp"),
		]),
		width: Type.Integer({ minimum: 1, maximum: limits.pixels }),
		height: Type.Integer({ minimum: 1, maximum: limits.pixels }),
	}),
]);
export const SnapshotSchema = Type.Object(
	{
		instance: id,
		generation: id,
		project: Type.String({ maxLength: 120 }),
		session: Type.String({ maxLength: 120 }),
		parent: Type.Union([Type.Literal("working"), Type.Literal("idle")]),
		background: Type.Literal("unobserved"),
		truncated: Type.Boolean(),
		items: Type.Array(
			Type.Object({
				id: Type.String({ maxLength: 200 }),
				role: Type.String({ maxLength: 40 }),
				blocks: Type.Array(BlockSchema, { maxItems: limits.blocks }),
			}),
			{ maxItems: limits.items },
		),
	},
	{ additionalProperties: false },
);
export type Snapshot = Static<typeof SnapshotSchema>;
export type Block = Static<typeof BlockSchema>;
export const RegistrationSchema = Type.Object(
	{
		version: Type.Literal(1),
		instance: id,
		generation: id,
		capability: Type.String({ pattern: "^[a-f0-9]{64}$" }),
	},
	{ additionalProperties: false },
);
export type Registration = Static<typeof RegistrationSchema>;
export const IdentitySchema = Type.Object(
	{ instance: id, generation: id },
	{ additionalProperties: false },
);
export type Identity = Static<typeof IdentitySchema>;
// Observation only: no request/run correlation or all-work cancellation claim.
export const StopObservationSchema = Type.Union([Type.Literal("stopping"), Type.Literal("parent-settled")]);
export const SummarySchema = Type.Object(
	{
		instance: id,
		generation: id,
		project: Type.String({ maxLength: 120 }),
		session: Type.String({ maxLength: 120 }),
		parent: Type.Union([Type.Literal("working"), Type.Literal("idle")]),
		background: Type.Literal("unobserved"),
		pending: Type.Optional(Type.Boolean()),
		stop: Type.Optional(StopObservationSchema),
	},
	{ additionalProperties: false },
);
export type Summary = Static<typeof SummarySchema>;
// Private IPC only. Canonical native identity must never enter browser data or logs.
export const StatusSchema = Type.Object(
	{
		summary: SummarySchema,
		canonicalSession: Type.Union([
			Type.String({ maxLength: 4096 }),
			Type.Null(),
		]),
	},
	{ additionalProperties: false },
);
export type Status = Static<typeof StatusSchema>;
export type View = {
	connection: "connected" | "disconnected" | "unavailable";
	sessions: (Summary & { conflict: boolean })[];
	selected?: Identity;
	conflict?: boolean;
	controller?: ControllerStatus;
	snapshot?: Snapshot;
	questions?: Questions;
};

// Fixed authored input/control envelopes, never generic command routing.
export const imageBodyBytes = 5_500_000;
const imageMime = Type.Union([
	Type.Literal("image/png"), Type.Literal("image/jpeg"), Type.Literal("image/webp"),
]);
const imageSource = Type.String({ minLength: 4, maxLength: 5_333_336 });
export const BrowserImageSchema = Type.Object({
	instance: id, generation: id, requestId: id,
	text: Type.String({ maxLength: 16_000 }),
	mime: imageMime, source: imageSource,
	lease: Type.String({ pattern: "^[a-f0-9]{64}$" }),
}, { additionalProperties: false });
export type BrowserImage = Static<typeof BrowserImageSchema>;
// Only the capability-authenticated gateway supplies sourceDigest, never the browser.
export const ImageRequestSchema = Type.Object({
	instance: id, generation: id, requestId: id,
	text: Type.String({ maxLength: 16_000 }),
	mime: imageMime, sourceDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
	image: imageSource,
}, { additionalProperties: false });
export type ImageRequest = Static<typeof ImageRequestSchema>;
export const leasePattern = "^[a-f0-9]{64}$";
export const TextRequestSchema = Type.Object(
	{
		instance: id,
		generation: id,
		requestId: id,
		text: Type.String({ minLength: 1, maxLength: 16_000 }),
	},
	{ additionalProperties: false },
);
export type TextRequest = Static<typeof TextRequestSchema>;
export const StopRequestSchema = Type.Object({ instance: id, generation: id, requestId: id }, { additionalProperties: false });
export type StopRequest = Static<typeof StopRequestSchema>;
export const BrowserStopSchema = Type.Object({
	...StopRequestSchema.properties, lease: Type.String({ pattern: leasePattern }),
}, { additionalProperties: false });
export type BrowserStop = Static<typeof BrowserStopSchema>;
export const BrowserTextSchema = Type.Object(
	{
		...TextRequestSchema.properties,
		lease: Type.String({ pattern: leasePattern }),
	},
	{ additionalProperties: false },
);
export type BrowserText = Static<typeof BrowserTextSchema>;
export const ControlSchema = Type.Union([
	Type.Object(
		{
			instance: id,
			generation: id,
			action: Type.Union([Type.Literal("claim"), Type.Literal("takeover")]),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			instance: id,
			generation: id,
			action: Type.Union([Type.Literal("renew"), Type.Literal("release")]),
			lease: Type.String({ pattern: leasePattern }),
		},
		{ additionalProperties: false },
	),
]);
export type ControlRequest = Static<typeof ControlSchema>;
export const ReceiptSchema = Type.Object(
	{
		requestId: id,
		status: Type.Union([
			Type.Literal("dispatched"),
			Type.Literal("uncertain"),
			Type.Literal("rejected"),
		]),
		reason: Type.Union([
			Type.Literal("outcome-unconfirmed"),
			Type.Literal("busy"),
			Type.Literal("idle"),
			Type.Literal("stopping"),
			Type.Literal("stale"),
			Type.Literal("mismatch"),
			Type.Literal("ledger-full"),
			Type.Literal("invalid"),
			Type.Literal("unavailable"),
			Type.Literal("model-no-images"),
			Type.Literal("images-blocked"),
			Type.Literal("image-policy-unknown"),
		]),
	},
	{ additionalProperties: false },
);
export type Receipt = Static<typeof ReceiptSchema>;
export type ControllerStatus = {
	held: boolean;
	expires: number;
	revision?: string;
};

// Package-specific v1 projection; full content travels only in a selected owner's view.
export const questionLimits = { active: 4, requestBytes: 65_536, totalBytes: 262_144, stateBytes: 270_000, replyBytes: 65_536, bodyBytes: 70_000, text: 8_192 } as const;
const invocation = Type.String({ minLength: 1, maxLength: questionLimits.requestBytes });
export const QuestionRequestSchema = Type.Object({
 invocationId: invocation,
 questions: Type.Array(Type.Object({
  question: Type.String({ maxLength: 16_000 }), header: Type.String({ maxLength: 16 }), multiSelect: Type.Boolean(),
  options: Type.Array(Type.Object({ label: Type.String({ maxLength: 60 }), description: Type.String({ maxLength: 16_000 }), preview: Type.Optional(Type.String({ maxLength: 16_000 })) }), { minItems: 2, maxItems: 4 }),
 }), { minItems: 1, maxItems: 4 }),
});
export type QuestionRequest = Static<typeof QuestionRequestSchema>;
export const QuestionsSchema = Type.Object({ ...IdentitySchema.properties, terminalOnly: Type.Boolean(), pending: Type.Array(QuestionRequestSchema, { maxItems: 4 }) }, { additionalProperties: false });
export type Questions = Static<typeof QuestionsSchema>;
const note = Type.String({ maxLength: questionLimits.text });
const answerBase = { questionIndex: Type.Integer({ minimum: 0, maximum: 3 }), notes: Type.Optional(note) };
export const QuestionReplySchema = Type.Object({
 invocationId: invocation, replyId: Type.String({ minLength: 1, maxLength: 128 }), cancelled: Type.Boolean(),
 answers: Type.Array(Type.Union([
  Type.Object({ ...answerBase, kind: Type.Literal('option'), answer: Type.String({ maxLength: 60 }) }, { additionalProperties: false }),
  Type.Object({ ...answerBase, kind: Type.Literal('custom'), answer: Type.Union([note, Type.Null()]) }, { additionalProperties: false }),
  Type.Object({ ...answerBase, kind: Type.Literal('multi'), answer: Type.Null(), selected: Type.Array(Type.String({ maxLength: 60 }), { maxItems: 4, uniqueItems: true }) }, { additionalProperties: false }),
 ]), { maxItems: 4 }), globalNote: Type.Optional(note),
}, { additionalProperties: false });
export type QuestionReply = Static<typeof QuestionReplySchema>;
export const PrivateQuestionReplySchema = Type.Object({ ...IdentitySchema.properties, reply: QuestionReplySchema }, { additionalProperties: false });
export type PrivateQuestionReply = Static<typeof PrivateQuestionReplySchema>;
export const BrowserQuestionReplySchema = Type.Object({ ...PrivateQuestionReplySchema.properties, lease: Type.String({ pattern: leasePattern }) }, { additionalProperties: false });
export type BrowserQuestionReply = Static<typeof BrowserQuestionReplySchema>;
export const QuestionReceiptSchema = Type.Object({ invocationId: invocation, replyId: Type.String({ minLength: 1, maxLength: 128 }), status: Type.Union([Type.Literal('accepted'), Type.Literal('invalid'), Type.Literal('uncertain'), Type.Literal('not-pending')]) }, { additionalProperties: false });
export type QuestionReceipt = Static<typeof QuestionReceiptSchema>;
