import { test, expect, type BrowserContext, type Page } from "@playwright/test";
// @ts-expect-error Test-only ESM fixture IPC has no declaration file.
import { freshCode } from "./pairing-code.mjs";
import { png } from "./fixture.js";
let c4Cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
let stopCookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];

import { chooseSession } from "./choose-session.mjs";
async function expectSessions(page: Page, count: number) {
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	const dialog = page.getByRole("dialog", { name: "Live sessions" });
	await expect(dialog.getByRole("group", { name: / · / })).toHaveCount(count);
	await dialog.getByRole("button", { name: "Close sessions" }).click();
	await expect(dialog).toBeHidden();
}
async function expectSelected(page: Page, instance: string) {
	await expect(
		page.getByRole("button", { name: /^Open sessions:/ }),
	).toBeVisible();
	await expect
		.poll(
			() =>
				new URLSearchParams(new URL(page.url()).hash.slice(1))
					.get("session")
					?.split(":")[0] ?? "",
		)
		.toBe(instance);
}

async function sidebarClick(page: Page, name: string) {
	const dialog = page.getByRole("dialog", { name: "Live sessions" });
	if (!(await dialog.isVisible()))
		await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await dialog.getByRole("button", { name, exact: true }).click();
	if (name === "Forget this device") return; // Confirmed forget removes the dialog itself.
	if (await dialog.isVisible())
		await dialog.getByRole("button", { name: "Close sessions" }).click();
}

async function expectTakeoverAvailable(page: Page) {
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	const sidebar = page.getByRole("dialog", { name: "Live sessions" });
	const takeover = sidebar.getByRole("button", {
		name: "Take over browser control",
		exact: true,
	});
	await expect(takeover).toBeVisible();
	await expect(takeover).toBeEnabled();
	await sidebar.getByRole("button", { name: "Close sessions" }).click();
	await expect(sidebar).toBeHidden();
}

async function expectBusyReceipt(page: Page, message: string, text: string) {
	const receipt = page.getByRole("region", { name: "Latest browser request" });
	await expect(receipt).toHaveCount(1);
	await expect(receipt.getByRole("status")).toHaveText(message);
	await expect(receipt.locator(".receipt-preview")).toHaveText(
		text.length > 240 ? `${text.slice(0, 240)}…` : text,
	);
	expect(await receipt.evaluate((node) => !!node.closest(".chat-scroll"))).toBe(
		true,
	);
	await receipt.scrollIntoViewIfNeeded();
	const preview = await receipt
		.locator(".receipt-preview")
		.evaluate((node) => ({
			height: node.getBoundingClientRect().height,
			line: parseFloat(getComputedStyle(node).lineHeight),
		}));
	expect(preview.height).toBeLessThanOrEqual(3 * preview.line + 0.5);
	await receipt.getByText("Details", { exact: true }).click();
	await expect(receipt.locator(".receipt-text")).toHaveText(text);
	await expect(
		receipt.getByText(
			message.startsWith("Steering") ? "Mode: Steer" : "Mode: Follow-up",
			{ exact: true },
		),
	).toBeVisible();
	await expect(
		receipt.getByText(/Queue position and consumption are unknown/),
	).toBeVisible();
	await receipt.getByText("Details", { exact: true }).click();
	await expect(page.locator(".composer .receipt-preview")).toHaveCount(0);
}

test("C4 Stop ignored abort stays Stopping; immutable explicit retry survives switching and restart without touching input drafts", async ({
	page,
	context,
}) => {
	const state = (action: string) =>
		context.request.post("/api/fixture/stop-state", { data: { action } });
	await page.goto("/");
	await page.getByLabel("Pairing code").fill(await freshCode());
	await page.getByLabel("Remember this device").uncheck();
	await page.getByRole("button", { name: "Pair this device" }).click();
	await state("reset");
	await expectSessions(page, 2);
	const list = await (await context.request.get("/api/snapshot")).json();
	const identity = list.sessions.find(
		(s: { session: string }) => s.session === "Browser test",
	);
	await chooseSession(page, identity.instance);
	await expect(
		page.getByRole("button", {
			name: "Stop",
			exact: true,
			includeHidden: true,
		}),
	).toBeDisabled();
	await state("work");
	await expect(
		page.locator("header").getByText("Pi is working", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveAccessibleDescription(
		"Pi is busy — choose Steer or Follow-up beside +, then Send. Alt+Enter requests Follow-up. Completion unconfirmed.",
	);
	await expect(
		page.getByRole("button", {
			name: "Stop",
			exact: true,
			includeHidden: true,
		}),
	).toBeEnabled();
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("unsent text");
	await page
		.getByLabel("Images for selected Pi (local picker)")
		.setInputFiles({ name: "unsent.png", mimeType: "image/png", buffer: png });
	const before = (
		await (await context.request.get("/api/fixture/dispatches")).json()
	).aborts;
	const bodies: Record<string, string>[] = [];
	page.on("request", (req) => {
		if (req.url().endsWith("/api/stop")) bodies.push(req.postDataJSON());
	});
	await page.route(
		"**/api/stop",
		async (route) => {
			await route.fetch();
			await route.abort();
		},
		{ times: 1 },
	);
	await page
		.getByRole("button", { name: "Stop", exact: true, includeHidden: true })
		.click();
	await expect(page.getByText(/Stop: Uncertain — response lost/)).toBeVisible();
	await expect(
		page.locator("header").getByText("Stopping", { exact: true }),
	).toBeVisible();
	await state("end");
	await page.waitForTimeout(1200);
	await expect(
		page.locator("header").getByText("Stopping", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", {
			name: "Stop",
			exact: true,
			includeHidden: true,
		}),
	).toBeDisabled();
	await expect(
		page.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		}),
	).toBeDisabled();
	await state("work"); // Still unconfirmed, but exact retry must not need native idle.
	await expect(
		page.getByRole("button", { name: "Retry same Stop request" }),
	).toBeEnabled();
	await chooseSession(
		page,
		list.sessions.find(
			(s: { session: string }) => s.session === "Browser other",
		).instance,
	);
	await expect(
		page.getByRole("button", { name: "Retry same Stop request" }),
	).toBeDisabled();
	await expect(page.getByText(/Stop: Uncertain/)).toHaveCount(0);
	await expect(
		page.getByText(
			"Stop belongs to another session. Original retained; switch back to review.",
		),
	).toBeVisible();
	await chooseSession(page, identity.instance);
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveValue("unsent text");
	await expect(
		page.getByRole("img", { name: "Local attachment preview" }),
	).toBeVisible();
	await context.request.post("/api/fixture/restart");
	await expect(page.getByLabel("Pairing code")).toBeVisible();
	await page.waitForTimeout(1500);
	await expect(page.getByLabel("Pairing code")).toBeVisible();
	await page.getByLabel("Pairing code").fill(await freshCode());
	await page.getByLabel("Remember this device").uncheck();
	await page.getByRole("button", { name: "Pair this device" }).click();
	await expect(
		page.locator("header").getByText("Stopping", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Retry same Stop request" }),
	).toBeEnabled();
	await page.waitForTimeout(1100);
	expect(bodies).toHaveLength(1);
	expect(
		(await (await context.request.get("/api/fixture/dispatches")).json())
			.aborts,
	).toBe(before + 1);
	await page.getByRole("button", { name: "Retry same Stop request" }).click();

	await expect.poll(() => bodies.length).toBe(2);
	expect(bodies[1].requestId).toBe(bodies[0].requestId);
	expect(bodies[1].instance).toBe(identity.instance);
	expect(bodies[1].generation).toBe(bodies[0].generation); // Reset replaces the generation; browser reconciles its stale initial list.
	await state("pending");
	await state("settled");
	await page.waitForTimeout(1100);
	await expect(
		page.locator("header").getByText("Stopping", { exact: true }),
	).toBeVisible();
	await state("no-pending");
	await state("settled");
	await expect(
		page.locator("header").getByText("Stopped (observed)", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		}),
	).toBeEnabled();
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveValue("unsent text");
	await state("work");
	await expect(
		page.locator("header").getByText("Pi is working", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", {
			name: "Stop",
			exact: true,
			includeHidden: true,
		}),
	).toBeEnabled();
	await sidebarClick(page, "Release control");
	expect(
		(await (await context.request.get("/api/fixture/dispatches")).json())
			.aborts,
	).toBe(before + 1);
	expect(
		await page.evaluate(() => localStorage.length + sessionStorage.length),
	).toBe(0);
	stopCookies = await context.cookies(); // Same-cookie readers; do not raise the existing eight-cookie admission cap.
	await state("reset");
});

test("C4 Stop throw remains uncertain and authority loss/replacement never redirects or auto-aborts", async ({
	page,
	context,
}) => {
	if (stopCookies.length) await context.addCookies(stopCookies);
	await page.goto("/");
	if (!stopCookies.length) {
		await page.getByLabel("Pairing code").fill(await freshCode());
		await page.getByLabel("Remember this device").uncheck();
		await page.getByRole("button", { name: "Pair this device" }).click();
	}
	const state = (action: string) =>
		context.request.post("/api/fixture/stop-state", { data: { action } });
	await state("reset");
	await expectSessions(page, 2);
	const list = await (await context.request.get("/api/snapshot")).json();
	const identity = list.sessions.find(
		(s: { session: string }) => s.session === "Browser test",
	);
	await chooseSession(page, identity.instance);
	await state("work");
	await state("throw");
	await expect(
		page.getByRole("button", {
			name: "Stop",
			exact: true,
			includeHidden: true,
		}),
	).toBeEnabled();
	const before = (
		await (await context.request.get("/api/fixture/dispatches")).json()
	).aborts;
	await page
		.getByRole("button", { name: "Stop", exact: true, includeHidden: true })
		.click();
	await expect(
		page.getByText(/Stop: Uncertain — original ID retained/),
	).toBeVisible();
	await page.getByRole("button", { name: "Retry same Stop request" }).click();
	await expect(
		page.getByRole("button", { name: "Retry same Stop request" }),
	).toBeEnabled();
	const reader = await context.newPage();
	await reader.goto("/");
	await chooseSession(reader, identity.instance);
	await expect(
		reader.getByRole("button", {
			name: "Stop",
			exact: true,
			includeHidden: true,
		}),
	).toBeDisabled();
	await sidebarClick(reader, "Take over browser control");
	await expect(
		page.getByRole("button", { name: "Retry same Stop request" }),
	).toBeDisabled();
	await reader.close();
	await state("reset");
	await expect(
		page.getByRole("button", { name: "Take control", exact: true }),
	).toHaveCount(0);
	await state("work");
	await expect(
		page.getByRole("button", { name: "Retry same Stop request" }),
	).toBeDisabled();
	await expect(
		page.getByRole("button", {
			name: "Stop",
			exact: true,
			includeHidden: true,
		}),
	).toBeDisabled();
	expect(
		(await (await context.request.get("/api/fixture/dispatches")).json())
			.aborts,
	).toBe(before + 1);
	await state("reset");
});
test("C4 Stop preserves an uncertain original image input independently of Stop receipts", async ({
	page,
	context,
}) => {
	if (stopCookies.length) await context.addCookies(stopCookies);
	await page.goto("/");
	if (!stopCookies.length) {
		await page.getByLabel("Pairing code").fill(await freshCode());
		await page.getByLabel("Remember this device").uncheck();
		await page.getByRole("button", { name: "Pair this device" }).click();
	}
	const state = (action: string) =>
		context.request.post("/api/fixture/stop-state", { data: { action } });
	await state("reset");
	await expectSessions(page, 2);
	const list = await (await context.request.get("/api/snapshot")).json();
	await chooseSession(
		page,
		list.sessions.find((s: { session: string }) => s.session === "Browser test")
			.instance,
	);
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("original image feedback");
	await page.getByLabel("Images for selected Pi (local picker)").setInputFiles({
		name: "original.png",
		mimeType: "image/png",
		buffer: png,
	});
	const images: Record<string, unknown>[] = [];
	page.on("request", (req) => {
		if (req.url().endsWith("/api/image")) images.push(req.postDataJSON());
	});
	await page.route(
		"**/api/image",
		async (route) => {
			await route.fetch();
			await route.abort();
		},
		{ times: 1 },
	);
	await page
		.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		})
		.click();
	await expect(
		page.getByText(/Uncertain — response lost; no automatic retry/),
	).toBeVisible();
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("edited unsent draft");
	await state("work");
	await expect(
		page.getByRole("button", {
			name: "Stop",
			exact: true,
			includeHidden: true,
		}),
	).toBeEnabled();
	await page
		.getByRole("button", { name: "Stop", exact: true, includeHidden: true })
		.click();

	await expect(
		page.getByRole("button", { name: "Retry same outstanding input" }),
	).toBeDisabled();
	await state("end");
	await page.waitForTimeout(1100);
	await expect(
		page.getByRole("button", { name: "Retry same outstanding input" }),
	).toBeDisabled();
	expect(images).toHaveLength(1);
	await state("settled");
	await expect(
		page.getByRole("button", { name: "Retry same outstanding input" }),
	).toBeEnabled();
	await page
		.getByRole("button", { name: "Retry same outstanding input" })
		.click();

	expect(images).toHaveLength(2);
	expect(images[1]).toEqual(images[0]);
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveValue("edited unsent draft");
	await expect(
		page.getByRole("img", { name: "Local attachment preview" }),
	).toBeVisible();
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
					data: { code: await freshCode(), remember: false },
				})
			).status(),
		).toBe(403);
		await page.setViewportSize({ width, height: 844 });
		await page.goto("/");
		await page.getByLabel("Pairing code").fill(await freshCode());
		await page.getByLabel("Remember this device").uncheck();
		await page.getByRole("button", { name: "Pair this device" }).click();
		await expectSessions(page, 2);
		await page.getByRole("button", { name: /^Open sessions:/ }).click();
		await page
			.getByRole("dialog", { name: "Live sessions" })
			.getByRole("button", { name: /Browser test/ })
			.click();
		await expect(
			page.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText("Safety, identity & upload limits", { exact: true }),
		).toHaveCount(0);
		const image = page.getByRole("img", {
			name: /^Native Pi image \d+$/,
			exact: true,
		});
		await expect(image).toBeVisible();
		expect(
			(await request.get((await image.getAttribute("src"))!)).status(),
		).toBe(401);
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
		await page
			.getByRole("button", { name: /^Enlarge native Pi image \d+$/ })
			.click();
		await expect(page.locator(".pswp--open")).toBeVisible();
		await expect(page.locator(".pswp__img").first()).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator(".pswp--open")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: /^Enlarge native Pi image \d+$/ }),
		).toBeFocused();
		await page
			.getByRole("button", { name: /^Enlarge native Pi image \d+$/ })
			.click();
		await page.getByRole("button", { name: "Close", exact: false }).click();
		await expect(page.locator(".pswp--open")).toHaveCount(0);
	});

test("C3 two tabs choose independently, switch rapidly, reconcile generation and retain disconnected selection", async ({
	page,
	context,
}) => {
	await page.goto("/");
	await page.getByLabel("Pairing code").fill(await freshCode());
	await page.getByLabel("Remember this device").uncheck();
	await page.getByRole("button", { name: "Pair this device" }).click();
	await expectSessions(page, 2);
	const options: { value: string; text: string }[] = (
		await (await context.request.get("/api/snapshot")).json()
	).sessions.map((session: { instance: string; session: string }) => ({
		value: session.instance,
		text: session.session,
	}));
	const a = options.find((option) =>
		option.text?.includes("Browser test"),
	)!.value;
	const b = options.find((option) =>
		option.text?.includes("Browser other"),
	)!.value;
	await chooseSession(page, a);
	await expect(page.locator("article")).toContainText("Owner A");
	await chooseSession(page, a); // Reselecting the same scope must not erase cached/current content.
	await expect(page.locator("article")).toContainText("Owner A");
	const tab = await context.newPage();
	await tab.goto("/");
	await chooseSession(tab, b);
	await expect(tab.locator("article")).toContainText("Owner B");
	await expect(page.locator("article")).not.toContainText("Owner B");
	for (const value of [b, a, b, a]) await chooseSession(page, value);
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
		tab.getByLabel("Text for selected Pi (local draft)"),
	).toHaveAccessibleDescription(/Disconnected — cached content is read-only/);
	await expect(tab.locator("article")).toContainText("Owner B");
	await expectSelected(tab, b);
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
	await page.getByLabel("Pairing code").fill(await freshCode());
	await page.getByLabel("Remember this device").uncheck();
	await page.getByRole("button", { name: "Pair this device" }).click();
	await expectSessions(page, 2);
	c4Cookies = await context.cookies(); // Reuse cookie in the following same-cookie race test, retaining the production eight-cookie cap.
	const options: { value: string; text: string }[] = (
		await (await context.request.get("/api/snapshot")).json()
	).sessions.map((session: { instance: string; session: string }) => ({
		value: session.instance,
		text: session.session,
	}));
	const a = options.find((n) => n.text?.includes("Browser test"))!.value;
	const b = options.find((n) => n.text?.includes("Browser other"))!.value;
	await chooseSession(page, a);
	const draft = page.getByLabel("Text for selected Pi (local draft)");
	await draft.fill("draft A");
	await chooseSession(page, b);
	await draft.fill("draft B");
	await chooseSession(page, a);
	await expect(draft).toHaveValue("draft A");
	await expect(
		page.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		}),
	).toBeEnabled();
	await context.request.post("/api/fixture/clock", { data: { freeze: true } });
	const claimResponse = page.waitForResponse(
		(r) =>
			r.url().endsWith("/api/control") &&
			r.request().postDataJSON().action === "claim",
	);
	await page
		.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		})
		.click();
	const firstLease = await (await claimResponse).json();
	await expect(draft).toHaveValue("");
	await draft.fill("draft A");
	const capability = firstLease.lease;
	await expect(
		page.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		}),
	).toBeEnabled();
	const tab = await context.newPage();
	await tab.goto("/");
	await expectSessions(tab, 2);
	await chooseSession(tab, a);
	await expect(
		tab.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		}),
	).toBeDisabled();
	await expect(
		tab.getByLabel("Text for selected Pi (local draft)"),
	).toHaveAccessibleDescription(
		"Another browser has control — take over explicitly to send.",
	);
	const takeoverResponse = tab.waitForResponse(
		(r) =>
			r.url().endsWith("/api/control") &&
			r.request().postDataJSON().action === "takeover",
	);
	await sidebarClick(tab, "Take over browser control");
	const taken = await (await takeoverResponse).json();
	expect(taken.expires).toBe(firstLease.expires);
	expect(taken.revision).not.toBe(firstLease.revision);
	await context.request.post("/api/fixture/clock", { data: { freeze: false } });
	await expect(
		tab.getByRole("button", { name: "Release control", includeHidden: true }),
	).toBeEnabled();
	await expectTakeoverAvailable(page);
	await sidebarClick(tab, "Release control");
	await expect(
		page.getByRole("button", {
			name: "Take over browser control",
			includeHidden: true,
			exact: true,
		}),
	).toHaveCount(0);
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
	await page
		.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		})
		.click();
	await expect(
		page.getByText("Uncertain — response lost; no automatic retry", {
			exact: false,
		}),
	).toBeVisible();
	await expect(draft).toHaveValue("draft A");
	await context.request.post("/api/fixture/break-transport");
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveAccessibleDescription(/Disconnected — cached content is read-only/);
	await expect(
		page.getByRole("button", { name: "Retry same outstanding input" }),
	).toBeDisabled();
	await page.waitForTimeout(2200); // Reconnecting must not resubmit text or restore holder authority.
	expect(await count()).toBe(before + 1);
	expect(sent).toHaveLength(1);
	await expect(
		page.locator("header").getByText("Pi idle", { exact: true }),
	).toBeVisible();
	const reclaim = page.getByRole("button", {
		name: "Take over browser control",
		exact: true,
		includeHidden: true,
	});
	if (await reclaim.count())
		await sidebarClick(page, "Take over browser control"); // Separate takeover never continues the retry.
	await expect(
		page.getByRole("button", { name: "Retry same outstanding input" }),
	).toBeEnabled();
	await page
		.getByRole("button", { name: "Retry same outstanding input" })
		.click();

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
	await chooseSession(page, b);
	await expect(draft).toHaveValue("draft B");
	await expect(
		page.getByText("Forwarded; completion unconfirmed", { exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		}),
	).toBeEnabled();
	// A delayed receipt belongs to the captured owner, even after the reader switches.
	await chooseSession(page, a);
	await draft.fill("late original");
	let release!: () => void, entered!: () => void;
	const ready = new Promise<void>((resolve) => (entered = resolve)),
		heldResponse = new Promise<void>((resolve) => (release = resolve));
	await page.route(
		"**/api/text",
		async (route) => {
			const response = await route.fetch();
			entered();
			await heldResponse;
			await route.fulfill({ response });
		},
		{ times: 1 },
	);
	await page
		.getByRole("button", { name: /^(Send|Steer)$/, exact: true })
		.click();
	await ready;
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveAccessibleDescription("Sending — awaiting a receipt.");
	await chooseSession(page, b);
	release();
	await expect(
		page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
	).toBeEnabled();
	await expect(
		page.getByText("Forwarded; completion unconfirmed", { exact: true }),
	).toHaveCount(0);
	await expect(draft).toHaveValue("draft B");
	await chooseSession(page, a);
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	const sidebar = page.getByRole("dialog", { name: "Live sessions" });
	await sidebar.getByRole("button", { name: "Close sessions" }).click();
	await expect(draft).toHaveValue("");
	await tab.close();
});

