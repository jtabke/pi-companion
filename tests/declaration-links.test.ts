import { afterEach, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const python = execFileSync("which", ["python3"], { encoding: "utf8" }).trim();
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture(piVersion = "0.99.2", aiVersion = "0.99.2") {
	const root = mkdtempSync(join(tmpdir(), "companion-types-"));
	roots.push(root);
	const checkout = join(root, "checkout"),
		host = join(root, "host"),
		bin = join(root, "bin");
	for (const dir of [
		join(checkout, "scripts"),
		join(checkout, "node_modules"),
		join(host, "dist"),
		bin,
	])
		mkdirSync(dir, { recursive: true });
	copyFileSync(
		resolve("scripts/link-pi-declarations.py"),
		join(checkout, "scripts/link-pi-declarations.py"),
	);
	const piMeta = join(host, "package.json"),
		ai = join(host, "node_modules/@earendil-works/pi-ai");
	mkdirSync(ai, { recursive: true });
	writeFileSync(
		piMeta,
		JSON.stringify({
			name: "@earendil-works/pi-coding-agent",
			version: piVersion,
		}),
	);
	writeFileSync(
		join(ai, "package.json"),
		JSON.stringify({ name: "@earendil-works/pi-ai", version: aiVersion }),
	);
	const cli = join(host, "dist/cli.js");
	writeFileSync(cli, "#!/bin/sh\nexit 99\n");
	chmodSync(cli, 0o700);
	symlinkSync(cli, join(bin, "pi"));
	const scope = join(checkout, "node_modules/@earendil-works");
	const run = (path = bin) =>
		spawnSync(
			python,
			["-B", join(checkout, "scripts/link-pi-declarations.py")],
			{
				cwd: root,
				env: { ...process.env, PATH: path },
				encoding: "utf8",
			},
		);
	return { root, host, ai, piMeta, scope, run };
}

it.each(["0.99.2", "1.0.1"])(
	"links reviewed %s declarations, is idempotent, and does not run or modify host Pi",
	(version) => {
		const f = fixture(version, version),
			before = readFileSync(f.piMeta, "utf8");
		expect(f.run().status).toBe(0);
		expect(realpathSync(join(f.scope, "pi-coding-agent"))).toBe(
			realpathSync(f.host),
		);
		expect(realpathSync(join(f.scope, "pi-ai"))).toBe(realpathSync(f.ai));
		expect(f.run().status).toBe(0);
		expect(readFileSync(f.piMeta, "utf8")).toBe(before);
	},
);
it.each([
	["0.99.1", "0.99.2"],
	["0.99.2", "0.99.1"],
	["1.0.2", "1.0.2"],
	["1.0.1", "0.99.2"],
])("refuses unreviewed host versions (%s, %s) before linking", (pi, ai) => {
	const f = fixture(pi, ai);
	expect(f.run().status).not.toBe(0);
	expect(existsSync(f.scope)).toBe(false);
});
it("refuses an existing local package before creating the other link", () => {
	const f = fixture(),
		existing = join(f.scope, "pi-ai");
	mkdirSync(existing, { recursive: true });
	writeFileSync(join(existing, "sentinel"), "preserve");
	const result = f.run();
	expect(result.status).not.toBe(0);
	expect(result.stderr).toContain("Refusing to replace");
	expect(existsSync(join(f.scope, "pi-coding-agent"))).toBe(false);
	expect(readFileSync(join(existing, "sentinel"), "utf8")).toBe("preserve");
});
it("refuses a different type link without replacing it or creating a partial pair", () => {
	const f = fixture();
	mkdirSync(f.scope, { recursive: true });
	const existing = join(f.scope, "pi-ai");
	symlinkSync(f.root, existing);
	const result = f.run();
	expect(result.status).not.toBe(0);
	expect(result.stderr).toContain("Existing type link differs");
	expect(readlinkSync(existing)).toBe(f.root);
	expect(existsSync(join(f.scope, "pi-coding-agent"))).toBe(false);
});
it("requires existing Pi on PATH", () => {
	const f = fixture(),
		result = f.run(f.root);
	expect(result.status).not.toBe(0);
	expect(result.stderr).toContain("Existing Pi required on PATH");
	expect(existsSync(f.scope)).toBe(false);
});
