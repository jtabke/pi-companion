// Invoked only by the opt-in isolated real-pi.py --input/--image harness.
import { normalizeImage } from "../dist/gateway/upload.js";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chooseSession } from "./choose-session.mjs";

const [mode, root] = process.argv.slice(2);
if (!["send", "recover"].includes(mode))
	throw Error("fixed input mode required");
const imageMode = process.env.C4_IMAGE === "1",
	stopMode = process.env.C4_STOP === "1",
	routePath = stopMode ? "/api/stop" : imageMode ? "/api/image" : "/api/text";
const base = "http://127.0.0.1:4394",
	directory = join(root, "a");
const records = () =>
	JSON.parse(readFileSync(join(directory, "first-evidence.json"), "utf8"));
const turns = () => records().filter((r) => r.type === "native_input").length;
const browser = await chromium.launch();
try {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	await context.addCookies([
		{
			name: "c2",
			value: process.env.C2_TEST_COOKIE.split("=")[1],
			url: base,
			httpOnly: true,
			sameSite: "Strict",
		},
	]);
	const page = await context.newPage();
	await page.goto(base);
	await page.getByRole("button", { name: /^Open sessions:/ }).waitFor();
	const list = await (await context.request.get(base + "/api/snapshot")).json();
	const identity = {
		instance: list.sessions[0].instance,
		generation: list.sessions[0].generation,
	};
	await chooseSession(page, identity.instance);
	await page
		.getByRole("button", { name: "Take control", exact: true })
		.waitFor();
	const post = (path, body) =>
		context.request.post(base + path, {
			headers: { Origin: base, "x-c2-csrf": "input" },
			data: body,
		});
	const before = turns();
	const unauthorized = await post("/api/text", {
		...identity,
		lease: "0".repeat(64),
		requestId: "0".repeat(32),
		text: "must not send",
	});
	if (unauthorized.status() !== 409 || turns() !== before)
		throw Error("uncontrolled native request invoked");
	const claim = page.waitForResponse(
		(r) =>
			r.url().endsWith("/api/control") &&
			r.request().postDataJSON().action === "claim",
	);
	await page.getByRole("button", { name: "Take control", exact: true }).click();
	const lease = (await (await claim).json()).lease;
	const bodies = [];
	page.on("request", (r) => {
		if (r.url().endsWith(routePath)) bodies.push(r.postDataJSON());
	});
	if (stopMode) {
		let original;
		const view = async () =>
			(
				await context.request.get(
					`${base}/api/snapshot?instance=${identity.instance}&generation=${identity.generation}`,
				)
			).json();
		if (mode === "send") {
			await page
				.getByLabel("Text for selected Pi (local draft)")
				.fill(process.env.C1M_TAG + ":native-read");
			await page.getByRole("button", { name: "Send", exact: true }).click();
			for (
				let i = 0;
				i < 200 && !records().some((r) => r.type === "held_response");
				i++
			)
				await page.waitForTimeout(50);
			if (
				!records().some((r) => r.type === "held_response") ||
				records().some((r) => r.type === "settled")
			)
				throw Error("native response not held");
			await page
				.getByLabel("Text for selected Pi (local draft)")
				.fill("Preserved stop draft");
			await page
				.getByLabel("Images for selected Pi (local picker)")
				.setInputFiles({
					name: "unsent.png",
					mimeType: "image/png",
					buffer: readFileSync(join(directory, "cwd", "fixture.png")),
				});
			const reader = await context.newPage();
			await reader.goto(base);
			await chooseSession(reader, identity.instance);
			if (
				await reader
					.getByRole("button", { name: "Stop", exact: true })
					.isEnabled()
			)
				throw Error("read-only native Stop enabled");
			await reader.close();
			await chooseSession(page, "");
			await page.waitForTimeout(2100);
			if (records().some((r) => r.type === "provider_aborted") || bodies.length)
				throw Error(
					"departure/switch automatically aborted held native response",
				);
			await chooseSession(page, identity.instance);
			await page
				.getByRole("button", { name: "Take control", exact: true })
				.click();
			await page.getByRole("button", { name: "Release control" }).waitFor();
			await page.route(
				"**/api/stop",
				async (route) => {
					await route.fetch();
					await route.abort();
				},
				{ times: 1 },
			);
			await page.getByRole("button", { name: "Stop", exact: true }).click();
			await page.getByText(/Stop: Uncertain — response lost/).waitFor();
			for (
				let i = 0;
				i < 200 && !records().some((r) => r.type === "settled");
				i++
			)
				await page.waitForTimeout(50);
			const settled = records().find((r) => r.type === "settled");
			if (
				!settled ||
				!settled.parentIdle ||
				settled.pending ||
				settled.requests !== 2 ||
				settled.toolCalls !== 1 ||
				settled.inputs !== 1
			)
				throw Error("native parent settlement missing");
			await page
				.locator("header")
				.getByText("Stopped (observed)", { exact: true })
				.waitFor();
			await page.waitForTimeout(2100);
			if (bodies.length !== 1) throw Error("automatic Stop retry");
			await page
				.getByRole("button", { name: "Retry same Stop request" })
				.click();
			await page.getByText(/Stop: Forwarded; completion unconfirmed/).waitFor();
			if (bodies.length !== 2 || bodies[0].requestId !== bodies[1].requestId)
				throw Error("Stop identity changed");
			if (
				(await page
					.getByLabel("Text for selected Pi (local draft)")
					.inputValue()) !== "Preserved stop draft"
			)
				throw Error("Stop erased draft");
			await page
				.getByRole("img", { name: "Local attachment preview" })
				.waitFor();
			original = bodies[0];
			writeFileSync(
				join(root, "input-request.json"),
				JSON.stringify({ ...identity, requestId: original.requestId }),
				{ mode: 0o600 },
			);
			await page.screenshot({
				path: "test-results/real-pi-stop.png",
				fullPage: true,
			});
		} else {
			original = JSON.parse(
				readFileSync(join(root, "input-request.json"), "utf8"),
			);
			if (
				original.instance !== identity.instance ||
				original.generation !== identity.generation
			)
				throw Error("Stop owner replaced");
			await page.waitForTimeout(2100);
			if (
				bodies.length ||
				records().filter((r) => r.type === "provider_aborted").length !== 1
			)
				throw Error("restart auto-aborted");
			if (
				(await (await post("/api/stop", { ...original, lease })).json())
					.status !== "dispatched"
			)
				throw Error("restart lost Stop receipt");
			if (
				(await view()).sessions.find((s) => s.instance === identity.instance)
					.stop !== "parent-settled"
			)
				throw Error("restart lost native observation");
		}
		if (
			turns() !== 1 ||
			records().filter((r) => r.type === "provider_aborted").length !== 1
		)
			throw Error("Stop reinvoked/extra input");
		if (
			(
				await post("/api/stop", {
					...original,
					lease,
					generation: "f".repeat(32),
				})
			).status() !== 409
		)
			throw Error("stale Stop admitted");
		if (
			(
				await post("/api/stop", { ...original, lease: "0".repeat(64) })
			).status() !== 409
		)
			throw Error("uncontrolled Stop admitted");
		const publicView = JSON.stringify(await view());
		if (
			publicView.includes(lease) ||
			(await page.evaluate(() => localStorage.length + sessionStorage.length))
		)
			throw Error("Stop authority persisted/leaked");
		await context.close();
		console.log(
			JSON.stringify({
				mode,
				realHeldProviderAbort: true,
				publicParentSettledIdleNoPending: true,
				explicitStopViaBrowser: mode === "send",
				lostResponseSameIdDedup: true,
				gatewayRestartNativeObservationAndReceipt: mode === "recover",
				draftAttachmentPreserved: mode === "send",
				heldNativeSurvivesReaderDepartureAndSwitch: mode === "send",
				nativeInputs: 1,
				fixedResponses: 2,
				nativeReads: 1,
				providerAborts: 1,
			}),
		);
	} else {
		let original;
		if (mode === "send") {
			await page
				.getByLabel("Text for selected Pi (local draft)")
				.fill(process.env.C1M_TAG + ":native-read");
			if (imageMode) {
				const source = readFileSync(join(directory, "cwd", "fixture.png"));
				const normalized = await normalizeImage(
					{ source: source.toString("base64"), mime: "image/png" },
					() => false,
				);
				writeFileSync(
					join(directory, "submitted-normalized.png"),
					Buffer.from(normalized.image, "base64"),
					{ mode: 0o600 },
				);
				await page
					.getByLabel("Images for selected Pi (local picker)")
					.setInputFiles({
						name: "feedback.png",
						mimeType: "image/png",
						buffer: source,
					});
				await page
					.getByRole("img", { name: "Local attachment preview" })
					.waitFor();
				if (bodies.length) throw Error("picker automatically uploaded");
			}
			await page.route(
				"**" + routePath,
				async (route) => {
					await route.fetch();
					await route.abort();
				},
				{ times: 1 },
			);
			await page.getByRole("button", { name: "Send", exact: true }).click();
			await page
				.getByText(/Uncertain — response lost; no automatic retry/)
				.waitFor();
			for (
				let i = 0;
				i < 200 && !records().some((r) => r.type === "settled");
				i++
			)
				await page.waitForTimeout(50);
			const settled = records().find((r) => r.type === "settled");
			if (
				!settled ||
				settled.requests !== 2 ||
				settled.toolCalls !== 1 ||
				settled.inputs !== 1 ||
				turns() !== 1
			)
				throw Error("native fixed turn missing");
			await page.waitForTimeout(2100);
			if (bodies.length !== 1 || turns() !== 1) throw Error("automatic resend");
			await page
				.getByRole("button", { name: "Retry same outstanding input" })
				.click();
			await page.getByText(/Forwarded; completion unconfirmed/).waitFor();
			if (
				bodies.length !== 2 ||
				bodies[0].requestId !== bodies[1].requestId ||
				bodies[0].text !== bodies[1].text ||
				(imageMode &&
					(JSON.stringify(bodies[0].images) !==
						JSON.stringify(bodies[1].images) ||
						bodies[0].images[0].mime !== bodies[1].images[0].mime)) ||
				turns() !== 1
			)
				throw Error("retry not native-deduplicated");
			original = bodies[0];
			writeFileSync(
				join(root, "input-request.json"),
				JSON.stringify({
					...identity,
					requestId: original.requestId,
					text: original.text,
					...(imageMode ? { images: original.images } : {}),
				}),
				{ mode: 0o600 },
			);
			await page
				.getByRole("img", { name: /^Native Pi image \d+$/, exact: true })
				.first()
				.waitFor();
			await page
				.getByText(process.env.C1M_TAG + ":native-read", { exact: true })
				.waitFor();
			const view = await (
				await context.request.get(
					`${base}/api/snapshot?instance=${identity.instance}&generation=${identity.generation}`,
				)
			).json();
			const nativeRead = view.snapshot.items.find((i) =>
				i.id.endsWith(":" + settled.branch.resultEntryId),
			);
			const ref = nativeRead.blocks.find((b) => b.type === "image").ref;
			const bytes = await (
				await context.request.get(
					`${base}/api/media/${identity.instance}/${identity.generation}/${ref}`,
				)
			).body();
			if (!bytes.equals(readFileSync(join(directory, "cwd", "fixture.png"))))
				throw Error("native browser read image mismatch");
			if (imageMode) {
				const expected = readFileSync(
					join(directory, "submitted-normalized.png"),
				);
				const hash = createHash("sha256").update(expected).digest("hex");
				const input = records().find((r) => r.type === "native_input"),
					provider = records().find((r) => r.type === "provider_image");
				if (
					input?.submittedSha256 !== hash ||
					provider?.submittedSha256 !== hash ||
					settled.branch.submittedSha256 !== hash ||
					original.images[0].source !==
						readFileSync(join(directory, "cwd", "fixture.png")).toString(
							"base64",
						)
				)
					throw Error("public input/provider/branch image relation failed");
				const user = view.snapshot.items.find((i) =>
					i.id.endsWith(":" + settled.branch.userEntryId),
				);
				const image = user?.blocks.find((b) => b.type === "image");
				if (!image) throw Error("same native user image missing from browser");
				const userBytes = await (
					await context.request.get(
						`${base}/api/media/${identity.instance}/${identity.generation}/${image.ref}`,
					)
				).body();
				if (!userBytes.equals(expected))
					throw Error("native user/view bytes differ");
			}
			await page.screenshot({
				path: imageMode
					? "test-results/real-pi-image.png"
					: "test-results/real-pi-input.png",
				fullPage: true,
			});
		} else {
			original = JSON.parse(
				readFileSync(join(root, "input-request.json"), "utf8"),
			);
			if (
				original.instance !== identity.instance ||
				original.generation !== identity.generation ||
				turns() !== 1
			)
				throw Error("restart identity/turn changed");
			await page.waitForTimeout(2100);
			if (bodies.length || turns() !== 1)
				throw Error("pair/claim/reconnect resent input");
			const receipt = await (
				await post(routePath, { ...original, lease })
			).json();
			if (receipt.status !== "dispatched" || turns() !== 1)
				throw Error("gateway restart lost native dedup");
		}
		const body = {
			instance: identity.instance,
			generation: identity.generation,
			requestId: original.requestId,
			text: original.text,
			lease,
			...(imageMode ? { images: original.images } : {}),
		};
		if (
			(await (await post(routePath, { ...body, text: "mismatched" })).json())
				.reason !== "mismatch"
		)
			throw Error("native mismatched ID invoked");
		const tab = await context.newPage();
		await tab.goto(base);
		await chooseSession(tab, identity.instance);
		await tab
			.getByRole("button", { name: "Take over browser control", exact: true })
			.click();
		await tab.getByRole("button", { name: "Release control" }).waitFor();
		if (
			(
				await post(routePath, { ...body, requestId: "1".repeat(32) })
			).status() !== 409
		)
			throw Error("revoked lease dispatched");
		if (
			(
				await post(routePath, {
					...body,
					generation: "2".repeat(32),
					requestId: "3".repeat(32),
				})
			).status() !== 409
		)
			throw Error("stale generation dispatched");
		if (
			turns() !== 1 ||
			records().some((r) => ["failure", "stream_error"].includes(r.type))
		)
			throw Error("rejected request invoked native turn");
		const publicView = await (
			await context.request.get(base + "/api/snapshot")
		).text();
		if (
			publicView.includes(lease) ||
			page.url().includes(lease) ||
			(await page.locator("body").innerText()).includes(lease) ||
			(await page.evaluate(() => localStorage.length + sessionStorage.length))
		)
			throw Error("public authority leak");
		await tab.close();
		await context.close();
		console.log(
			JSON.stringify({
				mode,
				...(imageMode
					? {
							originalSourceRetry: true,
							normalizedPublicInputProviderBranchViewRelation: true,
							nativeUserImages: 1,
						}
					: {}),
				nativeInputs: 1,
				fixedResponses: 2,
				nativeReads: 1,
				publicSendViaBrowser: mode === "send",
				lostResponseNoAutomaticResend: true,
				explicitIdenticalRetryDeduplicated: true,
				uncontrolledStaleRevokedTurns: 0,
				browserAuthorityPrivate: true,
				dispatchedOutcomeUnconfirmed: true,
			}),
		);
	}
} finally {
	await browser.close();
}

delete process.env.C2_TEST_COOKIE;