test("C4 delayed pre-takeover claim/renew responses never restore old holder authority", async ({
	page,
	context,
}) => {
	if (c4Cookies.length) await context.addCookies(c4Cookies);
	await page.goto("/");
	if (!c4Cookies.length) {
		await page.getByLabel("Pairing code").fill(await freshCode());
		await page.getByLabel("Remember this device").uncheck();
		await page.getByRole("button", { name: "Pair this device" }).click();
	}
	await expectSessions(page, 2);
	const choice = (
		await (await context.request.get("/api/snapshot")).json()
	).sessions.find(
		(session: { session: string }) => session.session === "Browser test",
	).instance;
	await chooseSession(page, choice);
	const tab = await context.newPage();
	await tab.goto("/");
	await chooseSession(tab, choice);
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("captured delayed action");
	const sent: unknown[] = [];
	page.on("request", (req) => {
		if (req.url().endsWith("/api/text")) sent.push(req.postDataJSON());
	});
	for (const action of ["claim", "renew"]) {
		if (action === "renew") {
			await page
				.getByRole("button", {
					name: /^(Send|Steer)$/,
					exact: true,
					includeHidden: true,
				})
				.click();
			await expect(
				page.getByRole("button", {
					name: "Release control",
					includeHidden: true,
				}),
			).toBeEnabled();
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
		if (action === "claim")
			await page
				.getByRole("button", {
					name: /^(Send|Steer)$/,
					exact: true,
					includeHidden: true,
				})
				.click();
		else await sidebarClick(page, "Renew control (60s)");
		await reachedServer;
		await sidebarClick(tab, "Take over browser control");
		await expect(
			tab.getByRole("button", { name: "Release control", includeHidden: true }),
		).toBeEnabled();
		release();
		await expectTakeoverAvailable(page);
		await expect(
			page.getByRole("button", {
				name: "Release control",
				includeHidden: true,
			}),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", {
				name: /^(Send|Steer)$/,
				exact: true,
				includeHidden: true,
			}),
		).toBeDisabled();
		await sidebarClick(tab, "Release control");
		await expect(
			page.getByRole("button", {
				name: "Take over browser control",
				includeHidden: true,
				exact: true,
			}),
		).toHaveCount(0);
		expect(sent).toHaveLength(action === "claim" ? 0 : 1);
	}
	await tab.close();
});

for (const width of [320, 390])
	test(`C4-B ordered local images, limits, session drafts and immutable retry at ${width}px`, async ({
		page,
		context,
	}, testInfo) => {
		if (c4Cookies.length) await context.addCookies(c4Cookies);
		await page.addInitScript(() => {
			const create = URL.createObjectURL.bind(URL),
				revoke = URL.revokeObjectURL.bind(URL);
			const objectUrls = { created: [] as string[], revoked: [] as string[] };
			(window as unknown as { objectUrls: typeof objectUrls }).objectUrls =
				objectUrls;
			URL.createObjectURL = (blob) => {
				const url = create(blob);
				objectUrls.created.push(url);
				return url;
			};
			URL.revokeObjectURL = (url) => {
				objectUrls.revoked.push(url);
				revoke(url);
			};
		});
		await page.setViewportSize({ width, height: 844 });
		await page.goto("/");
		if (!c4Cookies.length) {
			await page.getByLabel("Pairing code").fill(await freshCode());
			await page.getByLabel("Remember this device").uncheck();
			await page.getByRole("button", { name: "Pair this device" }).click();
		}
		await expectSessions(page, 2);
		c4Cookies = await context.cookies();
		const sessions = (await (await context.request.get("/api/snapshot")).json())
			.sessions;
		const a = sessions.find((s: { session: string }) =>
			s.session.includes("Browser test"),
		).instance;
		const b = sessions.find((s: { session: string }) =>
			s.session.includes("Browser other"),
		).instance;
		await chooseSession(page, a);
		const picker = page.getByLabel("Images for selected Pi (local picker)");
		const draft = page.getByLabel("Text for selected Pi (local draft)");
		const previews = page.getByRole("img", {
			name: "Local attachment preview",
		});
		const remove = page.getByRole("button", { name: /^Remove image/ });
		const sent: {
			requestId: string;
			text: string;
			images: { source: string; mime: string }[];
		}[] = [];
		const mutations: string[] = [];
		page.on("request", (request) => {
			if (request.url().endsWith("/api/image"))
				sent.push(request.postDataJSON());
			if (
				request.method() === "POST" &&
				/\/api\/(control|image|text|stop)$/.test(request.url())
			)
				mutations.push(request.url());
		});
		const sharp = (await import("sharp")).default;
		const first = { name: "first.png", mimeType: "image/png", buffer: png };
		const second = {
			name: "second.jpg",
			mimeType: "image/jpeg",
			buffer: await sharp(png).jpeg().toBuffer(),
		};
		const paste = (file: typeof first) =>
			draft.evaluate(
				(input, file) => {
					const clipboardData = new DataTransfer();
					clipboardData.items.add(
						new File(
							[Uint8Array.from(atob(file.source), (c) => c.charCodeAt(0))],
							file.name,
							{ type: file.mimeType },
						),
					);
					return input.dispatchEvent(
						new ClipboardEvent("paste", {
							clipboardData,
							bubbles: true,
							cancelable: true,
						}),
					);
				},
				{
					name: file.name,
					mimeType: file.mimeType,
					source: file.buffer.toString("base64"),
				},
			);
		await expect(picker).toHaveAttribute("multiple", "");
		await expect(picker).toHaveAccessibleDescription(
			"Up to four still PNG, JPEG or WebP images · 4 MB total",
		);
		await picker.setInputFiles({
			name: "unsafe.gif",
			mimeType: "image/gif",
			buffer: Buffer.from("GIF89a"),
		});
		await expect(page.locator(".composer .input-notice")).toContainText(
			"HEIC/SVG/GIF unsupported",
		);
		await expect(previews).toHaveCount(0);
		await draft.fill("ordinary pasted text");
		await draft.press("ControlOrMeta+a");
		await draft.press("ControlOrMeta+c");
		await draft.fill("retained: ");
		await draft.press("End");
		await draft.press("ControlOrMeta+v");
		await expect(draft).toHaveValue("retained: ordinary pasted text");
		await draft.fill("local text");
		await picker.setInputFiles([first, second]);
		await expect(previews).toHaveCount(2);
		await expect
			.poll(() =>
				previews
					.first()
					.evaluate((img) => (img as HTMLImageElement).naturalWidth),
			)
			.toBe(1);
		const firstUrl = await previews.first().getAttribute("src");
		expect(await paste({ ...first, name: "third.png" })).toBe(false);
		expect(await paste({ ...first, name: "fourth.png" })).toBe(false);
		await expect(remove).toHaveCount(4);
		await expect(remove.nth(0)).toHaveAccessibleName(
			"Remove image 1: first.png",
		);
		await expect(remove.nth(1)).toHaveAccessibleName(
			"Remove image 2: second.jpg",
		);
		const row = page.locator(".attachments");
		for (let i = 0; i < 4; i++) {
			const box = (await remove.nth(i).boundingBox())!;
			expect(box.width).toBeGreaterThanOrEqual(44);
			expect(box.height).toBeGreaterThanOrEqual(44);
			expect(box.y).toBe((await remove.first().boundingBox())!.y);
		}
		expect(
			(await row.boundingBox())!.y + (await row.boundingBox())!.height,
		).toBeLessThanOrEqual((await draft.boundingBox())!.y);
		await paste({ ...first, name: "fifth.png" });
		await expect(page.locator(".composer .input-notice")).toContainText(
			"up to four",
		);
		await picker.setInputFiles({ ...first, buffer: Buffer.alloc(4_000_001) });
		await expect(previews).toHaveCount(4);
		await expect(draft).toHaveValue("local text");
		expect(mutations).toEqual([]);
		await remove.nth(3).click();
		await remove.nth(2).click();
		await expect(draft).toBeFocused();
		await chooseSession(page, b);
		await expect(previews).toHaveCount(0);
		await picker.setInputFiles({ ...first, name: "owner-b.png" });
		await chooseSession(page, a);
		await expect(previews).toHaveCount(2);
		const before = (
			await (await context.request.get("/api/fixture/dispatches")).json()
		).dispatches;
		await page.route(
			"**/api/image",
			async (route) => {
				await route.fetch();
				await route.abort();
			},
			{ times: 1 },
		);
		await page
			.getByRole("button", { name: /^(Send|Steer)$/, exact: true })
			.click();
		await expect(
			page.getByText(/Uncertain — response lost; no automatic retry/),
		).toBeVisible();
		expect(sent).toHaveLength(1);
		await expect(page.locator(".composer-availability")).toHaveCount(0);
		await expect(page.locator(".composer .action-receipt > p")).toHaveCount(1);
		await expect(page.locator(".composer .action-receipt summary")).toHaveText(
			"Details",
		);
		const retry = page.getByRole("button", {
			name: "Retry same outstanding input",
		});
		await expect(retry).toBeEnabled();
		const tab = await context.newPage();
		await tab.goto("/");
		await chooseSession(tab, a);
		await sidebarClick(tab, "Take over browser control");
		await expect(retry).toBeDisabled();
		await expect(page.locator(".composer-availability")).toHaveText(
			"Another browser has control — take over explicitly to send.",
		);
		await context.request.post("/api/fixture/stop-state", {
			data: { action: "work" },
		});
		await expect(
			page.locator("header").getByText("Pi is working", { exact: true }),
		).toBeVisible();
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "125%";
		});
		for (const height of [300, 844]) {
			await page.setViewportSize({ width, height });
			await expect
				.poll(async () => (await page.locator("main").boundingBox())!.height)
				.toBe(height);
			const box = (await page.locator(".composer").boundingBox())!;
			const header = (await page.locator("header").boundingBox())!;
			expect(header.y).toBeGreaterThanOrEqual(0);
			expect(height - box.y - box.height).toBeLessThanOrEqual(24);
			const notices = page.locator(".composer-notices");
			await notices.evaluate((node) => {
				node.scrollTop = node.scrollHeight;
			});
			await expect(retry).toBeVisible();
			await page.screenshot({
				path: testInfo.outputPath(
					`uncertain-held-images-${width}-${height}.png`,
				),
			});
		}
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "";
		});
		await context.request.post("/api/fixture/stop-state", {
			data: { action: "settled" },
		});
		await sidebarClick(tab, "Release control");
		await tab.close();
		await expect(retry).toBeEnabled();
		expect(sent).toHaveLength(1); // Layout, ownership and activity changes never retry.
		expect(sent[0].images).toEqual([
			{ source: png.toString("base64"), mime: "image/png" },
			{ source: second.buffer.toString("base64"), mime: "image/jpeg" },
		]);
		await draft.fill("edited after capture");
		await remove.first().click();
		await paste({ ...first, name: "new.png" });
		await chooseSession(page, b);
		await expect(remove.first()).toHaveAccessibleName(
			"Remove image 1: owner-b.png",
		);
		await chooseSession(page, a);
		await context.request.post("/api/fixture/restart");
		await expect(page.getByLabel("Pairing code")).toBeVisible();
		await page.getByLabel("Pairing code").fill(await freshCode());
		await page.getByLabel("Remember this device").uncheck();
		await page.getByRole("button", { name: "Pair this device" }).click();
		await expectSelected(page, a);
		expect(sent).toHaveLength(1);
		await page
			.getByRole("button", { name: "Retry same outstanding input" })
			.click();

		expect(sent).toHaveLength(2);
		expect(sent[1].requestId).toBe(sent[0].requestId);
		expect(sent[1].images).toEqual(sent[0].images);
		expect(sent[1].text).toBe("local text");
		expect(
			(await (await context.request.get("/api/fixture/dispatches")).json())
				.dispatches,
		).toBe(before + 1);
		await expect(draft).toHaveValue("edited after capture");
		await expect(remove.first()).toHaveAccessibleName(
			"Remove image 1: second.jpg",
		);
		await expect(remove.nth(1)).toHaveAccessibleName("Remove image 2: new.png");
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await sidebarClick(page, "Release control");
		await expect(
			page.getByRole("dialog", { name: "Live sessions" }),
		).toBeHidden();
		c4Cookies = await context.cookies();
		expect(
			await page.evaluate(() => localStorage.length + sessionStorage.length),
		).toBe(0);
		const urls = await page.evaluate(
			() =>
				(
					window as unknown as {
						objectUrls: { created: string[]; revoked: string[] };
					}
				).objectUrls,
		);
		expect(urls.revoked).toContain(firstUrl);
		expect(urls.created.length - urls.revoked.length).toBe(2);
		await chooseSession(page, "");
		await expect
			.poll(() =>
				page.evaluate(() => {
					const urls = (
						window as unknown as {
							objectUrls: { created: string[]; revoked: string[] };
						}
					).objectUrls;
					return urls.created.length - urls.revoked.length;
				}),
			)
			.toBe(0);
	});

// Questionnaire interactions deliberately reveal the panel; reviewing alone never acquires control.
async function reviewQuestions(page: Page) {
	await page
		.getByRole("button", { name: "Review questions", exact: true })
		.click();
	await expect(page.locator("#question-review")).toHaveAttribute("open", "");
}
async function fillQuestionField(page: Page, name: string, value: string) {
	await reviewQuestions(page);
	const field = page.getByRole("textbox", { name, exact: true });
	if (!(await field.isVisible())) {
		if (name.startsWith("Free response"))
			await page.getByRole("button", { name, exact: true }).click();
		else
			await page
				.locator("summary")
				.filter({ hasText: new RegExp(`^${name}$`) })
				.click();
	}
	await field.fill(value);
}
async function selectQuestionOption(page: Page, label: string) {
	await reviewQuestions(page);
	await page.getByLabel(label, { exact: true }).check();
}
async function submitQuestionnaire(page: Page, cancelled = false) {
	await reviewQuestions(page);
	await page
		.getByRole("button", {
			name: cancelled ? "Cancel questionnaire" : "Submit questionnaire",
			exact: true,
		})
		.click();
	if (
		!cancelled &&
		(await page
			.getByRole("button", { name: "Forward with unanswered questions" })
			.isVisible())
	)
		await page
			.getByRole("button", { name: "Forward with unanswered questions" })
			.click();
}

let questionCookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
async function pairQuestionnaire(page: Page, context: BrowserContext) {
	if (questionCookies.length || c4Cookies.length)
		await context.addCookies(
			questionCookies.length ? questionCookies : c4Cookies,
		);
	await page.goto("/");
	const check = await context.request.get("/api/snapshot");
	if (check.status() === 401) {
		await page.getByLabel("Pairing code").fill(await freshCode());
		await page.getByLabel("Remember this device").uncheck();
		await page.getByRole("button", { name: "Pair this device" }).click();
	}
	await expect(
		page.getByRole("button", { name: /^Open sessions:/ }),
	).toBeVisible();
	questionCookies = await context.cookies();
}

test("U8 focused Enter dismisses only forwarded unchanged current input, including explicit retry", async ({
	page,
	context,
}) => {
	await pairQuestionnaire(page, context);
	const state = (action: string) =>
		context.request.post("/api/fixture/stop-state", { data: { action } });
	await state("reset");
	const list = await (await context.request.get("/api/snapshot")).json();
	const owner = list.sessions.find(
		(s: { session: string }) => s.session === "Browser test",
	);
	const other = list.sessions.find(
		(s: { session: string }) => s.session === "Browser other",
	);
	await chooseSession(page, owner.instance);
	const draft = page.getByLabel("Text for selected Pi (local draft)");
	const send = page.getByRole("button", {
		name: /^(Send|Steer)$/,
		exact: true,
	});
	const requests: Record<string, string>[] = [];
	page.on("request", (req) => {
		if (req.url().endsWith("/api/text")) requests.push(req.postDataJSON());
	});
	const before = (
		await (await context.request.get("/api/fixture/dispatches")).json()
	).dispatches;
	await draft.fill("idle forwarded");
	await draft.press("Enter");
	await expect(draft).toHaveValue("");
	await expect(draft).not.toBeFocused();
	expect(requests[0].text).toBe("idle forwarded");
	expect(requests[0].deliverAs).toBeUndefined();
	for (const status of ["rejected", "uncertain"] as const) {
		await draft.fill(`${status} original`);
		await page.route(
			"**/api/text",
			(route) =>
				route.fulfill({
					json: {
						requestId: route.request().postDataJSON().requestId,
						status,
						reason: "fixture-rejection",
					},
				}),
			{ times: 1 },
		);
		await draft.press("Enter");
		await expect(
			page
				.locator(".composer")
				.getByText(
					status === "rejected"
						? /Rejected: fixture-rejection/
						: /Uncertain — retain original ID/,
				),
		).toBeVisible();
		await expect(draft).toBeFocused();
		await expect(draft).toHaveValue(`${status} original`);
		if (status === "uncertain") {
			const retry = page.getByRole("button", {
				name: "Retry same outstanding input",
			});
			await expect(retry).toBeEnabled();
			// DOM activation keeps the textarea focused so a success-only blur is observable.
			await retry.evaluate((node) => (node as HTMLButtonElement).click());
			await expect(draft).toHaveValue("");
			await expect(draft).not.toBeFocused();
			expect(requests[3].requestId).toBe(requests[2].requestId);
			expect(requests[3].text).toBe("uncertain original");
		}
	}
	await draft.fill("lost response original");
	await page.route(
		"**/api/text",
		async (route) => {
			await route.fetch();
			await route.abort();
		},
		{ times: 1 },
	);
	await draft.press("Enter");
	const retry = page.getByRole("button", {
		name: "Retry same outstanding input",
	});
	await expect(retry).toBeEnabled();
	await expect(draft).toBeFocused();
	await expect(draft).toHaveValue("lost response original");
	await retry.evaluate((node) => (node as HTMLButtonElement).click());
	await expect(draft).toHaveValue("");
	await expect(draft).not.toBeFocused();
	expect(requests[5].requestId).toBe(requests[4].requestId);
	for (const change of ["new draft", "session switch"]) {
		await draft.fill(`delayed ${change}`);
		let release!: () => void, entered!: () => void;
		const ready = new Promise<void>((r) => {
			entered = r;
		});
		const held = new Promise<void>((r) => {
			release = r;
		});
		await page.route(
			"**/api/text",
			async (route) => {
				const response = await route.fetch();
				entered();
				await held;
				await route.fulfill({ response });
			},
			{ times: 1 },
		);
		await draft.press("Enter");
		await ready;
		await expect(draft).toBeFocused(); // Initiation and a withheld receipt are not success.
		if (change === "session switch") await chooseSession(page, other.instance);
		await draft.fill(`retain ${change}`);
		await draft.focus();
		release();
		await expect(send).toBeEnabled(); // Operation completed, not just a retained draft before response.
		await expect(draft).toBeFocused();
		await expect(draft).toHaveValue(`retain ${change}`);
		if (change === "session switch") {
			await chooseSession(page, owner.instance);
			await expect(draft).not.toBeFocused();
			await expect(draft).toHaveValue("");
		}
	}
	// Switching away already released control; failed reacquisition must not dismiss the editor.
	await draft.fill("not dispatched");
	await expect(send).toBeEnabled();
	await page.route("**/api/control", (route) => route.abort(), { times: 1 });
	await draft.press("Enter");
	await expect(
		page.locator(".composer").getByText(/Not sent — control unavailable/),
	).toBeVisible();
	await expect(draft).toBeFocused();
	await expect(draft).toHaveValue("not dispatched");
	expect(requests).toHaveLength(8);
	expect(
		requests.every(
			(r) => r.instance === owner.instance && r.generation === owner.generation,
		),
	).toBe(true);
	expect(
		(await (await context.request.get("/api/fixture/dispatches")).json())
			.dispatches,
	).toBe(before + 5);
	// Malformed or uncorrelated receipts cannot clear the draft or confirm delivery.
	for (const invalid of ["wrong-id", "unknown-status"] as const) {
		await draft.fill(`retain ${invalid}`);
		await page.route(
			"**/api/text",
			(route) =>
				route.fulfill({
					json: {
						requestId:
							invalid === "wrong-id"
								? "0".repeat(32)
								: route.request().postDataJSON().requestId,
						status: invalid === "unknown-status" ? "accepted" : "dispatched",
					},
				}),
			{ times: 1 },
		);
		await draft.press("Enter");
		await expect(retry).toBeEnabled();
		await expect(draft).toBeFocused();
		await expect(draft).toHaveValue(`retain ${invalid}`);
		const original = requests.at(-1)!;
		await retry.evaluate((node) => (node as HTMLButtonElement).click());
		await expect(draft).toHaveValue("");
		expect(requests.at(-1)!.requestId).toBe(original.requestId);
		expect(requests.at(-1)!.text).toBe(original.text);
	}
	await state("reset");
	questionCookies = await context.cookies();
});

