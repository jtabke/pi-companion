import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { installNativeCommands } from "../src/extension/native-commands.js";
import { nativeInput } from "../src/extension/input.js";
import { nativeSnapshot } from "../src/extension/snapshot.js";
import { context } from "./fixture.js";

type Factory = NonNullable<
	Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]
>;
const identity = { instance: "a".repeat(32), generation: "b".repeat(32) };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
	const ctx = context();
	let draft = "",
		busy = false;
	const submit = vi.fn<(text: string) => void | Promise<void>>();
	const editor = { onSubmit: submit } as unknown as ReturnType<Factory>;
	const prior = vi.fn<Factory>(() => editor);
	let factory: Factory | undefined = prior;
	const models = [
		{ provider: "local", id: "one", name: "Local one" },
		{ provider: "local", id: "two", name: "Local two" },
	];
	ctx.ui = {
		getEditorComponent: () => factory,
		setEditorComponent: (next: Factory) => {
			factory = next;
			// Pi assigns its native callback after invoking a custom editor factory.
			next(
				{} as Parameters<Factory>[0],
				{} as Parameters<Factory>[1],
				{} as Parameters<Factory>[2],
			).onSubmit = submit;
		},
		getEditorText: () => draft,
	} as unknown as ExtensionContext["ui"];
	ctx.modelRegistry = {
		getAvailable: () => models,
	} as unknown as ExtensionContext["modelRegistry"];
	ctx.isIdle = () => !busy;
	const native = installNativeCommands(ctx)!;
	native.activate();
	const send = vi.fn();
	const dispatch = nativeInput(
		identity,
		ctx,
		send,
		() => true,
		undefined,
		undefined,
		undefined,
		native,
	);
	let sequence = 0;
	const body = (text: string) => ({
		...identity,
		requestId: (++sequence).toString(16).padStart(32, "0"),
		text,
	});
	return {
		ctx,
		native,
		send,
		submit,
		prior,
		editor,
		dispatch,
		body,
		draft: (text: string) => {
			draft = text;
		},
		busy: (value: boolean) => {
			busy = value;
		},
		replaceEditor: () => {
			factory = prior;
		},
	};
}

describe("native slash command admission", () => {
	it("preserves the previous editor and projects bounded model references without credentials", () => {
		const f = fixture();
		expect(f.prior).toHaveBeenCalledOnce();
		const { snapshot } = nativeSnapshot(
			f.ctx,
			identity.instance,
			identity.generation,
			"c".repeat(64),
			undefined,
			undefined,
			f.native,
		);
		expect(snapshot.commands?.map((c) => [c.name, c.source])).toEqual([
			["new", "builtin"],
			["reload", "builtin"],
			["model", "builtin"],
		]);
		expect(snapshot.commandModels).toEqual([
			{ reference: "local/one", name: "Local one" },
			{ reference: "local/two", name: "Local two" },
		]);
		f.ctx.scopedModels = [
			{ model: { provider: "local", id: "two", name: "Local two" } },
		] as unknown as ExtensionContext["scopedModels"];
		expect(f.native.models()).toEqual([
			{ reference: "local/two", name: "Local two" },
		]);
		f.replaceEditor();
		expect(f.native.available()).toBe(false);
		expect(f.dispatch(f.body("/new")).reason).toBe("slash-unsupported");
	});
	it.each(["/new", "/reload ", "/model local/two"])(
		"submits %s only through the native callback, once per attempted ID",
		async (text) => {
			const f = fixture(),
				body = f.body(text);
			expect(f.dispatch(body).status).toBe("dispatched");
			expect(f.dispatch(body).status).toBe("dispatched");
			expect(f.dispatch({ ...body, text: "/new changed" }).reason).toBe(
				"mismatch",
			);
			await tick();
			expect(f.submit).toHaveBeenCalledExactlyOnceWith(text.trim());
			expect(f.send).not.toHaveBeenCalled();
		},
	);
	it("blocks unknown commands, bare model, malformed arguments, busy delivery and terminal drafts before callback or model input", async () => {
		const f = fixture();
		for (const text of [
			"/unknown",
			"/model",
			"/model local/missing",
			"/model local/one extra",
			"/new extra",
			" /new",
			"/new\n/model local/one",
		])
			expect(f.dispatch(f.body(text)).reason).toBe("slash-unsupported");
		expect(f.dispatch({ ...f.body("/new"), deliverAs: "steer" }).reason).toBe(
			"slash-unsupported",
		);
		f.busy(true);
		expect(f.dispatch(f.body("/new")).reason).toBe("slash-unsupported");
		f.busy(false);
		f.ctx.hasPendingMessages = () => true;
		expect(f.dispatch(f.body("/reload")).reason).toBe("slash-unsupported");
		f.ctx.hasPendingMessages = () => false;
		f.draft("unsent terminal text");
		const rejected = f.body("/new");
		expect(f.dispatch(rejected).reason).toBe("terminal-draft");
		f.draft("");
		expect(f.dispatch(rejected).reason).toBe("terminal-draft");
		await tick();
		expect(f.submit).not.toHaveBeenCalled();
		expect(f.send).not.toHaveBeenCalled();
	});
	it.each(["draft", "busy", "closed", "editor", "model"])(
		"rechecks %s at deferred execution without resubmitting",
		async (change) => {
			const f = fixture();
			const body = f.body(change === "model" ? "/model local/one" : "/new");
			expect(f.dispatch(body).status).toBe("dispatched");
			if (change === "draft") f.draft("terminal typed before callback");
			if (change === "busy") f.busy(true);
			if (change === "closed") f.native.close();
			if (change === "editor") f.replaceEditor();
			if (change === "model")
				f.ctx.scopedModels = [
					{ model: { provider: "local", id: "two", name: "Local two" } },
				] as unknown as ExtensionContext["scopedModels"];
			await tick();
			expect(f.submit).not.toHaveBeenCalled();
			expect(f.dispatch(body).status).toBe("dispatched");
			await tick();
			expect(f.submit).not.toHaveBeenCalled();
		},
	);
	it("serializes native callbacks and retains a throwing attempt without retry", async () => {
		const f = fixture();
		let release!: () => void;
		f.submit.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const body = f.body("/new");
		f.dispatch(body);
		await tick();
		expect(f.dispatch(f.body("/reload")).reason).toBe("busy");
		release();
		await tick();
		f.submit.mockImplementation(() => {
			throw Error("after native attempt");
		});
		const throwing = f.body("/reload");
		f.dispatch(throwing);
		await tick();
		f.dispatch(throwing);
		await tick();
		expect(f.submit).toHaveBeenCalledTimes(2);
		expect(f.send).not.toHaveBeenCalled();
		f.ctx.sessionManager.getSessionId = () => "replacement";
		expect(f.dispatch(body).reason).toBe("stale");
	});
});
