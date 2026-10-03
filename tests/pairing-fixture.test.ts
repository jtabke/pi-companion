import { it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer } from "node:net";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const origin = "http://127.0.0.1:4393";
const delay = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));
function launch(socket: string) {
	const child = spawn(process.execPath, ["tests/browser-fixture.mjs"], {
		cwd: process.cwd(),
		env: { PATH: process.env.PATH, C2_PAIR_SOCKET: socket },
		stdio: ["ignore", "pipe", "pipe"],
	});
	// Drain diagnostics, but never forward fixture output or credentials to test logs.
	child.stdout!.resume();
	child.stderr!.resume();
	const exited = new Promise<number | null>((resolve) =>
		child.once("exit", resolve),
	);
	return { child, exited };
}
async function portOpen() {
	return new Promise<boolean>((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port: 4393 });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
	});
}
async function ready(child: ChildProcess, socket: string) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null || child.signalCode !== null)
			throw Error("Fixture exited before readiness");
		if (existsSync(socket) && (await portOpen())) {
			expect((await fetch(origin)).status).toBe(200);
			return;
		}
		await delay(20);
	}
	throw Error("Fixture readiness deadline");
}
async function stop(owner: ReturnType<typeof launch>) {
	if (owner.child.exitCode === null && owner.child.signalCode === null)
		owner.child.kill("SIGTERM");
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			owner.exited,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(Error("Fixture shutdown deadline")),
					10_000,
				);
			}),
		]);
	} catch (error) {
		owner.child.kill("SIGKILL");
		await owner.exited;
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
function runtimeRoots() {
	return readdirSync("/tmp")
		.filter((name) => name.startsWith("c2-b-"))
		.sort();
}

it("actual fixture refuses an externally supplied existing parent without deleting its sentinel or leaking a runtime", async () => {
	expect(await portOpen()).toBe(false);
	const root = mkdtempSync("/tmp/c2-pfx-"),
		sentinel = join(root, "sentinel"),
		before = runtimeRoots();
	writeFileSync(sentinel, "unrelated owner data", { mode: 0o600 });
	const identity = lstatSync(root),
		owner = launch(join(root, "issue.sock"));
	try {
		expect(await stopAfterExit(owner)).not.toBe(0);
		expect(lstatSync(root).ino).toBe(identity.ino);
		expect(readFileSync(sentinel, "utf8")).toBe("unrelated owner data");
		expect(readdirSync(root)).toEqual(["sentinel"]);
		expect(runtimeRoots()).toEqual(before);
		expect(await portOpen()).toBe(false);
	} finally {
		await stop(owner);
		rmSync(root, { recursive: true });
	}
}, 15000);

async function stopAfterExit(owner: ReturnType<typeof launch>) {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			owner.exited,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(Error("Fixture refusal deadline")),
					5000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

it("actual fixture exclusively creates owner-only IPC/runtime and removes them with HTTP port on normal teardown", async () => {
	expect(await portOpen()).toBe(false);
	const parent = mkdtempSync("/tmp/c2-pfx-"),
		root = join(parent, "owned"),
		socket = join(root, "issue.sock"),
		before = runtimeRoots();
	const owner = launch(socket);
	try {
		await ready(owner.child, socket);
		const directory = lstatSync(root),
			endpoint = lstatSync(socket);
		expect(directory.uid).toBe(process.getuid!());
		expect(directory.mode & 0o777).toBe(0o700);
		expect(endpoint.isSocket()).toBe(true);
		expect(endpoint.uid).toBe(directory.uid);
		expect(endpoint.mode & 0o777).toBe(0o600);
		expect(
			readdirSync(root).filter((name) => name.startsWith("runtime-")),
		).toHaveLength(1);
		const code = await new Promise<string>((resolve, reject) => {
			const client = createConnection(socket);
			let text = "";
			client.once("connect", () => client.end("issue\n"));
			client.on("data", (chunk) => {
				text += chunk;
			});
			client.once("error", reject);
			client.once("close", () => resolve(text.trim()));
		});
		expect(/^[0-9]{6}$/.test(code)).toBe(true);
		const response = await fetch(origin + "/api/pair", {
			method: "POST",
			headers: {
				origin,
				"x-c2-csrf": "pair",
				"content-type": "application/json",
			},
			body: JSON.stringify({ code, remember: false }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ paired: true });
		expect(await stop(owner)).toBe(0);
		expect(existsSync(root)).toBe(false);
		expect(readdirSync(parent)).toEqual([]);
		expect(runtimeRoots()).toEqual(before);
		expect(await portOpen()).toBe(false);
	} finally {
		await stop(owner);
		rmSync(parent, { recursive: true });
	}
}, 20000);

it.each(["root", "socket"])(
	"actual fixture refuses cleanup after owned %s identity replacement",
	async (replacement) => {
		expect(await portOpen()).toBe(false);
		const parent = mkdtempSync("/tmp/c2-pfx-"),
			root = join(parent, "owned"),
			socket = join(root, "issue.sock"),
			before = runtimeRoots();
		const owner = launch(socket);
		let replacementServer: ReturnType<typeof createServer> | undefined;
		try {
			await ready(owner.child, socket);
			const originalSocket = lstatSync(socket);
			if (replacement === "root") {
				renameSync(root, join(parent, "original"));
				mkdirSync(root, { mode: 0o700 });
				// Keep even a replacement at the exact socket pathname intact, not just a sibling sentinel.
				writeFileSync(socket, "replacement data", { mode: 0o600 });
			} else {
				renameSync(socket, join(root, "original.sock"));
				replacementServer = createServer((client) => client.end());
				await new Promise<void>((resolve) =>
					replacementServer!.listen(socket, resolve),
				);
				chmodSync(socket, 0o600);
				const replacedSocket = lstatSync(socket);
				expect(replacedSocket.ino).not.toBe(originalSocket.ino);
				expect(replacedSocket.uid).toBe(originalSocket.uid);
				expect(replacedSocket.mode & 0o777).toBe(0o600);
			}
			writeFileSync(join(root, "sentinel"), "do not delete", { mode: 0o600 });
			const identity = lstatSync(root),
				replacementSocket = lstatSync(socket);
			expect(await stop(owner)).toBe(1);
			expect(lstatSync(root).ino).toBe(identity.ino);
			expect(lstatSync(socket).ino).toBe(replacementSocket.ino);
			if (replacement === "root")
				expect(readFileSync(socket, "utf8")).toBe("replacement data");
			else expect(lstatSync(socket).isSocket()).toBe(true);
			expect(readFileSync(join(root, "sentinel"), "utf8")).toBe(
				"do not delete",
			);
			if (replacement === "root")
				expect(existsSync(join(parent, "original"))).toBe(true);
			else expect(existsSync(join(root, "original.sock"))).toBe(true);
			expect(runtimeRoots()).toEqual(before);
			expect(await portOpen()).toBe(false);
		} finally {
			await stop(owner);
			if (replacementServer)
				await new Promise<void>((resolve) =>
					replacementServer!.close(() => resolve()),
				);
			rmSync(parent, { recursive: true });
		}
	},
	20000,
);
