import { test, expect } from "@playwright/test";
import type { Snapshot, Summary } from "../src/shared/protocol.js";
import { chooseSession } from "./choose-session.mjs";
import { png } from "./fixture.js";

// Rendering/scroll fixtures only: no Pi, model, lease, or remote service is used.
for (const width of [320, 390, 900])
	test(`chat scrolling, tool disclosure and session sidebar at ${width}px`, async ({
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
			session: "Design session",
			parent: "idle" as const,
			background: "unobserved" as const,
		};
		const other = {
			...summary,
			instance: "c".repeat(32),
			generation: "d".repeat(32),
			project: "Other project",
			session: "Design session",
			parent: "working" as const,
			pending: true,
		};
		const snapshot: Snapshot = {
			...summary,
			truncated: true,
			omittedItems: 0,
			items: [
				{
					id: "user",
					role: "user",
					blocks: [{ type: "text", text: "Make tools easier to read." }],
				},
				{
					id: "call",
					role: "assistant",
					blocks: [{ type: "tool", text: "Tool call: functions.codemode" }],
				},
				{
					id: "result",
					role: "tool: functions.codemode",
					blocks: [
						{
							type: "text",
							text: Array.from(
								{ length: 100 },
								(_, index) => `line ${index}: ${"x".repeat(150)}`,
							).join("\n"),
							omittedChars: 17,
						},
						{ type: "text", text: "Second output segment" },
						{
							type: "unavailable",
							text: "Image unavailable: invalid fixture image",
						},
					],
				},
				...Array.from({ length: 32 }, (_, index) => ({
					id: `message-${index}`,
					role: "assistant",
					blocks: [
						{
							type: "text" as const,
							text: `Message ${index}. Read earlier messages without losing your place.\n\nMore conversation content.`,
						},
					],
				})),
				{
					id: "code",
					role: "assistant",
					blocks: [
						{
							type: "text",
							text: "```typescript\nconst message = 'Hello Pi';\n```\n\nEnd of code example.",
						},
					],
				},
			],
		};
		const sessions = [summary, other];
		await page.route("**/api/snapshot", (route) =>
			route.fulfill({ json: { connection: "connected", sessions } }),
		);
		// Controllable EventSource exercises real React snapshot reconciliation deterministically.
		await page.addInitScript(
			({ sessions, snapshot }) => {
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
						const instance = new URL(
							this.url,
							location.origin,
						).searchParams.get("instance");
						const owner = sessions.find(
							(session) => session.instance === instance,
						);
						this.dispatchEvent(
							new MessageEvent("snapshot", {
								data: JSON.stringify({
									connection: "connected",
									sessions,
									...(owner
										? {
												selected: {
													instance: owner.instance,
													generation: owner.generation,
												},
												snapshot: { ...snapshot, ...owner },
											}
										: {}),
								}),
							}),
						);
					}
				}
				Object.defineProperty(window, "EventSource", { value: FixtureSource });
			},
			{ sessions, snapshot },
		);
		if (width === 320)
			await page.addInitScript(() => {
				let height: number | undefined;
				const viewport = Object.assign(new EventTarget(), {
					offsetTop: 0,
					scale: 1,
				});
				Object.defineProperty(viewport, "height", {
					get: () => height ?? innerHeight,
				});
				window.addEventListener("resize", () =>
					viewport.dispatchEvent(new Event("resize")),
				);
				Object.defineProperty(window, "visualViewport", {
					configurable: true,
					value: viewport,
				});
				Object.defineProperty(window, "setVisibleViewport", {
					value: (nextHeight: number, offsetTop = 0, scale = 1) => {
						height = nextHeight;
						Object.assign(viewport, { offsetTop, scale });
						viewport.dispatchEvent(new Event("resize"));
						viewport.dispatchEvent(new Event("scroll"));
					},
				});
				Object.defineProperty(window, "restoreVisibleViewport", {
					value: () => {
						height = undefined;
						Object.assign(viewport, { offsetTop: 0, scale: 1 });
						viewport.dispatchEvent(new Event("resize"));
					},
				});
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
		const home = page.getByRole("region", {
			name: "Live sessions",
			exact: true,
		});
		await expect(
			home.getByRole("button", { name: "Design session Pi Companion Pi idle" }),
		).toBeVisible();
		await expect(
			page.getByRole("dialog", { name: "Live sessions" }),
		).toBeHidden();
		await home
			.getByRole("button", { name: "Design session Pi Companion Pi idle" })
			.focus();
		await page.keyboard.press("Enter");
		await expect(home).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: /^Open sessions:/ }),
		).toBeFocused();
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
		await expect(page.locator(".code-heading > span").first()).toHaveText(
			"typescript",
		);
		await expect(page.locator(".history-notice")).toHaveCount(0);
		const imageError = page.getByText(
			"Image unavailable: invalid fixture image",
			{ exact: true },
		);
		await expect(imageError).toBeVisible();
		expect(await imageError.locator("xpath=ancestor::details").count()).toBe(0);
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
		await checkComposer(844);
		// Fixed native content measures decorative occupancy independently of the composer.
		const density = await page.evaluate(() => {
			const user = document.querySelector<HTMLElement>(".message-user")!;
			const message = document.querySelector<HTMLElement>(
				'[data-native-item="message-0"]',
			)!;
			const next = document.querySelector<HTMLElement>(
				'[data-native-item="message-1"]',
			)!;
			const code = document.querySelector<HTMLElement>(".code-block pre")!;
			const style = getComputedStyle(message);
			return {
				contentWidth: document
					.querySelector(".chat-content")!
					.getBoundingClientRect().width,
				userWidth: user.getBoundingClientRect().width,
				userInset: parseFloat(getComputedStyle(user).paddingLeft),
				codeInset: parseFloat(getComputedStyle(code).paddingLeft),
				messageHeight: message.getBoundingClientRect().height,
				messageGap:
					next.getBoundingClientRect().top -
					message.getBoundingClientRect().bottom,
				fontSize: style.fontSize,
				lineHeight: style.lineHeight,
				historyHeight: document
					.querySelector(".chat-scroll")!
					.getBoundingClientRect().height,
			};
		});
		expect(density.contentWidth).toBe(width === 900 ? 756 : width - 32);
		expect(density.userInset).toBe(10);
		expect(density.codeInset).toBe(8);
		expect(density.messageGap).toBe(width === 900 ? 20 : 12);
		expect(density.messageHeight).toBeCloseTo(
			width === 900 ? 55.1875 : 80.78125,
			1,
		);
		expect(density.fontSize).toBe("16px");
		expect(density.lineHeight).toBe("25.6px");
		console.log(
			"DENSITY_GEOMETRY",
			JSON.stringify({ engine: browserName, width, ...density }),
		);
		await history.evaluate((node) => {
			node.scrollTop = 0;
		});
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.screenshot({
				path: testInfo.outputPath(`density-${width}-${theme}-top.png`),
			});
		}
		await history.evaluate((node) => {
			node.scrollTop = node.scrollHeight;
		});
		await expect.poll(distance).toBeLessThanOrEqual(1);
		{
			const draft = page.getByPlaceholder("Message Pi");
			const bar = page.locator(".composer-bar");
			const picker = page.locator(".attachment-picker");
			const send = composer.getByRole("button", { name: "Send", exact: true });
			const states = [];
			for (const [state, text] of [
				["empty", ""],
				["one-line", "Hello Pi"],
				["explicit", "First line\nSecond line"],
				[
					"wrapped",
					"A real draft that wraps across the available editor width. ".repeat(
						3,
					),
				],
				["unbroken", "abcdefghij".repeat(30)],
				["capped", "Draft line\n".repeat(30)],
				["shortened", "Short again"],
				["cleared", ""],
			]) {
				await draft.fill(text);
				const boxes = {
					bar: (await bar.boundingBox())!,
					editor: (await draft.boundingBox())!,
					picker: (await picker.boundingBox())!,
					send: (await send.boundingBox())!,
					reader: (await history.boundingBox())!,
				};
				states.push({ state, ...boxes });
				console.log(
					"FULLWIDTH_GEOMETRY",
					JSON.stringify({ engine: browserName, width, state, ...boxes }),
				);
				for (const theme of ["light", "dark"] as const) {
					await page.emulateMedia({ colorScheme: theme });
					await page.screenshot({
						path: testInfo.outputPath(
							`fullwidth-${width}-${state}-${theme}.png`,
						),
					});
				}
				if (state === "capped") {
					const scrolling = await draft.evaluate((node) => {
						const input = node as HTMLTextAreaElement;
						input.scrollTop = input.scrollHeight;
						return {
							height: input.clientHeight,
							scroll: input.scrollHeight,
							top: input.scrollTop,
						};
					});
					expect(scrolling.height).toBeLessThanOrEqual(136);
					expect(scrolling.scroll).toBeGreaterThan(scrolling.height);
					expect(scrolling.top).toBeGreaterThan(0);
				}
			}
			for (const boxes of states) {
				expect(boxes.editor.x, boxes.state).toBeGreaterThanOrEqual(
					boxes.picker.x + boxes.picker.width,
				);
				expect(boxes.editor.x + boxes.editor.width).toBeLessThanOrEqual(
					boxes.send.x,
				);
				expect(boxes.editor.y + boxes.editor.height, boxes.state).toBe(
					boxes.picker.y + boxes.picker.height,
				);
				expect(boxes.picker.x - boxes.bar.x).toBe(7);
				expect(
					boxes.bar.x + boxes.bar.width - boxes.send.x - boxes.send.width,
				).toBe(7);
				if (["empty", "one-line", "shortened", "cleared"].includes(boxes.state))
					expect(boxes.bar.height, boxes.state).toBe(58);
				expect(boxes.bar.y + boxes.bar.height).toBe(
					states[0].bar.y + states[0].bar.height,
				);
				for (const control of [boxes.picker, boxes.send]) {
					expect(control.width).toBeGreaterThanOrEqual(44);
					expect(control.height).toBeGreaterThanOrEqual(44);
					expect(control.y + control.height).toBeLessThanOrEqual(
						boxes.bar.y + boxes.bar.height,
					);
				}
				expect(boxes.reader.height).toBeGreaterThanOrEqual(300);
			}
			// Actual full-width wrapping responds to text size and width without typing.
			await draft.fill("Medium draft text ".repeat(4));
			const normalHeight = (await draft.boundingBox())!.height;
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "200%";
			});
			await expect
				.poll(async () => (await draft.boundingBox())!.height)
				.toBeGreaterThan(normalHeight);
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "";
			});
			await expect
				.poll(async () => (await draft.boundingBox())!.height)
				.toBe(normalHeight);
			await page.setViewportSize({ width: 250, height: 844 });
			await expect
				.poll(async () => (await draft.boundingBox())!.height)
				.toBeGreaterThan(normalHeight);
			await page.setViewportSize({ width, height: 844 });
			await expect
				.poll(async () => (await draft.boundingBox())!.height)
				.toBe(normalHeight);
			await draft.fill("");
		}
		if (width < 900) {
			// Round3 recovery uses the existing overlay fixture at 320px and
			// the layout-viewport fallback at 390px; neither emulates a native keyboard.
			const draft = page.getByPlaceholder("Message Pi");
			const menu = page.getByRole("button", { name: /^Open sessions:/ });
			const sidebar = page.getByRole("dialog", { name: "Live sessions" });
			const draftText = Array.from(
				{ length: 18 },
				(_, index) => `Draft line ${index}: retain editable text.`,
			).join("\n");
			const selectedHash = new URL(page.url()).hash;
			async function keyboard(open: boolean) {
				if (width === 320)
					await page.evaluate((open) => {
						const fixture = window as unknown as {
							setVisibleViewport: (height: number, top: number) => void;
							restoreVisibleViewport: () => void;
						};
						if (open) fixture.setVisibleViewport(400, 42);
						else fixture.restoreVisibleViewport();
					}, open);
				else await page.setViewportSize({ width, height: open ? 400 : 844 });
				await expect
					.poll(() =>
						page
							.locator("main")
							.evaluate((node) => node.getBoundingClientRect().height),
					)
					.toBe(open ? 400 : 844);
			}
			async function captureRecovery(
				state: string,
				theme: "light" | "dark",
				open: boolean,
			) {
				await page.emulateMedia({ colorScheme: theme });
				await page.evaluate(
					() =>
						new Promise<void>((resolve) =>
							requestAnimationFrame(() =>
								requestAnimationFrame(() => resolve()),
							),
						),
				);
				const boxes = {
					composer: (await composer.boundingBox())!,
					history: (await history.boundingBox())!,
					header: (await page.locator("header").boundingBox())!,
					jump: (await jump.count()) ? await jump.boundingBox() : null,
				};
				const visibleTop = open && width === 320 ? 42 : 0;
				const visibleBottom = visibleTop + (open ? 400 : 844);
				expect(boxes.composer.y).toBeGreaterThanOrEqual(visibleTop);
				expect(boxes.composer.y + boxes.composer.height).toBeLessThanOrEqual(
					visibleBottom,
				);
				// Only the visualViewport owner detects overlay keyboards. The
				// no-visualViewport fallback retains its ordinary safe-area padding.
				const gap = visibleBottom - boxes.composer.y - boxes.composer.height;
				if (open && width === 320 && state !== "drawer-return")
					expect(gap).toBeLessThanOrEqual(10);
				else if (!open || width === 390) {
					expect(gap).toBeGreaterThanOrEqual(20);
					expect(gap).toBeLessThanOrEqual(24);
				}
				expect(
					await page.evaluate(
						() =>
							document.documentElement.scrollWidth <= innerWidth &&
							document.documentElement.scrollHeight <=
								document.documentElement.clientHeight,
					),
				).toBe(true);
				console.log(
					"ROUND3_GEOMETRY",
					JSON.stringify({
						engine: browserName,
						width,
						state,
						theme,
						visibleTop,
						visibleBottom,
						...boxes,
					}),
				);
				await page.screenshot({
					path: testInfo.outputPath(`recovery-${width}-${state}-${theme}.png`),
				});
				const frame = (await page.locator(".chat-frame").boundingBox())!;
				expect(boxes.history.x).toBe(frame.x);
				expect(boxes.history.width).toBe(frame.width);
				if (boxes.jump) {
					// The circle overlays history; no full-width row consumes reader space.
					expect(boxes.history.height).toBe(frame.height);
					expect(boxes.jump.y).toBeGreaterThanOrEqual(boxes.history.y);
					expect(boxes.jump.y + boxes.jump.height).toBeLessThanOrEqual(
						boxes.history.y + boxes.history.height - 8,
					);
					expect(boxes.jump.width).toBeGreaterThanOrEqual(44);
					expect(boxes.jump.height).toBeGreaterThanOrEqual(44);
					if (state === "enlarged-multiline" || state === "drawer-return") {
						const copy = (await page
							.locator(".code-heading button")
							.first()
							.boundingBox())!;
						expect(copy.y).toBeGreaterThanOrEqual(boxes.history.y);
						expect(copy.y + copy.height).toBeLessThanOrEqual(
							boxes.history.y + boxes.history.height,
						);
					}
					// Check each captured recovery state, not just ordinary-word history.
					// Clip scroll descendants to the rendered viewport before testing.
					const access = await jump.evaluate((node) => {
						const jump = node.getBoundingClientRect();
						const scroll = document.querySelector(".chat-scroll")!;
						const viewport = scroll.getBoundingClientRect();
						const intercepted: string[] = [];
						const blocked: string[] = [];
						for (const other of document.querySelectorAll(
							"header, .composer, .history-notice, [role='status'], button, summary",
						)) {
							if (other === node) continue;
							const box = other.getBoundingClientRect();
							const left = Math.max(
								box.left,
								scroll.contains(other) ? viewport.left : 0,
							);
							const right = Math.min(
								box.right,
								scroll.contains(other) ? viewport.right : innerWidth,
							);
							const top = Math.max(
								box.top,
								scroll.contains(other) ? viewport.top : 0,
							);
							const bottom = Math.min(
								box.bottom,
								scroll.contains(other) ? viewport.bottom : innerHeight,
							);
							if (left >= right || top >= bottom) continue;
							if (
								left < jump.right &&
								right > jump.left &&
								top < jump.bottom &&
								bottom > jump.top
							)
								intercepted.push(other.textContent ?? other.tagName);
							if (other.matches("button, summary")) {
								for (const fraction of [0.25, 0.5, 0.75]) {
									const target = document.elementFromPoint(
										left + (right - left) * fraction,
										top + (bottom - top) / 2,
									);
									if (!target || !other.contains(target))
										blocked.push(other.textContent ?? other.tagName);
								}
							}
						}
						const jumpTarget = document.elementFromPoint(
							jump.x + jump.width / 2,
							jump.y + jump.height / 2,
						);
						return {
							intercepted,
							blocked,
							jumpReachable: !!jumpTarget && node.contains(jumpTarget),
						};
					});
					console.log(
						"ROUND3_CONTROL_ACCESS",
						JSON.stringify({ engine: browserName, width, state, ...access }),
					);
					expect(access.intercepted, state).toEqual([]);
					expect(access.blocked, state).toEqual([]);
					expect(access.jumpReachable, state).toBe(true);
				}
			}
			await draft.fill(draftText);
			await draft.focus();
			await keyboard(true);
			await captureRecovery("open", "light", true);
			await keyboard(false);
			await expect(draft).toBeFocused();
			await expect(draft).toHaveValue(draftText);
			await expect
				.poll(() =>
					page
						.locator("main")
						.evaluate((node) =>
							parseFloat(getComputedStyle(node).paddingBottom),
						),
				)
				.toBeGreaterThanOrEqual(20);
			await captureRecovery("closed", "dark", false);
			// Drawer closes back to its trigger, not to the editor or an input action.
			await menu.focus();
			await page.keyboard.press("Enter");
			await expect(sidebar).toBeVisible();
			await expect(
				sidebar.getByRole("button", { name: "Close sessions" }),
			).toBeFocused();
			// Hidden precedes the native close event. Finish focus restoration
			// before deliberately returning to the editor.
			await sidebar.evaluate((node) => {
				node.addEventListener(
					"close",
					() => {
						node.dataset.recoveryClosed = "true";
					},
					{ once: true },
				);
			});
			await page.keyboard.press("Escape");
			await expect(
				page.locator('dialog[aria-label="Live sessions"]'),
			).toHaveAttribute("data-recovery-closed", "true");
			await expect(sidebar).toBeHidden();
			await expect(menu).toBeFocused();
			await draft.focus();
			await keyboard(true);
			await expect(draft).toHaveValue(draftText);
			await captureRecovery("reopened", "dark", true);
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "125%";
			});
			const editing = await draft.evaluate((node) => {
				const area = node as HTMLTextAreaElement;
				area.setSelectionRange(area.value.length, area.value.length);
				area.scrollTop = area.scrollHeight;
				return {
					height: area.clientHeight,
					scrollHeight: area.scrollHeight,
					scrollTop: area.scrollTop,
					maxHeight: parseFloat(getComputedStyle(area).maxHeight),
				};
			});
			console.log(
				"ROUND3_EDITING",
				JSON.stringify({ engine: browserName, width, ...editing }),
			);
			expect(editing.height).toBeLessThanOrEqual(136);
			expect(editing.maxHeight).toBe(136);
			expect(editing.scrollHeight).toBeGreaterThan(editing.height);
			expect(editing.scrollTop).toBeGreaterThan(0);
			await expect(draft).toBeFocused();
			await page.keyboard.type("!");
			await expect(draft).toHaveValue(draftText + "!");
			for (const control of [
				page.locator(".attachment-picker"),
				composer.getByRole("button", { name: "Send", exact: true }),
			]) {
				const box = (await control.boundingBox())!;
				expect(box.width).toBeGreaterThanOrEqual(44);
				expect(box.height).toBeGreaterThanOrEqual(44);
			}
			// Deliberately read just above latest so Copy and Jump are rendered
			// together in both engines, independent of incidental resize timing.
			await history.evaluate((node) => {
				node.dispatchEvent(
					new WheelEvent("wheel", { bubbles: true, deltaY: -80 }),
				);
				node.scrollTop = node.scrollHeight - node.clientHeight - 80;
			});
			await expect(jump).toBeVisible();
			// Keep Copy fully in view after the conditional Jump row has appeared.
			await history.evaluate((node) => {
				const copy = node.querySelector(".code-heading button")!;
				const box = copy.getBoundingClientRect();
				const viewport = node.getBoundingClientRect();
				node.scrollTop = Math.min(
					node.scrollTop +
						box.top -
						viewport.top -
						(viewport.height - box.height) / 2,
					node.scrollHeight - node.clientHeight - 80,
				);
			});
			await captureRecovery("enlarged-multiline", "light", true);
			await captureRecovery("enlarged-multiline", "dark", true);
			await menu.focus();
			await page.keyboard.press("Enter");
			await expect(sidebar).toBeVisible();
			await expect(sidebar.locator('[aria-current="true"]')).toContainText(
				"Design session",
			);
			await expect(
				sidebar.getByRole("button", { name: "Close sessions" }),
			).toBeFocused();
			expect(
				await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth),
			).toBe(true);
			await page.emulateMedia({ colorScheme: "dark" });
			await page.screenshot({
				path: testInfo.outputPath(`recovery-${width}-drawer-open-dark.png`),
			});
			await page.keyboard.press("Escape");
			await expect(sidebar).toBeHidden();
			await expect(menu).toBeFocused();
			await expect(draft).toHaveValue(draftText + "!");
			expect(new URL(page.url()).hash).toBe(selectedHash);
			await expect(jump).toBeVisible();
			await captureRecovery("drawer-return", "dark", true);
			await captureRecovery("drawer-return", "light", true);
			await draft.focus();
			await history.evaluate((node) => {
				node.dispatchEvent(
					new WheelEvent("wheel", { bubbles: true, deltaY: -1 }),
				);
				node.scrollTop = 400;
			});
			await expect(jump).toBeVisible();
			const jumpBox = (await jump.boundingBox())!;
			const historyBox = (await history.boundingBox())!;
			const frameBox = (await page.locator(".chat-frame").boundingBox())!;
			expect(historyBox.width).toBe(frameBox.width);
			expect(jumpBox.x).toBeGreaterThanOrEqual(frameBox.x);
			expect(jumpBox.x + jumpBox.width).toBeLessThanOrEqual(
				frameBox.x + frameBox.width - 12,
			);
			expect(historyBox.height).toBe(frameBox.height);
			expect(jumpBox.y).toBeGreaterThanOrEqual(historyBox.y);
			expect(
				await jump.evaluate((node) => {
					const box = node.getBoundingClientRect();
					const beside = document.elementFromPoint(
						box.left - 8,
						box.top + box.height / 2,
					);
					return {
						radius: getComputedStyle(node).borderRadius,
						besideIsHistory: document
							.querySelector(".chat-scroll")!
							.contains(beside),
					};
				}),
			).toEqual({ radius: "50%", besideIsHistory: true });
			expect(jumpBox.y + jumpBox.height).toBeLessThanOrEqual(
				frameBox.y + frameBox.height,
			);
			expect(jumpBox.height).toBeGreaterThanOrEqual(44);
			expect(jumpBox.width).toBeGreaterThanOrEqual(44);

			await captureRecovery("jump-away", "light", true);
			await captureRecovery("jump-away", "dark", true);
			await jump.focus();
			await expect(jump).toBeFocused();
			expect(
				await jump.evaluate((node) => node.matches(":focus-visible")),
			).toBe(true);
			const composerBox = (await composer.boundingBox())!;
			expect(jumpBox.y + jumpBox.height + 6).toBeLessThanOrEqual(composerBox.y);
			await page.screenshot({
				path: testInfo.outputPath(`recovery-${width}-jump-focused-dark.png`),
			});
			await page.keyboard.press("Enter");
			await expect.poll(distance).toBeLessThanOrEqual(1);
			await expect(jump).toBeHidden();
			const latestFrame = (await page.locator(".chat-frame").boundingBox())!;
			const latestHistory = (await history.boundingBox())!;
			expect(latestHistory.width).toBe(latestFrame.width);
			expect(latestHistory.height).toBe(latestFrame.height);
			await expect(draft).toHaveValue(draftText + "!");
			expect(mutations).toEqual([]);
			await keyboard(false);
			await draft.fill("");
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "";
			});
			await menu.focus();
		}
		if (width < 900) {
			const trigger = page.locator(".sessions-toggle");
			await expect(trigger).toBeFocused();
			expect(
				await trigger.evaluate((node) => node.matches(":focus-visible")),
			).toBe(true);
			for (const theme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await page.screenshot({
					path: testInfo.outputPath(`header-${width}-${theme}-ordinary.png`),
				});
			}
			const title = trigger.locator("strong");
			const originalTitle = await title.textContent();
			await title.evaluate((node) => {
				node.textContent =
					"A long session name that must not take over the small-screen conversation header";
			});
			expect((await trigger.boundingBox())!.height).toBe(44);
			expect(
				await title.evaluate((node) => node.scrollWidth > node.clientWidth),
			).toBe(true);
			await expect(trigger).toHaveAccessibleName(/^Open sessions:/);
			await page.screenshot({
				path: testInfo.outputPath(`header-${width}-long-title.png`),
			});
			await title.evaluate((node, text) => {
				node.textContent = text;
			}, originalTitle);
			const focusedHeader = await trigger.evaluate((node) => {
				const style = getComputedStyle(node);
				const metadata = document.querySelector(".header-metadata")!;
				const icon = node.querySelector("svg")!;
				const iconStyle = getComputedStyle(icon);
				const iconBox = icon.getBoundingClientRect();
				const headerBox = node.closest("header")!.getBoundingClientRect();
				const clearance =
					parseFloat(iconStyle.outlineWidth) +
					parseFloat(iconStyle.outlineOffset);
				return {
					outlineStyle: style.outlineStyle,
					iconOutlineWidth: parseFloat(iconStyle.outlineWidth),
					iconOutlineStyle: iconStyle.outlineStyle,
					focusTop: iconBox.top - clearance,
					focusBottom: iconBox.bottom + clearance,
					focusLeft: iconBox.left - clearance,
					focusRight: iconBox.right + clearance,
					headerTop: headerBox.top,
					headerBottom: headerBox.bottom,
					headerLeft: headerBox.left,
					headerRight: headerBox.right,
					triggerBottom: node.getBoundingClientRect().bottom,
					titleBottom: node.querySelector("strong")!.getBoundingClientRect()
						.bottom,
					metadataBottom: metadata.getBoundingClientRect().bottom,
					firstMetadataTop: Math.min(
						...Array.from(
							metadata.children,
							(child) => child.getBoundingClientRect().top,
						),
					),
				};
			});
			console.log(
				"FOCUSED_HEADER_CLEARANCE",
				JSON.stringify({ width, engine: browserName, ...focusedHeader }),
			);
			// A quiet icon-only focus ring fits entirely within the clipped header.
			expect(focusedHeader.outlineStyle).toBe("none");
			expect(focusedHeader.iconOutlineWidth).toBe(2);
			expect(focusedHeader.iconOutlineStyle).toBe("solid");
			expect(focusedHeader.focusTop).toBeGreaterThanOrEqual(
				focusedHeader.headerTop,
			);
			expect(focusedHeader.focusBottom).toBeLessThanOrEqual(
				focusedHeader.headerBottom,
			);
			expect(focusedHeader.focusLeft).toBeGreaterThanOrEqual(
				focusedHeader.headerLeft,
			);
			expect(focusedHeader.focusRight).toBeLessThanOrEqual(
				focusedHeader.headerRight,
			);
			expect(focusedHeader.firstMetadataTop).toBeGreaterThanOrEqual(
				focusedHeader.titleBottom,
			);
			expect(focusedHeader.metadataBottom).toBeLessThanOrEqual(
				focusedHeader.triggerBottom,
			);
			expect((await page.locator("header").boundingBox())!.height).toBe(44);
			console.log(
				"HEADER_GEOMETRY",
				JSON.stringify({
					width,
					engine: browserName,
					header: await page.locator("header").boundingBox(),
					history: await history.boundingBox(),
				}),
			);
		}
		if (width === 390) {
			// Keyboard-reduced layout viewport; the 390px case retains its no-visualViewport fallback.
			await page.setViewportSize({ width, height: 400 });
			await page
				.getByPlaceholder("Message Pi")
				.fill("Keyboard draft\nsecond line");
			await page.getByPlaceholder("Message Pi").focus();
			for (const theme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await page.screenshot({
					path: testInfo.outputPath(`header-390-${theme}-keyboard-reduced.png`),
				});
			}
			await page.getByPlaceholder("Message Pi").fill("");
			await page.setViewportSize({ width, height: 844 });
		}
		if (width === 320) {
			// Overlay keyboard geometry: layout viewport stays 844px. This is not phone proof.
			const visibleViewport = (height: number, offsetTop = 0, scale = 1) =>
				page.evaluate(
					({ height, offsetTop, scale }) =>
						(
							window as unknown as {
								setVisibleViewport: (
									height: number,
									offsetTop: number,
									scale: number,
								) => void;
							}
						).setVisibleViewport(height, offsetTop, scale),
					{ height, offsetTop, scale },
				);
			const draft = page.getByPlaceholder("Message Pi");
			await draft.fill("Keyboard draft\nsecond line");
			await draft.focus();
			for (const top of [0, 42]) {
				await visibleViewport(400, top);
				await expect
					.poll(async () => {
						const box = (await composer.boundingBox())!;
						return box.y + box.height;
					})
					.toBeLessThanOrEqual(400 + top);
				const box = (await composer.boundingBox())!;
				expect(400 + top - box.y - box.height).toBeLessThanOrEqual(10);
				await expect(draft).toBeFocused();
				await expect(draft).toHaveValue("Keyboard draft\nsecond line");
				expect(
					await page.evaluate(
						() => document.documentElement.scrollHeight <= innerHeight,
					),
				).toBe(true);
			}
			for (const theme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await page.screenshot({
					path: testInfo.outputPath(`overlay-keyboard-320-${theme}.png`),
				});
			}
			// Safari can report innerHeight as the keyboard-reduced height while
			// visualViewport still carries a focus-pan offset. Do not subtract it twice.
			await page.evaluate(() => {
				const original = Object.getOwnPropertyDescriptor(
					window,
					"innerHeight",
				)!;
				try {
					Object.defineProperty(window, "innerHeight", {
						configurable: true,
						value: 400,
					});
					(
						window as unknown as {
							setVisibleViewport: (height: number, top: number) => void;
						}
					).setVisibleViewport(400, 250);
				} finally {
					Object.defineProperty(window, "innerHeight", original);
				}
			});
			await expect
				.poll(() =>
					page
						.locator("main")
						.evaluate((node) => node.getBoundingClientRect().height),
				)
				.toBe(400);
			await expect
				.poll(async () => {
					const box = (await composer.boundingBox())!;
					return 650 - box.y - box.height;
				})
				.toBeLessThanOrEqual(24);
			await expect(draft).toBeFocused();
			await expect(draft).toHaveValue("Keyboard draft\nsecond line");
			// Focus panning must not enlarge the page and trigger further document scrolling.
			await visibleViewport(400, 600);
			expect(
				await page.evaluate(
					() =>
						document.documentElement.scrollHeight <=
						document.documentElement.clientHeight,
				),
			).toBe(true);
			await visibleViewport(300, 100, 2); // Pinch zoom must not shrink/reposition the app as a keyboard.
			await expect
				.poll(() =>
					page
						.locator("main")
						.evaluate((node) => node.getBoundingClientRect().height),
				)
				.toBe(844);
			await visibleViewport(844);
			expect(
				await page
					.locator("main")
					.evaluate((node) => parseFloat(getComputedStyle(node).paddingBottom)),
			).toBeGreaterThanOrEqual(20);
			await expect
				.poll(() =>
					page
						.locator("main")
						.evaluate((node) => node.getBoundingClientRect().height),
				)
				.toBe(844);
			await expect(draft).toBeFocused();
			await page.evaluate(() =>
				(
					window as unknown as { restoreVisibleViewport: () => void }
				).restoreVisibleViewport(),
			);
			await draft.fill("Exact gesture draft\nsecond line");
			await page
				.getByLabel("Images for selected Pi (local picker)")
				.setInputFiles({
					name: "keyboard.png",
					mimeType: "image/png",
					buffer: png,
				});
			const postsBefore = mutations.length;
			const gesture = (
				dx: number,
				dy: number,
				options: {
					multi?: boolean;
					cancel?: boolean;
					long?: boolean;
					select?: boolean;
				} = {},
			) =>
				draft.evaluate(
					(node, { dx, dy, options }) => {
						const touch = { identifier: 1, clientX: 100, clientY: 100 };
						const emit = (
							type: string,
							touches: object[],
							changedTouches: object[],
						) => {
							const event = Object.assign(new Event(type, { bubbles: true }), {
								touches,
								changedTouches,
							});
							if (options.long)
								Object.defineProperty(event, "timeStamp", {
									value: type === "touchstart" ? 1000 : 1600,
								});
							return node.dispatchEvent(event);
						};
						emit("touchstart", [touch], [touch]);
						if (options.select)
							(node as HTMLTextAreaElement).setSelectionRange(0, 5);
						const end = { ...touch, clientX: 100 + dx, clientY: 100 + dy };
						emit(
							"touchmove",
							options.multi ? [end, { ...end, identifier: 2 }] : [end],
							[end],
						);
						emit(options.cancel ? "touchcancel" : "touchend", [], [end]);
					},
					{ dx, dy, options },
				);
			await page.getByRole("button", { name: /^Open sessions:/ }).focus();
			await gesture(0, 90);
			await expect(draft).not.toBeFocused();
			await draft.focus();
			for (const [dx, dy] of [
				[0, 12],
				[100, 80],
				[0, -90],
			]) {
				await gesture(dx, dy);
				await expect(draft).toBeFocused();
			}
			for (const options of [
				{ multi: true },
				{ cancel: true },
				{ long: true },
				{ select: true },
			]) {
				await gesture(0, 90, options);
				await expect(draft).toBeFocused();
			}
			await draft.evaluate((node) => {
				(node as HTMLTextAreaElement).setSelectionRange(0, 5);
			});
			await gesture(0, 90);
			await expect(draft).toBeFocused();
			await draft.evaluate((node) => {
				(node as HTMLTextAreaElement).setSelectionRange(0, 0);
			});
			await draft.dispatchEvent("compositionstart");
			await gesture(0, 90);
			await expect(draft).toBeFocused();
			await draft.dispatchEvent("compositionend");
			await gesture(8, 90);
			await expect(draft).not.toBeFocused();
			await expect(draft).toHaveValue("Exact gesture draft\nsecond line");
			await expect(
				page.getByRole("button", {
					name: "Remove image 1: keyboard.png",
					exact: true,
				}),
			).toBeVisible();
			await expect(
				page.getByRole("img", { name: "Local attachment preview" }),
			).toBeVisible();
			// Downward text scrolling away from its top is editing, not keyboard dismissal.
			const longDraft = Array.from({ length: 14 }, (_, i) => `Line ${i}`).join(
				"\n",
			);
			await draft.fill(longDraft);
			await draft.focus();
			await draft.evaluate((node) => {
				node.scrollTop = 48;
			});
			await gesture(0, 90);
			await expect(draft).toBeFocused();
			await expect(draft).toHaveValue(longDraft);
			await history.dispatchEvent("touchstart", {
				touches: [{ identifier: 1, clientX: 100, clientY: 100 }],
			});
			await history.dispatchEvent("touchend", {
				touches: [],
				changedTouches: [{ identifier: 1, clientX: 100, clientY: 200 }],
			});
			await expect(draft).toBeFocused();
			expect(mutations).toHaveLength(postsBefore);
			await page.getByRole("button", { name: /^Remove image/ }).click();
			await draft.fill("");
		}
		expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(128);
		expect(
			(await page.locator("header").boundingBox())!.height,
		).toBeLessThanOrEqual(70);
		if (width < 900) {
			// Independent reading-space bounds include 6px clearance for the outward trigger ring.
			expect((await history.boundingBox())!.y).toBeLessThanOrEqual(
				width === 320 ? 112 : 96,
			);
			await expect(page.locator("header .header-project")).toHaveText(
				"Pi Companion",
			);
			await expect(page.locator("header .parent-status")).toHaveText("Pi idle");
			await expect(page.locator("header .subagent-observation")).toHaveCount(0);
			expect(
				(await page.locator(".sessions-toggle").boundingBox())!.height,
			).toBeGreaterThanOrEqual(44);
		}
		await page.setViewportSize({ width, height: 568 });
		await checkComposer(568);
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "125%";
		});
		await checkComposer(568);
		await expect(page.getByPlaceholder("Message Pi")).toBeVisible();
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "";
		});
		await page.setViewportSize({ width, height: 844 });
		await expect(
			composer.getByRole("button", { name: "Send", exact: true }),
		).toBeVisible();
		await expect(
			composer.getByRole("button", { name: "Stop", exact: true }),
		).toHaveCount(0);
		await page
			.getByPlaceholder("Message Pi")
			.fill("First line\nSecond line\nThird line");
		expect(
			(await page.getByPlaceholder("Message Pi").boundingBox())!.height,
		).toBeGreaterThan(44);
		await page.getByPlaceholder("Message Pi").fill("");
		expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(128);
		// The retained composer/drawer journey starts following the original snapshot.
		await history.evaluate((node) => {
			node.dispatchEvent(
				new WheelEvent("wheel", { bubbles: true, deltaY: 500 }),
			);
			node.scrollTop = node.scrollHeight;
			node.dispatchEvent(new Event("scroll"));
			node.dispatchEvent(new Event("scrollend"));
		});
		await expect.poll(distance).toBeLessThanOrEqual(1);
		await page.getByPlaceholder("Message Pi").fill("First terminal draft");
		await page.setViewportSize({ width, height: 620 });
		await checkComposer(620);
		await expect(page.getByPlaceholder("Message Pi")).toBeFocused();
		await page.setViewportSize({ width, height: 844 });
		await history.evaluate((node) => {
			node.scrollTop = 0;
		});
		const disclosure = page.locator(".tool-disclosure");
		await expect(disclosure).toHaveCount(1);
		await expect(disclosure.locator("summary")).toContainText("shortened");
		await expect(disclosure.locator(".preview-note")).toBeHidden();
		await expect(disclosure).not.toHaveAttribute("open");
		await expect(disclosure.locator("pre").first()).toBeHidden();
		await expect(page.locator(".tool-call")).toHaveText(
			"Tool call: functions.codemode",
		);
		await expect(page.locator(".tool-call")).toHaveClass(/visually-hidden/);
		await expect(page.locator('[data-native-item="call"]')).toHaveClass(
			/visually-hidden/,
		);
		await expect(
			page.locator('[data-native-item="result"] .message-role'),
		).toHaveClass(/visually-hidden/);
		await disclosure.locator("summary").click();
		await expect(disclosure.locator("pre").first()).toBeVisible();
		await expect(disclosure.locator("pre")).toHaveCount(2);
		await expect(disclosure.locator(".preview-note")).toHaveText(
			"Preview shortened · 17 characters omitted.",
		);
		expect(
			await disclosure
				.locator("pre")
				.first()
				.evaluate((node) => node.scrollHeight > node.clientHeight),
		).toBe(true);
		await expect(disclosure.locator("pre").first()).toContainText("line 99:");
		if (width < 900) {
			const horizontalScroll = await disclosure
				.locator("pre")
				.first()
				.evaluate((node) => {
					node.scrollLeft = 48;
					return {
						available: node.scrollWidth > node.clientWidth,
						position: node.scrollLeft,
					};
				});
			expect(horizontalScroll.available).toBe(true);
			expect(horizontalScroll.position).toBeGreaterThan(0);
		}
		await checkComposer(844);
		await disclosure.locator("summary").focus();
		await page.keyboard.press("Space");
		await expect(disclosure.locator("pre").first()).toBeHidden();
		const menu = page.getByRole("button", { name: /^Open sessions:/ });
		const sidebar = page.getByRole("dialog", { name: "Live sessions" });
		await menu.focus();
		await expect(menu).toBeFocused();
		expect((await menu.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		await expect(menu.locator(":scope > svg")).toHaveAttribute(
			"aria-hidden",
			"true",
		);
		expect(
			await menu.evaluate((node) =>
				node.firstElementChild?.tagName.toLowerCase(),
			),
		).toBe("svg");
		await expect(menu).not.toContainText("⌄");
		await page.keyboard.press("Enter");
		await expect(sidebar).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(sidebar).toBeHidden();
		await expect(menu).toBeFocused();
		// Cross-engine event-boundary coverage; native Chromium touch input follows below.
		const swipe = (
			selector: string,
			points: [number, number][],
			finish: "end" | "cancel" | "multi" | "identity" = "end",
		) =>
			page.locator(selector).evaluate(
				(node, { points, finish }) => {
					function dispatch(
						type: string,
						point: [number, number],
						count: number,
					) {
						const event = new TouchEvent(type, {
							bubbles: true,
							cancelable: true,
						});
						const touch = {
							identifier:
								finish === "identity" && type !== "touchstart" ? 2 : 1,
							clientX: point[0],
							clientY: point[1],
						};
						Object.defineProperties(event, {
							touches: { value: Array.from({ length: count }, () => touch) },
							changedTouches: { value: [touch] },
						});
						node.dispatchEvent(event);
						return event.defaultPrevented;
					}
					dispatch("touchstart", points[0], 1);
					const prevented = points
						.slice(1)
						.map((point) =>
							dispatch("touchmove", point, finish === "multi" ? 2 : 1),
						);
					const endPrevented = dispatch(
						finish === "cancel" ? "touchcancel" : "touchend",
						points[points.length - 1],
						0,
					);
					if (finish === "end" && prevented.includes(true) && !endPrevented)
						throw new Error(
							"Claimed swipe must prevent touchend's compatibility click",
						);
					return prevented;
				},
				{ points, finish },
			);
		for (const [selector, points, finish] of [
			[
				"main",
				[
					[8, 180],
					[10, 220],
					[100, 220],
				],
				"end",
			], // Vertical scrolling wins.
			[
				"main",
				[
					[70, 180],
					[150, 180],
				],
				"end",
			], // Not a left-edge gesture.
			[
				"main",
				[
					[20, 180],
					[2, 180],
					[100, 180],
				],
				"end",
			], // Wrong initial direction.
			[
				"main",
				[
					[8, 180],
					[90, 240],
				],
				"end",
			], // Diagonal, not horizontal.
			[
				"main",
				[
					[8, 180],
					[90, 180],
				],
				"multi",
			],
			[
				"textarea#draft",
				[
					[8, 180],
					[90, 180],
				],
				"end",
			],
			[
				".code-block pre",
				[
					[8, 180],
					[90, 180],
				],
				"end",
			],
		] as [string, [number, number][], "end" | "multi"][]) {
			expect(await swipe(selector, points, finish)).not.toContain(true);
			await expect(sidebar).toBeHidden();
		}
		await page
			.locator(".conversation p")
			.first()
			.evaluate((node) => {
				const range = document.createRange();
				range.selectNodeContents(node);
				window.getSelection()?.removeAllRanges();
				window.getSelection()?.addRange(range);
			});
		expect(
			await swipe("main", [
				[8, 180],
				[90, 180],
			]),
		).not.toContain(true);
		await expect(sidebar).toBeHidden();
		await page.evaluate(() => window.getSelection()?.removeAllRanges());
		await swipe("main", [
			[8, 180],
			[40, 180],
		]); // Below the opening distance.
		await expect(sidebar).toBeHidden();
		await swipe(
			"main",
			[
				[8, 180],
				[90, 180],
			],
			"cancel",
		);
		await expect(sidebar).toBeHidden();
		const positionBeforeSwipe = await history.evaluate(
			(node) => node.scrollTop,
		);
		const selectionBeforeSwipe = new URL(page.url()).hash;
		await swipe("main", [
			[8, 180],
			[40, 182],
			[100, 212],
		]);
		if (width < 640) {
			await expect(sidebar).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(menu).toBeFocused();
		} else await expect(sidebar).toBeHidden();
		expect(await history.evaluate((node) => node.scrollTop)).toBe(
			positionBeforeSwipe,
		);
		expect(new URL(page.url()).hash).toBe(selectionBeforeSwipe);
		await expect(page.getByPlaceholder("Message Pi")).toHaveValue(
			"First terminal draft",
		);
		if (browserName === "chromium" && width < 640) {
			const input = await context.newCDPSession(page);
			await input.send("Emulation.setTouchEmulationEnabled", { enabled: true });
			// Native vertical scrolling from the same narrow edge remains available.
			for (const [type, y] of [
				["touchStart", 400],
				["touchMove", 350],
				["touchMove", 260],
				["touchCancel", 260],
			] as const) {
				await input.send("Input.dispatchTouchEvent", {
					type,
					touchPoints: type === "touchCancel" ? [] : [{ x: 20, y }],
				});
			}
			await expect
				.poll(() => history.evaluate((node) => node.scrollTop))
				.toBeGreaterThan(positionBeforeSwipe);
			await expect(sidebar).toBeHidden();
			await history.evaluate(async (node, position) => {
				node.scrollTop = position;
				node.dispatchEvent(new Event("scroll"));
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
			}, positionBeforeSwipe);
			await input.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: [{ x: 8, y: 180 }],
			});
			await input.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x: 45, y: 182 }],
			});
			await input.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x: 100, y: 184 }],
			});
			await input.send("Input.dispatchTouchEvent", {
				type: "touchEnd",
				touchPoints: [],
			});
			await expect(sidebar).toBeVisible();
			// Real input starts on the unselected session button, not panel padding.
			await sidebar.evaluate(async (node) => {
				await Promise.all(
					node.getAnimations().map((animation) => animation.finished),
				);
			});
			const nativeRow = sidebar.getByRole("button", {
				name: /Design session Other project/,
			});
			const bounds = (await nativeRow.boundingBox())!;
			const x = bounds.x + bounds.width - 24,
				y = bounds.y + 18;
			const panelPosition = await sidebar.evaluate((node) => node.scrollTop);
			await input.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: [{ x, y }],
			});
			await input.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x: x - 40, y: y + 2 }],
			});
			await input.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x: x - 90, y: y + 32 }],
			});
			expect(await sidebar.evaluate((node) => node.scrollTop)).toBe(
				panelPosition,
			);
			await input.send("Input.dispatchTouchEvent", {
				type: "touchEnd",
				touchPoints: [],
			});
			await expect(sidebar).toBeHidden();
			await expect(menu).toBeFocused();
			expect(new URL(page.url()).hash).toBe(selectionBeforeSwipe);
			// The next intentional native tap still selects, then restore the first owner.
			for (const name of [
				/Design session Other project/,
				/Design session Pi Companion/,
			]) {
				await menu.click();
				await sidebar.evaluate(async (node) => {
					await Promise.all(
						node.getAnimations().map((animation) => animation.finished),
					);
				});
				const tap = (await sidebar
					.getByRole("button", { name })
					.boundingBox())!;
				await input.send("Input.dispatchTouchEvent", {
					type: "touchStart",
					touchPoints: [{ x: tap.x + 30, y: tap.y + 18 }],
				});
				await input.send("Input.dispatchTouchEvent", {
					type: "touchEnd",
					touchPoints: [],
				});
				await expect(sidebar).toBeHidden();
				await expect(menu).toBeFocused();
			}
			expect(new URL(page.url()).hash).toBe(selectionBeforeSwipe);
			await input.send("Emulation.setTouchEmulationEnabled", {
				enabled: false,
			});
			await input.detach();
			expect(await history.evaluate((node) => node.scrollTop)).toBe(
				positionBeforeSwipe,
			);
		}
		expect(mutations).toEqual([]);
		await expect(menu).toHaveAccessibleName(
			"Open sessions: Design session · Pi Companion",
		);
		await expect(
			page.getByRole("combobox", { name: "Select live session" }),
		).toHaveCount(0);
		await expect(page.locator("header button")).toHaveCount(1);
		await menu.focus();
		await page.keyboard.press("Enter");
		await expect(sidebar).toBeVisible();
		await expect(
			sidebar.getByRole("region", { name: "Browser control" }),
		).toHaveCount(0);
		await expect(
			sidebar
				.getByRole("region", { name: "Device access" })
				.getByRole("button", { name: "Forget this device" }),
		).toBeVisible();
		for (const [selector, points, finish] of [
			[
				".session-sidebar",
				[
					[180, 100],
					[178, 145],
					[90, 145],
				],
				"end",
			],
			[
				".session-sidebar",
				[
					[180, 100],
					[220, 100],
					[90, 100],
				],
				"end",
			],
			[
				".session-sidebar",
				[
					[180, 100],
					[90, 160],
				],
				"end",
			],
			[
				".session-sidebar",
				[
					[180, 100],
					[150, 100],
				],
				"end",
			],
			[
				".session-sidebar",
				[
					[180, 100],
					[90, 100],
				],
				"multi",
			],
			[
				".session-sidebar",
				[
					[180, 100],
					[90, 100],
				],
				"cancel",
			],
			[
				".sidebar-heading button",
				[
					[180, 100],
					[90, 100],
				],
				"end",
			],
			[
				".session-sidebar",
				[
					[width - 1, 100],
					[90, 100],
				],
				"end",
			], // Backdrop, outside the panel.
		] as [string, [number, number][], "end" | "multi" | "cancel"][]) {
			await swipe(selector, points, finish);
			await expect(sidebar).toBeVisible();
		}
		await sidebar.locator("h2").evaluate((node) => {
			const range = document.createRange();
			range.selectNodeContents(node);
			window.getSelection()?.removeAllRanges();
			window.getSelection()?.addRange(range);
		});
		expect(
			await swipe(".session-sidebar", [
				[180, 100],
				[90, 100],
			]),
		).not.toContain(true);
		await expect(sidebar).toBeVisible();
		await page.evaluate(() => window.getSelection()?.removeAllRanges());
		if (width < 640) {
			const row = ".session-sidebar .session-card:nth-of-type(2) > button";
			const details = ".session-sidebar .directory-details summary";
			for (const selector of [
				details,
				row,
				'.session-sidebar button:has-text("Forget this device")',
			]) {
				expect(
					await swipe(
						selector,
						[
							[180, 100],
							[90, 100],
						],
						"identity",
					),
				).not.toContain(true);
				await expect(sidebar).toBeVisible();
			}
			expect(
				await swipe('.session-sidebar button:has-text("Forget this device")', [
					[180, 100],
					[90, 100],
				]),
			).not.toContain(true);
			await expect(sidebar).toBeVisible();
			const compatibilityClick = (selector: string, detail = 1) =>
				page.locator(selector).evaluate((node, detail) => {
					const click = new MouseEvent("click", {
						bubbles: true,
						cancelable: true,
						detail,
					});
					Object.defineProperty(click, "sourceCapabilities", {
						value: { firesTouchEvents: true },
					});
					node.dispatchEvent(click);
					return click.defaultPrevented;
				}, detail);
			for (const points of [
				[
					[180, 100],
					[150, 102],
				], // Claimed but short.
				[
					[180, 100],
					[145, 102],
					[200, 102],
				], // Reversed after claim.
				[
					[180, 100],
					[145, 102],
					[140, 170],
				], // Vertical dominance after claim.
			] as [number, number][][]) {
				expect(await swipe(row, points)).toContain(true);
				expect(await compatibilityClick(row)).toBe(true);
				await expect(sidebar).toBeVisible();
				expect(new URL(page.url()).hash).toBe(selectionBeforeSwipe);
			}
			// Keyboard activation and an actual mouse click are not compatibility clicks.
			await swipe(details, [
				[180, 100],
				[150, 102],
			]);
			await page.locator(details).focus();
			await page.keyboard.press("Enter");
			await expect(page.locator(details).locator("..")).toHaveAttribute(
				"open",
				"",
			);
			expect(await compatibilityClick(details)).toBe(true);
			await swipe(details, [
				[180, 100],
				[150, 102],
			]);
			await page.locator(details).click();
			await expect(page.locator(details).locator("..")).not.toHaveAttribute(
				"open",
			);
			// A new touch clears suppression, even when the previous swipe was short.
			expect(
				await swipe(details, [
					[180, 100],
					[150, 102],
				]),
			).toContain(true);
			await swipe(details, [[180, 100]]);
			expect(await compatibilityClick(details)).toBe(false);
			await expect(page.locator(details).locator("..")).toHaveAttribute(
				"open",
				"",
			);
			await page.locator(details).focus();
			await page.keyboard.press("Space");
			await expect(page.locator(details).locator("..")).not.toHaveAttribute(
				"open",
			);
			// Diagonal drift after the horizontal claim no longer discards intent.
			for (const selector of [row, details]) {
				expect(
					await swipe(selector, [
						[180, 100],
						[145, 102],
						[90, 132],
					]),
				).toEqual([true, true]);
				expect(await compatibilityClick(selector)).toBe(true);
				await expect(sidebar).toBeHidden();
				await expect(menu).toBeFocused();
				expect(new URL(page.url()).hash).toBe(selectionBeforeSwipe);
				await page.screenshot({
					path: `/tmp/reliable-drawer-evidence/${browserName}-${width}-closed.png`,
				});
				await menu.click();
				await expect(sidebar).toBeVisible();
			}
			await sidebar.evaluate(async (node) => {
				await Promise.all(
					node.getAnimations().map((animation) => animation.finished),
				);
			});
			await page.screenshot({
				path: `/tmp/reliable-drawer-evidence/${browserName}-${width}-drawer.png`,
			});
			expect(mutations).toEqual([]);
		}
		const closingGesture = await swipe(".session-sidebar", [
			[180, 100],
			[90, 104],
		]);
		if (width < 640) {
			expect(closingGesture).toContain(true);
			await expect(sidebar).toBeHidden();
			await expect(menu).toBeFocused();
			expect(await history.evaluate((node) => node.scrollTop)).toBe(
				positionBeforeSwipe,
			);
			expect(new URL(page.url()).hash).toBe(selectionBeforeSwipe);
			await expect(page.getByPlaceholder("Message Pi")).toHaveValue(
				"First terminal draft",
			);
			await menu.click();
		} else {
			expect(closingGesture).not.toContain(true);
			await expect(sidebar).toBeVisible();
		}
		const otherCard = sidebar.getByRole("group", {
			name: "Design session · Other project",
			exact: true,
		});
		await expect(otherCard.getByRole("button")).toContainText("Input pending");
		await expect(otherCard.getByRole("button")).not.toContainText(
			other.instance.slice(0, 8),
		);
		await expect(otherCard.locator("details")).toHaveCount(0);
		await expect(otherCard).not.toContainText(`Instance ${other.instance}`);
		await otherCard.getByRole("button").focus();
		await page.keyboard.press("Tab");
		await expect(menu).not.toBeFocused();
		await expect(page.getByPlaceholder("Message Pi")).not.toBeFocused();
		await expect(sidebar.locator('[aria-current="true"]')).toContainText(
			"Design session",
		);
		await page.keyboard.press("Escape");
		await expect(sidebar).toBeHidden();
		await expect(menu).toBeFocused();
		await chooseSession(page, other.instance);
		await expect(sidebar).toBeHidden();
		await expect(menu).toHaveAccessibleName(
			"Open sessions: Design session · Other project",
		);
		await expect(menu).toBeFocused();
		expect(new URL(page.url()).hash).toBe(
			`#session=${other.instance}:${other.generation}`,
		);
		await expect(
			composer.getByRole("button", { name: "Stop", exact: true }),
		).toBeVisible();
		await expect(
			composer.getByRole("button", { name: "Send", exact: true }),
		).toBeVisible();
		await expect(
			composer.getByRole("button", { name: "Send", exact: true }),
		).toBeDisabled();
		await expect(page.getByPlaceholder("Message Pi")).toHaveValue("");
		await page.getByPlaceholder("Message Pi").fill("Other terminal draft");
		await menu.click();
		await sidebar
			.getByRole("button", { name: /Design session Pi Companion/ })
			.click();
		await expect(page.getByPlaceholder("Message Pi")).toHaveValue(
			"First terminal draft",
		);
		await chooseSession(page, "");
		await expect(menu).toBeFocused();
		await expect(menu).toHaveAccessibleName("Open sessions: Pi Companion");
		expect(new URL(page.url()).hash).toBe("");
		await expect(
			home.getByRole("button", { name: "Design session Pi Companion Pi idle" }),
		).toBeVisible();
		await expect(composer).toHaveCount(0);
		await menu.click();
		await sidebar
			.getByRole("button", { name: /Design session Pi Companion/ })
			.click();
		await expect(page.getByPlaceholder("Message Pi")).toHaveValue(
			"First terminal draft",
		);
		expect(mutations).toEqual([]);
		for (const colorScheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme });
			await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
			for (const enlarged of [false, true]) {
				await page.evaluate((enlarged) => {
					document.documentElement.style.fontSize = enlarged ? "125%" : "";
				}, enlarged);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
				await page.screenshot({
					path: testInfo.outputPath(
						`chat-shell-${width}-${colorScheme}-${enlarged ? "enlarged" : "ordinary"}.png`,
					),
				});
				await menu.click();
				expect(
					await sidebar.evaluate(
						(node) => node.scrollWidth <= node.clientWidth,
					),
				).toBe(true);
				expect(
					(await sidebar
						.getByRole("button", { name: "Close sessions" })
						.boundingBox())!.width,
				).toBeGreaterThanOrEqual(44);
				await page.screenshot({
					path: testInfo.outputPath(
						`drawer-${width}-${colorScheme}-${enlarged ? "enlarged" : "ordinary"}.png`,
					),
				});
				await sidebar.getByRole("button", { name: "Close sessions" }).click();
			}
		}
		await page.setViewportSize({ width, height: 568 });
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "125%";
		});
		await menu.click();
		expect(
			await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth),
		).toBe(true);
		await expect(
			sidebar.getByRole("button", { name: "Forget this device" }),
		).toBeEnabled();
		await page.screenshot({
			path: testInfo.outputPath(`session-sidebar-${width}.png`),
		});
		await sidebar.getByRole("button", { name: "Close sessions" }).click();
		await expect(menu).toBeFocused();
	});

