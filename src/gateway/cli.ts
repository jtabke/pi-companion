import { randomBytes } from "node:crypto";
import { runtimeDirectory } from "../shared/runtime.js";
import { acquireGatewayLock } from "./lock.js";
import { createGateway } from "./server.js";
const port = Number(process.env.C2_PORT ?? "4317");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
	throw new Error("C2_PORT must be 1024..65535");
try {
	const runtime = runtimeDirectory();
	// Intentionally not closed by app shutdown: process lifetime is the authority boundary.
	acquireGatewayLock(runtime);
	const secret = randomBytes(24).toString("base64url");
	const publicOrigin = process.env.C2_PUBLIC_ORIGIN;
	const app = await createGateway({ runtime, port, secret, publicOrigin });
	await app.listen({ host: "127.0.0.1", port });
	// Pairing secret is explicit terminal output, never an ordinary request/application log.
	console.log(
		`Pi observer: ${publicOrigin ?? `http://127.0.0.1:${port}`}\nPairing secret (submit in browser): ${secret}`,
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
