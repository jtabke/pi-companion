import { it, expect } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createConnection, createServer, type Server } from "node:net";
import { request } from "node:http";
import { basename, join, resolve } from "node:path";
import { createBridge } from "../src/extension/bridge.js";
import { discover } from "../src/gateway/peer.js";
import { context } from "./fixture.js";

const origin = "https://companion.fixture.ts.net",
	host = "companion.fixture.ts.net";
const cli = resolve("dist/gateway/cli.js");
const evidence = mkdtempSync("/tmp/c2-managed-evidence-");
console.log("Managed fixture journals/cleanup evidence:", evidence);
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function alive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
type NativeChild = {
	pid: number;
	guardian: number;
	kind: "inspection" | "serve";
	args: string[];
};
async function exited(child: ChildProcess, timeout = 16000) {
	if (child.exitCode !== null || child.signalCode !== null)
		return child.exitCode;
	return new Promise<number | null>((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("Fixture child timeout"));
		}, timeout);
		child.once("exit", (code) => {
			clearTimeout(timer);
			resolve(code);
		});
	});
}
async function fixture() {
	const root = mkdtempSync("/tmp/c2-m-");
	chmodSync(root, 0o700);
	const runtime = join(root, "r");
	const bin = join(root, "tailscale");
	// No host tailscale can be resolved: every production CLI/guardian invocation
	// uses this exclusive PATH, and the executable shebang names this Node exactly.
	writeFileSync(
		bin,
		`#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const root = ${JSON.stringify(root)}, args = process.argv.slice(2);
fs.appendFileSync(path.join(root,'commands'), JSON.stringify(args)+'\\n');
const mode = fs.readFileSync(path.join(root,'mode'),'utf8');
const routePath = path.join(root,'route');
const inspection = ['serve status --json','status --json'].includes(args.join(' '));
fs.appendFileSync(path.join(root,'native-children'),JSON.stringify({pid:process.pid,guardian:process.ppid,kind:inspection?'inspection':'serve',args})+'\\n');
if(inspection) process.on('SIGTERM',()=>process.exit(0));
if (mode === 'command-error') { console.error('NATIVE-CREDENTIAL-MARKER'); process.exit(1); }
if (inspection && (mode === 'status-timeout' || (mode === 'self-timeout' && args.join(' ') === 'status --json'))) { setInterval(()=>{},1000); }
else if (args.join(' ') === 'serve status --json') {
 if (mode === 'malformed') console.log('NATIVE-CREDENTIAL-MARKER not JSON');
 else if (mode === 'ambiguous') console.log('null');
 else if (mode === 'status-output-limit') console.log('NATIVE-CREDENTIAL-MARKER'.repeat(5000));
 else console.log(fs.readFileSync(routePath,'utf8'));
} else if (args.join(' ') === 'status --json') {
 console.log(JSON.stringify({BackendState:'Running',Self:{DNSName: mode === 'wrong-self' ? 'other.fixture.ts.net.' : 'companion.fixture.ts.net.'}}));
} else if (args[0] === 'serve' && args[1] === '--https=443' && /^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(args[2])) {
 const pidPath=path.join(root,'serve-'+process.pid);
 fs.writeFileSync(pidPath,JSON.stringify({pid:process.pid,guardian:process.ppid}));
 const clear=()=>{if(fs.readFileSync(path.join(root,'mode'),'utf8')!=='cleanup-failure') fs.writeFileSync(routePath,'{}'); try{fs.unlinkSync(pidPath);}catch{}};
 process.on('SIGTERM',()=>{clear(); process.exit(0);});
 process.on('SIGINT',()=>{clear(); process.exit(0);});
 if (mode === 'consent') console.error('HTTPS not enabled https://login.tailscale.com/native-secret');
 else if (mode === 'early-exit') { console.error('NATIVE-CREDENTIAL-MARKER'); clear(); process.exit(1); }
 else if (mode === 'output-limit') process.stdout.write('NATIVE-CREDENTIAL-MARKER'.repeat(5000));
 else {
  const route={Foreground:{fixture:{TCP:{'443':{HTTPS:true}},Web:{'companion.fixture.ts.net:443':{Handlers:{'/':{Proxy:args[2]}}}}}}};
  if(mode==='extra-route') route.Foreground.fixture.Web['companion.fixture.ts.net:443'].Handlers['/foreign']={Proxy:args[2]};
  if(mode==='funnel') route.Foreground.fixture.AllowFunnel={'companion.fixture.ts.net:443':true};
  const publish=()=>fs.writeFileSync(routePath, mode==='malformed-observed' ? 'NATIVE-CREDENTIAL-MARKER not JSON' : JSON.stringify(route));
  if(mode==='delayed-route') setTimeout(publish,1500); else publish();
 }
 setInterval(()=>{},1000);
} else { console.error('FIXTURE FORBIDDEN COMMAND'); process.exit(93); }
`,
	);
	chmodSync(bin, 0o700);
	writeFileSync(join(root, "mode"), "good");
	writeFileSync(join(root, "route"), "{}");
	const reservation = createServer();
	await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
	const port = (reservation.address() as import("node:net").AddressInfo).port;
	expect(port).not.toBe(4317);
	expect([4392, 4393, 4395, 4396]).not.toContain(port);
	const env = {
		PATH: root,
		C2_RUNTIME: runtime,
		C2_AUTH_DIR: join(root, "auth"),
		C2_PORT: String(port),
		C2_PUBLIC_ORIGIN: origin,
	};
	const children: ChildProcess[] = [];
	function guard() {
		expect(env.PATH).toBe(root);
		if (readFileSync(join(root, "mode"), "utf8") === "unavailable-command") {
			expect(existsSync(bin)).toBe(false);
			return;
		}
		expect(statSync(bin).mode & 0o777).toBe(0o700);
		expect(
			readFileSync(bin, "utf8").startsWith(`#!${process.execPath}\n`),
		).toBe(true);
	}
	function spawnCli(
		args: string[],
		extra: Record<string, string | undefined> = {},
		ipc = false,
	) {
		guard();
		expect({ ...env, ...extra }.PATH).toBe(root);
		const child = spawn(process.execPath, [cli, ...args], {
			env: { ...env, ...extra },
			stdio: ipc
				? ["ignore", "pipe", "pipe", "ipc"]
				: ["ignore", "pipe", "pipe"],
		});
		children.push(child);
		const output = { out: "", err: "" };
		child.stdout!.on("data", (data) => {
			output.out += data;
		});
		child.stderr!.on("data", (data) => {
			output.err += data;
		});
		return { child, output };
	}
	async function run(
		args: string[],
		extra?: Record<string, string | undefined>,
	) {
		const { child, output } = spawnCli(args, extra);
		const code = await exited(child);
		return { ...output, code };
	}
	async function release() {
		if (reservation.listening)
			await new Promise<void>((r) => reservation.close(() => r()));
	}
	function mode(value: string) {
		writeFileSync(join(root, "mode"), value);
	}
	function commands(): string[][] {
		return existsSync(join(root, "commands"))
			? readFileSync(join(root, "commands"), "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line))
			: [];
	}
	function nativeChildren(): NativeChild[] {
		return existsSync(join(root, "native-children"))
			? readFileSync(join(root, "native-children"), "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line))
			: [];
	}
	async function nativeReleased() {
		await expect
			.poll(() => nativeChildren().filter((record) => alive(record.pid)), {
				timeout: 5000,
			})
			.toEqual([]);
		await expect
			.poll(() => nativeChildren().filter((record) => alive(record.guardian)), {
				timeout: 5000,
			})
			.toEqual([]);
	}
	async function ptyPair() {
		guard();
		// An owned PTY, not a TTY override: Node observes its actual local stdout.
		const python = execFileSync("/usr/bin/which", ["python3"], {
			encoding: "utf8",
		}).trim();
		const script = `import os,pty,subprocess,sys\nm,s=pty.openpty()\np=subprocess.Popen([${JSON.stringify(process.execPath)},${JSON.stringify(cli)},'pair'],stdout=s,stderr=s,stdin=subprocess.DEVNULL)\nos.close(s)\nwhile True:\n try: b=os.read(m,4096)\n except OSError: break\n if not b: break\n sys.stdout.buffer.write(b)\nos.close(m)\nsys.exit(p.wait(timeout=10))\n`;
		const child = spawn(python, ["-c", script], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		children.push(child);
		let text = "";
		child.stdout!.on("data", (data) => {
			text += data;
		});
		child.stderr!.on("data", (data) => {
			text += data;
		});
		expect(await exited(child)).toBe(0);
		const code = /browser\): ([0-9]{6})/.exec(text)?.[1];
		expect(code).toBeDefined();
		const expires = Date.parse(/Expires: (\S+)/.exec(text)![1]);
		expect(expires - Date.now()).toBeGreaterThan(290_000);
		expect(expires - Date.now()).toBeLessThanOrEqual(300_000);
		return code!;
	}
	async function cleanup() {
		writeFileSync(
			join(evidence, basename(root) + "-commands.json"),
			JSON.stringify(
				{
					root,
					port,
					commands: commands(),
					nativeChildren: nativeChildren().map((record) => ({
						...record,
						alive: alive(record.pid),
						guardianAlive: alive(record.guardian),
					})),
				},
				null,
				2,
			),
		);
		await release();
		mode("good");
		// Exercise the real local stop path even if an assertion failed. All handles
		// and the last-resort Serve IDs below come only from this fixture directory.
		await run(["stop"]).catch(() => {});
		for (const child of children)
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGTERM");
				await exited(child).catch(() => {});
			}
		const fallbackNativeKills: number[] = [];
		for (const record of nativeChildren())
			if (alive(record.pid)) {
				fallbackNativeKills.push(record.pid);
				try {
					process.kill(record.pid, "SIGTERM");
				} catch {}
			}
		await delay(100);
		for (const record of nativeChildren())
			if (alive(record.pid)) {
				try {
					process.kill(record.pid, "SIGKILL");
				} catch {}
			}
		await nativeReleased();
		await expect
			.poll(
				() => readdirSync(root).filter((name) => name.startsWith("serve-")),
				{ timeout: 5000 },
			)
			.toEqual([]);
		expect(
			commands().some((args) =>
				args.some((arg) => /^(--bg|reset|funnel|off)$/.test(arg)),
			),
		).toBe(false);
		expect(await reachable(port)).toBe(false);
		expect(readFileSync(join(root, "route"), "utf8")).toBe("{}");
		const recordedCommands = commands();
		rmSync(root, { recursive: true, force: true });
		writeFileSync(
			join(evidence, basename(root) + "-cleanup.json"),
			JSON.stringify(
				{
					port,
					loopbackReleased: true,
					foregroundServeChildren: 0,
					inspectionChildren: 0,
					nativeGuardians: 0,
					fallbackNativeKills,
					fixtureDirectoryRemoved: !existsSync(root),
					trackedChildrenExited: children.every(
						(child) => child.exitCode !== null || child.signalCode !== null,
					),
					commands: recordedCommands,
				},
				null,
				2,
			),
		);
	}
	return {
		root,
		runtime,
		port,
		env,
		release,
		run,
		spawnCli,
		mode,
		commands,
		nativeChildren,
		nativeReleased,
		ptyPair,
		cleanup,
	};
}
async function reachable(port: number) {
	return new Promise<boolean>((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
	});
}
async function http(
	port: number,
	path = "/",
	payload?: object,
	cookie?: string,
) {
	return new Promise<{ status: number; body: string; cookie?: string }>(
		(resolve, reject) => {
			const req = request(
				{
					host: "127.0.0.1",
					port,
					path,
					method: payload ? "POST" : "GET",
					headers: {
						host,
						...(cookie ? { cookie } : {}),
						...(payload
							? {
									origin,
									"x-c2-csrf": path === "/api/pair" ? "pair" : "input",
									"content-type": "application/json",
								}
							: {}),
					},
				},
				(res) => {
					let body = "";
					res.on("data", (chunk) => {
						body += chunk;
					});
					res.once("end", () =>
						resolve({
							status: res.statusCode!,
							body,
							cookie: res.headers["set-cookie"]?.[0].split(";")[0],
						}),
					);
				},
			);
			req.once("error", reject);
			req.end(payload ? JSON.stringify(payload) : undefined);
		},
	);
}

it("cold start is actual HTTP-ready, terminal-only explicit pair authenticates, reuse/config/redaction/stop preserve the bridge", async () => {
	const f = await fixture();
	const bridge = createBridge(f.runtime);
	try {
		await f.run(["status"]);
		await bridge.start(context());
		await f.release();
		const start = await f.run(["start"]);
		expect(start).toEqual({
			code: 0,
			out: `Pi companion: ready ${origin}\n`,
			err: "",
		});
		expect((await http(f.port)).status).toBe(200);
		expect((await http(f.port)).body).toContain('<div id="root">');
		expect((await http(f.port, "/api/snapshot")).status).toBe(401);
		expect((await f.run(["status"])).out).toContain(
			"Terminal discovery: ready; 1 live terminals",
		);
		const pair = await f.run(["pair"]);
		expect(pair.code).toBe(1);
		expect(pair.err).toContain("pair-requires-local-terminal");
		expect(pair.out).toBe("");
		const code = await f.ptyPair();
		const auth = await http(f.port, "/api/pair", { code, remember: false });
		expect(auth.status).toBe(200);
		expect(
			(await http(f.port, "/api/snapshot", undefined, auth.cookie)).status,
		).toBe(200);
		expect(
			(await http(f.port, "/api/secret", undefined, auth.cookie)).status,
		).toBe(404);
		for (const args of [
			["status"],
			["start"],
			["start", "--origin", "https://other.fixture.ts.net"],
			["start", "--port", String(f.port + (f.port === 65535 ? -1 : 1))],
		]) {
			const reply = await f.run(args);
			expect(reply.out + reply.err).not.toContain(code);
			if (args.length > 1)
				expect(reply).toEqual({
					code: 1,
					out: "",
					err: "Pi companion: configuration-conflict\n",
				});
			else expect(reply.code).toBe(0);
		}
		expect(
			f.commands().filter((args) => args[1] === "--https=443"),
		).toHaveLength(1);
		expect(await f.run(["stop"])).toEqual({
			code: 0,
			out: "Pi companion: stopped\n",
			err: "",
		});
		expect((await discover(f.runtime)).peers).toHaveLength(1);
		expect(await f.run(["status"])).toEqual({
			code: 0,
			out: "Pi companion: stopped\n",
			err: "",
		});
	} finally {
		await bridge.close();
		await f.cleanup();
	}
}, 30000);

it("simultaneous CLI starts produce one managed owner and one foreground Serve", async () => {
	const f = await fixture();
	try {
		await f.release();
		const results = await Promise.all([
			f.run(["start"]),
			f.run(["start"]),
			f.run(["start"]),
		]);
		for (const result of results)
			expect(result).toEqual({
				code: 0,
				out: `Pi companion: ready ${origin}\n`,
				err: "",
			});
		expect(
			f.commands().filter((args) => args[1] === "--https=443"),
		).toHaveLength(1);
	} finally {
		await f.cleanup();
	}
}, 25000);

it("invalid command/flag/origin/port and missing managed origin fail before filesystem/native mutation", async () => {
	const f = await fixture();
	try {
		for (const args of [
			["unknown"],
			["start", "--wat", "value"],
			["status", "--origin", origin],
			["start", "--port"],
			["start", "--origin", origin, "--origin", origin],
			["start", "--port", "1"],
			["start", "--origin", origin + "/"],
			["start", "--origin", origin + ":443"],
			["start", "--origin", "http://companion.fixture.ts.net"],
			["start"],
		]) {
			const reply = await f.run(args, { C2_PUBLIC_ORIGIN: undefined });
			expect(reply.code).toBe(1);
			expect(reply.out).toBe("");
			expect(existsSync(f.runtime)).toBe(false);
			expect(f.commands()).toEqual([]);
		}
	} finally {
		await f.cleanup();
	}
}, 15000);

it("explicit origin and port flags override env without persisted configuration", async () => {
	const f = await fixture();
	try {
		await f.release();
		expect(
			(
				await f.run(["start", "--origin", origin, "--port", String(f.port)], {
					C2_PUBLIC_ORIGIN: "invalid",
					C2_PORT: "invalid",
				})
			).code,
		).toBe(0);
		expect(readdirSync(f.runtime).sort()).toEqual([
			"gateway.lock",
			"management.sock",
		]);
		expect(statSync(join(f.runtime, "management.sock")).mode & 0o777).toBe(
			0o600,
		);
	} finally {
		await f.cleanup();
	}
}, 20000);

it("an unmanaged legacy flock cannot be adopted or stopped", async () => {
	const f = await fixture();
	await f.release();
	const legacy = f.spawnCli([], { C2_PUBLIC_ORIGIN: undefined });
	try {
		await expect.poll(() => legacy.output.out).toContain("Pairing code");
		for (const command of ["status", "start", "stop", "restart"]) {
			const result = await f.run([command]);
			expect(result.code).toBe(1);
			expect(result.out + result.err).toContain("unmanaged");
			expect(legacy.child.exitCode).toBeNull();
		}
		expect(f.commands()).toEqual([]);
	} finally {
		legacy.child.kill("SIGTERM");
		expect(await exited(legacy.child)).toBe(0);
		await f.cleanup();
	}
}, 25000);

it("occupied loopback port refuses before Serve mutation and releases only its own lock/socket", async () => {
	const f = await fixture();
	try {
		const result = await f.run(["start"]);
		expect(result.code).toBe(1);
		expect(result.out).toBe("");
		expect(f.commands().filter((args) => args[1] === "--https=443")).toEqual(
			[],
		);
		expect((await f.run(["status"])).out).toContain("stopped");
		expect(existsSync(join(f.runtime, "management.sock"))).toBe(false);
		await f.release();
		expect((await f.run(["start"])).code).toBe(0);
	} finally {
		await f.cleanup();
	}
}, 20000);

it("any preexisting matching/foreign/Funnel route is refused, never adopted or removed", async () => {
	const f = await fixture();
	await f.release();
	try {
		for (const route of [
			{
				Foreground: {
					existing: {
						TCP: { "443": { HTTPS: true } },
						Web: {
							[host + ":443"]: {
								Handlers: { "/": { Proxy: `http://127.0.0.1:${f.port}` } },
							},
						},
					},
				},
			},
			{ TCP: { "80": { HTTP: true } } },
			{ AllowFunnel: { [host + ":443"]: true } },
		]) {
			const text = JSON.stringify(route);
			writeFileSync(join(f.root, "route"), text);
			const result = await f.run(["start"]);
			expect(result.code).toBe(1);
			expect(result.err).toContain("existing-or-ambiguous-serve-config");
			expect(readFileSync(join(f.root, "route"), "utf8")).toBe(text);
		}
		expect(f.commands().filter((args) => args[1] === "--https=443")).toEqual(
			[],
		);
		const stop = await f.run(["stop"]);
		expect(stop.code).toBe(1);
		expect(stop.err).toContain("cleanup-unconfirmed");
		expect(stop.out).toBe("");
	} finally {
		writeFileSync(join(f.root, "route"), "{}");
		await f.cleanup();
	}
}, 20000);

it("malformed/ambiguous/local-self/native-error/timeouts are bounded, redacted and never mutate Serve", async () => {
	const f = await fixture();
	await f.release();
	try {
		for (const mode of [
			"malformed",
			"ambiguous",
			"wrong-self",
			"command-error",
			"status-timeout",
			"status-output-limit",
		]) {
			f.mode(mode);
			const started = Date.now();
			const result = await f.run(["start"]);
			expect(Date.now() - started).toBeLessThan(12000);
			expect(result.code).toBe(1);
			expect(result.out).toBe("");
			expect(result.err).not.toContain("NATIVE-CREDENTIAL-MARKER");
			expect(f.commands().filter((args) => args[1] === "--https=443")).toEqual(
				[],
			);
		}
		f.mode("good");
		expect((await f.run(["start"])).code).toBe(0);
	} finally {
		await f.cleanup();
	}
}, 35000);

it("native consent, early child exit, output overflow, extra route and Funnel never become ready and clean owned children", async () => {
	const f = await fixture();
	await f.release();
	try {
		for (const mode of [
			"consent",
			"early-exit",
			"output-limit",
			"extra-route",
			"funnel",
			"malformed-observed",
		]) {
			f.mode(mode);
			const result = await f.run(["start"]);
			expect(result.code).toBe(1);
			expect(result.out).toBe("");
			expect(result.err).not.toContain("native-secret");
			expect(result.err).not.toContain("NATIVE-CREDENTIAL-MARKER");
			if (mode === "consent")
				expect(result.err).toContain("needs-native-consent");
			expect(
				readdirSync(f.root).filter((name) => name.startsWith("serve-")),
			).toEqual([]);
			expect(await reachable(f.port)).toBe(false);
			expect(readFileSync(join(f.root, "route"), "utf8")).toBe("{}");
		}
		f.mode("good");
		expect((await f.run(["start"])).code).toBe(0);
	} finally {
		await f.cleanup();
	}
}, 30000);

it("starting is redacted until HTTP and exact foreground route are both ready; startup owner death leaves no child", async () => {
	const f = await fixture();
	await f.release();
	try {
		f.mode("delayed-route");
		const launched = f.spawnCli(["start"]);
		await expect
			.poll(
				() => readdirSync(f.root).some((name) => name.startsWith("serve-")),
				{ timeout: 5000 },
			)
			.toBe(true);
		expect((await http(f.port)).status).toBe(200);
		expect((await f.run(["status"])).out).toBe("Pi companion: starting\n");
		expect(launched.output.out).toBe("");
		expect(await exited(launched.child)).toBe(0);
		expect(launched.output.out).toBe(`Pi companion: ready ${origin}\n`);
		expect((await f.run(["stop"])).code).toBe(0);
		const caller = f.spawnCli(["start"]);
		await expect
			.poll(
				() => readdirSync(f.root).some((name) => name.startsWith("serve-")),
				{ timeout: 5000 },
			)
			.toBe(true);
		caller.child.kill("SIGKILL");
		await exited(caller.child);
		await expect
			.poll(async () => (await f.run(["status"])).out, { timeout: 5000 })
			.toBe(
				`Pi companion: ready ${origin}\nTerminal discovery: ready; 0 live terminals\n`,
			);
		expect((await f.run(["stop"])).code).toBe(0);
		const owner = f.spawnCli(["start"], { C2_MANAGED_OWNER: "1" }, true);
		await expect
			.poll(
				() => readdirSync(f.root).some((name) => name.startsWith("serve-")),
				{ timeout: 5000 },
			)
			.toBe(true);
		const serveFile = readdirSync(f.root).find((name) =>
			name.startsWith("serve-"),
		)!;
		const record = JSON.parse(readFileSync(join(f.root, serveFile), "utf8"));
		expect(owner.output.out).toBe("");
		owner.child.kill("SIGKILL");
		await exited(owner.child);
		await expect
			.poll(
				() => readdirSync(f.root).filter((name) => name.startsWith("serve-")),
				{ timeout: 5000 },
			)
			.toEqual([]);
		await expect
			.poll(
				() => {
					try {
						process.kill(record.guardian, 0);
						return true;
					} catch {
						return false;
					}
				},
				{ timeout: 5000 },
			)
			.toBe(false);
		await delay(1700); // A killed setup must not publish a delayed route later.
		expect(readFileSync(join(f.root, "route"), "utf8")).toBe("{}");
		expect(await reachable(f.port)).toBe(false);
	} finally {
		await f.cleanup();
	}
}, 25000);

it("unavailable native executable stays inside fixture PATH and fails bounded before mutation", async () => {
	const f = await fixture();
	await f.release();
	const bin = join(f.root, "tailscale");
	try {
		f.mode("unavailable-command");
		renameSync(bin, bin + ".held");
		const result = await f.run(["start"]);
		expect(result.code).toBe(1);
		expect(result.out).toBe("");
		expect(result.err).toContain("native-unavailable");
		expect(f.commands()).toEqual([]);
		expect(await reachable(f.port)).toBe(false);
	} finally {
		if (existsSync(bin + ".held")) renameSync(bin + ".held", bin);
		await f.cleanup();
	}
}, 15000);

async function directOwner(f: Awaited<ReturnType<typeof fixture>>) {
	const owner = f.spawnCli(["start"], { C2_MANAGED_OWNER: "1" }, true);
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Direct fixture owner readiness timeout")),
			12000,
		);
		owner.child.on("message", (value: any) => {
			if (value.event === "ready") {
				clearTimeout(timer);
				resolve();
			}
		});
		owner.child.once("exit", () => {
			clearTimeout(timer);
			reject(new Error("Direct fixture owner exited"));
		});
	});
	return owner;
}
it.each([
	["status", "SIGTERM"],
	["status", "SIGKILL"],
	["stop", "SIGTERM"],
	["stop", "SIGKILL"],
] as const)(
	"hung native inspection dies with CLI caller %s/%s",
	async (command, signal) => {
		const f = await fixture();
		await f.release();
		try {
			f.mode("status-timeout");
			const caller = f.spawnCli([command]);
			await expect
				.poll(
					() =>
						f
							.nativeChildren()
							.some(
								(record) => record.kind === "inspection" && alive(record.pid),
							),
					{ timeout: 5000 },
				)
				.toBe(true);
			caller.child.kill(signal);
			await exited(caller.child);
			await f.nativeReleased();
			expect(caller.output.out).toBe("");
			expect(caller.output.err).not.toContain("NATIVE-CREDENTIAL-MARKER");
			expect(await reachable(f.port)).toBe(false);
			expect(readFileSync(join(f.root, "route"), "utf8")).toBe("{}");
		} finally {
			await f.cleanup();
		}
	},
	20000,
);

