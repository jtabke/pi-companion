import { it, expect, vi } from "vitest";
import {
	chmodSync,
	mkdtempSync,
	writeFileSync,
	readFileSync,
	renameSync,
	rmSync,
	existsSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { nativeInput } from "../src/extension/input.js";
import { createBridge } from "../src/extension/bridge.js";
import { discover, discoveryBudgetMs } from "../src/gateway/peer.js";
import {
	timedRequestId,
	requestLifetimeMs,
	requestFutureSkewMs,
} from "../src/shared/request-id.js";
import { context } from "./fixture.js";

it("retires timed receipts over prolonged use without replay, legacy eviction or generation changes", () => {
	const clock = vi.spyOn(Date, "now");
	const initial = 1_800_000_000_000;
	clock.mockReturnValue(initial);
	const identity = { instance: "a".repeat(32), generation: "b".repeat(32) };
	let attempts = 0;
	const dispatch = nativeInput(
		identity,
		context(),
		() => {
			attempts++;
		},
		() => true,
	);
	const request = (n: number, now: number) => ({
		...identity,
		requestId: timedRequestId(n.toString(16).padStart(20, "0"), now),
		text: "hello",
	});
	try {
		const first = request(0, initial);
		expect(dispatch(first).status).toBe("dispatched");
		expect(dispatch(first).status).toBe("dispatched");
		expect(dispatch({ ...first, text: "changed" }).reason).toBe("mismatch");
		// An old random ID containing the former marker remains strictly legacy.
		const legacy = {
			...first,
			requestId: "0".repeat(12) + "f201" + "c".repeat(16),
		};
		expect(dispatch(legacy).status).toBe("dispatched");
		// More than a generation's old capacity, including transient rejection receipts.
		for (let n = 1; n < 4096; n++)
			expect(dispatch(request(n, initial)).status).toBe("dispatched");
		expect(dispatch(request(4096, initial)).reason).toBe("ledger-full");
		clock.mockReturnValue(initial + requestLifetimeMs);
		expect(dispatch(first).reason).toBe("stale");
		expect(dispatch(request(4096, initial + requestLifetimeMs)).status).toBe(
			"dispatched",
		);
		expect(dispatch(legacy).status).toBe("dispatched");
		expect(attempts).toBe(4098);
		// Wall-clock rollback cannot make an evicted attempt valid again.
		clock.mockReturnValue(initial);
		expect(dispatch(first).reason).toBe("stale");
		expect(
			dispatch(
				request(5000, initial + requestLifetimeMs + requestFutureSkewMs + 1),
			).reason,
		).toBe("stale");
		expect(attempts).toBe(4098);
	} finally {
		clock.mockRestore();
	}
});

it("never removes a replacement registration while reclaiming a missing generation", async () => {
	const path = mkdtempSync("/tmp/c2-robust-");
	chmodSync(path, 0o700);
	const record = {
		version: 1,
		instance: "a".repeat(32),
		generation: "b".repeat(32),
		capability: "c".repeat(64),
	};
	const file = join(path, `b-${record.instance}.json`);
	writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
	try {
		const pending = discover(path);
		renameSync(file, join(path, "old-record"));
		const replacement = JSON.stringify({
			...record,
			generation: "d".repeat(32),
		});
		writeFileSync(file, replacement, { mode: 0o600 });
		await pending;
		expect(readFileSync(file, "utf8")).toBe(replacement);
	} finally {
		rmSync(path, { recursive: true, force: true });
	}
});

it.each(["streaming-body", "silent-headers", "silent-body"] as const)(
	"bounds %s discovery, discards partial authority, preserves slow bridges and recovers automatically",
	async (mode) => {
		const path = mkdtempSync("/tmp/c2-robust-");
		chmodSync(path, 0o700);
		const bridge = createBridge(path);
		const timers = new Set<ReturnType<typeof setInterval>>();
		let responding = false;
		const server = createServer((_req, res) => {
			responding = true;
			if (mode === "silent-headers") return;
			res.writeHead(200, { "content-type": "application/json" });
			res.flushHeaders();
			if (mode === "silent-body") return;
			res.write(" ");
			const timer = setInterval(() => res.write(" "), 100);
			timers.add(timer);
			res.on("close", () => {
				clearInterval(timer);
				timers.delete(timer);
			});
		});
		const record = {
			version: 1,
			instance: "a".repeat(32),
			generation: "b".repeat(32),
			capability: "c".repeat(64),
		};
		const file = join(path, `b-${record.instance}.json`);
		const socket = join(path, `b-${record.generation}.sock`);
		try {
			const live = await bridge.start(context());
			await new Promise<void>((resolve) => server.listen(socket, resolve));
			chmodSync(socket, 0o600);
			writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
			const start = performance.now();
			expect(await discover(path)).toEqual({
				overLimit: false,
				peers: [],
				failure: "timeout",
			});
			expect(responding).toBe(true);
			expect(performance.now() - start).toBeLessThan(discoveryBudgetMs + 1000);
			expect(existsSync(file)).toBe(true);
			expect(existsSync(socket)).toBe(true);
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			const recovered = await discover(path);
			expect(recovered.failure).toBeUndefined();
			expect(recovered.peers.map((peer) => peer.registration)).toEqual([live]);
			expect(existsSync(file)).toBe(false);
		} finally {
			for (const timer of timers) clearInterval(timer);
			server.closeAllConnections();
			if (server.listening)
				await new Promise<void>((resolve) => server.close(() => resolve()));
			await bridge.close();
			rmSync(path, { recursive: true, force: true });
		}
	},
	8000,
);
