import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { closeSync, realpathSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerStat, runtimeDirectory } from "../shared/runtime.js";
import { acquireGatewayLock } from "./lock.js";
import { createGateway } from "./server.js";

type Command =
	"start" | "status" | "pair" | "devices" | "revoke" | "stop" | "restart";
type Config = { origin: string; port: number };
type Reply = {
	state: "stopped" | "starting" | "ready" | "unmanaged" | "unavailable";
	origin?: string;
	port?: number;
	authDirectory?: string;
	code?: string;
	expires?: number;
	devices?: { id: string; created: number; expires: number }[];
	revoked?: boolean;
};
const socketName = "management.sock",
	deadlineMs = 12000;
const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));
class ManagedError extends Error {}
const fail = (reason: string): never => {
	throw new ManagedError(reason);
};
function sameConfig(reply: Reply, config: Config) {
	return reply.origin === config.origin && reply.port === config.port;
}
function parse(args: string[]): {
	command: Command;
	config?: Config;
	id?: string;
} {
	const command = args[0];
	if (
		![
			"start",
			"status",
			"pair",
			"devices",
			"revoke",
			"stop",
			"restart",
		].includes(command ?? "")
	)
		fail("invalid-command");
	if (command === "revoke") {
		if (args.length !== 2 || !/^[a-f0-9]{32}$/.test(args[1]))
			fail("invalid-arguments");
		return { command, id: args[1] };
	}
	let origin = process.env.C2_PUBLIC_ORIGIN,
		port = process.env.C2_PORT ?? "4317";
	const seen = new Set<string>();
	for (let i = 1; i < args.length; i += 2) {
		const flag = args[i],
			value = args[i + 1];
		if (
			command !== "start" ||
			!["--origin", "--port"].includes(flag) ||
			seen.has(flag) ||
			!value ||
			value.startsWith("--")
		)
			fail("invalid-arguments");
		seen.add(flag);
		if (flag === "--origin") origin = value;
		else port = value;
	}
	if (command !== "start") return { command: command as Command };
	const number = Number(port);
	if (!Number.isInteger(number) || number < 1024 || number > 65535)
		fail("invalid-port");
	// Same authored spelling as createGateway: URL parsing must not normalize
	// user input. The server still enforces its own exact application boundary.
	const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
	if (
		!origin ||
		!new RegExp(`^https://${label}\\.${label}\\.ts\\.net$`).test(origin) ||
		new URL(origin).origin !== origin
	)
		fail("exact-private-origin-required");
	return { command: "start", config: { origin: origin!, port: number } };
}
function lockFree(runtime: string) {
	try {
		const fd = acquireGatewayLock(runtime);
		closeSync(fd);
		return true;
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "A gateway already owns this runtime directory"
		)
			return false;
		throw error;
	}
}
function absent(error: unknown) {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}
async function request(
	runtime: string,
	command: "status" | "pair" | "devices" | "revoke" | "stop",
	id?: string,
): Promise<Reply> {
	ownerStat(runtime, "directory");
	const path = join(runtime, socketName);
	ownerStat(path, "socket");
	return new Promise((resolve, reject) => {
		const socket = createConnection(path);
		let bytes = 0,
			text = "";
		const timer = setTimeout(
			() => socket.destroy(new Error("Management timeout")),
			command === "stop" ? 15000 : 4000,
		);
		socket.once("connect", () =>
			socket.end(command + (id ? " " + id : "") + "\n"),
		);
		socket.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > 8192) {
				socket.destroy(new Error("Management limit"));
				return;
			}
			text += chunk.toString("utf8");
		});
		socket.once("error", reject);
		socket.once("close", () => {
			clearTimeout(timer);
			try {
				const value: unknown = JSON.parse(text);
				const allowed = [
					"state",
					"origin",
					"port",
					...(command === "status" ? ["authDirectory"] : []),
					...(command === "pair"
						? ["code", "expires"]
						: command === "devices"
							? ["devices"]
							: command === "revoke"
								? ["revoked"]
								: []),
				];
				if (
					!object(value) ||
					text !== JSON.stringify(value) + "\n" ||
					Object.keys(value).some((key) => !allowed.includes(key)) ||
					typeof value.state !== "string" ||
					![
						"starting",
						"ready",
						"unavailable",
						...(command === "stop" ? ["stopped"] : []),
					].includes(value.state) ||
					(value.state === "ready" &&
						(value.origin === undefined || value.port === undefined)) ||
					(value.origin !== undefined &&
						(typeof value.origin !== "string" ||
							value.origin.length > 2048 ||
							new URL(value.origin).origin !== value.origin ||
							!/^https:\/\/[a-z0-9.-]+\.ts\.net$/.test(value.origin))) ||
					(value.authDirectory !== undefined &&
						(command !== "status" ||
							value.state !== "ready" ||
							typeof value.authDirectory !== "string" ||
							value.authDirectory.length > 4096 ||
							value.authDirectory.includes("\0") ||
							!isAbsolute(value.authDirectory) ||
							realpathSync(value.authDirectory) !== value.authDirectory)) ||
					(value.port !== undefined &&
						(!Number.isInteger(value.port) ||
							Number(value.port) < 1024 ||
							Number(value.port) > 65535))
				)
					throw new Error("Invalid management response");
				if (
					value.state === "ready" &&
					command === "pair" &&
					(typeof value.code !== "string" ||
						!/^[0-9]{6}$/.test(value.code) ||
						!Number.isSafeInteger(value.expires) ||
						Number(value.expires) <= Date.now() ||
						Number(value.expires) > Date.now() + 300_000)
				)
					throw new Error("Invalid management response");
				if (
					value.state !== "ready" &&
					Object.keys(value).some((key) =>
						["code", "expires", "devices", "revoked"].includes(key),
					)
				)
					throw new Error("Invalid management response");
				if (
					value.state === "ready" &&
					command === "devices" &&
					(!Array.isArray(value.devices) ||
						value.devices.length > 8 ||
						value.devices.some(
							(device) =>
								!object(device) ||
								Object.keys(device).sort().join() !== "created,expires,id" ||
								typeof device.id !== "string" ||
								!/^[a-f0-9]{32}$/.test(device.id) ||
								!Number.isSafeInteger(device.created) ||
								!Number.isSafeInteger(device.expires) ||
								Number(device.created) < 0 ||
								Number(device.expires) < Date.now() ||
								![8 * 60 * 60_000, 30 * 24 * 60 * 60_000].includes(
									Number(device.expires) - Number(device.created),
								) ||
								Number(device.expires) > 8.64e15,
						) ||
						new Set(value.devices.map((device) => device.id)).size !==
							value.devices.length)
				)
					throw new Error("Invalid management response");
				if (
					value.state === "ready" &&
					command === "revoke" &&
					typeof value.revoked !== "boolean"
				)
					throw new Error("Invalid management response");
				if (value.authDirectory !== undefined)
					ownerStat(value.authDirectory as string, "directory");
				resolve(value as Reply);
			} catch (error) {
				reject(error);
			}
		});
	});
}
async function status(runtime: string): Promise<Reply> {
	let hasSocket = false;
	try {
		ownerStat(join(runtime, socketName), "socket");
		hasSocket = true;
	} catch (error) {
		if (!absent(error)) return { state: "unavailable" };
	}
	// Released flock alone does not prove Serve cleanup after a crash.
	if (lockFree(runtime)) {
		try {
			if (hasSocket) await assertInactiveSocket(join(runtime, socketName));
			if (!emptyRoutes(await nativeJson("serve-status")))
				return { state: "unavailable" };
			if (lockFree(runtime)) return { state: "stopped" };
		} catch {
			return { state: "unavailable" };
		}
	}
	try {
		return await request(runtime, "status");
	} catch (error) {
		if (
			absent(error) ||
			(error as NodeJS.ErrnoException).code === "ECONNREFUSED"
		)
			return { state: "unmanaged" };
		return { state: "unavailable" };
	}
}
type NativeInspection = "serve-status" | "self-status";
const nativeInspections = new Set<ChildProcess>();
async function nativeJson(inspection: NativeInspection): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[fileURLToPath(new URL("./serve-child.js", import.meta.url))],
			{
				stdio: ["ignore", "ignore", "ignore", "ipc"],
			},
		);
		nativeInspections.add(child);
		let result: { value: unknown } | undefined,
			reason = "native-unavailable";
		child.on("message", (message) => {
			if (!object(message)) return;
			if (message.event === "inspection-result" && "value" in message)
				result = { value: message.value };
			else if (message.event === "malformed-native-status")
				reason = "malformed-native-status";
		});
		child.once("error", () => reject(new ManagedError("native-unavailable")));
		// Resolve only after both native handle and guardian have closed. The
		// guardian owns output/deadline bounds even when this caller is killed.
		child.once("close", (code) => {
			nativeInspections.delete(child);
			if (code === 0 && result) resolve(result.value);
			else reject(new ManagedError(reason));
		});
		child.send({ inspection }, () => {});
	});
}
function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function emptyRoutes(value: unknown) {
	return object(value) && Object.keys(value).length === 0;
}
function exactRoute(value: unknown, config: Config) {
	if (
		!object(value) ||
		Object.keys(value).length !== 1 ||
		!object(value.Foreground) ||
		Object.keys(value.Foreground).length !== 1
	)
		return false;
	const route = Object.values(value.Foreground)[0];
	if (
		!object(route) ||
		Object.keys(route).sort().join() !== "TCP,Web" ||
		!object(route.TCP) ||
		!object(route.Web)
	)
		return false;
	const host = new URL(config.origin).host + ":443";
	return (
		JSON.stringify(route.TCP) === '{"443":{"HTTPS":true}}' &&
		Object.keys(route.Web).length === 1 &&
		object(route.Web[host]) &&
		JSON.stringify(route.Web[host]) ===
			JSON.stringify({
				Handlers: { "/": { Proxy: `http://127.0.0.1:${config.port}` } },
			})
	);
}
function waitExit(child: ChildProcess, timeout: number) {
	return new Promise<void>((resolve, reject) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		const timer = setTimeout(
			() => reject(new ManagedError("cleanup-unconfirmed")),
			timeout,
		);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}
async function assertInactiveSocket(path: string) {
	await new Promise<void>((resolve, reject) => {
		const socket = createConnection(path);
		const timer = setTimeout(
			() => socket.destroy(new Error("Socket probe timeout")),
			1000,
		);
		socket.once("connect", () => {
			socket.destroy();
			reject(new ManagedError("active-management-resource"));
		});
		socket.once("error", (error) => {
			if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") resolve();
			else reject(error);
		});
		socket.once("close", () => clearTimeout(timer));
	});
}
async function reclaimSocket(runtime: string) {
	const path = join(runtime, socketName);
	let stat;
	try {
		stat = ownerStat(path, "socket");
	} catch (error) {
		if (absent(error)) return;
		throw error;
	}
	// Called only with exclusive flock. Still refuse a listening local endpoint;
	// reclaim only an owned, unchanged, demonstrably stale socket.
	await assertInactiveSocket(path);
	if (ownerStat(path, "socket").ino !== stat.ino)
		fail("unsafe-management-resource");
	unlinkSync(path);
}
async function owner(runtime: string, config: Config) {
	let guardian: ChildProcess | undefined,
		app: Awaited<ReturnType<typeof createGateway>> | undefined;
	let state: Reply["state"] = "starting",
		closing: Promise<void> | undefined,
		ownedSocket: number | undefined;
	let nativeFailure: string | undefined;
	let authDirectory =
		process.env.C2_AUTH_DIR ?? join(homedir(), ".pi-companion");
	const sockets = new Set<Socket>(),
		stopSockets = new Set<Socket>();
	function inspect(command: NativeInspection) {
		if (closing) fail("runtime-not-ready");
		return nativeJson(command);
	}
	const server = createServer({ allowHalfOpen: true }, (socket) => {
		if (sockets.size >= 8) {
			socket.destroy();
			return;
		}
		sockets.add(socket);
		socket.setTimeout(4000, () => socket.destroy());
		socket.once("close", () => {
			sockets.delete(socket);
			stopSockets.delete(socket);
		});
		socket.on("error", () => {});
		let text = "",
			handled = false;
		socket.once("end", () => {
			if (!handled) socket.destroy();
		});
		socket.on("data", (chunk: Buffer) => {
			if (handled) {
				socket.destroy();
				return;
			}
			text += chunk.toString("utf8");
			if (Buffer.byteLength(text) > 64) {
				socket.destroy();
				return;
			}
			if (!text.endsWith("\n")) return;
			handled = true;
			void (async () => {
				const [command, id] = text.trim().split(" ");
				if (
					!["status", "pair", "devices", "revoke", "stop"].includes(command) ||
					(command === "revoke"
						? !id || !/^[a-f0-9]{32}$/.test(id) || text !== `revoke ${id}\n`
						: text !== command + "\n")
				) {
					socket.destroy();
					return;
				}
				if (
					state === "ready" &&
					!exactRoute(await inspect("serve-status"), config)
				) {
					state = "unavailable";
					void shutdown(1);
				}
				if (command === "stop") {
					stopSockets.add(socket);
					socket.setTimeout(15000);
					void shutdown(0);
					return;
				}
				const reply: Reply = { state, ...config };
				if (state === "ready") {
					if (command === "status") reply.authDirectory = authDirectory;
					if (command === "pair")
						Object.assign(reply, app!.pairing.issueCode());
					if (command === "devices") reply.devices = app!.pairing.devices();
					if (command === "revoke") reply.revoked = app!.pairing.revoke(id!);
				}
				socket.end(JSON.stringify(reply) + "\n");
			})().catch(() => {
				state = "unavailable";
				socket.end('{"state":"unavailable"}\n');
				void shutdown(1);
			});
		});
	});
	server.on("error", () => {
		state = "unavailable";
		void shutdown(1);
	});
	function notify(event: string) {
		if (process.connected) process.send?.({ event }, () => {});
	}
	function shutdown(code: number): Promise<void> {
		if (closing) return closing;
		state = "unavailable";
		closing = (async () => {
			let clean = true;
			try {
				// Close inspection admission before cancellation. Await the real
				// owned guardian handles before releasing the lifetime flock.
				const pending = [...nativeInspections];
				for (const child of pending) if (child.connected) child.disconnect();
				await Promise.all(pending.map((child) => waitExit(child, 4500)));
				if (pending.some((child) => child.exitCode !== 0)) clean = false;
			} catch {
				clean = false;
			}
			try {
				if (guardian) {
					if (guardian.connected) guardian.send("stop", () => {});
					await waitExit(guardian, 4500);
					if (
						guardian.exitCode !== 0 ||
						!emptyRoutes(await nativeJson("serve-status"))
					)
						clean = false;
				}
			} catch {
				clean = false;
			}
			try {
				if (app) {
					await Promise.race([
						app.close(),
						sleep(3000).then(() => {
							throw new Error("Close timeout");
						}),
					]);
				}
			} catch {
				clean = false;
			}
			if (ownedSocket !== undefined) {
				try {
					if (
						ownerStat(join(runtime, socketName), "socket").ino !== ownedSocket
					)
						clean = false;
					else unlinkSync(join(runtime, socketName));
				} catch (error) {
					if (!absent(error)) clean = false;
				}
			}
			// Explicit stop receives cleanup outcome, not an optimistic ack. The
			// caller also verifies flock release and empty native Serve status.
			for (const socket of sockets)
				if (!stopSockets.has(socket)) socket.destroy();
			await Promise.all(
				[...stopSockets].map(
					(socket) =>
						new Promise<void>((resolve) => {
							const timer = setTimeout(() => {
								socket.destroy();
								resolve();
							}, 1000);
							socket.end(
								JSON.stringify({ state: clean ? "stopped" : "unavailable" }) +
									"\n",
								() => {
									clearTimeout(timer);
									socket.destroy();
									resolve();
								},
							);
						}),
				),
			);
			if (server.listening)
				await new Promise<void>((resolve) => server.close(() => resolve()));
			notify(clean ? "closed" : "cleanup-unconfirmed");
			process.exit(clean ? code : 1);
		})();
		return closing;
	}
	try {
		// Keep this descriptor until process exit, just like the legacy CLI.
		acquireGatewayLock(runtime);
	} catch (error) {
		notify(
			error instanceof Error &&
				error.message === "A gateway already owns this runtime directory"
				? "locked"
				: "unsafe-runtime",
		);
		process.exit(1);
	}
	process.once("SIGTERM", () => {
		void shutdown(0);
	});
	process.once("SIGINT", () => {
		void shutdown(0);
	});
	const startupTimer = setTimeout(() => {
		notify("startup-timeout");
		void shutdown(1);
	}, deadlineMs - 1000);
	try {
		await reclaimSocket(runtime);
		// Bind owner-only from the first instant, without changing Serve's umask.
		const previousUmask = process.umask(0o177);
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(join(runtime, socketName), resolve);
			});
		} finally {
			process.umask(previousUmask);
		}
		ownedSocket = ownerStat(join(runtime, socketName), "socket").ino;
		const routes = await inspect("serve-status");
		const local = await inspect("self-status");
		if (!emptyRoutes(routes)) fail("existing-or-ambiguous-serve-config");
		if (
			!object(local) ||
			local.BackendState !== "Running" ||
			!object(local.Self) ||
			typeof local.Self.DNSName !== "string" ||
			local.Self.DNSName.replace(/\.$/, "") !== new URL(config.origin).hostname
		)
			fail("native-self-origin-mismatch");
		app = await createGateway({
			runtime,
			port: config.port,
			publicOrigin: config.origin,
			stateDirectory: authDirectory,
		});
		// Capture the existing auth owner's canonical directory once, not the
		// restart caller's environment or a later parent-symlink resolution.
		authDirectory = realpathSync(authDirectory);
		await app.listen({ host: "127.0.0.1", port: config.port });
		if (
			(
				await app.inject({
					method: "GET",
					url: "/",
					headers: { host: new URL(config.origin).host },
				})
			).statusCode !== 200
		)
			fail("application-unavailable");
		if (closing) return;
		guardian = spawn(
			process.execPath,
			[fileURLToPath(new URL("./serve-child.js", import.meta.url))],
			{ stdio: ["ignore", "ignore", "ignore", "ipc"] },
		);
		guardian.on("message", (message) => {
			if (
				!object(message) ||
				typeof message.event !== "string" ||
				message.event === "spawned"
			)
				return;
			nativeFailure = message.event;
			if (state === "ready") {
				state = "unavailable";
				void shutdown(1);
			}
		});
		guardian.once("error", () => {
			nativeFailure = "native-unavailable";
			void shutdown(1);
		});
		guardian.once("exit", () => {
			if (!closing) {
				nativeFailure ??= "serve-exited";
				if (state === "ready") void shutdown(1);
			}
		});
		guardian.send({ port: config.port }, () => {});
		let confirmed = false;
		for (let i = 0; i < 30 && !closing; i++) {
			if (nativeFailure) fail(nativeFailure);
			const observed = await inspect("serve-status");
			if (exactRoute(observed, config)) {
				confirmed = true;
				break;
			}
			if (!emptyRoutes(observed)) fail("unexpected-serve-route");
			await sleep(100);
		}
		if (closing) return;
		if (nativeFailure) fail(nativeFailure);
		if (!confirmed) fail("serve-not-ready");
		state = "ready";
		clearTimeout(startupTimer);
		notify("ready");
		// The launching CLI is not the runtime's lifetime owner.
		if (process.connected) process.disconnect?.();
	} catch (error) {
		clearTimeout(startupTimer);
		notify(
			error instanceof ManagedError ? error.message : "startup-unavailable",
		);
		await shutdown(1);
	}
}
async function launch(runtime: string, config: Config, authDirectory?: string) {
	const child = spawn(
		process.execPath,
		[
			fileURLToPath(new URL("./cli.js", import.meta.url)),
			"start",
			"--origin",
			config.origin,
			"--port",
			String(config.port),
		],
		{
			detached: true,
			env: {
				...process.env,
				C2_RUNTIME: runtime,
				C2_MANAGED_OWNER: "1",
				...(authDirectory ? { C2_AUTH_DIR: authDirectory } : {}),
			},
			stdio: ["ignore", "ignore", "ignore", "ipc"],
		},
	);
	return new Promise<string>((resolve, reject) => {
		let result: string | undefined;
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new ManagedError("startup-timeout"));
		}, deadlineMs);
		child.on("message", (message) => {
			if (!object(message) || typeof message.event !== "string") return;
			if (message.event === "ready") {
				clearTimeout(timer);
				child.unref();
				if (child.connected) child.disconnect();
				resolve("ready");
			} else if (
				message.event !== "closed" &&
				message.event !== "cleanup-unconfirmed"
			)
				result ??= message.event;
			if (message.event === "cleanup-unconfirmed")
				result = "cleanup-unconfirmed";
		});
		child.once("error", () => {
			clearTimeout(timer);
			reject(new ManagedError("startup-unavailable"));
		});
		child.once("exit", () => {
			clearTimeout(timer);
			resolve(result ?? "startup-unavailable");
		});
	});
}
async function startManaged(
	runtime: string,
	config: Config,
	authDirectory?: string,
) {
	const started = await launch(runtime, config, authDirectory);
	if (started !== "ready" && started !== "locked") fail(started);
	const until = Date.now() + 4500;
	let reply = await status(runtime);
	while (
		(reply.state === "starting" || reply.state === "unmanaged") &&
		Date.now() < until
	) {
		await sleep(100);
		reply = await status(runtime);
	}
	if (reply.state !== "ready")
		fail(
			reply.state === "unmanaged"
				? "unmanaged-transition-required"
				: "runtime-unavailable",
		);
	if (
		!sameConfig(reply, config) ||
		(authDirectory !== undefined && reply.authDirectory !== authDirectory)
	)
		fail("configuration-conflict");
	console.log(`Pi companion: ready ${reply.origin}`);
}
async function stopManaged(runtime: string) {
	if (lockFree(runtime)) {
		// Verify native route absence even after a crash; don't conceal an
		// orphaned/foreign route behind a missing management socket.
		if ((await status(runtime)).state !== "stopped")
			fail("cleanup-unconfirmed");
	} else {
		const reply = await status(runtime);
		if (reply.state === "unmanaged") fail("unmanaged-transition-required");
		if ((await request(runtime, "stop")).state !== "stopped")
			fail("cleanup-unconfirmed");
		const until = Date.now() + deadlineMs;
		while (!lockFree(runtime) && Date.now() < until) await sleep(100);
		if (!lockFree(runtime) || (await status(runtime)).state !== "stopped")
			fail("cleanup-unconfirmed");
	}
}
export async function managedCli(args: string[]) {
	try {
		const { command, config, id } = parse(args);
		if (command === "pair" && !process.stdout.isTTY)
			fail("pair-requires-local-terminal");
		const runtime = runtimeDirectory();
		if (process.env.C2_MANAGED_OWNER === "1" && process.send && config) {
			await owner(runtime, config);
			return;
		}
		if (command === "start") {
			await startManaged(runtime, config!);
		} else if (command === "restart") {
			const reply = await status(runtime);
			if (reply.state === "unmanaged") fail("unmanaged-transition-required");
			if (reply.state !== "ready" || !reply.authDirectory)
				fail("runtime-not-ready");
			const observed = { origin: reply.origin!, port: reply.port! };
			await stopManaged(runtime);
			await startManaged(runtime, observed, reply.authDirectory);
		} else if (command === "status") {
			const reply = await status(runtime);
			console.log(
				`Pi companion: ${reply.state}${reply.state === "ready" ? ` ${reply.origin}` : ""}`,
			);
			if (["unmanaged", "unavailable"].includes(reply.state))
				process.exitCode = 1;
		} else if (command === "pair") {
			if (lockFree(runtime)) fail("stopped");
			const reply = await request(runtime, "pair");
			if (reply.state !== "ready" || !reply.code || !reply.expires)
				fail("runtime-not-ready");
			console.log(
				`Pairing code (submit in browser): ${reply.code}\nExpires: ${new Date(reply.expires!).toISOString()}`,
			);
		} else if (command === "devices" || command === "revoke") {
			if (lockFree(runtime)) fail("stopped");
			const reply = await request(runtime, command, id);
			if (reply.state !== "ready") fail("runtime-not-ready");
			if (command === "devices") console.log(JSON.stringify(reply.devices));
			else {
				if (!reply.revoked) fail("device-not-found");
				console.log("Pi companion: revoked");
			}
		} else {
			await stopManaged(runtime);
			console.log("Pi companion: stopped");
		}
	} catch (error) {
		console.error(
			`Pi companion: ${error instanceof ManagedError ? error.message : "unavailable-unsafe-local-resource"}`,
		);
		process.exitCode = 1;
	}
}
