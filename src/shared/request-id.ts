// Timestamp-bound IDs permit receipt retirement without allowing an old attempt
// to execute again. Existing random IDs retain their generation-long ledger.
export const requestLifetimeMs = 10 * 60_000;
export const requestFutureSkewMs = 60_000;
export function timedRequestId(randomHex: string, now = Date.now()) {
	return "t" + now.toString(16).padStart(12, "0") + randomHex.slice(0, 20);
}
export function requestIssuedAt(id: string): number | undefined {
	return /^t[a-f0-9]{32}$/.test(id)
		? Number.parseInt(id.slice(1, 13), 16)
		: undefined;
}
