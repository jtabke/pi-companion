import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "tests",
	testMatch: "browser.spec.ts",
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
	},
});