test("M3 home and sidebar groups exact working directories with recency and truthful status", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 320, height: 568 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	const sessions = [
		{
			instance: "c".repeat(32),
			session: "Newest question",
			lastInteraction: 1767398400000,
			needsInput: true,
			subagents: {
				activeWork: 3,
				labels: [
					"reviewer",
					"worker",
					"public-agent-with-a-long-name",
					"workflow",
				],
			},
			cwd: "/workspace/team-a/Observed project",
		},
		{
			instance: "a".repeat(32),
			session: "Tied active",
			lastInteraction: 1767312000000,
			parent: "working" as const,
			cwd: "/workspace/team-b/Observed project",
		},
		{
			instance: "b".repeat(32),
			session: "Tied idle",
			subagents: { activeWork: 2, labels: ["worker"] },
			lastInteraction: 1767312000000,
			cwd: "/workspace/team-a/Observed project",
		},
		{ instance: "d".repeat(32), session: "Unknown time" },
	].map((session) => ({
		generation: "e".repeat(32),
		project: "Observed project",
		parent: "idle" as "idle" | "working",
		background: "unobserved" as const,
		conflict: false,
		display: undefined as Summary["display"],
		pending: false,
		stop: undefined as "stopping" | "parent-settled" | undefined,
		subagents: undefined as
			{ activeWork: number; labels: string[] } | undefined,
		...session,
	}));
	await page.route("**/api/snapshot*", (route) => {
		const instance = new URL(route.request().url()).searchParams.get(
			"instance",
		);
		const owner = sessions.find((session) => session.instance === instance);
		return route.fulfill({
			json: {
				connection: "disconnected",
				sessions,
				...(owner
					? {
							selected: {
								instance: owner.instance,
								generation: owner.generation,
							},
						}
					: {}),
			},
		});
	});
	await page.addInitScript((sessions) => {
		const sources = new Set<FixtureSource>();
		let items: Snapshot["items"] | undefined;
		class FixtureSource extends EventTarget {
			onerror: (() => void) | null = null;
			constructor(private url: string) {
				super();
				sources.add(this);
				queueMicrotask(() => this.emit());
			}
			close() {
				sources.delete(this);
			}
			emit() {
				const instance = new URL(this.url, location.origin).searchParams.get(
					"instance",
				);
				const owner = sessions.find((session) => session.instance === instance);
				this.dispatchEvent(
					new MessageEvent("snapshot", {
						data: JSON.stringify({
							connection: owner ? "connected" : "disconnected",
							sessions,
							...(owner
								? {
										selected: {
											instance: owner.instance,
											generation: owner.generation,
										},
										...(items
											? {
													snapshot: {
														...owner,
														items,
														truncated: false,
														omittedItems: 0,
													},
												}
											: {}),
									}
								: {}),
						}),
					}),
				);
			}
		}
		Object.defineProperty(window, "EventSource", { value: FixtureSource });
		Object.defineProperty(window, "loadConversationHistory", {
			value: () => {
				items = Array.from({ length: 30 }, (_, index) => ({
					id: `history-${index}`,
					role: "assistant",
					blocks: [
						{
							type: "text",
							text: `Earlier message ${index}. Read without losing your place.`,
						},
					],
				}));
				for (const source of sources) source.emit();
			},
		});
		Object.defineProperty(window, "updateSessionObservation", {
			value: (patch: Partial<(typeof sessions)[number]> | "disconnect") => {
				if (patch === "disconnect") {
					for (const source of sources) source.onerror?.();
				} else {
					Object.assign(sessions[0], patch);
					for (const source of sources) source.emit();
				}
			},
		});
	}, sessions);
	const mutations: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST") mutations.push(request.url());
	});
	await page.goto("/");
	const home = page.getByRole("region", { name: "Live sessions", exact: true });
	const menu = page.getByRole("button", { name: /^Open sessions:/ });
	const sidebar = page.getByRole("dialog", { name: "Live sessions" });
	await expect(home.locator(".session-card strong")).toHaveText([
		"Newest question",
		"Tied idle",
		"Tied active",
		"Unknown time",
	]);
	await expect(home.locator(".session-activity")).toHaveText([
		"Needs answer",
		"Subagent work active",
		"Pi is working",
		"Pi idle",
	]);
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 568 });
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			for (const enlarged of [false, true]) {
				await page.evaluate((enlarged) => {
					document.documentElement.style.fontSize = enlarged ? "125%" : "";
				}, enlarged);
				expect(
					await home.evaluate((node) => node.scrollWidth <= node.clientWidth),
				).toBe(true);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
				for (const [index, row] of (
					await home.locator(".session-card").all()
				).entries()) {
					const box = (await row.boundingBox())!;
					expect(box.height).toBeLessThanOrEqual(enlarged ? 100 : 80);
					if (!enlarged || index < 3)
						expect(box.y + box.height).toBeLessThanOrEqual(548);
					expect(
						(await row.getByRole("button").boundingBox())!.height,
					).toBeGreaterThanOrEqual(44);
					expect(
						(await row.getByRole("button").boundingBox())!.width,
					).toBeCloseTo(box.width, 0);
					await expect(row.locator("details")).toHaveCount(0);
				}
				await page.screenshot({
					path: testInfo.outputPath(
						`home-${width}-${theme}-${enlarged ? "enlarged" : "ordinary"}.png`,
					),
				});
				await menu.click();
				expect(
					await sidebar.evaluate(
						(node) => node.scrollWidth <= node.clientWidth,
					),
				).toBe(true);
				await expect(sidebar.locator(".session-card strong")).toHaveText([
					"Newest question",
					"Tied idle",
					"Tied active",
					"Unknown time",
				]);
				for (const row of await sidebar.locator(".session-card").all()) {
					if (!enlarged)
						expect((await row.boundingBox())!.height).toBeLessThanOrEqual(80);
					expect(
						(await row.getByRole("button").boundingBox())!.height,
					).toBeGreaterThanOrEqual(44);
					expect(
						(await row.getByRole("button").boundingBox())!.width,
					).toBeCloseTo((await row.boundingBox())!.width, 0);
					await expect(row.locator("details")).toHaveCount(0);
				}
				await page.screenshot({
					path: testInfo.outputPath(
						`grouped-drawer-${width}-${theme}-${enlarged ? "enlarged" : "ordinary"}.png`,
					),
				});
				await sidebar.getByRole("button", { name: "Close sessions" }).click();
				await expect(menu).toBeFocused();
			}
		}
	}
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "";
	});
	await page.setViewportSize({ width: 320, height: 568 });
	await menu.click();
	await expect(sidebar.locator(".session-directory h3")).toHaveText([
		"Observed project",
		"Observed project",
		"Working directory unavailable",
	]);
	await expect(
		sidebar
			.getByRole("region", {
				name: "/workspace/team-a/Observed project",
				exact: true,
			})
			.locator(".session-card strong"),
	).toHaveText(["Newest question", "Tied idle"]);
	await expect(
		sidebar
			.getByRole("region", {
				name: "/workspace/team-b/Observed project",
				exact: true,
			})
			.locator(".session-card strong"),
	).toHaveText(["Tied active"]);
	await expect(sidebar.locator(".session-card strong")).toHaveText([
		"Newest question",
		"Tied idle",
		"Tied active",
		"Unknown time",
	]);
	await expect(
		sidebar.getByText("4 live terminals · Background unobserved", {
			exact: true,
		}),
	).toBeVisible();
	for (const cwd of [
		"/workspace/team-a/Observed project",
		"/workspace/team-b/Observed project",
	]) {
		const directory = sidebar.getByRole("region", { name: cwd, exact: true });
		const disclosure = directory.getByLabel(`Working directory: ${cwd}`, {
			exact: true,
		});
		await expect(directory.getByText(cwd, { exact: true })).toBeHidden();
		await disclosure.focus();
		await page.keyboard.press("Enter");
		await expect(directory.getByText(cwd, { exact: true })).toBeVisible();
		await page.keyboard.press("Enter");
	}
	const nativeRow = sidebar.getByRole("group", {
		name: "Newest question · Observed project",
	});
	await expect(nativeRow.locator("details")).toHaveCount(0);
	await expect(nativeRow).not.toContainText("Instance ");
	await expect(nativeRow).not.toContainText("Generation ");
	await expect(nativeRow).not.toContainText("active work items");
	await nativeRow.getByRole("button").focus();
	await expect(nativeRow.getByRole("button")).toBeFocused();
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "125%";
	});
	expect(
		await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth),
	).toBe(true);
	await page.screenshot({
		path: testInfo.outputPath("native-row-320-enlarged.png"),
	});
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "";
	});
	const statuses = sidebar.locator(".session-activity");
	const palette = {
		light: {
			green: "rgb(21, 128, 61)",
			amber: "rgb(161, 98, 7)",
			red: "rgb(185, 28, 28)",
			gray: "rgb(97, 97, 97)",
		},
		dark: {
			green: "rgb(74, 222, 128)",
			amber: "rgb(250, 204, 21)",
			red: "rgb(248, 113, 113)",
			gray: "rgb(176, 176, 176)",
		},
	};
	await expect(statuses).toHaveText([
		"Needs answer",
		"Subagent work active",
		"Pi is working",
		"Pi idle",
	]);
	await expect(sidebar.locator(".session-dot")).toHaveCount(4);
	await expect(sidebar.locator(".session-dot").first()).toHaveAttribute(
		"aria-hidden",
		"true",
	);
	for (const theme of ["light", "dark"] as const) {
		await page.emulateMedia({ colorScheme: theme });
		for (const [index, color] of (
			["amber", "green", "green", "gray"] as const
		).entries()) {
			await expect(sidebar.locator(".session-dot").nth(index)).toHaveCSS(
				"border-top-color",
				palette[theme][color],
			);
		}
		await expect(sidebar.locator(".session-dot").nth(3)).toHaveCSS(
			"background-color",
			"rgba(0, 0, 0, 0)",
		);
		await page.screenshot({
			path: testInfo.outputPath(`status-lights-${theme}-320.png`),
		});
	}
	const question = sidebar
		.getByRole("group", { name: "Newest question · Observed project" })
		.getByRole("button");
	await expect(question).toHaveAccessibleName(
		"Newest question Observed project Needs answer",
	);
	const update = (patch: Partial<(typeof sessions)[number]> | "disconnect") => {
		if (patch !== "disconnect") Object.assign(sessions[0], patch);
		return page.evaluate(
			(patch) =>
				(
					window as unknown as {
						updateSessionObservation: (
							value: Partial<(typeof sessions)[number]> | "disconnect",
						) => void;
					}
				).updateSessionObservation(patch),
			patch,
		);
	};
	for (const [patch, text] of [
		[{ parent: "working" }, "Needs answer"],
		[{ pending: true }, "Input pending"],
		[{ stop: "stopping" }, "Stopping"],
		[{ stop: "parent-settled" }, "Stopped (observed)"],
		[{ conflict: true }, "Ownership conflict"],
		["disconnect", "Unavailable"],
		[
			{
				conflict: false,
				pending: false,
				stop: undefined,
				needsInput: false,
				parent: "idle",
			},
			"Subagent work active",
		],
		[{ subagents: undefined }, "Pi idle"],
		[
			{
				subagents: {
					activeWork: 3,
					labels: [
						"reviewer",
						"worker",
						"public-agent-with-a-long-name",
						"workflow",
					],
				},
			},
			"Subagent work active",
		],
		[{ parent: "working" }, "Pi is working"],
	] as [Partial<(typeof sessions)[number]> | "disconnect", string][]) {
		await update(patch);
		await expect(statuses.first()).toHaveText(text);
		await expect(question).toHaveAccessibleName(
			`Newest question Observed project ${text}`,
		);
		const color = ["Pi is working", "Subagent work active"].includes(text)
			? "green"
			: text === "Ownership conflict"
				? "red"
				: ["Needs answer", "Input pending", "Stopping"].includes(text)
					? "amber"
					: "gray";
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await expect(statuses.first().locator(".session-dot")).toHaveCSS(
				"border-top-color",
				palette[theme][color],
			);
		}
	}
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "125%";
	});
	expect(
		await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth),
	).toBe(true);
	await expect(sidebar.locator(".session-card strong")).toHaveText([
		"Newest question",
		"Tied idle",
		"Tied active",
		"Unknown time",
	]);
	await update({
		cwd: "/workspace/" + "long-directory-".repeat(18) + "/Observed project",
	});
	const longPath =
		"/workspace/" + "long-directory-".repeat(18) + "/Observed project";
	await sidebar
		.getByLabel(`Working directory: ${longPath}`, { exact: true })
		.click();
	await expect(sidebar.getByText(longPath, { exact: true })).toBeVisible();
	expect(
		await sidebar.evaluate((node) => node.scrollWidth <= node.clientWidth),
	).toBe(true);
	await page.screenshot({
		path: testInfo.outputPath("cwd-groups-320-enlarged.png"),
	});
	await sidebar.getByRole("button", { name: "Close sessions" }).click();
	await expect(menu).toBeFocused();
	await home
		.getByRole("button", {
			name: "Newest question Observed project Pi is working",
		})
		.click();
	await expect(home).toHaveCount(0);
	await expect(
		page.getByText("Loading conversation…", { exact: true }),
	).toBeVisible();
	await expect(
		page.locator("header").getByText("Pi is working", { exact: true }),
	).toBeVisible();
	await update({
		display: [
			{
				provider: "subagents",
				key: "fleet",
				title: "Subagents",
				status: "3 active work items",
				lines: [
					"reviewer",
					"worker",
					"public-agent-with-a-long-name",
					"workflow",
					"Other background status unknown",
				],
			},
			{
				provider: "build",
				key: "state",
				title: "Build status",
				status: "Awaiting local review with a long readable status",
				lines: [
					"<script>literal text</script>",
					"No actions or remote execution",
				],
			},
		],
	});
	const displays = page.getByRole("region", { name: "Extension displays" });
	expect(
		await displays.evaluate((node) => !!node.closest(".chat-scroll")),
	).toBe(true);
	await expect(page.locator("header .extension-displays")).toHaveCount(0);
	const fleetCard = displays.locator("details").nth(0);
	const buildCard = displays.locator("details").nth(1);
	await expect(fleetCard.locator("summary")).toContainText(
		"3 active work items",
	);
	await buildCard.locator("summary").focus();
	await expect(buildCard.locator("summary")).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(buildCard).toHaveAttribute("open", "");
	await expect(
		buildCard.getByText("<script>literal text</script>", { exact: true }),
	).toBeVisible();
	expect(await displays.locator("script, a, button, input").count()).toBe(0);
	await fleetCard.locator("summary").click();
	await expect(fleetCard.getByText("reviewer", { exact: true })).toBeVisible();
	await fleetCard.locator("summary").click();
	await buildCard.locator("summary").focus();
	await page.keyboard.press("Space");
	await expect(buildCard).not.toHaveAttribute("open");
	await expect(buildCard.locator("summary")).toBeFocused();
	await expect(buildCard.locator("summary")).toHaveCSS(
		"outline-offset",
		"-3px",
	);
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 568 });
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "125%";
			});
			expect(
				await displays.evaluate((node) => node.scrollWidth <= node.clientWidth),
			).toBe(true);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			expect(
				(await buildCard.locator("summary").boundingBox())!.height,
			).toBeGreaterThanOrEqual(44);
			await page.screenshot({
				path: testInfo.outputPath(`extension-display-${width}-${theme}.png`),
			});
			await page.keyboard.press("Enter");
			await expect(buildCard).toHaveAttribute("open", "");
			await buildCard.locator("summary").scrollIntoViewIfNeeded();
			await page.screenshot({
				path: testInfo.outputPath(
					`extension-display-expanded-${width}-${theme}.png`,
				),
			});
			await page.keyboard.press("Enter");
			await expect(buildCard).not.toHaveAttribute("open");
		}
	}
	await update({
		display: [
			{
				provider: "build",
				key: "state",
				title: "Build status",
				status: "Updated",
				lines: ["Current snapshot"],
			},
		],
	});
	await expect(displays.locator("details")).toHaveCount(1);
	await expect(displays.locator("summary")).toContainText("Updated");
	await update({ display: [] });
	await expect(displays).toHaveCount(0);
	const feedback = page.locator(".working-feedback");
	await expect(feedback).toHaveText("Pi is working");
	await expect(feedback).toHaveAttribute("role", "status");
	await expect(feedback.locator(".working-marker")).toHaveAttribute(
		"aria-hidden",
		"true",
	);
	await expect(page.locator("article")).toHaveCount(0);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	const dots = feedback.locator(".working-marker > span");
	await expect(dots).toHaveCount(3);
	await expect(feedback.locator(".visually-hidden")).toHaveText(
		"Pi is working",
	);
	await expect(feedback.locator(".visually-hidden")).toHaveCSS(
		"clip-path",
		"inset(50%)",
	);
	for (const dot of await dots.all()) {
		await expect
			.poll(() => dot.evaluate((node) => node.getAnimations().length))
			.toBe(1);
		await expect(dot).toHaveCSS("transform", "none");
	}
	const marker = feedback.locator(".working-marker");
	expect((await marker.boundingBox())!.width).toBe(20);
	expect((await feedback.boundingBox())!.height).toBe(12);
	await page.emulateMedia({ reducedMotion: "reduce" });
	for (const dot of await dots.all()) {
		await expect
			.poll(() => dot.evaluate((node) => node.getAnimations().length))
			.toBe(0);
		await expect(dot).toHaveCSS("opacity", "1");
	}
	await expect(feedback).toBeVisible();
	for (const patch of [
		{ needsInput: true },
		{ needsInput: false, pending: true },
		{ pending: false, stop: "stopping" as const },
		{ stop: "parent-settled" as const },
		{ stop: undefined, conflict: true },
	]) {
		await update(patch);
		await expect(feedback).toHaveCount(0);
	}
	await update({ conflict: false, parent: "idle" });
	await expect(feedback).toHaveText("Subagent work active");
	await expect(
		page.locator("header").getByText("Subagent work active", { exact: true }),
	).toBeVisible();
	for (const width of [320, 390, 900]) {
		await page.setViewportSize({ width, height: 568 });
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(`subagent-header-${width}-${theme}.png`),
			});
		}
	}
	const longSession =
		"Selected session with a deliberately long readable identity";
	const longProject = "Project with a deliberately long working directory name";
	await update({
		session: longSession,
		project: longProject,
		needsInput: true,
	});
	await expect(menu).toHaveAccessibleName(
		`Open sessions: ${longSession} · ${longProject}`,
	);
	await expect(page.locator("header .parent-status")).toHaveText(
		"Needs answer",
	);
	await expect(page.locator("header .subagent-observation")).toHaveCount(0);
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 568 });
		expect(
			await page
				.locator("header")
				.evaluate((node) => node.scrollWidth <= node.clientWidth),
		).toBe(true);
		await expect(menu).toBeVisible();
		expect((await menu.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		await page.screenshot({
			path: testInfo.outputPath(
				`header-long-needs-answer-${width}-dark-125percent.png`,
			),
		});
	}
	await update({
		session: "Newest question",
		project: "Observed project",
		needsInput: false,
		subagents: undefined,
	});
	await expect(feedback).toHaveCount(0);
	await expect(
		page.locator("header").getByText("Pi idle", { exact: true }),
	).toBeVisible();
	await expect(page.locator("header .subagent-observation")).toHaveCount(0);
	await menu.click();
	const selectedRow = sidebar.getByRole("group", {
		name: "Newest question · Observed project",
	});
	await expect(selectedRow.locator("details")).toHaveCount(0);
	await expect(selectedRow.getByRole("button")).toHaveAttribute(
		"aria-current",
		"true",
	);
	await expect(selectedRow.getByRole("button")).toContainText("Pi idle");
	await sidebar.getByRole("button", { name: "Close sessions" }).click();
	await expect(sidebar).toBeHidden();
	await update({ parent: "working" });
	await expect(feedback).toBeVisible();
	await update({
		display: [
			{
				provider: "build",
				key: "state",
				title: "Build status",
				status: "Current",
				lines: [],
			},
		],
	});
	await expect(displays).toBeVisible();
	await update("disconnect");
	await expect(displays).toHaveCount(0);
	await expect(feedback).toHaveCount(0);
	await expect(
		page.getByText(
			"Selected conversation unavailable. Waiting for the terminal to reconnect.",
			{ exact: true },
		),
	).toBeVisible();
	await update({ parent: "idle" });
	await page.evaluate(() =>
		(
			window as unknown as { loadConversationHistory: () => void }
		).loadConversationHistory(),
	);
	const history = page.getByRole("region", {
		name: "Conversation history",
		exact: true,
	});
	await expect(history.locator("article")).toHaveCount(30);
	const readerHeight = (await history.boundingBox())!.height;
	await update({
		display: [
			{
				provider: "subagents",
				key: "fleet",
				title: "Subagents",
				status: "2 active work items",
				lines: ["worker", "reviewer"],
			},
		],
	});
	expect((await history.boundingBox())!.height).toBe(readerHeight);
	expect(
		await displays.evaluate((node) => {
			const conversation = document.querySelector(".conversation")!;
			return !!(conversation.compareDocumentPosition(node) & 4);
		}),
	).toBe(true);
	const distance = () =>
		history.evaluate(
			(node) => node.scrollHeight - node.clientHeight - node.scrollTop,
		);
	await expect.poll(distance).toBeLessThanOrEqual(1);
	await history.hover();
	await page.mouse.wheel(0, -500);
	await expect.poll(distance).toBeGreaterThan(64);
	// The bottom panel moves below the viewport when reading earlier messages.
	await expect
		.poll(async () => {
			const panel = (await displays.boundingBox())!;
			const reader = (await history.boundingBox())!;
			return panel.y >= reader.y + reader.height;
		})
		.toBe(true);
	const jump = page.getByRole("button", { name: "Jump to latest" });
	await expect(jump).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("subagents-scrolled-away.png"),
	});
	const before = await history.evaluate((node) => node.scrollTop);
	await update({
		parent: "working",
		display: [
			{
				provider: "subagents",
				key: "fleet",
				title: "Subagents",
				status: "3 active work items",
				lines: ["worker", "reviewer", "workflow"],
			},
		],
	});
	await expect(feedback).toHaveText("Pi is working");
	await page.evaluate(() => new Promise(requestAnimationFrame));
	expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
		before,
		0,
	);
	await jump.click();
	await expect(feedback).toBeVisible();
	await expect.poll(distance).toBeLessThanOrEqual(1);
	const panelAtLatest = (await displays.boundingBox())!;
	const readerAtLatest = (await history.boundingBox())!;
	expect(panelAtLatest.y).toBeGreaterThanOrEqual(readerAtLatest.y);
	expect(panelAtLatest.y + panelAtLatest.height).toBeLessThanOrEqual(
		readerAtLatest.y + readerAtLatest.height,
	);
	await page.screenshot({
		path: testInfo.outputPath("subagents-at-conversation-bottom.png"),
	});
	await update({ parent: "idle" });
	await expect(feedback).toHaveCount(0);
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	await expect.poll(distance).toBeLessThanOrEqual(1);
	await update({ parent: "working" });
	await expect(feedback).toBeVisible();
	await expect.poll(distance).toBeLessThanOrEqual(1);
	await expect(history.locator("article")).toHaveCount(30);
	await update("disconnect");
	await expect(feedback).toHaveCount(0);
	await expect(page.locator("header .parent-status")).toHaveText("Unavailable");
	await expect(history.locator("article")).toHaveCount(30);
	await update({ parent: "working" });
	await expect(feedback).toBeVisible();
	await expect(displays).toBeVisible();
	await chooseSession(page, sessions[3].instance);
	await expect(displays).toHaveCount(0);
	await expect(feedback).toHaveCount(0);
	// Same name, project and cwd remain distinct exact owners in observed order.
	await update({
		session: "Tied idle",
		needsInput: false,
		parent: "idle",
		subagents: { activeWork: 2, labels: ["worker"] },
	});
	for (const instance of [
		sessions[2].instance,
		sessions[0].instance,
		sessions[2].instance,
	]) {
		await chooseSession(page, instance);
		await menu.click();
		const rows = sidebar.getByRole("group", {
			name: "Tied idle · Observed project",
			exact: true,
		});
		await expect(rows).toHaveCount(2);
		await expect(
			rows.nth(instance === sessions[0].instance ? 0 : 1).getByRole("button"),
		).toHaveAttribute("aria-current", "true");
		await expect(sidebar.locator('[aria-current="true"]')).toHaveCount(1);
		await sidebar.getByRole("button", { name: "Close sessions" }).click();
	}
	await chooseSession(page, "");
	await expect(home).toBeVisible();
	await expect(feedback).toHaveCount(0);
	expect(mutations).toEqual([]);
});

