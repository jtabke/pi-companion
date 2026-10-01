# Technology decisions

## Status

The C2 stack is implemented and accepted locally. Root package/lock and test browser
engines are installed; only the inspected local fs-ext install script ran. Pi is an exact
optional 0.99.2 host peer with a read-only development type link; release-age policy is
unchanged. See [C2 evidence](docs/c2-observer.md) for reproducible setup and checks.
C3 multi-owner recovery and C4-A explicit controller/idle text are also accepted
locally; see [C4-A evidence](docs/c4-text-input.md). Its bridge-owned bounded ledger
hashes JSON-serialized authored text; public lease revision is non-authorizing.
The isolated fixture also needs an ignored read-only exact installed pi-ai type link.
C4-B image feedback is accepted locally; see [image evidence](docs/c4-image-input.md).
Exact sharp 0.35.5/libvips 8.18.7 loads on checked Node26/macOS arm64. Its required
Darwin packages have no install lifecycle hooks; install used scripts disabled, audit zero.
One pre-body image slot stays held until metadata/output settle. The output timeout is
cooperative; no hard wall-clock/CPU/RSS guarantee. Native omitted blockImages uses the
public documented false default; no owner settings changes are required.
C1 has limited verdicts. Native send has no correlated acknowledgement; busy queueing
remains unverified. The questionnaire reply seam remains local source-only, not globally
installed. C4-E real installed-package background survival is accepted locally; see
[background evidence](docs/c4-background-survival.md). One same-ID native child survived
browser loss and an actual CLI crash/recovery. Normal/held-interrupt cleanup passed.
The fixed parent acknowledgement preserves native completion wake; no production change.
Native controlled screenshot rendering/enlargement is automated evidence in
Chromium/desktop WebKit with fixed local responses, not paid-provider proof.
C5 phone evidence is separate manual owner confirmation over private HTTPS: text/image
input, uploaded and native read-tool image zoom, lock/unlock reconnect and refresh with
explicit session reselection. It is not instrumented mobile or comprehensive phone certification.
If a selected dependency fails the stated boundary, record the evidence and choose the
smallest replacement. Do not widen product scope to justify a library.

## Stack

| Responsibility | Choice | Reason |
| --- | --- | --- |
| Language | Strict TypeScript, native ESM | One language across Pi extension, gateway, protocol, and browser; matches Pi's extension ecosystem. |
| Runtime | Node.js; checked 26.5.0, proposed Node 24 LTS baseline | Native Unix sockets, HTTP, streams, and crypto; no alternative runtime inside the host Pi. Node 24 is not runtime-verified; no runtime installation is authorized here. |
| Package/build ownership | One npm package, package-lock.json | One install and terminal command; separate source boundaries without monorepo tooling. |
| Public gateway | Fastify with official cookie/static/security-header plugins as needed | Established routing, request limits, schema validation, lifecycle, and injectable HTTP tests. Avoid hand-writing an HTTP application framework. |
| Pi bridge transport | Node built-in HTTP over a per-instance Unix-domain socket | Reuse HTTP framing and streams; no custom IPC wire protocol or additional framework loaded into each Pi process. |
| Gateway exclusion | `fs-ext` OS advisory file lock, held for process lifetime | The kernel releases the lock after process exit/crash. Keep the owner-only lock file in place; do not substitute age/PID heuristics. Validate its local native build before use. |
| Runtime schemas | TypeBox JSON Schema | One schema definition for validated messages and inferred TypeScript types; Pi 0.99.1 already uses TypeBox. Verify its installed 1.x API before choosing exact versions. |
| Browser UI | React + Vite | Established ecosystem for incremental conversation rendering and accessible controls; static frontend, no server rendering. |
| Styling | Ordinary CSS with shared design tokens | One layout and limited components; no utility framework, theme marketplace, or design-system package. |
| Accessible dialogs/drawer | Radix Dialog where needed | Reuse focus, Escape, and dismissal mechanics; avoid a broad component suite. |
| Markdown | react-markdown + remark-gfm | AST-to-React rendering; no raw HTML plugin or HTML string insertion. Explicit link/image policy remains required. |
| Full-screen image viewer | PhotoSwipe | Existing touch zoom, pan, and gallery mechanics. Start with single-image viewing; do not add a gallery product. |
| Image processing | sharp 0.35.5 in the gateway | Actual decoding, dimensions, orientation, metadata removal and bounded same-format normalization for PNG/JPEG/WebP. Native resizing remains Pi-owned; decoder work stays out of Pi event handlers. |
| Browser events | Native EventSource / SSE | Server updates flow downstream; input uses ordinary authenticated HTTP requests. |
| Tests | Vitest + Fastify inject + Playwright | Unit/integration coverage without a separate HTTP-test library; browser tests in Chromium and WebKit. |
| Private network | Tailscale Serve | Private HTTPS in front of a localhost-only gateway; no cloud relay or custom TLS service. |
| Durable transcripts | Pi's native SessionManager/session files | No SQLite, Redis, or duplicate conversation storage. |

