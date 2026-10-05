import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
// @ts-expect-error Test-only ESM fixture IPC has no declaration file.
import { freshCode } from "./pairing-code.mjs";

async function activateWorker(page: Page) {
	await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.ready;
		if (registration.active?.state !== "activated") {
			await new Promise<void>((resolve) =>
				registration.active!.addEventListener("statechange", () => {
					if (registration.active?.state === "activated") resolve();
				}),
			);
		}
	});
}

async function cacheContents(page: Page) {
	return page.evaluate(async () => {
		const contents: Record<string, string[]> = {};
		for (const name of await caches.keys()) {
			contents[name] = (await (await caches.open(name)).keys())
				.map((request) => new URL(request.url).pathname)
				.sort();
		}
		return contents;
	});
}

const offlineFiles = ["/icon-192.png", "/offline.css", "/offline.html"];

test("U6 manifest, public icons and worker activation clean only old app caches", async ({
	page,
	context,
}) => {
	const manifestResponse = await context.request.get("/manifest.webmanifest");
	expect(manifestResponse.status()).toBe(200);
	expect(manifestResponse.headers()["content-type"]).toContain(
		"application/manifest+json",
	);
	expect(await manifestResponse.json()).toEqual({
		name: "Pi Companion",
		short_name: "Pi Companion",
		id: "/",
		start_url: "/",
		scope: "/",
		display: "standalone",
		theme_color: "#ffffff",
		background_color: "#ffffff",
		icons: [
			{
				src: "/icon-192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/icon-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/icon-maskable-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable",
			},
		],
	});
	for (const [path, size] of [
		["/icon-192.png", 192],
		["/icon-512.png", 512],
		["/icon-maskable-512.png", 512],
		["/apple-touch-icon.png", 180],
	] as const) {
		const response = await context.request.get(path);
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("image/png");
		const image = sharp(await response.body());
		const metadata = await image.metadata();
		expect([
			metadata.format,
			metadata.width,
			metadata.height,
			metadata.hasAlpha,
		]).toEqual(["png", size, size, false]);
		const corner = await image
			.clone()
			.extract({ left: 0, top: 0, width: 1, height: 1 })
			.removeAlpha()
			.raw()
			.toBuffer();
		expect([...corner]).toEqual([23, 23, 23]);
		// The full-bleed background is opaque; maskable foreground stays inside the safe circle.
		if (path.includes("maskable")) {
			const { data, info } = await image
				.removeAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			let ink = 0,
				outside = 0;
			for (let y = 0; y < size; y++)
				for (let x = 0; x < size; x++) {
					if (data[(y * size + x) * info.channels] > 128) {
						ink++;
						if (Math.hypot(x - size / 2, y - size / 2) > size * 0.4) outside++;
					}
				}
			expect(ink).toBeGreaterThan(10000);
			expect(outside).toBe(0);
		}
	}
	await page.goto("/");
	await activateWorker(page);
	expect(
		await page.evaluate(() => navigator.serviceWorker.controller),
	).toBeNull(); // No forced claim.
	expect(await cacheContents(page)).toEqual({
		"pi-companion-offline-v2": offlineFiles,
	});
	await page.reload();
	await expect
		.poll(() =>
			page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
		)
		.toBe("http://127.0.0.1:4393/sw.js");
	expect(
		await page.evaluate(
			async () => (await navigator.serviceWorker.ready).scope,
		),
	).toBe("http://127.0.0.1:4393/");
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
		"href",
		"/manifest.webmanifest",
	);
	await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
		"href",
		"/apple-touch-icon.png",
	);
	await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
		"content",
		"width=device-width,initial-scale=1,viewport-fit=cover",
	);
	await expect(
		page.locator('meta[name="apple-mobile-web-app-capable"]'),
	).toHaveAttribute("content", "yes");
	await expect(
		page.locator('meta[name="apple-mobile-web-app-title"]'),
	).toHaveAttribute("content", "Pi Companion");
	// An API navigation must not receive the offline document or cached privileged data.
	expect(
		await page.evaluate(async () => (await fetch("/api/snapshot")).status),
	).toBe(401);
	expect(
		await page.evaluate(
			async () => (await fetch("/api/text", { method: "POST" })).status,
		),
	).toBe(403);
	// A distinct script URL exercises the browser's real update lifecycle without changing server files.
	await page.evaluate(async () => {
		await (await caches.open("pi-companion-offline-v1")).add("/offline.html");
		await (await caches.open("unrelated-app")).add("/offline.css");
		await navigator.serviceWorker.register("/sw.js?u6-update", {
			scope: "/",
			updateViaCache: "none",
		});
	});
	await expect
		.poll(() =>
			page.evaluate(
				async () =>
					(await navigator.serviceWorker.getRegistration())?.waiting?.scriptURL,
			),
		)
		.toBe("http://127.0.0.1:4393/sw.js?u6-update");
	expect(
		await page.evaluate(
			async () => (await navigator.serviceWorker.ready).active?.scriptURL,
		),
	).toBe("http://127.0.0.1:4393/sw.js");
	await expect(page.getByLabel("Pairing code")).toBeVisible(); // Update did not reload or replace this client.
	expect(await cacheContents(page)).toEqual({
		"pi-companion-offline-v1": ["/offline.html"],
		"pi-companion-offline-v2": offlineFiles,
		"unrelated-app": ["/offline.css"],
	});
	await page.close(); // Release the old controlled client naturally.
	const nextClient = await context.newPage();
	await nextClient.goto("/offline.html"); // This static document does not register another worker.
	await activateWorker(nextClient);
	await expect
		.poll(() =>
			nextClient.evaluate(
				async () => (await navigator.serviceWorker.ready).active?.scriptURL,
			),
		)
		.toBe("http://127.0.0.1:4393/sw.js?u6-update");
	await expect
		.poll(() => cacheContents(nextClient))
		.toEqual({
			"pi-companion-offline-v2": offlineFiles,
			"unrelated-app": ["/offline.css"],
		});
});

