import { spawn } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env };
const directories = (env.PATH ?? "").split(delimiter);
const executable = (path) => {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
};
// Preserve explicit/fixture executables and exclusive PATHs. Only the ordinary
// macOS environment gets the app CLI instead of the known non-exec shell shim.
if (
	process.platform === "darwin" &&
	directories.some((path) => path === "/usr/bin" || path === "/bin")
) {
	const nativeDirectory = "/Applications/Tailscale.app/Contents/MacOS";
	const selected = directories
		.map((path) => join(path, "tailscale"))
		.find(executable);
	let knownShim = false;
	if (selected === "/usr/local/bin/tailscale") {
		try {
			knownShim =
				readFileSync(selected, "utf8") ===
				'#!/bin/sh\n/Applications/Tailscale.app/Contents/MacOS/tailscale "$@"\n';
		} catch {}
	}
	if (
		(!selected || knownShim) &&
		executable(join(nativeDirectory, "tailscale"))
	)
		env.PATH = nativeDirectory + delimiter + (env.PATH ?? "");
}

let child;
if (process.argv.slice(2).length > 0) {
	console.error("Pi companion: restart accepts no arguments");
	process.exit(1);
}
let interrupted;
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		interrupted = signal;
		child?.kill(signal);
	});
}
function run(args) {
	return new Promise((resolve) => {
		child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
		child.once("error", () => resolve(1));
		child.once("close", (code, signal) => {
			if (signal) interrupted = signal;
			resolve(code ?? 1);
		});
	});
}
// No pre/postrestart lifecycle: a failed build must leave the existing owner alone.
let code = env.npm_execpath ? await run([env.npm_execpath, "run", "build"]) : 1;
if (code === 0 && !interrupted)
	code = await run([join(root, "dist/gateway/cli.js"), "restart"]);
if (interrupted) {
	process.removeAllListeners(interrupted);
	process.kill(process.pid, interrupted);
} else process.exitCode = code;