test("C4 questionnaire full safe content, free/multi/notes/cancel, reader/takeover and terminal closure at 320px", async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 320, height: 700 });
	await pairQuestionnaire(page, context);
	const state = (action: string) =>
		context.request.post("/api/fixture/question", { data: { action } });
	await state("reload");
	await state("new");
	const list = await (await context.request.get("/api/snapshot")).json();
	const owner = list.sessions.find(
		(s: { session: string }) => s.session === "Browser test",
	);
	await chooseSession(page, owner.instance);
	await reviewQuestions(page);
	await page.getByText("Preview: Exact A", { exact: true }).click();
	await expect(page.getByText("Full preview A")).toBeVisible();
	await expect(
		page.getByRole("button", {
			name: "Submit questionnaire",
			includeHidden: true,
		}),
	).toBeEnabled();
	expect(
		await page
			.locator(
				'.questions script, .questions img, .questions a[href^="javascript:"]',
			)
			.count(),
	).toBe(0);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	const reader = await context.newPage();
	await reader.goto("/");
	await chooseSession(reader, owner.instance);

	await page
		.getByRole("group", { name: "Multi", exact: true })
		.getByText("Other responses", { exact: true })
		.click();
	await page
		.getByRole("button", { name: "Choose options for Multi", exact: true })
		.click();
	await state("invalid");
	await submitQuestionnaire(page);
	await expect(page.getByText(/Invalid reply — correct/)).toBeVisible();
	expect(
		(await (await state("invalid")).json()).replies.at(-1).answers,
	).toEqual([{ questionIndex: 1, kind: "multi", answer: null, selected: [] }]);
	await expect(
		reader.getByRole("button", {
			name: "Submit questionnaire",
			includeHidden: true,
		}),
	).toBeDisabled();
	await sidebarClick(reader, "Take over browser control");
	await state("accept");
	await expect(
		page.getByRole("button", {
			name: "Submit questionnaire",
			includeHidden: true,
		}),
	).toBeDisabled();
	await fillQuestionField(reader, "Free response for Single", "custom exact");
	await fillQuestionField(reader, "Optional note for Single", "question note");
	await selectQuestionOption(reader, "One");
	await selectQuestionOption(reader, "Two");
	await fillQuestionField(
		reader,
		"Optional questionnaire note",
		"global exact",
	);
	await submitQuestionnaire(reader);
	await expect(
		reader.getByText(
			/Answer completed — confirmed by live questionnaire callback/,
		),
	).toBeVisible();
	await expect(
		page.locator('form[aria-label="Pending questionnaire"]'),
	).toHaveCount(0);
	const replies = (await (await state("accept")).json()).replies;
	expect(replies.at(-1).answers).toEqual([
		{
			questionIndex: 0,
			kind: "custom",
			answer: "custom exact",
			notes: "question note",
		},
		{ questionIndex: 1, kind: "multi", answer: null, selected: ["One", "Two"] },
	]);
	expect(replies.at(-1).globalNote).toBe("global exact");
	await state("new");
	await expect(
		reader.getByRole("button", {
			name: "Cancel questionnaire",
			includeHidden: true,
		}),
	).toBeEnabled();
	await submitQuestionnaire(reader, true);
	await expect(
		reader.locator('form[aria-label="Pending questionnaire"]'),
	).toHaveCount(0);
	expect((await (await state("accept")).json()).replies.at(-1).cancelled).toBe(
		true,
	);
	await state("new");
	await expect(
		reader.locator('form[aria-label="Pending questionnaire"]'),
	).toHaveCount(1);
	await reader.close();
	await state("terminal");
	await expect(
		page.locator('form[aria-label="Pending questionnaire"]'),
	).toHaveCount(0);
	await state("reload");
	await state("new");
	// Oversize is local Not sent, and must replace the old generation's receipt owner.
	const oversizedPosts: string[] = [];
	page.on("request", (request) => {
		if (
			/\/api\/(control|question-reply)$/.test(request.url()) &&
			request.method() === "POST"
		)
			oversizedPosts.push(request.url());
	});
	await fillQuestionField(page, "Free response for Single", "字".repeat(8192));
	await fillQuestionField(page, "Optional note for Single", "字".repeat(8192));
	await fillQuestionField(
		page,
		"Optional questionnaire note",
		"字".repeat(8192),
	);
	await submitQuestionnaire(page);
	await expect(
		page.getByText(/Not sent — reply exceeds 65,536 bytes/),
	).toBeVisible();
	expect(oversizedPosts).toEqual([]);
	const freshGeneration = new URLSearchParams(new URL(page.url()).hash.slice(1))
		.get("session")!
		.split(":")[1];
	const receipt = page.locator(".questions .action-receipt");
	await receipt.getByText("Details", { exact: true }).click();
	await expect(
		receipt.getByText(`Generation ${freshGeneration}`, { exact: true }),
	).toBeVisible();
	await state("terminal");
	await state("reload");
});

test("C4 questionnaire invalid correction, immutable uncertain repeat versus edited fields, switch/restart/new pair, and old generation safety at 390px", async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await pairQuestionnaire(page, context);
	const state = (action: string) =>
		context.request.post("/api/fixture/question", { data: { action } });
	await state("reload");
	await state("new");
	const list = await (await context.request.get("/api/snapshot")).json();
	const owner = list.sessions.find(
		(s: { session: string }) => s.session === "Browser test",
	);
	const other = list.sessions.find(
		(s: { session: string }) => s.session === "Browser other",
	);
	await chooseSession(page, owner.instance);
	await state("invalid");
	await selectQuestionOption(page, "Exact B");
	await submitQuestionnaire(page);
	await expect(page.getByText(/Invalid reply — correct/)).toBeVisible();
	await expect(
		page.locator('form[aria-label="Pending questionnaire"]'),
	).toHaveCount(1);
	await state("lost");
	await fillQuestionField(
		page,
		"Free response for Single",
		"original immutable",
	);
	await submitQuestionnaire(page);
	await expect(
		page.getByRole("button", { name: "Repeat original questionnaire reply" }),
	).toBeEnabled();
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("separate text");
	await fillQuestionField(page, "Free response for Single", "edited not sent");
	await chooseSession(page, other.instance);
	await expect(
		page.getByRole("button", { name: "Repeat original questionnaire reply" }),
	).toBeDisabled();
	await chooseSession(page, owner.instance);
	await context.request.post("/api/fixture/restart");
	await expect(page.getByLabel("Pairing code")).toBeVisible();
	await page.waitForTimeout(1500);
	await expect(page.getByLabel("Pairing code")).toBeVisible();
	await page.getByLabel("Pairing code").fill(await freshCode());
	await page.getByLabel("Remember this device").uncheck();
	await page.getByRole("button", { name: "Pair this device" }).click();
	await expect(
		page.getByRole("button", { name: "Repeat original questionnaire reply" }),
	).toBeEnabled();
	await page.route(
		"**/api/control",
		async (route) => {
			await route.fetch();
			await route.abort();
		},
		{ times: 1 },
	);
	await page
		.getByRole("button", { name: "Repeat original questionnaire reply" })
		.click();
	await expect(
		page.getByText(/Uncertain — original completion unknown; repeat not sent/),
	).toBeVisible();
	const beforeTakeover = (await (await state("accept")).json()).replies.length;
	await sidebarClick(page, "Take over browser control");
	await expect(
		page.getByRole("button", { name: "Repeat original questionnaire reply" }),
	).toBeEnabled();
	expect((await (await state("accept")).json()).replies).toHaveLength(
		beforeTakeover,
	);
	await page
		.getByRole("button", { name: "Repeat original questionnaire reply" })
		.click();
	await expect(
		page.getByText(
			/Answer completed — confirmed by live questionnaire callback/,
		),
	).toBeVisible();
	const replies = (await (await state("accept")).json()).replies;
	expect(replies.at(-1).answers[0].answer).toBe("original immutable");
	expect(replies.at(-1).replyId).not.toBe(replies.at(-2).replyId);
	expect(replies.at(-1).invocationId).toBe(replies.at(-2).invocationId);
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveValue("separate text");
	await expect(
		page.locator('form[aria-label="Pending questionnaire"]'),
	).toHaveCount(0);
	await state("new");
	await state("lost");
	await expect(
		page.getByRole("button", {
			name: "Submit questionnaire",
			includeHidden: true,
		}),
	).toBeEnabled();
	await submitQuestionnaire(page);
	await expect(
		page.getByRole("button", { name: "Repeat original questionnaire reply" }),
	).toBeEnabled();
	await state("terminal");
	await state("new");
	await expect(
		page.getByRole("button", { name: "Repeat original questionnaire reply" }),
	).toBeDisabled();
	await state("reload");
	await state("new");
	await expect(
		page.getByRole("button", { name: "Repeat original questionnaire reply" }),
	).toBeDisabled();
	await state("terminal");
	await state("reload");
	questionCookies = await context.cookies();
});

test("C4 questionnaire lost accepted response never infers browser win, cannot repeat to another invocation, and retains text/image/Stop controls", async ({
	page,
	context,
}) => {
	await pairQuestionnaire(page, context);
	const state = (action: string) =>
		context.request.post("/api/fixture/question", { data: { action } });
	await state("reload");
	await state("new");
	const list = await (await context.request.get("/api/snapshot")).json();
	const owner = list.sessions.find(
		(s: { session: string }) => s.session === "Browser test",
	);
	await chooseSession(page, owner.instance);
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("untouched input");
	await page.getByLabel("Images for selected Pi (local picker)").setInputFiles({
		name: "question.png",
		mimeType: "image/png",
		buffer: png,
	});
	await selectQuestionOption(page, "Exact A");
	await page.route(
		"**/api/question-reply",
		async (route) => {
			await route.fetch();
			await route.abort();
		},
		{ times: 1 },
	);
	await submitQuestionnaire(page);
	await expect(
		page.getByText(/Uncertain — response lost or authority changed/),
	).toBeVisible();
	await expect(
		page.locator('form[aria-label="Pending questionnaire"]'),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Repeat original questionnaire reply" }),
	).toBeDisabled();
	expect(
		await page
			.getByText(/Answer completed — confirmed by live questionnaire callback/)
			.count(),
	).toBe(0);
	await state("new");
	await expect(
		page.locator('form[aria-label="Pending questionnaire"]'),
	).toHaveCount(1);
	await expect(
		page.getByRole("button", { name: "Repeat original questionnaire reply" }),
	).toBeDisabled();
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveValue("untouched input");
	await expect(
		page.getByRole("img", { name: "Local attachment preview" }),
	).toBeVisible();
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "work" },
	});
	await expect(
		page.getByRole("button", {
			name: "Stop",
			exact: true,
			includeHidden: true,
		}),
	).toBeEnabled();
	await page
		.getByRole("button", {
			name: "Dismiss uncertain questionnaire reply locally",
		})
		.click();
	await expect(
		page.getByRole("button", {
			name: "Submit questionnaire",
			includeHidden: true,
		}),
	).toBeEnabled();
	await state("terminal");
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "reset" },
	});
	await state("reload");
	questionCookies = await context.cookies();
});

test("C4 questionnaire delayed accepted response after owner switch cannot establish replacement/reclaimed success UI", async ({
	page,
	context,
}) => {
	await pairQuestionnaire(page, context);
	const state = (action: string) =>
		context.request.post("/api/fixture/question", { data: { action } });
	await state("reload");
	await state("new");
	const list = await (await context.request.get("/api/snapshot")).json();
	const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		),
		other = list.sessions.find(
			(s: { session: string }) => s.session === "Browser other",
		);
	await chooseSession(page, owner.instance);
	await selectQuestionOption(page, "Exact B");
	let release!: () => void, entered!: () => void;
	const ready = new Promise<void>((r) => (entered = r)),
		held = new Promise<void>((r) => (release = r));
	await page.route(
		"**/api/question-reply",
		async (route) => {
			const result = await route.fetch();
			entered();
			await held;
			await route.fulfill({ response: result });
		},
		{ times: 1 },
	);
	await submitQuestionnaire(page);
	await ready;
	await chooseSession(page, other.instance);
	release();
	await expect(
		page.getByText(/Uncertain — response lost or authority changed/),
	).toBeVisible();
	expect(
		await page
			.getByText(/Answer completed — confirmed by live questionnaire callback/)
			.count(),
	).toBe(0);
	await chooseSession(page, owner.instance);
	await expect(
		page.getByRole("button", { name: "Repeat original questionnaire reply" }),
	).toBeDisabled();
	await state("new");
	await expect(
		page.getByRole("button", { name: "Repeat original questionnaire reply" }),
	).toBeDisabled();
	await state("terminal");
	await state("reload");
});

for (const typed of [false, true]) {
	test(`C4 questionnaire Cancel omits unfinished option after ${typed ? "free response" : "fresh Choose options"} and preserves valid answers/notes`, async ({
		page,
		context,
	}) => {
		await pairQuestionnaire(page, context);
		const state = (action: string) =>
			context.request.post("/api/fixture/question", { data: { action } });
		await state("reload");
		const { question } = await (await state("new")).json();
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		await chooseSession(page, owner.instance);
		await expect(
			page.getByRole("button", {
				name: "Cancel questionnaire",
				includeHidden: true,
			}),
		).toBeEnabled();
		if (typed) {
			await fillQuestionField(
				page,
				"Free response for Single",
				"Not an authored option label",
			);
			await fillQuestionField(
				page,
				"Optional note for Single",
				"Preserve unfinished-option note",
			);
			await selectQuestionOption(page, "One");
			await fillQuestionField(
				page,
				"Optional note for Multi",
				"Preserve chosen-answer note",
			);
			await fillQuestionField(
				page,
				"Optional questionnaire note",
				"Preserve global note",
			);
		}
		await reviewQuestions(page);
		await page
			.getByRole("group", { name: "Single", exact: true })
			.getByText("Other responses", { exact: true })
			.click();
		await page
			.getByRole("button", { name: "Choose options for Single", exact: true })
			.click();
		await expect(page.getByLabel("Exact A", { exact: true })).not.toBeChecked();
		await expect(page.getByLabel("Exact B", { exact: true })).not.toBeChecked();
		const posted = page.waitForRequest((request) =>
			request.url().endsWith("/api/question-reply"),
		);
		await submitQuestionnaire(page, true);
		const reply = (await posted).postDataJSON().reply;
		// The fixture is permissive: assert the exact public payload, not merely its accepted closure.
		expect(reply).toEqual({
			invocationId: question.invocationId,
			replyId: expect.stringMatching(/^[a-f0-9]{32}$/),
			cancelled: true,
			answers: typed
				? [
						{
							questionIndex: 0,
							kind: "custom",
							answer: null,
							notes: "Preserve unfinished-option note",
						},
						{
							questionIndex: 1,
							kind: "multi",
							answer: null,
							selected: ["One"],
							notes: "Preserve chosen-answer note",
						},
					]
				: [],
			...(typed ? { globalNote: "Preserve global note" } : {}),
		});
		await expect(
			page.locator('form[aria-label="Pending questionnaire"]'),
		).toHaveCount(0);
		const selected = await (
			await context.request.get(
				`/api/snapshot?instance=${owner.instance}&generation=${owner.generation}`,
			)
		).json();
		expect(selected.questions.pending).toEqual([]);
		// Authored null and empty string are distinct; prove the complete browser-to-public-bus payload too.
		expect((await (await state("accept")).json()).replies.at(-1)).toEqual(
			reply,
		);
		await state("reload");
	});
}

for (const width of [320, 390])
	test(`compact conversation-first layout and visible safety at ${width}px`, async ({
		page,
		context,
	}, testInfo) => {
		await page.setViewportSize({ width, height: width === 320 ? 740 : 844 });
		await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
		await pairQuestionnaire(page, context);
		const state = (action: string) =>
			context.request.post("/api/fixture/stop-state", { data: { action } });
		const question = (action: string) =>
			context.request.post("/api/fixture/question", { data: { action } });
		await question("reload");
		await state("reset");
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		const other = list.sessions.find(
			(s: { session: string }) => s.session === "Browser other",
		);
		await chooseSession(page, owner.instance);
		const article = page.locator("article").first(),
			composer = page.getByRole("region", { name: "Browser text input" });
		await expect(article).toContainText("Owner A");
		await expect(
			page.getByRole("region", { name: "Supported questionnaires" }),
		).toBeHidden();
		const geometry = async () =>
			page.evaluate(() => {
				const rect = (selector: string) => {
					const node = document.querySelector(selector)!;
					const r = node.getBoundingClientRect();
					return {
						top:
							r.top + scrollY + (node.closest(".chat-scroll")?.scrollTop ?? 0),
						height: r.height,
						width: r.width,
					};
				};
				return {
					header: rect("header"),
					firstArticle: rect("article"),
					composer: rect(".composer"),
					overflow: document.documentElement.scrollWidth > innerWidth,
				};
			});
		const checkLayout = async () => {
			const measured = await geometry();
			expect(measured.firstArticle.top).toBeLessThanOrEqual(430);
			expect(measured.composer.height).toBeLessThanOrEqual(400);
			expect(measured.overflow).toBe(false);
			expect(measured.composer.top).toBeGreaterThan(measured.firstArticle.top);
			for (const selector of ["header button", ".composer button:visible"]) {
				for (const target of await page.locator(selector).all()) {
					const box = (await target.boundingBox())!;
					expect(box.height).toBeGreaterThanOrEqual(44);
					expect(box.width).toBeGreaterThanOrEqual(44);
				}
			}
			for (const selector of [".sessions-toggle", "#draft", "#attachment"])
				expect(
					await page
						.locator(selector)
						.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
				).toBeGreaterThanOrEqual(16);
			return measured;
		};
		const readonly = await checkLayout();
		await expect(
			page.getByRole("button", {
				name: "Stop",
				exact: true,
				includeHidden: true,
			}),
		).toBeDisabled();

		await page
			.getByLabel("Text for selected Pi (local draft)")
			.fill("Compact deliberate acquisition");
		await page
			.getByRole("button", {
				name: /^(Send|Steer)$/,
				exact: true,
				includeHidden: true,
			})
			.click();

		await expect(
			page.getByLabel("Text for selected Pi (local draft)"),
		).toHaveValue("");
		const controlled = await checkLayout();
		await page.getByLabel("Text for selected Pi (local draft)").focus();
		await page.keyboard.type("Synthetic phone feedback");
		await expect(
			page.getByLabel("Text for selected Pi (local draft)"),
		).toBeFocused();
		expect(
			await page.locator(".composer-bar").evaluate((node) => {
				const style = getComputedStyle(node);
				return { width: style.outlineWidth, style: style.outlineStyle };
			}),
		).toEqual({ width: "2px", style: "solid" });
		await page
			.getByLabel("Images for selected Pi (local picker)")
			.setInputFiles({
				name: "compact.png",
				mimeType: "image/png",
				buffer: png,
			});
		await expect(
			page.getByRole("img", { name: "Local attachment preview" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /^Remove image/ }),
		).toBeVisible();
		await expect(
			page.getByRole("button", {
				name: /^(Send|Steer)$/,
				exact: true,
				includeHidden: true,
			}),
		).toBeEnabled();
		expect((await geometry()).firstArticle.top).toBeLessThanOrEqual(430);
		const { writeFile } = await import("node:fs/promises");
		await page.evaluate(() => scrollTo(0, 0));
		await page.screenshot({
			path: testInfo.outputPath(
				`${testInfo.project.name}-${width}-controlled-light.png`,
			),
			fullPage: true,
		});
		await page.emulateMedia({ colorScheme: "dark" });
		await page.screenshot({
			path: testInfo.outputPath(
				`${testInfo.project.name}-${width}-controlled-dark.png`,
			),
			fullPage: true,
		});
		const attachment = await geometry();
		await writeFile(
			testInfo.outputPath(`${testInfo.project.name}-${width}-geometry.json`),
			JSON.stringify({ readonly, controlled, attachment }, null, 2),
		);
		await state("work");
		await expect(
			page.getByRole("button", {
				name: "Stop",
				exact: true,
				includeHidden: true,
			}),
		).toBeEnabled();
		const stopBox = (await page
			.getByRole("button", { name: "Stop", exact: true, includeHidden: true })
			.boundingBox())!;
		expect(stopBox.y).toBeGreaterThanOrEqual((await composer.boundingBox())!.y);
		expect(
			(await page.locator("header").boundingBox())!.height,
		).toBeLessThanOrEqual(90);
		await question("new");
		const pending = page.locator('form[aria-label="Pending questionnaire"]');
		await expect(pending).toBeHidden();
		await reviewQuestions(page);
		await expect(pending).toBeVisible();
		await expect(
			page.getByRole("button", {
				name: "Submit questionnaire",
				includeHidden: true,
			}),
		).toBeEnabled(); // Not gated on parent idle.
		expect((await pending.boundingBox())!.y).toBeGreaterThan(
			(await article.boundingBox())!.y,
		);
		expect(await pending.locator("xpath=ancestor::details").count()).toBe(1);
		await page.route(
			"**/api/question-reply",
			async (route) => {
				await route.fetch();
				await route.abort();
			},
			{ times: 1 },
		);
		await submitQuestionnaire(page);
		await expect(pending).toHaveCount(0);
		await expect(
			page.getByText(/Uncertain — response lost or authority changed/),
		).toBeVisible();
		await expect(
			page.getByRole("region", { name: "Supported questionnaires" }),
		).toBeVisible();
		expect(
			await page
				.getByRole("region", { name: "Supported questionnaires" })
				.locator("xpath=ancestor::details")
				.count(),
		).toBe(0);
		await chooseSession(page, other.instance);
		await expect(article).toContainText("Owner B");
		await context.request.post("/api/fixture/disconnect");
		await expect(
			page.getByLabel("Text for selected Pi (local draft)"),
		).toHaveAccessibleDescription(/Disconnected — cached content is read-only/);
		await expect(article).toContainText("Owner B");
		await expect(
			page.getByRole("button", { name: /^Open sessions:/ }),
		).toContainText("Browser other");
		await expect(
			page.locator("header").getByText("Unavailable", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", {
				name: /^(Send|Steer)$/,
				exact: true,
				includeHidden: true,
			}),
		).toBeDisabled();
		await expect(
			page.getByRole("button", {
				name: "Stop",
				exact: true,
				includeHidden: true,
			}),
		).toBeDisabled();
		await expect(
			page.getByRole("button", { name: "Repeat original questionnaire reply" }),
		).toBeDisabled();
		const overflow = await page.evaluate(() => ({
			width: innerWidth,
			document: document.documentElement.scrollWidth,
			nodes: [...document.querySelectorAll("*")]
				.filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
				.map((node) => ({
					tag: node.tagName,
					className: node.className,
					width: node.getBoundingClientRect().width,
				})),
		}));
		expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(
			overflow.width,
		);
		await context.request.post("/api/fixture/restore");
		await state("reset");
		await question("reload");
	});

