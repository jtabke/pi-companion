import { expect } from "@playwright/test";

// Select a visible row using the public, newest-first session observations.
/**
 * @param {import("@playwright/test").Page} page
 * @param {string} instance Empty means Leave session.
 */
export async function chooseSession(page, instance) {
	const dialog = page.getByRole("dialog", { name: "Live sessions" });
	if (!(await dialog.isVisible()))
		await page.getByRole("button", { name: /^Open sessions:/ }).click();
	if (!instance) {
		await dialog
			.getByRole("button", { name: "Leave session", exact: true })
			.click();
		await expect(dialog).toBeHidden();
		await expect.poll(() => new URL(page.url()).hash).toBe("");
		return;
	}
	const { sessions } = await page.evaluate(async () => {
		const response = await fetch("/api/snapshot");
		if (!response.ok) throw Error("Session observations unavailable");
		return response.json();
	});
	const owner = sessions.find((session) => session.instance === instance);
	if (!owner) throw Error(`Session ${instance} unavailable`);
	const directory = dialog.getByRole("region", {
		name: owner.cwd || "Working directory unavailable",
		exact: true,
	});
	const peers = sessions.filter(
		(session) =>
			(session.cwd || "") === (owner.cwd || "") &&
			session.session === owner.session &&
			session.project === owner.project,
	);
	// Indistinguishable names use their observed order within the exact directory.
	const row = directory
		.getByRole("group", {
			name: `${owner.session} · ${owner.project}`,
			exact: true,
		})
		.nth(peers.findIndex((session) => session.instance === instance));
	await row
		.getByRole("button", {
			name: new RegExp(
				`^${RegExp.escape(`${owner.session} ${owner.project} `)}`,
			),
		})
		.click();
	await expect(dialog).toBeHidden();
	await expect
		.poll(() =>
			new URLSearchParams(new URL(page.url()).hash.slice(1)).get("session"),
		)
		.toBe(`${owner.instance}:${owner.generation}`);
}
