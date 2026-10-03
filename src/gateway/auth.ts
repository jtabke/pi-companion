import {
	createHash,
	randomBytes,
	randomInt,
	timingSafeEqual,
} from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { ownerOpen, ownerStat } from "../shared/runtime.js";

type Device = { id: string; created: number; expires: number };
type RememberedDevice = Device & { tokenHash: string };
type State = { version: 1; devices: RememberedDevice[] };
type PairResult =
	| { paired: true; token: string; expires: number; remembered: boolean }
	| { paired: false; reason: "invalid-code" | "rate-limit" | "session-limit" };
const codeLifetime = 5 * 60_000,
	temporaryLifetime = 8 * 60 * 60_000,
	rememberedLifetime = 30 * 24 * 60 * 60_000,
	stateBytes = 4096;
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const absent = (error: unknown) =>
	(error as NodeJS.ErrnoException).code === "ENOENT";
const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
function keys(value: Record<string, unknown>, expected: string[]) {
	return Object.keys(value).sort().join() === expected.sort().join();
}
function parseState(text: string): State {
	const state: unknown = JSON.parse(text);
	if (
		!object(state) ||
		!keys(state, ["version", "devices"]) ||
		state.version !== 1 ||
		!Array.isArray(state.devices) ||
		state.devices.length > 8
	)
		throw new Error("Invalid credential state");
	const ids = new Set<string>(),
		hashes = new Set<string>();
	for (const device of state.devices) {
		if (
			!object(device) ||
			!keys(device, ["id", "tokenHash", "created", "expires"]) ||
			typeof device.id !== "string" ||
			!/^[a-f0-9]{32}$/.test(device.id) ||
			typeof device.tokenHash !== "string" ||
			!/^[a-f0-9]{64}$/.test(device.tokenHash) ||
			typeof device.created !== "number" ||
			!Number.isSafeInteger(device.created) ||
			device.created < 0 ||
			typeof device.expires !== "number" ||
			!Number.isSafeInteger(device.expires) ||
			device.expires > 8.64e15 ||
			device.expires - device.created !== rememberedLifetime ||
			ids.has(device.id) ||
			hashes.has(device.tokenHash)
		)
			throw new Error("Invalid credential state");
		ids.add(device.id);
		hashes.add(device.tokenHash);
	}
	// Only our v1 encoding is supported. This also refuses duplicate JSON keys
	// instead of allowing JSON.parse to silently overwrite credential fields.
	if (text !== JSON.stringify(state) + "\n")
		throw new Error("Invalid credential encoding");
	return state as State;
}