test.describe("I3 slash composer", () => {
	test.use({ hasTouch: true });
	test("I3 slash selected catalog, prefix keyboard/touch selection and raw idle execution at mobile widths", async ({
		page,
		context,
	}) => {
		await pairQuestionnaire(page, context);
		const state = (action: string) =>
			context.request.post("/api/fixture/stop-state", { data: { action } });
		await state("reset");
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		await chooseSession(page, owner.instance);
		const selected = await (
			await context.request.get(
				`/api/snapshot?instance=${owner.instance}&generation=${owner.generation}`,
			)
		).json();
		expect(selected.snapshot.commands).toEqual([
			{
				name: "review",
				description: "Review a controlled diff",
				source: "prompt",
			},
			{
				name: "revise",
				description: "Revise controlled text",
				source: "prompt",
			},
			{
				name: "skill:fixture",
				description: "Controlled skill",
				source: "skill",
			},
			{
				name: "terminal",
				description: "Controlled extension UI",
				source: "extension",
			},
		]);
		expect(JSON.stringify(selected.snapshot.commands)).not.toMatch(
			/sourceInfo|private|path/,
		);
		const draft = page.getByLabel("Text for selected Pi (local draft)");
		const requests: string[] = [];
		page.on("request", (req) => {
			if (/\/api\/(control|text|image)$/.test(req.url()))
				requests.push(req.url());
		});
		const before = (
			await (await context.request.get("/api/fixture/dispatches")).json()
		).dispatches;
		for (const width of [320, 390]) {
			await page.setViewportSize({ width, height: 844 });
			await draft.fill('/re  "raw args"  tail');
			await expect(page.getByRole("option")).toHaveCount(2);
			await draft.dispatchEvent("keydown", { key: "Enter", isComposing: true });
			await draft.dispatchEvent("keydown", { key: "Enter", repeat: true });
			await expect(draft).toHaveValue('/re  "raw args"  tail');
			await draft.press("ArrowDown");
			await expect(
				page.getByRole("option", { name: /\/revise/ }),
			).toHaveAttribute("aria-selected", "true");
			await draft.press("ArrowUp");
			await draft.press(width === 320 ? "Enter" : "Tab");
			await expect(draft).toHaveValue('/review  "raw args"  tail');
			await expect(draft).toBeFocused();
			await expect(page.getByRole("listbox")).toHaveCount(0);
			expect(requests).toEqual([]); // Selection never submits or claims control.
			await draft.fill("/");
			await expect(page.getByRole("option")).toHaveCount(3);
			await expect(page.locator("#composer-availability")).toHaveClass(
				"visually-hidden",
			);
			await expect(page.locator("#composer-availability")).toBeEmpty();
			for (const height of [844, 300]) {
				await page.setViewportSize({ width, height });
				await page.waitForFunction(
					() =>
						Math.abs(
							document.querySelector("main")!.getBoundingClientRect().height -
								window.visualViewport!.height,
						) < 1,
				);
				const popup = page.getByRole("listbox", {
					name: "Selected Pi slash commands",
				});
				await popup.evaluate((node) => {
					node.scrollTop = 0;
				});
				const listStyle = await popup.evaluate((node) => {
					const selected = node.querySelector('[aria-selected="true"]')!;
					const row = getComputedStyle(selected);
					return {
						background: row.backgroundColor,
						canvas: getComputedStyle(node).backgroundColor,
						border: row.borderTopWidth,
						radius: getComputedStyle(node).borderTopLeftRadius,
						descriptionLines:
							selected.querySelector("span")!.getBoundingClientRect().height /
							parseFloat(
								getComputedStyle(selected.querySelector("span")!).lineHeight,
							),
					};
				});
				expect(listStyle.background).not.toBe(listStyle.canvas);
				expect(listStyle.border).toBe("0px");
				expect(parseFloat(listStyle.radius)).toBeGreaterThan(0);
				expect(listStyle.descriptionLines).toBeCloseTo(1, 1);
				await expect(popup.locator("small")).toHaveCount(0);
				const popupBox = (await popup.boundingBox())!;
				const editorBox = (await draft.boundingBox())!;
				expect(popupBox.y).toBeGreaterThanOrEqual(0);
				expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(editorBox.y);
				await expect
					.poll(() =>
						page
							.getByRole("option")
							.first()
							.evaluate((node) => {
								const box = node.getBoundingClientRect();
								return node.contains(
									document.elementFromPoint(
										box.x + box.width / 2,
										box.y + Math.min(22, box.height / 2),
									),
								);
							}),
					)
					.toBe(true);
			}
			await page.getByRole("option").first().tap();
			await expect(draft).toHaveValue("/review ");
			await expect(draft).toBeFocused();
			expect(requests).toEqual([]);
			await draft.fill("/");
			await page.setViewportSize({ width, height: 844 });
			await expect(
				page.getByRole("option", { name: /\/terminal/ }),
			).toHaveCount(0);
			await draft.press("Escape");
			await expect(page.getByRole("listbox")).toHaveCount(0);
			await draft.fill("/skill:");
			const skill = page.getByRole("option", { name: /\/skill:fixture/ });
			const box = (await skill.boundingBox())!;
			expect(box.height).toBeGreaterThanOrEqual(44);
			expect(box.width).toBeGreaterThanOrEqual(44);
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(width);
			await skill.tap();
			await expect(draft).toHaveValue("/skill:fixture ");
			await expect(draft).toBeFocused();
			expect(requests).toEqual([]);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
		}
		await draft.fill("idle newline");
		await draft.press("Shift+Enter");
		await draft.dispatchEvent("keydown", { key: "Enter", isComposing: true });
		await draft.dispatchEvent("keydown", { key: "Enter", repeat: true });
		await expect(draft).toHaveValue("idle newline\n");
		expect(requests).toEqual([]);
		for (const text of [
			'/review  "raw args"  tail',
			"/skill:fixture  authored",
			"normal authored",
		]) {
			await draft.fill(text);
			await draft.press("Escape");
			if (text === "normal authored") await draft.press("Enter");
			else
				await page
					.getByRole("button", { name: /^(Send|Steer)$/, exact: true })
					.click();

			await expect(draft).toHaveValue("");
			expect(
				(await (await context.request.get("/api/fixture/dispatches")).json())
					.lastText,
			).toEqual({
				text,
				options: { expandPromptTemplates: text.startsWith("/") },
			});
		}
		expect(
			(await (await context.request.get("/api/fixture/dispatches")).json())
				.dispatches,
		).toBe(before + 3);
		expect(
			await page.evaluate(() => localStorage.length + sessionStorage.length),
		).toBe(0);
		await state("reset");
		questionCookies = await context.cookies();
	});

	test("I3 slash unsupported drafts make zero claims/posts; absent selected catalog and delayed selection fail closed", async ({
		page,
		context,
	}) => {
		await pairQuestionnaire(page, context);
		const state = (action: string) =>
			context.request.post("/api/fixture/stop-state", { data: { action } });
		await state("reset");
		await context.request.post("/api/fixture/restore");
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		const other = list.sessions.find(
			(s: { session: string }) => s.session === "Browser other",
		);
		await chooseSession(page, owner.instance);
		const draft = page.getByLabel("Text for selected Pi (local draft)");
		const controls: string[] = [],
			inputs: string[] = [];
		page.on("request", (req) => {
			if (req.url().endsWith("/api/control"))
				controls.push(req.postDataJSON().action);
			if (/\/api\/(text|image)$/.test(req.url())) inputs.push(req.url());
		});
		const before = (
			await (await context.request.get("/api/fixture/dispatches")).json()
		).dispatches;
		for (const text of [
			"/unknown",
			"/new",
			"/reload",
			"/model",
			"/terminal",
			" /review",
			"/review\targs",
		]) {
			await draft.fill(text);
			await expect(
				page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
			).toBeDisabled();
			if (["/new", "/reload", "/model"].includes(text)) {
				await expect(
					page
						.locator(".composer")
						.getByText("Command not available in this Pi session.", {
							exact: true,
						}),
				).toBeVisible();
				await draft.press("Escape");
				await draft.press("Enter");
			}
		}
		expect(controls).toEqual([]);
		expect(inputs).toEqual([]);
		await draft.fill("/review args");
		await page
			.getByLabel("Images for selected Pi (local picker)")
			.setInputFiles({ name: "slash.png", mimeType: "image/png", buffer: png });
		await expect(
			page.locator(".composer").getByText(/Remove images to use a command/),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
		).toBeDisabled();
		await expect(
			page.getByRole("img", { name: "Local attachment preview" }),
		).toBeVisible();
		await page.getByRole("button", { name: /^Remove image/ }).click();
		await state("work");
		await expect(
			page.locator("header").getByText("Pi is working", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
		).toBeDisabled();
		await expect(
			page.getByRole("button", { name: "Follow-up", exact: true }),
		).toHaveCount(0);
		await expect(
			page
				.locator(".composer")
				.getByText(/Commands are available when Pi is idle/),
		).toBeVisible();
		await draft.press("Escape");
		await draft.press("Enter");
		await draft.press("Alt+Enter");
		await draft.fill("normal busy authored");
		await expect(
			page.getByRole("combobox", { name: "Busy delivery mode" }),
		).toBeEnabled();
		await state("idle");
		await chooseSession(page, other.instance);
		await draft.fill("/review other");
		await expect(page.getByRole("listbox")).toHaveCount(0);
		await expect(
			page
				.locator(".composer")
				.getByText(/Commands unavailable\. Reload the bridge in Pi/),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
		).toBeDisabled();
		await draft.fill("normal idle authored");
		await expect(
			page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
		).toBeEnabled();
		expect(controls).toEqual([]);
		expect(inputs).toEqual([]);
		await chooseSession(page, owner.instance);
		await draft.fill("/review captured");
		await draft.press("Escape");
		await expect(
			page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
		).toBeEnabled();
		let releaseClaim!: () => void, seenClaim!: () => void;
		const ready = new Promise<void>((resolve) => {
			seenClaim = resolve;
		});
		const release = new Promise<void>((resolve) => {
			releaseClaim = resolve;
		});
		await page.route(
			"**/api/control",
			async (route) => {
				if (route.request().postDataJSON().action !== "claim") {
					await route.continue();
					return;
				}
				const response = await route.fetch();
				seenClaim();
				await release;
				await route.fulfill({ response });
			},
			{ times: 1 },
		);
		await page
			.getByRole("button", { name: /^(Send|Steer)$/, exact: true })
			.click();
		await ready;
		await chooseSession(page, other.instance);
		releaseClaim();
		await expect(
			page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
		).toBeEnabled();
		expect(inputs).toEqual([]);
		expect(
			(await (await context.request.get("/api/fixture/dispatches")).json())
				.dispatches,
		).toBe(before);
		await chooseSession(page, owner.instance);
		await expect(draft).toHaveValue("/review captured");
		await chooseSession(page, other.instance);
		await draft.fill("/review disconnected");
		await context.request.post("/api/fixture/disconnect");
		await expect(
			page.locator("header").getByText("Unavailable", { exact: true }),
		).toBeVisible();
		await expect(page.getByRole("listbox")).toHaveCount(0);
		await expect(
			page.getByRole("button", {
				name: /^(Send|Steer)$/,
				exact: true,
				includeHidden: true,
			}),
		).toBeDisabled();
		await expect(draft).toHaveValue("/review disconnected");
		await context.request.post("/api/fixture/restore");
		await expect(
			page.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible();
		expect(inputs).toEqual([]);
		expect(controls.filter((action) => action === "claim")).toHaveLength(1);
		await state("reset");
		questionCookies = await context.cookies();
	});
});

test.describe("Native slash browser controls", () => {
	test.use({ hasTouch: true });
	test.afterEach(async ({ context }) => {
		await context.request.post("/api/fixture/native-state", {
			data: { action: "disable" },
		});
	});
	test("native model picker edits only the draft, then Send uses control and native dispatch at phone widths", async ({
		page,
		context,
	}) => {
		await pairQuestionnaire(page, context);
		await context.request.post("/api/fixture/native-state", {
			data: { action: "enable" },
		});
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		await chooseSession(page, owner.instance);
		const draft = page.getByLabel("Text for selected Pi (local draft)");
		const mutations: string[] = [];
		page.on("request", (req) => {
			if (
				/\/api\/(control|text|image)$/.test(req.url()) &&
				!(
					req.url().endsWith("/api/control") &&
					req.postDataJSON().action === "release"
				)
			)
				mutations.push(req.url());
		});
		for (const width of [320, 390]) {
			await page.setViewportSize({ width, height: 844 });
			await draft.fill("/mo");
			const suggestion = page.getByRole("option", { name: /\/model/ });
			await expect(suggestion).toContainText("Choose a model in the browser");
			await expect(suggestion.locator("small")).toHaveCount(0);
			await expect(page.locator("#composer-availability")).toHaveClass(
				"visually-hidden",
			);
			await expect(page.locator("#composer-availability")).toBeEmpty();
			const popup = (await page.getByRole("listbox").boundingBox())!;
			const input = (await draft.boundingBox())!;
			expect(popup.y + popup.height).toBeLessThanOrEqual(input.y);
			expect((await suggestion.boundingBox())!.height).toBeGreaterThanOrEqual(
				44,
			);
			if (width === 320) await draft.press("Enter");
			else await suggestion.tap();
			const dialog = page.getByRole("dialog", { name: "Choose Pi model" });
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole("radio")).toHaveCount(20);
			expect(mutations).toEqual([]);
			const second = dialog.getByRole("radio", { name: /fixture\/second/ });
			await dialog.getByRole("radio").first().focus();
			await dialog.getByRole("radio").first().press("ArrowDown");
			await expect(second).toBeChecked();
			await expect(second).toBeFocused();
			const secondRow = dialog.locator(".model-option").filter({
				has: page.getByRole("radio", { name: /fixture\/second/ }),
			});
			// The browser decides when radio focus needs a visible indicator.
			const visibleFocus = await second.evaluate((node) =>
				node.matches(":focus-visible"),
			);
			await expect(secondRow).toHaveCSS(
				"outline-style",
				visibleFocus ? "solid" : "none",
			);
			await expect(secondRow.locator("svg")).toBeVisible();
			await expect(
				dialog.locator(".model-option").first().locator("svg"),
			).toBeHidden();
			for (const height of [844, 300]) {
				await page.setViewportSize({ width, height });
				await page.waitForFunction(
					() =>
						Math.abs(
							document.querySelector("main")!.getBoundingClientRect().height -
								window.visualViewport!.height,
						) < 1,
				);
				const box = (await dialog.boundingBox())!;
				expect(box.x).toBeGreaterThanOrEqual(0);
				expect(box.x + box.width).toBeLessThanOrEqual(width);
				expect(box.y).toBeGreaterThanOrEqual(0);
				expect(box.y + box.height).toBeLessThanOrEqual(height);
				await expect(
					dialog.getByRole("button", { name: "Cancel" }),
				).toBeInViewport();
				await expect(
					dialog.getByRole("button", { name: "Use model" }),
				).toBeInViewport();
			}
			const models = dialog.getByRole("radiogroup", {
				name: "Available models",
			});
			expect(
				await models.evaluate((node) => node.scrollHeight > node.clientHeight),
			).toBe(true);
			const last = dialog.getByRole("radio", { name: /fixture\/extra-20/ });
			const row = dialog.locator(".model-option").filter({
				has: page.getByRole("radio", { name: /fixture\/extra-20/ }),
			});
			await row.scrollIntoViewIfNeeded();
			expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
			await row.tap();
			await expect(last).toBeChecked();
			await expect(
				dialog.getByRole("button", { name: "Use model" }),
			).toBeInViewport();
			await secondRow.scrollIntoViewIfNeeded();
			await secondRow.tap();
			await expect(second).toBeChecked();
			await expect(row.locator("svg")).toBeHidden();
			await dialog.getByRole("button", { name: "Use model" }).tap();
			await expect(dialog).toBeHidden();
			await expect(draft).toHaveValue("/model fixture/second");
			expect(mutations).toEqual([]);
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await page.getByRole("button", { name: "Send", exact: true }).tap();
		await expect(draft).toHaveValue("");
		await expect
			.poll(
				async () =>
					(await (await context.request.get("/api/fixture/dispatches")).json())
						.nativeRequests,
			)
			.toEqual(["/model fixture/second"]);
		expect(
			mutations.filter((url) => url.endsWith("/api/control")),
		).toHaveLength(1);
		expect(mutations.filter((url) => url.endsWith("/api/text"))).toHaveLength(
			1,
		);
		const observed = await (
			await context.request.get("/api/fixture/dispatches")
		).json();
		const modelRequests = observed.nativeRequests.length;
		await context.request.post("/api/fixture/native-state", {
			data: { action: "draft", text: "terminal draft" },
		});
		await draft.fill("/new");
		await draft.press("Escape");
		await page.getByRole("button", { name: "Send", exact: true }).tap();
		await expect(
			page.getByText(/Clear or send the unsent draft in the Pi terminal first/),
		).toBeVisible();
		await expect(draft).toHaveValue("/new");
		expect(
			(await (await context.request.get("/api/fixture/dispatches")).json())
				.nativeRequests,
		).toHaveLength(modelRequests);
	});
	test("reload feedback requires a native reload observation, expires, and does not replay on refresh or other generation changes", async ({
		page,
		context,
	}) => {
		await pairQuestionnaire(page, context);
		await context.request.post("/api/fixture/native-state", {
			data: { action: "enable" },
		});
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		await chooseSession(page, owner.instance);
		const draft = page.getByLabel("Text for selected Pi (local draft)");
		const feedback = page
			.locator(".composer")
			.getByText("Pi reloaded", { exact: true });
		const attempts: string[] = [];
		page.on("request", (req) => {
			if (req.url().endsWith("/api/text"))
				attempts.push(req.postDataJSON().text);
		});
		await draft.fill("/reload");
		await draft.press("Escape");
		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(draft).toHaveValue("");
		await expect(feedback).toHaveCount(0); // Dispatch is not completion.
		await context.request.post("/api/fixture/question", {
			data: { action: "reload" },
		});
		await expect(feedback).toBeVisible();
		await expect(feedback).toHaveAttribute("role", "status");
		await expect(feedback).toHaveCount(0, { timeout: 7000 });
		await page.reload();
		await expect(
			page.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible();
		await expect(feedback).toHaveCount(0); // Existing reload metadata is not a new event.
		const beforeReset = new URL(page.url()).hash;
		await context.request.post("/api/fixture/stop-state", {
			data: { action: "reset" },
		});
		await expect.poll(() => new URL(page.url()).hash).not.toBe(beforeReset);
		await expect(feedback).toHaveCount(0);
		await context.request.post("/api/fixture/question", {
			data: { action: "reload" },
		});
		await expect(feedback).toBeVisible(); // A terminal-initiated reload also gives feedback.
		const other = list.sessions.find(
			(s: { session: string }) => s.session === "Browser other",
		);
		await chooseSession(page, other.instance);
		await expect(feedback).toHaveCount(0);
		await chooseSession(page, owner.instance);
		await expect(feedback).toHaveCount(0);
		expect(attempts).toEqual(["/reload"]);
	});
	test("uncertain native reload is never retried across generation recovery; dismiss sends nothing and picker cancels on replacement", async ({
		page,
		context,
	}) => {
		await pairQuestionnaire(page, context);
		await context.request.post("/api/fixture/native-state", {
			data: { action: "enable" },
		});
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		await chooseSession(page, owner.instance);
		const draft = page.getByLabel("Text for selected Pi (local draft)");
		const attempts: string[] = [],
			claims: string[] = [];
		page.on("request", (req) => {
			if (req.url().endsWith("/api/text"))
				attempts.push(req.postDataJSON().text);
			if (
				req.url().endsWith("/api/control") &&
				req.postDataJSON().action === "claim"
			)
				claims.push(req.url());
		});
		await page.route(
			"**/api/text",
			async (route) => {
				await route.fetch();
				await route.abort("failed");
			},
			{ times: 1 },
		);
		await draft.fill("/reload");
		await draft.press("Escape");
		await page.getByRole("button", { name: "Send", exact: true }).click();
		const dismiss = page.getByRole("button", {
			name: "Dismiss command receipt without retrying",
		});
		await expect(dismiss).toBeEnabled();
		await expect(
			page.getByRole("button", { name: "Retry same outstanding input" }),
		).toHaveCount(0);
		await context.request.post("/api/fixture/question", {
			data: { action: "reload" },
		});
		await expect
			.poll(() =>
				new URLSearchParams(new URL(page.url()).hash.slice(1)).get("session"),
			)
			.not.toBe(`${owner.instance}:${owner.generation}`);
		await expect(dismiss).toBeEnabled();
		await dismiss.click();
		expect(attempts).toEqual(["/reload"]);
		expect(claims).toHaveLength(1);
		await draft.fill("/model");
		await draft.press("Escape");
		await page.getByRole("button", { name: "Send", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Choose Pi model" });
		await expect(dialog).toBeVisible();
		await context.request.post("/api/fixture/question", {
			data: { action: "reload" },
		});
		await expect(dialog).toBeHidden();
		expect(attempts).toEqual(["/reload"]);
		expect(claims).toHaveLength(1);
		await page.reload();
		await expect(
			page.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible();
		expect(attempts).toEqual(["/reload"]);
		expect(claims).toHaveLength(1);
	});
});

test.describe("I2 native touch input", () => {
	test.use({ hasTouch: true });
	test("I2 busy text repeated requests, local attachment guard and accessible mobile controls", async ({
		page,
		context,
	}) => {
		await pairQuestionnaire(page, context);
		const state = (action: string) =>
			context.request.post("/api/fixture/stop-state", { data: { action } });
		await state("reset");
		await state("work");
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		const other = list.sessions.find(
			(s: { session: string }) => s.session === "Browser other",
		);
		await chooseSession(page, owner.instance);
		const before = (
			await (await context.request.get("/api/fixture/dispatches")).json()
		).dispatches;
		const requests: Record<string, string>[] = [];
		const mutations: string[] = [];
		page.on("request", (req) => {
			if (
				/\/api\/(control|text|image)$/.test(req.url()) &&
				!(
					req.url().endsWith("/api/control") &&
					req.postDataJSON().action === "release"
				)
			)
				mutations.push(req.url());
			if (/\/api\/(text|image)$/.test(req.url()))
				requests.push(req.postDataJSON());
		});
		const draft = page.getByLabel("Text for selected Pi (local draft)");
		const send = page.locator(".send-button");
		const mode = page.getByRole("combobox", { name: "Busy delivery mode" });
		for (const width of [320, 390]) {
			await page.setViewportSize({ width, height: 844 });
			await expect(mode).toHaveValue("steer");
			await expect(page.locator(".send-options")).toHaveCount(0);
			await expect(send.locator("svg")).toBeVisible();
			await expect(send).toHaveText("");
			await draft.fill("image stays local");
			const count = mutations.length;
			await page
				.getByLabel("Images for selected Pi (local picker)")
				.setInputFiles({
					name: "busy.png",
					mimeType: "image/png",
					buffer: png,
				});
			await expect(send).toBeDisabled();
			await expect(mode).toBeDisabled();
			await expect(draft).toHaveAccessibleDescription(/images stay local/);
			await expect(page.locator("#composer-availability")).toHaveClass(
				"visually-hidden",
			);
			await draft.press("Enter");
			await draft.press("Alt+Enter");
			expect(mutations).toHaveLength(count);
			await page.getByRole("button", { name: /^Remove image/ }).click();
			await mode.selectOption("followUp");
			await expect(send).toHaveAccessibleName("Send Follow-up");
			const followUpWidth = (await mode.boundingBox())!.width;
			expect(mutations).toHaveLength(count);
			await draft.dispatchEvent("keydown", { key: "Enter", isComposing: true });
			await draft.dispatchEvent("keydown", { key: "Enter", repeat: true });
			await draft.press("Shift+Enter");
			await expect(draft).toHaveValue("image stays local\n");
			expect(mutations).toHaveLength(count);
			await mode.selectOption("steer");
			const steerBox = (await mode.boundingBox())!;
			expect(steerBox.width).toBeGreaterThanOrEqual(44);
			expect(steerBox.height).toBeGreaterThanOrEqual(44);
			expect(followUpWidth - steerBox.width).toBeGreaterThan(10);
			for (const [action, delivery] of [
				["default", "steer"],
				["selected-enter", "followUp"],
				["selected-tap", "followUp"],
				["alt-enter", "followUp"],
			] as const) {
				const text =
					action === "default"
						? "A long browser request.\n".repeat(20).trim()
						: `${action} ${width}`;
				await draft.fill(text);
				const count = mutations.length;
				if (action === "selected-enter") {
					await mode.focus();
					await mode.press("f"); // Native select type-ahead works in both engines.
					await mode.press("Enter");
					await expect(mode).toHaveValue("followUp");
					await expect(mode).toBeFocused();
				}
				if (action === "alt-enter") await mode.selectOption("steer");
				expect(mutations).toHaveLength(count);
				if (action === "selected-enter") await draft.press("Enter");
				else if (action === "alt-enter") await draft.press("Alt+Enter");
				else if (action === "default" && width === 320) {
					// Model the keyboard closing on native editor blur. Pointer release
					// stays at the original Send coordinates, as on a real phone.
					await draft.evaluate((node) => {
						const viewport = window.visualViewport!;
						Object.defineProperty(viewport, "height", {
							configurable: true,
							value: 300,
						});
						node.addEventListener(
							"blur",
							() => {
								Object.defineProperty(viewport, "height", {
									configurable: true,
									value: 844,
								});
								viewport.dispatchEvent(new Event("resize"));
							},
							{ once: true },
						);
						node.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
					});
					await expect
						.poll(() =>
							page
								.locator("main")
								.evaluate((node) => node.getBoundingClientRect().height),
						)
						.toBe(300);
					const box = (await send.boundingBox())!;
					await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
					await page.mouse.down();
					await page.mouse.move(box.x - 20, box.y - 30);
					await page.mouse.up();
					await expect(draft).toBeFocused();
					await expect(draft).toHaveValue(text);
					expect(mutations).toHaveLength(count);
					await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
					await page.mouse.down();
					// iOS can still perform compatibility-mouse focus after a canceled
					// pointerdown (WebKit 316402). Exercise that distinct default action.
					await send.evaluate((node) => {
						const down = new MouseEvent("mousedown", {
							bubbles: true,
							cancelable: true,
							button: 0,
						});
						if (node.dispatchEvent(down)) (node as HTMLButtonElement).focus();
					});
					await page.evaluate(
						() =>
							new Promise<void>((resolve) =>
								requestAnimationFrame(() =>
									requestAnimationFrame(() => resolve()),
								),
							),
					);
					await page.mouse.up();
				} else if (action === "selected-tap") {
					await draft.focus();
					await send.tap();
				} else await send.click();
				await expect(draft).toHaveValue("");
				await expect(draft).not.toBeFocused();
				await expect(mode).toHaveValue(
					action === "selected-enter" || action === "selected-tap"
						? "followUp"
						: "steer",
				);
				const inspected = mutations.length;
				await expectBusyReceipt(
					page,
					delivery === "steer"
						? "Steering requested (completion unconfirmed)"
						: "Follow-up requested (completion unconfirmed)",
					text,
				);
				expect(mutations).toHaveLength(inspected);
				expect(
					(await (await context.request.get("/api/fixture/dispatches")).json())
						.lastText,
				).toEqual({
					text,
					options: { expandPromptTemplates: false, deliverAs: delivery },
				});
				if (action === "default" && width === 320)
					await page.evaluate(() => {
						Reflect.deleteProperty(window.visualViewport!, "height");
						window.dispatchEvent(new Event("resize"));
					});
				await state("pending");
			}
			await draft.fill("Keep this draft when changing sessions");
			const countAfterSends = mutations.length;
			await mode.selectOption("followUp");
			await chooseSession(page, other.instance);
			await expect(mode).toHaveCount(0);
			await chooseSession(page, owner.instance);
			await expect(mode).toHaveValue("steer");
			await expect(draft).toHaveValue("Keep this draft when changing sessions");
			await mode.selectOption("followUp");
			await state("no-pending");
			await state("settled");
			await expect(mode).toHaveCount(0);
			await state("pending");
			await state("work");
			await expect(mode).toHaveValue("steer");
			expect(mutations).toHaveLength(countAfterSends);
		}
		await draft.fill("Stop keeps this draft");
		await mode.selectOption("followUp");
		const aborts = (
			await (await context.request.get("/api/fixture/dispatches")).json()
		).aborts;
		await page.getByRole("button", { name: "Stop", exact: true }).click();
		await expect
			.poll(
				async () =>
					(await (await context.request.get("/api/fixture/dispatches")).json())
						.aborts,
			)
			.toBe(aborts + 1);
		await expect(draft).toHaveValue("Stop keeps this draft");
		expect(requests.map((r) => r.deliverAs)).toEqual([
			"steer",
			"followUp",
			"followUp",
			"followUp",
			"steer",
			"followUp",
			"followUp",
			"followUp",
		]);
		expect(new Set(requests.map((r) => r.requestId)).size).toBe(8);
		expect(
			requests.every(
				(r) =>
					r.instance === owner.instance && r.generation === owner.generation,
			),
		).toBe(true);
		expect(
			(await (await context.request.get("/api/fixture/dispatches")).json())
				.dispatches,
		).toBe(before + 8);
		await state("reset");
		questionCookies = await context.cookies();
	});
});

test("I2 busy text lost response retains original mode/id/text with explicit dedup retry and no reconnect resend", async ({
	page,
	context,
}) => {
	await pairQuestionnaire(page, context);
	const state = (action: string) =>
		context.request.post("/api/fixture/stop-state", { data: { action } });
	for (const mode of ["steer", "followUp"]) {
		await state("reset");
		await state("pending");
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		const other = list.sessions.find(
			(s: { session: string }) => s.session === "Browser other",
		);
		await chooseSession(page, owner.instance);
		const before = (
			await (await context.request.get("/api/fixture/dispatches")).json()
		).dispatches;
		const requests: Record<string, string>[] = [];
		const listener = (req: import("@playwright/test").Request) => {
			if (req.url().endsWith("/api/text")) requests.push(req.postDataJSON());
		};
		page.on("request", listener);
		const draft = page.getByLabel("Text for selected Pi (local draft)");
		await expect(draft).toHaveAccessibleDescription(
			/Pi is busy — choose Steer or Follow-up/,
		);
		await draft.fill(`original ${mode}`);
		await page.route(
			"**/api/text",
			async (route) => {
				await route.fetch();
				await route.abort();
			},
			{ times: 1 },
		);
		await draft.press(mode === "steer" ? "Enter" : "Alt+Enter");
		const retry = page.getByRole("button", {
			name: "Retry same outstanding input",
		});
		await expect(retry).toBeEnabled();
		await expect(draft).toBeFocused();
		await expect(draft).toHaveValue(`original ${mode}`);
		await draft.fill("edited must not replace original");
		await chooseSession(page, other.instance);
		await expect(retry).toBeDisabled();
		await chooseSession(page, owner.instance);
		await context.request.post("/api/fixture/break-transport");
		await expect(
			page.getByLabel("Text for selected Pi (local draft)"),
		).toHaveAccessibleDescription(/Disconnected — cached content is read-only/);
		await expect(
			page
				.locator(".composer")
				.getByText(
					"Input outcome unknown — original retained; no automatic retry.",
					{ exact: true },
				),
		).toBeVisible({ timeout: 15000 });
		expect(requests).toHaveLength(1);
		await state("idle");
		await state("no-pending");
		await expect(
			page.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible();
		await expect(retry).toBeEnabled();
		await draft.focus();
		await retry.evaluate((node) => (node as HTMLButtonElement).click());
		await expect(retry).toHaveCount(0);
		await expect(draft).toBeFocused(); // The forwarded original did not clear the newer draft.
		await expectBusyReceipt(
			page,
			mode === "steer"
				? "Steering requested (completion unconfirmed)"
				: "Follow-up requested (completion unconfirmed)",
			`original ${mode}`,
		);
		expect(requests).toHaveLength(2);
		expect(requests[1].requestId).toBe(requests[0].requestId);
		expect(requests[1].text).toBe(`original ${mode}`);
		expect(requests[0].deliverAs).toBe(mode);
		expect(requests[1].deliverAs).toBe(mode);
		expect(requests[1].instance).toBe(owner.instance);
		expect(requests[1].generation).toBe(owner.generation);
		expect(
			(await (await context.request.get("/api/fixture/dispatches")).json())
				.dispatches,
		).toBe(before + 1);
		await expect(draft).toHaveValue("edited must not replace original");
		await chooseSession(page, other.instance);
		await expect(
			page.getByRole("region", { name: "Latest browser request" }),
		).toHaveCount(0);
		await chooseSession(page, owner.instance);
		await expect(
			page
				.getByRole("region", { name: "Latest browser request" })
				.locator(".receipt-preview"),
		).toHaveText(`original ${mode}`);
		// Reload only after both routed loss cases. WebKit's now-controlling
		// service worker can bypass page.route on subsequent requests.
		if (mode === "followUp") {
			await page.reload();
			await expect(
				page.getByRole("button", { name: /^Open sessions: Browser test/ }),
			).toBeVisible();
			await expect(draft).toHaveValue("");
			await expect(
				page.getByRole("region", { name: "Latest browser request" }),
			).toHaveCount(0);
			expect(requests).toHaveLength(2);
		}
		page.off("request", listener);
	}
	await state("reset");
	questionCookies = await context.cookies();
});

test("I2 busy text delayed acquisition captures mode, allows Pi settling and never redirects after selection", async ({
	page,
	context,
}) => {
	await pairQuestionnaire(page, context);
	const state = (action: string) =>
		context.request.post("/api/fixture/stop-state", { data: { action } });
	for (const change of ["idle", "follow-up idle", "selection"]) {
		await state("reset");
		await state("work");
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		const other = list.sessions.find(
			(s: { session: string }) => s.session === "Browser other",
		);
		await chooseSession(page, owner.instance);
		await expect(
			page.locator("header").getByText("Pi is working", { exact: true }),
		).toBeVisible();
		const before = (
			await (await context.request.get("/api/fixture/dispatches")).json()
		).dispatches;
		const requests: Record<string, string>[] = [];
		const listener = (req: import("@playwright/test").Request) => {
			if (req.url().endsWith("/api/text")) requests.push(req.postDataJSON());
		};
		page.on("request", listener);
		const draft = page.getByLabel("Text for selected Pi (local draft)");
		await draft.fill("captured busy text");
		let release!: () => void, entered!: () => void;
		const ready = new Promise<void>((r) => (entered = r)),
			held = new Promise<void>((r) => (release = r));
		await page.route(
			"**/api/control",
			async (route) => {
				expect(route.request().postDataJSON()).toEqual({
					instance: owner.instance,
					generation: owner.generation,
					action: "claim",
				});
				const response = await route.fetch();
				entered();
				await held;
				await route.fulfill({ response });
			},
			{ times: 1 },
		);
		if (change === "follow-up idle") await draft.press("Alt+Enter");
		else
			await page
				.getByRole("button", { name: /^(Send|Steer)$/, exact: true })
				.click();
		await ready;
		await draft.fill("new local draft");
		if (change !== "selection") {
			await state("idle");
			await expect(
				page.locator("header").getByText("Pi idle", { exact: true }),
			).toBeVisible();
		} else await chooseSession(page, other.instance);
		release();
		if (change !== "selection") {
			await expectBusyReceipt(
				page,
				change === "idle"
					? "Steering requested (completion unconfirmed)"
					: "Follow-up requested (completion unconfirmed)",
				"captured busy text",
			);
			expect(requests).toHaveLength(1);
			expect(requests[0].deliverAs).toBe(
				change === "idle" ? "steer" : "followUp",
			);
			expect(requests[0].text).toBe("captured busy text");
			expect(requests[0].instance).toBe(owner.instance);
			expect(requests[0].generation).toBe(owner.generation);
			await expect(draft).toHaveValue("new local draft");
		} else {
			await expect(
				page.getByText("Action in progress — please wait; drafts stay local.", {
					exact: true,
				}),
			).toHaveCount(0);
			await chooseSession(page, owner.instance);
			await expect(
				page.getByText("Not sent — control unavailable", { exact: true }),
			).toBeVisible();
			expect(requests).toEqual([]);
		}
		expect(
			(await (await context.request.get("/api/fixture/dispatches")).json())
				.dispatches,
		).toBe(before + (change === "selection" ? 0 : 1));
		page.off("request", listener);
	}
	await state("reset");
	questionCookies = await context.cookies();
});

test("I2 busy text older or unavailable bridges fail closed with owning Pi full-restart guidance", async ({
	page,
	context,
}, testInfo) => {
	// Simulate legacy capability metadata only; native EventSource still owns live transport/auth.
	await page.addInitScript(() => {
		const original = EventSource.prototype.addEventListener;
		EventSource.prototype.addEventListener = function (
			type: string,
			listener:
				| EventListenerOrEventListenerObject
				| ((this: EventSource, event: MessageEvent) => unknown),
			options?: boolean | AddEventListenerOptions,
		) {
			if (type !== "snapshot")
				return original.call(
					this,
					type,
					listener as EventListenerOrEventListenerObject,
					options,
				);
			original.call(
				this,
				type,
				(event) => {
					const view = JSON.parse((event as MessageEvent).data);
					const selected = view.sessions.find(
						(s: { instance: string; generation: string }) =>
							s.instance === view.selected?.instance &&
							s.generation === view.selected?.generation,
					);
					if (selected) {
						const busyText = (window as unknown as { legacyBusyText?: boolean })
							.legacyBusyText;
						if (busyText === undefined) delete selected.busyText;
						else selected.busyText = busyText;
					}
					const projected = new MessageEvent("snapshot", {
						data: JSON.stringify(view),
						origin: (event as MessageEvent).origin,
						lastEventId: (event as MessageEvent).lastEventId,
					});
					if (typeof listener === "function") listener.call(this, projected);
					else listener.handleEvent(projected);
				},
				options,
			);
		};
	});
	await pairQuestionnaire(page, context);
	const state = (action: string) =>
		context.request.post("/api/fixture/stop-state", { data: { action } });
	await state("reset");
	await state("work");
	const list = await (await context.request.get("/api/snapshot")).json();
	const owner = list.sessions.find(
		(s: { session: string }) => s.session === "Browser test",
	);
	const before = (
		await (await context.request.get("/api/fixture/dispatches")).json()
	).dispatches;
	const requests: string[] = [];
	page.on("request", (req) => {
		if (/\/api\/(control|text|image)$/.test(req.url()))
			requests.push(req.url());
	});
	for (const busyText of [undefined, false]) {
		if (busyText === false) {
			await chooseSession(page, "");
			await expect(
				page.getByRole("dialog", { name: "Live sessions" }),
			).toBeHidden();
		}
		await page.evaluate((value) => {
			(window as unknown as { legacyBusyText?: boolean }).legacyBusyText =
				value;
		}, busyText);
		await chooseSession(page, owner.instance);
		// This live header status requires both the selected view and transport to be Connected.
		await expect(
			page.locator("header").getByText("Pi is working", { exact: true }),
		).toBeVisible();
		await page
			.getByLabel("Text for selected Pi (local draft)")
			.fill("local only");
		await expect(
			page.getByLabel("Text for selected Pi (local draft)"),
		).toHaveAccessibleDescription(
			"Busy text unavailable — fully restart the owning Pi to load the updated bridge.",
		);

		await expect(
			page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
		).toBeDisabled();
		await expect(
			page.getByRole("button", { name: "Follow-up", exact: true }),
		).toHaveCount(0);
		await page.getByLabel("Text for selected Pi (local draft)").press("Enter");
		await page
			.getByLabel("Text for selected Pi (local draft)")
			.press("Alt+Enter");
		expect(requests).toEqual([]);
	}
	expect(
		(await (await context.request.get("/api/fixture/dispatches")).json())
			.dispatches,
	).toBe(before);
	await state("idle");
	const draft = page.getByLabel("Text for selected Pi (local draft)");
	await draft.fill("presentation receipt");
	await page
		.getByRole("button", { name: /^(Send|Steer)$/, exact: true })
		.click();

	await state("work");
	await expect(draft).toHaveAccessibleDescription(/Busy text unavailable/);
	await draft.fill("editable legacy draft");
	const mutationsBeforeInspection = requests.length;
	const composer = page.getByRole("region", { name: "Browser text input" });
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
		for (const colorScheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme });
			expect(
				(await composer.locator(".composer-bar").boundingBox())!.height,
			).toBeLessThanOrEqual(74);
			await expect(
				composer.getByText(
					"Busy text unavailable — fully restart the owning Pi to load the updated bridge.",
					{ exact: true },
				),
			).toBeVisible();
			for (const button of await composer.locator("button:visible").all()) {
				const box = (await button.boundingBox())!;
				expect(box.height).toBeGreaterThanOrEqual(44);
				expect(box.width).toBeGreaterThanOrEqual(44);
			}
			await expect(composer.locator(".action-receipt")).toHaveCount(0);
			await expect(composer.locator("summary")).toHaveCount(0);
			await expect(
				composer.getByRole("button", { name: "Stop", exact: true }),
			).toBeEnabled();
			await expect(
				page.getByLabel("Images for selected Pi (local picker)"),
			).toHaveAccessibleDescription(
				"Up to four still PNG, JPEG or WebP images · 4 MB total",
			);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(
					`compact-legacy-held-forwarded-${width}-${colorScheme}.png`,
				),
			});
			await page.getByRole("button", { name: /^Open sessions:/ }).click();
			const sidebar = page.getByRole("dialog", { name: "Live sessions" });
			await expect(
				sidebar.getByRole("region", { name: "Input details" }),
			).toHaveCount(0);
			await sidebar.getByRole("button", { name: "Close sessions" }).click();
			await expect(sidebar).toBeHidden();
		}
	}
	expect(requests).toHaveLength(mutationsBeforeInspection);
	await expect(draft).toHaveValue("editable legacy draft");
	await state("reset");
	questionCookies = await context.cookies();
	// The wrapper and its metadata are confined to this test's disposable page/context.
});

// These use the shipped buttons and existing fixture mutations only: no test-only control entrypoint.
test("C4 action acquisition captures image/text and questionnaire payloads, serializes callers, and never renews implicitly", async ({
	page,
	context,
}) => {
	await pairQuestionnaire(page, context);
	const state = (action: string) =>
		context.request.post("/api/fixture/question", { data: { action } });
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "reset" },
	});
	await state("reload");
	await state("new");
	const list = await (await context.request.get("/api/snapshot")).json();
	const owner = list.sessions.find(
		(s: { session: string }) => s.session === "Browser test",
	);
	await chooseSession(page, owner.instance);
	await expect(
		page.locator("header").getByText("Pi idle", { exact: true }),
	).toBeVisible();
	const controls: string[] = [],
		images: Record<string, string>[] = [],
		replies: { cancelled: boolean; answers: unknown[] }[] = [],
		order: string[] = [];
	page.on("request", (req) => {
		if (req.url().endsWith("/api/control")) {
			controls.push(req.postDataJSON().action);
			order.push(req.postDataJSON().action);
		}
		if (req.url().includes("/api/snapshot?")) order.push("confirm");
		if (req.url().endsWith("/api/image")) {
			images.push(req.postDataJSON());
			order.push("image");
		}
		if (req.url().endsWith("/api/question-reply"))
			replies.push(req.postDataJSON().reply);
	});
	const draft = page.getByLabel("Text for selected Pi (local draft)"),
		picker = page.getByLabel("Images for selected Pi (local picker)");
	await draft.fill("captured original");
	await picker.setInputFiles({
		name: "original.png",
		mimeType: "image/png",
		buffer: png,
	});
	await fillQuestionField(page, "Free response for Single", "local only");
	await page.waitForTimeout(600);
	expect(controls).toEqual([]);
	expect(images).toEqual([]);
	expect(replies).toEqual([]);
	await expect(
		page.getByRole("button", { name: "Take control", exact: true }),
	).toHaveCount(0);
	let release!: () => void, entered!: () => void;
	const ready = new Promise<void>((resolve) => (entered = resolve)),
		held = new Promise<void>((resolve) => (release = resolve));
	await page.route(
		"**/api/control",
		async (route) => {
			expect(route.request().postDataJSON()).toEqual({
				instance: owner.instance,
				generation: owner.generation,
				action: "claim",
			});
			const response = await route.fetch();
			entered();
			await held;
			await route.fulfill({ response });
		},
		{ times: 1 },
	);
	// Same-turn clicks use public DOM buttons (and respect disabled state), not hidden authority hooks.
	await page
		.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		})
		.evaluate((button) => {
			(button as HTMLButtonElement).click();
			(button as HTMLButtonElement).click();
			document
				.querySelector<HTMLButtonElement>(".question-form button")!
				.click();
		});
	await ready;
	await draft.fill("edited draft");
	await picker.setInputFiles({
		name: "replacement.png",
		mimeType: "image/png",
		buffer: Buffer.concat([png, Buffer.from("replacement")]),
	});
	await expect(
		page.getByRole("button", {
			name: "Submit questionnaire",
			includeHidden: true,
		}),
	).toBeDisabled();
	await expect(
		page.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		}),
	).toBeDisabled();
	release();

	expect(controls).toEqual(["claim"]);
	expect(order).toEqual(["claim", "confirm", "image"]);
	expect(images).toHaveLength(1);
	expect(images[0].instance).toBe(owner.instance);
	expect(images[0].generation).toBe(owner.generation);
	expect(images[0].text).toBe("captured original");
	expect(images[0].images).toEqual([
		{ source: png.toString("base64"), mime: "image/png" },
	]);
	await expect(draft).toHaveValue("edited draft");
	await expect(
		page.getByRole("button", { name: /Remove image.*replacement.png/ }),
	).toBeVisible();
	await page.waitForTimeout(600);
	expect(replies).toEqual([]);
	expect(images).toHaveLength(1); // No queued overlapping action.
	await sidebarClick(page, "Release control");
	await expect(
		page.getByRole("button", {
			name: "Take over browser control",
			includeHidden: true,
		}),
	).toHaveCount(0);
	let releaseReply!: () => void, enteredReply!: () => void;
	const replyReady = new Promise<void>((r) => (enteredReply = r)),
		replyHeld = new Promise<void>((r) => (releaseReply = r));
	await page.route(
		"**/api/control",
		async (route) => {
			const response = await route.fetch();
			enteredReply();
			await replyHeld;
			await route.fulfill({ response });
		},
		{ times: 1 },
	);
	await page
		.getByRole("group", { name: "Single", exact: true })
		.getByText("Other responses", { exact: true })
		.click();
	await page
		.getByRole("button", {
			name: "Decline (null response) for Single",
			exact: true,
		})
		.click();
	await fillQuestionField(
		page,
		"Optional note for Single",
		"captured null note",
	);
	await submitQuestionnaire(page, true);
	await replyReady;
	await fillQuestionField(
		page,
		"Free response for Single",
		"edited not submitted",
	);
	releaseReply();
	await expect(
		page.getByText(
			/Answer completed — confirmed by live questionnaire callback/,
		),
	).toBeVisible();
	expect(replies).toHaveLength(1);
	expect(replies[0].cancelled).toBe(true);
	expect(replies[0].answers).toEqual([
		{
			questionIndex: 0,
			kind: "custom",
			answer: null,
			notes: "captured null note",
		},
	]);
	expect(controls.filter((action) => action === "claim")).toHaveLength(2);
	await expect(
		page.locator('form[aria-label="Pending questionnaire"]'),
	).toHaveCount(0);
	await state("new");
	await expect(
		page.locator('form[aria-label="Pending questionnaire"]'),
	).toHaveCount(1);
	await submitQuestionnaire(page);
	await expect(
		page.locator('form[aria-label="Pending questionnaire"]'),
	).toHaveCount(0);
	expect(replies).toHaveLength(2);
	expect(controls.filter((action) => action === "claim")).toHaveLength(2);
	expect(controls).not.toContain("renew");
	await state("reload");
	questionCookies = await context.cookies();
});

