import { homedir } from "node:os";
import { join } from "node:path";
import { runtimeDirectory } from "../shared/runtime.js";
import { acquireGatewayLock } from "./lock.js";
import { createGateway } from "./server.js";
if (process.argv.length > 2) {
	const { managedCli } = await import("./management.js");
	await managedCli(process.argv.slice(2));
} else {
	const port = Number(process.env.C2_PORT ?? "4317");
	if (!Number.isInteger(port) || port < 1024 || port > 65535)
		throw new Error("C2_PORT must be 1024..65535");
	try {
		const runtime = runtimeDirectory();
		// Intentionally not closed by app shutdown: process lifetime is the authority boundary.
		acquireGatewayLock(runtime);
		const publicOrigin = process.env.C2_PUBLIC_ORIGIN;
		const app = await createGateway({
			runtime,
			port,
			stateDirectory:
				process.env.C2_AUTH_DIR ?? join(homedir(), ".pi-companion"),
			publicOrigin,
		});
		await app.listen({ host: "127.0.0.1", port });
		const { code, expires } = app.pairing.issueCode();
		// Initial code is terminal-only; legacy renewal requires a restart.
		console.log(
			`Pi observer: ${publicOrigin ?? `http://127.0.0.1:${port}`}\nPairing code (submit in browser): ${code}\nExpires: ${new Date(expires).toISOString()}`,
		);
		const close = () => {
			void app.close().then(() => process.exit(0));
		};
		process.once("SIGINT", close);
		process.once("SIGTERM", close);
	} catch (error) {
		console.error(
			error instanceof Error &&
				error.message === "A gateway already owns this runtime directory"
				? "Gateway blocked: another gateway owns this runtime directory."
				: "Gateway blocked: unsafe runtime, occupied port, or unavailable local build.",
		);
		process.exitCode = 1;
	}
}
