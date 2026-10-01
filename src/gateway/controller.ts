import { randomBytes } from "node:crypto";
import type {
	ControlRequest,
	ControllerStatus,
	Identity,
} from "../shared/protocol.js";

// One admitted operation per instance (no queued Promise tail); unrelated owners are independent.
// At most 32 active operations and 32 leases. Authority is never projected into SSE.
export function controllers() {
	const active = new Set<string>();
	const leases = new Map<
		string,
		{
			generation: string;
			cookie: string;
			capability: string;
			expires: number;
			revision: string;
		}
	>();
	function prune() {
		for (const [instance, lease] of leases)
			if (lease.expires <= Date.now()) leases.delete(instance);
	}
	function valid(identity: Identity, cookie: string, capability: string) {
		prune();
		const lease = leases.get(identity.instance);
		return (
			!!lease &&
			lease.generation === identity.generation &&
			lease.cookie === cookie &&
			lease.capability === capability
		);
	}
	return {
		enter(instance: string) {
			if (active.has(instance) || active.size >= 32) return false;
			active.add(instance);
			return true;
		},
		leave(instance: string) {
			active.delete(instance);
		},
		valid,
		project(identity: Identity): ControllerStatus {
			prune();
			const lease = leases.get(identity.instance);
			return lease?.generation === identity.generation
				? { held: true, expires: lease.expires, revision: lease.revision }
				: { held: false, expires: 0 };
		},
		// Revoke lost generations/reachability/authentication, without any native command.
		reconcile(live: Identity[], cookies: Map<string, number>) {
			prune();
			for (const [instance, lease] of leases)
				if (
					!live.some(
						(i) => i.instance === instance && i.generation === lease.generation,
					) ||
					(cookies.get(lease.cookie) ?? 0) <= Date.now()
				)
					leases.delete(instance);
		},
		change(request: ControlRequest, cookie: string) {
			prune();
			let existing = leases.get(request.instance);
			if (existing && existing.generation !== request.generation) {
				leases.delete(request.instance);
				existing = undefined;
			}
			if (request.action === "release" || request.action === "renew") {
				if (!valid(request, cookie, request.lease)) return undefined;
				if (request.action === "release") {
					leases.delete(request.instance);
					return { held: false, expires: 0 };
				}
				existing!.expires = Date.now() + 60_000;
				return {
					held: true,
					expires: existing!.expires,
					lease: existing!.capability,
					revision: existing!.revision,
				};
			}
			if (request.action === "claim" && existing) return undefined;
			if (!existing && leases.size >= 32) return undefined;
			const lease = {
				generation: request.generation,
				cookie,
				capability: randomBytes(32).toString("hex"),
				revision: randomBytes(16).toString("hex"),
				expires: Date.now() + 60_000,
			};
			leases.set(request.instance, lease);
			return {
				held: true,
				expires: lease.expires,
				lease: lease.capability,
				revision: lease.revision,
			};
		},
		clear() {
			leases.clear();
			active.clear();
		},
	};
}
