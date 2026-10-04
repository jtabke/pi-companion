import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
// Serve only the built UI. Every API response below is isolated sample data.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = root + "docs/screenshots";
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
	try {
		const path = new URL(req.url, "http://localhost").pathname;
		const file = /^\/assets\/[\w.-]+\.(js|css)$/.test(path)
			? path
			: path === "/"
				? "/index.html"
				: null;
		if (!file) {
			res.writeHead(404);
			res.end();
			return;
		}
		const data = await readFile(root + "/dist/web" + file);
		res.setHeader(
			"Content-Type",
			file.endsWith(".js")
				? "text/javascript"
				: file.endsWith(".css")
					? "text/css"
					: "text/html",
		);
		res.end(data);
	} catch {
		res.writeHead(404);
		res.end();
	}
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
	browser = await chromium.launch();
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 2,
		colorScheme: "dark",
		hasTouch: true,
		serviceWorkers: "block",
	});
	const identity = { instance: "a".repeat(32), generation: "b".repeat(32) };
	const summary = {
		...identity,
		project: "Trail Notes",
		cwd: "/sample/trail-notes",
		session: "Mobile layout review",
		parent: "working",
		background: "unobserved",
		busyText: true,
		rename: true,
	};
	const sessions = [
		summary,
		{
			instance: "c".repeat(32),
			generation: "d".repeat(32),
			project: "Trail Notes",
			cwd: "/sample/trail-notes",
			session: "Search and filters",
			parent: "idle",
			background: "unobserved",
			busyText: true,
			rename: true,
		},
		{
			instance: "e".repeat(32),
			generation: "f".repeat(32),
			project: "Weather Kit",
			cwd: "/sample/weather-kit",
			session: "Forecast cards",
			parent: "working",
			background: "unobserved",
			busyText: true,
			rename: true,
		},
	];
	const snapshot = {
		...summary,
		model: "sample/claude-sonnet-4-6",
		context: { tokens: 64000, window: 200000 },
		truncated: false,
		items: [
			{
				id: "answer",
				role: "assistant",
				blocks: [
					{
						type: "thinking",
						text: "Review the card layout and preserve the existing filter behavior.",
					},
					{ type: "text", text: "I’m updating the mobile trail cards." },
				],
			},
			{
				id: "read",
				role: "tool: read",
				tool: {
					name: "read",
					summary: "src/TrailCard.tsx",
					state: "completed",
				},
				blocks: [
					{
						type: "text",
						text: "export function TrailCard({ trail }: Props) {\n  return <article>{trail.name}</article>;\n}",
					},
				],
			},
			{
				id: "edit",
				role: "tool: edit",
				tool: { name: "edit", summary: "src/trails.css", state: "completed" },
				blocks: [
					{
						type: "diff",
						text: "-12 padding: 8px;\n+12 padding: 16px;\n-13 gap: 4px;\n+13 gap: 12px;",
					},
					{ type: "text", text: "Updated the trail card spacing." },
				],
			},
			{
				id: "shell",
				role: "tool: bash",
				tool: {
					name: "bash",
					summary: "npm run test:layout",
					state: "completed",
				},
				blocks: [{ type: "text", text: "6 layout checks passed." }],
			},
			{
				id: "progress",
				role: "assistant",
				blocks: [
					{
						type: "text",
						text: "The card spacing is updated and the layout checks pass. I’m checking the filter row next.",
					},
				],
			},
		],
	};
	let controller;
	const payload = () => ({
		connection: "connected",
		sessions,
		selected: identity,
		snapshot,
		...(controller ? { controller } : {}),
	});
	const page = await context.newPage();
	const requests = [];
	const unexpected = [];
	page.on("request", (req) => {
		if (req.method() === "POST") requests.push(new URL(req.url()).pathname);
	});
	const capture = async (name) => {
		assert.equal(
			await page.evaluate(
				() => document.documentElement.scrollWidth > innerWidth,
			),
			false,
		);
		await sharp(await page.screenshot({ animations: "disabled" }))
			.png({ compressionLevel: 9 })
			.toFile(output + "/" + name + ".png");
	};
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.route("**/api/**", async (route) => {
		const p = new URL(route.request().url()).pathname;
		if (p === "/api/snapshot") return route.fulfill({ json: payload() });
		if (p === "/api/control") {
			controller = { held: true, expires: Date.now() + 600000, revision: 1 };
			return route.fulfill({
				json: {
					lease: "0".repeat(64),
					expires: controller.expires,
					revision: 1,
				},
			});
		}
		if (p === "/api/text") {
			const req = route.request().postDataJSON();
			return route.fulfill({
				json: { requestId: req.requestId, status: "dispatched" },
			});
		}
		unexpected.push(p);
		return route.fulfill({
			status: 500,
			json: { error: "Unexpected sample request" },
		});
	});
	await page.route(
		(url) => url.origin !== origin,
		(route) => {
			unexpected.push(route.request().url());
			return route.abort();
		},
	);
	await page.addInitScript((data) => {
		class Source extends EventTarget {
			constructor() {
				super();
				queueMicrotask(() =>
					this.dispatchEvent(
						new MessageEvent("snapshot", { data: JSON.stringify(data) }),
					),
				);
			}
			close() {}
		}
		Object.defineProperty(window, "EventSource", { value: Source });
	}, payload());
	await page.goto(
		origin + "/#session=" + identity.instance + ":" + identity.generation,
	);
	await page.locator(".composer").waitFor();
	await page
		.locator("#draft")
		.fill("Keep the route distance and elevation visible on each card.");
	await page.locator('[data-native-item="edit"] summary').click();
	await page.locator('[data-native-item="edit"] .diff-added').first().waitFor();
	await page
		.locator(".chat-scroll")
		.evaluate((e) => (e.scrollTop = e.scrollHeight));
	await page.locator("#draft").blur();
	await capture("mobile-composer");
	await page
		.getByRole("combobox", { name: "Busy delivery mode" })
		.selectOption("followUp");
	assert.deepEqual(requests, []); // Choosing a delivery mode must not send or claim control.
	await capture("follow-up");
	await page
		.getByRole("button", { name: "Send Follow-up", exact: true })
		.click();
	await page.getByRole("region", { name: "Latest browser request" }).waitFor();
	await page.locator('[data-native-item="edit"] summary').click();
	await page
		.locator(".chat-scroll")
		.evaluate((e) => (e.scrollTop = e.scrollHeight));
	await capture("request-receipt");
	await page.getByRole("button", { name: /^Open sessions:/ }).click();
	await page.locator(".session-card .model-name").waitFor();
	await capture("sessions-drawer");
	assert.equal(
		await page.locator(".session-card .model-name").innerText(),
		"claude-sonnet-4-6",
	);
	assert.deepEqual(requests, ["/api/control", "/api/text"]);
	assert.deepEqual(unexpected, []);
	console.log(
		"Updated four README screenshots in docs/screenshots using sample-only data.",
	);
} finally {
	await browser?.close();
	await new Promise((r) => server.close(r));
}
