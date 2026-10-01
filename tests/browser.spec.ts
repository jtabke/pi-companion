import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { png } from "./fixture.js";
let c4Cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
let stopCookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

test("C4 Stop ignored abort stays Stopping; immutable explicit retry survives switching and restart without touching input drafts", async ({ page, context }) => {
	const state = (action: string) => context.request.post("/api/fixture/stop-state", { data: { action } });
	await page.goto("/");
	await page.getByLabel("Terminal pairing secret").fill("browser-fixture-secret");
	await page.getByRole("button", { name: "Pair browser" }).click();
	await state("reset");
	await expect(page.getByLabel("Select live session").locator("option")).toHaveCount(3);
	const list = await (await context.request.get("/api/snapshot")).json();
	const identity = list.sessions.find((s: { session: string }) => s.session === "Browser test");
	await page.getByLabel("Select live session").selectOption(identity.instance);
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
	await state("work");
	await expect(page.getByText("Parent: working", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
	await page.getByRole("button", { name: "Take control", exact: true }).click();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
	await page.getByLabel("Text for selected Pi (local draft)").fill("unsent text");
	await page.getByLabel("One image for selected Pi (local picker)").setInputFiles({ name: "unsent.png", mimeType: "image/png", buffer: png });
	const before = (await (await context.request.get("/api/fixture/dispatches")).json()).aborts;
	const bodies: Record<string, string>[] = [];
	page.on("request", req => { if (req.url().endsWith("/api/stop")) bodies.push(req.postDataJSON()); });
	await page.route("**/api/stop", async route => { await route.fetch(); await route.abort(); }, { times: 1 });
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(page.getByText(/Stop for .*Uncertain — response lost/)).toBeVisible();
	await expect(page.getByText("Parent: Stopping", { exact: true })).toBeVisible();
	await state("end");
	await page.waitForTimeout(1200);
	await expect(page.getByText("Parent: Stopping", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
	await state("work"); // Still unconfirmed, but exact retry must not need native idle.
	await expect(page.getByRole("button", { name: "Retry same Stop request" })).toBeEnabled();
	await page.getByLabel("Select live session").selectOption(list.sessions.find((s: { session: string }) => s.session === "Browser other").instance);
	await expect(page.getByRole("button", { name: "Retry same Stop request" })).toBeDisabled();
	await page.getByLabel("Select live session").selectOption(identity.instance);
	await expect(page.getByLabel("Text for selected Pi (local draft)")).toHaveValue("unsent text");
	await expect(page.getByRole("img", { name: "Local attachment preview" })).toBeVisible();
	await context.request.post("/api/fixture/restart");
	await expect(page.getByText(/Disconnected — reconnecting/)).toBeVisible();
	await page.waitForTimeout(1500);
	await page.getByRole("button", { name: "Pair again" }).click();
	await page.getByLabel("Terminal pairing secret").fill("browser-fixture-secret");
	await page.getByRole("button", { name: "Pair browser" }).click();
	await expect(page.getByText("Parent: Stopping", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Take control", exact: true }).click();
	await expect(page.getByRole("button", { name: "Retry same Stop request" })).toBeEnabled();
	await page.waitForTimeout(1100);
	expect(bodies).toHaveLength(1);
	expect((await (await context.request.get("/api/fixture/dispatches")).json()).aborts).toBe(before + 1);
	await page.getByRole("button", { name: "Retry same Stop request" }).click();
	await expect(page.getByText(/Stop for .*Dispatched; outcome unconfirmed/)).toBeVisible();
	expect(bodies).toHaveLength(2);
	expect(bodies[1].requestId).toBe(bodies[0].requestId);
	expect(bodies[1].instance).toBe(identity.instance);
	expect(bodies[1].generation).toBe(bodies[0].generation); // Reset replaces the generation; browser reconciles its stale initial list.
	await state("pending"); await state("settled");
	await page.waitForTimeout(1100);
	await expect(page.getByText("Parent: Stopping", { exact: true })).toBeVisible();
	await state("no-pending"); await state("settled");
	await expect(page.getByText("Parent: settled (observed)", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
	await expect(page.getByLabel("Text for selected Pi (local draft)")).toHaveValue("unsent text");
	await state("work");
	await expect(page.getByText("Parent: working", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "Release control" }).click();
	expect((await (await context.request.get("/api/fixture/dispatches")).json()).aborts).toBe(before + 1);
	expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
	stopCookies = await context.cookies(); // Same-cookie readers; do not raise the existing eight-cookie admission cap.
	await state("reset");
});

test("C4 Stop throw remains uncertain and authority loss/replacement never redirects or auto-aborts", async ({ page, context }) => {
	if (stopCookies.length) await context.addCookies(stopCookies);
	await page.goto("/");
	if (!stopCookies.length) {
		await page.getByLabel("Terminal pairing secret").fill("browser-fixture-secret");
		await page.getByRole("button", { name: "Pair browser" }).click();
	}
	const state = (action: string) => context.request.post("/api/fixture/stop-state", { data: { action } });
	await state("reset");
	await expect(page.getByLabel("Select live session").locator("option")).toHaveCount(3);
	const list = await (await context.request.get("/api/snapshot")).json();
	const identity = list.sessions.find((s: { session: string }) => s.session === "Browser test");
	await page.getByLabel("Select live session").selectOption(identity.instance);
	await page.getByRole("button", { name: "Take control", exact: true }).click();
	await state("work"); await state("throw");
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
	const before = (await (await context.request.get("/api/fixture/dispatches")).json()).aborts;
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(page.getByText(/Stop for .*Uncertain — original ID retained/)).toBeVisible();
	await page.getByRole("button", { name: "Retry same Stop request" }).click();
	await expect(page.getByRole("button", { name: "Retry same Stop request" })).toBeEnabled();
	const reader = await context.newPage(); await reader.goto("/");
	await reader.getByLabel("Select live session").selectOption(identity.instance);
	await expect(reader.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
	await reader.getByRole("button", { name: "Take over browser control", exact: true }).click();
	await expect(page.getByRole("button", { name: "Retry same Stop request" })).toBeDisabled();
	await reader.close();
	await state("reset");
	await expect(page.getByRole("button", { name: "Take control", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Take control", exact: true }).click();
	await state("work");
	await expect(page.getByRole("button", { name: "Retry same Stop request" })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
	expect((await (await context.request.get("/api/fixture/dispatches")).json()).aborts).toBe(before + 1);
	await state("reset");
});
test("C4 Stop preserves an uncertain original image input independently of Stop receipts", async ({ page, context }) => {
	if (stopCookies.length) await context.addCookies(stopCookies);
	await page.goto("/");
	if (!stopCookies.length) {
		await page.getByLabel("Terminal pairing secret").fill("browser-fixture-secret");
		await page.getByRole("button", { name: "Pair browser" }).click();
	}
	const state = (action: string) => context.request.post("/api/fixture/stop-state", { data: { action } });
	await state("reset");
	await expect(page.getByLabel("Select live session").locator("option")).toHaveCount(3);
	const list = await (await context.request.get("/api/snapshot")).json();
	await page.getByLabel("Select live session").selectOption(list.sessions.find((s: { session: string }) => s.session === "Browser test").instance);
	await page.getByRole("button", { name: "Take control", exact: true }).click();
	await page.getByLabel("Text for selected Pi (local draft)").fill("original image feedback");
	await page.getByLabel("One image for selected Pi (local picker)").setInputFiles({ name: "original.png", mimeType: "image/png", buffer: png });
	const images: Record<string, string>[] = [];
	page.on("request", req => { if (req.url().endsWith("/api/image")) images.push(req.postDataJSON()); });
	await page.route("**/api/image", async route => { await route.fetch(); await route.abort(); }, { times: 1 });
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByText(/Uncertain — response lost; no automatic retry/)).toBeVisible();
	await page.getByLabel("Text for selected Pi (local draft)").fill("edited unsent draft");
	await state("work");
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(page.getByText(/Stop for .*Dispatched; outcome unconfirmed/)).toBeVisible();
	await expect(page.getByRole("button", { name: "Retry same outstanding input" })).toBeDisabled();
	await state("end"); await page.waitForTimeout(1100);
	await expect(page.getByRole("button", { name: "Retry same outstanding input" })).toBeDisabled();
	expect(images).toHaveLength(1);
	await state("settled");
	await expect(page.getByRole("button", { name: "Retry same outstanding input" })).toBeEnabled();
	await page.getByRole("button", { name: "Retry same outstanding input" }).click();
	await expect(page.getByText("Controller held · Dispatched; outcome unconfirmed", { exact: true })).toBeVisible();
	expect(images).toHaveLength(2);
	expect(images[1]).toEqual(images[0]);
	await expect(page.getByLabel("Text for selected Pi (local draft)")).toHaveValue("edited unsent draft");
	await expect(page.getByRole("img", { name: "Local attachment preview" })).toBeVisible();
	await state("reset");
});

for (const width of [320, 390])
	test(`authenticated native image/enlargement/security at ${width}px`, async ({
		page,
		request,
	}) => {
		const unexpected: string[] = [];
		page.on("request", (req) => {
			if (!req.url().startsWith("http://127.0.0.1:4393/"))
				unexpected.push(req.url());
		});
		expect((await request.get("/api/snapshot")).status()).toBe(401);
		expect((await request.get("/api/events")).status()).toBe(401);
		expect(
			(
				await request.post("/api/pair", {
					headers: { Origin: "https://evil.invalid", "x-c2-csrf": "pair" },
					data: { secret: "browser-fixture-secret" },
				})
			).status(),
		).toBe(403);
		await page.setViewportSize({ width, height: 844 });
		await page.goto("/");
		await page
			.getByLabel("Terminal pairing secret")
			.fill("browser-fixture-secret");
		await page.getByRole("button", { name: "Pair browser" }).click();
		await expect(
			page.getByLabel("Select live session").locator("option"),
		).toHaveCount(3);
		await page.getByLabel("Select live session").selectOption({
			label: (
				await page
					.getByLabel("Select live session")
					.locator("option")
					.allTextContents()
			).find((label) => label.includes("Browser test"))!,
		});
		await expect(page.getByText("Parent: idle", { exact: true })).toBeVisible();
		await expect(page.getByText(/Background work unobserved —/)).toBeVisible();
		const image = page.getByRole("img", {
			name: "Native Pi image",
			exact: true,
		});
		await expect(image).toBeVisible();
		await expect
			.poll(() =>
				image.evaluate((img) => (img as HTMLImageElement).naturalWidth),
			)
			.toBe(1);
		await expect(page.getByText(/Image unavailable:/)).toBeVisible();
		await expect(page.locator("article script")).toHaveCount(0);
		await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
		expect(unexpected).toEqual([]);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		expect(await page.evaluate(() => Object.keys(localStorage).length)).toBe(0);
		expect(await page.evaluate(() => document.cookie)).not.toContain("c2=");
		await page.getByRole("button", { name: "Enlarge native Pi image" }).click();
		await expect(page.locator(".pswp--open")).toBeVisible();
		await expect(page.locator(".pswp__img").first()).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator(".pswp--open")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Enlarge native Pi image" }),
		).toBeFocused();
		await page.getByRole("button", { name: "Enlarge native Pi image" }).click();
		await page.getByRole("button", { name: "Close", exact: false }).click();
		await expect(page.locator(".pswp--open")).toHaveCount(0);
	});

test("C3 two tabs choose independently, switch rapidly, reconcile generation and retain disconnected selection", async ({
	page,
	context,
}) => {
	await page.goto("/");
	await page
		.getByLabel("Terminal pairing secret")
		.fill("browser-fixture-secret");
	await page.getByRole("button", { name: "Pair browser" }).click();
	const selector = page.getByLabel("Select live session");
	await expect(selector.locator("option")).toHaveCount(3);
	const options = await selector.locator("option").evaluateAll((nodes) =>
		nodes.map((node) => ({
			value: (node as HTMLOptionElement).value,
			text: node.textContent,
		})),
	);
	const a = options.find((option) =>
		option.text?.includes("Browser test"),
	)!.value;
	const b = options.find((option) =>
		option.text?.includes("Browser other"),
	)!.value;
	await selector.selectOption(a);
	await expect(page.locator("article")).toContainText("Owner A");
	await selector.selectOption(a); // Reselecting the same scope must not erase cached/current content.
	await expect(page.locator("article")).toContainText("Owner A");
	const tab = await context.newPage();
	await tab.goto("/");
	await tab.getByLabel("Select live session").selectOption(b);
	await expect(tab.locator("article")).toContainText("Owner B");
	await expect(page.locator("article")).not.toContainText("Owner B");
	for (const value of [b, a, b, a]) await selector.selectOption(value);
	await expect(page.locator("article")).toContainText("Owner A");
	await expect(page.locator("article")).not.toContainText("Owner B");
	await expect(page.locator("article")).toHaveCount(1);
	const old = await tab.locator("article").getAttribute("data-native-item");
	const ownerA = await page.locator("article").getAttribute("data-native-item");
	expect((await context.request.post("/api/fixture/reload")).status()).toBe(
		200,
	);
	await expect
		.poll(() => tab.locator("article").getAttribute("data-native-item"))
		.not.toBe(old);
	await expect(tab.locator("article")).toHaveCount(1);
	expect(await page.locator("article").getAttribute("data-native-item")).toBe(
		ownerA,
	);
	expect((await context.request.post("/api/fixture/disconnect")).status()).toBe(
		200,
	);
	await expect(
		tab.getByText(/Selected conversation disconnected or unavailable/),
	).toBeVisible();
	await expect(tab.locator("article")).toContainText("Owner B");
	await expect(tab.getByLabel("Select live session")).toHaveValue(b);
	await expect(page.locator("article")).toContainText("Owner A");
	expect(
		await tab.evaluate(
			() =>
				Object.keys(localStorage).length + Object.keys(sessionStorage).length,
		),
	).toBe(0);
	await context.request.post("/api/fixture/restore");
	await tab.close();
});

test("C4 same-cookie controller, volatile separate drafts, lost response dedup and no automatic resend", async ({
	page,
	context,
}) => {
	await page.goto("/");
	await page
		.getByLabel("Terminal pairing secret")
		.fill("browser-fixture-secret");
	await page.getByRole("button", { name: "Pair browser" }).click();
	const selector = page.getByLabel("Select live session");
	await expect(selector.locator("option")).toHaveCount(3);
	c4Cookies = await context.cookies(); // Reuse cookie in the following same-cookie race test, retaining the production eight-cookie cap.
	const options = await selector.locator("option").evaluateAll((nodes) =>
		nodes.map((n) => ({
			value: (n as HTMLOptionElement).value,
			text: n.textContent,
		})),
	);
	const a = options.find((n) => n.text?.includes("Browser test"))!.value;
	const b = options.find((n) => n.text?.includes("Browser other"))!.value;
	await selector.selectOption(a);
	const draft = page.getByLabel("Text for selected Pi (local draft)");
	await draft.fill("draft A");
	await selector.selectOption(b);
	await draft.fill("draft B");
	await selector.selectOption(a);
	await expect(draft).toHaveValue("draft A");
	await expect(
		page.getByRole("button", { name: "Send", exact: true }),
	).toBeDisabled();
	await context.request.post("/api/fixture/clock", { data: { freeze: true } });
	const claimResponse = page.waitForResponse(
		(r) =>
			r.url().endsWith("/api/control") &&
			r.request().postDataJSON().action === "claim",
	);
	await page.getByRole("button", { name: "Take control", exact: true }).click();
	const firstLease = await (await claimResponse).json();
	const capability = firstLease.lease;
	await expect(
		page.getByRole("button", { name: "Send", exact: true }),
	).toBeEnabled();
	const tab = await context.newPage();
	await tab.goto("/");
	await expect(
		tab.getByLabel("Select live session").locator("option"),
	).toHaveCount(3);
	await tab.getByLabel("Select live session").selectOption(a);
	await expect(
		tab.getByRole("button", { name: "Send", exact: true }),
	).toBeDisabled();
	const takeoverResponse = tab.waitForResponse(
		(r) =>
			r.url().endsWith("/api/control") &&
			r.request().postDataJSON().action === "takeover",
	);
	await tab
		.getByRole("button", { name: "Take over browser control", exact: true })
		.click();
	const taken = await (await takeoverResponse).json();
	expect(taken.expires).toBe(firstLease.expires);
	expect(taken.revision).not.toBe(firstLease.revision);
	await context.request.post("/api/fixture/clock", { data: { freeze: false } });
	await expect(
		tab.getByRole("button", { name: "Release control" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", {
			name: "Take over browser control",
			exact: true,
		}),
	).toBeVisible();
	await tab.getByRole("button", { name: "Release control" }).click();
	await expect(
		page.getByRole("button", { name: "Take control", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Take control", exact: true }).click();
	const count = async () =>
		(await (await context.request.get("/api/fixture/dispatches")).json())
			.dispatches;
	const before = await count();
	const sent: { requestId: string; text: string }[] = [];
	page.on("request", (r) => {
		if (r.url().endsWith("/api/text")) sent.push(r.postDataJSON());
	});
	await page.route(
		"**/api/text",
		async (route) => {
			await route.fetch();
			await route.abort();
		},
		{ times: 1 },
	);
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await expect(
		page.getByText("Uncertain — response lost; no automatic retry", {
			exact: false,
		}),
	).toBeVisible();
	await expect(draft).toHaveValue("draft A");
	await context.request.post("/api/fixture/break-transport");
	await expect(page.getByText(/Disconnected — reconnecting/)).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Retry same outstanding input" }),
	).toBeDisabled();
	await page.waitForTimeout(2200); // Reconnecting must not resubmit text or restore holder authority.
	expect(await count()).toBe(before + 1);
	expect(sent).toHaveLength(1);
	const reclaim = page.getByRole("button", {
		name: /^(Take control|Take over browser control)$/,
	});
	await expect(reclaim).toBeEnabled();
	await reclaim.click(); // Deliberate new control, never an SSE auto-claim.
	await expect(
		page.getByRole("button", { name: "Retry same outstanding input" }),
	).toBeEnabled();
	await page
		.getByRole("button", { name: "Retry same outstanding input" })
		.click();
	await expect(page.getByText(/Dispatched; outcome unconfirmed/)).toBeVisible();
	expect(sent).toHaveLength(2);
	expect(sent[1].requestId).toBe(sent[0].requestId);
	expect(sent[1].text).toBe(sent[0].text);
	expect(await count()).toBe(before + 1);
	await expect(draft).toHaveValue("");
	const publicView = await (await context.request.get("/api/snapshot")).text();
	expect(publicView).not.toContain(capability);
	expect(await page.locator("body").innerText()).not.toContain(capability);
	expect(page.url()).not.toContain(capability);
	expect(
		await page.evaluate(() => localStorage.length + sessionStorage.length),
	).toBe(0);
	await selector.selectOption(b);
	await expect(draft).toHaveValue("draft B");
	await expect(
		page.getByRole("button", { name: "Send", exact: true }),
	).toBeDisabled();
	await tab.close();
});

test("C4 delayed pre-takeover claim/renew responses never restore old holder authority", async ({
	page,
	context,
}) => {
	if (c4Cookies.length) await context.addCookies(c4Cookies);
	await page.goto("/");
	if (!c4Cookies.length) {
		await page
			.getByLabel("Terminal pairing secret")
			.fill("browser-fixture-secret");
		await page.getByRole("button", { name: "Pair browser" }).click();
	}
	await expect(
		page.getByLabel("Select live session").locator("option"),
	).toHaveCount(3);
	const choice = await page
		.getByLabel("Select live session")
		.locator("option")
		.evaluateAll(
			(nodes) =>
				(
					nodes.find((n) =>
						n.textContent?.includes("Browser test"),
					) as HTMLOptionElement
				).value,
		);
	await page.getByLabel("Select live session").selectOption(choice);
	const tab = await context.newPage();
	await tab.goto("/");
	await tab.getByLabel("Select live session").selectOption(choice);
	for (const action of ["claim", "renew"]) {
		if (action === "renew") {
			await page
				.getByRole("button", { name: "Take control", exact: true })
				.click();
			await expect(
				page.getByRole("button", { name: "Release control" }),
			).toBeVisible();
		}
		let release!: () => void, delivered!: () => void;
		const heldResponse = new Promise<void>((resolve) => {
			release = resolve;
		});
		const reachedServer = new Promise<void>((resolve) => {
			delivered = resolve;
		});
		await page.route(
			"**/api/control",
			async (route) => {
				const response = await route.fetch();
				delivered();
				await heldResponse;
				await route.fulfill({ response });
			},
			{ times: 1 },
		);
		await page
			.getByRole("button", {
				name: action === "claim" ? "Take control" : "Renew control (60s)",
				exact: true,
			})
			.click();
		await reachedServer;
		await tab
			.getByRole("button", { name: "Take over browser control", exact: true })
			.click();
		await expect(
			tab.getByRole("button", { name: "Release control" }),
		).toBeVisible();
		release();
		await expect(
			page.getByRole("button", {
				name: "Take over browser control",
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Release control" }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Send", exact: true }),
		).toBeDisabled();
		await tab.getByRole("button", { name: "Release control" }).click();
		await expect(
			page.getByRole("button", { name: "Take control", exact: true }),
		).toBeVisible();
	}
	await tab.close();
});

for (const width of [320, 390]) test(`C4-B local picker/preview/remove/replace/drafts and immutable original retry at ${width}px`, async ({ page, context }) => {
	if (c4Cookies.length) await context.addCookies(c4Cookies);
	await page.addInitScript(() => {
		const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
		const observed = { created: [] as string[], revoked: [] as string[] };
		(window as unknown as { objectUrls: typeof observed }).objectUrls = observed;
		URL.createObjectURL = (blob) => { const url = create(blob); observed.created.push(url); return url; };
		URL.revokeObjectURL = (url) => { observed.revoked.push(url); revoke(url); };
	});
	await page.setViewportSize({ width, height: 844 });
	await page.goto("/");
	if (!c4Cookies.length) { await page.getByLabel("Terminal pairing secret").fill("browser-fixture-secret"); await page.getByRole("button", { name: "Pair browser" }).click(); }
	const selector = page.getByLabel("Select live session");
	await expect(selector.locator("option")).toHaveCount(3);
	c4Cookies = await context.cookies();
	const options = await selector.locator("option").evaluateAll((nodes) => nodes.map((n) => ({ value: (n as HTMLOptionElement).value, text: n.textContent })));
	const a = options.find((n) => n.text?.includes("Browser test"))!.value, b = options.find((n) => n.text?.includes("Browser other"))!.value;
	await selector.selectOption(a);
	const picker = page.getByLabel("One image for selected Pi (local picker)"), preview = page.getByRole("img", { name: "Local attachment preview" });
	const sent: Record<string, string>[] = [];
	page.on("request", (r) => { if (r.url().endsWith("/api/image")) sent.push(r.postDataJSON()); });
	await picker.setInputFiles({ name: "unsafe.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
	await expect(page.getByText(/HEIC\/SVG\/GIF unsupported/)).toBeVisible();
	await expect(preview).toHaveCount(0);
	const first = { name: "first.png", mimeType: "image/png", buffer: png };
	await picker.setInputFiles(first);
	await expect(preview).toBeVisible();
	await expect.poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1);
	const firstUrl = await preview.getAttribute("src"); expect(firstUrl).toMatch(/^blob:/);
	await page.getByRole("button", { name: "Remove image" }).click(); await expect(preview).toHaveCount(0);
	await picker.setInputFiles(first);
	await selector.selectOption(b); await expect(preview).toHaveCount(0);
	await page.getByLabel("Text for selected Pi (local draft)").fill("B retained text");
	await picker.setInputFiles({ ...first, name: "owner-b.png" });
	await selector.selectOption(a); await expect(preview).toBeVisible();
	await page.getByRole("button", { name: /^(Take control|Take over browser control)$/ }).click();
	const send = page.getByRole("button", { name: "Send", exact: true }); await expect(send).toBeEnabled();
	await page.waitForTimeout(300); expect(sent).toHaveLength(0); // Picker/switch/control never upload.
	const before = (await (await context.request.get("/api/fixture/dispatches")).json()).dispatches;
	await page.route("**/api/image", async (route) => { await route.fetch(); await route.abort(); }, { times: 1 });
	await send.click(); await expect(page.getByText(/Uncertain — response lost; no automatic retry/)).toBeVisible();
	expect(sent).toHaveLength(1); expect(sent[0].source).toBe(png.toString("base64")); expect(sent[0].text).toBe("");
	await page.getByLabel("Text for selected Pi (local draft)").fill("new text must not mutate outstanding");
	await picker.setInputFiles({ ...first, name: "replacement.png" });
	await selector.selectOption(b); await expect(page.getByLabel("Text for selected Pi (local draft)")).toHaveValue("B retained text");
	await expect(page.getByText(/owner-b.png/)).toBeVisible();
	await selector.selectOption(a); await expect(page.getByText(/replacement.png/)).toBeVisible();
	await context.request.post("/api/fixture/restart");
	await expect.poll(async () => { try { return (await context.request.get("/api/snapshot")).status(); } catch { return 0; } }).toBe(401);
	await page.getByRole("button", { name: "Pair again" }).click();
	await page.getByLabel("Terminal pairing secret").fill("browser-fixture-secret");
	await page.getByRole("button", { name: "Pair browser" }).click();
	await expect(selector).toHaveValue(a); // Wait for the new pairing response before retaining its cookie.
	c4Cookies = await context.cookies();
	await page.getByRole("button", { name: "Take control", exact: true }).click();
	await page.waitForTimeout(300); expect(sent).toHaveLength(1); // Restart/pair/deliberate claim do not upload.
	await page.getByRole("button", { name: "Retry same outstanding input" }).click();
	await expect(page.getByText(/Dispatched; outcome unconfirmed/)).toBeVisible();
	expect(sent).toHaveLength(2);
	for (const field of ["requestId", "text", "source", "mime"]) expect(sent[1][field]).toBe(sent[0][field]);
	expect((await (await context.request.get("/api/fixture/dispatches")).json()).dispatches).toBe(before + 1);
	await expect(page.getByLabel("Text for selected Pi (local draft)")).toHaveValue("new text must not mutate outstanding");
	await expect(preview).toBeVisible();
	const urls = await page.evaluate(() => (window as unknown as { objectUrls: { created: string[]; revoked: string[] } }).objectUrls);
	expect(urls.revoked).toContain(firstUrl); expect(urls.created.length - urls.revoked.length).toBe(1);
	expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	const publicView = await (await context.request.get("/api/snapshot")).text(); expect(publicView).not.toContain(sent[1].lease);
	await selector.selectOption("");
	await expect.poll(() => page.evaluate(() => {
		const after = (window as unknown as { objectUrls: { created: string[]; revoked: string[] } }).objectUrls;
		return after.created.length - after.revoked.length;
	})).toBe(0);
});

let questionCookies: Awaited<ReturnType<BrowserContext['cookies']>> = [];
async function pairQuestionnaire(page: Page, context: BrowserContext) {
 if (questionCookies.length || c4Cookies.length) await context.addCookies(questionCookies.length ? questionCookies : c4Cookies);
 await page.goto('/');
 const check = await context.request.get('/api/snapshot');
 if (check.status() === 401) {
  await page.getByLabel('Terminal pairing secret').fill('browser-fixture-secret'); await page.getByRole('button', { name: 'Pair browser' }).click();
 }
 await expect(page.getByLabel('Select live session')).toBeVisible(); questionCookies = await context.cookies();
}

test('C4 questionnaire full safe content, free/multi/notes/cancel, reader/takeover and terminal closure at 320px', async ({ page, context }) => {
 await page.setViewportSize({ width: 320, height: 700 });
 await pairQuestionnaire(page, context);
 const state = (action: string) => context.request.post('/api/fixture/question', { data: { action } });
 await state('reload'); await state('new');
 const list = await (await context.request.get('/api/snapshot')).json();
 const owner = list.sessions.find((s: { session: string }) => s.session === 'Browser test');
 await page.getByLabel('Select live session').selectOption(owner.instance);
 await expect(page.getByText('Full preview A')).toBeVisible();
 await expect(page.getByRole('button', { name: 'Submit questionnaire' })).toBeDisabled();
 expect(await page.locator('.questions script, .questions img, .questions a[href^="javascript:"]').count()).toBe(0);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 const reader = await context.newPage(); await reader.goto('/'); await reader.getByLabel('Select live session').selectOption(owner.instance);
 await page.getByRole('button', { name: 'Take control', exact: true }).click();
 await expect(page.getByRole('button', { name: 'Submit questionnaire' })).toBeEnabled();
 await reader.getByRole('button', { name: 'Take over browser control', exact: true }).click();
 await expect(page.getByRole('button', { name: 'Submit questionnaire' })).toBeDisabled();
 await reader.getByLabel('Free response for Single').fill('custom exact');
 await reader.getByLabel('Optional note for Single').fill('question note');
 await reader.getByLabel('One', { exact: true }).check(); await reader.getByLabel('Two', { exact: true }).check();
 await reader.getByLabel('Optional questionnaire note').fill('global exact');
 await reader.getByRole('button', { name: 'Submit questionnaire' }).click();
 await expect(reader.getByText(/Accepted by same live completion callback/)).toBeVisible();
 await expect(page.getByRole('form', { name: 'Pending questionnaire' })).toHaveCount(0);
 const replies = (await (await state('accept')).json()).replies;
 expect(replies.at(-1).answers).toEqual([{ questionIndex: 0, kind: 'custom', answer: 'custom exact', notes: 'question note' }, { questionIndex: 1, kind: 'multi', answer: null, selected: ['One', 'Two'] }]);
 expect(replies.at(-1).globalNote).toBe('global exact');
 await state('new'); await expect(reader.getByRole('button', { name: 'Cancel questionnaire' })).toBeEnabled(); await reader.getByRole('button', { name: 'Cancel questionnaire' }).click();
 await expect(reader.getByRole('form', { name: 'Pending questionnaire' })).toHaveCount(0);
 expect((await (await state('accept')).json()).replies.at(-1).cancelled).toBe(true);
 await state('new'); await expect(reader.getByRole('form', { name: 'Pending questionnaire' })).toHaveCount(1); await reader.close();
 await state('terminal'); await expect(page.getByRole('form', { name: 'Pending questionnaire' })).toHaveCount(0);
 await state('reload');
});

test('C4 questionnaire invalid correction, immutable uncertain repeat versus edited fields, switch/restart/new pair, and old generation safety at 390px', async ({ page, context }) => {
 await page.setViewportSize({ width: 390, height: 844 });
 await pairQuestionnaire(page, context);
 const state = (action: string) => context.request.post('/api/fixture/question', { data: { action } });
 await state('reload'); await state('new');
 const list = await (await context.request.get('/api/snapshot')).json(); const owner = list.sessions.find((s: { session: string }) => s.session === 'Browser test'); const other = list.sessions.find((s: { session: string }) => s.session === 'Browser other');
 await page.getByLabel('Select live session').selectOption(owner.instance); await page.getByRole('button', { name: 'Take control', exact: true }).click();
 await state('invalid'); await page.getByLabel('Exact B', { exact: true }).check(); await page.getByRole('button', { name: 'Submit questionnaire' }).click();
 await expect(page.getByText(/Invalid reply — correct/)).toBeVisible(); await expect(page.getByRole('form', { name: 'Pending questionnaire' })).toHaveCount(1);
 await state('lost'); await page.getByLabel('Free response for Single').fill('original immutable'); await page.getByRole('button', { name: 'Submit questionnaire' }).click();
 await expect(page.getByRole('button', { name: 'Repeat original questionnaire reply' })).toBeEnabled();
 await page.getByLabel('Text for selected Pi (local draft)').fill('separate text'); await page.getByLabel('Free response for Single').fill('edited not sent');
 await page.getByLabel('Select live session').selectOption(other.instance); await expect(page.getByRole('button', { name: 'Repeat original questionnaire reply' })).toBeDisabled();
 await page.getByLabel('Select live session').selectOption(owner.instance);
 await context.request.post('/api/fixture/restart'); await expect(page.getByText(/Disconnected — reconnecting/)).toBeVisible(); await page.waitForTimeout(1500);
 await page.getByRole('button', { name: 'Pair again' }).click(); await page.getByLabel('Terminal pairing secret').fill('browser-fixture-secret'); await page.getByRole('button', { name: 'Pair browser' }).click();
 await page.getByRole('button', { name: 'Take control', exact: true }).click(); await expect(page.getByRole('button', { name: 'Repeat original questionnaire reply' })).toBeEnabled();
 await state('accept'); await page.getByRole('button', { name: 'Repeat original questionnaire reply' }).click(); await expect(page.getByText(/Accepted by same live completion callback/)).toBeVisible();
 const replies = (await (await state('accept')).json()).replies; expect(replies.at(-1).answers[0].answer).toBe('original immutable'); expect(replies.at(-1).replyId).not.toBe(replies.at(-2).replyId); expect(replies.at(-1).invocationId).toBe(replies.at(-2).invocationId);
 await expect(page.getByLabel('Text for selected Pi (local draft)')).toHaveValue('separate text');
 await expect(page.getByRole('form', { name: 'Pending questionnaire' })).toHaveCount(0);
 await state('new'); await state('lost'); await expect(page.getByRole('button', { name: 'Submit questionnaire' })).toBeEnabled(); await page.getByRole('button', { name: 'Submit questionnaire' }).click(); await expect(page.getByRole('button', { name: 'Repeat original questionnaire reply' })).toBeEnabled();
 await state('terminal'); await state('new'); await expect(page.getByRole('button', { name: 'Repeat original questionnaire reply' })).toBeDisabled();
 await state('reload'); await state('new'); await page.getByRole('button', { name: 'Take control', exact: true }).click(); await expect(page.getByRole('button', { name: 'Repeat original questionnaire reply' })).toBeDisabled();
 await state('terminal'); await state('reload'); questionCookies = await context.cookies();
});

test('C4 questionnaire lost accepted response never infers browser win, cannot repeat to another invocation, and retains text/image/Stop controls', async ({ page, context }) => {
 await pairQuestionnaire(page, context);
 const state = (action: string) => context.request.post('/api/fixture/question', { data: { action } });
 await state('reload'); await state('new'); const list = await (await context.request.get('/api/snapshot')).json(); const owner = list.sessions.find((s: { session: string }) => s.session === 'Browser test');
 await page.getByLabel('Select live session').selectOption(owner.instance); await page.getByRole('button', { name: 'Take control', exact: true }).click();
 await page.getByLabel('Text for selected Pi (local draft)').fill('untouched input');
 await page.getByLabel('One image for selected Pi (local picker)').setInputFiles({ name: 'question.png', mimeType: 'image/png', buffer: png });
 await page.getByLabel('Exact A', { exact: true }).check();
 await page.route('**/api/question-reply', async route => { await route.fetch(); await route.abort(); }, { times: 1 });
 await page.getByRole('button', { name: 'Submit questionnaire' }).click();
 await expect(page.getByText(/Uncertain — response lost or authority changed/)).toBeVisible();
 await expect(page.getByRole('form', { name: 'Pending questionnaire' })).toHaveCount(0);
 await expect(page.getByRole('button', { name: 'Repeat original questionnaire reply' })).toBeDisabled();
 expect(await page.getByText(/Accepted by same live completion callback/).count()).toBe(0);
 await state('new'); await expect(page.getByRole('form', { name: 'Pending questionnaire' })).toHaveCount(1);
 await expect(page.getByRole('button', { name: 'Repeat original questionnaire reply' })).toBeDisabled();
 await expect(page.getByLabel('Text for selected Pi (local draft)')).toHaveValue('untouched input'); await expect(page.getByRole('img', { name: 'Local attachment preview' })).toBeVisible();
 await context.request.post('/api/fixture/stop-state', { data: { action: 'work' } }); await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
 await page.getByRole('button', { name: 'Dismiss uncertain questionnaire reply locally' }).click();
 await expect(page.getByRole('button', { name: 'Submit questionnaire' })).toBeEnabled();
 await state('terminal'); await context.request.post('/api/fixture/stop-state', { data: { action: 'reset' } }); await state('reload'); questionCookies = await context.cookies();
});

test('C4 questionnaire delayed accepted response after owner switch cannot establish replacement/reclaimed success UI', async ({ page, context }) => {
 await pairQuestionnaire(page, context);
 const state = (action: string) => context.request.post('/api/fixture/question', { data: { action } });
 await state('reload'); await state('new'); const list = await (await context.request.get('/api/snapshot')).json(); const owner = list.sessions.find((s: { session: string }) => s.session === 'Browser test'), other = list.sessions.find((s: { session: string }) => s.session === 'Browser other');
 await page.getByLabel('Select live session').selectOption(owner.instance); await page.getByRole('button', { name: 'Take control', exact: true }).click(); await page.getByLabel('Exact B', { exact: true }).check();
 let release!: () => void, entered!: () => void; const ready = new Promise<void>(r => entered = r), held = new Promise<void>(r => release = r);
 await page.route('**/api/question-reply', async route => { const result = await route.fetch(); entered(); await held; await route.fulfill({ response: result }); }, { times: 1 });
 await page.getByRole('button', { name: 'Submit questionnaire' }).click(); await ready;
 await page.getByLabel('Select live session').selectOption(other.instance); release();
 await expect(page.getByText(/Uncertain — response lost or authority changed/)).toBeVisible(); expect(await page.getByText(/Accepted by same live completion callback/).count()).toBe(0);
 await page.getByLabel('Select live session').selectOption(owner.instance); await page.getByRole('button', { name: 'Take control', exact: true }).click(); await expect(page.getByRole('button', { name: 'Repeat original questionnaire reply' })).toBeDisabled();
 await state('new'); await expect(page.getByRole('button', { name: 'Repeat original questionnaire reply' })).toBeDisabled(); await state('terminal'); await state('reload');
});

for (const typed of [false, true]) {
 test(`C4 questionnaire Cancel omits unfinished option after ${typed ? 'free response' : 'fresh Choose options'} and preserves valid answers/notes`, async ({ page, context }) => {
  await pairQuestionnaire(page, context);
  const state = (action: string) => context.request.post('/api/fixture/question', { data: { action } });
  await state('reload');
  const { question } = await (await state('new')).json();
  const list = await (await context.request.get('/api/snapshot')).json();
  const owner = list.sessions.find((s: { session: string }) => s.session === 'Browser test');
  await page.getByLabel('Select live session').selectOption(owner.instance);
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel questionnaire' })).toBeEnabled();
  if (typed) {
   await page.getByLabel('Free response for Single').fill('Not an authored option label');
   await page.getByLabel('Optional note for Single').fill('Preserve unfinished-option note');
   await page.getByLabel('One', { exact: true }).check();
   await page.getByLabel('Optional note for Multi').fill('Preserve chosen-answer note');
   await page.getByLabel('Optional questionnaire note').fill('Preserve global note');
  }
  await page.getByRole('combobox', { name: 'Response for Single', exact: true }).selectOption('option');
  await expect(page.getByLabel('Exact A', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Exact B', { exact: true })).not.toBeChecked();
  const posted = page.waitForRequest(request => request.url().endsWith('/api/question-reply'));
  await page.getByRole('button', { name: 'Cancel questionnaire' }).click();
  const reply = (await posted).postDataJSON().reply;
  // The fixture is permissive: assert the exact public payload, not merely its accepted closure.
  expect(reply).toEqual({
   invocationId: question.invocationId, replyId: expect.stringMatching(/^[a-f0-9]{32}$/), cancelled: true,
   answers: typed ? [
    { questionIndex: 0, kind: 'custom', answer: null, notes: 'Preserve unfinished-option note' },
    { questionIndex: 1, kind: 'multi', answer: null, selected: ['One'], notes: 'Preserve chosen-answer note' },
   ] : [],
   ...(typed ? { globalNote: 'Preserve global note' } : {}),
  });
  await expect(page.getByRole('form', { name: 'Pending questionnaire' })).toHaveCount(0);
  const selected = await (await context.request.get(`/api/snapshot?instance=${owner.instance}&generation=${owner.generation}`)).json();
  expect(selected.questions.pending).toEqual([]);
  // Authored null and empty string are distinct; prove the complete browser-to-public-bus payload too.
  expect((await (await state('accept')).json()).replies.at(-1)).toEqual(reply);
  await state('reload');
 });
}