for (const reducedMotion of ["no-preference", "reduce"] as const)
	test(`M2 native sessions motion and cancellation with ${reducedMotion}`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion });
		const first = {
			instance: "a".repeat(32),
			generation: "b".repeat(32),
			session: "First terminal",
			project: "Motion project",
			parent: "idle",
			background: "unobserved",
		};
		const second = {
			...first,
			instance: "c".repeat(32),
			generation: "d".repeat(32),
			session: "Second terminal",
		};
		let revoked = false;
		await page.route("**/api/snapshot*", (route) => {
			const instance = new URL(route.request().url()).searchParams.get(
				"instance",
			);
			const owner = [first, second].find(
				(session) => session.instance === instance,
			);
			return route.fulfill(
				revoked
					? { status: 401, json: {} }
					: {
							json: {
								connection: "connected",
								sessions: [first, second],
								...(owner
									? {
											selected: {
												instance: owner.instance,
												generation: owner.generation,
											},
										}
									: {}),
							},
						},
			);
		});
		await page.addInitScript(
			({ first, second }) => {
				const sources = new Set<Source>();
				class Source extends EventTarget {
					onerror: (() => void) | null = null;
					constructor(private url: string) {
						super();
						sources.add(this);
						queueMicrotask(() => this.emit());
					}
					close() {
						sources.delete(this);
					}
					emit() {
						const owner = [first, second].find(
							(session) =>
								session.instance ===
								new URL(this.url, location.origin).searchParams.get("instance"),
						);
						this.dispatchEvent(
							new MessageEvent("snapshot", {
								data: JSON.stringify({
									connection: "connected",
									sessions: [first, second],
									...(owner
										? {
												selected: owner,
												snapshot: {
													...owner,
													truncated: false,
													items: Array.from({ length: 30 }, (_, i) => ({
														id: `${i}`,
														role: "assistant",
														blocks: [
															{
																type: "text",
																text: `Conversation line ${i}. Keep this scroll position.`,
															},
														],
													})),
												},
											}
										: {}),
								}),
							}),
						);
					}
				}
				Object.defineProperty(window, "EventSource", { value: Source });
				Object.defineProperty(window, "disconnectMotionFixture", {
					value: () => {
						for (const source of sources) source.onerror?.();
					},
				});
			},
			{ first, second },
		);
		const mutations: string[] = [],
			errors: string[] = [];
		page.on("request", (request) => {
			if (request.method() === "POST") mutations.push(request.url());
		});
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`/#session=${first.instance}:${first.generation}`);
		const menu = page.getByRole("button", { name: /^Open sessions:/ });
		const sidebar = page.getByRole("dialog", {
			name: "Live sessions",
			includeHidden: true,
		});
		const history = page.getByRole("region", {
			name: "Conversation history",
			exact: true,
		});
		await expect(page.locator("article")).toHaveCount(30);
		await page.getByPlaceholder("Message Pi").fill("Unsent local draft");
		// Establish deliberate reading before testing modal focus/resize restoration.
		await history.hover();
		await page.mouse.wheel(0, -100);
		await expect
			.poll(() =>
				history.evaluate(
					(node) => node.scrollHeight - node.clientHeight - node.scrollTop,
				),
			)
			.toBeGreaterThan(0);
		await history.evaluate((node) => {
			node.scrollTop = 200;
		});
		const scrollBefore = await history.evaluate((node) => node.scrollTop);
		// Sample actual rendered slide and backdrop, not just animation declarations.
		async function sample(fraction: number) {
			return sidebar.evaluate(async (node, fraction) => {
				const animations = node.getAnimations({ subtree: true });
				for (const animation of animations) {
					animation.pause();
					animation.currentTime =
						Number(animation.effect!.getTiming().duration) * fraction;
				}
				await new Promise(requestAnimationFrame);
				await new Promise(requestAnimationFrame);
				return {
					animations: animations.length,
					x: node.getBoundingClientRect().x,
					width: node.getBoundingClientRect().width,
					shade: Number(getComputedStyle(node, "::backdrop").opacity),
					modal: node.matches(":modal"),
				};
			}, fraction);
		}
		async function finish() {
			await sidebar.evaluate((node) => {
				for (const animation of node.getAnimations({ subtree: true }))
					animation.finish();
			});
		}
		await page.locator("main").evaluate((node) => {
			node.dataset.backdropClicks = "0";
			node.addEventListener("click", (event) => {
				const dialog = node.querySelector("dialog")!;
				if (
					event.target instanceof Node &&
					(event.target === dialog ||
						(!dialog.contains(event.target) &&
							!node.querySelector("header button")!.contains(event.target)))
				)
					node.dataset.backdropClicks = String(
						Number(node.dataset.backdropClicks) + 1,
					);
			});
		});
		await menu.click();
		await finish();
		// Native dialog backdrop events target the dialog, so coordinates own dismissal.
		for (const sequence of [
			"drag",
			"return",
			"inside",
			"enter",
			"multi",
			"cancel",
			"selection",
		] as const) {
			await sidebar.evaluate((node, sequence) => {
				const bounds = node.getBoundingClientRect();
				const outside = bounds.right + 20;
				function pointer(type: string, x: number, y = 180, primary = true) {
					node.dispatchEvent(
						new PointerEvent(type, {
							bubbles: true,
							cancelable: true,
							pointerType: "touch",
							pointerId: primary ? 1 : 2,
							isPrimary: primary,
							button: 0,
							clientX: x,
							clientY: y,
						}),
					);
				}
				if (sequence === "selection") {
					const range = document.createRange();
					range.selectNodeContents(node.querySelector("h2")!);
					window.getSelection()!.addRange(range);
				}
				pointer("pointerdown", sequence === "inside" ? 100 : outside);
				if (sequence === "drag" || sequence === "return")
					pointer("pointermove", outside, 220);
				if (sequence === "enter") pointer("pointermove", 100);
				if (sequence === "multi") pointer("pointerdown", outside, 180, false);
				if (sequence === "cancel") pointer("pointercancel", outside);
				pointer("pointerup", outside, sequence === "drag" ? 220 : 180);
				window.getSelection()?.removeAllRanges();
			}, sequence);
			await expect(sidebar).toBeVisible();
			expect(await sidebar.getAttribute("data-closing")).toBeNull();
		}
		await page.keyboard.press("Escape");
		await expect(sidebar).toBeHidden();
		if (testInfo.project.name === "chromium") {
			const input = await page.context().newCDPSession(page);
			await input.send("Emulation.setTouchEmulationEnabled", { enabled: true });
			await menu.click();
			await finish();
			const x = (await sidebar.boundingBox())!.width + 20;
			await input.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: [{ x, y: 180 }],
			});
			await input.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x, y: 250 }],
			});
			await input.send("Input.dispatchTouchEvent", {
				type: "touchEnd",
				touchPoints: [],
			});
			await expect(sidebar).toBeVisible();
			expect(await sidebar.getAttribute("data-closing")).toBeNull();
			await input.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: [{ x, y: 180 }],
			});
			await input.send("Input.dispatchTouchEvent", {
				type: "touchEnd",
				touchPoints: [],
			});
			await expect(sidebar).toBeHidden();
			await expect(menu).toBeFocused();
			await input.send("Emulation.setTouchEmulationEnabled", {
				enabled: false,
			});
			await input.detach();
		}
		for (const exit of [
			"Close",
			"Escape",
			"swipe",
			"backdrop",
			"touch-backdrop",
			"selection",
		] as const) {
			if (exit === "Escape") {
				await page.locator("main").evaluate((node) => {
					for (const [type, x] of [
						["touchstart", 8],
						["touchmove", 90],
						["touchend", 90],
					] as const) {
						const event = new Event(type, { bubbles: true, cancelable: true });
						const touch = { clientX: x, clientY: 180 };
						Object.defineProperties(event, {
							touches: { value: type === "touchend" ? [] : [touch] },
							changedTouches: { value: [touch] },
						});
						node.dispatchEvent(event);
					}
				});
			} else await menu.click();
			await expect(sidebar).toBeVisible();
			const start = await sample(0),
				middle = await sample(0.5);
			expect(middle.modal).toBe(true);
			if (reducedMotion === "reduce") {
				expect(start.animations).toBe(0);
				expect(middle.x).toBe(0);
				expect(middle.shade).toBe(1);
			} else {
				expect(start.x).toBeCloseTo(-start.width, 0);
				expect(start.shade).toBe(0);
				expect(middle.x).toBeGreaterThan(-middle.width);
				expect(middle.x).toBeLessThan(-1);
				expect(middle.shade).toBeGreaterThan(0);
				expect(middle.shade).toBeLessThan(1);
				if (exit === "Close")
					await page.screenshot({
						path: testInfo.outputPath("sessions-opening-midpoint.png"),
					});
			}
			await finish();
			expect((await sidebar.boundingBox())!.x).toBe(0);
			const close = sidebar.getByRole("button", {
				name: "Close sessions",
				exact: true,
			});
			await close.focus();
			await expect(close).toBeFocused();
			await page.keyboard.press("Tab");
			expect(
				await sidebar.evaluate((node) => node.contains(document.activeElement)),
			).toBe(true);
			if (exit === "Escape") await page.keyboard.press("Escape");
			else if (exit === "backdrop")
				await page.mouse.click((await sidebar.boundingBox())!.width + 20, 180);
			else if (exit === "touch-backdrop") {
				await sidebar.evaluate((node) => {
					const x = node.getBoundingClientRect().right + 20;
					for (const [type, dx, dy] of [
						["pointerdown", 0, 0],
						["pointermove", 3, 4],
						["pointerup", 3, 4],
					] as const)
						node.dispatchEvent(
							new PointerEvent(type, {
								bubbles: true,
								pointerType: "touch",
								pointerId: 1,
								isPrimary: true,
								button: 0,
								clientX: x + dx,
								clientY: 180 + dy,
							}),
						);
				});
				// A delayed compatibility click must not reopen the drawer underneath.
				expect(
					await menu.evaluate(
						(node) =>
							!node.dispatchEvent(
								new MouseEvent("click", {
									bubbles: true,
									cancelable: true,
									detail: 1,
								}),
							),
					),
				).toBe(true);
			} else if (exit === "swipe")
				await sidebar.evaluate((node) => {
					for (const [type, x] of [
						["touchstart", 180],
						["touchmove", 90],
						["touchend", 90],
					] as const) {
						const event = new Event(type, { bubbles: true, cancelable: true });
						const touch = { clientX: x, clientY: 100 };
						Object.defineProperties(event, {
							touches: { value: type === "touchend" ? [] : [touch] },
							changedTouches: { value: [touch] },
						});
						node.dispatchEvent(event);
					}
				});
			else
				await sidebar
					.getByRole("button", {
						name:
							exit === "Close"
								? "Close sessions"
								: /Second terminal Motion project/,
					})
					.evaluate((node) => (node as HTMLButtonElement).click());
			if (reducedMotion === "reduce")
				expect(
					await sidebar.evaluate((node) => (node as HTMLDialogElement).open),
				).toBe(false);
			else {
				const closing = await sample(0.5);
				expect(closing.modal).toBe(true);
				expect(closing.x).toBeGreaterThan(-closing.width);
				expect(closing.x).toBeLessThan(-1);
				expect(closing.shade).toBeGreaterThan(0);
				expect(closing.shade).toBeLessThan(1);
				await close.focus();
				await expect(close).toBeFocused();
				await page.keyboard.press("Tab");
				expect(
					await sidebar.evaluate((node) =>
						node.contains(document.activeElement),
					),
				).toBe(true);
				if (exit === "Close")
					await page.screenshot({
						path: testInfo.outputPath("sessions-closing-midpoint.png"),
					});
				await finish();
			}
			await expect(sidebar).toBeHidden();
			await expect(menu).toBeFocused();
			expect(
				await page.locator("main").getAttribute("data-backdrop-clicks"),
			).toBe("0");
			if (exit !== "selection") {
				expect(await history.evaluate((node) => node.scrollTop)).toBe(
					scrollBefore,
				);
				await expect(page.getByPlaceholder("Message Pi")).toHaveValue(
					"Unsent local draft",
				);
				expect(new URL(page.url()).hash).toBe(
					`#session=${first.instance}:${first.generation}`,
				);
			}
		}
		await expect(menu).toHaveAccessibleName(
			"Open sessions: Second terminal · Motion project",
		);
		expect(new URL(page.url()).hash).toBe(
			`#session=${second.instance}:${second.generation}`,
		);
		// Close during entry; repeated close/open/cancel cannot restart or strand the modal.
		await menu.click();
		const entry = await sample(0.5);
		await sidebar
			.getByRole("button", { name: "Close sessions" })
			.evaluate((node) => (node as HTMLButtonElement).click());
		if (reducedMotion !== "reduce") {
			expect((await sample(0)).x).toBeCloseTo(entry.x, 0);
			await sample(0.5);
			await page.keyboard.press("Escape");
			await menu.evaluate((node) => (node as HTMLButtonElement).click());
			expect((await sample(0.5)).x).toBeLessThan(entry.x);
			await finish();
		}
		await expect(sidebar).toBeHidden();
		await expect(menu).toBeFocused();
		// Also let the real browser clock complete entry and exit without seeking.
		await menu.click();
		await expect
			.poll(() => sidebar.evaluate((node) => node.getBoundingClientRect().x))
			.toBe(0);
		await page.screenshot({
			path: testInfo.outputPath(`sessions-final-${reducedMotion}.png`),
		});
		await page.keyboard.press("Escape");
		await expect(sidebar).toBeHidden();
		await expect(menu).toBeFocused();
		if (reducedMotion !== "reduce") {
			await menu.click();
			await sample(0.5);
			await sidebar
				.getByRole("button", { name: "Close sessions" })
				.evaluate((node) => (node as HTMLButtonElement).click());
			await sample(0.5);
			await page.emulateMedia({ reducedMotion: "reduce" });
			await expect(sidebar).toBeHidden();
			await expect(menu).toBeFocused();
			await page.emulateMedia({ reducedMotion });
		}
		await menu.click();
		await sample(0.5);
		// Authentication departure unmounts immediately, even while a close is pending.
		await sidebar
			.getByRole("button", { name: "Close sessions" })
			.evaluate((node) => (node as HTMLButtonElement).click());
		if (reducedMotion !== "reduce") await sample(0.5);
		revoked = true;
		await page.evaluate(() =>
			(
				window as unknown as { disconnectMotionFixture: () => void }
			).disconnectMotionFixture(),
		);
		await expect(page.getByLabel("Pairing code")).toBeVisible();
		await expect(sidebar).toHaveCount(0);
		expect(await page.locator(":modal").count()).toBe(0);
		expect(mutations).toEqual([]);
		expect(errors).toEqual([]);
	});