for (const loss of ["claim", "confirmation"])
	test(`C4 action acquisition ${loss} response loss retains drafts/forms and never dispatches or auto-claims`, async ({
		page,
		context,
	}) => {
		await pairQuestionnaire(page, context);
		const question = (action: string) =>
			context.request.post("/api/fixture/question", { data: { action } });
		const stop = (action: string) =>
			context.request.post("/api/fixture/stop-state", { data: { action } });
		for (const action of [
			"Send",
			"image",
			"Stop",
			"Submit questionnaire",
			"Cancel questionnaire",
		]) {
			await stop("reset");
			await question("reload");
			if (action.includes("questionnaire")) await question("new");
			const list = await (await context.request.get("/api/snapshot")).json();
			const owner = list.sessions.find(
				(s: { session: string }) => s.session === "Browser test",
			);
			await chooseSession(page, owner.instance);
			await expect(
				page
					.locator("header")
					.getByText(
						action.includes("questionnaire") ? "Needs answer" : "Pi idle",
						{ exact: true },
					),
			).toBeVisible();
			await page
				.getByLabel("Text for selected Pi (local draft)")
				.fill("retained unsent");
			if (action === "image")
				await page
					.getByLabel("Images for selected Pi (local picker)")
					.setInputFiles({
						name: "unsent.png",
						mimeType: "image/png",
						buffer: png,
					});
			if (action.includes("questionnaire"))
				await fillQuestionField(
					page,
					"Free response for Single",
					"retained answer",
				);
			if (action === "Stop") {
				await stop("work");
				await expect(
					page.locator("header").getByText("Pi is working", { exact: true }),
				).toBeVisible();
			}
			const mutations: string[] = [],
				claims: string[] = [];
			const listener = (req: import("@playwright/test").Request) => {
				if (/\/api\/(text|image|stop|question-reply)$/.test(req.url()))
					mutations.push(req.url());
				if (
					req.url().endsWith("/api/control") &&
					req.postDataJSON().action === "claim"
				)
					claims.push("claim");
			};
			page.on("request", listener);
			await page.route(
				loss === "claim" ? "**/api/control" : "**/api/snapshot?*",
				async (route) => {
					await route.fetch();
					await route.abort();
				},
				{ times: 1 },
			);
			if (action === "Send" || action === "image")
				await page
					.getByLabel("Text for selected Pi (local draft)")
					.evaluate((node) => node.blur());
			if (action === "Submit questionnaire") await submitQuestionnaire(page);
			else if (action === "Cancel questionnaire")
				await submitQuestionnaire(page, true);
			else
				await page
					.getByRole("button", {
						name: action === "image" ? "Send" : action,
						exact: true,
					})
					.click();
			await expect(
				page.getByText(/Control response lost — read-only/),
			).toBeVisible();
			if (action === "Send" || action === "image")
				await expect(
					page.getByLabel("Text for selected Pi (local draft)"),
				).not.toBeFocused();
			await page.waitForTimeout(550);
			expect(claims).toEqual(["claim"]);
			expect(mutations).toEqual([]);
			await expect(
				page.getByLabel("Text for selected Pi (local draft)"),
			).toHaveValue("retained unsent");
			if (action === "image")
				await expect(
					page.getByRole("img", { name: "Local attachment preview" }),
				).toBeVisible();
			if (action.includes("questionnaire"))
				await expect(
					page.getByRole("textbox", {
						name: "Free response for Single",
						exact: true,
					}),
				).toHaveValue("retained answer");
			expect(await page.getByText(/Uncertain — response lost/).count()).toBe(0);
			await expect(
				page.getByRole("button", { name: /Retry same|Repeat original/ }),
			).toHaveCount(0);
			page.off("request", listener);
		}
		await stop("reset");
		await question("reload");
		questionCookies = await context.cookies();
	});

