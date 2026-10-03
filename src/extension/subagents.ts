import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Summary } from "../shared/protocol.js";

const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const text = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const FleetSchema = Type.Object({
	version: Type.Literal(1),
	totalActive: count,
	omitted: count,
	entries: Type.Array(
		Type.Object({
			key: text(128),
			agent: text(96),
			role: Type.Optional(text(96)),
			model: Type.Optional(text(128)),
			effort: Type.Optional(text(128)),
			goal: Type.Optional(text(512)),
			startedAt: count,
			tokens: Type.Object({ input: count, output: count, total: count }),
		}),
		{ maxItems: 16 },
	),
	topLevelAsyncCapacity: Type.Object({ used: count, limit: count }),
});
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// Two request-local reads, at most 500ms total. No fleet state survives this read.
export async function observeSubagents(
	events: ExtensionAPI["events"] | undefined,
	sessionId: string,
	current: () => boolean,
	signal: AbortSignal,
): Promise<Summary["subagents"]> {
	if (!events || !sessionId || !current() || signal.aborted) return;
	const rpc = (method: "ping" | "status") =>
		new Promise<unknown>((resolve) => {
			const requestId = randomUUID();
			let unsubscribe = () => {};
			let settled = false;
			const finish = (data?: unknown) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				unsubscribe();
				signal.removeEventListener("abort", abort);
				resolve(data);
			};
			const abort = () => finish();
			const timer = setTimeout(abort, 250);
			signal.addEventListener("abort", abort, { once: true });
			try {
				unsubscribe = events.on(
					`subagents:rpc:v1:reply:${requestId}`,
					(reply) => {
						if (!record(reply) || reply.requestId !== requestId) return;
						finish(
							reply.version === 1 && reply.success === true
								? reply.data
								: undefined,
						);
					},
				);
				if (signal.aborted || !current()) finish();
				else
					events.emit("subagents:rpc:v1:request", {
						version: 1,
						requestId,
						method,
					});
			} catch {
				finish();
			}
		});
	try {
		const ping = await rpc("ping");
		if (
			!record(ping) ||
			!record(ping.capabilities) ||
			!record(ping.capabilities.fleetStatus) ||
			ping.capabilities.fleetStatus.version !== 1 ||
			(ping.session !== undefined &&
				(!record(ping.session) ||
					(ping.session.sessionId !== undefined &&
						ping.session.sessionId !== sessionId))) ||
			!current() ||
			signal.aborted
		)
			return;
		const data = await rpc("status");
		if (
			!current() ||
			signal.aborted ||
			!record(data) ||
			!Value.Check(FleetSchema, data.fleet)
		)
			return;
		const fleet = data.fleet;
		if (
			!fleet.totalActive ||
			fleet.totalActive > 1_000_000 ||
			fleet.omitted !== fleet.totalActive - fleet.entries.length
		)
			return;
		const labels = [
			...new Set(
				fleet.entries
					.map(({ agent }) =>
						agent
							.replace(
								/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
								"",
							)
							.trim()
							.slice(0, 64),
					)
					.filter(Boolean),
			),
		].slice(0, 4);
		return { activeWork: fleet.totalActive, labels };
	} catch {
		return;
	}
}