for (const access of [
	"remembered",
	"unpaired",
	"network",
	"503",
	"timeout",
] as const)
	test(`U1 initial device check avoids pairing flash and bounds ${access} access`, async ({
		page,
	}) => {
		await page.clock.install();
		let release!: () => void, entered!: () => void;
		const responseHeld = new Promise<void>((resolve) => (release = resolve));
		const requested = new Promise<void>((resolve) => (entered = resolve));
		await page.route("**/api/snapshot*", async (route) => {
			entered();
			await responseHeld;
			if (access === "network" || access === "timeout") await route.abort();
			else
				await route.fulfill(
					access === "remembered"
						? { json: { connection: "connected", sessions: [] } }
						: {
								status: access === "503" ? 503 : 401,
								json: { error: "Unavailable" },
							},
				);
		});
		await page.addInitScript(() => {
			let source: ReadOnlySource;
			class ReadOnlySource extends EventTarget {
				onopen: (() => void) | null = null;
				onerror: (() => void) | null = null;
				constructor() {
					super();
					source = this;
				}
				close() {}
			}
			Object.defineProperty(window, "EventSource", { value: ReadOnlySource });
			Object.defineProperty(window, "emptySessionTransport", {
				value: (open: boolean) =>
					open ? source.onopen?.() : source.onerror?.(),
			});
		});
		const mutations: string[] = [];
		page.on("request", (request) => {
			if (request.method() === "POST") mutations.push(request.url());
		});
		await page.goto("/");
		await requested;
		await expect(page.getByText("Checking this device…")).toBeVisible();
		await expect(page.getByLabel("Pairing code")).toHaveCount(0);
		if (access === "timeout") await page.clock.fastForward(8001);
		else release();
		if (access === "remembered") {
			const home = page.getByRole("region", {
				name: "Live sessions",
				exact: true,
			});
			await expect(home).toBeVisible();
			await expect(
				home.getByText("Waiting for live sessions from the gateway.", {
					exact: true,
				}),
			).toBeVisible();
			const transport = (open: boolean) =>
				page.evaluate(
					(open) =>
						(
							window as unknown as {
								emptySessionTransport: (open: boolean) => void;
							}
						).emptySessionTransport(open),
					open,
				);
			await transport(true);
			await expect(
				home.getByText(
					"No live sessions. Load the companion extension in your terminal.",
					{ exact: true },
				),
			).toBeVisible();
			await transport(false);
			await expect(
				home.getByText("Waiting for live sessions from the gateway.", {
					exact: true,
				}),
			).toBeVisible();
			await expect(
				page.getByText(
					"Disconnected — reconnecting; cached content is read-only",
					{ exact: true },
				),
			).toBeVisible();
			await expect(page.getByLabel("Pairing code")).toHaveCount(0);
		} else {
			await expect(page.getByLabel("Pairing code")).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Pair this device", exact: true }),
			).toBeEnabled();
			if (access === "unpaired")
				await expect(page.locator('.pairing [role="alert"]')).toBeEmpty();
			else
				await expect(page.getByRole("alert")).toContainText(
					"Gateway unavailable — device access could not be checked",
				);
		}
		await expect(page.getByText("Checking this device…")).toHaveCount(0);
		release();
		expect(mutations).toEqual([]);
	});