it.each([
	["status-timeout", "SIGTERM"],
	["status-timeout", "SIGKILL"],
	["self-timeout", "SIGTERM"],
	["self-timeout", "SIGKILL"],
] as const)(
	"hung native inspection dies with startup owner %s/%s",
	async (mode, signal) => {
		const f = await fixture();
		await f.release();
		try {
			f.mode(mode);
			const owner = f.spawnCli(["start"], { C2_MANAGED_OWNER: "1" }, true);
			const command =
				mode === "self-timeout" ? "status --json" : "serve status --json";
			await expect
				.poll(
					() =>
						f
							.nativeChildren()
							.some(
								(record) =>
									record.args.join(" ") === command && alive(record.pid),
							),
					{ timeout: 5000 },
				)
				.toBe(true);
			owner.child.kill(signal);
			await exited(owner.child);
			await f.nativeReleased();
			expect(owner.output.out + owner.output.err).toBe("");
			expect(await reachable(f.port)).toBe(false);
			await delay(200);
			expect(f.commands().some((args) => args[1] === "--https=443")).toBe(
				false,
			);
			expect(readFileSync(join(f.root, "route"), "utf8")).toBe("{}");
		} finally {
			await f.cleanup();
		}
	},
	20000,
);

it.each(["SIGTERM", "SIGKILL"] as const)(
	"hung native inspection and foreground Serve die with ready owner %s",
	async (signal) => {
		const f = await fixture();
		await f.release();
		try {
			const owner = await directOwner(f),
				before = f.nativeChildren().length;
			f.mode("status-timeout");
			const caller = f.spawnCli(["status"]);
			await expect
				.poll(
					() =>
						f
							.nativeChildren()
							.slice(before)
							.some(
								(record) => record.kind === "inspection" && alive(record.pid),
							),
					{ timeout: 5000 },
				)
				.toBe(true);
			owner.child.kill(signal);
			await exited(owner.child);
			await exited(caller.child);
			await f.nativeReleased();
			expect(caller.output.out + caller.output.err).not.toContain("ready");
			expect(owner.output.out + owner.output.err).toBe("");
			expect(await reachable(f.port)).toBe(false);
			expect(readFileSync(join(f.root, "route"), "utf8")).toBe("{}");
			await delay(200);
			expect(
				f.commands().filter((args) => args[1] === "--https=443"),
			).toHaveLength(1);
		} finally {
			await f.cleanup();
		}
	},
	25000,
);

