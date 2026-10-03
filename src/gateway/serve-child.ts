import { spawn, type ChildProcess } from "node:child_process";

// This guardian owns exactly one fixed native inspection or foreground Serve
// handle. The requesting process owns IPC, not the child's kill deadline: IPC
// disconnect also cleans up after caller SIGKILL, including during setup.
let child: ChildProcess | undefined;
let inspection: "serve-status" | "self-status" | undefined;
let stopping = false;
let failure: "native-unavailable" | undefined;
let deadline: NodeJS.Timeout | undefined,
	escalation: NodeJS.Timeout | undefined;
function report(event: string) {
	if (process.connected) process.send?.({ event }, () => {});
}
function finish(message: { event: string; value?: unknown }, code: number) {
	// Flush only bounded parsed JSON or a fixed error event, never native stderr.
	if (!process.connected) process.exit(code);
	process.send?.(message, () => process.exit(code));
	setTimeout(() => process.exit(code), 1000);
}
function stop(force = false) {
	if (stopping) return;
	stopping = true;
	if (deadline) clearTimeout(deadline);
	if (!child) process.exit(0);
	child.kill(force ? "SIGKILL" : "SIGTERM");
	escalation = setTimeout(
		() => {
			child?.kill("SIGKILL");
			setTimeout(() => process.exit(1), 1000);
		},
		force ? 1000 : 2000,
	);
}
process.on("disconnect", () => stop());
process.once("SIGTERM", () => stop());
process.once("SIGINT", () => stop());
process.on("message", (message) => {
	if (message === "stop") {
		stop();
		return;
	}
	if (child || stopping || !process.connected) return;
	if (
		typeof message !== "object" ||
		message === null ||
		Object.keys(message).length !== 1
	)
		process.exit(1);
	let args: string[];
	if (
		"inspection" in message &&
		(message.inspection === "serve-status" ||
			message.inspection === "self-status")
	) {
		inspection = message.inspection;
		args =
			inspection === "serve-status"
				? ["serve", "status", "--json"]
				: ["status", "--json"];
	} else if (
		"port" in message &&
		Number.isInteger(message.port) &&
		Number(message.port) >= 1024 &&
		Number(message.port) <= 65535
	) {
		args = ["serve", "--https=443", `http://127.0.0.1:${message.port}`];
	} else {
		process.exit(1);
	}
	child = spawn("tailscale", args, { stdio: ["ignore", "pipe", "pipe"] });
	if (inspection)
		deadline = setTimeout(() => {
			failure = "native-unavailable";
			stop(true);
		}, 2500);
	let bytes = 0,
		pending = "";
	const stdout: Buffer[] = [];
	for (const stream of [child.stdout, child.stderr])
		stream?.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > 65536) {
				failure = "native-unavailable";
				if (!inspection) report("unavailable");
				stop(inspection !== undefined);
				return;
			}
			if (inspection) {
				if (stream === child?.stdout && !stopping) stdout.push(chunk);
				return;
			}
			// Foreground output is discarded except this bounded consent window.
			pending = (pending + chunk.toString("utf8")).slice(-1024);
			if (
				/https:\/\/login\.tailscale\.com|HTTPS[^\n]*not enabled/i.test(pending)
			) {
				report("needs-native-consent");
				stop();
			}
		});
	child.once("spawn", () => {
		if (!inspection) report("spawned");
	});
	child.once("error", () => {
		failure = "native-unavailable";
		if (!inspection) report("unavailable");
		stop(inspection !== undefined);
	});
	// Inspections wait for bounded stdout; foreground exit must invalidate
	// readiness immediately, without waiting on output pipes.
	child.once(inspection ? "close" : "exit", (code: number | null) => {
		if (deadline) clearTimeout(deadline);
		if (escalation) clearTimeout(escalation);
		if (!inspection) {
			if (!stopping) report("serve-exited");
			process.exit(0);
		}
		if (stopping && !failure) process.exit(0);
		if (failure || code !== 0) {
			finish({ event: "native-unavailable" }, 1);
			return;
		}
		try {
			finish(
				{
					event: "inspection-result",
					value: JSON.parse(Buffer.concat(stdout).toString("utf8")),
				},
				0,
			);
		} catch {
			finish({ event: "malformed-native-status" }, 1);
		}
	});
});
if (!process.send || !process.connected) process.exit(1);