for (const width of [320, 390])
	test(`U1 composer availability and U2 identity-matched observed answer count without commands at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
		const identity = { instance: "a".repeat(32), generation: "b".repeat(32) };
		const summary = {
			...identity,
			project: "Local project",
			session: "Exact terminal",
			parent: "idle",
			background: "unobserved",
		};
		await page.route("**/api/snapshot*", (route) =>
			route.fulfill({
				json: {
					connection: "connected",
					selected: identity,
					sessions: [summary],
				},
			}),
		);
		await page.addInitScript(
			({ identity, summary }) => {
				const sources = new Set<ReadOnlySource>();
				let changes: Record<string, unknown> = {};
				class ReadOnlySource extends EventTarget {
					constructor() {
						super();
						sources.add(this);
						queueMicrotask(() => this.emit());
					}
					close() {
						sources.delete(this);
					}
					emit() {
						this.dispatchEvent(
							new MessageEvent("snapshot", {
								data: JSON.stringify({
									connection: "connected",
									selected: identity,
									sessions: [{ ...summary, ...changes }],
									snapshot: {
										...summary,
										items: [
											{
												id: "one",
												role: "assistant",
												blocks: [
													{
														type: "text",
														text: "Cached exact terminal conversation",
													},
												],
											},
										],
										truncated: false,
									},
									...changes,
								}),
							}),
						);
					}
				}
				Object.defineProperty(window, "EventSource", { value: ReadOnlySource });
				Object.defineProperty(window, "changeAvailability", {
					value: (next: Record<string, unknown>) => {
						changes = next;
						for (const source of sources) source.emit();
					},
				});
			},
			{ identity, summary },
		);
		const mutations: string[] = [];
		page.on("request", (request) => {
			if (request.method() === "POST") mutations.push(request.url());
		});
		await page.goto(`/#session=${identity.instance}:${identity.generation}`);
		const draft = page.getByPlaceholder("Message Pi"),
			availability = page.locator("#composer-availability");
		await expect(draft).toHaveAccessibleDescription(
			"Ready to send — drafts stay local until you Send.",
		);
		await expect(
			page.getByLabel("Images for selected Pi (local picker)"),
		).toHaveAccessibleDescription(
			"Up to four still PNG, JPEG or WebP images · 4 MB total",
		);
		await draft.fill("Local draft stays editable");
		await expect(
			page.getByRole("button", { name: "Send", exact: true }),
		).toBeEnabled();
		await expect(
			page.locator("header").getByText("Pi idle", { exact: true }),
		).toBeVisible();
		await expect(availability).toHaveClass("visually-hidden");
		expect((await page.locator(".composer").boundingBox())!.height).toBe(
			(await page.locator(".composer-bar").boundingBox())!.height + 4,
		);
		const questions = {
			...identity,
			terminalOnly: false,
			pending: [
				{
					invocationId: "first",
					questions: ["First choice", "Second choice"].map((header) => ({
						header,
						question: "Which option?",
						multiSelect: false,
						options: [
							{ label: "A", description: "First" },
							{ label: "B", description: "Second" },
						],
					})),
				},
			],
		};
		const change = (next: Record<string, unknown>) =>
			page.evaluate(
				(next) =>
					(
						window as unknown as {
							changeAvailability: (next: Record<string, unknown>) => void;
						}
					).changeAvailability(next),
				next,
			);
		const picker = page.getByRole("button", { name: /^Open sessions:/ });
		await change({ questions, needsInput: true });
		await expect(picker).toHaveAccessibleDescription(
			"2 questions in this session need answers",
		);
		await picker.click();
		const sidebar = page.getByRole("dialog", { name: "Live sessions" });
		await expect(
			sidebar.getByRole("button", { name: /Exact terminal/ }),
		).toContainText("Needs answer");
		await sidebar.getByRole("button", { name: "Close sessions" }).click();
		await expect(sidebar).toBeHidden();
		for (const state of [
			{ questions: { ...questions, generation: "c".repeat(32) } },
			{ questions, connection: "disconnected" },
			{ questions: { ...questions, pending: [] } },
		]) {
			await change(state);
			await expect(picker).not.toHaveAttribute("aria-describedby");
			await expect(page.locator("#session-answer-count")).toHaveCount(0);
		}
		await change({ stop: "parent-settled" });
		await expect(
			page.locator("header").getByText("Stopped (observed)", { exact: true }),
		).toBeVisible();
		for (const [state, explanation, activity] of [
			[
				{ pending: true },
				"Busy text unavailable — fully restart the owning Pi to load the updated bridge.",
				"Input pending",
			],
			[
				{ parent: "working" },
				"Busy text unavailable — fully restart the owning Pi to load the updated bridge.",
				"Pi is working",
			],
			[
				{ stop: "stopping" },
				"Stopping — draft only until Pi is idle.",
				"Stopping",
			],
			[
				{ conflict: true },
				"Ownership conflict — read-only; drafts stay local.",
				"Ownership conflict",
			],
			[
				{
					controller: {
						held: true,
						revision: "other",
						expires: Date.now() + 60000,
					},
				},
				"Another browser has control — take over explicitly to send.",
				"Pi idle",
			],
			[
				{ connection: "disconnected" },
				"Disconnected — cached content is read-only; drafts stay local.",
				"Unavailable",
			],
		] as const) {
			await page.evaluate(
				(next) =>
					(
						window as unknown as {
							changeAvailability: (next: Record<string, unknown>) => void;
						}
					).changeAvailability(next),
				state,
			);
			await expect(draft).toHaveAccessibleDescription(explanation);
			await expect(
				page.locator("header").getByText(activity, { exact: true }),
			).toBeVisible();
			if (activity !== "Unavailable") {
				await picker.click();
				await expect(
					sidebar.getByRole("button", { name: /Exact terminal/ }),
				).toContainText(activity);
				await expect(
					sidebar
						.getByRole("region", { name: "Input details" })
						.getByText(explanation, { exact: true }),
				).toBeVisible();
				await sidebar.getByRole("button", { name: "Close sessions" }).click();
				await expect(sidebar).toBeHidden();
			}
			await expect(availability).toHaveClass("composer-availability");
			await expect(availability).toBeVisible();
			expect((await page.locator(".composer-bar").boundingBox())!.height).toBe(
				58,
			);
			await expect(
				page.getByLabel("Send options", { exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByRole("button", {
					name: "Send",
					exact: true,
					includeHidden: true,
				}),
			).toBeDisabled();
			await expect(draft).toHaveValue("Local draft stays editable");
			if (activity === "Pi is working" || activity === "Unavailable") {
				const action = page.getByRole("button", {
					name: activity === "Pi is working" ? "Stop" : "Send",
					exact: true,
				});
				for (const colorScheme of ["light", "dark"] as const)
					for (const enlarged of [false, true]) {
						await page.emulateMedia({ colorScheme });
						await page.evaluate((enlarged) => {
							document.documentElement.style.fontSize = enlarged ? "125%" : "";
						}, enlarged);
						expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(
							44,
						);
						expect((await action.boundingBox())!.width).toBeGreaterThanOrEqual(
							44,
						);
						expect(
							await page.evaluate(
								() => document.documentElement.scrollWidth <= innerWidth,
							),
						).toBe(true);
						await page.screenshot({
							path: testInfo.outputPath(
								`${activity === "Unavailable" ? "disconnected" : "busy"}-${width}-${colorScheme}-${enlarged ? "enlarged" : "ordinary"}.png`,
							),
						});
					}
				await page.evaluate(() => {
					document.documentElement.style.fontSize = "";
				});
			}
		}
		await picker.click();
		await expect(
			sidebar
				.getByRole("region", { name: "Input details" })
				.getByText(/Disconnected — cached content/),
		).toBeVisible();
		await sidebar.getByRole("button", { name: "Close sessions" }).click();
		await expect(sidebar).toBeHidden();
		await expect(page.locator("article")).toContainText(
			"Cached exact terminal conversation",
		);
		expect(mutations).toEqual([]);
	});

for (const width of [320, 390])
	test(`U3 deliberate question review restores reading and generation-bound positions at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 568 });
		const first = {
			instance: "a".repeat(32),
			generation: "b".repeat(32),
			session: "Questions terminal",
			project: "Review project",
			parent: "idle",
			background: "unobserved",
		};
		const second = {
			...first,
			instance: "c".repeat(32),
			generation: "d".repeat(32),
			session: "Other terminal",
		};
		await page.addInitScript(
			({ first, second }) => {
				const sessions = [first, second],
					sources = new Set<Source>();
				let pending: unknown[] = [],
					controller: Record<string, unknown> | undefined;
				const items = Array.from({ length: 50 }, (_, i) => ({
					id: `line-${i}`,
					role: "assistant",
					blocks: [
						{
							type: "text",
							text: `Reading line ${i}. Keep this position while questions arrive.\n\nMore authored conversation.`,
						},
					],
				}));
				function view(url: string) {
					const instance = new URL(url, location.origin).searchParams.get(
						"instance",
					);
					const owner = sessions.find((s) => s.instance === instance);
					const generation = new URL(url, location.origin).searchParams.get(
						"generation",
					);
					if (owner && generation !== owner.generation)
						return {
							connection: "connected",
							sessions,
							selected: { instance: owner.instance, generation },
						};
					return {
						connection: "connected",
						sessions,
						...(owner
							? {
									selected: {
										instance: owner.instance,
										generation: owner.generation,
									},
									snapshot: { ...owner, items, truncated: false },
									questions: {
										instance: owner.instance,
										generation: owner.generation,
										terminalOnly: false,
										pending: owner.instance === first.instance ? pending : [],
									},
									controller,
								}
							: {}),
					};
				}
				class Source extends EventTarget {
					constructor(private url: string) {
						super();
						sources.add(this);
						queueMicrotask(() => this.emit());
					}
					close() {
						sources.delete(this);
					}
					emit() {
						this.dispatchEvent(
							new MessageEvent("snapshot", {
								data: JSON.stringify(view(this.url)),
							}),
						);
					}
				}
				function emit() {
					for (const source of sources) source.emit();
				}
				Object.defineProperty(window, "EventSource", { value: Source });
				Object.defineProperty(window, "questionFixture", {
					value: {
						view,
						arrive: (invocationId: string) => {
							pending = [
								{
									invocationId,
									questions: [
										{
											header: "Choose",
											question: "Full authored question",
											multiSelect: false,
											options: [
												{
													label: "A",
													description:
														"Entire **description** selects this option.",
													preview:
														"Full authored preview\n\n```text\nlast preview line\n```",
												},
												{ label: "B", description: "Second option" },
											],
										},
										{
											header: "Unanswered",
											question: "Deliberately omit this answer?",
											multiSelect: true,
											options: [
												{ label: "One", description: "First supported choice" },
												{
													label: "Two",
													description: "Second supported choice",
												},
											],
										},
									],
								},
							];
							emit();
						},
						close: () => {
							pending = [];
							emit();
						},
						append: () => {
							items.push({
								id: `new-${items.length}`,
								role: "assistant",
								blocks: [{ type: "text", text: "New content while following" }],
							});
							emit();
						},
						replace: () => {
							first.generation = "e".repeat(32);
							emit();
						},
						claim: () => {
							controller = {
								held: true,
								revision: "fixture-revision",
								expires: Date.now() + 60000,
							};
							return { ...controller, lease: "fixture-private-lease" };
						},
					},
				});
			},
			{ first, second },
		);
		type Fixture = {
			view: (url: string) => unknown;
			arrive: (invocation: string) => void;
			close: () => void;
			append: () => void;
			replace: () => void;
			claim: () => unknown;
		};
		const fixture = (
			method: "arrive" | "close" | "append" | "replace" | "claim",
			invocation = "",
		) =>
			page.evaluate(
				({ method, invocation }) => {
					const f = (window as unknown as { questionFixture: Fixture })
						.questionFixture;
					return method === "arrive" ? f.arrive(invocation) : f[method]();
				},
				{ method, invocation },
			);
		await page.route("**/api/snapshot*", async (route) =>
			route.fulfill({
				json: await page.evaluate(
					(url) =>
						(
							window as unknown as { questionFixture: Fixture }
						).questionFixture.view(url),
					route.request().url(),
				),
			}),
		);
		await page.route("**/api/control", async (route) =>
			route.fulfill({ json: await fixture("claim") }),
		);
		const replies: Record<string, unknown>[] = [],
			mutations: string[] = [];
		page.on("request", (request) => {
			if (request.method() === "POST") mutations.push(request.url());
		});
		await page.route("**/api/question-reply", async (route) => {
			const { reply } = route.request().postDataJSON();
			replies.push(reply);
			await fixture("close");
			if (reply.invocationId === "uncertain-invocation") await route.abort();
			else
				await route.fulfill({
					json: {
						replyId: reply.replyId,
						invocationId: reply.invocationId,
						status: "accepted",
					},
				});
		});
		await page.goto(`/#session=${first.instance}:${first.generation}`);
		const history = page.getByRole("region", {
			name: "Conversation history",
			exact: true,
		});
		const top = () => history.evaluate((node) => node.scrollTop);
		const distance = () =>
			history.evaluate(
				(node) => node.scrollHeight - node.clientHeight - node.scrollTop,
			);
		await expect.poll(distance).toBeLessThanOrEqual(1);
		await history.evaluate((node) => {
			node.dispatchEvent(
				new WheelEvent("wheel", { bubbles: true, deltaY: -1 }),
			);
			node.scrollTop = 350;
		});
		await expect.poll(top).toBe(350);
		await fixture("arrive", "first-invocation");
		const review = page.getByRole("button", {
			name: "Review questions",
			exact: true,
		});
		await expect(review).toBeVisible();
		await expect(page.locator("#question-review")).not.toHaveAttribute("open");
		expect(await top()).toBe(350);
		await review.focus();
		await page.keyboard.press("Enter");
		await expect(page.locator("#question-review")).toHaveAttribute("open", "");
		await expect(page.locator("#question-review > summary")).toBeFocused();
		expect(await top()).toBeGreaterThan(350);
		expect(await page.locator("main").evaluate((node) => node.scrollTop)).toBe(
			0,
		);
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
		const headerBox = (await page.locator("header").boundingBox())!;
		const composerBox = (await page
			.getByRole("region", { name: "Browser text input" })
			.boundingBox())!;
		expect(headerBox.y).toBeGreaterThanOrEqual(0);
		expect(headerBox.y + headerBox.height).toBeLessThan(composerBox.y);
		expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(568);
		expect(568 - composerBox.y - composerBox.height).toBeLessThanOrEqual(24);
		expect(mutations).toEqual([]);
		await page
			.locator(".question-card")
			.first()
			.getByText("Entire", { exact: false })
			.click();
		await expect(
			page.getByRole("radio", { name: "A", exact: true }),
		).toBeChecked();
		await expect(
			page.getByRole("radio", { name: "A", exact: true }),
		).toHaveAccessibleDescription("Entire description selects this option.");
		await page.getByRole("radio", { name: "B", exact: true }).focus();
		await page.keyboard.press("Space");
		await expect(
			page.getByRole("radio", { name: "B", exact: true }),
		).toBeChecked();
		await expect(
			page.getByRole("radio", { name: "A", exact: true }),
		).not.toBeChecked();
		await page
			.getByRole("group", { name: "Choose", exact: true })
			.getByText("Other responses", { exact: true })
			.click();
		await page
			.getByRole("button", { name: "Leave unanswered for Choose", exact: true })
			.click();
		await expect(
			page.getByRole("radio", { name: "B", exact: true }),
		).not.toBeChecked();
		await page
			.getByRole("group", { name: "Choose", exact: true })
			.getByText("Other responses", { exact: true })
			.click();
		await page.getByRole("radio", { name: "B", exact: true }).focus();
		await page.keyboard.press("Space");
		await expect(
			page.getByRole("button", { name: "Jump to latest", exact: true }),
		).toBeHidden();
		await page.screenshot({
			path: testInfo.outputPath(`question-cards-${width}.png`),
		});
		expect(
			await page
				.locator(
					".question-card label a, .question-card label button, .question-card label p",
				)
				.count(),
		).toBe(0);
		await page.getByText("Preview: A", { exact: true }).click();
		await expect(
			page.getByText("last preview line", { exact: false }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Free response for Choose", exact: true })
			.click();
		await page
			.getByRole("textbox", { name: "Free response for Choose", exact: true })
			.fill("Retained local answer");
		await fixture("append");
		await expect(
			page.getByRole("textbox", {
				name: "Free response for Choose",
				exact: true,
			}),
		).toHaveValue("Retained local answer");
		const submit = page.getByRole("button", {
			name: "Submit questionnaire",
			exact: true,
		});
		await submit.scrollIntoViewIfNeeded();
		expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		await submit.click();
		await expect(
			page.getByRole("group", {
				name: "Review unanswered questions",
				exact: true,
			}),
		).toContainText("Unanswered");
		for (const colorScheme of ["light", "dark"] as const)
			for (const enlarged of [false, true]) {
				await page.setViewportSize({
					width,
					height: width === 320 ? 568 : 844,
				});
				await page.emulateMedia({ colorScheme });
				await page.evaluate((enlarged) => {
					document.documentElement.style.fontSize = enlarged ? "125%" : "";
				}, enlarged);
				const forward = page.getByRole("button", {
					name: "Forward with unanswered questions",
					exact: true,
				});
				await forward.scrollIntoViewIfNeeded();
				expect((await forward.boundingBox())!.height).toBeGreaterThanOrEqual(
					44,
				);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
				expect(
					await page.locator("main").evaluate((node) => node.scrollTop),
				).toBe(0);
				expect(
					(await page.locator("header").boundingBox())!.y,
				).toBeGreaterThanOrEqual(0);
				await page.screenshot({
					path: testInfo.outputPath(
						`unanswered-${width}-${colorScheme}-${enlarged ? "enlarged" : "ordinary"}.png`,
					),
				});
				await page
					.getByText("Preview: A", { exact: true })
					.scrollIntoViewIfNeeded();
				await expect(
					page.getByText("last preview line", { exact: false }),
				).toBeVisible();
				await page.screenshot({
					path: testInfo.outputPath(
						`expanded-question-${width}-${colorScheme}-${enlarged ? "enlarged" : "ordinary"}.png`,
					),
				});
			}
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "";
		});
		await page.setViewportSize({ width, height: 568 });
		expect(mutations).toEqual([]);
		expect(replies).toEqual([]);
		await page
			.getByRole("button", { name: "Keep editing", exact: true })
			.click();
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "125%";
		});
		for (const colorScheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme });
			await review.click();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			const prompt = page.locator(".needs-answer");
			expect((await prompt.boundingBox())!.height).toBeLessThanOrEqual(56);
			await expect(review).toHaveText("Review");
			expect(
				await review.evaluate((node) => node.scrollHeight <= node.clientHeight),
			).toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(`questions-${width}-${colorScheme}.png`),
			});
		}
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "";
		});
		await fixture("close"); // Terminal closure restores pre-Review reading, not browser success.
		await expect.poll(top).toBe(350);
		await expect(page.getByText(/Answer completed/)).toHaveCount(0);
		for (const moved of [false, true]) {
			await fixture("arrive", `touch-closure-${moved}`);
			await review.click();
			await history.evaluate((node, moved) => {
				// Stay within finalized history so removing the question cannot clamp this position.
				node.scrollTop = 500;
				for (const [type, y] of [
					["touchstart", 300],
					...(moved ? [["touchmove", 308] as const] : []),
				] as const) {
					const event = new TouchEvent(type, { bubbles: true });
					Object.defineProperty(event, "touches", {
						value: [{ clientX: 180, clientY: y }],
					});
					node.dispatchEvent(event);
				}
				if (moved) node.scrollTop -= 8;
			}, moved);
			await expect.poll(top).toBe(moved ? 492 : 500);
			await fixture("close");
			await expect(page.locator("#question-review")).toHaveCount(0);
			expect(await top()).toBe(moved ? 492 : 500);
			await history.evaluate((node) => {
				const event = new TouchEvent("touchend", { bubbles: true });
				Object.defineProperty(event, "touches", { value: [] });
				node.dispatchEvent(event);
			});
			await expect.poll(top).toBe(moved ? 492 : 350);
			if (moved) {
				await fixture("append");
				await page.evaluate(() => new Promise(requestAnimationFrame));
				expect(await top()).toBe(492);
				await history.evaluate((node) => {
					node.dispatchEvent(
						new WheelEvent("wheel", { bubbles: true, deltaY: -1 }),
					);
					node.scrollTop = 350;
				});
				await expect.poll(top).toBe(350);
			}
		}
		await fixture("arrive", "second-invocation");
		await review.click();
		await page
			.getByRole("button", { name: "Submit questionnaire", exact: true })
			.click();
		expect(mutations).toEqual([]);
		await page
			.getByRole("button", {
				name: "Forward with unanswered questions",
				exact: true,
			})
			.click();
		await expect.poll(() => replies.length).toBe(1);
		expect(replies[0]).toMatchObject({
			invocationId: "second-invocation",
			cancelled: false,
			answers: [],
		});
		await expect.poll(top).toBe(350);
		await expect(page.getByText(/Answer completed — confirmed/)).toBeVisible();
		await page
			.getByRole("button", { name: "Jump to latest", exact: true })
			.click();
		await expect.poll(distance).toBeLessThanOrEqual(1);
		const beforeArrival = await top();
		await fixture("arrive", "following-invocation");
		await expect(review).toBeVisible();
		expect(await top()).toBe(beforeArrival);
		const beforeReview = await top();
		await review.click();
		await fixture("close");
		await expect.poll(distance).toBeLessThanOrEqual(1);
		await fixture("append");
		await expect.poll(distance).toBeLessThanOrEqual(1);
		expect(beforeReview).toBeGreaterThan(350);
		await history.evaluate((node) => {
			node.dispatchEvent(
				new WheelEvent("wheel", { bubbles: true, deltaY: -1 }),
			);
			node.scrollTop = 425;
		});
		await expect.poll(top).toBe(425);
		await fixture("arrive", "uncertain-invocation");
		await review.click();
		await page
			.getByRole("button", { name: "Submit questionnaire", exact: true })
			.click();
		await page
			.getByRole("button", {
				name: "Forward with unanswered questions",
				exact: true,
			})
			.click();
		await expect(
			page.getByText(/Uncertain — response lost or authority changed/),
		).toBeVisible();
		await expect.poll(top).toBe(425);
		await expect(page.getByText(/Answer completed/)).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Repeat original questionnaire reply" }),
		).toBeDisabled();
		const choose = async (name: string) => {
			await page.getByRole("button", { name: /^Open sessions:/ }).click();
			await page
				.getByRole("dialog", { name: "Live sessions" })
				.getByRole("button", { name: new RegExp(`^${name} Review project`) })
				.click();
		};
		await choose("Other terminal");
		await expect.poll(distance).toBeLessThanOrEqual(1);
		await expect(
			page.getByText(
				"Receipt from another session — not the selected terminal.",
				{ exact: true },
			),
		).toBeVisible();
		await choose("Questions terminal");
		await expect.poll(top).toBe(425);
		await fixture("arrive", "switched-invocation");
		await review.click();
		await choose("Other terminal");
		await fixture("close");
		await choose("Questions terminal");
		await expect.poll(top).toBe(425);
		await fixture("replace");
		await expect
			.poll(() => new URL(page.url()).hash)
			.toBe(`#session=${first.instance}:${"e".repeat(32)}`);
		await expect.poll(distance).toBeLessThanOrEqual(1);
		expect(
			await page.evaluate(() => localStorage.length + sessionStorage.length),
		).toBe(0);
	});

