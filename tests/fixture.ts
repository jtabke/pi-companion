import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
export const png = Buffer.from(
	"89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc0000003010100c9fe92ef0000000049454e44ae426082",
	"hex",
);
export function context(
	image = png,
	text = "C2 controlled fixture\n\n![external](https://example.invalid/secret.png)\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
) {
	const entries = [
		{
			type: "message",
			id: "native-tool-entry",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: {
				role: "toolResult",
				toolName: "read",
				toolCallId: "native-read",
				isError: false,
				content: [
					{ type: "text", text },
					{
						type: "image",
						data: image.toString("base64"),
						mimeType: "image/png",
					},
				],
				timestamp: Date.now(),
			},
		},
	];
	return {
		cwd: "/controlled/project",
		model: { input: ["text", "image"] },
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: {
			getSessionId: () => "controlled-fixture-session",
			getBranch: () => entries,
			getSessionFile: () => undefined,
			getSessionName: () => "Controlled fixture",
		},
	} as unknown as ExtensionContext;
}

// Public event-bus semantics: handler bodies run synchronously; returned promises are not awaited.
export function questionBus() {
	const handlers = new Map<string, Set<(data: unknown) => void>>();
	return {
		handlers,
		emit(channel: string, data: unknown) {
			for (const handler of [...(handlers.get(channel) ?? [])]) handler(data);
		},
		on(channel: string, handler: (data: unknown) => void) {
			let set = handlers.get(channel);
			if (!set) handlers.set(channel, (set = new Set()));
			set.add(handler);
			return () => {
				set!.delete(handler);
			};
		},
	};
}
export function questionRequest(invocationId = "controlled-live-invocation") {
	return {
		invocationId,
		questions: [
			{
				question: "Which surface?",
				header: "Surface",
				multiSelect: false,
				options: [
					{
						label: "Terminal",
						description: "Terminal description",
						preview: "Terminal preview",
					},
					{
						label: "Browser",
						description: "Browser description",
						preview: "Browser preview",
					},
				],
			},
		],
	};
}