it("managed-owner SIGTERM and SIGKILL clean foreground Serve; crash restart retains lock inode without orphan", async () => {
	const f = await fixture();
	await f.release();
	try {
		let inode: number | undefined;
		for (const signal of ["SIGTERM", "SIGKILL"] as const) {
			const owner = await directOwner(f);
			const current = statSync(join(f.runtime, "gateway.lock")).ino;
			inode ??= current;
			expect(current).toBe(inode);
			expect(owner.output.out + owner.output.err).toBe("");
			const pidFile = readdirSync(f.root).find((name) =>
				name.startsWith("serve-"),
			)!;
			const record = JSON.parse(readFileSync(join(f.root, pidFile), "utf8"));
			owner.child.kill(signal);
			await exited(owner.child);
			await expect
				.poll(() => existsSync(join(f.root, pidFile)), { timeout: 5000 })
				.toBe(false);
			await expect
				.poll(
					() => {
						try {
							process.kill(record.guardian, 0);
							return true;
						} catch {
							return false;
						}
					},
					{ timeout: 5000 },
				)
				.toBe(false);
			expect(await reachable(f.port)).toBe(false);
			expect(readFileSync(join(f.root, "route"), "utf8")).toBe("{}");
			expect((await f.run(["status"])).out).toContain("stopped");
		}
		expect((await f.run(["start"])).code).toBe(0);
		expect(statSync(join(f.runtime, "gateway.lock")).ino).toBe(inode);
	} finally {
		await f.cleanup();
	}
}, 30000);