for (const width of [320, 390])
	test(`U4 image inspection returns to reading and compact local feedback at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		const identity = { instance: "a".repeat(32), generation: "b".repeat(32) };
		const summary = {
			...identity,
			project: "Image review",
			session: "Screenshot terminal",
			parent: "idle" as const,
			background: "unobserved" as const,
		};
		const snapshot: Snapshot = {
			...summary,
			truncated: false,
			items: [
				...Array.from({ length: 10 }, (_, index) => ({
					id: `before-${index}`,
					role: "assistant",
					blocks: [
						{
							type: "text" as const,
							text: `Earlier message ${index}. Keep this reading position.`,
						},
					],
				})),
				{
					id: "screenshots",
					role: "tool: browser",
					blocks: [
						{ type: "text", text: "Captured two screenshots." },
						{
							type: "image",
							ref: "c".repeat(32),
							mime: "image/png",
							width: 640,
							height: 480,
						},
						{
							type: "image",
							ref: "d".repeat(32),
							mime: "image/png",
							width: 640,
							height: 480,
						},
						{
							type: "image",
							ref: "e".repeat(32),
							mime: "image/png",
							width: 640,
							height: 480,
						},
					],
				},
				...Array.from({ length: 10 }, (_, index) => ({
					id: `after-${index}`,
					role: "assistant",
					blocks: [
						{
							type: "text" as const,
							text: `Later message ${index}. Return to the conversation after inspecting.`,
						},
					],
				})),
			],
		};
		// A controlled screenshot-like PNG, not a live terminal or external image.
		const { default: sharp } = await import("sharp");
		const image = await sharp(
			Buffer.from(
				'<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="480" fill="#edf2fc"/><rect x="32" y="32" width="576" height="60" rx="12" fill="#244b80"/><text x="52" y="72" font-size="26" fill="white">Controlled screenshot fixture</text><rect x="32" y="116" width="180" height="332" rx="12" fill="#c2d0e5"/><rect x="236" y="116" width="372" height="148" rx="12" fill="white"/><text x="260" y="156" font-size="22" fill="#244b80">Inspect and return</text><rect x="236" y="288" width="372" height="160" rx="12" fill="#d0dfce"/></svg>',
			),
		)
			.png()
			.toBuffer();
		await page.route("**/api/media/**", (route) =>
			route.request().url().endsWith("e".repeat(32))
				? route.fulfill({ status: 404 })
				: route.fulfill({ contentType: "image/png", body: image }),
		);
		await page.route("**/api/snapshot", (route) =>
			route.fulfill({ json: { connection: "connected", sessions: [summary] } }),
		);
		await page.addInitScript(
			({ summary, snapshot }) => {
				class FixtureSource extends EventTarget {
					onopen = null;
					onerror = null;
					constructor(url: string) {
						super();
						queueMicrotask(() =>
							this.dispatchEvent(
								new MessageEvent("snapshot", {
									data: JSON.stringify({
										connection: "connected",
										sessions: [summary],
										...(url.includes("instance=")
											? {
													selected: {
														instance: summary.instance,
														generation: summary.generation,
													},
													snapshot,
												}
											: {}),
									}),
								}),
							),
						);
					}
					close() {}
				}
				Object.defineProperty(window, "EventSource", { value: FixtureSource });
			},
			{ summary, snapshot },
		);
		const posts: string[] = [];
		page.on("request", (request) => {
			if (request.method() === "POST") posts.push(request.url());
		});
		await page.goto("/");
		await page.getByRole("button", { name: /^Open sessions:/ }).click();
		await page
			.getByRole("dialog", { name: "Live sessions" })
			.getByRole("button", { name: /Screenshot terminal Image review/ })
			.click();
		const history = page.getByRole("region", {
			name: "Conversation history",
			exact: true,
		});
		const first = page.getByRole("button", {
			name: "Enlarge native Pi image 1",
			exact: true,
		});
		const second = page.getByRole("button", {
			name: "Enlarge native Pi image 2",
			exact: true,
		});
		const composer = page.getByRole("region", { name: "Browser text input" });
		await first.scrollIntoViewIfNeeded();
		await expect(page.getByText("Enlarge image", { exact: true })).toHaveCount(
			0,
		);
		const imageChrome = await first.evaluate((node) => {
			const style = getComputedStyle(node);
			return {
				border: style.borderTopWidth,
				padding: style.padding,
				background: style.backgroundColor,
			};
		});
		expect(imageChrome).toEqual({
			border: "0px",
			padding: "0px",
			background: "rgba(0, 0, 0, 0)",
		});
		await expect(first.getByRole("img")).toHaveAccessibleName(
			"Native Pi image 1",
		);
		await expect(second.getByRole("img")).toHaveAccessibleName(
			"Native Pi image 2",
		);
		await page
			.getByRole("status")
			.filter({ hasText: "Native Pi image 3 unavailable" })
			.scrollIntoViewIfNeeded();
		await expect(
			page.getByText("Native Pi image 3 unavailable", { exact: true }),
		).toBeVisible();
		await first.scrollIntoViewIfNeeded();
		await first.focus();
		// Establish native keyboard modality before opening, rather than relying
		// on programmatic focus to imply a visible keyboard ring.
		await page.keyboard.press("Tab");
		await first.focus();
		await expect(first).toBeFocused();
		expect(await first.evaluate((node) => node.matches(":focus-visible"))).toBe(
			true,
		);
		const before = await history.evaluate((node) => node.scrollTop);
		await page.keyboard.press("Enter");
		await expect(page.locator(".pswp--open")).toBeVisible();
		await expect(page.locator(".pswp__img").first()).toHaveAttribute(
			"alt",
			"Native Pi image 1 enlarged",
		);
		for (const colorScheme of ["light", "dark"] as const)
			for (const enlarged of [false, true]) {
				await page.emulateMedia({ colorScheme });
				await page.evaluate((enlarged) => {
					document.documentElement.style.fontSize = enlarged ? "125%" : "";
				}, enlarged);
				expect(
					(await page
						.getByRole("button", { name: "Close", exact: false })
						.boundingBox())!.width,
				).toBeGreaterThanOrEqual(44);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
				await page.screenshot({
					path: testInfo.outputPath(
						`image-viewer-${width}-${colorScheme}-${enlarged ? "enlarged" : "ordinary"}.png`,
					),
				});
			}
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "";
		});
		await page.keyboard.press("Escape");
		await expect(page.locator(".pswp--open")).toHaveCount(0);
		await expect(first).toBeFocused();
		expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
			before,
			0,
		);
		for (const colorScheme of ["light", "dark"] as const)
			for (const enlarged of [false, true]) {
				await page.emulateMedia({ colorScheme });
				await page.evaluate((enlarged) => {
					document.documentElement.style.fontSize = enlarged ? "125%" : "";
				}, enlarged);
				// Center the complete image after resizing; native nearest-edge
				// scrolling can round its top just outside the scrollport.
				await first.evaluate((node) => {
					const port = node.closest(".chat-scroll")!;
					const box = node.getBoundingClientRect();
					const viewport = port.getBoundingClientRect();
					port.scrollTop +=
						box.top + box.height / 2 - viewport.top - viewport.height / 2;
				});
				const ring = await first.evaluate((node) => {
					const style = getComputedStyle(node);
					const box = node.getBoundingClientRect();
					const port = node.closest(".chat-scroll")!.getBoundingClientRect();
					const outward =
						parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
					return {
						keyboardVisible: node.matches(":focus-visible"),
						width: parseFloat(style.outlineWidth),
						style: style.outlineStyle,
						color: style.outlineColor,
						left: box.left - outward,
						right: box.right + outward,
						top: box.top - outward,
						bottom: box.bottom + outward,
						port: {
							left: port.left,
							right: port.right,
							top: port.top,
							bottom: port.bottom,
						},
					};
				});
				expect(ring.keyboardVisible).toBe(true);
				expect(ring.width).toBe(3);
				expect(ring.style).toBe("solid");
				expect(ring.color).not.toBe("rgba(0, 0, 0, 0)");
				expect(ring.left).toBeGreaterThanOrEqual(ring.port.left);
				expect(ring.right).toBeLessThanOrEqual(ring.port.right);
				expect(ring.top).toBeGreaterThanOrEqual(ring.port.top);
				expect(ring.bottom).toBeLessThanOrEqual(ring.port.bottom);
				console.log(
					"U4_FOCUS_RING",
					JSON.stringify({
						viewportWidth: width,
						colorScheme,
						enlarged,
						...ring,
					}),
				);
				await page.screenshot({
					path: testInfo.outputPath(
						`image-return-focus-${width}-${colorScheme}-${enlarged ? "enlarged" : "ordinary"}.png`,
					),
				});
			}
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "";
		});
		await second.scrollIntoViewIfNeeded();
		const secondPosition = await history.evaluate((node) => node.scrollTop);
		await second.click();
		await expect(page.locator(".pswp__img").first()).toHaveAttribute(
			"alt",
			"Native Pi image 2 enlarged",
		);
		await page.getByRole("button", { name: "Close", exact: false }).click();
		await expect(page.locator(".pswp--open")).toHaveCount(0);
		await expect(second).toBeFocused();
		expect(await history.evaluate((node) => node.scrollTop)).toBeCloseTo(
			secondPosition,
			0,
		);
		const draft = page.getByPlaceholder("Message Pi");
		await draft.fill(
			"Please adjust the spacing.\nKeep the screenshot header.\nThis is local feedback.",
		);
		const picker = page.getByLabel("Images for selected Pi (local picker)");
		await expect(picker).toHaveAccessibleDescription(
			"Up to four still PNG, JPEG or WebP images · 4 MB total",
		);
		await picker.setInputFiles({
			name: "feedback-screenshot-with-a-deliberately-long-file-name.png",
			mimeType: "image/png",
			buffer: Buffer.concat([image, Buffer.alloc(1234567 - image.length)]),
		});
		await expect(
			composer.getByRole("button", {
				name: "Remove image 1: feedback-screenshot-with-a-deliberately-long-file-name.png",
			}),
		).toBeVisible();
		const remove = composer.getByRole("button", { name: /^Remove image/ });
		expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		expect((await remove.boundingBox())!.width).toBeGreaterThanOrEqual(44);
		expect(
			(await composer.locator(".attachment").boundingBox())!.height,
		).toBeLessThanOrEqual(68);
		expect(
			(await composer
				.getByRole("img", { name: "Local attachment preview" })
				.boundingBox())!.height,
		).toBe(44);
		for (const colorScheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme });
			await composer
				.getByRole("button", { name: "Send", exact: true })
				.scrollIntoViewIfNeeded();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			expect(
				await history.evaluate((node) => node.clientHeight),
			).toBeGreaterThan(150);
			await page.screenshot({
				path: testInfo.outputPath(
					`compact-feedback-${width}-${colorScheme}.png`,
				),
			});
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "125%";
			});
			await composer
				.getByRole("button", { name: "Send", exact: true })
				.scrollIntoViewIfNeeded();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(
					`compact-feedback-${width}-${colorScheme}-enlarged.png`,
				),
			});
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "";
			});
		}
		await page.setViewportSize({ width, height: 420 });
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "125%";
		});
		await draft.fill(
			"First line\nSecond line\nThird line\nFourth line\nFifth line\nSixth line",
		);
		await composer
			.getByRole("button", { name: "Send", exact: true })
			.scrollIntoViewIfNeeded();
		const sendBox = (await composer
			.getByRole("button", { name: "Send", exact: true })
			.boundingBox())!;
		expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(420);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		expect(await history.evaluate((node) => node.clientHeight)).toBeGreaterThan(
			80,
		);
		for (const control of [
			composer.getByRole("button", { name: "Send", exact: true }),
			remove,
		]) {
			const box = (await control.boundingBox())!;
			expect(box.width).toBeGreaterThanOrEqual(44);
			expect(box.height).toBeGreaterThanOrEqual(44);
			expect(box.y + box.height).toBeLessThanOrEqual(420);
			expect(
				await control.evaluate((node) => {
					const box = node.getBoundingClientRect();
					const hit = document.elementFromPoint(
						box.x + box.width / 2,
						box.y + box.height / 2,
					);
					return !!hit && node.contains(hit);
				}),
			).toBe(true);
		}
		console.log(
			"U4_FEEDBACK_GEOMETRY",
			JSON.stringify({
				width,
				reader: await history.boundingBox(),
				composer: await composer.boundingBox(),
				draft: await draft.boundingBox(),
				send: sendBox,
			}),
		);
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.screenshot({
				path: testInfo.outputPath(`constrained-feedback-${width}-${theme}.png`),
			});
		}
		expect(
			await draft.evaluate((node) => {
				const area = node as HTMLTextAreaElement;
				area.setSelectionRange(area.value.length, area.value.length);
				area.scrollTop = area.scrollHeight;
				return area.scrollHeight > area.clientHeight && area.scrollTop > 0;
			}),
		).toBe(true);
		await remove.scrollIntoViewIfNeeded();
		await remove.click();
		await expect(draft).toBeFocused();
		await expect(
			composer.getByRole("img", { name: "Local attachment preview" }),
		).toHaveCount(0);
		await expect(draft).toHaveValue(
			"First line\nSecond line\nThird line\nFourth line\nFifth line\nSixth line",
		);
		expect(posts).toEqual([]);
	});

for (const width of [320, 390, 900])
	test(`U5 code copy feedback and distinct narrow tool content at ${width}px`, async ({
		page,
		context,
		browserName,
	}, testInfo) => {
		await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
		const identity = { instance: "a".repeat(32), generation: "b".repeat(32) };
		const summary = {
			...identity,
			project: "Code review",
			session: "Tools terminal",
			parent: "idle" as const,
			background: "unobserved" as const,
		};
		const code =
			'\tconst greeting = "Hello <Pi> & café";  \n\n' +
			" ".repeat(4) +
			'console.log("' +
			"x".repeat(160) +
			'");\n';
		const snapshot: Snapshot = {
			...summary,
			truncated: false,
			items: [
				{
					id: "intro",
					role: "assistant",
					blocks: [
						{
							type: "text",
							text: "Inspect this code. Inline `value` stays inline.",
						},
						{
							type: "thinking",
							text: "Native reasoning preview",
							omittedChars: 23,
						},
						{ type: "tool", text: "Tool call: functions.read" },
					],
				},
				{
					id: "code",
					role: "assistant",
					blocks: [
						{
							type: "text",
							text:
								'```typescript title="authored metadata"\n' +
								code +
								"```\n\n```\nunknown language\n```\n\n<script>window.unsafe = true</script>\n\n[Unsafe](javascript:alert(1)) [Safe](https://example.com/reference) ![Remote](https://example.com/remote.png)\n\n" +
								"| Work | Why we need it | UI/UX impact |\n" +
								"| --- | --- | --- |\n" +
								"| Payout safety and accounting | Define verified admin authorization and balanced financial postings before money moves. | Sensitive admin actions require verification; financial states must be accurate. |\n" +
								"| Native pending state | Captured money does not imply provider completion. | Providers see eligible, pending and completed states clearly. |",
						},
					],
				},
				{
					id: "call-only",
					role: "assistant",
					blocks: [{ type: "tool", text: "Tool call: functions.read" }],
				},
				{
					id: "tool-one",
					role: "tool: functions.read",
					blocks: [
						{
							type: "text",
							text: Array.from(
								{ length: 80 },
								(_, i) => `First tool line ${i}: ${"z".repeat(140)}`,
							).join("\n"),
							omittedChars: 29,
						},
						{
							type: "image",
							ref: "c".repeat(32),
							mime: "image/png",
							width: 1,
							height: 1,
						},
						{ type: "text", text: "Separate text after native image" },
						{
							type: "unavailable",
							text: "Image unavailable: fixture image boundary",
						},
					],
				},
				{
					id: "tool-two",
					role: "tool: functions.read",
					blocks: [{ type: "text", text: "Independent second native result" }],
				},
				{
					id: "tool-three",
					role: "tool: functions.edit",
					blocks: [{ type: "text", text: "Independent third native result" }],
				},
				{
					id: "tool-four",
					role: "tool: functions.edit",
					blocks: [{ type: "text", text: "Independent fourth native result" }],
				},
				{
					id: "after",
					role: "assistant",
					blocks: [{ type: "text", text: "Another speaker boundary." }],
				},
			],
		};
		await page.route("**/api/snapshot*", (route) =>
			route.fulfill({
				json: {
					connection: "connected",
					sessions: [summary],
					selected: identity,
					snapshot,
				},
			}),
		);
		await page.route("**/api/media/**", (route) =>
			route.fulfill({
				contentType: "image/png",
				body: Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6DQ0AAAAASUVORK5CYII=",
					"base64",
				),
			}),
		);
		await page.addInitScript(
			({ identity, summary, snapshot, browserName }) => {
				const sources = new Set<Source>();
				class Source extends EventTarget {
					constructor() {
						super();
						sources.add(this);
						queueMicrotask(() => this.emit());
					}
					emit() {
						this.dispatchEvent(
							new MessageEvent("snapshot", {
								data: JSON.stringify({
									connection: "connected",
									sessions: [summary],
									selected: identity,
									snapshot,
								}),
							}),
						);
					}
					close() {
						sources.delete(this);
					}
				}
				Object.defineProperty(window, "EventSource", { value: Source });
				Object.defineProperty(window, "setCodeBusy", {
					value: (busy: boolean) => {
						Object.assign(summary, { parent: busy ? "working" : "idle" });
						Object.assign(snapshot, { parent: busy ? "working" : "idle" });
						for (const source of sources) source.emit();
					},
				});
				Object.defineProperty(window, "appendToolItems", {
					value: (items: Snapshot["items"]) => {
						snapshot.items.push(...items);
						for (const source of sources) source.emit();
					},
				});
				Object.defineProperty(window, "refreshCodeSnapshot", {
					value: () => {
						snapshot.items[0].blocks[1] = {
							type: "thinking",
							text: "Native reasoning updated",
							omittedChars: 23,
						};
						if (!snapshot.items.some((item) => item.id === "live-update"))
							snapshot.items.push({
								id: "live-update",
								role: "event",
								blocks: [{ type: "text", text: "Native live update" }],
							});
						for (const source of sources) source.emit();
					},
				});
				// WebKit does not expose Playwright clipboard permissions. Control only its browser API boundary.
				if (browserName === "webkit")
					Object.defineProperty(navigator, "clipboard", {
						configurable: true,
						value: {
							writeText: async (text: string) => {
								Object.defineProperty(window, "copiedCode", {
									configurable: true,
									value: text,
								});
							},
						},
					});
			},
			{ identity, summary, snapshot, browserName },
		);
		if (browserName === "chromium")
			await context.grantPermissions(["clipboard-read", "clipboard-write"]);
		const posts: string[] = [],
			externalImages: string[] = [];
		page.on("request", (request) => {
			if (request.method() === "POST") posts.push(request.url());
			if (request.url() === "https://example.com/remote.png")
				externalImages.push(request.url());
		});
		await page.goto(`/#session=${identity.instance}:${identity.generation}`);
		const thinking = page.locator('[data-native-item="intro"] details');
		const thinkingSummary = thinking.locator("summary");
		await expect(thinkingSummary).toHaveText("Thinking");
		await expect(thinking).not.toHaveAttribute("open");
		await page.evaluate(() =>
			(
				window as unknown as { refreshCodeSnapshot: () => void }
			).refreshCodeSnapshot(),
		);
		await expect(thinking).not.toHaveAttribute("open");
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "125%";
			});
			// Establish deliberate reading before positioning; focus alone does not leave follow mode.
			await page.getByRole("region", { name: "Conversation history" }).focus();
			await page.keyboard.press("Home");
			await thinkingSummary.focus();
			await thinkingSummary.evaluate((node) =>
				node.scrollIntoView({ block: "center" }),
			);
			expect(
				(await thinkingSummary.boundingBox())!.height,
			).toBeGreaterThanOrEqual(44);
			expect(
				await thinkingSummary.evaluate(
					(node) => getComputedStyle(node).outlineStyle,
				),
			).not.toBe("none");
			await expect
				.poll(() =>
					thinkingSummary.evaluate((node) => {
						const summary = node.getBoundingClientRect();
						const history = node
							.closest(".chat-scroll")!
							.getBoundingClientRect();
						return (
							summary.top >= Math.max(history.top, 0) &&
							summary.bottom <= Math.min(history.bottom, innerHeight) &&
							summary.left >= Math.max(history.left, 0) &&
							summary.right <= Math.min(history.right, innerWidth)
						);
					}),
				)
				.toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(`thinking-closed-${width}-${theme}.png`),
			});
			await page.keyboard.press("Enter");
			await expect(thinking).toHaveAttribute("open", "");
			await page.evaluate(() =>
				(
					window as unknown as { refreshCodeSnapshot: () => void }
				).refreshCodeSnapshot(),
			);
			await expect(thinking).toHaveAttribute("open", "");
			await expect(
				thinking.getByText("Native reasoning updated", { exact: true }),
			).toBeVisible();
			await expect(thinking.locator(".preview-note")).toHaveText(
				"Preview shortened · 23 characters omitted.",
			);
			await expect(thinking.locator("button")).toHaveCount(0);
			await expect(thinkingSummary).toBeFocused();
			await thinkingSummary.evaluate((node) =>
				node.scrollIntoView({ block: "center" }),
			);
			await expect
				.poll(() =>
					thinkingSummary.evaluate((node) => {
						const summary = node.getBoundingClientRect();
						const history = node
							.closest(".chat-scroll")!
							.getBoundingClientRect();
						return (
							summary.top >= Math.max(history.top, 0) &&
							summary.bottom <= Math.min(history.bottom, innerHeight) &&
							summary.left >= Math.max(history.left, 0) &&
							summary.right <= Math.min(history.right, innerWidth)
						);
					}),
				)
				.toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(`thinking-open-${width}-${theme}.png`),
			});
			await page.keyboard.press("Space");
			await expect(thinking).not.toHaveAttribute("open");
		}
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "";
		});
		const article = page.locator('[data-native-item="code"]');
		const tableScroll = article.getByRole("region", {
			name: "Scrollable table",
		});
		await expect(
			tableScroll.getByRole("columnheader", { name: "Work", exact: true }),
		).toBeVisible();
		await expect(tableScroll.getByRole("row")).toHaveCount(3);
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			// Exercise larger table text without changing unrelated composer geometry.
			await tableScroll.evaluate((node, enlarged) => {
				(node as HTMLElement).style.fontSize = enlarged ? "20px" : "";
			}, theme === "dark");
			await page.getByRole("region", { name: "Conversation history" }).focus();
			await page.keyboard.press("Home");
			await tableScroll.evaluate((node) =>
				node.scrollIntoView({ block: "center" }),
			);
			await tableScroll.focus();
			expect(
				await tableScroll.evaluate(
					(node) => node.scrollWidth > node.clientWidth,
				),
			).toBe(true);
			const workCell = tableScroll.getByRole("cell", {
				name: "Payout safety and accounting",
				exact: true,
			});
			const workBox = (await workCell.boundingBox())!;
			expect(workBox.width).toBeGreaterThan(180);
			expect(workBox.height).toBeLessThanOrEqual(
				(theme === "dark" ? 20 : 16) * 1.6 + 14,
			);
			const tableBox = (await tableScroll.boundingBox())!;
			const historyBox = (await page
				.getByRole("region", { name: "Conversation history" })
				.boundingBox())!;
			expect(tableBox.y).toBeGreaterThanOrEqual(historyBox.y);
			expect(tableBox.y + tableBox.height).toBeLessThanOrEqual(
				historyBox.y + historyBox.height,
			);
			expect(
				await tableScroll.evaluate(
					(node) => getComputedStyle(node).outlineStyle,
				),
			).not.toBe("none");
			await tableScroll.evaluate((node) => {
				node.scrollLeft = 0;
			});
			await page.keyboard.press("ArrowRight");
			await expect
				.poll(() => tableScroll.evaluate((node) => node.scrollLeft))
				.toBe(40);
			await page.keyboard.press("ArrowLeft");
			await expect
				.poll(() => tableScroll.evaluate((node) => node.scrollLeft))
				.toBe(0);
			await page.screenshot({
				path: testInfo.outputPath(`table-${width}-${theme}-start.png`),
			});
			await tableScroll.evaluate((node) => {
				node.scrollLeft = node.scrollWidth;
			});
			const lastCell = tableScroll.getByRole("cell", {
				name: "Providers see eligible, pending and completed states clearly.",
				exact: true,
			});
			expect(
				(await lastCell.boundingBox())!.x +
					(await lastCell.boundingBox())!.width,
			).toBeLessThanOrEqual(
				(await tableScroll.boundingBox())!.x +
					(await tableScroll.boundingBox())!.width +
					1,
			);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(`table-${width}-${theme}-end.png`),
			});
		}
		await tableScroll.evaluate((node) => {
			(node as HTMLElement).style.fontSize = "";
		});
		const block = article.locator(".code-block").first();
		const button = block.getByRole("button", {
			name: "Copy code",
			exact: true,
		});
		await expect(block.locator(".code-heading > span").first()).toHaveText(
			"typescript",
		);
		await expect(
			article
				.locator(".code-block")
				.nth(1)
				.locator(".code-heading > span")
				.first(),
		).toHaveText("Code");
		await expect(
			page.locator('[data-native-item="intro"] .code-block'),
		).toHaveCount(0);
		await expect(block.locator("pre")).toHaveText(code, {
			useInnerText: false,
		});
		await button.scrollIntoViewIfNeeded();
		await button.focus();
		await page.keyboard.press("Enter");
		await expect(block.getByRole("status")).toHaveText("Copied");
		const copied = await page.evaluate(
			async (browserName) =>
				browserName === "webkit"
					? (window as unknown as { copiedCode: string }).copiedCode
					: navigator.clipboard.readText(),
			browserName,
		);
		expect(copied).toBe(code); // Independent exact expected bytes: tabs, spaces, blank lines, Unicode and trailing newline.
		await page.evaluate(() =>
			(
				window as unknown as { refreshCodeSnapshot: () => void }
			).refreshCodeSnapshot(),
		);
		await expect(page.locator('[data-native-item="live-update"]')).toHaveText(
			"eventNative live update",
		);
		await expect(block.getByRole("status")).toHaveText("Copied");
		await expect(button).toBeFocused();
		expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(44);
		expect(
			await button.evaluate((node) => getComputedStyle(node).outlineStyle),
		).not.toBe("none");
		await page.evaluate(() =>
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: async () => {
						throw new DOMException("Clipboard denied", "NotAllowedError");
					},
				},
			}),
		);
		await button.click();
		await expect(block.getByRole("status")).toHaveText(
			"Copy failed — select code to copy.",
		);
		await expect(button).toBeEnabled();
		await expect(block.locator("pre")).toHaveText(code, {
			useInnerText: false,
		});
		await expect(
			article.locator('script, img, a[href^="javascript:"]'),
		).toHaveCount(0);
		await expect(
			article.getByText("[External image not loaded]", { exact: true }),
		).toBeVisible();
		await expect(
			article.getByRole("link", { name: "Safe", exact: true }),
		).toHaveAttribute("href", "https://example.com/reference");
		await expect(
			article.getByRole("link", { name: "Safe", exact: true }),
		).toHaveAttribute("rel", "noreferrer noopener");
		await expect(
			article.getByRole("link", { name: "Safe", exact: true }),
		).toHaveAttribute("target", "_blank");
		expect(externalImages).toEqual([]);
		await expect(
			page.getByRole("article", { name: "assistant", exact: true }),
		).toHaveCount(4);
		await expect(page.locator('[data-native-item="call-only"]')).toHaveClass(
			/visually-hidden/,
		);
		await expect(page.locator('[data-native-item="intro"]')).not.toHaveClass(
			/visually-hidden/,
		);
		await expect(
			page.locator('[data-native-item="intro"] .tool-call'),
		).toHaveClass(/visually-hidden/);
		await expect(
			page.locator('[data-native-item="intro"] p').first(),
		).toHaveText("Inspect this code. Inline value stays inline.");
		await expect(
			page.getByRole("article", { name: "tool: functions.read", exact: true }),
		).toHaveCount(2);
		await expect(
			page.getByRole("article", { name: "tool: functions.edit", exact: true }),
		).toHaveCount(2);
		await page.evaluate(() =>
			(
				window as unknown as { setCodeBusy: (busy: boolean) => void }
			).setCodeBusy(true),
		);
		await expect(page.locator(".working-marker")).toBeVisible();
		await page.getByRole("region", { name: "Conversation history" }).focus();
		await page
			.getByRole("region", { name: "Conversation history" })
			.evaluate((node) => {
				node.scrollTop = node.scrollHeight;
			});
		await expect
			.poll(() =>
				page.locator(".working-marker").evaluate((node) => {
					const marker = node.getBoundingClientRect();
					const port = node.closest(".chat-scroll")!.getBoundingClientRect();
					return (
						marker.top >= Math.max(port.top, 0) &&
						marker.bottom <= Math.min(port.bottom, innerHeight)
					);
				}),
			)
			.toBe(true);
		await page.screenshot({
			path: testInfo.outputPath(`tools-busy-${width}.png`),
		});
		await page.evaluate(() =>
			(
				window as unknown as { setCodeBusy: (busy: boolean) => void }
			).setCodeBusy(false),
		);
		await expect(page.locator(".working-marker")).toHaveCount(0);
		await expect(page.locator(".tool-stack")).toHaveCount(1);
		await expect(page.locator(".tool-stack > article")).toHaveCount(4);
		await expect(
			page.locator('[data-native-item="tool-three"] summary'),
		).toHaveAccessibleName("Edit (functions.edit) · output");
		await expect(
			page.locator('[data-native-item="tool-two"] .tool-icon'),
		).toHaveAttribute("aria-hidden", "true");
		const routine = page.locator(
			'[data-native-item="tool-two"], [data-native-item="tool-three"], [data-native-item="tool-four"]',
		);
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await routine.first().scrollIntoViewIfNeeded();
			const density = await routine.evaluateAll((rows) => {
				const boxes = rows.map((row) => row.getBoundingClientRect());
				return {
					occupiedHeight:
						boxes[2].bottom -
						boxes[0].top +
						parseFloat(getComputedStyle(rows[2].parentElement!).marginBottom) +
						parseFloat(
							getComputedStyle(rows[2].parentElement!).borderBottomWidth,
						),
					rowHeights: boxes.map((box) => box.height),
					targets: rows.map((row) => {
						const summary = row.querySelector("summary")!;
						const box = summary.getBoundingClientRect();
						return { width: box.width, height: box.height };
					}),
					conversationWidth:
						document.querySelector(".conversation")!.clientWidth,
					conversationHeight: document
						.querySelector(".conversation")!
						.getBoundingClientRect().height,
				};
			});
			console.log(
				"COMPACT_DENSITY",
				JSON.stringify({ engine: browserName, width, theme, ...density }),
			);
			await page.screenshot({
				path: testInfo.outputPath(`collapsed-tools-${width}-${theme}.png`),
			});
			// Three independent routine results occupy at most 48px each, including gaps.
			expect(density.occupiedHeight).toBeLessThanOrEqual(144);
			for (const target of density.targets) {
				expect(target.width).toBeGreaterThanOrEqual(44);
				expect(target.height).toBeGreaterThanOrEqual(44);
			}
		}
		for (const [id, text] of [
			["tool-two", "Independent second native result"],
			["tool-three", "Independent third native result"],
			["tool-four", "Independent fourth native result"],
		]) {
			const row = page.locator(`[data-native-item="${id}"]`);
			await expect(row.locator("details")).not.toHaveAttribute("open");
			const summary = row.locator("summary");
			await summary.scrollIntoViewIfNeeded();
			await page.keyboard.press("Tab");
			await summary.focus();
			// Native focus can leave the row under the floating Jump control.
			await summary.evaluate((node) => {
				const scrollport = node.closest(".chat-scroll")!;
				const row = node.getBoundingClientRect();
				const viewport = scrollport.getBoundingClientRect();
				scrollport.scrollTop +=
					row.top + row.height / 2 - viewport.top - viewport.height / 2;
			});
			expect(
				await summary.evaluate((node) => {
					const box = node.getBoundingClientRect();
					return [0.25, 0.5, 0.75].every((fraction) => {
						const target = document.elementFromPoint(
							box.x + box.width * fraction,
							box.y + box.height / 2,
						);
						return target !== null && node.contains(target);
					});
				}),
			).toBe(true);
			expect(
				await summary.evaluate((node) => getComputedStyle(node).outlineStyle),
			).not.toBe("none");
			await expect(summary).toHaveCSS("outline-offset", "-3px");
			await expect(summary.locator(".tool-chevron")).toHaveCSS(
				"transform",
				"none",
			);
			await page.keyboard.press("Enter");
			await expect(summary.locator(".tool-chevron")).toHaveCSS(
				"transform",
				"matrix(0, 1, -1, 0, 0, 0)",
			);
			await expect(row.locator("pre")).toHaveText(text);
			await page.keyboard.press("Space");
			await expect(row.locator("pre")).toBeHidden();
		}
		await expect(
			page.locator('[data-native-item="intro"] .message-role'),
		).toHaveClass(/visually-hidden/);
		await expect(article.locator(".message-role")).toHaveClass(
			/visually-hidden/,
		);
		await expect(
			page.locator('[data-native-item="after"] .message-role'),
		).toHaveClass(/visually-hidden/);
		await expect(
			page.getByRole("heading", { name: "Pi", exact: true }),
		).toHaveCount(4);
		for (const heading of await page
			.locator(".message-assistant .message-role")
			.all()) {
			await expect(heading).toHaveCSS("clip-path", "inset(50%)");
		}
		const firstTool = page.locator('[data-native-item="tool-one"]'),
			secondTool = page.locator('[data-native-item="tool-two"]');
		await expect(firstTool.locator(".message-role")).toHaveClass(
			/visually-hidden/,
		);
		await expect(firstTool.locator("summary")).toHaveText(
			"Read (functions.read) · output · shortened",
		);
		await expect(secondTool.locator("summary")).toHaveText(
			"Read (functions.read) · output",
		);
		await expect(firstTool.locator("details")).not.toHaveAttribute("open");
		const image = firstTool.getByRole("button", {
			name: "Enlarge native Pi image 1",
			exact: true,
		});
		await image.scrollIntoViewIfNeeded();
		await expect(image).toBeVisible();
		expect(await image.locator("xpath=ancestor::details").count()).toBe(0);
		await expect(
			firstTool.getByText("Image unavailable: fixture image boundary", {
				exact: true,
			}),
		).toBeVisible();
		await firstTool.locator("summary").focus();
		await page.keyboard.press("Enter");
		await expect(firstTool.locator(".preview-note")).toHaveText(
			"Preview shortened · 29 characters omitted.",
		);
		await expect(firstTool.locator("pre")).toHaveCount(2);
		await expect(firstTool.locator("pre").first()).toContainText(
			"First tool line 79:",
		);
		await expect(firstTool.locator("pre").nth(1)).toHaveText(
			"Separate text after native image",
		);
		await expect(secondTool.locator("details")).not.toHaveAttribute("open");
		const output = firstTool.locator("pre").first();
		expect(
			await output.evaluate(
				(node) =>
					node.scrollHeight > node.clientHeight &&
					node.scrollWidth > node.clientWidth,
			),
		).toBe(true);
		await output.focus();
		await expect(output).toBeFocused();
		if (browserName === "chromium") await page.keyboard.press("ArrowRight");
		else
			await output.evaluate((node) => {
				node.scrollLeft = 100;
			});
		await expect
			.poll(() => output.evaluate((node) => node.scrollLeft))
			.toBeGreaterThan(0);
		for (const colorScheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme });
			await button.scrollIntoViewIfNeeded();
			expect(
				await block
					.locator("pre")
					.evaluate((node) => node.scrollWidth > node.clientWidth),
			).toBe(true);
			await block.locator("pre").focus();
			await expect(block.locator("pre")).toBeFocused();
			if (browserName === "chromium") await page.keyboard.press("ArrowRight");
			else
				await block.locator("pre").evaluate((node) => {
					node.scrollLeft = 100;
				});
			await expect
				.poll(() => block.locator("pre").evaluate((node) => node.scrollLeft))
				.toBeGreaterThan(0);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(`code-copy-${width}-${colorScheme}.png`),
			});
			await firstTool.locator("summary").scrollIntoViewIfNeeded();
			await page.screenshot({
				path: testInfo.outputPath(`tool-output-${width}-${colorScheme}.png`),
			});
		}
		await page.setViewportSize({ width, height: 420 });
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "125%";
		});
		await button.scrollIntoViewIfNeeded();
		await expect(button).toBeVisible();
		expect(
			await block
				.locator(".code-heading")
				.evaluate((node) => node.scrollWidth <= node.clientWidth),
		).toBe(true);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page.screenshot({
			path: testInfo.outputPath(`code-copy-enlarged-${width}.png`),
		});
		await firstTool.locator("summary").focus();
		await firstTool.locator("summary").evaluate((node) => {
			const scrollport = node.closest(".chat-scroll")!;
			const row = node.getBoundingClientRect();
			const viewport = scrollport.getBoundingClientRect();
			scrollport.scrollTop +=
				row.top + row.height / 2 - viewport.top - viewport.height / 2;
		});
		await page.screenshot({
			path: testInfo.outputPath(`tool-enlarged-${width}.png`),
		});
		const append = async (items: Snapshot["items"]) =>
			page.evaluate(
				(items) =>
					(
						window as unknown as {
							appendToolItems: (items: Snapshot["items"]) => void;
						}
					).appendToolItems(items),
				items,
			);
		await append([
			{
				id: "single-write",
				role: "tool: write",
				blocks: [{ type: "text", text: "Native write output" }],
			},
		]);
		const single = page.locator('[data-native-item="single-write"] details');
		await single.locator("summary").focus();
		await page.keyboard.press("Enter");
		await expect(single).toHaveAttribute("open", "");
		await expect(single.locator("summary")).toHaveAccessibleName(
			"Write (write) · output",
		);
		await single.evaluate((node) =>
			Object.assign(window, {
				originalToolDetails: node,
				originalToolStack: node.closest(".tool-stack"),
			}),
		);
		await append([
			{
				id: "append-shell",
				role: "tool: functions.bash",
				blocks: [{ type: "text", text: "Native shell output" }],
			},
			{
				id: "hidden-boundary",
				role: "assistant",
				blocks: [{ type: "tool", text: "Tool call: read_custom" }],
			},
			{
				id: "unknown-tool",
				role: "tool: read_custom",
				blocks: [{ type: "unavailable", text: "Native output unavailable" }],
			},
			{
				id: "user-boundary",
				role: "user",
				blocks: [{ type: "text", text: "User boundary" }],
			},
			{
				id: "plain-read",
				role: "tool: read",
				blocks: [{ type: "text", text: "Native read output" }],
			},
			{
				id: "thinking-boundary",
				role: "assistant",
				blocks: [{ type: "thinking", text: "Native thinking boundary" }],
			},
			{
				id: "plain-edit",
				role: "tool: edit",
				blocks: [{ type: "text", text: "Native edit output" }],
			},
			{
				id: "event-boundary",
				role: "event",
				blocks: [{ type: "text", text: "Native event boundary" }],
			},
			{
				id: "plain-shell",
				role: "tool: bash",
				blocks: [
					{ type: "text", text: "Final shell output" },
					{
						type: "image",
						ref: "d".repeat(32),
						mime: "image/png",
						width: 1,
						height: 1,
					},
				],
			},
		]);
		await expect(page.locator(".tool-stack")).toHaveCount(6);
		await expect(single).toHaveAttribute("open", "");
		expect(
			await single.evaluate((node) => {
				const original = window as unknown as {
					originalToolDetails: Element;
					originalToolStack: Element;
				};
				return (
					node === original.originalToolDetails &&
					node.closest(".tool-stack") === original.originalToolStack
				);
			}),
		).toBe(true);
		expect(
			await page
				.locator(".tool-stack")
				.evaluateAll((stacks) =>
					stacks.map((stack) =>
						Array.from(stack.children, (item) =>
							item.getAttribute("data-native-item"),
						),
					),
				),
		).toEqual([
			["tool-one", "tool-two", "tool-three", "tool-four"],
			["single-write", "append-shell"],
			["unknown-tool"],
			["plain-read"],
			["plain-edit"],
			["plain-shell"],
		]);
		expect(
			await page
				.locator(".conversation > *, .tool-stack > article")
				.evaluateAll((nodes) =>
					nodes
						.filter((node) => node.matches("article"))
						.map((node) => node.getAttribute("data-native-item")),
				),
		).toEqual([
			"intro",
			"code",
			"call-only",
			"tool-one",
			"tool-two",
			"tool-three",
			"tool-four",
			"after",
			"live-update",
			"single-write",
			"append-shell",
			"hidden-boundary",
			"unknown-tool",
			"user-boundary",
			"plain-read",
			"thinking-boundary",
			"plain-edit",
			"event-boundary",
			"plain-shell",
		]);
		await expect(
			page.locator('[data-native-item="append-shell"] summary'),
		).toHaveAccessibleName("Shell (functions.bash) · output");
		await expect(
			page.locator('[data-native-item="append-shell"] details'),
		).not.toHaveAttribute("open");
		const unknown = page.locator('[data-native-item="unknown-tool"]');
		await expect(unknown.locator("summary")).toHaveAccessibleName(
			"read_custom · output · shortened",
		);
		await expect(unknown.locator(".tool-label")).toHaveText("read_custom");
		await expect(unknown.locator(".tool-icon path")).not.toHaveAttribute(
			"d",
			(await firstTool.locator(".tool-icon path").getAttribute("d")) as string,
		);
		await unknown.locator("summary").focus();
		await page.keyboard.press("Space");
		await expect(unknown.getByRole("status")).toHaveText(
			"Native output unavailable",
		);
		await expect(
			page.locator('[data-native-item="plain-shell"]').getByRole("button", {
				name: "Enlarge native Pi image 2",
				exact: true,
			}),
		).toBeVisible();
		expect(posts).toEqual([]);
	});