test("C4 action acquisition delayed claim cannot redirect across selection/generation/auth/disconnect/busy/question closure", async ({
	page,
	context,
}) => {
	await pairQuestionnaire(page, context);
	const question = (action: string) =>
		context.request.post("/api/fixture/question", { data: { action } });
	const stop = (action: string) =>
		context.request.post("/api/fixture/stop-state", { data: { action } });
	for (const change of [
		"selection",
		"generation",
		"auth",
		"disconnect",
		"busy",
		"question closure",
	]) {
		await stop("reset");
		await question("reload");
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) =>
				s.session ===
				(change === "disconnect" ? "Browser other" : "Browser test"),
		);
		const other = list.sessions.find(
			(s: { session: string }) => s.session === "Browser other",
		);
		await chooseSession(page, owner.instance);
		await expect(
			page.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible();
		await page
			.getByLabel("Text for selected Pi (local draft)")
			.fill("never redirect");
		if (change === "question closure") {
			await question("new");
			await expect(
				page.getByRole("button", {
					name: "Submit questionnaire",
					includeHidden: true,
				}),
			).toBeEnabled();
		}
		const posts: string[] = [];
		const listener = (req: import("@playwright/test").Request) => {
			if (/\/api\/(text|image|stop|question-reply)$/.test(req.url()))
				posts.push(req.url());
		};
		page.on("request", listener);
		let release!: () => void, entered!: () => void;
		const ready = new Promise<void>((r) => (entered = r)),
			held = new Promise<void>((r) => (release = r));
		await page.route(
			"**/api/control",
			async (route) => {
				const response = await route.fetch();
				entered();
				await held;
				await route.fulfill({ response });
			},
			{ times: 1 },
		);
		if (change === "question closure") await submitQuestionnaire(page);
		else
			await page
				.getByRole("button", { name: /^(Send|Steer)$/, exact: true })
				.click();
		await ready;
		if (change === "selection") await chooseSession(page, other.instance);
		if (change === "generation") {
			await question("reload");
			await expect(
				page.getByLabel("Text for selected Pi (local draft)"),
			).toHaveValue("");
		}
		if (change === "auth") {
			await page.getByRole("button", { name: /^Open sessions:/ }).click();
			await expect(
				page.getByRole("button", { name: "Forget this device" }),
			).toBeDisabled();
			expect(
				(
					await context.request.post("/api/forget", {
						headers: { Origin: "http://127.0.0.1:4393", "x-c2-csrf": "input" },
						data: {},
					})
				).status(),
			).toBe(200);
			await expect(page.getByLabel("Pairing code")).toBeVisible();
		}
		if (change === "disconnect") {
			await context.request.post("/api/fixture/disconnect");
			await expect(
				page.getByLabel("Text for selected Pi (local draft)"),
			).toHaveAccessibleDescription(
				/Disconnected — cached content is read-only/,
			);
		}
		if (change === "busy") {
			await stop("work");
			await expect(
				page.locator("header").getByText("Pi is working", { exact: true }),
			).toBeVisible();
		}
		if (change === "question closure") {
			await question("terminal");
			await expect(
				page.locator('form[aria-label="Pending questionnaire"]'),
			).toHaveCount(0);
		}
		release();
		await page.waitForTimeout(650);
		expect(posts).toEqual([]);
		page.off("request", listener);
		if (change === "auth") {
			await page.getByLabel("Pairing code").fill(await freshCode());
			await page.getByLabel("Remember this device").uncheck();
			await page.getByRole("button", { name: "Pair this device" }).click();
		}
		if (change === "disconnect")
			await context.request.post("/api/fixture/restore");
	}
	await stop("reset");
	await question("reload");
	questionCookies = await context.cookies();
});

test("C4 action acquisition lease expiry and failed original reclaim preserve uncertainty; separate takeover never continues an action", async ({
	page,
	context,
}) => {
	await page.clock.install();
	await pairQuestionnaire(page, context);
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "reset" },
	});
	const list = await (await context.request.get("/api/snapshot")).json();
	const owner = list.sessions.find(
		(s: { session: string }) => s.session === "Browser test",
	);
	await chooseSession(page, owner.instance);
	const controls: string[] = [],
		sent: Record<string, string>[] = [];
	let expires = 0;
	page.on("request", (req) => {
		if (req.url().endsWith("/api/control"))
			controls.push(req.postDataJSON().action);
		if (req.url().endsWith("/api/text")) sent.push(req.postDataJSON());
	});
	page.on("response", async (response) => {
		if (
			response.url().endsWith("/api/control") &&
			response.request().postDataJSON().action === "claim" &&
			response.ok()
		)
			expires = (await response.json()).expires;
	});
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("original uncertain text");
	await page.route(
		"**/api/text",
		async (route) => {
			await route.fetch();
			await route.abort();
		},
		{ times: 1 },
	);
	await page
		.getByRole("button", {
			name: /^(Send|Steer)$/,
			exact: true,
			includeHidden: true,
		})
		.click();
	await expect(
		page.getByRole("button", { name: "Retry same outstanding input" }),
	).toBeEnabled();
	expect(expires).toBeGreaterThan(0);
	await page.clock.setSystemTime(expires + 1000);
	await expect(
		page.getByRole("button", { name: "Release control", includeHidden: true }),
	).toHaveCount(0);

	expect(controls.filter((action) => action === "claim")).toHaveLength(1);
	expect(controls).not.toContain("renew");
	expect(sent).toHaveLength(1);
	await page.clock.setSystemTime(new Date());
	await expect(
		page.getByRole("button", { name: "Retry same outstanding input" }),
	).toBeEnabled();
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("edited must not replace original");
	await page.route(
		"**/api/control",
		async (route) => {
			await route.fetch();
			await route.abort();
		},
		{ times: 1 },
	);
	await page
		.getByRole("button", { name: "Retry same outstanding input" })
		.click();
	await expect(
		page.getByText(/Uncertain — original outcome unknown; retry not sent/),
	).toBeVisible();
	expect(sent).toHaveLength(1);
	await expectTakeoverAvailable(page);
	await sidebarClick(page, "Take over browser control");
	await expect(
		page.getByRole("button", { name: "Retry same outstanding input" }),
	).toBeEnabled();
	await page.waitForTimeout(600);
	expect(sent).toHaveLength(1); // The previously blocked retry was not continued.
	await page
		.getByRole("button", { name: "Retry same outstanding input" })
		.click();

	expect(sent).toHaveLength(2);
	expect(sent[1].requestId).toBe(sent[0].requestId);
	expect(sent[1].text).toBe(sent[0].text);
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveValue("edited must not replace original");
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "reset" },
	});
	questionCookies = await context.cookies();
});

test("C4 Stop action acquisition delayed claim rechecks original owner and eligible parent activity", async ({
	page,
	context,
}) => {
	await pairQuestionnaire(page, context);
	const state = (action: string) =>
		context.request.post("/api/fixture/stop-state", { data: { action } });
	for (const change of ["selection", "settled"]) {
		await state("reset");
		await state("work");
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		const other = list.sessions.find(
			(s: { session: string }) => s.session === "Browser other",
		);
		await chooseSession(page, owner.instance);
		await expect(
			page.getByRole("button", {
				name: "Stop",
				exact: true,
				includeHidden: true,
			}),
		).toBeEnabled();
		const bodies: unknown[] = [];
		const listener = (req: import("@playwright/test").Request) => {
			if (req.url().endsWith("/api/stop")) bodies.push(req.postDataJSON());
		};
		page.on("request", listener);
		let release!: () => void, entered!: () => void;
		const ready = new Promise<void>((r) => (entered = r)),
			held = new Promise<void>((r) => (release = r));
		await page.route(
			"**/api/control",
			async (route) => {
				const response = await route.fetch();
				entered();
				await held;
				await route.fulfill({ response });
			},
			{ times: 1 },
		);
		await page
			.getByRole("button", { name: "Stop", exact: true, includeHidden: true })
			.click();
		await ready;
		if (change === "selection") await chooseSession(page, other.instance);
		else {
			await state("settled");
			await expect(
				page.locator("header").getByText("Pi idle", { exact: true }),
			).toBeVisible();
		}
		release();
		if (change === "selection") {
			await expect(page.getByText(/Stop: Not sent/)).toHaveCount(0);
			await chooseSession(page, owner.instance);
		}
		await expect(
			page.getByText(/Stop: Not sent — control or parent activity changed/),
		).toBeVisible();
		expect(bodies).toEqual([]);
		await expect(
			page.getByRole("button", { name: "Retry same Stop request" }),
		).toHaveCount(0);
		page.off("request", listener);
	}
	await state("reset");
	questionCookies = await context.cookies();
});

test("C4 action acquisition delayed confirmation cannot rewind newer busy, settled Stop or question closure observations", async ({
	page,
	context,
}) => {
	await pairQuestionnaire(page, context);
	const stop = (action: string) =>
		context.request.post("/api/fixture/stop-state", { data: { action } });
	const question = (action: string) =>
		context.request.post("/api/fixture/question", { data: { action } });
	for (const action of ["Send", "Stop", "Submit questionnaire"]) {
		await stop("reset");
		await question("reload");
		if (action === "Stop") await stop("work");
		if (action === "Submit questionnaire") await question("new");
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		await chooseSession(page, owner.instance);
		await page
			.getByLabel("Text for selected Pi (local draft)")
			.fill("never dispatch stale confirmation");
		const posts: string[] = [];
		const listener = (req: import("@playwright/test").Request) => {
			if (/\/api\/(text|stop|question-reply)$/.test(req.url()))
				posts.push(req.url());
		};
		page.on("request", listener);
		let release!: () => void, entered!: () => void;
		const ready = new Promise<void>((r) => (entered = r)),
			held = new Promise<void>((r) => (release = r));
		await page.route(
			"**/api/snapshot?*",
			async (route) => {
				const response = await route.fetch();
				entered();
				await held;
				await route.fulfill({ response });
			},
			{ times: 1 },
		);
		if (action === "Submit questionnaire") await submitQuestionnaire(page);
		else if (action === "Cancel questionnaire")
			await submitQuestionnaire(page, true);
		else await page.getByRole("button", { name: action, exact: true }).click();
		await ready;
		if (action === "Send") {
			await stop("work");
			await expect(
				page.locator("header").getByText("Pi is working", { exact: true }),
			).toBeVisible();
		}
		if (action === "Stop") {
			await stop("settled");
			await expect(
				page.locator("header").getByText("Pi idle", { exact: true }),
			).toBeVisible();
		}
		if (action === "Submit questionnaire") {
			await question("terminal");
			await expect(
				page.locator('form[aria-label="Pending questionnaire"]'),
			).toHaveCount(0);
		}
		release();
		await expect(
			page.getByText(
				action === "Send"
					? /Control changed before dispatch; nothing sent/
					: action === "Stop"
						? /Stop: Not sent/
						: /Questionnaire for .*Not sent/,
			),
		).toBeVisible();
		expect(posts).toEqual([]);
		page.off("request", listener);
	}
	await stop("reset");
	await question("reload");
	questionCookies = await context.cookies();
});

