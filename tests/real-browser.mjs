// Only called by the explicit isolated real-Pi test. No arbitrary URL/capture input.
import { chromium, webkit } from "playwright";
import { readFileSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const [mode, root] = process.argv.slice(2);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (mode === "capture") {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({
			viewport: { width: 240, height: 160 },
			deviceScaleFactor: 1,
		});
		await page.setContent(
			'<!doctype html><html><head><style>body{margin:0;background:#102a43;color:#fff;font:18px sans-serif}main{padding:20px}b{color:#ffd166}.square{width:70px;height:40px;background:#06d6a0;margin-top:14px}</style></head><body><main><b>C2 screenshot</b><div>Controlled browser</div><div class="square"></div></main></body></html>',
		);
		const bytes = await page.screenshot({
			path: join(root, "cwd", "fixture.png"),
		});
		chmodSync(join(root, "cwd", "fixture.png"), 0o600);
		mkdirSync("test-results", { recursive: true });
		writeFileSync("test-results/controlled-fixture.png", bytes);
		console.log(
			JSON.stringify({
				kind: "Playwright controlled-page screenshot",
				width: 240,
				height: 160,
				bytes: bytes.length,
				sha256: hash(bytes),
			}),
		);
	} finally {
		await browser.close();
	}
} else if (["background-switch", "background-recover"].includes(mode)) {
	const base = "http://127.0.0.1:4394";
	const owners = JSON.parse(readFileSync(join(root, "background-owners.json"), "utf8"));
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext();
		const page = await context.newPage();
		const streams = [];
		page.on("request", request => {
			const url = new URL(request.url());
			if (url.pathname === "/api/events") streams.push(url.searchParams.get("instance"));
		});
		await page.goto(base);
		await page.getByLabel("Terminal pairing secret").fill(process.env.C2_TEST_SECRET);
		await page.getByRole("button", { name: "Pair browser" }).click();
		await page.waitForFunction(() => document.querySelector("#session")?.options.length === 3);
		const order = mode === "background-switch" ? [owners.a, owners.b, owners.a] : [owners.a];
		for (const owner of order) {
			const before = streams.length;
			const selectedStream = page.waitForRequest(request => {
				const url = new URL(request.url());
				return url.pathname === "/api/events" && url.searchParams.get("instance") === owner.instance && url.searchParams.get("generation") === owner.generation;
			});
			await page.getByLabel("Select live session").selectOption(owner.instance);
			await selectedStream;
			await page.waitForFunction(() => document.querySelector("header")?.textContent.includes("Parent: idle"));
			await page.waitForFunction(() => !document.body.textContent.includes("Selected conversation disconnected or unavailable."));
			if (!streams.slice(before).includes(owner.instance)) throw Error("Selected SSE missing");
			const view = await (await context.request.get(`${base}/api/snapshot?instance=${owner.instance}&generation=${owner.generation}`)).json();
			if (view.connection !== "connected" || view.snapshot?.instance !== owner.instance || view.snapshot?.generation !== owner.generation || view.snapshot.parent !== "idle" || view.snapshot.background !== "unobserved" || view.conflict)
				throw Error("Wrong owner or misleading background status");
		}
		if (await page.evaluate(() => localStorage.length + sessionStorage.length)) throw Error("Private browser state persisted");
		await page.close(); // Real selected EventSource disconnect, not a synthetic server callback.
		await context.close();
		console.log(JSON.stringify({ selectedOwners: mode === "background-switch" ? ["a", "b", "a"] : ["a"], shippedUiAuthSse: true, parentIdleBackgroundUnobserved: true, browserClosed: true }));
	} finally {
		await browser.close();
	}
} else if (["assert", "reload", "disconnect"].includes(mode)) {
	const base = "http://127.0.0.1:4394";
	const owners = ["a", "b"].map((owner) => ({
		owner,
		fixture: readFileSync(join(root, owner, "cwd", "fixture.png")),
		settled: JSON.parse(
			readFileSync(join(root, owner, "settled-copy.json"), "utf8"),
		),
	}));
	const evidence = [];
	for (const [engine, browserType] of mode === "assert"
		? [
				["chromium", chromium],
				["webkit", webkit],
			]
		: [["chromium", chromium]]) {
		const browser = await browserType.launch();
		try {
			const context = await browser.newContext({
				viewport: { width: 390, height: 844 },
			});
			const page = await context.newPage();
			await page.goto(base);
			await page
				.getByLabel("Terminal pairing secret")
				.fill(process.env.C2_TEST_SECRET);
			await page.getByRole("button", { name: "Pair browser" }).click();
			await page.waitForFunction(
				() => document.querySelector("#session")?.options.length === 3,
			);
			const list = await (
				await context.request.get(base + "/api/snapshot")
			).json();
			if (list.sessions.length !== 2 || list.snapshot)
				throw Error("Expected two lightweight live owners");
			const snapshots = await Promise.all(
				list.sessions.map(async (identity) =>
					(
						await context.request.get(
							`${base}/api/snapshot?instance=${identity.instance}&generation=${identity.generation}`,
						)
					).json(),
				),
			);
			const identities = owners.map((owner) => {
				const view = snapshots.find((view) =>
					view.snapshot.items.some((item) =>
						item.id.endsWith(":" + owner.settled.branch.resultEntryId),
					),
				);
				if (!view) throw Error("Native owner not found");
				return { ...owner, snapshot: view.snapshot };
			});
			async function check(page, owner, enlarge = true) {
				const { snapshot, fixture, settled } = owner;
				await page
					.getByLabel("Select live session")
					.selectOption(snapshot.instance);
				await page.waitForFunction(
					(generation) =>
						document
							.querySelector("article[data-native-item]")
							?.dataset.nativeItem.startsWith(generation + ":"),
					snapshot.generation,
				);
				const image = page.getByRole("img", {
					name: "Native Pi image",
					exact: true,
				});
				await image.scrollIntoViewIfNeeded();
				await image.waitFor();
				await page.waitForFunction(
					() => document.querySelector("article img")?.naturalWidth === 240,
				);
				const ids = await page
					.locator("article")
					.evaluateAll((nodes) => nodes.map((node) => node.dataset.nativeItem));
				if (
					new Set(ids).size !== ids.length ||
					ids.length !== snapshot.items.length ||
					!ids.includes(
						snapshot.generation + ":" + settled.branch.resultEntryId,
					)
				)
					throw Error("Native branch duplication or mismatch");
				const item = snapshot.items.find((item) =>
					item.id.endsWith(":" + settled.branch.resultEntryId),
				);
				const block = item.blocks.find((block) => block.type === "image");
				const path = `/api/media/${snapshot.instance}/${snapshot.generation}/${block.ref}`;
				const bytes = await (await context.request.get(base + path)).body();
				if (!bytes.equals(fixture)) throw Error("Native bytes mismatch");
				if (enlarge) {
					const inlineWidth = await image.evaluate(
						(img) => img.getBoundingClientRect().width,
					);
					await page
						.getByRole("button", { name: "Enlarge native Pi image" })
						.click();
					await page.locator(".pswp--open").waitFor();
					await page.waitForFunction(
						(width) =>
							Array.from(document.querySelectorAll(".pswp__img")).some(
								(img) =>
									img.naturalWidth === 240 &&
									img.getBoundingClientRect().width > width,
							),
						inlineWidth,
					);
					await page.screenshot({
						path: `test-results/real-pi-${engine}-${owner.owner}-enlarged.png`,
					});
					await page.keyboard.press("Escape");
					await page.locator(".pswp--open").waitFor({ state: "detached" });
					await page.screenshot({
						path: `test-results/real-pi-${engine}-${owner.owner}-inline.png`,
					});
				}
				return {
					engine,
					owner: owner.owner,
					nativeEntryMatch: true,
					inline: true,
					enlarged: enlarge,
					noDuplicates: true,
					bytes: bytes.length,
					sha256: hash(bytes),
					instance: snapshot.instance,
					generation: snapshot.generation,
					ref: block.ref,
					entry: settled.branch.resultEntryId,
				};
			}
			const [a, b] = identities;
			if (a.snapshot.instance === b.snapshot.instance)
				throw Error("Owners mixed");
			if (mode === "assert") {
				evidence.push(await check(page, a));
				evidence.push(await check(page, b));
				await check(page, a, false); // A -> B -> A, same-image collisions stay native scoped.
				const tab = await context.newPage();
				await tab.goto(base);
				await check(tab, b, false);
				const aId = await page
					.locator("article")
					.first()
					.getAttribute("data-native-item");
				if (!aId.startsWith(a.snapshot.generation + ":"))
					throw Error("Tabs interfered");
				if (
					(
						await context.request.get(
							`${base}/api/media/${b.snapshot.instance}/${b.snapshot.generation}/${evidence.at(-2).ref}`,
						)
					).status() !== 410
				)
					throw Error("Cross-owner media accepted");
				await tab.close();
			} else {
				const chosen = mode === "reload" ? a : b;
				const before = await check(page, chosen, false);
				const tab = await context.newPage();
				await tab.goto(base);
				await check(tab, mode === "reload" ? b : a, false);
				writeFileSync(join(root, "browser-ready"), "ready", { mode: 0o600 });
				if (mode === "reload") {
					await page.waitForFunction(
						(old) =>
							document.querySelector("article[data-native-item]") &&
							!document
								.querySelector("article[data-native-item]")
								.dataset.nativeItem.startsWith(old + ":"),
						before.generation,
					);
					await page.waitForFunction(
						() => document.querySelector("article img")?.naturalWidth === 240,
					);
					const listAfter = await (
						await context.request.get(base + "/api/snapshot")
					).json();
					const fresh = listAfter.sessions.find(
						(session) => session.instance === a.snapshot.instance,
					);
					const after = await (
						await context.request.get(
							`${base}/api/snapshot?instance=${fresh.instance}&generation=${fresh.generation}`,
						)
					).json();
					if (
						fresh.generation === before.generation ||
						listAfter.sessions.find(
							(session) => session.instance === b.snapshot.instance,
						).generation !== b.snapshot.generation
					)
						throw Error("Reload scope mismatch");
					if (
						(
							await context.request.get(
								`${base}/api/media/${before.instance}/${before.generation}/${before.ref}`,
							)
						).status() !== 410
					)
						throw Error("Stale reload media accepted");
					evidence.push(
						await check(page, { ...a, snapshot: after.snapshot }, false),
					);
				} else {
					await page
						.getByText(
							"Selected conversation disconnected or unavailable. Cached content is not live.",
							{ exact: true },
						)
						.waitFor();
					await page.waitForFunction(
						(instance) =>
							document.querySelector("#session").value === instance &&
							document.querySelector("#session").options.length === 3,
						b.snapshot.instance,
					);
					if (
						(await page.locator("article").count()) !== b.snapshot.items.length
					)
						throw Error("Disconnected content silently replaced");
					evidence.push({
						selectedOwnerDisconnected: true,
						cachedNativeEntriesRetained: true,
						otherOwnerStillLive: true,
					});
				}
				const unchanged = mode === "reload" ? b : a;
				const ids = await tab
					.locator("article")
					.evaluateAll((nodes) => nodes.map((node) => node.dataset.nativeItem));
				if (
					ids.length !== unchanged.snapshot.items.length ||
					!ids.every((id) => id.startsWith(unchanged.snapshot.generation + ":"))
				)
					throw Error("Other owner disturbed");
				await tab.close();
			}
			if (
				(await page.evaluate(
					() => localStorage.length + sessionStorage.length,
				)) !== 0
			)
				throw Error("Browser persisted private state");
			await context.close();
		} finally {
			await browser.close();
		}
	}
	console.log(JSON.stringify(evidence));
} else throw Error("Explicit fixture mode required");