it("unexpected foreground Serve exit invalidates readiness and shuts gateway down, without retry", async () => {
	const f = await fixture();
	await f.release();
	try {
		const owner = await directOwner(f);
		const file = readdirSync(f.root).find((name) => name.startsWith("serve-"))!;
		const record = JSON.parse(readFileSync(join(f.root, file), "utf8"));
		process.kill(record.pid, "SIGTERM");
		expect(await exited(owner.child)).toBe(1);
		expect((await f.run(["status"])).out).toContain("stopped");
		expect(await reachable(f.port)).toBe(false);
		expect(
			f.commands().filter((args) => args[1] === "--https=443"),
		).toHaveLength(1);
	} finally {
		await f.cleanup();
	}
}, 20000);

it("stale owner-only management socket is reclaimed only under flock; active and unsafe resources are untouched", async () => {
	const f = await fixture();
	await f.release();
	let active: Server | undefined;
	try {
		await f.run(["status"]);
		const path = join(f.runtime, "management.sock");
		for (const kind of ["file", "symlink", "bad-mode", "active", "stale"]) {
			if (kind === "file") writeFileSync(path, "foreign", { mode: 0o600 });
			if (kind === "symlink")
				symlinkSync(join(f.runtime, "gateway.lock"), path);
			if (["bad-mode", "active"].includes(kind)) {
				active = createServer((socket) => socket.destroy());
				await new Promise<void>((r) => active!.listen(path, r));
				chmodSync(path, kind === "bad-mode" ? 0o666 : 0o600);
			}
			if (kind === "stale") {
				const child = spawn(
					process.execPath,
					[
						"-e",
						`const n=require('node:net'),f=require('node:fs');n.createServer().listen(${JSON.stringify(path)},()=>{f.chmodSync(${JSON.stringify(path)},0o600);console.log('ready')})`,
					],
					{ env: f.env, stdio: ["ignore", "pipe", "pipe"] },
				);
				await new Promise<void>((r) => child.stdout!.once("data", () => r()));
				child.kill("SIGKILL");
				await exited(child);
			}
			const ino = lstatSync(path).ino;
			const result = await f.run(["start"]);
			if (kind === "stale") {
				expect(result.code).toBe(0);
				expect(lstatSync(path).isSocket()).toBe(true);
				await f.run(["stop"]);
			} else {
				expect(result.code).toBe(1);
				expect(lstatSync(path).ino).toBe(ino);
				expect(
					f.commands().filter((args) => args[1] === "--https=443"),
				).toEqual([]);
				expect((await f.run(["status"])).code).toBe(1);
			}
			if (active) {
				await new Promise<void>((r) => active!.close(() => r()));
				active = undefined;
			}
			rmSync(path, { force: true });
		}
	} finally {
		if (active) await new Promise<void>((r) => active!.close(() => r()));
		rmSync(join(f.runtime, "management.sock"), { force: true });
		await f.cleanup();
	}
}, 30000);

