import { test, expect } from "@playwright/test";
import type { Snapshot } from "../src/shared/protocol.js";

// Native history reading only: each width owns its snapshot, stream and reader state.
for (const width of [320, 390, 900])
	test(`chat reading preserves position and resumes following at ${width}px`, async ({
		page,
		context,
		browserName,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 844 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		const identity = { instance: "a".repeat(32), generation: "b".repeat(32) };
		const summary = {
			...identity,
			project: "Pi Companion",
			cwd: "/workspace/Pi Companion",
			session: "Reading session",
			parent: "idle" as const,
			background: "unobserved" as const,
		};
		const snapshot: Snapshot = {
			...summary,
			truncated: false,
			omittedItems: 0,
			items: Array.from({ length: 32 }, (_, index) => ({
				id: `message-${index}`,
				role: "assistant",
				blocks: [
					{
						type: "text" as const,
						text: `Message ${index}. Read earlier messages without losing your place.\n\nMore conversation content.`,
					},
				],
			})),
		};
		const sessions = [summary];
		await page.route("**/api/snapshot", (route) =>
			route.fulfill({ json: { connection: "connected", sessions } }),
		);
		// Controllable SSE uses real snapshot reconciliation, without a live Pi owner.
		await page.addInitScript(
			({ sessions, snapshot, identity }) => {
				const sources = new Set<FixtureSource>();
				class FixtureSource extends EventTarget {
					onopen = null;
					onerror = null;
					constructor(private url: string) {
						super();
						sources.add(this);
						queueMicrotask(() => this.emit());
					}
					close() {
						sources.delete(this);
					}
					emit() {
						const selected =
							new URL(this.url, location.origin).searchParams.get(
								"instance",
							) === identity.instance;
						this.dispatchEvent(
							new MessageEvent("snapshot", {
								data: JSON.stringify({
									connection: "connected",
									sessions,
									...(selected ? { selected: identity, snapshot } : {}),
								}),
							}),
						);
					}
				}
				Object.defineProperty(window, "EventSource", { value: FixtureSource });
				Object.defineProperty(window, "appendChatMessage", {
					value: (text: string) => {
						snapshot.items.push({
							id: text,
							role: "assistant",
							blocks: [{ type: "text", text }],
						});
						for (const source of sources) source.emit();
					},
				});
			},
			{ sessions, snapshot, identity },
		);
		// Retain visual-viewport resize and window-resize fallback coverage.
		if (width === 320)
			await page.addInitScript(() => {
				const viewport = Object.assign(new EventTarget(), {
					offsetTop: 0,
					scale: 1,
				});
				Object.defineProperty(viewport, "height", { get: () => innerHeight });
				window.addEventListener("resize", () =>
					viewport.dispatchEvent(new Event("resize")),
				);
				Object.defineProperty(window, "visualViewport", { value: viewport });
			});
		if (width === 390)
			await page.addInitScript(() => {
				Object.defineProperty(window, "visualViewport", { value: undefined });
			});
		const mutations: string[] = [];
		page.on("request", (request) => {
			if (request.method() === "POST") mutations.push(request.url());
		});
		await page.goto("/");
		await page
			.getByRole("region", { name: "Live sessions", exact: true })
			.getByRole("button", { name: "Reading session Pi Companion Pi idle" })
			.click();
		expect(new URL(page.url()).hash).toBe(
			`#session=${identity.instance}:${identity.generation}`,
		);
		const history = page.getByRole("region", {
			name: "Conversation history",
			exact: true,
		});
		const composer = page.getByRole("region", { name: "Browser text input" });
		const jump = page.getByRole("button", { name: "Jump to latest" });
		const distance = () =>
			history.evaluate(
				(node) => node.scrollHeight - node.clientHeight - node.scrollTop,
			);
		await expect(page.getByPlaceholder("Message Pi")).toHaveValue("");
		await expect(page.locator("article")).toHaveCount(32);
		await expect.poll(distance).toBeLessThanOrEqual(1);
		await expect(jump).toBeHidden();
		async function checkComposer(height: number) {
			await expect
				.poll(async () => {
					const box = (await composer.boundingBox())!;
					return box.y + box.height;
				})
				.toBeLessThanOrEqual(height);
			const box = (await composer.boundingBox())!;
			expect(box.y + box.height).toBeLessThanOrEqual(height);
			expect(height - box.y - box.height).toBeLessThanOrEqual(24);
			expect(
				await composer
					.locator("xpath=ancestor::*[contains(@class, 'chat-scroll')]")
					.count(),
			).toBe(0);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
		}
		await history.evaluate((node) => {
			node.dispatchEvent(
				new WheelEvent("wheel", { bubbles: true, deltaY: -1 }),
			);
			node.scrollTop = 400;
		});
		await expect(jump).toBeVisible();
		const before = await history.evaluate((node) => node.scrollTop);
		const append = async (text: string) => {
			await page.evaluate(
				(text) =>
					(
						window as unknown as { appendChatMessage: (text: string) => void }
					).appendChatMessage(text),
				text,
			);
			await expect(page.locator("article").last()).toContainText(text);
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
		};
		await append("New message while reading history");
		await expect(page.locator("article").last()).toContainText(
			"New message while reading history",
		);
		await page.evaluate(() => new Promise(requestAnimationFrame));
		expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
			before,
			0,
		);
		await checkComposer(844);
		await jump.click();
		await expect.poll(distance).toBeLessThanOrEqual(1);
		await append("New message while following latest");
		await expect.poll(distance).toBeLessThanOrEqual(1);
		if (
			width === 900 &&
			browserName === "chromium" &&
			Array.isArray(testInfo.project.use.launchOptions?.ignoreDefaultArgs) &&
			testInfo.project.use.launchOptions.ignoreDefaultArgs.includes(
				"--hide-scrollbars",
			)
		) {
			// Headless Chromium hides native scrollbars by default.
			const input = await context.newCDPSession(page);
			await input.send("Emulation.setScrollbarsHidden", { hidden: false });
			// Render a measurable native desktop scrollbar, including on overlay-scrollbar hosts.
			const scrollbarRule = await page.evaluate(() => {
				const sheet = document.styleSheets[0],
					index = sheet.cssRules.length;
				sheet.insertRule(
					".chat-scroll::-webkit-scrollbar { width: 16px; }",
					index,
				);
				sheet.insertRule(
					".chat-scroll::-webkit-scrollbar-thumb { background: #777; }",
					index + 1,
				);
				return index;
			});
			await expect.poll(distance).toBeLessThanOrEqual(1);
			const scrollbar = await history.evaluate((node) => {
				const box = node.getBoundingClientRect();
				return {
					x: box.right - 8,
					y:
						box.bottom -
						(node.clientHeight * node.clientHeight) / node.scrollHeight / 2,
					gutter: (node as HTMLElement).offsetWidth - node.clientWidth,
					top: node.scrollTop,
				};
			});
			console.log("NATIVE_SCROLLBAR", scrollbar);
			await page.screenshot({
				path: testInfo.outputPath("native-scrollbar.png"),
			});
			expect(scrollbar.gutter).toBe(16);
			await page.mouse.move(scrollbar.x, scrollbar.y);
			await page.mouse.down();
			await page.mouse.move(scrollbar.x, scrollbar.y - 80, { steps: 8 });
			await page.mouse.up();
			await expect(jump).toBeVisible();
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
			await expect
				.poll(() => history.evaluate((node) => node.scrollTop))
				.toBeLessThan(scrollbar.top - 40);
			const scrollbarTop = await history.evaluate((node) => node.scrollTop);
			await append("Output after native mouse scrollbar reading");
			expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
				scrollbarTop,
				0,
			);
			await page.setViewportSize({ width, height: 800 });
			expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
				scrollbarTop,
				0,
			);
			await page.setViewportSize({ width, height: 844 });
			const returnThumb = await history.evaluate((node) => {
				const box = node.getBoundingClientRect(),
					thumbHeight =
						(node.clientHeight * node.clientHeight) / node.scrollHeight;
				return {
					x: box.right - 8,
					y:
						box.top +
						((node.clientHeight - thumbHeight) * node.scrollTop) /
							(node.scrollHeight - node.clientHeight) +
						thumbHeight / 2,
					bottom: box.bottom - 2,
				};
			});
			await page.mouse.move(returnThumb.x, returnThumb.y);
			await page.mouse.down();
			await page.mouse.move(returnThumb.x, returnThumb.bottom, { steps: 8 });
			await page.mouse.up();
			await expect.poll(distance).toBeLessThanOrEqual(1);
			await append("Following after native scrollbar bottom return");
			await expect.poll(distance).toBeLessThanOrEqual(1);
			console.log("NATIVE_SCROLLBAR_READING", {
				scrollbarTop,
				followedAfterReturn: await distance(),
			});
			await page.evaluate((index) => {
				document.styleSheets[0].deleteRule(index + 1);
				document.styleSheets[0].deleteRule(index);
			}, scrollbarRule);
			await input.send("Emulation.setScrollbarsHidden", { hidden: true });
			await input.detach();
			await expect.poll(distance).toBeLessThanOrEqual(1);
		} else if (width === 900) {
			// Hidden-bar runners still exercise the viewport mouse/scroll boundary, not native UI.
			await history.evaluate((node) => {
				node.dispatchEvent(
					new MouseEvent("mousedown", { bubbles: true, button: 0 }),
				);
				node.scrollTop -= 40;
				node.dispatchEvent(
					new MouseEvent("mouseup", { bubbles: true, button: 0 }),
				);
			});
			const mouseTop = await history.evaluate((node) => node.scrollTop);
			await append("Output after viewport mouse reading intent");
			expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
				mouseTop,
				0,
			);
			await page.setViewportSize({ width, height: 800 });
			expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
				mouseTop,
				0,
			);
			await page.setViewportSize({ width, height: 844 });
			await jump.click();
			await expect.poll(distance).toBeLessThanOrEqual(1);
		}
		// A deliberate 40px move is reading, not the old 64px follow band.
		await history.evaluate((node) => {
			node.dispatchEvent(
				new WheelEvent("wheel", { bubbles: true, deltaY: -40 }),
			);
			node.scrollTop -= 40;
		});
		await expect.poll(distance).toBeCloseTo(40, 0);
		const smallMove = await history.evaluate((node) => node.scrollTop);
		await append("Output must not override a small reader movement");
		await expect(page.locator("article").last()).toContainText(
			"Output must not override a small reader movement",
		);
		await page.evaluate(() => new Promise(requestAnimationFrame));
		expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
			smallMove,
			0,
		);
		await page.setViewportSize({ width, height: 800 });
		expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
			smallMove,
			0,
		);
		await page.setViewportSize({ width, height: 844 });
		// Returning with scroll input, not just Jump, resumes following.
		await history.evaluate((node) => {
			node.dispatchEvent(
				new WheelEvent("wheel", { bubbles: true, deltaY: 500 }),
			);
			node.scrollTop = node.scrollHeight;
			node.dispatchEvent(new Event("scroll"));
			node.dispatchEvent(new Event("scrollend"));
		});
		await expect.poll(distance).toBeLessThanOrEqual(1);
		await append("Following after deliberate bottom return");
		await expect.poll(distance).toBeLessThanOrEqual(1);
		await history.focus();
		// Exercise the keyboard intent boundary with a small resulting position change.
		await history.evaluate((node) => {
			node.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
			);
			node.scrollTop -= 12;
		});
		await expect.poll(distance).toBeGreaterThanOrEqual(12);
		expect(await distance()).toBeLessThanOrEqual(13);
		const keyboardTop = await history.evaluate((node) => node.scrollTop);
		await append(
			"Reading after a small keyboard move\n\nNew native paragraph.",
		);
		await page.evaluate(() => new Promise(requestAnimationFrame));
		expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
			keyboardTop,
			0,
		);
		await jump.click();
		await expect.poll(distance).toBeLessThanOrEqual(1);
		// Small touch movement is reading too; keep output/resize passive mid-gesture.
		await history.evaluate((node) => {
			for (const [type, y] of [
				["touchstart", 300],
				["touchmove", 308],
			] as const) {
				const event = new TouchEvent(type, { bubbles: true });
				Object.defineProperty(event, "touches", {
					value: [{ clientX: 180, clientY: y }],
				});
				node.dispatchEvent(event);
			}
			node.scrollTop -= 8;
		});
		const smallTouchTop = await history.evaluate((node) => node.scrollTop);
		await append("Output during a small touch reading movement");
		expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
			smallTouchTop,
			0,
		);
		await page.setViewportSize({ width, height: 800 });
		expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
			smallTouchTop,
			0,
		);
		await history.evaluate((node) => {
			const event = new TouchEvent("touchend", { bubbles: true });
			Object.defineProperty(event, "touches", { value: [] });
			node.dispatchEvent(event);
		});
		await page.setViewportSize({ width, height: 844 });
		await append("Output after the small touch reading movement");
		expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
			smallTouchTop,
			0,
		);
		await jump.click();
		await expect.poll(distance).toBeLessThanOrEqual(1);
		if (browserName === "chromium" && width === 390) {
			const input = await context.newCDPSession(page);
			await input.send("Emulation.setTouchEmulationEnabled", { enabled: true });
			const box = (await history.boundingBox())!;
			const x = box.x + box.width / 2,
				y = box.y + box.height / 2;
			const heldTop = await history.evaluate((node) => node.scrollTop);
			await input.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: [{ x, y }],
			});
			await append("Do not move an active native touch");
			await page.evaluate(() => new Promise(requestAnimationFrame));
			expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
				heldTop,
				0,
			);
			await page.setViewportSize({ width, height: 800 });
			expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
				heldTop,
				0,
			);
			await input.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x, y: y + 40 }],
			});
			await expect
				.poll(() => history.evaluate((node) => node.scrollTop))
				.toBeLessThan(heldTop);
			await input.send("Input.dispatchTouchEvent", {
				type: "touchCancel",
				touchPoints: [],
			});
			const touchTop = await history.evaluate((node) => node.scrollTop);
			await append("Reading after native touch movement");
			await page.evaluate(() => new Promise(requestAnimationFrame));
			expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
				touchTop,
				0,
			);
			await page.setViewportSize({ width, height: 844 });
			await jump.click();
			await expect.poll(distance).toBeLessThanOrEqual(1);
			await input.detach();
		}
		// Arbitrary app scroll events are not a user's reading intention.
		await history.evaluate((node) => {
			node.scrollTop -= 40;
			node.dispatchEvent(new Event("scroll"));
		});
		await append("Still following after an app-generated scroll");
		await expect.poll(distance).toBeLessThanOrEqual(1);
		expect(mutations).toEqual([]);
	});