test("composer focus is coherent across pointer and keyboard editing", async ({
	page,
	browserName,
}, testInfo) => {
	const summary = {
		instance: "a".repeat(32),
		generation: "b".repeat(32),
		project: "Pi Companion",
		session: "Focus session",
		parent: "idle" as const,
		background: "unobserved" as const,
	};
	await page.route("**/api/snapshot", (route) =>
		route.fulfill({ json: { connection: "connected", sessions: [summary] } }),
	);
	await page.addInitScript((summary) => {
		const sources = new Set<FixtureSource>();
		let changes: {
			parent?: "idle" | "working";
			busyText?: boolean;
			stop?: "stopping";
			connection?: "unavailable";
			otherHolder?: boolean;
		} = {};
		class FixtureSource extends EventTarget {
			onopen = null;
			onerror = null;
			constructor(private url: string) {
				super();
				sources.add(this);
				queueMicrotask(() => this.emit());
			}
			emit() {
				const observed = { ...summary, ...changes };
				const selected = new URL(this.url, location.origin).searchParams.has(
					"instance",
				);
				this.dispatchEvent(
					new MessageEvent("snapshot", {
						data: JSON.stringify({
							connection: changes.connection ?? "connected",
							controller: {
								held: !!changes.otherHolder,
								expires: Date.now() + 60_000,
							},
							sessions: [observed],
							...(selected
								? {
										selected: summary,
										snapshot: {
											...observed,
											truncated: false,
											omittedItems: 0,
											items: [
												...Array.from({ length: 20 }, (_, index) => ({
													id: `history-${index}`,
													role: "assistant",
													blocks: [
														{
															type: "text",
															text: `Review step ${index}. Keep the conversation readable while editing a long reply.`,
														},
													],
												})),
												{
													id: "hello",
													role: "assistant",
													blocks: [
														{ type: "text", text: "Ready for your message." },
													],
												},
											],
										},
									}
								: {}),
						}),
					}),
				);
			}
			close() {
				sources.delete(this);
			}
		}
		Object.defineProperty(window, "EventSource", { value: FixtureSource });
		Object.defineProperty(window, "changeChrome", {
			value: (next: typeof changes) => {
				changes = next;
				for (const source of sources) source.emit();
			},
		});
		const viewport = Object.assign(new EventTarget(), {
			height: 400,
			offsetTop: 0,
			scale: 1,
		});
		Object.defineProperty(window, "visualViewport", { value: viewport });
		Object.defineProperty(window, "setComposerViewport", {
			value: (height: number) => {
				viewport.height = height;
				viewport.dispatchEvent(new Event("resize"));
			},
		});
	}, summary);
	await page.setViewportSize({ width: 320, height: 844 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/");
	await page
		.getByRole("region", { name: "Live sessions", exact: true })
		.getByRole("button", { name: "Focus session Pi Companion Pi idle" })
		.click();
	const draft = page.getByLabel("Text for selected Pi (local draft)", {
		exact: true,
	});
	const attachment = page.getByLabel("Images for selected Pi (local picker)");
	const send = page.getByRole("button", { name: "Send", exact: true });
	const bar = page.locator(".composer-bar");
	// A simulated short keyboard shell constrains height, never editor width.
	const keyboardStates = [];
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 844 });
		await page.evaluate(() =>
			(
				window as unknown as { setComposerViewport: (height: number) => void }
			).setComposerViewport(300),
		);
		for (const [state, text] of [
			["empty", ""],
			["short", "Hello Pi"],
			["two-lines", "First line\nSecond line"],
			["unbroken", "abcdefghij".repeat(30)],
		]) {
			await draft.fill(text);
			const geometry = {
				state,
				bar: (await bar.boundingBox())!,
				editor: (await draft.boundingBox())!,
				send: (await send.boundingBox())!,
				native: await draft.evaluate((node) => ({
					scrollHeight: node.scrollHeight,
					font: getComputedStyle(node).fontSize,
					line: getComputedStyle(node).lineHeight,
				})),
			};
			keyboardStates.push(geometry);
			console.log(
				"SHORT_KEYBOARD_GEOMETRY",
				JSON.stringify({ engine: browserName, width, ...geometry }),
			);
			for (const theme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await page.screenshot({
					path: testInfo.outputPath(
						`short-keyboard-${width}-${state}-${theme}.png`,
					),
				});
			}
		}
	}
	for (const geometry of keyboardStates) {
		expect(geometry.editor.x + geometry.editor.width).toBeLessThanOrEqual(
			geometry.send.x,
		);
		expect(geometry.editor.y + geometry.editor.height).toBeLessThanOrEqual(
			geometry.send.y + geometry.send.height,
		);
		expect(geometry.editor.height).toBe(44);
	}
	await page.evaluate(() =>
		(
			window as unknown as { setComposerViewport: (height: number) => void }
		).setComposerViewport(400),
	);
	await draft.fill("");
	// WebKit honors macOS text-only Tab preferences; Option+Tab visits controls.
	const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
	const previous = browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab";
	const readings: {
		state: string;
		outline: string;
		width: number;
		contrast: number;
		shadow: string;
	}[] = [];
	async function record(
		state: string,
		target: typeof bar,
		background: typeof bar,
	) {
		const color = await background.evaluate(
			(node) => getComputedStyle(node).backgroundColor,
		);
		const reading = await target.evaluate((node, background) => {
			const style = getComputedStyle(node);
			const luminance = (color: string) => {
				const rgb = color
					.match(/[\d.]+/g)!
					.slice(0, 3)
					.map(Number)
					.map((n) => {
						const s = n / 255;
						return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
					});
				return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
			};
			const a = luminance(style.outlineColor),
				b = luminance(background);
			return {
				outline: style.outlineStyle,
				width: parseFloat(style.outlineWidth),
				contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
				shadow: style.boxShadow,
			};
		}, color);
		readings.push({ state, ...reading });
	}
	async function capture(state: string) {
		await page.screenshot({
			path: testInfo.outputPath(`${state}-simulated-keyboard.png`),
		});
	}
	const draftText =
		"Please review this message.\nKeep the editing surface calm.\nThe draft stays editable.";
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 844 });
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await draft.fill("");
			await draft.click();
			await expect(draft).toBeFocused();
			await capture(`${width}-${theme}-empty-pointer`);
			await draft.fill(draftText);
			await draft.click();
			await page.keyboard.press("ControlOrMeta+A");
			await page.keyboard.press("ArrowRight");
			await page.keyboard.type("!");
			await expect(draft).toHaveValue(draftText + "!");
			await capture(`${width}-${theme}-multiline-pointer`);
			await record(`${width}-${theme}-textarea-perimeter`, bar, bar);
			const geometry = await bar.evaluate((node) => {
				const box = node.getBoundingClientRect();
				return {
					x: box.x,
					right: box.right,
					bottom: box.bottom,
					width: box.width,
					height: box.height,
					overflow: node.scrollWidth > node.clientWidth,
				};
			});
			expect(geometry.x).toBeGreaterThanOrEqual(2);
			expect(geometry.right).toBeLessThanOrEqual(width - 2);
			expect(geometry.bottom).toBeLessThanOrEqual(392);
			expect(geometry.overflow).toBe(false);
			await testInfo.attach(`${width}-${theme}-geometry`, {
				body: JSON.stringify(geometry),
				contentType: "application/json",
			});
			for (const control of [attachment, send]) {
				const box = (await control.boundingBox())!;
				expect(box.width).toBeGreaterThanOrEqual(44);
				expect(box.height).toBeGreaterThanOrEqual(44);
			}
			await send.focus();
			await page.keyboard.press(previous);
			await expect(draft).toBeFocused();
			await record(`${width}-${theme}-textarea-tab`, bar, bar);
			await page.keyboard.press(previous);
			await expect(attachment).toBeFocused();
			expect(
				await bar.evaluate((node) => getComputedStyle(node).outlineStyle),
			).toBe("none");
			await record(
				`${width}-${theme}-attachment-tab`,
				page.locator(".attachment-picker"),
				bar,
			);
			if (width === 390 && theme === "dark")
				await capture("390-dark-attachment-tab");
			await page.keyboard.press(tab);
			await expect(draft).toBeFocused();
			await page.keyboard.press(tab);
			await expect(send).toBeFocused();
			expect(
				await bar.evaluate((node) => getComputedStyle(node).outlineStyle),
			).toBe("none");
			await record(`${width}-${theme}-send-tab`, send, send);
			if (width === 390 && theme === "dark") await capture("390-dark-send-tab");
			await expect(draft).toHaveValue(draftText + "!");
		}
	}
	await page.setViewportSize({ width: 320, height: 844 });
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "125%";
	});
	await draft.click();
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.type(" ");
	await expect(draft).toHaveValue(draftText + "! ");
	await capture("320-dark-multiline-125-percent");
	expect(
		await bar.evaluate((node) => node.scrollWidth <= node.clientWidth),
	).toBe(true);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	const mutations: string[] = [];
	page.on("request", (request) => {
		if (request.method() === "POST") mutations.push(request.url());
	});
	const stop = page.getByRole("button", { name: "Stop", exact: true });
	// Retained text keeps the same full-width surface through control changes.
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 844 });
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "";
			(
				window as unknown as {
					changeChrome: (next: Record<string, unknown>) => void;
				}
			).changeChrome({ parent: "working", busyText: true });
		});
		const retained = "Please retain this draft";
		await draft.fill(retained);
		for (const [state, parent, stopping] of [
			["working", "working", false],
			["settled", "idle", false],
			["working-again", "working", false],
			["stopping", "working", true],
			["resumed", "working", false],
			["idle-again", "idle", false],
		] as const) {
			await page.evaluate(
				({ parent, stopping }) => {
					(
						window as unknown as {
							changeChrome: (next: Record<string, unknown>) => void;
						}
					).changeChrome({
						parent,
						busyText: true,
						...(stopping ? { stop: "stopping" } : {}),
					});
				},
				{ parent, stopping },
			);
			await expect(draft).toHaveValue(retained);
			await expect
				.poll(async () => {
					const surface = (await bar.boundingBox())!;
					const editor = (await draft.boundingBox())!;
					return surface.height - editor.height;
				})
				.toBe(14);
			const surface = (await bar.boundingBox())!;
			const editor = (await draft.boundingBox())!;
			const sendBox = (await send.boundingBox())!;
			{
				expect(editor.x + editor.width).toBeLessThanOrEqual(sendBox.x);
				expect(editor.y + editor.height).toBe(sendBox.y + sendBox.height);
			}
			for (const control of [
				attachment,
				send,
				...(parent === "working" ? [stop] : []),
			]) {
				const box = (await control.boundingBox())!;
				expect(box.width).toBeGreaterThanOrEqual(44);
				expect(box.height).toBeGreaterThanOrEqual(44);
				expect(box.y + box.height).toBeLessThanOrEqual(
					surface.y + surface.height,
				);
			}
			expect(
				await page
					.locator(".chat-scroll")
					.evaluate((node) => node.clientHeight),
			).toBeGreaterThanOrEqual(44);
			console.log(
				"RETAINED_DRAFT_GEOMETRY",
				JSON.stringify({
					engine: browserName,
					width,
					state,
					surface,
					editor,
					send: sendBox,
				}),
			);
			for (const theme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await page.screenshot({
					path: testInfo.outputPath(`retained-${width}-${state}-${theme}.png`),
				});
			}
		}
	}
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 844 });
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			for (const enlarged of [false, true]) {
				await page.evaluate((enlarged) => {
					document.documentElement.style.fontSize = enlarged ? "125%" : "";
				}, enlarged);
				for (const [state, parent, text, stopping] of [
					["idle-empty", "idle", "", false],
					["idle-draft", "idle", "A local draft", false],
					["idle-multiline", "idle", "First line\nSecond line", false],
					["busy-empty", "working", "", false],
					["busy-draft", "working", "A local draft", false],
					["busy-multiline", "working", "First line\nSecond line", false],
					["stopping", "working", "A local draft", true],
					["stopping-multiline", "working", "First line\nSecond line", true],
				] as const) {
					await page.evaluate(
						({ parent, stopping }) => {
							(
								window as unknown as {
									changeChrome: (next: Record<string, unknown>) => void;
								}
							).changeChrome({
								parent,
								busyText: true,
								...(stopping ? { stop: "stopping" } : {}),
							});
						},
						{ parent, stopping },
					);
					await draft.fill(text);
					await draft.focus();
					await expect(page.locator("header .parent-status")).toHaveText(
						stopping
							? "Stopping"
							: parent === "idle"
								? "Pi idle"
								: "Pi is working",
					);
					if (!enlarged)
						expect(
							(await page.locator("header").boundingBox())!.height,
						).toBeLessThanOrEqual(70);
					expect(
						await page.evaluate(
							() => document.documentElement.scrollWidth <= innerWidth,
						),
					).toBe(true);
					expect(
						await bar.evaluate((node) => node.scrollWidth <= node.clientWidth),
					).toBe(true);
					const sendBox = (await send.boundingBox())!;
					const editor = (await draft.boundingBox())!;
					const surface = (await bar.boundingBox())!;
					expect(editor.x + editor.width).toBeLessThanOrEqual(sendBox.x);
					expect(editor.y + editor.height).toBe(sendBox.y + sendBox.height);
					if (!text && !enlarged) expect(surface.height).toBe(58);
					expect(
						await page
							.locator(".chat-scroll")
							.evaluate((node) => node.clientHeight),
					).toBeGreaterThanOrEqual(44);
					expect(sendBox.width).toBeGreaterThanOrEqual(44);
					expect(sendBox.height).toBeGreaterThanOrEqual(44);
					await expect(send).toHaveCSS(
						"background-color",
						text && !stopping
							? theme === "light"
								? "rgb(23, 23, 23)"
								: "rgb(244, 244, 244)"
							: "rgba(0, 0, 0, 0)",
					);
					if (parent === "idle") await expect(stop).toBeHidden();
					else {
						await expect(stop).toBeVisible();
						const stopBox = (await stop.boundingBox())!;
						expect(stopBox.width).toBeGreaterThanOrEqual(44);
						expect(stopBox.height).toBeGreaterThanOrEqual(44);
						expect(
							sendBox.x - stopBox.x - stopBox.width,
						).toBeGreaterThanOrEqual(6);
						await expect(stop).toHaveCSS(
							"background-color",
							"rgba(0, 0, 0, 0)",
						);
						await expect(stop).toHaveCSS(
							"border-top-color",
							theme === "light" ? "rgb(97, 97, 97)" : "rgb(176, 176, 176)",
						);
						if (stopping) await expect(stop).toBeDisabled();
						else await expect(stop).toBeEnabled();
					}
					if (text && !stopping) await expect(send).toBeEnabled();
					else await expect(send).toBeDisabled();
					await page.screenshot({
						path: testInfo.outputPath(
							`chrome-${width}-${theme}-${enlarged ? "125" : "ordinary"}-${state}.png`,
						),
					});
					if (parent === "working" && !stopping) {
						await draft.focus();
						if (text) await page.keyboard.press(tab); // Send options precedes Stop.
						await page.keyboard.press(tab);
						await expect(stop).toBeFocused();
						await record(`${width}-${theme}-${state}-stop`, stop, bar);
						await page.screenshot({
							path: testInfo.outputPath(
								`chrome-${width}-${theme}-${enlarged ? "125" : "ordinary"}-${state}-stop-focus.png`,
							),
						});
						if (text) {
							await page.keyboard.press(tab);
							await expect(send).toBeFocused();
							await record(`${width}-${theme}-${state}-send`, send, send);
							await page.screenshot({
								path: testInfo.outputPath(
									`chrome-${width}-${theme}-${enlarged ? "125" : "ordinary"}-send-focus.png`,
								),
							});
							await page.getByLabel("Send options", { exact: true }).click();
							await expect(
								page.getByRole("button", { name: "Follow-up", exact: true }),
							).toBeVisible();
							await page.screenshot({
								path: testInfo.outputPath(
									`chrome-${width}-${theme}-${enlarged ? "125" : "ordinary"}-options.png`,
								),
							});
							await page.getByLabel("Send options", { exact: true }).click();
						}
					}
				}
			}
		}
	}
	expect(mutations).toEqual([]);
	// Constrained keyboard viewport: actual local image rejection, retained long
	// draft, busy actions, and the conditional Jump must coexist without clipping.
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 844 });
		for (const size of ["100%", "125%", "200%"]) {
			await page.evaluate((size) => {
				document.documentElement.style.fontSize = size;
				(
					window as unknown as { setComposerViewport: (height: number) => void }
				).setComposerViewport(300);
				(
					window as unknown as {
						changeChrome: (next: Record<string, unknown>) => void;
					}
				).changeChrome({ parent: "working", busyText: true });
			}, size);
			await draft.fill(draftText);
			await attachment.setInputFiles({
				name: "rejected.gif",
				mimeType: "image/gif",
				buffer: Buffer.from("GIF89a"),
			});
			await expect(page.locator(".input-notice")).toContainText("PNG");
			await draft.focus();
			const history = page.getByRole("region", {
				name: "Conversation history",
				exact: true,
			});
			await history.evaluate((node) => {
				node.dispatchEvent(
					new WheelEvent("wheel", { bubbles: true, deltaY: -1 }),
				);
				node.scrollTop = 100;
			});
			await expect(
				page.getByRole("button", { name: "Jump to latest" }),
			).toBeVisible();
			for (const open of [false, true]) {
				if (open)
					await page.getByLabel("Send options", { exact: true }).click();
				for (const theme of ["light", "dark"] as const) {
					await page.emulateMedia({ colorScheme: theme });
					const targets = [
						send,
						stop,
						page.getByLabel("Send options", { exact: true }),
						page.getByRole("button", { name: "Jump to latest" }),
					];
					if (open)
						targets.push(
							page.getByRole("button", { name: "Follow-up", exact: true }),
						);
					for (const control of targets) {
						const box = (await control.boundingBox())!;
						expect(box.width).toBeGreaterThanOrEqual(44);
						expect(box.height).toBeGreaterThanOrEqual(44);
						expect(box.y).toBeGreaterThanOrEqual(0);
						expect(box.y + box.height).toBeLessThanOrEqual(300);
						expect(
							await control.evaluate((node) => {
								const box = node.getBoundingClientRect();
								// Sample within rounded corners, not their transparent outside.
								const blocked: string[] = [];
								for (const x of [10, box.width / 2, box.width - 10])
									for (const y of [10, box.height / 2, box.height - 10]) {
										const hit = document.elementFromPoint(box.x + x, box.y + y);
										if (!hit || !node.contains(hit))
											blocked.push(
												`${node.outerHTML} at ${x},${y}: ${hit?.outerHTML}`,
											);
									}
								return blocked;
							}),
						).toEqual([]);
					}
					const notices = page.locator(".composer-notices");
					const noticeBox = (await notices.boundingBox())!;
					expect(noticeBox.height).toBeGreaterThanOrEqual(
						(parseFloat(size) / 100) * 16 * 1.2,
					);
					if (open) {
						const followUp = page.getByRole("button", {
							name: "Follow-up",
							exact: true,
						});
						expect(noticeBox.x + noticeBox.width + 4).toBeLessThanOrEqual(
							(await followUp.boundingBox())!.x,
						);
						await followUp.focus();
						await page.keyboard.press(tab);
						await page.keyboard.press(previous);
						await expect(followUp).toBeFocused();
						await expect(followUp).toHaveCSS("outline-style", "solid");
					}
					await notices.evaluate((node) => {
						node.scrollTop = node.scrollHeight;
					});
					for (const x of [4, noticeBox.width - 4])
						expect(
							await notices.evaluate((node, x) => {
								const box = node.getBoundingClientRect();
								const hit = document.elementFromPoint(
									box.x + x,
									box.y + box.height / 2,
								);
								return !!hit && node.contains(hit);
							}, x),
						).toBe(true);
					const reader = (await history.boundingBox())!;
					// At 200%, retain more than one full 51.2px conversation line.
					expect(reader.height).toBeGreaterThanOrEqual(56);
					expect(reader.width).toBe(
						(await page.locator(".chat-frame").boundingBox())!.width,
					);
					expect(
						await draft.evaluate((node) => {
							const style = getComputedStyle(node);
							return (
								node.scrollHeight > node.clientHeight &&
								parseFloat(style.lineHeight) <=
									node.clientHeight -
										parseFloat(style.paddingTop) -
										parseFloat(style.paddingBottom)
							);
						}),
					).toBe(true);
					expect(
						await page.evaluate(
							() => document.documentElement.scrollWidth <= innerWidth,
						),
					).toBe(true);
					console.log(
						"T1_CONSTRAINED",
						JSON.stringify({
							browserName,
							width,
							size,
							theme,
							open,
							notices: noticeBox,
							option: open
								? await page
										.getByRole("button", { name: "Follow-up", exact: true })
										.boundingBox()
								: null,
							reader,
							bar: await bar.boundingBox(),
							composer: await page.locator(".composer").boundingBox(),
						}),
					);
					await page.screenshot({
						path: testInfo.outputPath(
							`constrained-${width}-${size}-${theme}-${open ? "options" : "closed"}.png`,
						),
					});
				}
				if (open)
					await page.getByLabel("Send options", { exact: true }).click();
			}
			for (const [changes, reason] of [
				[{ parent: "working", busyText: false }, "fully restart the owning Pi"],
				[{ parent: "idle", otherHolder: true }, "Another browser has control"],
				[{ parent: "working", busyText: true, stop: "stopping" }, "Stopping"],
				[{ parent: "idle", connection: "unavailable" }, "Disconnected"],
			] as const) {
				await page.evaluate(
					(changes) =>
						(
							window as unknown as {
								changeChrome: (next: Record<string, unknown>) => void;
							}
						).changeChrome(changes),
					changes,
				);
				await expect(send).toBeDisabled();
				const availability = page.locator("#composer-availability");
				await expect(availability).toBeVisible();
				await expect(availability).toContainText(reason);
				const notices = page.locator(".composer-notices");
				await notices.evaluate((node) => {
					node.scrollTop = 0;
				});
				const noticeBox = (await notices.boundingBox())!;
				expect((await availability.boundingBox())!.y).toBeGreaterThanOrEqual(
					noticeBox.y,
				);
				expect(noticeBox.height).toBeGreaterThanOrEqual(
					(parseFloat(size) / 100) * 16 * 1.2,
				);
				// Scroll the existing notice owner, not the action row, to read the
				// complete safety explanation and retained rejection copy.
				await notices.evaluate((node) => {
					node.scrollTop = node.scrollHeight;
				});
				expect((await send.boundingBox())!.y + 44).toBeLessThanOrEqual(300);
				expect((await history.boundingBox())!.height).toBeGreaterThanOrEqual(
					56,
				);
				for (const x of [4, noticeBox.width - 4]) {
					expect(
						await notices.evaluate((node, x) => {
							const box = node.getBoundingClientRect();
							const hit = document.elementFromPoint(
								box.x + x,
								box.y + box.height / 2,
							);
							return !!hit && node.contains(hit);
						}, x),
					).toBe(true);
				}
				console.log(
					"BLOCKED_NOTICE_GEOMETRY",
					JSON.stringify({
						engine: browserName,
						width,
						size,
						reason,
						notices: noticeBox,
						reader: await history.boundingBox(),
						bar: await bar.boundingBox(),
					}),
				);
				await page.screenshot({
					path: testInfo.outputPath(
						`blocked-${width}-${size}-${reason.split(" ")[0]}.png`,
					),
				});
			}
			// Ordinary layout remains roomy with the same long draft and text size.
			await page.evaluate(() => {
				(
					window as unknown as { setComposerViewport: (height: number) => void }
				).setComposerViewport(844);
				(
					window as unknown as {
						changeChrome: (next: Record<string, unknown>) => void;
					}
				).changeChrome({ parent: "working", busyText: true });
			});
			await attachment.setInputFiles({
				name: "rejected.gif",
				mimeType: "image/gif",
				buffer: Buffer.from("GIF89a"),
			});
			await draft.focus();
			await history.evaluate((node) => {
				node.dispatchEvent(
					new WheelEvent("wheel", { bubbles: true, deltaY: -1 }),
				);
				node.scrollTop = 100;
			});
			await expect(
				page.getByRole("button", { name: "Jump to latest" }),
			).toBeVisible();
			expect((await history.boundingBox())!.height).toBeGreaterThanOrEqual(150);
			for (const theme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await page.screenshot({
					path: testInfo.outputPath(`ordinary-${width}-${size}-${theme}.png`),
				});
			}
		}
	}
	expect(mutations).toEqual([]);
	await draft.focus();

	await testInfo.attach("focus-readings", {
		body: JSON.stringify(readings, null, 2),
		contentType: "application/json",
	});
	// One visible perimeter for editing, not a second ring on the nested textarea.
	expect(
		await draft.evaluate((node) => getComputedStyle(node).outlineStyle),
	).toBe("none");
	for (const reading of readings) {
		expect(reading.outline, reading.state).toBe("solid");
		expect(reading.width, reading.state).toBe(2);
		expect(reading.contrast, reading.state).toBeGreaterThanOrEqual(3);
		expect(reading.shadow, reading.state).toBe("none");
	}
});

