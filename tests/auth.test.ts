import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { authentication } from "../src/gateway/auth.js";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		fsyncSync: vi.fn(actual.fsyncSync),
		renameSync: vi.fn(actual.renameSync),
		fstatSync: vi.fn(actual.fstatSync),
	};
});
const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const roots: string[] = [];
const origin = "http://127.0.0.1:4317",
	start = 1_750_000_000_000;
const hour = 60 * 60_000,
	day = 24 * hour;
function fixture() {
	const root = fs.mkdtempSync(join(tmpdir(), "c2-auth-"));
	roots.push(root);
	fs.chmodSync(root, 0o700);
	const stateDirectory = join(root, "state"),
		runtime = join(root, "runtime");
	fs.mkdirSync(stateDirectory, { mode: 0o700 });
	fs.mkdirSync(runtime, { mode: 0o700 });
	const options = { stateDirectory, runtime, origin };
	return { root, options, owner: authentication(options) };
}
function pair(owner: ReturnType<typeof authentication>, remember = true) {
	const result = owner.pair(owner.issueCode().code, remember);
	expect(result.paired).toBe(true);
	if (!result.paired) throw new Error("Fixture pairing refused");
	return result;
}
function stateFile(stateDirectory: string) {
	const names = fs
		.readdirSync(stateDirectory)
		.filter((name) => /^auth-.*\.json$/.test(name));
	expect(names).toHaveLength(1);
	return join(stateDirectory, names[0]);
}
function wrong(code: string) {
	return code === "000000" ? "000001" : "000000";
}
function writeState(path: string, state: unknown) {
	fs.writeFileSync(path, JSON.stringify(state) + "\n", { mode: 0o600 });
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(start);
});
afterEach(() => {
	vi.useRealTimers();
	vi.mocked(fs.fsyncSync).mockReset().mockImplementation(actualFs.fsyncSync);
	vi.mocked(fs.renameSync).mockReset().mockImplementation(actualFs.renameSync);
	vi.mocked(fs.fstatSync).mockReset().mockImplementation(actualFs.fstatSync);
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

describe("authentication code exchange", () => {
	it("issues six-digit codes, replaces the previous code and consumes exactly once", () => {
		const { owner } = fixture();
		const first = owner.issueCode(),
			second = owner.issueCode();
		expect(first.code).toMatch(/^\d{6}$/);
		expect(first.expires).toBe(start + 5 * 60_000);
		expect(second.code).not.toBe(first.code);
		expect(owner.pair(first.code, false)).toEqual({
			paired: false,
			reason: "invalid-code",
		});
		const result = owner.pair(second.code, false);
		expect(result.paired).toBe(true);
		expect(owner.pair(second.code, false)).toEqual({
			paired: false,
			reason: "invalid-code",
		});
		expect(owner.devices()).toHaveLength(1);
	});
	it("expires codes at five minutes including equality", () => {
		const { owner } = fixture();
		const code = owner.issueCode();
		vi.setSystemTime(code.expires);
		expect(owner.pair(code.code, true)).toEqual({
			paired: false,
			reason: "invalid-code",
		});
		expect(owner.sessions.size).toBe(0);
	});
	it("invalidates after five wrong guesses, but admits a correct fifth exchange", () => {
		const { owner } = fixture();
		const code = owner.issueCode().code;
		for (let i = 0; i < 5; i++)
			expect(owner.pair(wrong(code), false).paired).toBe(false);
		expect(owner.pair(code, false)).toEqual({
			paired: false,
			reason: "invalid-code",
		});
		vi.setSystemTime(start + 60_000);
		const next = owner.issueCode().code;
		for (let i = 0; i < 4; i++)
			expect(owner.pair(wrong(next), false).paired).toBe(false);
		expect(owner.pair(next, false).paired).toBe(true);
	});
	it("preserves ten-attempt global limits across reissue, successful and missing-code exchanges", () => {
		const { owner } = fixture();
		expect(owner.pair("123456", false).paired).toBe(false);
		pair(owner, false);
		for (let i = 0; i < 8; i++) {
			const code = owner.issueCode().code;
			expect(owner.pair(wrong(code), false)).toEqual({
				paired: false,
				reason: "invalid-code",
			});
		}
		const current = owner.issueCode().code;
		expect(owner.pair(current, false)).toEqual({
			paired: false,
			reason: "rate-limit",
		});
		vi.setSystemTime(start + 59_999);
		expect(owner.pair(current, false)).toEqual({
			paired: false,
			reason: "rate-limit",
		});
		vi.setSystemTime(start + 60_000);
		expect(owner.pair(current, false).paired).toBe(true);
	});
});

describe("remembered trust and temporary sessions", () => {
	it("starts empty in an explicit missing owner-only state directory and never stores issued codes", () => {
		const { options, root } = fixture();
		const stateDirectory = join(root, "new-state");
		const owner = authentication({ ...options, stateDirectory });
		expect(owner.devices()).toEqual([]);
		expect(owner.expiry("a".repeat(64))).toBeUndefined();
		owner.issueCode();
		expect(fs.readdirSync(stateDirectory)).toEqual([]);
		expect(fs.statSync(stateDirectory).mode & 0o777).toBe(0o700);
		pair(owner);
		expect(fs.statSync(stateFile(stateDirectory)).mode & 0o777).toBe(0o600);
	});
	it("stores only bounded hash records in 0600 files and restores lazily for a fixed 30 days", () => {
		const { owner, options } = fixture();
		const code = owner.issueCode().code,
			result = owner.pair(code, true);
		if (!result.paired) throw new Error("Pairing failed");
		expect(result.token).toMatch(/^[a-f0-9]{64}$/);
		expect(result.expires).toBe(start + 30 * day);
		const path = stateFile(options.stateDirectory),
			bytes = fs.readFileSync(path, "utf8"),
			state = JSON.parse(bytes);
		expect(bytes).not.toContain(result.token);
		expect(bytes).not.toContain(`"code"`);
		expect(state).toEqual({
			version: 1,
			devices: [
				{
					...owner.devices()[0],
					tokenHash: createHash("sha256").update(result.token).digest("hex"),
				},
			],
		});
		expect(Buffer.byteLength(bytes)).toBeLessThan(4096);
		expect(fs.statSync(path).mode & 0o777).toBe(0o600);
		expect(fs.statSync(options.stateDirectory).mode & 0o777).toBe(0o700);
		expect(fs.readdirSync(options.stateDirectory)).toHaveLength(1);
		const restarted = authentication(options);
		expect(restarted.sessions.size).toBe(0);
		vi.setSystemTime(start + 29 * day);
		expect(restarted.expiry(result.token)).toBe(result.expires);
		expect(restarted.sessions.get(result.token)).toBe(result.expires);
		vi.setSystemTime(result.expires);
		expect(restarted.expiry(result.token)).toBe(result.expires);
		vi.setSystemTime(result.expires + 1);
		const expiredRestart = authentication(options);
		expect(expiredRestart.expiry(result.token)).toBe(result.expires);
		expect(expiredRestart.sessions.size).toBe(0);
		expect(expiredRestart.devices()).toEqual([]);
	});
	it("keeps unchecked trust for eight hours only in this process and preserves expiry equality for callers", () => {
		const { owner, options } = fixture();
		const result = pair(owner, false);
		expect(result.expires).toBe(start + 8 * hour);
		expect(fs.readdirSync(options.stateDirectory)).toEqual([]);
		expect(authentication(options).expiry(result.token)).toBeUndefined();
		vi.setSystemTime(result.expires);
		expect(owner.expiry(result.token)).toBe(result.expires);
		expect(owner.sessions.get(result.token)).toBe(result.expires);
		vi.setSystemTime(result.expires + 1);
		expect(owner.expiry(result.token)).toBe(result.expires);
		expect(owner.devices()).toEqual([]);
	});
	it("isolates exact origins and canonical runtimes, including parent path aliases", () => {
		const { root, owner, options } = fixture();
		const result = pair(owner);
		expect(
			authentication({ ...options, origin: "http://127.0.0.1:4318" }).expiry(
				result.token,
			),
		).toBeUndefined();
		const other = join(root, "other");
		fs.mkdirSync(other, { mode: 0o700 });
		expect(
			authentication({ ...options, runtime: other }).expiry(result.token),
		).toBeUndefined();
		const alias = join(root, "alias");
		fs.symlinkSync(root, alias);
		expect(
			authentication({ ...options, runtime: join(alias, "runtime") }).expiry(
				result.token,
			),
		).toBe(result.expires);
		expect(() =>
			authentication({ ...options, stateDirectory: "relative" }),
		).toThrow();
	});
	it("counts remembered records once alongside temporary sessions, refuses a ninth without eviction and reclaims expired slots", () => {
		const { owner, options } = fixture();
		const remembered = Array.from({ length: 4 }, () => pair(owner));
		const restarted = authentication(options);
		for (const result of remembered) restarted.expiry(result.token);
		const temporary = Array.from({ length: 4 }, () => pair(restarted, false));
		const code = restarted.issueCode().code;
		expect(restarted.pair(code, true)).toEqual({
			paired: false,
			reason: "session-limit",
		});
		expect(restarted.pair(code, false)).toEqual({
			paired: false,
			reason: "invalid-code",
		});
		expect(restarted.devices()).toHaveLength(8);
		for (const result of [...remembered, ...temporary])
			expect(restarted.expiry(result.token)).toBe(result.expires);
		vi.setSystemTime(start + 8 * hour + 1);
		pair(restarted, true);
		expect(restarted.devices()).toHaveLength(5);
		expect(restarted.sessions.size).toBe(5);
		vi.setSystemTime(start + 31 * day);
		pair(restarted, true);
		expect(restarted.devices()).toHaveLength(1);
		expect(restarted.sessions.size).toBe(1);
	});
	it("durably revokes exact redacted ids and forgets tokens, invalidating active entries immediately", () => {
		const { owner, options } = fixture();
		const first = pair(owner),
			second = pair(owner),
			temporary = pair(owner, false);
		const ids = owner.devices();
		expect(Object.keys(ids[0]).sort()).toEqual(["created", "expires", "id"]);
		ids[0].id = "caller-mutated";
		expect(owner.revoke(first.token)).toBe(false);
		expect(owner.revoke(owner.devices()[0].id + "extra")).toBe(false);
		expect(owner.revoke(owner.devices()[0].id)).toBe(true);
		expect(owner.sessions.has(first.token)).toBe(false);
		expect(authentication(options).expiry(first.token)).toBeUndefined();
		expect(owner.forget(second.token)).toBe(true);
		expect(owner.sessions.has(second.token)).toBe(false);
		expect(authentication(options).expiry(second.token)).toBeUndefined();
		expect(owner.revoke(owner.devices()[0].id)).toBe(true);
		expect(owner.sessions.has(temporary.token)).toBe(false);
		expect(owner.forget(temporary.token)).toBe(false);
		const next = pair(owner, false);
		expect(owner.forget(next.token)).toBe(true);
		expect(owner.sessions.size).toBe(0);
		expect(owner.devices()).toEqual([]);
	});
});

describe("credential storage refusal and durable failures", () => {
	it("refuses corrupt, unsupported, oversized, duplicate and malformed state without replacing it", () => {
		const { owner, options } = fixture();
		pair(owner);
		const path = stateFile(options.stateDirectory),
			valid = JSON.parse(fs.readFileSync(path, "utf8"));
		const device = valid.devices[0];
		const invalid = [
			"{",
			"x".repeat(4097),
			JSON.stringify({ ...valid, version: 2 }) + "\n",
			JSON.stringify({ ...valid, devices: [device, device] }) + "\n",
			JSON.stringify({
				...valid,
				devices: [device, { ...device, id: "b".repeat(32) }],
			}) + "\n",
			JSON.stringify({ ...valid, devices: Array(9).fill(device) }) + "\n",
			JSON.stringify({
				...valid,
				devices: [{ ...device, token: "plaintext" }],
			}) + "\n",
			JSON.stringify({
				...valid,
				devices: [{ ...device, tokenHash: "invalid" }],
			}) + "\n",
			JSON.stringify({
				...valid,
				devices: [{ ...device, expires: device.expires + 1 }],
			}) + "\n",
			JSON.stringify({ ...valid, devices: [{ ...device, created: -1 }] }) +
				"\n",
			'{"version":2,"version":1,"devices":[]}\n',
		];
		for (const text of invalid) {
			fs.writeFileSync(path, text);
			expect(() => authentication(options)).toThrow(
				"Credential state unavailable",
			);
			expect(fs.readFileSync(path, "utf8")).toBe(text);
		}
	});
	it("refuses symlink/hardlink/wrong-mode/wrong-owner files and unsafe directories", () => {
		const { owner, options, root } = fixture();
		pair(owner);
		const path = stateFile(options.stateDirectory),
			original = fs.readFileSync(path, "utf8");
		const target = join(root, "unrelated");
		fs.writeFileSync(target, original, { mode: 0o600 });
		fs.unlinkSync(path);
		fs.symlinkSync(target, path);
		expect(() => authentication(options)).toThrow();
		expect(fs.readFileSync(target, "utf8")).toBe(original);
		fs.unlinkSync(path);
		fs.linkSync(target, path);
		expect(() => authentication(options)).toThrow();
		fs.unlinkSync(path);
		fs.writeFileSync(path, original, { mode: 0o600 });
		fs.chmodSync(path, 0o644);
		expect(() => authentication(options)).toThrow();
		fs.chmodSync(path, 0o600);
		const wrongOwner = fs.statSync(path);
		wrongOwner.uid = process.getuid!() + 1;
		vi.mocked(fs.fstatSync).mockReturnValueOnce(wrongOwner);
		expect(() => authentication(options)).toThrow();
		fs.chmodSync(options.stateDirectory, 0o755);
		expect(() => authentication(options)).toThrow();
		fs.chmodSync(options.stateDirectory, 0o700);
		const moved = join(root, "moved");
		fs.renameSync(options.stateDirectory, moved);
		fs.symlinkSync(moved, options.stateDirectory);
		expect(() => authentication(options)).toThrow();
	});
	it("fails closed if state becomes corrupt after admission, without exposing secrets or repairing it", () => {
		const { owner, options } = fixture();
		const result = pair(owner);
		const path = stateFile(options.stateDirectory);
		fs.writeFileSync(path, "corrupt");
		expect(() => owner.expiry(result.token)).toThrow(
			"Credential state unavailable",
		);
		expect(owner.sessions.size).toBe(0);
		writeState(path, { version: 1, devices: [] });
		expect(() => owner.issueCode()).toThrow("Credential state unavailable");
		expect(() => owner.devices()).toThrow("Credential state unavailable");
	});
	it("does not grant durable pairing if file flush fails, leaves no staging file and preserves unrelated files", () => {
		const { owner, options } = fixture();
		const unrelated = join(options.stateDirectory, "unrelated");
		fs.writeFileSync(unrelated, "keep");
		const code = owner.issueCode().code;
		vi.mocked(fs.fsyncSync).mockImplementationOnce(() => {
			throw new Error("fixture flush failure");
		});
		expect(() => owner.pair(code, true)).toThrow(
			"Credential state unavailable",
		);
		expect(owner.sessions.size).toBe(0);
		expect(fs.readdirSync(options.stateDirectory)).toEqual(["unrelated"]);
		expect(fs.readFileSync(unrelated, "utf8")).toBe("keep");
		expect(authentication(options).devices()).toEqual([]);
	});
	it("does not report revoke/forget success when atomic replacement fails", () => {
		for (const action of ["revoke", "forget"] as const) {
			const { owner, options } = fixture();
			const result = pair(owner),
				id = owner.devices()[0].id;
			const path = stateFile(options.stateDirectory),
				before = fs.readFileSync(path, "utf8");
			vi.mocked(fs.renameSync).mockImplementationOnce(() => {
				throw new Error("fixture rename failure");
			});
			expect(() =>
				owner[action](action === "revoke" ? id : result.token),
			).toThrow("Credential state unavailable");
			expect(owner.sessions.size).toBe(0);
			expect(fs.readFileSync(path, "utf8")).toBe(before);
			expect(authentication(options).expiry(result.token)).toBe(result.expires);
			expect(fs.readdirSync(options.stateDirectory)).toHaveLength(1);
		}
	});
	it("fails closed if directory flush fails after rename, never claims durable pairing or revocation", () => {
		const { owner, options } = fixture();
		const result = pair(owner),
			id = owner.devices()[0].id;
		vi.mocked(fs.fsyncSync)
			.mockImplementationOnce(actualFs.fsyncSync)
			.mockImplementationOnce(() => {
				throw new Error("fixture directory failure");
			});
		expect(() => owner.revoke(id)).toThrow("Credential state unavailable");
		expect(owner.sessions.size).toBe(0);
		expect(authentication(options).expiry(result.token)).toBeUndefined();
		const restarted = authentication(options),
			code = restarted.issueCode().code;
		vi.mocked(fs.fsyncSync)
			.mockImplementationOnce(actualFs.fsyncSync)
			.mockImplementationOnce(() => {
				throw new Error("fixture directory failure");
			});
		expect(() => restarted.pair(code, true)).toThrow(
			"Credential state unavailable",
		);
		expect(restarted.sessions.size).toBe(0);
		expect(() => restarted.expiry(result.token)).toThrow(
			"Credential state unavailable",
		);
		const bytes = fs.readFileSync(stateFile(options.stateDirectory), "utf8");
		expect(bytes).not.toContain(result.token);
	});
});
