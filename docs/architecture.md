# Architecture and boundaries

[Back to Pi Companion](../README.md) · [Setup guide](setup.md)

## Architecture and philosophy

```text
Pi terminals (each owns its session)
  + companion bridge
          | private Unix-domain sockets
Loopback gateway (127.0.0.1)
          +---- local browser (manual HTTP mode)
          +---- private Tailscale Serve (HTTPS) ---- phone browser
```

Pi owns behavior, history, tools, settings and subagents. Each terminal remains the
session owner; the gateway never creates a second agent or writes a parallel transcript.
Browser control is explicit, access requires pairing, and uncertain input is never
silently resent. Closing the browser or gateway does not stop Pi.

### Code ownership and technologies

- `src/extension/`: public Pi events, active-branch snapshots and native dispatch.
  It loads inside existing terminal sessions; print/JSON/RPC sessions do not register.
- `src/gateway/`: Fastify HTTP routing, authentication, control, media and managed runtime.
  Node HTTP uses private Unix-domain sockets to reach bridges. `fs-ext` holds the
  gateway's process-lifetime lock; PID/mtime guesses do not establish ownership.
- `src/shared/`: TypeBox schemas and browser-safe identity/transport contracts.
- `web/src/`: React/Vite presentation, deliberate actions and one selected-session
  EventSource (SSE) subscription. Native dialog provides the session drawer;
  react-markdown/remark-gfm render text and PhotoSwipe provides image inspection.
- `scripts/`: declaration-link setup, managed restart and sample-data README screenshot generation. `tests/` uses Vitest and
  Playwright fixtures. `probes/` contains explicit isolated native-Pi checks.

The package uses strict TypeScript and native ESM with pinned npm dependencies. Keep
one package and one owner for each policy; do not add a second Pi runtime or transcript
store. The [contributor guide](../AGENTS.md) governs changes and validation.

### Identity, input and media boundaries

A live owner is an instance **and generation**, not a PID or saved session file.
Lifecycle changes invalidate old generations. If two processes advertise the same
canonical session file, browser mutation is refused as an ownership conflict. Native
session paths stay server-side; cached/disconnected content is read-only. SSE uses
bounded replay, heartbeats and fresh snapshot fallback, not a duplicated transcript.

Browser mutations require authenticated exact-origin/CSRF admission and current control.
Takeover is separate from a blocked action; it never resumes that action. Terminal input
remains available. Generation-scoped request ledgers prevent reinvoking an attempted ID;
forwarding through Pi's void public API is not proof of consumption or completion.
Stop observes parent settlement, not cancellation of all queued or background work.
Positive Subagents observations show work-item counts and public labels, not exact child
counts. Missing/zero background status is unknown, not proof that work ended.

Returned images come from native Pi image blocks through authenticated, owner-scoped
opaque references. A model-authored file path is not permission to read an arbitrary
file. Uploads are limited to four still PNG/JPEG/WebP images per message, 4,000,000 total
source bytes and 4,000,000 total normalized bytes, with 20,000,000 pixels per image. The gateway validates and re-encodes with sharp, applies orientation
and strips metadata; Pi retains its own model/image policy. Decoder work stays outside
Pi event handlers. Its timeout is cooperative, not a hard CPU/memory/wall-clock sandbox.

Treat browser access as control of an agent with the host user's permissions. Loopback
binding alone is not authentication. Local IPC records/sockets are owner-only; capability
values never belong in browser responses or ordinary logs. HttpOnly cookies and bounded
schemas protect entry points. Untrusted text uses no raw HTML or executable link schemes;
remote image paths, arbitrary files and third-party content fetching are not enabled.
Pi and loaded extensions are trusted code, not an OS sandbox. Tailscale access rules must
restrict access to the owner; private Serve does not make agent actions harmless.

Trusted extensions may contribute read-only plain-text cards during existing status reads.
These cards, including Subagents, sit at the bottom of the conversation and scroll away
when reading earlier messages; they do not reserve space above the message scroller.
See the [extension display contract](../docs/extension-display.md) for publisher rules and
bounds. Displays never grant control or alter input policy; publishers must omit secrets
and private state. There is no widget mirror, action API, display history or extra poller.
