// Opt-in source-loaded real TUI harness client. Only production browser/HTTP surfaces.
import { createInterface } from "node:readline";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium, expect } from "@playwright/test";

import { chooseSession } from "./choose-session.mjs";

const runtime = process.argv[2],
	port = 4395;
let gateway,
	gatewayExit,
	pairingCode,
	browser,
	context,
	page,
	reader,
	original,
	generation;
const gatewayExits = [];
const baseURL = `http://127.0.0.1:${port}`;
const headers = { origin: baseURL, "x-c2-csrf": "input" };
async function start() {
	gateway = spawn(
		process.execPath,
		[join(process.cwd(), "dist/gateway/cli.js")],
		{
			cwd: process.cwd(),
			env: {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				TMPDIR: process.env.TMPDIR,
				C2_RUNTIME: runtime,
				C2_AUTH_DIR: join(runtime, "auth"),
				C2_PORT: String(port),
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	gatewayExit = new Promise((resolve) =>
		gateway.once("exit", (code, signal) => {
			gatewayExits.push({ code, signal });
			resolve({ code, signal });
		}),
	);
	await new Promise((resolve, reject) => {
		let output = "";
		const timeout = setTimeout(
			() => reject(Error("Gateway startup deadline")),
			10000,
		);
		gateway.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		gateway.once("exit", () => {
			clearTimeout(timeout);
			reject(Error("Gateway exited before ready"));
		});
		gateway.stderr.on("data", () => {}); // Never forward credential-bearing startup text to ordinary logs.
		gateway.stdout.on("data", (chunk) => {
			output += chunk.toString();
			if (output.length > 4096) {
				clearTimeout(timeout);
				reject(Error("Gateway startup output limit"));
				return;
			}
			const match = /Pairing code \(submit in browser\): ([0-9]{6})/.exec(
				output,
			);
			if (match) {
				pairingCode = match[1];
				output = "";
				clearTimeout(timeout);
				resolve();
			}
		});
	});
}
async function stopGateway() {
	if (!gateway || gateway.exitCode !== null || gateway.signalCode !== null)
		return;
	gateway.kill("SIGTERM");
	let timer;
	try {
		const result = await Promise.race([
			gatewayExit,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(Error("Gateway shutdown deadline")),
					5000,
				);
			}),
		]);
		if (result.code !== 0 || result.signal !== null)
			throw Error("Gateway did not shut down cleanly");
	} catch (error) {
		gateway.kill("SIGKILL");
		await gatewayExit;
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
async function pair() {
	await page.goto("/");
	if (pairingCode) {
		await page.getByLabel("Pairing code").fill(pairingCode);
		await page.getByLabel("Remember this device").uncheck();
		await page.getByRole("button", { name: "Pair this device" }).click();
		pairingCode = undefined;
	}
	await expect(
		page.getByRole("button", { name: /^Open sessions:/ }),
	).toBeVisible();
	const list = await (
		await context.request.get(`${baseURL}/api/snapshot`)
	).json();
	generation = list.sessions[0];
	await chooseSession(page, generation.instance);
	await page.getByRole("button", { name: "Take control", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Release control" }),
	).toBeVisible();
}
async function post(reply, identity = generation) {
	// Fresh private tab-independent control for deliberate HTTP boundary assertions.
	const control = await context.request.post(`${baseURL}/api/control`, {
		headers,
		data: {
			instance: generation.instance,
			generation: generation.generation,
			action: "takeover",
		},
	});
	const { lease } = await control.json();
	const response = await context.request.post(`${baseURL}/api/question-reply`, {
		headers,
		data: {
			instance: identity.instance,
			generation: identity.generation,
			lease,
			reply,
		},
	});
	return { code: response.status(), body: await response.json() };
}
async function reclaim() {
	await expect(
		page.getByRole("button", {
			name: "Take over browser control",
			exact: true,
		}),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Take over browser control", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Release control" }),
	).toBeVisible();
}
async function action(name) {
	if (name === "observe") {
		await page
			.getByRole("button", { name: "Review questions", exact: true })
			.click();
		await page.getByText("Preview: Browser", { exact: true }).click();
		await expect(
			page.locator('form[aria-label="Pending questionnaire"]'),
		).toHaveCount(1);
		await expect(page.getByText("browser preview content")).toBeVisible();
		const view = await (
			await context.request.get(
				`${baseURL}/api/snapshot?instance=${generation.instance}&generation=${generation.generation}`,
			)
		).json();
		const previous = original;
		original = {
			identity: {
				instance: generation.instance,
				generation: generation.generation,
			},
			request: view.questions.pending[0],
		};
		if (
			previous &&
			previous.request.invocationId !== original.request.invocationId &&
			previous.identity.generation === generation.generation
		) {
			const stale = await post({
				invocationId: previous.request.invocationId,
				replyId: "stale-during-another-live-invocation",
				cancelled: false,
				answers: [{ questionIndex: 0, kind: "option", answer: "Browser" }],
			});
			if (stale.code !== 200 || stale.body.status !== "not-pending")
				throw Error("Stale reply targeted another live invocation");
			await reclaim();
			await expect(
				page.locator('form[aria-label="Pending questionnaire"]'),
			).toHaveCount(1);
			return { ...original, priorInvocationRejectedWhileNewPending: true };
		}
		return original;
	}
	if (name === "invalid") {
		const result = await post({
			invocationId: original.request.invocationId,
			replyId: "invalid-live-browser",
			cancelled: false,
			answers: [{ questionIndex: 0, kind: "option", answer: "not authored" }],
		});
		if (result.code !== 200 || result.body.status !== "invalid")
			throw Error("Invalid did not leave pending");
		await reclaim();
		await expect(
			page.locator('form[aria-label="Pending questionnaire"]'),
		).toHaveCount(1);
		return result;
	}
	if (name === "answer") {
		await page
			.getByRole("button", { name: "Review questions", exact: true })
			.click();
		await page.getByLabel("Browser", { exact: true }).check();
		await page.getByRole("button", { name: "Submit questionnaire" }).click();
		await expect(
			page.getByText(
				/Answer completed — confirmed by live questionnaire callback/,
			),
		).toBeVisible();
		await expect(
			page.locator('form[aria-label="Pending questionnaire"]'),
		).toHaveCount(0);
		return { browserCompletion: "accepted-same-callback" };
	}
	if (name === "departure-switch") {
		reader = await context.newPage();
		await reader.goto(baseURL);
		await chooseSession(reader, generation.instance);
		await expect(
			reader.getByRole("button", {
				name: "Submit questionnaire",
				includeHidden: true,
			}),
		).toBeDisabled();
		await reader.close();
		reader = undefined;
		await chooseSession(page, "");
		await expect(
			page.locator('form[aria-label="Pending questionnaire"]'),
		).toHaveCount(0);
		await chooseSession(page, generation.instance);
		await page
			.getByRole("button", { name: "Take control", exact: true })
			.click();
		await expect(
			page.locator('form[aria-label="Pending questionnaire"]'),
		).toHaveCount(1);
		return { readerDeparted: true, switchDidNotCancel: true };
	}
	if (name === "depart") {
		await page.close();
		page = undefined;
		return { controllerDeparted: true };
	}
	if (name === "reopen") {
		page = await context.newPage();
		await pair();
		return { reattached: true };
	}
	if (name === "restart") {
		const id = original.request.invocationId;
		const priorPid = gateway.pid;
		await stopGateway();
		await start();
		if (gateway.pid === priorPid)
			throw Error("Gateway process was not replaced");
		await expect(page.getByLabel("Pairing code")).toBeVisible();
		if (pairingCode) {
			await page.getByLabel("Pairing code").fill(pairingCode);
			await page.getByLabel("Remember this device").uncheck();
			await page.getByRole("button", { name: "Pair this device" }).click();
			pairingCode = undefined;
		}
		await page
			.getByRole("button", { name: "Take control", exact: true })
			.click();
		const next = await action("observe");
		if (next.request.invocationId !== id)
			throw Error("Restart redirected invocation");
		return {
			sameInvocationAfterGatewayRestart: true,
			distinctGatewayProcess: true,
		};
	}
	if (name === "closed-stale") {
		if (page)
			await expect(
				page.locator('form[aria-label="Pending questionnaire"]'),
			).toHaveCount(0);
		const result = await post({
			invocationId: original.request.invocationId,
			replyId: "late-live-browser",
			cancelled: false,
			answers: [{ questionIndex: 0, kind: "option", answer: "Browser" }],
		});
		if (result.code !== 200 || result.body.status !== "not-pending")
			throw Error("Stale was not rejected");
		if (page) await reclaim();
		return result;
	}
	if (name === "reload-stale") {
		const old = original.identity;
		await expect
			.poll(async () => {
				const value = (
					await (await context.request.get(`${baseURL}/api/snapshot`)).json()
				).sessions[0]?.generation;
				return !!value && value !== old.generation;
			})
			.toBe(true);
		const list = await (
			await context.request.get(`${baseURL}/api/snapshot`)
		).json();
		generation = list.sessions[0];
		const result = await post(
			{
				invocationId: original.request.invocationId,
				replyId: "old-generation-browser",
				cancelled: false,
				answers: [],
			},
			old,
		);
		if (result.code !== 409) throw Error("Old generation forwarded");
		return { oldGenerationRejected: true, ...result };
	}
	if (name === "shutdown") {
		await expect(
			page.locator('form[aria-label="Pending questionnaire"]'),
		).toHaveCount(0);
		return { pendingOwnerShutdownSafe: true };
	}
	throw Error("Unknown harness action");
}
let failed = false,
	closing;
const lines = createInterface({ input: process.stdin });
function cleanup() {
	if (!closing)
		closing = (async () => {
			lines.close();
			pairingCode = undefined;
			await reader?.close();
			await context?.close();
			await browser?.close();
			await stopGateway();
			return {
				browserClosed: !browser?.isConnected(),
				gatewayClosed:
					!gateway || gateway.exitCode !== null || gateway.signalCode !== null,
				gatewayChildrenReaped: gatewayExits.every(
					(exit) => exit.code === 0 && exit.signal === null,
				),
				lockReleased: true,
			};
		})();
	return closing;
}
process.once("SIGTERM", () => {
	void cleanup().then((result) => {
		console.log(JSON.stringify({ cleanup: result }));
		process.exit(143);
	});
});

try {
	await start();
	browser = await chromium.launch({ headless: true });
	context = await browser.newContext({
		baseURL,
		viewport: { width: 390, height: 844 },
	});
	page = await context.newPage();
	await pair();
	console.log(JSON.stringify({ ready: true }));
	for await (const line of lines) {
		const { action: name } = JSON.parse(line);
		if (name === "finish") break;
		try {
			console.log(JSON.stringify({ action: name, result: await action(name) }));
		} catch (error) {
			failed = true;
			console.log(
				JSON.stringify({ action: name, error: "Harness action failed" }),
			);
			break;
		}
	}
} catch (error) {
	failed = true;
	console.log(JSON.stringify({ error: "Harness action failed" }));
} finally {
	console.log(JSON.stringify({ cleanup: await cleanup(), gatewayExits }));
}
process.exitCode = failed ? 1 : 0;
