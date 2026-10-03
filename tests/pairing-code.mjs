// Test-only local issuance client. No HTTP endpoint or raw credential file.
import { createConnection } from "node:net";
import { lstatSync } from "node:fs";
export function freshCode() {
	const path = process.env.C2_PAIR_SOCKET;
	const stat = lstatSync(path);
	if (
		!stat.isSocket() ||
		stat.uid !== process.getuid() ||
		(stat.mode & 0o777) !== 0o600
	)
		throw Error("Unsafe fixture socket");
	return new Promise((resolve, reject) => {
		const socket = createConnection(path);
		let text = "";
		socket.setTimeout(4000, () =>
			socket.destroy(Error("Fixture issuance timeout")),
		);
		socket.once("connect", () => socket.end("issue\n"));
		socket.on("data", (chunk) => {
			text += chunk;
			if (text.length > 128) socket.destroy(Error("Fixture issuance limit"));
		});
		socket.once("error", reject);
		socket.once("close", () => {
			if (/^[0-9]{6}\n$/.test(text)) resolve(text.trim());
			else reject(Error("Fixture issuance unavailable"));
		});
	});
}
