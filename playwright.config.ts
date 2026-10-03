import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
if (process.env.C2_PAIR_SOCKET === undefined) {
	let socket: string;
	do {
		socket = join(
			"/tmp",
			`c2-pair-${randomBytes(8).toString("hex")}`,
			"issue.sock",
		);
	} while (existsSync(dirname(socket)));
	process.env.C2_PAIR_SOCKET = socket;
}
export default defineConfig({
	testDir: "tests",
	testMatch: ["browser.spec.ts", "chat-layout.spec.ts", "pwa.spec.ts"],
	fullyParallel: false,
	workers: 1,
	use: { baseURL: "http://127.0.0.1:4393", trace: "off" },
	projects: [
		{ name: "chromium", use: { browserName: "chromium" } },
		{ name: "webkit", use: { browserName: "webkit" } },
	],
	webServer: {
		command: "node tests/browser-fixture.mjs",
		url: "http://127.0.0.1:4393",
		reuseExistingServer: false,
		gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
	},
});