it.each(["stop", "restart"])(
	"failed native cleanup never reports stopped or launches replacement via %s, even after gateway flock release",
	async (command) => {
		const f = await fixture();
		await f.release();
		try {
			expect((await f.run(["start"])).code).toBe(0);
			f.mode("cleanup-failure");
			const stopped = await f.run([command]);
			expect(stopped.code).toBe(1);
			expect(stopped.out).toBe("");
			expect(stopped.err).toContain("cleanup-unconfirmed");
			expect((await f.run(["status"])).out).toBe("Pi companion: unavailable\n");
			const unavailableRestart = await f.run(["restart"]);
			expect(unavailableRestart.code).toBe(1);
			expect(unavailableRestart.err).toContain("runtime-not-ready");
			expect(unavailableRestart.out).toBe("");
			expect(await reachable(f.port)).toBe(false);
			expect(
				readdirSync(f.root).filter((name) => name.startsWith("serve-")),
			).toEqual([]);
			expect(readFileSync(join(f.root, "route"), "utf8")).not.toBe("{}");
			expect(
				f.commands().filter((args) => args[1] === "--https=443"),
			).toHaveLength(1);
		} finally {
			writeFileSync(join(f.root, "route"), "{}");
			await f.cleanup();
		}
	},
	20000,
);

