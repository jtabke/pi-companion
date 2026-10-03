# Opt-in extension display

Companion can render read-only status and text cards from extensions in the same live
Pi process. This is an opt-in Companion contract, not a Pi core API or automatic TUI
mirror. No Pi upgrade, second agent, display history or provider registry is required.

The built-in Subagents adapter uses the existing public Fleet observation. It shows
positive work-item count and public agent labels. Those are not exact leaf-child counts;
missing/zero observations do not prove that all background work finished. Arbitrary
terminal components, child transcripts, dialogs and remote actions are not supported.

## Publish a snapshot

Source contract: [`src/extension/display.ts`](../src/extension/display.ts).
Event: `companion:display:v1:request` on `pi.events`.

During each existing bridge status read, Companion emits a frozen `DisplayRequest`:

```ts
interface DisplayRequest {
	readonly version: 1;
	readonly sessionId: string;
	readonly requestId: string;
	readonly contribute: (snapshot: {
		version: 1;
		sessionId: string;
		requestId: string;
		provider: string;
		cards: {
			key: string;
			title: string;
			status: string;
			lines: string[];
		}[];
	}) => void;
}
```

The publisher must contribute synchronously from its existing in-memory state, only
for its own current session. Do not fetch, start work, execute tools or await an action
in this handler. Contributions after emission returns are ignored. Each status read
collects a fresh snapshot: updated cards replace prior display, and omitted cards or an
empty card array clear on the next gateway refresh. There is no additional timer/cache.

Example extension; adjust the type-only import to your checkout:

```ts
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { DisplayRequest } from "/path/to/pi-companion/src/extension/display.js";

export default function (pi: ExtensionAPI) {
	let current: ExtensionContext | undefined;
	pi.on("session_start", (_event, ctx) => {
		current = ctx;
	});
	pi.on("session_switch", (_event, ctx) => {
		current = ctx;
	});

	const unsubscribe = pi.events.on("companion:display:v1:request", (raw) => {
		const request = raw as DisplayRequest;
		const sessionId = current?.sessionManager.getSessionId();
		if (!sessionId || request.version !== 1 || request.sessionId !== sessionId)
			return;
		request.contribute({
			version: 1,
			sessionId,
			requestId: request.requestId,
			provider: "sample",
			cards: [
				{
					key: "status",
					title: "Sample extension",
					status: "Available",
					lines: ["Read-only display from this Pi session."],
				},
			],
		});
	});
	pi.on("session_shutdown", () => {
		unsubscribe();
		current = undefined;
	});
}
```

For a real provider, replace the sample text with explicitly selected public display
state owned by that extension. The same generic browser renderer displays every card.
No extension code or HTML is sent to the browser. This sample has not been installed or
run against a personal Pi session; production-boundary fixtures establish the contract.

## Bounds and rejection

- Provider/card keys: 1–48 ASCII characters; first alphanumeric, then alphanumeric,
  dot, underscore or hyphen. Identities are case-sensitive. `subagents` is reserved.
- At most 4 cards per provider, 8 total including the built-in card.
- Title: 80 UTF-16 units; status: 160; at most 8 lines per card, 256 units per line.
- At most 32 contribution attempts are processed per request.
- At most 8192 UTF-8 bytes of serialized normalized display JSON, including escaping.
- Duplicate providers discard their processed contributions; duplicate card keys reject
  that provider snapshot. Invalid, foreign-session or oversized snapshots are rejected.
- Total count/byte overflow skips the whole provider, not part of its cards. Built-in
  Subagents is admitted first; other providers follow contribution order.

Terminal ANSI/control/link sequences and directional formatting are removed. Browser
content is plain escaped React text, not Markdown, HTML, scripts or actionable commands.
Session/generation changes discard collection. Cards display only for the selected,
current, connected session; reconnect starts from fresh status data.

## Safety and rollout

The event bus connects trusted code in one Pi process. It is not authentication or a
sandbox. Publishers **must not publish credentials, private paths, task prompts or
other sensitive state**. A publisher that blocks its process violates this contract;
Companion cannot sandbox local extension execution. The inspected public Pi event bus
isolates throwing listeners; malformed contributions cannot invalidate native status.

Display text never grants control or changes parent activity, Send/Follow-up admission,
Stop, retry or questionnaire behavior. Existing authentication and origin checks apply.

After changing the bridge/schema, rebuild and restart affected Pi terminals and the
gateway through the [documented lifecycle](../README.md#stop-restart-and-reconnect).
Save unsent drafts and let active work finish first. Production-boundary fixtures cover
the display contract; they do not establish real-phone behavior or compatibility with
an installed publisher.