Exact dependency versions must be selected at implementation time and locked. The
current Pi package declares Node >=22.19.0, but the companion's supported Node range
must also satisfy its actual dependencies; do not promise Node 22 support without checks.

## Boundaries and flow

```text
Pi process
  companion extension: public events, snapshot, authorized Pi commands
       │ Node HTTP server on an owner-only Unix socket
       ▼
Gateway: Fastify, browser auth, connection routing, media delivery
       │ same-origin HTTP + SSE
       ▼
Static React UI: sessions, conversation, questions, image viewer
```

The gateway also connects with Node's native HTTP client using socketPath. Prefer the
same command/event schema families on both hops; local capabilities and Pi-private data
must not be forwarded into the browser protocol. Reuse schemas where safe, not one
unfiltered transport payload everywhere.

The extension must not register new model-callable tools merely to communicate with
the gateway. It must not construct another AgentSession. Use runtime imports only from
Pi's documented public exports when actually needed; otherwise use type-only imports
and the ExtensionAPI passed by the host.

Pi's type dependency and package loader behavior remain C1 questions. Do not bundle a
second Pi runtime into the extension or assume the browser needs any Pi package.

## Source ownership

Proposed paths; create them only as their checkpoints need them:

```text
src/
  extension/    live Pi bridge, lifecycle, snapshot, input dispatch
  gateway/      command entry point, discovery, auth, routes, media
  shared/       browser-safe schemas and connection identity
web/
  src/          React UI, CSS, event reconciliation
tests/          focused fixtures, integration, browser tests
```

The extension export and terminal executable belong to one package. Vite builds the
frontend; TypeScript compiles the Node gateway. A development runner such as tsx may
be used only for development. Production runs compiled code with Node.

## Why not the alternatives?

### Not Next.js

There is no server-rendered public content, SEO requirement, or full-stack website.
A static frontend plus one explicit local API is sufficient. Avoid framework-owned
routing/state that obscures the lifetime of attached Pi processes.

### Not Bun, Go, or Rust for the gateway

All can implement the gateway, but the bridge already runs in Pi's JavaScript process.
Another language/runtime creates a second toolchain and schema boundary without a
measured need. Pi remains usable if the gateway fails; process isolation does not
require a different implementation language.

### Not Socket.IO or a WebSocket-first design

The approved behavior is downstream updates plus discrete upstream commands. HTTP and
SSE satisfy it without an extra connection protocol. SSE does not solve delivery on its
own: IDs, replay, snapshots, backpressure, and request deduplication still need tests.
If a proved feature later requires bidirectional continuous data, reconsider only then.

### Not a custom TCP/JSON-lines IPC protocol

Node HTTP already supplies request framing, status/error responses, streaming bodies,
and disconnect signals over Unix sockets. Unix permissions and local capabilities still
need enforcement. Do not infer peer authentication from the socket path alone.

### Not Redux, Zustand, or a server-cache framework initially

Start with React state/reducers, isolated subscription ownership, and keyed messages.
One browser SSE connection carries lightweight status/discovery for every instance
and detailed events for the selected instance. Do not add a second state authority
or a query-cache reconciliation policy unless a measured requirement demonstrates need.

### Not a from-scratch image viewer