it("private IPC rejects oversized/unknown requests and route drift, never retaining stale ready", async () => {
	const f = await fixture();
	await f.release();
	try {
		expect((await f.run(["start"])).code).toBe(0);
		for (const body of ["x".repeat(65), "unknown\n", "pair\nstatus\n"]) {
			const text = await new Promise<string>((resolve, reject) => {
				const socket = createConnection(join(f.runtime, "management.sock"));
				let text = "";
				socket.on("data", (chunk) => {
					text += chunk;
				});
				socket.on("error", reject);
				socket.once("connect", () => socket.end(body));
				socket.once("close", () => resolve(text));
			});
			expect(text).toBe("");
		}
		const admitted: ReturnType<typeof createConnection>[] = [];
		try {
			for (let i = 0; i < 8; i++) {
				const socket = createConnection(join(f.runtime, "management.sock"));
				admitted.push(socket);
				await new Promise<void>((resolve, reject) => {
					socket.once("connect", resolve);
					socket.once("error", reject);
				});
			}
			await delay(50);
			await new Promise<void>((resolve, reject) => {
				const ninth = createConnection(join(f.runtime, "management.sock"));
				admitted.push(ninth);
				const timer = setTimeout(() => {
					ninth.destroy();
					reject(new Error("Unbounded IPC admission"));
				}, 1000);
				ninth.once("error", reject);
				ninth.once("close", () => {
					clearTimeout(timer);
					resolve();
				});
			});
		} finally {
			for (const socket of admitted) socket.destroy();
		}
		expect((await f.run(["status"])).out).toContain("ready");
		writeFileSync(join(f.root, "route"), JSON.stringify({ Web: {} }));
		const result = await f.run(["status"]);
		expect(result.code).toBe(1);
		expect(result.out + result.err).not.toContain("ready");
		await expect.poll(() => reachable(f.port), { timeout: 5000 }).toBe(false);
	} finally {
		await f.cleanup();
	}
}, 25000);