for (const mode of [
	"browser",
	"standalone",
	"ios-standalone",
	"registration-failure",
	"registration-throw",
	"install-failure",
	"unsupported",
] as const)
	test(`PWA setup feedback and install help: ${mode}`, async ({
		page,
		context,
	}, testInfo) => {
		await page.setViewportSize({ width: 320, height: 568 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		// Render device access without granting authentication/control or using a live Pi.
		await page.route("**/api/snapshot*", (route) =>
			route.fulfill({ json: { connection: "connected", sessions: [] } }),
		);
		// Fail the actual worker installation lifecycle; worker-initiated asset fetches are not page-routable.
		if (mode === "install-failure")
			await context.route("**/sw.js", (route) =>
				route.fulfill({
					contentType: "application/javascript",
					body: "self.addEventListener('install', event => event.waitUntil(Promise.reject(new Error('Fixture install failure'))));",
				}),
			);
		await page.addInitScript((mode) => {
			Object.defineProperty(window, "EventSource", {
				value: class extends EventTarget {
					onerror = null;
					close() {}
				},
			});
			if (mode === "standalone") {
				const query = window.matchMedia.bind(window);
				window.matchMedia = (name) => {
					const result = query(name);
					if (name === "(display-mode: standalone)")
						Object.defineProperty(result, "matches", { value: true });
					return result;
				};
			}
			if (mode === "ios-standalone")
				Object.defineProperty(navigator, "standalone", { value: true });
			if (mode === "registration-failure")
				Object.defineProperty(navigator.serviceWorker, "register", {
					value: () =>
						Promise.reject(new Error("Private fixture registration failure")),
				});
			if (mode === "registration-throw")
				Object.defineProperty(navigator, "serviceWorker", {
					get() {
						throw new DOMException(
							"Private fixture registration failure",
							"SecurityError",
						);
					},
				});
			if (mode === "unsupported")
				Reflect.deleteProperty(Navigator.prototype, "serviceWorker");
		}, mode);
		const mutations: string[] = [],
			errors: string[] = [];
		page.on("request", (request) => {
			if (request.method() === "POST") mutations.push(request.url());
		});
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto("/");
		await page.getByRole("button", { name: /^Open sessions:/ }).click();
		const device = page.getByRole("region", { name: "Device access" });
		const install = device.getByText("Install on this device", { exact: true });
		if (mode === "standalone" || mode === "ios-standalone")
			await expect(install).toBeHidden();
		else await expect(install).toBeVisible();
		if (
			mode === "registration-failure" ||
			mode === "registration-throw" ||
			mode === "install-failure"
		) {
			await expect(device.getByRole("status")).toHaveText(
				"Offline recovery setup could not be confirmed. You can still use Pi Companion online.",
			);
			await expect(device).not.toContainText(
				"Private fixture registration failure",
			);
		} else if (mode === "unsupported") {
			expect(await page.evaluate(() => "serviceWorker" in navigator)).toBe(
				false,
			);
			await expect(device.getByRole("status")).toHaveText(
				"Offline recovery is not supported in this browser. You can still use Pi Companion online.",
			);
		} else {
			await activateWorker(page);
			await expect(device.getByRole("status")).toHaveCount(0);
		}
		await expect(
			device.getByRole("button", { name: "Forget this device" }),
		).toBeEnabled();
		expect(
			await device.evaluate((node) => node.scrollWidth <= node.clientWidth),
		).toBe(true);
		if (mode === "install-failure")
			await page.screenshot({
				path: testInfo.outputPath("offline-setup-feedback-320.png"),
			});
		await page.getByRole("button", { name: "Close sessions" }).click();
		await expect(
			page.getByRole("dialog", { name: "Live sessions" }),
		).toBeHidden();
		expect(mutations).toEqual([]);
		expect(errors).toEqual([]);
	});

test("U6 gateway cache/API exclusion and no offline mutation replay", async ({
	page,
	context,
	browserName,
}, testInfo) => {
	await page.setViewportSize({ width: 320, height: 568 });
	await page.goto("/");
	await activateWorker(page);
	await page.reload();
	await page.getByLabel("Pairing code").fill(await freshCode());
	await page.getByLabel("Remember this device").uncheck();
	await page
		.getByRole("button", { name: "Pair this device", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: /^Open sessions:/ }),
	).toBeVisible();
	// Existing fixture reset gives each engine a fresh native generation with no previous test's lease.
	expect(
		(
			await context.request.post("/api/fixture/stop-state", {
				data: { action: "reset" },
			})
		).ok(),
	).toBe(true);
	const list = await (await context.request.get("/api/snapshot")).json();
	const owner = list.sessions.find(
		(session: { session: string }) => session.session === "Browser test",
	);
	await page.goto(`/#session=${owner.instance}:${owner.generation}`);
	await page.reload(); // A fragment-only change is not a document launch.
	await expect(page.locator(".image img").first()).toBeVisible();
	await expect
		.poll(() =>
			page
				.locator(".image img")
				.first()
				.evaluate((img: HTMLImageElement) => img.naturalWidth),
		)
		.toBe(1);
	const media = await page.locator(".image img").first().getAttribute("src");
	expect(media).toMatch(/^\/api\/media\//);
	expect(
		await page.evaluate(async (url) => (await fetch(url!)).status, media),
	).toBe(200);
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	const device = page.getByRole("region", { name: "Device access" });
	const installSummary = device.getByText("Install on this device", {
		exact: true,
	});
	await installSummary.focus();
	await page.keyboard.press("Enter");
	expect((await installSummary.boundingBox())!.height).toBeGreaterThanOrEqual(
		44,
	);
	await expect(device).toContainText(
		"Safari, tap Share, then Add to Home Screen",
	);
	await expect(device).toContainText("Install app or Add to Home Screen");
	await expect(device).toContainText(
		"Installation does not grant device access or browser control",
	);
	await device.getByText(/Open the app once online/).scrollIntoViewIfNeeded();
	expect(
		await device.evaluate(
			(element) => element.scrollWidth <= element.clientWidth,
		),
	).toBe(true);
	await page.screenshot({ path: testInfo.outputPath("install-help-320.png") });
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	await page.getByRole("button", { name: "Close sessions" }).click();
	await expect(
		page.getByRole("dialog", { name: "Live sessions" }),
	).toBeHidden();

	const before = await (
		await context.request.get("/api/fixture/dispatches")
	).json();
	await page
		.getByLabel("Text for selected Pi (local draft)")
		.fill("PWA uncertain input must never replay");
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveValue("PWA uncertain input must never replay");
	// WebKit routing cannot intercept a worker-controlled fetch. Lose the receipt at the browser API boundary
	// after the real authenticated network request; the worker and native fixture still dispatch exactly once.
	await page.evaluate(() => {
		const networkFetch = window.fetch.bind(window);
		window.fetch = async (input, init) => {
			const response = await networkFetch(input, init);
			if (input === "/api/text" && init?.method === "POST")
				throw new TypeError("Controlled receipt loss");
			return response;
		};
	});
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await expect(
		page.getByText(/Delivery unknown. Check Pi before retrying./),
	).toBeVisible();
	const sent = await (
		await context.request.get("/api/fixture/dispatches")
	).json();
	expect(sent.dispatches).toBe(before.dispatches + 1);
	expect(await cacheContents(page)).toEqual({
		"pi-companion-offline-v2": offlineFiles,
	});
	const mutations: { path: string; action?: string }[] = [];
	page.on("request", (request) => {
		if (request.method() === "GET") return;
		const path = new URL(request.url()).pathname;
		mutations.push(
			path === "/api/control"
				? { path, action: request.postDataJSON().action }
				: { path },
		);
	});
	await context.setOffline(true);
	// Existing controlled page: API and mutation fetches fail rather than returning fallback or queuing.
	const failures = await page.evaluate(async (url) => {
		return Promise.all(
			[
				fetch(url!),
				fetch("/api/snapshot"),
				fetch("/api/text", {
					method: "POST",
					body: "offline input must never replay",
				}),
			].map((promise) =>
				promise.then(
					() => false,
					() => true,
				),
			),
		);
	}, media);
	expect(failures).toEqual([true, true, true]);
	expect(
		mutations.filter(
			(request) =>
				request.path !== "/api/control" || request.action !== "release",
		),
	).toEqual([{ path: "/api/text" }]); // Deliberate offline attempt reached the guard.
	mutations.length = 0;
	if (browserName === "webkit") {
		// Playwright WebKit's driver-offline navigation errors before the worker runs. This is layout only;
		// the separate owned-server-shutdown case below proves actual WebKit offline navigation.
		await context.setOffline(false);
		await page.goto("/offline.html");
	} else {
		await page.goto("/");
	}
	await expect(
		page.getByRole("heading", { name: "Pi Companion is offline" }),
	).toBeVisible();
	await expect(
		page.getByText(
			"Earlier requests may still have an uncertain outcome; they are not retried",
		),
	).toBeVisible();
	await expect(page.locator("script, form, textarea, input")).toHaveCount(0);
	await expect(
		page.getByText(/Controlled browser fixture|PWA uncertain input/),
	).toHaveCount(0);
	await expect
		.poll(() =>
			page.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth),
		)
		.toBe(192);
	await expect(page.locator("main")).toHaveCSS("max-width", "480px"); // Cached stylesheet really loads under the gateway CSP.
	for (const width of [320, 390])
		for (const theme of ["light", "dark"] as const)
			for (const enlarged of [false, true]) {
				await page.setViewportSize({
					width,
					height: width === 320 ? 568 : 844,
				});
				await page.emulateMedia({ colorScheme: theme });
				await page.evaluate((enlarged) => {
					document.documentElement.style.fontSize = enlarged ? "125%" : "";
					document.body.style.fontSize = enlarged ? "20px" : "";
				}, enlarged);
				const open = page.getByRole("link", { name: "Open companion" });
				await open.scrollIntoViewIfNeeded();
				expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
				expect((await open.boundingBox())!.width).toBeGreaterThanOrEqual(44);
				await page.screenshot({
					path: testInfo.outputPath(
						`offline-${width}-${theme}-${enlarged ? "enlarged" : "ordinary"}.png`,
					),
				});
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
			}
	await page
		.getByRole("link", { name: "Open companion" })
		.scrollIntoViewIfNeeded();
	await expect(
		page.getByRole("link", { name: "Open companion" }),
	).toBeVisible();
	expect(await cacheContents(page)).toEqual({
		"pi-companion-offline-v2": offlineFiles,
	});
	await context.setOffline(false);
	await page.getByRole("link", { name: "Open companion" }).click();
	await expect(
		page.getByRole("button", { name: /^Open sessions:/ }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Pi Companion is offline" }),
	).toHaveCount(0);
	await page.goto(`/#session=${owner.instance}:${owner.generation}`);
	await page.reload();
	await expect(page.locator(".image img").first()).toBeVisible();
	await expect(
		page.getByLabel("Text for selected Pi (local draft)"),
	).toHaveValue("");
	// Existing disconnect cleanup may release an old lease; it must never claim/take over or resend either payload.
	expect(
		mutations.filter(
			(request) =>
				request.path !== "/api/control" || request.action !== "release",
		),
	).toEqual([]);
	expect(
		await (await context.request.get("/api/fixture/dispatches")).json(),
	).toEqual(sent);
	expect(await cacheContents(page)).toEqual({
		"pi-companion-offline-v2": offlineFiles,
	});
});

// WebKit's driver-offline navigation fails internally, but real connection refusal runs the worker.
// Keep this distinct worker/runtime contract on an owned port0 server, not the shared gateway.
test("U6 WebKit actual server loss serves the exact production offline fallback", async ({
	page,
	browserName,
}, testInfo) => {
	test.skip(
		browserName !== "webkit",
		"Chromium offline navigation is proved through the real gateway above.",
	);
	const staticFiles: Record<string, string> = {
		"/sw.js": "text/javascript",
		"/offline.html": "text/html",
		"/offline.css": "text/css",
		"/icon-192.png": "image/png",
	};
	const server = createServer(async (request, response) => {
		response.setHeader("Cache-Control", "no-store");
		response.setHeader(
			"Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'",
		);
		const path = request.url ?? "/";
		if (path === "/") {
			response.setHeader("Content-Type", "text/html");
			response.end("<!doctype html><h1>Online fixture</h1>");
			return;
		}
		if (!staticFiles[path]) {
			response.writeHead(404);
			response.end();
			return;
		}
		try {
			response.setHeader("Content-Type", staticFiles[path]);
			response.end(
				await readFile(new URL(`../dist/web${path}`, import.meta.url)),
			);
		} catch {
			response.writeHead(500);
			response.end();
		}
	});
	try {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw Error("Missing owned fixture port");
		const origin = `http://127.0.0.1:${address.port}`;
		await page.setViewportSize({ width: 320, height: 568 });
		await page.goto(origin);
		await page.evaluate(async () => {
			await navigator.serviceWorker.register("/sw.js", {
				scope: "/",
				updateViaCache: "none",
			});
		});
		await activateWorker(page);
		await page.reload();
		expect(
			await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
		).toBe(`${origin}/sw.js`);
		expect(await cacheContents(page)).toEqual({
			"pi-companion-offline-v2": offlineFiles,
		});
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		// Context remains online: this is an actual refused connection to our stopped server.
		await page.reload();
		await expect(
			page.getByRole("heading", { name: "Pi Companion is offline" }),
		).toBeVisible();
		await expect(page.locator("main")).toHaveCSS("max-width", "480px");
		await expect
			.poll(() =>
				page
					.locator("img")
					.evaluate((img: HTMLImageElement) => img.naturalWidth),
			)
			.toBe(192);
		await expect(page.locator("script, form, textarea, input")).toHaveCount(0);
		await page.screenshot({
			path: testInfo.outputPath("webkit-actual-offline-320.png"),
		});
		expect(await cacheContents(page)).toEqual({
			"pi-companion-offline-v2": offlineFiles,
		});
		await page.getByRole("link", { name: "Open companion" }).click();
		await expect(
			page.getByRole("heading", { name: "Pi Companion is offline" }),
		).toBeVisible();
	} finally {
		server.closeAllConnections();
		if (server.listening)
			await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
