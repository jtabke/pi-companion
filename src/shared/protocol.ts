import { Type, type Static } from "@sinclair/typebox";
export const limits = {
	items: 300,
	text: 128_000,
	// One long block may use the existing total text budget; input limits stay separate.
	blockText: 128_000,
	blocks: 64,
	images: 24,
	imageBytes: 4_000_000,
	inputImages: 4,
	totalImageBytes: 16_000_000,
	pixels: 20_000_000,
	snapshotBytes: 900_000,
	peers: 32,
	cwdCharacters: 4096,
	// Covers worst-case JSON escaping of both bounded paths and fixed summary fields.
	statusBytes: 65_536,
	streams: 4,
	replay: 8,
	// Eight maximum replay frames plus one in-flight frame, including SSE framing.
	sseBufferedBytes: 8_110_000,
	sseDrainMs: 15_000,
} as const;
const opaque = "^[a-f0-9]{32}$";
const id = Type.String({ pattern: opaque });
const text = Type.String({ maxLength: limits.blockText });
const ToolSchema = Type.Object({
	name: Type.String({ maxLength: 100 }),
	summary: Type.String({ maxLength: 512 }),
	state: Type.Union([
		Type.Literal("running"),
		Type.Literal("completed"),
		Type.Literal("error"),
	]),
});
export type ToolObservation = Static<typeof ToolSchema>;
const BlockSchema = Type.Union([
	Type.Object({
		type: Type.Literal("text"),
		text,
		omittedChars: Type.Optional(Type.Integer({ minimum: 1 })),
	}),
	Type.Object({
		type: Type.Literal("thinking"),
		text,
		omittedChars: Type.Optional(Type.Integer({ minimum: 1 })),
	}),
	Type.Object({
		type: Type.Literal("diff"),
		text,
		omittedChars: Type.Optional(Type.Integer({ minimum: 1 })),
	}),
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
export const commandLimits = {
	count: 128,
	name: 128,
	description: 512,
	bytes: 65_536,
} as const;
const CommandSchema = Type.Object(
	{
		name: Type.String({
			minLength: 1,
			maxLength: commandLimits.name,
			pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]*$",
		}),
		description: Type.String({ maxLength: commandLimits.description }),
		source: Type.Union([
			Type.Literal("extension"),
			Type.Literal("prompt"),
			Type.Literal("skill"),
		]),
	},
	{ additionalProperties: false },
);
export type Command = Static<typeof CommandSchema>;
export const SnapshotSchema = Type.Object(
	{
		instance: id,
		generation: id,
		project: Type.String({ maxLength: 120 }),
		session: Type.String({ maxLength: 120 }),
		parent: Type.Union([Type.Literal("working"), Type.Literal("idle")]),
		background: Type.Literal("unobserved"),
		truncated: Type.Boolean(),
		model: Type.Optional(Type.String({ maxLength: 256 })),
		context: Type.Optional(
			Type.Object({
				tokens: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
				window: Type.Number({ exclusiveMinimum: 0 }),
			}),
		),
		commands: Type.Optional(
			Type.Array(CommandSchema, { maxItems: commandLimits.count }),
		),
		// Distinguishes an omitted history window from an individual unavailable block.
		omittedItems: Type.Optional(Type.Integer({ minimum: 0 })),
		items: Type.Array(
			Type.Object({
				id: Type.String({ maxLength: 200 }),
				role: Type.String({ maxLength: 40 }),
				tool: Type.Optional(ToolSchema),
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
const StopObservationSchema = Type.Union([
	Type.Literal("stopping"),
	Type.Literal("parent-settled"),
]);
// Read-only extension presentation; never an activity or command authority signal.
export const displayLimits = {
	cards: 8,
	providerCards: 4,
	bytes: 8192,
} as const;
const displayKey = Type.String({
	minLength: 1,
	maxLength: 48,
	pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$",
});
const displayText = (maxLength: number) =>
	Type.String({
		maxLength,
		pattern:
			"^[^\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]*$",
	});
export const DisplayCardSchema = Type.Object(
	{
		provider: displayKey,
		key: displayKey,
		title: displayText(80),
		status: displayText(160),
		lines: Type.Array(displayText(256), { maxItems: 8 }),
	},
	{ additionalProperties: false },
);
export type DisplayCard = Static<typeof DisplayCardSchema>;
export const SummarySchema = Type.Object(
	{
		instance: id,
		generation: id,
		project: Type.String({ maxLength: 120 }),
		cwd: Type.Optional(
			Type.String({ minLength: 1, maxLength: limits.cwdCharacters }),
		),
		session: Type.String({ maxLength: 120 }),
		parent: Type.Union([Type.Literal("working"), Type.Literal("idle")]),
		background: Type.Literal("unobserved"),
		// Positive work-item projection only; absence never proves completion.
		subagents: Type.Optional(
			Type.Object(
				{
					activeWork: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
					labels: Type.Array(
						Type.String({
							minLength: 1,
							maxLength: 64,
							pattern:
								"^[^\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]+$",
						}),
						{ maxItems: 4 },
					),
				},
				{ additionalProperties: false },
			),
		),
		display: Type.Optional(
			Type.Array(DisplayCardSchema, { maxItems: displayLimits.cards }),
		),
		pending: Type.Optional(Type.Boolean()),
		// Absent on still-loaded older bridges: explicit busy text must fail closed.
		busyText: Type.Optional(Type.Boolean()),
		// Absent older bridges cannot dispatch metadata mutations.
		rename: Type.Optional(Type.Boolean()),
		unnamed: Type.Optional(Type.Boolean()),
		stop: Type.Optional(StopObservationSchema),
		// Read-only native message recency and browser-answerable authored question presence.
		lastInteraction: Type.Optional(
			Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
		),
		needsInput: Type.Optional(Type.Boolean()),
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
	Type.Literal("image/png"),
	Type.Literal("image/jpeg"),
	Type.Literal("image/webp"),
]);
const imageSource = Type.String({ minLength: 4, maxLength: 5_333_336 });
export const BrowserImageSchema = Type.Object(
	{
		instance: id,
		generation: id,
		requestId: id,
		text: Type.String({ maxLength: 16_000 }),
		images: Type.Array(
			Type.Object(
				{ mime: imageMime, source: imageSource },
				{ additionalProperties: false },
			),
			{ minItems: 1, maxItems: limits.inputImages },
		),
		lease: Type.String({ pattern: "^[a-f0-9]{64}$" }),
	},
	{ additionalProperties: false },
);
export type BrowserImage = Static<typeof BrowserImageSchema>;
// Only the capability-authenticated gateway supplies sourceDigest, never the browser.
export const ImageRequestSchema = Type.Object(
	{
		instance: id,
		generation: id,
		requestId: id,
		text: Type.String({ maxLength: 16_000 }),
		images: Type.Array(
			Type.Object(
				{
					mime: imageMime,
					sourceDigest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
					image: imageSource,
				},
				{ additionalProperties: false },
			),
			{ minItems: 1, maxItems: limits.inputImages },
		),
	},
	{ additionalProperties: false },
);
export type ImageRequest = Static<typeof ImageRequestSchema>;
const leasePattern = "^[a-f0-9]{64}$";
export const TextRequestSchema = Type.Object(
	{
		instance: id,
		generation: id,
		requestId: id,
		text: Type.String({ minLength: 1, maxLength: 16_000 }),
		deliverAs: Type.Optional(
			Type.Union([Type.Literal("steer"), Type.Literal("followUp")]),
		),
	},
	{ additionalProperties: false },
);
export type TextRequest = Static<typeof TextRequestSchema>;
export const StopRequestSchema = Type.Object(
	{ instance: id, generation: id, requestId: id },
	{ additionalProperties: false },
);
export type StopRequest = Static<typeof StopRequestSchema>;
export const RenameRequestSchema = Type.Object(
	{
		...StopRequestSchema.properties,
		name: Type.String({ minLength: 1, maxLength: 120 }),
	},
	{ additionalProperties: false },
);
export type RenameRequest = Static<typeof RenameRequestSchema>;
export const BrowserRenameSchema = Type.Object(
	{
		...RenameRequestSchema.properties,
		lease: Type.String({ pattern: leasePattern }),
	},
	{ additionalProperties: false },
);
export type BrowserRename = Static<typeof BrowserRenameSchema>;
export const BrowserStopSchema = Type.Object(
	{
		...StopRequestSchema.properties,
		lease: Type.String({ pattern: leasePattern }),
	},
	{ additionalProperties: false },
);
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
			Type.Literal("slash-unsupported"),
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
export const questionLimits = {
	active: 4,
	requestBytes: 65_536,
	totalBytes: 262_144,
	stateBytes: 270_000,
	replyBytes: 65_536,
	bodyBytes: 70_000,
	text: 8_192,
} as const;
const invocation = Type.String({
	minLength: 1,
	maxLength: questionLimits.requestBytes,
});
export const QuestionRequestSchema = Type.Object({
	invocationId: invocation,
	questions: Type.Array(
		Type.Object({
			question: Type.String({ maxLength: 16_000 }),
			header: Type.String({ maxLength: 16 }),
			multiSelect: Type.Boolean(),
			options: Type.Array(
				Type.Object({
					label: Type.String({ maxLength: 60 }),
					description: Type.String({ maxLength: 16_000 }),
					preview: Type.Optional(Type.String({ maxLength: 16_000 })),
				}),
				{ minItems: 2, maxItems: 4 },
			),
		}),
		{ minItems: 1, maxItems: 4 },
	),
});
export type QuestionRequest = Static<typeof QuestionRequestSchema>;
export const QuestionsSchema = Type.Object(
	{
		...IdentitySchema.properties,
		terminalOnly: Type.Boolean(),
		pending: Type.Array(QuestionRequestSchema, { maxItems: 4 }),
	},
	{ additionalProperties: false },
);
export type Questions = Static<typeof QuestionsSchema>;
const note = Type.String({ maxLength: questionLimits.text });
const answerBase = {
	questionIndex: Type.Integer({ minimum: 0, maximum: 3 }),
	notes: Type.Optional(note),
};
const QuestionReplySchema = Type.Object(
	{
		invocationId: invocation,
		replyId: Type.String({ minLength: 1, maxLength: 128 }),
		cancelled: Type.Boolean(),
		answers: Type.Array(
			Type.Union([
				Type.Object(
					{
						...answerBase,
						kind: Type.Literal("option"),
						answer: Type.String({ maxLength: 60 }),
					},
					{ additionalProperties: false },
				),
				Type.Object(
					{
						...answerBase,
						kind: Type.Literal("custom"),
						answer: Type.Union([note, Type.Null()]),
					},
					{ additionalProperties: false },
				),
				Type.Object(
					{
						...answerBase,
						kind: Type.Literal("multi"),
						answer: Type.Null(),
						selected: Type.Array(Type.String({ maxLength: 60 }), {
							maxItems: 4,
							uniqueItems: true,
						}),
					},
					{ additionalProperties: false },
				),
			]),
			{ maxItems: 4 },
		),
		globalNote: Type.Optional(note),
	},
	{ additionalProperties: false },
);
export type QuestionReply = Static<typeof QuestionReplySchema>;
export const PrivateQuestionReplySchema = Type.Object(
	{ ...IdentitySchema.properties, reply: QuestionReplySchema },
	{ additionalProperties: false },
);
export type PrivateQuestionReply = Static<typeof PrivateQuestionReplySchema>;
export const BrowserQuestionReplySchema = Type.Object(
	{
		...PrivateQuestionReplySchema.properties,
		lease: Type.String({ pattern: leasePattern }),
	},
	{ additionalProperties: false },
);
export type BrowserQuestionReply = Static<typeof BrowserQuestionReplySchema>;
export const QuestionReceiptSchema = Type.Object(
	{
		invocationId: invocation,
		replyId: Type.String({ minLength: 1, maxLength: 128 }),
		status: Type.Union([
			Type.Literal("accepted"),
			Type.Literal("invalid"),
			Type.Literal("uncertain"),
			Type.Literal("not-pending"),
		]),
	},
	{ additionalProperties: false },
);
export type QuestionReceipt = Static<typeof QuestionReceiptSchema>;