it("P2 real management TTY codes replace single-use authority; durable devices survive true owner restart and local revoke/browser forget do not", async () => {
	const f = await fixture();
	try {
		await f.release();
		expect((await f.run(["start"])).code).toBe(0);
		const oldCode = await f.ptyPair(),
			code = await f.ptyPair();
		expect(code).not.toBe(oldCode);
		expect(
			(await http(f.port, "/api/pair", { code: oldCode, remember: true }))
				.status,
		).toBe(401);
		const remembered = await http(f.port, "/api/pair", {
			code,
			remember: true,
		});
		expect(remembered.status).toBe(200);
		expect(JSON.parse(remembered.body)).toEqual({ paired: true });
		expect(
			(await http(f.port, "/api/pair", { code, remember: true })).status,
		).toBe(401);
		const temporary = await http(f.port, "/api/pair", {
			code: await f.ptyPair(),
			remember: false,
		});
		expect(temporary.status).toBe(200);
		const list = await f.run(["devices"]);
		expect(list.code).toBe(0);
		const devices = JSON.parse(list.out);
		expect(devices).toHaveLength(2);
		for (const device of devices)
			expect(Object.keys(device).sort()).toEqual(["created", "expires", "id"]);
		expect(list.out).not.toContain(remembered.cookie!.split("=")[1]);
		const id = devices.find(
			(device: { created: number; expires: number }) =>
				device.expires - device.created === 30 * 24 * 60 * 60 * 1000,
		).id;
		expect((await f.run(["revoke", id.slice(0, -1)])).code).toBe(1);
		expect((await f.run(["stop"])).code).toBe(0);
		await f.nativeReleased();
		expect((await f.run(["start"])).code).toBe(0);
		expect(
			f.commands().filter((args) => args[1] === "--https=443"),
		).toHaveLength(2); // Distinct real owner/guardian process, not an in-memory recreation.
		expect(
			(await http(f.port, "/api/snapshot", undefined, remembered.cookie))
				.status,
		).toBe(200);
		expect(
			(await http(f.port, "/api/snapshot", undefined, temporary.cookie)).status,
		).toBe(401);
		expect(
			JSON.parse((await f.run(["devices"])).out).map(
				(device: { id: string }) => device.id,
			),
		).toEqual([id]);
		expect(await f.run(["revoke", id])).toEqual({
			code: 0,
			out: "Pi companion: revoked\n",
			err: "",
		});
		expect(
			(await http(f.port, "/api/snapshot", undefined, remembered.cookie))
				.status,
		).toBe(401);
		const forgotten = await http(f.port, "/api/pair", {
			code: await f.ptyPair(),
			remember: true,
		});
		expect(forgotten.status).toBe(200);
		expect(
			(await http(f.port, "/api/forget", {}, forgotten.cookie)).status,
		).toBe(200);
		expect(JSON.parse((await f.run(["devices"])).out)).toEqual([]);
		expect((await f.run(["stop"])).code).toBe(0);
		expect((await f.run(["start"])).code).toBe(0);
		for (const cookie of [
			remembered.cookie,
			forgotten.cookie,
			temporary.cookie,
		])
			expect(
				(await http(f.port, "/api/snapshot", undefined, cookie)).status,
			).toBe(401);
		// Reissue does not reset the real gateway's ten exchanges/minute window.
		for (let i = 0; i < 10; i++) {
			const fresh = await f.ptyPair();
			expect(
				(
					await http(f.port, "/api/pair", {
						code: fresh === "000000" ? "000001" : "000000",
						remember: false,
					})
				).status,
			).toBe(401);
		}
		expect(
			(
				await http(f.port, "/api/pair", {
					code: await f.ptyPair(),
					remember: false,
				})
			).status,
		).toBe(429);
		expect((await f.run(["stop"])).code).toBe(0);
		for (const command of [["devices"], ["revoke", id], ["pair"]])
			expect((await f.run(command)).code).toBe(1);
	} finally {
		await f.cleanup();
	}
}, 45000);