for (const input of ["mouse", "touch"] as const)
	test(`session selection and button feedback distinguish ${input} from keyboard focus`, async ({
		browser,
	}, testInfo) => {
		const context = await browser.newContext({
			baseURL: testInfo.project.use.baseURL,
			hasTouch: input === "touch",
			viewport: { width: 390, height: 844 },
			reducedMotion: "reduce",
		});
		try {
			const page = await context.newPage();
			const summary = {
				instance: "a".repeat(32),
				generation: "b".repeat(32),
				project: "States",
				session: "Selected session",
				parent: "idle",
				background: "unobserved",
			};
			const sessions = [
				summary,
				{ ...summary, instance: "c".repeat(32), session: "Other session" },
			];
			await page.route("**/api/snapshot", (route) =>
				route.fulfill({ json: { connection: "connected", sessions } }),
			);
			await page.addInitScript(
				({ summary, sessions }) => {
					class Source extends EventTarget {
						onopen = null;
						onerror = null;
						constructor(url: string) {
							super();
							queueMicrotask(() =>
								this.dispatchEvent(
									new MessageEvent("snapshot", {
										data: JSON.stringify({
											connection: "connected",
											sessions,
											...(new URL(url, location.origin).searchParams.has(
												"instance",
											)
												? {
														selected: summary,
														snapshot: {
															...summary,
															truncated: false,
															items: [],
														},
													}
												: {}),
										}),
									}),
								),
							);
						}
						close() {}
					}
					Object.defineProperty(window, "EventSource", { value: Source });
				},
				{ summary, sessions },
			);
			await page.goto("/");
			await chooseSession(page, summary.instance);
			const send = page.getByRole("button", { name: "Send", exact: true });
			await expect(send).toBeDisabled();
			const disabled = await send.evaluate((node) => ({
				opacity: getComputedStyle(node).opacity,
				background: getComputedStyle(node).backgroundColor,
			}));
			await page.getByPlaceholder("Message Pi").fill("Ready");
			await expect(send).toBeEnabled();
			expect(
				await send.evaluate((node) => getComputedStyle(node).backgroundColor),
			).not.toBe(disabled.background);
			const menu = page.getByRole("button", { name: /^Open sessions:/ });
			const sidebar = page.getByRole("dialog", { name: "Live sessions" });
			const open = async () => {
				if (input === "touch") await menu.tap();
				else await menu.click();
				await expect(sidebar).toBeVisible();
			};
			await open();
			const selected = sidebar.locator('[aria-current="true"]');
			const other = sidebar.getByRole("button", {
				name: "Other session States Pi idle",
			});
			const appearance = () =>
				selected.evaluate((node) => ({
					background: getComputedStyle(node).backgroundColor,
					shadow: getComputedStyle(node).boxShadow,
				}));
			for (const theme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme: theme });
				const stable = await appearance();
				expect(stable.shadow).not.toBe("none");
				expect(
					await other.evaluate((node) => getComputedStyle(node).boxShadow),
				).toBe("none");
				if (input === "mouse") {
					const plain = await other.evaluate(
						(node) => getComputedStyle(node).backgroundColor,
					);
					await other.hover();
					expect(
						await other.evaluate(
							(node) => getComputedStyle(node).backgroundColor,
						),
					).not.toBe(plain);
					await selected.hover();
					expect(await appearance()).toEqual(stable);
					await page.mouse.down();
					expect(
						await selected.evaluate((node) => getComputedStyle(node).opacity),
					).toBe("0.75");
					await page.screenshot({
						path: testInfo.outputPath(`states-${input}-${theme}-pressed.png`),
					});
					await page.mouse.move(380, 800);
					await page.mouse.up();
				} else {
					expect(
						await page.evaluate(() => matchMedia("(hover: hover)").matches),
					).toBe(false);
					await selected.tap();
					await expect(sidebar).toBeHidden();
					await open();
					expect(await appearance()).toEqual(stable);
					// A tapped trigger must not retain the mouse-only surface on touch input.
					expect(
						await menu.evaluate(
							(node) => getComputedStyle(node).backgroundColor,
						),
					).toBe(
						await sidebar.evaluate(
							(node) => getComputedStyle(node).backgroundColor,
						),
					);
				}
				await page.keyboard.press("Tab");
				await selected.focus();
				expect(
					await selected.evaluate((node) => node.matches(":focus-visible")),
				).toBe(true);
				expect(
					await selected.evaluate(
						(node) => getComputedStyle(node).outlineWidth,
					),
				).toBe("3px");
				expect(await appearance()).toEqual(stable);
				const box = (await selected.boundingBox())!;
				expect(box.height).toBeGreaterThanOrEqual(44);
				expect(box.x).toBeGreaterThanOrEqual(6);
				await page.screenshot({
					path: testInfo.outputPath(`states-${input}-${theme}-focused.png`),
				});
			}
		} finally {
			await context.close();
		}
	});

for (const width of [320, 390])
	test(`mobile viewport lifecycle and native text alignment at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 844 });
		const owner = {
			instance: "a".repeat(32),
			generation: "b".repeat(32),
			session: "Viewport fixture",
			project: "Layout",
			parent: "idle",
			background: "unobserved",
		};
		await page.route("**/api/snapshot", (route) =>
			route.fulfill({ json: { connection: "connected", sessions: [owner] } }),
		);
		await page.addInitScript((owner) => {
			class Source extends EventTarget {
				onopen = null;
				onerror = null;
				constructor() {
					super();
					queueMicrotask(() =>
						this.dispatchEvent(
							new MessageEvent("snapshot", {
								data: JSON.stringify({
									connection: "connected",
									sessions: [owner],
									selected: owner,
									snapshot: {
										...owner,
										items: [],
										truncated: false,
										omittedItems: 0,
									},
								}),
							}),
						),
					);
				}
				close() {}
			}
			Object.defineProperty(window, "EventSource", { value: Source });
			const viewport = Object.assign(new EventTarget(), {
				height: 844,
				offsetTop: 0,
				scale: 1,
			});
			Object.defineProperty(window, "visualViewport", { value: viewport });
			Object.defineProperty(window, "setViewportMetrics", {
				value: (
					height: number,
					offsetTop: number,
					event: string,
					scale = 1,
				) => {
					Object.assign(viewport, { height, offsetTop, scale });
					if (event === "resize" || event === "scroll")
						viewport.dispatchEvent(new Event(event));
					else if (event === "visibilitychange")
						document.dispatchEvent(new Event(event));
					else
						window.dispatchEvent(
							new Event(event === "window-resize" ? "resize" : event),
						);
				},
			});
		}, owner);
		await page.goto("/");
		await chooseSession(page, owner.instance);
		const draft = page.getByLabel("Text for selected Pi (local draft)");
		await page
			.getByLabel("Images for selected Pi (local picker)")
			.setInputFiles({ name: "local.png", mimeType: "image/png", buffer: png });
		await draft.fill("Hello Pi");
		async function metrics(
			height: number,
			top: number,
			event: string,
			scale = 1,
		) {
			await page.evaluate(
				({ height, top, event, scale }) =>
					(
						window as unknown as {
							setViewportMetrics: (
								h: number,
								t: number,
								e: string,
								s: number,
							) => void;
						}
					).setViewportMetrics(height, top, event, scale),
				{ height, top, event, scale },
			);
		}
		async function checkBounds(height: number, top: number) {
			await expect
				.poll(async () => (await page.locator("main").boundingBox())!.height)
				.toBe(height);
			const header = (await page.locator("header").boundingBox())!;
			const composer = (await page.locator(".composer").boundingBox())!;
			expect(header.y).toBeGreaterThanOrEqual(top);
			expect(header.y + header.height).toBeLessThanOrEqual(top + height);
			const gap = top + height - composer.y - composer.height;
			expect(gap).toBeGreaterThanOrEqual(0);
			expect(gap).toBeLessThanOrEqual(24);
			console.log(
				"VISIBLE_VIEWPORT_GEOMETRY",
				JSON.stringify({ width, height, top, header, composer, gap }),
			);
		}
		for (const textSize of ["100%", "125%"]) {
			await page.evaluate((size) => {
				document.documentElement.style.fontSize = size;
			}, textSize);
			for (const [height, top] of [
				[400, 42],
				[300, 64],
			]) {
				await metrics(height, top, "resize");
				await checkBounds(height, top);
				const alignment = await draft.evaluate((node) => {
					const box = node.getBoundingClientRect(),
						style = getComputedStyle(node);
					const control = document
						.querySelector(".attachment-picker")!
						.getBoundingClientRect();
					return {
						textCenter:
							box.y +
							parseFloat(style.paddingTop) +
							parseFloat(style.lineHeight) / 2,
						controlCenter: control.y + control.height / 2,
					};
				});
				expect(
					Math.abs(alignment.textCenter - alignment.controlCenter),
				).toBeLessThanOrEqual(1);
			}
		}
		// Crop to the declared usable visual viewport, not keyboard-occluded layout space.
		await page.screenshot({
			path: testInfo.outputPath(`keyboard-overlay-${width}.png`),
			clip: { x: 0, y: 64, width, height: 300 },
		});
		// The source only listened to visualViewport; these valid metrics must also
		// be reconciled when window/lifecycle events are the only notification.
		for (const event of ["window-resize", "pageshow", "visibilitychange"]) {
			await metrics(500, 20, "resize");
			await checkBounds(500, 20);
			await draft.blur();
			await metrics(844, 0, event);
			await checkBounds(844, 0);
		}
		await page.screenshot({
			path: testInfo.outputPath(`restored-fullheight-${width}.png`),
		});
		await metrics(300, 42, "resize", 2);
		await checkBounds(844, 0);
		await metrics(400, 42, "scroll");
		await checkBounds(400, 42);
		await metrics(844, 0, "resize");
		await draft.fill("First line\nSecond line");
		expect((await draft.boundingBox())!.height).toBeGreaterThan(44);
		await draft.fill("Wrapped native draft ".repeat(30));
		expect((await draft.boundingBox())!.height).toBe(136);
		await draft.evaluate((node) => {
			node.scrollTop = node.scrollHeight;
		});
		expect(await draft.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
		await draft.fill("Short again");
		expect((await draft.boundingBox())!.height).toBe(44);
	});

for (const width of [320, 390]) {
	test(`native tool summaries, diffs, progress and answer copy at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 844 });
		const identity = { instance: "a".repeat(32), generation: "b".repeat(32) };
		const summary = {
			...identity,
			project: "Review",
			session: "Native tools",
			parent: "working" as const,
			background: "unobserved" as const,
		};
		const snapshot: Snapshot = {
			...summary,
			truncated: false,
			model: "fixture/model",
			context: { tokens: 51_200, window: 128_000 },
			items: [
				{
					id: "answer",
					role: "assistant",
					blocks: [
						{ type: "text", text: "Review **these changes**." },
						{ type: "thinking", text: "Do not copy reasoning" },
						{ type: "text", text: "Keep the original spacing.  " },
					],
				},
				{
					id: "edit",
					role: "tool: edit",
					tool: {
						name: "edit",
						summary: "src/a-very-long-directory/".repeat(8) + "main.ts",
						state: "completed",
					},
					blocks: [
						{ type: "text", text: "Updated main.ts" },
						{
							type: "diff",
							text: '-1 const old = "<script>";\n+1 const next = "&safe";',
						},
					],
				},
				{
					id: "failure",
					role: "tool: bash",
					tool: { name: "bash", summary: "npm test", state: "error" },
					blocks: [
						{ type: "text", text: "Tests failed: expected 2, received 1" },
					],
				},
				{
					id: "active",
					role: "tool: read",
					tool: { name: "read", summary: "src/main.ts", state: "running" },
					blocks: [],
				},
				{
					id: "fences",
					role: "assistant",
					blocks: [
						{
							type: "text",
							text:
								'```typescript\nconst value = "<script>";\n```\n\n```unknown-language\nconst plain = 1;\n```\n\n```typescript\n' +
								"x".repeat(100_001) +
								"\n```",
						},
					],
				},
			],
		};
		await page.route("**/api/snapshot*", (route) =>
			route.fulfill({
				json: {
					connection: "connected",
					sessions: [summary],
					selected: identity,
					snapshot,
				},
			}),
		);
		await page.addInitScript(
			({ identity, summary, snapshot }) => {
				const sources = new Set<Source>();
				class Source extends EventTarget {
					constructor() {
						super();
						sources.add(this);
						queueMicrotask(() => this.emit());
					}
					close() {
						sources.delete(this);
					}
					emit() {
						this.dispatchEvent(
							new MessageEvent("snapshot", {
								data: JSON.stringify({
									connection: "connected",
									sessions: [summary],
									selected: identity,
									snapshot,
								}),
							}),
						);
					}
				}
				Object.defineProperty(window, "EventSource", { value: Source });
				Object.defineProperty(navigator, "clipboard", {
					configurable: true,
					value: {
						writeText: async (text: string) => {
							Object.defineProperty(window, "copiedAnswer", {
								configurable: true,
								value: text,
							});
						},
					},
				});
				Object.defineProperty(window, "finishTool", {
					value: () => {
						const item = snapshot.items.find((item) => item.id === "active")!;
						item.tool!.state = "completed";
						item.blocks = [
							{ type: "text", text: 'const ready = "<script>";\n' },
						];
						snapshot.context!.tokens = null;
						for (const source of sources) source.emit();
					},
				});
			},
			{ identity, summary, snapshot },
		);
		const posts: string[] = [];
		page.on("request", (request) => {
			if (request.method() === "POST") posts.push(request.url());
		});
		await page.goto(`/#session=${identity.instance}:${identity.generation}`);
		const answer = page.locator('[data-native-item="answer"]');
		const copy = answer.getByRole("button", {
			name: "Copy answer",
			exact: true,
		});
		await expect(copy).toHaveText("");
		await expect(copy.locator('svg[aria-hidden="true"]')).toHaveCount(1);
		await copy.scrollIntoViewIfNeeded();
		expect((await copy.boundingBox())!.width).toBeGreaterThanOrEqual(44);
		await copy.focus();
		await page.keyboard.press("Enter");
		await expect(answer.getByRole("status")).toHaveText("Copied");
		expect(
			await page.evaluate(
				() => (window as unknown as { copiedAnswer: string }).copiedAnswer,
			),
		).toBe("Review **these changes**.\n\nKeep the original spacing.  ");
		expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		expect(
			await copy.evaluate((node) => getComputedStyle(node).outlineStyle),
		).not.toBe("none");
		await page.evaluate(() =>
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: {
					writeText: async () => {
						throw Error("Denied");
					},
				},
			}),
		);
		await copy.click();
		await expect(answer.getByRole("status")).toHaveText(
			"Copy failed — select answer to copy.",
		);
		const edit = page.locator('[data-native-item="edit"]');
		await expect(edit.locator("summary")).toContainText("Edit");
		await expect(edit.locator(".tool-summary")).toHaveText("main.ts");
		await expect(edit.locator(".tool-summary")).toHaveAttribute(
			"title",
			snapshot.items[1].tool!.summary,
		);
		await edit.locator("summary").focus();
		await page.keyboard.press("Enter");
		await expect(edit.locator(".diff-added")).toHaveText(
			'+1 const next = "&safe";',
		);
		await expect(edit.locator(".diff-deleted")).toHaveText(
			'-1 const old = "<script>";',
		);
		await expect(edit.locator("script")).toHaveCount(0);
		await expect(
			edit.locator(".tool-output").first().locator('[class^="hljs-"]'),
		).toHaveCount(0);
		await expect(edit.locator(".diff-added .hljs-keyword")).toHaveText("const");
		await expect(edit.locator(".diff-deleted .hljs-string")).toHaveText(
			'"<script>"',
		);
		await expect(
			page.locator('[data-native-item="failure"] .tool-error-preview'),
		).toHaveText("Tests failed: expected 2, received 1");
		await expect(edit.locator(".tool-detail-summary")).toHaveText(
			snapshot.items[1].tool!.summary,
		);
		await edit.locator(".tool-detail-summary").focus();
		expect(
			await edit
				.locator(".tool-detail-summary")
				.evaluate((node) => getComputedStyle(node).outlineStyle),
		).not.toBe("none");
		await expect(page.locator(".conversation-metadata")).toHaveText(
			"fixture/modelContext ~40% · 128,000 token limit",
		);
		const active = page.locator('[data-native-item="active"]');
		await expect(active.locator(".tool-state")).toHaveText("Running");
		await page.evaluate(() =>
			(window as unknown as { finishTool: () => void }).finishTool(),
		);
		await expect(active.locator(".tool-state")).toHaveText("Done");
		await expect(page.locator(".conversation-metadata")).toHaveText(
			"fixture/modelContext unknown · 128,000 token limit",
		);
		await active.locator("summary").click();
		await expect(active.locator(".tool-output")).toHaveText(
			'const ready = "<script>";\n',
			{ useInnerText: false },
		);
		await expect(active.locator(".hljs-keyword")).toHaveText("const");
		await expect(
			page.locator('[data-native-item="failure"] [class^="hljs-"]'),
		).toHaveCount(0);
		const fences = page.locator('[data-native-item="fences"] .code-block');
		await expect(fences.nth(0).locator(".hljs-keyword")).toHaveText("const");
		await expect(fences.nth(0).locator("pre")).toHaveText(
			'const value = "<script>";\n',
			{ useInnerText: false },
		);
		await expect(fences.nth(1).locator('[class^="hljs-"]')).toHaveCount(0);
		await expect(fences.nth(2).locator('[class^="hljs-"]')).toHaveCount(0);
		await expect(fences.nth(2).locator("pre")).toHaveText(
			"x".repeat(100_001) + "\n",
			{ useInnerText: false },
		);
		await expect(page.locator(".conversation script")).toHaveCount(0);
		for (const colorScheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme });
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "125%";
			});
			await edit.locator("summary").scrollIntoViewIfNeeded();
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			const heading = await edit.locator("summary").boundingBox();
			expect(heading!.x).toBeGreaterThanOrEqual(0);
			expect(heading!.x + heading!.width).toBeLessThanOrEqual(width);
			expect(heading!.height).toBeGreaterThanOrEqual(44);
			const added = await edit
				.locator(".diff-added")
				.evaluate((node) => getComputedStyle(node).backgroundColor);
			const deleted = await edit
				.locator(".diff-deleted")
				.evaluate((node) => getComputedStyle(node).backgroundColor);
			expect(added).not.toBe(deleted);
			expect(
				await edit
					.locator(".diff-added .hljs-keyword")
					.evaluate((node) => getComputedStyle(node).color),
			).not.toBe(
				await edit
					.locator(".diff-added")
					.evaluate((node) => getComputedStyle(node).color),
			);
			await page.screenshot({
				path: testInfo.outputPath(`native-tools-${width}-${colorScheme}.png`),
			});
		}
		expect(posts).toEqual([]);
	});
}