// Presentation-only snapshots exercise user/assistant styles without running a model.
for (const width of [320, 390])
	test(`mobile chat presentation and keyboard-accessible picker at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 844 });
		const identity = { instance: "a".repeat(32), generation: "b".repeat(32) };
		const summary = {
			...identity,
			project: "Pi Companion",
			session: "Mobile design",
			parent: "idle",
			background: "unobserved",
		};
		const snapshot = {
			...summary,
			truncated: false,
			items: [
				{
					id: "user",
					role: "user",
					blocks: [
						{
							type: "text",
							text: "Can we make this feel more like a mobile chat app?",
						},
					],
				},
				{
					id: "assistant",
					role: "assistant",
					blocks: [
						{
							type: "text",
							text: "Yes. A quieter layout puts the conversation first.\n\n- Rounded messages\n- Comfortable touch targets\n- Your existing Pi session",
						},
					],
				},
			],
		};
		await page.route("**/api/snapshot*", (route) =>
			route.fulfill({ json: { connection: "connected", sessions: [summary] } }),
		);
		await page.route("**/api/events*", (route) => {
			const selected = new URL(route.request().url()).searchParams.has(
				"instance",
			);
			return route.fulfill({
				contentType: "text/event-stream",
				body: `event: snapshot\ndata: ${JSON.stringify({ connection: "connected", sessions: [summary], ...(selected ? { selected: identity, snapshot } : {}) })}\n\n`,
			});
		});
		await page.goto("/");
		await expect(
			page.getByRole("region", { name: "Live sessions", exact: true }),
		).toBeVisible();
		await chooseSession(page, identity.instance);
		await expect(
			page.getByRole("region", { name: "Conversation", exact: true }),
		).toContainText("A quieter layout");
		const user = page.locator(".message-user"),
			assistant = page.locator(".message-assistant");
		const userBox = (await user.boundingBox())!,
			assistantBox = (await assistant.boundingBox())!;
		expect(userBox.x).toBeGreaterThan(assistantBox.x);
		expect(userBox.width).toBeLessThan(assistantBox.width);
		expect(
			await user.evaluate((node) =>
				parseFloat(getComputedStyle(node).borderRadius),
			),
		).toBeGreaterThanOrEqual(20);
		expect(
			await assistant.evaluate((node) =>
				parseFloat(getComputedStyle(node).borderTopWidth),
			),
		).toBe(0);
		await expect(
			page.getByRole("button", {
				name: /^(Send|Steer)$/,
				exact: true,
				includeHidden: true,
			}),
		).toBeDisabled();
		await page
			.getByPlaceholder("Message Pi")
			.fill("Keep the same terminal session.");
		const picker = page.getByLabel("Images for selected Pi (local picker)");
		await picker.focus();
		await expect(picker).toBeFocused();
		expect(
			await page
				.locator(".attachment-picker")
				.evaluate((node) => getComputedStyle(node).outlineStyle),
		).not.toBe("none");
		const box = (await picker.boundingBox())!;
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
		await picker.setInputFiles({
			name: "feedback.png",
			mimeType: "image/png",
			buffer: png,
		});
		await expect(
			page.getByRole("img", { name: "Local attachment preview" }),
		).toBeVisible();
		await page.getByRole("button", { name: /^Remove image/ }).click();
		await expect(page.getByPlaceholder("Message Pi")).toHaveValue(
			"Keep the same terminal session.",
		);
		for (const colorScheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme });
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(`chat-${width}-${colorScheme}.png`),
				fullPage: true,
			});
		}
	});

test("reload restores only the selected owner, reconciles replacement and never claims or replays input", async ({
	page,
	context,
}) => {
	await pairQuestionnaire(page, context);
	const state = (action: string) =>
		context.request.post("/api/fixture/stop-state", { data: { action } });
	await state("reset");
	const list = await (await context.request.get("/api/snapshot")).json();
	const owner = list.sessions.find(
		(session: { session: string }) => session.session === "Browser test",
	);
	const other = list.sessions.find(
		(session: { session: string }) => session.session === "Browser other",
	);
	const mutations: string[] = [];
	page.on("request", (request) => {
		if (
			/\/api\/(control|text|image|stop|question-reply)$/.test(request.url()) &&
			request.method() === "POST"
		)
			mutations.push(request.url());
	});
	await chooseSession(page, owner.instance);
	await expect
		.poll(() => new URL(page.url()).hash)
		.toBe(`#session=${owner.instance}:${owner.generation}`);
	await page
		.getByPlaceholder("Message Pi")
		.fill("Unsent draft must not be persisted");
	await page
		.getByLabel("Images for selected Pi (local picker)")
		.setInputFiles({ name: "unsent.png", mimeType: "image/png", buffer: png });
	const remembered = page.url();
	await page.reload();
	await expectSelected(page, owner.instance);
	await expect(page.locator("article")).toContainText("Owner A");
	await expect(page.getByPlaceholder("Message Pi")).toHaveValue("");
	await expect(
		page.getByRole("img", { name: "Local attachment preview" }),
	).toHaveCount(0);
	expect(page.url()).toBe(remembered);

	const tab = await context.newPage();
	try {
		await tab.goto("/");
		await expectSelected(tab, "");
		await chooseSession(tab, other.instance);
		await tab.reload();
		await expectSelected(tab, other.instance);
		await expect(tab.locator("article")).toContainText("Owner B");
		await expectSelected(page, owner.instance);
	} finally {
		await tab.close();
	}

	await state("reset");
	await expect.poll(() => page.url()).not.toBe(remembered);
	const replacement = page.url();
	await page.reload();
	await expectSelected(page, owner.instance);
	await expect(page.locator("article")).toContainText("Owner A");
	expect(page.url()).toBe(replacement);

	await chooseSession(page, other.instance);
	await context.request.post("/api/fixture/disconnect");
	try {
		await expect(
			page.getByLabel("Text for selected Pi (local draft)"),
		).toHaveAccessibleDescription(/Disconnected — cached content is read-only/);
		await page.reload();
		await expectSelected(page, other.instance);
		await expect(
			page.getByLabel("Text for selected Pi (local draft)"),
		).toHaveAccessibleDescription(/Disconnected — cached content is read-only/);
		await expect(
			page.getByRole("button", {
				name: /^(Send|Steer)$/,
				exact: true,
				includeHidden: true,
			}),
		).toBeDisabled();
		await expect(page.locator("article")).toHaveCount(0);
	} finally {
		await context.request.post("/api/fixture/restore");
	}
	await expect(page.locator("article")).toContainText("Owner B");
	await chooseSession(page, "");
	await expect.poll(() => new URL(page.url()).hash).toBe("");
	await page.reload();
	await expectSelected(page, "");
	expect(mutations).toEqual([]);
	expect(
		await page.evaluate(() => localStorage.length + sessionStorage.length),
	).toBe(0);
	await state("reset");
	questionCookies = await context.cookies();
});

const pairingHeaders = {
	Origin: "http://127.0.0.1:4393",
	"x-c2-csrf": "input",
};
async function forgetPairedContext(context: BrowserContext) {
	// Every new remembered fixture device is cleaned through the real self-only route.
	const response = await context.request.post("/api/forget", {
		headers: pairingHeaders,
		data: {},
		timeout: 5000,
	});
	expect([200, 401]).toContain(response.status());
}
async function pairDevice(page: Page, remember = true) {
	await page.getByLabel("Pairing code").fill(await freshCode());
	await page.getByLabel("Remember this device").setChecked(remember);
	await page
		.getByRole("button", { name: "Pair this device", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: /^Open sessions:/ }),
	).toBeVisible();
}

for (const width of [320, 390])
	for (const colorScheme of ["light", "dark"] as const)
		test(`P3 blank pairing form accessible at ${width}px ${colorScheme}`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
			await page.emulateMedia({ colorScheme });
			await page.goto("/");
			const code = page.getByLabel("Pairing code");
			await expect(code).toBeVisible();
			await expect(code).toHaveAttribute("type", "text");
			await expect(code).toHaveAttribute("inputmode", "numeric");
			await expect(code).toHaveAttribute("autocomplete", "one-time-code");
			await expect(code).toHaveAttribute("maxlength", "6");
			await expect(code).toHaveAttribute("pattern", "[0-9]{6}");
			await expect(page.getByLabel("Remember this device")).toBeChecked();
			await expect(page.getByText(/30 days after pairing/)).toBeVisible();
			await expect(page.getByText(/eight-hour access/)).toBeVisible();
			await expect(page.getByText(/five minutes and works once/)).toBeVisible();
			await code.focus();
			await expect(code).toBeFocused();
			// WebKit follows macOS's text-only Tab preference; Alt+Tab visits all controls.
			await page.keyboard.press(
				testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab",
			);
			await expect(page.getByLabel("Remember this device")).toBeFocused();
			await page.keyboard.press(
				testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab",
			);
			await expect(
				page.getByRole("button", { name: "Pair this device" }),
			).toBeFocused();
			const sizes = await code.evaluate((input) => ({
				size: parseFloat(getComputedStyle(input).fontSize),
				height: input.getBoundingClientRect().height,
			}));
			expect(sizes.size).toBeGreaterThanOrEqual(16);
			expect(sizes.height).toBeGreaterThanOrEqual(44);
			expect(
				(await page.locator(".remember-device").boundingBox())!.height,
			).toBeGreaterThanOrEqual(44);
			expect(
				(await page
					.getByRole("button", { name: "Pair this device" })
					.boundingBox())!.height,
			).toBeGreaterThanOrEqual(44);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await code.blur();
			await page.screenshot({
				path: testInfo.outputPath(`pairing-${width}-${colorScheme}.png`),
			});
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "125%";
			});
			await page
				.getByRole("button", { name: "Pair this device" })
				.scrollIntoViewIfNeeded();
			await expect(
				page.getByRole("button", { name: "Pair this device" }),
			).toBeVisible();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(
					`pairing-${width}-${colorScheme}-enlarged.png`,
				),
			});
		});

test("P3 unchecked temporary device expires on gateway recreation without pair or native replay", async ({
	page,
	context,
}) => {
	await page.goto("/");
	await pairDevice(page, false);
	const cookie = (await context.cookies()).find(
		(cookie) => cookie.name === "c2",
	)!;
	expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(8 * 3600 - 30);
	expect(cookie.expires - Date.now() / 1000).toBeLessThanOrEqual(8 * 3600);
	const posts: string[] = [];
	page.on("request", (req) => {
		if (req.method() === "POST" && !req.url().includes("/api/fixture/"))
			posts.push(new URL(req.url()).pathname);
	});
	await context.request.post("/api/fixture/restart");
	await expect(page.getByLabel("Pairing code")).toBeVisible({ timeout: 15000 });
	await expect(page.getByText(/no longer paired/)).toBeVisible();
	await page.waitForTimeout(400);
	expect(posts).toEqual([]);
	expect((await context.request.get("/api/snapshot")).status()).toBe(401);
});

for (const failure of ["503", "lost response"])
	test(`P3 Forget ${failure} never confirms revocation, retains uncertain original and requires explicit retry`, async ({
		page,
		context,
	}) => {
		await page.goto("/");
		await pairDevice(page);
		try {
			await context.request.post("/api/fixture/stop-state", {
				data: { action: "reset" },
			});
			const list = await (await context.request.get("/api/snapshot")).json();
			const owner = list.sessions.find(
				(s: { session: string }) => s.session === "Browser test",
			);
			await chooseSession(page, owner.instance);
			await expect(
				page.locator("header").getByText("Pi idle", { exact: true }),
			).toBeVisible();
			await page
				.getByLabel("Text for selected Pi (local draft)")
				.fill("uncertain original");
			await page.route(
				"**/api/text",
				async (route) => {
					await route.fetch();
					await route.abort();
				},
				{ times: 1 },
			);
			await page
				.getByRole("button", { name: /^(Send|Steer)$/, exact: true })
				.click();
			await expect(
				page.getByText(/Uncertain — response lost; no automatic retry/),
			).toBeVisible();
			await page
				.getByLabel("Text for selected Pi (local draft)")
				.fill("separate unsent draft");
			const posts: string[] = [];
			page.on("request", (req) => {
				if (req.method() === "POST" && !req.url().includes("/api/fixture/"))
					posts.push(new URL(req.url()).pathname);
			});
			if (failure === "lost response")
				await page.route("**/api/snapshot*", (route) =>
					route.fulfill({
						status: 503,
						json: { error: "Authentication unavailable" },
					}),
				);
			await page.route(
				"**/api/forget",
				async (route) => {
					if (failure === "503")
						await route.fulfill({
							status: 503,
							json: { error: "Authentication unavailable" },
						});
					else {
						await route.fetch();
						await route.abort();
					}
				},
				{ times: 1 },
			);
			await page.getByRole("button", { name: /^Open sessions:/ }).click();
			await page.getByRole("button", { name: "Forget this device" }).click();
			await expect(
				page.getByText(
					failure === "503"
						? /Forget unavailable — revocation not confirmed/
						: /Forget response lost.*outcome unknown; revocation not confirmed/,
				),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Forget this device" }),
			).toBeEnabled();
			await expect(page.getByLabel("Pairing code")).toHaveCount(0);
			await expect(page.getByText(/This device was forgotten/)).toHaveCount(0);
			await page.waitForTimeout(500);
			expect(posts.filter((path) => path === "/api/forget")).toHaveLength(1);
			if (failure === "lost response")
				expect((await context.request.get("/api/snapshot")).status()).toBe(401);
			expect(
				posts.some((path) => /\/(text|image|stop|question-reply)$/.test(path)),
			).toBe(false);
			await page.getByRole("button", { name: "Forget this device" }).click();
			await expect(page.getByLabel("Pairing code")).toBeVisible();
			await expect(page.getByRole("alert")).toContainText(
				failure === "503" ? "This device was forgotten" : "already unpaired",
			);
			if (failure === "lost response") await page.unroute("**/api/snapshot*");
			await pairDevice(page, false);
			await expect(
				page.getByLabel("Text for selected Pi (local draft)"),
			).toHaveValue("separate unsent draft");
			await expect(
				page.getByText(/Uncertain — response lost; no automatic retry/),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Retry same outstanding input" }),
			).toBeEnabled();
			expect(posts.filter((path) => path === "/api/forget")).toHaveLength(2);
			expect(
				posts.some((path) => /\/(text|image|stop|question-reply)$/.test(path)),
			).toBe(false);
		} finally {
			await forgetPairedContext(context);
		}
	});

for (const change of ["selection", "new pairing"])
	test(`P3 stale SSE 401 probe cannot undo ${change}`, async ({
		page,
		context,
	}) => {
		await page.goto("/");
		await pairDevice(page);
		try {
			const list = await (await context.request.get("/api/snapshot")).json();
			const owner = list.sessions.find(
				(s: { session: string }) => s.session === "Browser test",
			);
			const other = list.sessions.find(
				(s: { session: string }) => s.session === "Browser other",
			);
			await chooseSession(page, owner.instance);
			await expect(
				page.locator("header").getByText("Pi idle", { exact: true }),
			).toBeVisible();
			let entered!: () => void, release!: () => void;
			const ready = new Promise<void>((resolve) => (entered = resolve)),
				held = new Promise<void>((resolve) => (release = resolve));
			await page.route(
				"**/api/snapshot?*",
				async (route) => {
					entered();
					await held;
					await route.fulfill({ status: 401, json: { error: "Unpaired" } });
				},
				{ times: 1 },
			);
			await context.request.post("/api/fixture/break-transport");
			await ready;
			if (change === "selection") {
				await chooseSession(page, other.instance);
				await expectSelected(page, other.instance);
			} else {
				await sidebarClick(page, "Forget this device");
				await expect(page.getByLabel("Pairing code")).toBeVisible();
				await pairDevice(page);
			}
			release();
			await page.waitForTimeout(600);
			await expect(
				page.getByRole("button", { name: /^Open sessions:/ }),
			).toBeVisible();
			await expect(page.getByLabel("Pairing code")).toHaveCount(0);
			await expect(
				page.locator("header").getByText("Pi idle", { exact: true }),
			).toBeVisible();
		} finally {
			await forgetPairedContext(context);
		}
	});

// The already-required real recreations separate exchange batches within the shared 10/min window.
test("P3 default remembered device refresh and real gateway recreation recover selected read-only; Forget revokes both tabs durably", async ({
	page,
	context,
	browser,
}) => {
	await page.goto("/");
	await expect(page.getByLabel("Remember this device")).toBeChecked();
	const mutations: string[] = [];
	context.on("request", (req) => {
		if (
			req.method() === "POST" &&
			/\/api\/(pair|control|text|image|stop|question-reply|forget)$/.test(
				req.url(),
			)
		)
			mutations.push(new URL(req.url()).pathname);
	});
	try {
		await pairDevice(page);
		const cookie = (await context.cookies()).find(
			(cookie) => cookie.name === "c2",
		)!;
		expect(cookie.httpOnly).toBe(true);
		expect(cookie.sameSite).toBe("Strict");
		expect(cookie.path).toBe("/");
		expect(cookie.secure).toBe(false);
		expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(30 * 86400 - 30);
		expect(cookie.expires - Date.now() / 1000).toBeLessThanOrEqual(30 * 86400);
		expect(
			await page.evaluate(
				() =>
					document.cookie.includes("c2=") ||
					localStorage.length > 0 ||
					sessionStorage.length > 0,
			),
		).toBe(false);
		await context.request.post("/api/fixture/stop-state", {
			data: { action: "reset" },
		});
		const list = await (await context.request.get("/api/snapshot")).json();
		const owner = list.sessions.find(
			(s: { session: string }) => s.session === "Browser test",
		);
		await chooseSession(page, owner.instance);
		await expect(
			page.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible();
		const address = page.url();
		expect(new URL(address).hash).toBe(
			`#session=${owner.instance}:${owner.generation}`,
		);
		expect(new URL(address).search).toBe("");
		await page.reload();
		await expectSelected(page, owner.instance);
		await expect(
			page.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible();
		const reader = await context.newPage();
		await reader.goto(address);
		await expect(
			reader.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible();
		await context.request.post("/api/fixture/restart");
		await expect(
			page.getByLabel("Text for selected Pi (local draft)"),
		).toHaveAccessibleDescription(/Disconnected — cached content is read-only/);
		await expect
			.poll(async () => {
				try {
					return (await context.request.get("/api/snapshot")).status();
				} catch {
					return 0;
				}
			})
			.toBe(200);
		await expect(
			page.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible({ timeout: 15000 });
		await expect(
			reader.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible({ timeout: 15000 });
		await page.reload();
		await expect(
			page.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible();
		await page.waitForTimeout(600);
		expect(mutations).toEqual(["/api/pair"]);
		await sidebarClick(page, "Forget this device");
		await expect(page.getByLabel("Pairing code")).toBeVisible();
		await expect(
			page.getByText(
				"This device was forgotten. Native attempts are not cancelled.",
			),
		).toBeVisible();
		await expect(reader.getByLabel("Pairing code")).toBeVisible({
			timeout: 15000,
		});
		await expect(reader.getByText(/no longer paired/)).toBeVisible();
		await expect(
			page.getByRole("img", { name: /^Native Pi image \d+$/, exact: true }),
		).toHaveCount(0);
		expect(mutations).toEqual(["/api/pair", "/api/forget"]);
		const oldDevice = await browser.newContext({
			baseURL: "http://127.0.0.1:4393",
		});
		try {
			await oldDevice.addCookies([cookie]);
			expect((await oldDevice.request.get("/api/snapshot")).status()).toBe(401);
			// Restart uses a separately paired temporary reader, never a fixture auth bypass.
			const admin = await browser.newContext({
				baseURL: "http://127.0.0.1:4393",
			});
			try {
				expect(
					(
						await admin.request.post("/api/pair", {
							headers: { Origin: pairingHeaders.Origin, "x-c2-csrf": "pair" },
							data: { code: await freshCode(), remember: false },
						})
					).status(),
				).toBe(200);
				await admin.request.post("/api/fixture/restart");
				// The new owner rejects the temporary reader; the revoked cookie alone was already 401 before restart.
				await expect
					.poll(async () => {
						try {
							return (await admin.request.get("/api/snapshot")).status();
						} catch {
							return 0;
						}
					})
					.toBe(401);
				expect((await oldDevice.request.get("/api/snapshot")).status()).toBe(
					401,
				);
			} finally {
				await admin.close();
			}
			const staleReader = await oldDevice.newPage();
			await staleReader.goto(address);
			await expect(staleReader.getByLabel("Pairing code")).toBeVisible();
		} finally {
			await oldDevice.close();
		}
		await reader.close();
	} finally {
		await forgetPairedContext(context);
	}
});

for (const failure of ["network", "503"])
	test(`P3 SSE ${failure} probe keeps remembered trust and cached read-only content without commands`, async ({
		page,
		context,
	}) => {
		await page.goto("/");
		await pairDevice(page);
		try {
			const list = await (await context.request.get("/api/snapshot")).json();
			const owner = list.sessions.find(
				(s: { session: string }) => s.session === "Browser test",
			);
			await chooseSession(page, owner.instance);
			await expect(
				page.locator("header").getByText("Pi idle", { exact: true }),
			).toBeVisible();
			const posts: string[] = [];
			page.on("request", (req) => {
				if (req.method() === "POST") posts.push(new URL(req.url()).pathname);
			});
			let probe!: () => void;
			const probed = new Promise<void>((resolve) => (probe = resolve));
			await page.route(
				"**/api/snapshot?*",
				async (route) => {
					if (failure === "network") await route.abort();
					else
						await route.fulfill({
							status: 503,
							json: { error: "Authentication unavailable" },
						});
					probe();
				},
				{ times: 1 },
			);
			await context.request.post("/api/fixture/break-transport");
			await probed;
			await expect(
				page.getByRole("button", { name: /^Open sessions:/ }),
			).toBeVisible();
			await expect(
				page.getByRole("img", { name: /^Native Pi image \d+$/, exact: true }),
			).toBeVisible();
			await expect(
				page.locator("header").getByText("Pi idle", { exact: true }),
			).toBeVisible({ timeout: 15000 });
			// Replay-only transport opening cannot make the departed native observation actionable.
			const draft = page.getByLabel("Text for selected Pi (local draft)");
			await draft.fill("keep read-only after failed native probe");
			await expect(draft).toHaveAccessibleDescription(/Disconnected/);
			await expect(
				page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
			).toBeDisabled();
			await page.waitForTimeout(250);
			expect(posts).toEqual([]);
			expect((await context.request.get("/api/snapshot")).status()).toBe(200);
		} finally {
			await forgetPairedContext(context);
		}
	});

test("P3 Forget shares synchronous admission and disables all competing native actions until confirmed", async ({
	page,
	context,
}) => {
	await page.goto("/");
	await pairDevice(page);
	try {
		await context.request.post("/api/fixture/stop-state", {
			data: { action: "reset" },
		});
		const list = await (await context.request.get("/api/snapshot")).json();
		await chooseSession(
			page,
			list.sessions.find(
				(s: { session: string }) => s.session === "Browser test",
			).instance,
		);
		await page
			.getByLabel("Text for selected Pi (local draft)")
			.fill("not sent");
		await expect(
			page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
		).toBeEnabled();
		let entered!: () => void, release!: () => void;
		const ready = new Promise<void>((resolve) => (entered = resolve)),
			held = new Promise<void>((resolve) => (release = resolve));
		const posts: string[] = [];
		page.on("request", (req) => {
			if (req.method() === "POST") posts.push(new URL(req.url()).pathname);
		});
		await page.route(
			"**/api/forget",
			async (route) => {
				entered();
				await held;
				const response = await route.fetch();
				await route.fulfill({ response });
			},
			{ times: 1 },
		);
		await page.getByRole("button", { name: /^Open sessions:/ }).click();
		await page.getByRole("button", { name: "Forget this device" }).click();
		await ready;
		await expect(
			page.getByRole("button", { name: "Forget this device" }),
		).toBeDisabled();
		await expect(page.getByLabel("Pairing code")).toHaveCount(0);
		await page.getByRole("button", { name: "Close sessions" }).click();
		await expect(
			page.getByRole("button", { name: /^(Send|Steer)$/, exact: true }),
		).toBeDisabled();
		await page
			.getByRole("button", { name: /^(Send|Steer)$/, exact: true })
			.evaluate((button: HTMLButtonElement) => button.click());
		expect(posts).toEqual(["/api/forget"]);
		release();
		await expect(page.getByLabel("Pairing code")).toBeVisible();
		expect(posts).toEqual(["/api/forget"]);
	} finally {
		await forgetPairedContext(context);
	}
});

test("P3 real replaced/reused codes and safe invalid-expired-used-locked/status/network errors clear the six-digit field without retries", async ({
	page,
	context,
}) => {
	await page.goto("/");
	const stale = await freshCode(),
		valid = await freshCode();
	await page.getByLabel("Pairing code").fill(stale);
	await page.getByRole("button", { name: "Pair this device" }).click();
	await expect(
		page.getByText(/Code invalid, expired, already used or locked/),
	).toBeVisible();
	await expect(page.getByLabel("Pairing code")).toHaveValue("");
	await page.getByLabel("Pairing code").fill(valid);
	try {
		await page.getByRole("button", { name: "Pair this device" }).click();
		await expect(
			page.getByRole("button", { name: /^Open sessions:/ }),
		).toBeVisible();
		await sidebarClick(page, "Forget this device");
		await page.getByLabel("Pairing code").fill(valid);
		await page.getByRole("button", { name: "Pair this device" }).click();
		await expect(
			page.getByText(/Code invalid, expired, already used or locked/),
		).toBeVisible();
		// Exact lock/rate policy is owned by auth.test.ts and pairing.test.ts; 401 here proves UI feedback.
		for (const status of [429, 503, 401, 0]) {
			let attempts = 0;
			await page.route(
				"**/api/pair",
				async (route) => {
					attempts++;
					const body = route.request().postDataJSON();
					expect(
						body.code === "012345" &&
							body.remember === false &&
							Object.keys(body).length === 2,
					).toBe(true);
					if (!status) await route.abort();
					else
						await route.fulfill({
							status,
							json: { error: "Safe generic error" },
						});
				},
				{ times: 1 },
			);
			await page.getByLabel("Remember this device").uncheck();
			await page.getByLabel("Pairing code").fill("012345");
			await page.getByRole("button", { name: "Pair this device" }).click();
			await expect(page.getByLabel("Pairing code")).toHaveValue("");
			await expect(page.getByRole("alert")).toContainText(
				status === 429
					? "Pairing limit reached"
					: status === 503
						? "Pairing unavailable"
						: status === 401
							? "Code invalid"
							: "outcome unknown",
			);
			await page.waitForTimeout(150);
			expect(attempts).toBe(1);
		}
	} finally {
		await forgetPairedContext(context);
	}
});

test.afterEach(async ({ context }, info) => {
	if (info.title.startsWith("Native rename")) {
		expect((await context.request.get("/api/snapshot")).status()).toBe(200);
		await context.request.post("/api/fixture/restart");
		await expect
			.poll(async () => {
				try {
					return (await context.request.get("/api/snapshot")).status();
				} catch {
					return 0;
				}
			})
			.toBe(401);
		await forgetPairedContext(context);
	}
});

async function renameSetup(page: Page, context: BrowserContext) {
	await page.goto("/");
	await pairDevice(page, false);
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "reset" },
	});
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "reset" },
	});
	const response = await context.request.get("/api/snapshot");
	expect(response.status()).toBe(200);
	const view = await response.json();
	const owner = view.sessions.find(
		(s: { rename?: boolean }) => s.rename === true,
	);
	const other = view.sessions.find(
		(s: { session: string }) => s.session === "Browser other",
	);
	expect(owner).toBeDefined();
	expect(other).toBeDefined();
	await chooseSession(page, owner.instance);
	await expect(
		page.getByRole("button", { name: /^Open sessions: Browser test/ }),
	).toBeVisible();
	return {
		owner,
		other,
		dialog: page.getByRole("dialog", { name: "Live sessions" }),
	};
}