// One synchronous owner per gateway runtime (the gateway lifetime lock is held
// by the caller). Local management alone calls issueCode/devices/revoke.
export function authentication(options: {
	stateDirectory: string;
	origin: string;
	runtime: string;
}) {
	if (!isAbsolute(options.stateDirectory) || !isAbsolute(options.runtime))
		throw new Error("Authentication paths must be absolute");
	if (
		options.origin.length > 2048 ||
		new URL(options.origin).origin !== options.origin ||
		!["http:", "https:"].includes(new URL(options.origin).protocol)
	)
		throw new Error("Authentication requires an exact origin");
	ownerStat(options.runtime, "directory");
	const runtime = realpathSync(options.runtime);
	const directory = join(
		realpathSync(dirname(options.stateDirectory)),
		basename(options.stateDirectory),
	);
	let madeDirectory = false;
	try {
		mkdirSync(directory, { mode: 0o700 });
		madeDirectory = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const initialDirectory = ownerStat(directory, "directory");
	if ((initialDirectory.mode & 0o7777) !== 0o700)
		throw new Error("Unsafe credential directory");
	function flushDirectory(path: string) {
		const fd = openSync(
			path,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	}
	if (madeDirectory) flushDirectory(dirname(directory));
	const path = join(
		directory,
		`auth-${hash(JSON.stringify([options.origin, runtime]))}.json`,
	);
	const sessions = new Map<string, number>();
	const temporary = new Map<string, Device>();
	let records: RememberedDevice[] = [],
		unavailable = false;
	let code: { value: string; expires: number; guesses: number } | undefined;
	let attemptWindow = Date.now(),
		attempts = 0;
	function checkDirectory() {
		const stat = ownerStat(directory, "directory");
		if (
			(stat.mode & 0o7777) !== 0o700 ||
			stat.ino !== initialDirectory.ino ||
			stat.dev !== initialDirectory.dev
		)
			throw new Error("Unsafe credential directory");
	}
	function readState(): RememberedDevice[] {
		checkDirectory();
		let fd: number;
		try {
			fd = ownerOpen(path);
		} catch (error) {
			if (absent(error)) return [];
			throw error;
		}
		try {
			const stat = fstatSync(fd);
			if ((stat.mode & 0o7777) !== 0o600 || stat.size > stateBytes)
				throw new Error("Unsafe credential file");
			// Bounded even if the file grows after fstat; never read arbitrary bytes.
			const buffer = Buffer.alloc(stateBytes + 1);
			let size = 0,
				count: number;
			while (
				size < buffer.length &&
				(count = readSync(fd, buffer, size, buffer.length - size, size)) > 0
			)
				size += count;
			if (size > stateBytes) throw new Error("Credential state exceeds limit");
			return parseState(buffer.subarray(0, size).toString("utf8")).devices;
		} finally {
			closeSync(fd);
		}
	}
	function failClosed(): never {
		unavailable = true;
		code = undefined;
		sessions.clear();
		temporary.clear();
		records = [];
		throw new Error("Credential state unavailable");
	}
	function load() {
		if (unavailable) failClosed();
		try {
			records = readState();
		} catch {
			failClosed();
		}
		for (const token of sessions.keys())
			if (
				!temporary.has(token) &&
				!records.some((record) => record.tokenHash === hash(token))
			)
				sessions.delete(token);
	}
	function persist(next: RememberedDevice[]) {
		const text =
			JSON.stringify({ version: 1, devices: next } satisfies State) + "\n";
		parseState(text);
		const staging = join(
			directory,
			`.auth-${randomBytes(16).toString("hex")}.tmp`,
		);
		let fd: number | undefined,
			created = false;
		try {
			// Never replace malformed/unsafe existing state, including after startup.
			readState();
			fd = openSync(
				staging,
				constants.O_WRONLY |
					constants.O_CREAT |
					constants.O_EXCL |
					constants.O_NOFOLLOW,
				0o600,
			);
			created = true;
			const stat = fstatSync(fd);
			if (
				stat.uid !== process.getuid!() ||
				(stat.mode & 0o7777) !== 0o600 ||
				stat.nlink !== 1
			)
				throw new Error("Unsafe credential staging file");
			writeFileSync(fd, text, "utf8");
			fsyncSync(fd);
			closeSync(fd);
			fd = undefined;
			readState();
			renameSync(staging, path);
			created = false;
			flushDirectory(directory);
			records = next;
		} catch {
			failClosed();
		} finally {
			if (fd !== undefined) closeSync(fd);
			if (created) {
				try {
					unlinkSync(staging);
				} catch {
					/* Only our failed staging file; never erase unrelated files. */
				}
			}
		}
	}
	function removeRecord(record: RememberedDevice) {
		persist(records.filter((candidate) => candidate.id !== record.id));
		for (const token of sessions.keys())
			if (hash(token) === record.tokenHash) sessions.delete(token);
	}
	load();
	return {
		// P2 may read this exact Map for controllers.reconcile; only this owner mutates it.
		sessions,
		issueCode(): { code: string; expires: number } {
			load();
			let value: string;
			do {
				value = randomInt(1_000_000).toString().padStart(6, "0");
			} while (value === code?.value);
			code = { value, expires: Date.now() + codeLifetime, guesses: 0 };
			return { code: value, expires: code.expires };
		},
		pair(given: string, remember: boolean): PairResult {
			load();
			const now = Date.now();
			if (now - attemptWindow >= 60_000) {
				attemptWindow = now;
				attempts = 0;
			}
			if (attempts >= 10) return { paired: false, reason: "rate-limit" };
			attempts++;
			if (code && code.expires <= now) code = undefined;
			if (!code) return { paired: false, reason: "invalid-code" };
			if (
				typeof given !== "string" ||
				!/^[0-9]{6}$/.test(given) ||
				!timingSafeEqual(Buffer.from(given), Buffer.from(code.value))
			) {
				if (++code.guesses >= 5) code = undefined;
				return { paired: false, reason: "invalid-code" };
			}
			// Consume before capacity checks or durable writes; no second exchange can reuse it.
			code = undefined;
			for (const [token, device] of temporary)
				if (device.expires < now) {
					temporary.delete(token);
					sessions.delete(token);
				}
			const liveRecords = records.filter((record) => record.expires >= now);
			if (liveRecords.length + temporary.size >= 8)
				return { paired: false, reason: "session-limit" };
			const token = randomBytes(32).toString("hex");
			const device = {
				id: randomBytes(16).toString("hex"),
				created: now,
				expires: now + (remember ? rememberedLifetime : temporaryLifetime),
			};
			if (remember)
				persist([...liveRecords, { ...device, tokenHash: hash(token) }]);
			else temporary.set(token, device);
			// Retired expired remembered records must not leave raw tokens in the active map.
			for (const active of sessions.keys())
				if (
					!temporary.has(active) &&
					!records.some((record) => record.tokenHash === hash(active))
				)
					sessions.delete(active);
			sessions.set(token, device.expires);
			return {
				paired: true,
				token,
				expires: device.expires,
				remembered: remember,
			};
		},
		// Return the expiry, not an authorization boolean: callers keep their
		// established read '< now' versus mutation '<= now' equality policy.
		expiry(token: string): number | undefined {
			load();
			if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
				return undefined;
			const active = sessions.get(token);
			if (active !== undefined) return active;
			const record = records.find(
				(candidate) => candidate.tokenHash === hash(token),
			);
			if (record) {
				if (record.expires >= Date.now()) sessions.set(token, record.expires);
				return record.expires;
			}
			return undefined;
		},
		devices(): Device[] {
			load();
			return [...records, ...temporary.values()]
				.filter((device) => device.expires >= Date.now())
				.map(({ id, created, expires }) => ({ id, created, expires }));
		},
		revoke(id: string): boolean {
			load();
			const record = records.find((candidate) => candidate.id === id);
			if (record) {
				removeRecord(record);
				return true;
			}
			for (const [token, device] of temporary)
				if (device.id === id) {
					temporary.delete(token);
					sessions.delete(token);
					return true;
				}
			return false;
		},
		forget(token: string): boolean {
			load();
			if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
				return false;
			const record = records.find(
				(candidate) => candidate.tokenHash === hash(token),
			);
			if (record) {
				removeRecord(record);
				return true;
			}
			if (!temporary.delete(token)) return false;
			sessions.delete(token);
			return true;
		},
	};
}