Pinch zoom and pan are the main phone review behavior. Use PhotoSwipe's existing viewer
rather than make gesture handling and accessibility a new maintenance obligation.
Integrate its lifecycle directly; do not invent a generic media-renderer framework.

### Not a PWA service worker initially

A mobile browser and optional home-screen presentation are sufficient for the first
journey. Do not cache private transcripts/media or promise background streaming after
iOS suspends the page. On foreground return, reconnect and reconcile explicitly.
Notifications and offline operation are outside the initial scope.

## Security is application policy

Fastify/plugins provide mechanisms, not the security boundary by themselves. Implement
and test exact local/Tailscale origins, host validation, authentication, CSRF, controller
ownership, session-scoped media IDs, request budgets, and redacted logs.

Do not enable broad CORS. Do not trust arbitrary forwarded headers. Do not set generic
trustProxy behavior merely to make Tailscale work. Establish the actual loopback proxy
path and validate its effective host/protocol against configured values.

Authentication cookies must account for both approved loopback development and private
HTTPS production access without weakening the remote policy. Browser EventSource uses
same-origin cookie authentication; do not put persistent credentials in SSE query strings.

Upload processing runs in the gateway with bounded admission and decoder concurrency.
Verify sharp's actual memory/format behavior. HEIC, SVG, video, and PDF support are not
implied by selecting sharp or PhotoSwipe. Verify mobile Content Security Policy behavior,
image zoom, and safe handling of server-provided image dimensions in browser tests.

## Validation approach

- Vitest: identity, ownership, event reconciliation, request deduplication, media policy.
- Fastify inject: gateway routes, auth, origin/host checks, limits, response headers.
- Real socket/process tests: streaming, IPC disconnects, gateway restart, two Pi owners;
  Fastify injection alone cannot prove those behaviors.
- Playwright Chromium and WebKit: conversation, image enlargement, reconnect, drawer,
  keyboard/focus, and narrow-screen layout. Install browser engines only when needed.
- Actual iPhone Safari: touch zoom, picker formats, software keyboard, suspension/resume,
  and Tailscale HTTPS. Desktop WebKit is useful but is not an iPhone verification result.
- Explicit real-Pi smoke: screenshots, input APIs, questionnaire, and subagent lifecycle.

Default tests must not call a paid model or read the user's credential files.

## Current integration limits

- C4-D questionnaire browser transport is accepted locally against the source-loaded opt-in public contract; installed copy remains unchanged.
- Only Pi 0.99.2 and Node 26.5.0 are runtime-checked; Node 24 is a proposed baseline, not a test result.
- C2 uses validated short owner-only runtime/socket paths on macOS and descriptor-held OS flock.
- C4-A adds explicit controller and idle text schemas/receipts; native outcome stays unconfirmed.
- C4-B supports one bounded still-image upload; original-source fingerprints recover native receipts across gateway restart.
- C4-C1 browser busy delivery is owner-deferred; public dispatch exists but safe reusable attempt tracking is unproved.
- C4-C2 explicit Stop is accepted locally: fixed leased abort dispatch, shared-ledger dedup and parent-settled observation, not cancellation acknowledgement.
- C4-D uses bounded generation-local observed pending state, selected-only SSE and strict non-coercing TypeBox reply validation; no reply ledger or broker.
- C4-E actual installed-package background survival is accepted locally on Pi 0.99.2/subagents 0.73.1; no browser job enumeration/control is added.
- Parent full browser regression passed 31/32; the unchanged Chromium control-race timeout passed its focused rerun, not a new all-green full-suite result.
- C5-A exact HTTPS origin/Secure-cookie/HSTS boundary is accepted locally; optional C2_PUBLIC_ORIGIN selects one canonical device origin while literal-loopback binding and default HTTP policy remain unchanged. Parent types/build/51 unit/process tests passed.
- Native owner consent enabled manual foreground private Serve; actual certificate-verified TLS, shell/assets and live auth/Host/Origin denials passed. The owner manually confirmed phone pairing/session use, text/image input, uploaded and native read-tool image zoom, lock/unlock reconnect and refresh with explicit session reselection. C5's first journey is accepted on that report, not mobile automation or phone Stop/questionnaire, every picker format, or full keyboard/accessibility certification. No global service, autostart, Funnel or consent bypass.