it("no-argument restart preserves observed origin/port/runtime/auth and surviving bridge; refuses stopped and reports replacement failure", async () => {
	const f = await fixture();
	const bridge = createBridge(f.runtime);
	try {
		await f.release();
		await f.run(["status"]);
		await bridge.start(context());
		const stopped = await f.run(["restart"]);
		expect(stopped.code).toBe(1);
		expect(stopped.err).toContain("runtime-not-ready");
		expect(f.commands().filter((args) => args[1] === "--https=443")).toEqual(
			[],
		);
		const owner = await directOwner(f);
		const inode = statSync(join(f.runtime, "gateway.lock")).ino;
		const remembered = await http(f.port, "/api/pair", {
			code: await f.ptyPair(),
			remember: true,
		});
		expect(remembered.status).toBe(200);
		const before = f
			.nativeChildren()
			.filter((record) => record.kind === "serve");
		const otherAuth = join(f.root, "unused-auth");
		const restart = await f.run(["restart"], {
			C2_PUBLIC_ORIGIN: "invalid",
			C2_PORT: "invalid",
			C2_AUTH_DIR: otherAuth,
		});
		expect(restart).toEqual({
			code: 0,
			out: `Pi companion: ready ${origin}\n`,
			err: "",
		});
		expect(await exited(owner.child)).toBe(0);
		expect(alive(owner.child.pid!)).toBe(false);
		const after = f
			.nativeChildren()
			.filter((record) => record.kind === "serve");
		expect(after).toHaveLength(2);
		expect(after[1].pid).not.toBe(before[0].pid);
		expect(after[1].guardian).not.toBe(before[0].guardian);
		expect(after[1].args).toEqual([
			"serve",
			"--https=443",
			`http://127.0.0.1:${f.port}`,
		]);
		expect(statSync(join(f.runtime, "gateway.lock")).ino).toBe(inode);
		expect(existsSync(otherAuth)).toBe(false);
		const snapshot = await http(
			f.port,
			"/api/snapshot",
			undefined,
			remembered.cookie,
		);
		expect(snapshot.status).toBe(200);
		expect((await discover(f.runtime)).peers).toHaveLength(1);
		expect((await f.run(["status"])).out).toBe(
			`Pi companion: ready ${origin}\nTerminal discovery: ready; 1 live terminals\n`,
		);
		f.mode("early-exit");
		const failed = await f.run(["restart"]);
		expect(failed.code).toBe(1);
		expect(failed.out).toBe("");
		expect(failed.err).not.toContain("NATIVE-CREDENTIAL-MARKER");
		expect(await reachable(f.port)).toBe(false);
		expect((await discover(f.runtime)).peers).toHaveLength(1);
	} finally {
		await bridge.close();
		await f.cleanup();
	}
}, 30000);