test("Native rename selected drawer Save/Cancel/Escape preserves draft, keyboard focus and observed working name at 320px", async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 320, height: 568 });
	const { dialog } = await renameSetup(page, context);
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("Keep composer draft");
	const mutations: string[] = [];
	page.on("request", (req) => {
		if (
			/\/api\/(control|rename|text|stop|image)$/.test(req.url()) &&
			req.method() === "POST"
		)
			mutations.push(req.url());
	});
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await expect(
		dialog.locator(".session-card [aria-current=true] strong"),
	).toHaveText("Browser test");
	const rename = dialog.getByRole("button", {
		name: "Rename session",
		exact: true,
	});
	await dialog.evaluate(async (node) => {
		await Promise.all(
			node.getAnimations().map((animation) => animation.finished),
		);
	});
	await expect(
		dialog.getByRole("region", { name: "Input details" }),
	).toHaveCount(0);
	await expect(
		dialog
			.getByRole("region", { name: "Device access" })
			.getByRole("button", { name: "Forget this device" }),
	).toBeVisible();
	const footer = dialog.locator(".drawer-footer");
	const leave = footer.getByRole("button", {
		name: "Leave session",
		exact: true,
	});
	expect((await leave.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	expect((await footer.boundingBox())!.y).toBeGreaterThanOrEqual(
		(await dialog
			.getByRole("navigation", { name: "Terminal sessions" })
			.boundingBox())!.y +
			(await dialog
				.getByRole("navigation", { name: "Terminal sessions" })
				.boundingBox())!.height,
	);
	const renameBox = (await rename.boundingBox())!;
	expect(renameBox.width).toBeGreaterThanOrEqual(44);
	expect(renameBox.height).toBeGreaterThanOrEqual(44);
	const cardBox = (await rename.locator("..").boundingBox())!;
	expect(renameBox.x + renameBox.width).toBeCloseTo(
		cardBox.x + cardBox.width,
		0,
	);
	const cardBorder = await rename
		.locator("..")
		.evaluate((node) => parseFloat(getComputedStyle(node).borderTopWidth));
	expect(renameBox.y).toBeCloseTo(cardBox.y + cardBorder, 0);
	expect(
		await rename.evaluate(
			(node) =>
				!!node.closest(".session-card")?.querySelector("[aria-current=true]"),
		),
	).toBe(true);
	await rename.click();
	const name = dialog.getByLabel("Session name", { exact: true });
	await expect(name).toHaveValue("Browser test");
	await expect(name).toBeFocused();
	await name.fill("Canceled title");
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(
		dialog.getByRole("button", { name: "Rename session", exact: true }),
	).toBeFocused();
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await expect(name).toHaveValue("Browser test");
	await name.press("Escape");
	await expect(name).toBeHidden();
	await expect(dialog).toBeVisible();
	expect(mutations).toEqual([]);
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "work" },
	});
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await name.fill(" ");
	await expect(
		dialog.getByRole("button", { name: "Save", exact: true }),
	).toBeDisabled();
	await name.fill("x".repeat(121));
	await expect(
		dialog.getByRole("button", { name: "Save", exact: true }),
	).toBeDisabled();
	await name.fill("Manual working title");
	const bounds = await name.boundingBox();
	expect(bounds!.width).toBeGreaterThan(44);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
	await name.press("Enter");
	await expect(
		dialog.getByText("Native name observed", { exact: true }),
	).toBeVisible();
	await expect(
		dialog.getByRole("group", { name: /Manual working title · / }),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await dialog.getByRole("button", { name: "Close sessions" }).click();
	await expect(
		page.getByRole("button", { name: /^Open sessions: Manual working title/ }),
	).toBeVisible();
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveValue("Keep composer draft");
	const counts = await (
		await context.request.get("/api/fixture/dispatches")
	).json();
	expect(counts.renames).toBe(1);
	expect(counts.primaryName).toBe("Manual working title");
	expect(mutations.filter((url) => url.endsWith("/api/rename"))).toHaveLength(
		1,
	);
	expect(
		mutations.filter((url) => /\/api\/(text|image|stop)$/.test(url)),
	).toEqual([]);
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "reset" },
	});
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "reset" },
	});
});

test("Native rename retains uncertain original without resend, survives switching/disconnect and does not block Stop", async ({
	page,
	context,
}) => {
	const { owner, other, dialog } = await renameSetup(page, context);
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("Uncertain rename keeps draft");
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "work" },
	});
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "ignore" },
	});
	let posts = 0;
	page.on("request", (req) => {
		if (req.url().endsWith("/api/rename")) posts++;
	});
	await page.route(
		"**/api/rename",
		async (route) => {
			await route.fetch();
			await route.abort();
		},
		{ times: 1 },
	);
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await dialog
		.getByLabel("Session name", { exact: true })
		.fill("Uncertain original title");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		dialog.getByText(/Uncertain — response lost; original name retained/),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Save", exact: true }),
	).toBeDisabled();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await chooseSession(page, other.instance);
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await expect(
		dialog.getByRole("button", { name: "Rename session", exact: true }),
	).toBeDisabled();
	await expect(dialog.getByText(/Uncertain — response lost/)).toBeHidden();
	await chooseSession(page, owner.instance);
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await expect(dialog.getByLabel("Session name", { exact: true })).toHaveValue(
		"Uncertain original title",
	);
	await dialog.getByRole("button", { name: "Close sessions" }).click();
	await expect(
		page.getByRole("button", { name: "Stop", exact: true }),
	).toBeEnabled();
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(
		page.locator("header").getByText("Stopping", { exact: true }),
	).toBeVisible();
	await context.request.post("/api/fixture/break-transport");
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveAccessibleDescription(/Disconnected — cached content is read-only/);
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveAccessibleDescription("Stopping — draft only until Pi is idle.", {
		timeout: 15000,
	});
	expect(posts).toBe(1);
	const counts = await (
		await context.request.get("/api/fixture/dispatches")
	).json();
	expect(counts.renames).toBe(1);
	expect(counts.primaryName).toBe("Browser test");
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveValue("Uncertain rename keeps draft");
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "reset" },
	});
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "reset" },
	});
});

test("Native rename preparation cannot redirect after session switch or control race; proven unnamed only is empty", async ({
	page,
	context,
}) => {
	const { owner, other, dialog } = await renameSetup(page, context);
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "unnamed" },
	});
	await expect(
		dialog.getByRole("group", { name: /Unnamed session · / }),
	).toBeVisible();
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await expect(dialog.getByLabel("Session name", { exact: true })).toHaveValue(
		"",
	);
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "literal" },
	});
	await expect
		.poll(async () => {
			const view = await (await context.request.get("/api/snapshot")).json();
			return view.sessions.find(
				(s: { instance: string }) => s.instance === owner.instance,
			).unnamed;
		})
		.toBe(false);
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await expect(dialog.getByLabel("Session name", { exact: true })).toHaveValue(
		"Unnamed session",
	);
	await dialog
		.getByLabel("Session name", { exact: true })
		.fill("Must not redirect");
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let captured!: () => void;
	const ready = new Promise<void>((resolve) => {
		captured = resolve;
	});
	await page.route(
		"**/api/control",
		async (route) => {
			if (route.request().postDataJSON().action !== "claim")
				return route.continue();
			const response = await route.fetch();
			captured();
			await held;
			await route.fulfill({ response });
		},
		{ times: 1 },
	);
	let posts = 0;
	page.on("request", (req) => {
		if (req.url().endsWith("/api/rename")) posts++;
	});
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await ready;
	const discardedClaim = page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/control") &&
			response.request().postDataJSON().action === "release" &&
			response.request().postDataJSON().generation === owner.generation,
	);
	await chooseSession(page, other.instance);
	release();
	expect((await discardedClaim).ok()).toBe(true);
	await expect(
		page.getByRole("button", { name: /^Open sessions: Browser other/ }),
	).toBeVisible();
	await chooseSession(page, owner.instance);
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await expect(
		dialog.getByText("Not sent — control or session changed", { exact: true }),
	).toBeVisible();
	expect(posts).toBe(0);
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await dialog
		.getByLabel("Session name", { exact: true })
		.fill("Must not win takeover");
	let releaseRace!: () => void, capturedRace!: () => void;
	const raceHold = new Promise<void>((resolve) => {
		releaseRace = resolve;
	});
	const raceReady = new Promise<void>((resolve) => {
		capturedRace = resolve;
	});
	await page.route(
		"**/api/control",
		async (route) => {
			if (route.request().postDataJSON().action !== "claim")
				return route.continue();
			const response = await route.fetch();
			capturedRace();
			await raceHold;
			await route.fulfill({ response });
		},
		{ times: 1 },
	);
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await raceReady;
	const takeover = await context.request.post("/api/control", {
		headers: { origin: "http://127.0.0.1:4393", "x-c2-csrf": "input" },
		data: {
			instance: owner.instance,
			generation: owner.generation,
			action: "takeover",
		},
	});
	expect(takeover.ok()).toBe(true);
	releaseRace();
	await expect(
		dialog.getByText("Not sent — control or session changed", { exact: true }),
	).toBeVisible();
	expect(posts).toBe(0);
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "reset" },
	});
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "reset" },
	});
});

test("Native rename disconnect invalidates captured preparation before forwarding", async ({
	page,
	context,
}) => {
	const { dialog } = await renameSetup(page, context);
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("Network departure draft");
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await dialog
		.getByLabel("Session name", { exact: true })
		.fill("Do not send after disconnect");
	let release!: () => void, captured!: () => void;
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	const ready = new Promise<void>((resolve) => {
		captured = resolve;
	});
	await page.route(
		"**/api/control",
		async (route) => {
			const response = await route.fetch();
			captured();
			await hold;
			await route.fulfill({ response });
		},
		{ times: 1 },
	);
	let posts = 0;
	page.on("request", (req) => {
		if (req.url().endsWith("/api/rename")) posts++;
	});
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await ready;
	await context.request.post("/api/fixture/break-transport");
	await expect(
		dialog.getByText("Disconnected — rename unavailable.", { exact: true }),
	).toBeVisible();
	release();
	await expect(
		dialog.getByText("Not sent — control or session changed", { exact: true }),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Rename session", exact: true }),
	).toBeEnabled({ timeout: 15000 });
	expect(posts).toBe(0);
	await expect(dialog.getByLabel("Session name", { exact: true })).toHaveValue(
		"Do not send after disconnect",
	);
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await dialog.getByRole("button", { name: "Close sessions" }).click();
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveValue("Network departure draft");
});

for (const cancellation of ["Cancel", "Escape"] as const) {
	test(`Native rename ${cancellation} alone cancels held authority preparation without forwarding`, async ({
		page,
		context,
	}) => {
		const { owner, dialog } = await renameSetup(page, context);
		await page.getByRole("button", { name: /^Open sessions:/ }).click();
		await dialog
			.getByRole("button", { name: "Rename session", exact: true })
			.click();
		const name = dialog.getByLabel("Session name", { exact: true });
		await name.fill(`Canceled by ${cancellation} only`);
		let release!: () => void, captured!: () => void;
		const hold = new Promise<void>((resolve) => {
			release = resolve;
		});
		const ready = new Promise<void>((resolve) => {
			captured = resolve;
		});
		await page.route(
			"**/api/control",
			async (route) => {
				expect(route.request().postDataJSON()).toEqual({
					instance: owner.instance,
					generation: owner.generation,
					action: "claim",
				});
				const response = await route.fetch();
				captured();
				await hold;
				await route.fulfill({ response });
			},
			{ times: 1 },
		);
		const posts: unknown[] = [];
		page.on("request", (req) => {
			if (req.url().endsWith("/api/rename")) posts.push(req.postDataJSON());
		});
		await dialog.getByRole("button", { name: "Save", exact: true }).click();
		await ready;
		if (cancellation === "Cancel")
			await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		else
			await dialog
				.getByRole("button", { name: "Cancel", exact: true })
				.press("Escape");
		await expect(name).toBeHidden();
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Close sessions" }),
		).toBeFocused();
		await expectSelected(page, owner.instance);
		release();
		await expect(
			dialog.getByText("Not sent — rename canceled", { exact: true }),
		).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Rename session", exact: true }),
		).toBeEnabled();
		await expectSelected(page, owner.instance);
		expect(posts).toEqual([]);
		const counts = await (
			await context.request.get("/api/fixture/dispatches")
		).json();
		expect(counts.renames).toBe(0);
		expect(counts.primaryName).toBe("Browser test");
		await dialog
			.getByRole("button", { name: "Rename session", exact: true })
			.click();
		await expect(name).toHaveValue("Browser test");
		await expect(
			dialog.getByRole("button", { name: "Save", exact: true }),
		).toBeEnabled();
	});
}

test("Native rename replacement generation admits a new explicit name without replaying the unresolved original", async ({
	page,
	context,
}) => {
	const { owner, dialog } = await renameSetup(page, context);
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "ignore" },
	});
	const posts: {
		instance: string;
		generation: string;
		name: string;
		requestId: string;
	}[] = [];
	page.on("request", (req) => {
		if (req.url().endsWith("/api/rename")) posts.push(req.postDataJSON());
	});
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await dialog
		.getByLabel("Session name", { exact: true })
		.fill("Old generation uncertain name");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		dialog.getByText(/Uncertain — original name retained; no resend/),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Save", exact: true }),
	).toBeDisabled();
	// Wait for the existing departure release to leave instance admission before a fresh claim.
	const oldRelease = page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/control") &&
			response.request().postDataJSON().action === "release" &&
			response.request().postDataJSON().generation === owner.generation,
	);
	await context.request.post("/api/fixture/stop-state", {
		data: { action: "reset" },
	});
	await oldRelease;
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "apply" },
	});
	const view = await (await context.request.get("/api/snapshot")).json();
	const replacement = view.sessions.find(
		(s: { instance: string }) => s.instance === owner.instance,
	);
	expect(replacement.generation).not.toBe(owner.generation);
	await expect
		.poll(() =>
			new URLSearchParams(new URL(page.url()).hash.slice(1)).get("session"),
		)
		.toBe(`${owner.instance}:${replacement.generation}`);
	await expect(
		dialog.getByRole("button", { name: "Rename session", exact: true }),
	).toBeEnabled();
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await expect(dialog.getByLabel("Session name", { exact: true })).toHaveValue(
		"Browser test",
	);
	await expect(
		dialog.getByText(/Uncertain — original name retained/),
	).toBeHidden();
	await dialog
		.getByLabel("Session name", { exact: true })
		.fill("Fresh generation explicit name");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		dialog.getByText("Native name observed", { exact: true }),
	).toBeVisible();
	expect(
		posts.map(({ instance, generation, name }) => ({
			instance,
			generation,
			name,
		})),
	).toEqual([
		{
			instance: owner.instance,
			generation: owner.generation,
			name: "Old generation uncertain name",
		},
		{
			instance: owner.instance,
			generation: replacement.generation,
			name: "Fresh generation explicit name",
		},
	]);
	expect(posts[0].requestId).toMatch(/^[a-f0-9]{32}$/);
	expect(posts[1].requestId).toMatch(/^[a-f0-9]{32}$/);
	expect(posts[1].requestId).not.toBe(posts[0].requestId);
	const counts = await (
		await context.request.get("/api/fixture/dispatches")
	).json();
	expect(counts.renames).toBe(2);
	expect(counts.primaryName).toBe("Fresh generation explicit name");
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "reset" },
	});
});

test("Native rename uncertainty stays with capable owner A while B saves, and reopening A retains the original despite terminal name changes", async ({
	page,
	context,
}) => {
	const { owner, dialog } = await renameSetup(page, context);
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "capable-other" },
	});
	const view = await (await context.request.get("/api/snapshot")).json();
	const other = view.sessions.find(
		(s: { session: string }) => s.session === "Browser other",
	);
	expect(other.rename).toBe(true);
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "ignore" },
	});
	const posts: {
		instance: string;
		generation: string;
		name: string;
		requestId: string;
	}[] = [];
	page.on("request", (req) => {
		if (req.url().endsWith("/api/rename")) posts.push(req.postDataJSON());
	});
	let release!: () => void, captured!: () => void;
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	const ready = new Promise<void>((resolve) => {
		captured = resolve;
	});
	await page.route(
		"**/api/rename",
		async (route) => {
			expect(route.request().postDataJSON()).toMatchObject({
				instance: owner.instance,
				generation: owner.generation,
				name: "Owner A unresolved original",
			});
			await route.fetch();
			captured();
			await hold;
			await route.abort();
		},
		{ times: 1 },
	);
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await dialog
		.getByLabel("Session name", { exact: true })
		.fill("Owner A unresolved original");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await ready; // The native setter has already been attempted; Cancel cannot undo this.
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await chooseSession(page, other.instance);
	release();
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await expect(
		dialog.getByRole("button", { name: "Rename session", exact: true }),
	).toBeEnabled();
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await expect(dialog.getByLabel("Session name", { exact: true })).toHaveValue(
		"Browser other",
	);
	await expect(dialog.getByText(/Uncertain — response lost/)).toBeHidden();
	await dialog
		.getByLabel("Session name", { exact: true })
		.fill("Owner B explicit native name");
	await expect(
		dialog.getByRole("button", { name: "Save", exact: true }),
	).toBeEnabled();
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		dialog.getByText("Native name observed", { exact: true }),
	).toBeVisible();
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "terminal-name" },
	});
	await chooseSession(page, owner.instance);
	await expect(
		page.getByRole("button", {
			name: /^Open sessions: Terminal changed title/,
		}),
	).toBeVisible();
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await expect(dialog.getByLabel("Session name", { exact: true })).toHaveValue(
		"Owner A unresolved original",
	);
	await expect(
		dialog.getByText(/Uncertain — response lost; original name retained/),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Save", exact: true }),
	).toBeDisabled();
	await chooseSession(page, other.instance);
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await dialog
		.getByRole("button", { name: "Rename session", exact: true })
		.click();
	await expect(dialog.getByLabel("Session name", { exact: true })).toHaveValue(
		"Owner B explicit native name",
	);
	await expect(
		dialog.getByRole("button", { name: "Save", exact: true }),
	).toBeEnabled();
	await expect(dialog.getByText(/Uncertain — response lost/)).toBeHidden();
	expect(
		posts.map(({ instance, generation, name }) => ({
			instance,
			generation,
			name,
		})),
	).toEqual([
		{
			instance: owner.instance,
			generation: owner.generation,
			name: "Owner A unresolved original",
		},
		{
			instance: other.instance,
			generation: other.generation,
			name: "Owner B explicit native name",
		},
	]);
	expect(posts[0].requestId).toMatch(/^[a-f0-9]{32}$/);
	expect(posts[1].requestId).not.toBe(posts[0].requestId);
	const counts = await (
		await context.request.get("/api/fixture/dispatches")
	).json();
	expect(counts.renames).toBe(1);
	expect(counts.otherRenames).toBe(1);
	expect(counts.primaryName).toBe("Terminal changed title");
	expect(counts.secondaryName).toBe("Owner B explicit native name");
	await context.request.post("/api/fixture/rename-state", {
		data: { action: "reset" },
	});
});
