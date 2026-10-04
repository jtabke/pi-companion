import {
	CustomEditor,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
type EditorFactory = NonNullable<
	Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]
>;
import {
	commandLimits,
	type Command,
	type CommandModel,
} from "../shared/protocol.js";

// This is browser admission, not a second implementation of Pi's commands.
export const browserNativeCommands: Command[] = [
	{
		name: "new",
		description: "Start a fresh conversation in this terminal",
		source: "builtin",
	},
	{
		name: "reload",
		description: "Reload Pi resources without replacing the terminal",
		source: "builtin",
	},
	{
		name: "model",
		description: "Choose a model in the browser",
		source: "builtin",
	},
];

export type NativeCommands = ReturnType<typeof installNativeCommands>;
export function installNativeCommands(ctx: ExtensionContext) {
	let active = true,
		pending = false;
	let editor: ReturnType<EditorFactory> | undefined;
	// Older Pi bridges must fail closed; never replace an editor we cannot preserve.
	if (
		!ctx.ui ||
		typeof ctx.ui.getEditorComponent !== "function" ||
		typeof ctx.ui.setEditorComponent !== "function"
	)
		return;
	let factory: EditorFactory | undefined;
	function activate() {
		if (!active || factory) return;
		const previous = ctx.ui.getEditorComponent();
		factory = (tui, theme, keys) => {
			editor = previous
				? previous(tui, theme, keys)
				: new CustomEditor(tui, theme, keys);
			return editor;
		};
		ctx.ui.setEditorComponent(factory);
	}
	const available = () =>
		active &&
		ctx.ui.getEditorComponent() === factory &&
		typeof editor?.onSubmit === "function";
	function models(): CommandModel[] {
		if (!available()) return [];
		const source = ctx.scopedModels?.length
			? ctx.scopedModels.map(({ model }) => model)
			: ctx.modelRegistry.getAvailable();
		const result: CommandModel[] = [];
		let bytes = 2;
		for (const model of source) {
			const reference = `${model.provider}/${model.id}`;
			if (
				reference.length > 256 ||
				!/^[^\s\p{C}]+$/u.test(reference) ||
				result.some((m) => m.reference === reference)
			)
				continue;
			const entry = {
				reference,
				name: model.name.slice(0, 120).replace(/[\u0000-\u001f\u007f]/g, " "),
			};
			bytes += Buffer.byteLength(JSON.stringify(entry)) + 1;
			if (result.length >= commandLimits.count || bytes > commandLimits.bytes)
				break;
			result.push(entry);
		}
		return result;
	}
	function accepts(text: string) {
		return (
			text === "/new" ||
			text === "/reload" ||
			(text.startsWith("/model ") &&
				models().some((m) => text === `/model ${m.reference}`))
		);
	}
	return {
		activate,
		available,
		models,
		accepts,
		blocked: () =>
			pending
				? ("busy" as const)
				: ctx.ui.getEditorText().length > 0
					? ("terminal-draft" as const)
					: undefined,
		submit(text: string) {
			if (
				!available() ||
				!accepts(text) ||
				pending ||
				ctx.ui.getEditorText().length
			)
				throw Error("Native command unavailable");
			pending = true;
			const submit = editor!.onSubmit!;
			// Let the IPC receipt flush before /new or /reload tears down its listener.
			// The request ledger is already populated; no reconnect can repeat this attempt.
			setImmediate(() => {
				if (
					!available() ||
					!ctx.isIdle() ||
					ctx.hasPendingMessages() ||
					ctx.ui.getEditorText().length ||
					!accepts(text)
				) {
					pending = false;
					return;
				}
				try {
					Promise.resolve(submit.call(editor, text))
						.catch(() => {})
						.finally(() => {
							pending = false;
						});
				} catch {
					pending = false;
				}
			});
		},
		close: () => {
			active = false;
		},
	};
}
