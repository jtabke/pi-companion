# C2 — one read-only native-image observer

## Verdict: completed locally; independent review/parent acceptance pending

A normally launched terminal Pi **0.99.2**, explicitly loaded production bridge,
terminal gateway, and authenticated browser displayed the **same real built-in
`read` image** inline and enlarged with PhotoSwipe. Closing both browsers and the
gateway left that Pi owner alive and tagged terminal input working. Gateway restart
recovered the same native item/bytes. Actual `/reload` retained process instance
identity, changed generation, recovered the native image, and rejected the old
media reference with HTTP 410. Pi then exited normally; owned runtime, PTY and
children were cleaned up.

This is one local read-only C2 slice, **not C3–C6 completion**. There is no input,
upload, question reply, controller, session starting/switching, subagent action,
Tailscale, global installation, or actual iPhone proof. Background work is explicitly
unobserved; only native parent activity is shown.

## Portable local setup

Requires an existing Pi **exactly 0.99.2**, Node (development policy >=24; actually
checked on **26.5.0**), npm (checked **11.17.0**), Python/POSIX for the opt-in smoke,
and native compiler/build tools for `fs-ext`. No runtime/global install is provided.
From this checkout:

```sh
npm ci --ignore-scripts
# Inspect the only required native install hook and its local build target first:
cat node_modules/fs-ext/package.json node_modules/fs-ext/binding.gyp
# Hook is node-gyp configure build; target is local fs-ext.cc with NAN headers.
npm rebuild fs-ext
```

All dependencies are exact-pinned in one lock. Vite 8's installed Rolldown platform
binary worked with scripts disabled; no esbuild/Vite install hook was needed. Do
not run arbitrary pending install scripts or global npm approval/configuration.

Pi is an exact optional **host peer**, not an installed second runtime. A registry
dev-dependency bootstrap was refused by the existing npm minimum-release-age
policy (ETARGET). The supervisor approved only the earlier probe's read-only local
type-link route; no age override was used. After every `npm ci`, establish this
ignored development-only link to installed public declarations:

```sh
python3 -B - <<'PY'
from pathlib import Path
import json, shutil
executable = shutil.which('pi')
if not executable:
    raise SystemExit('Existing Pi required')
package = next(p for p in Path(executable).resolve().parents
               if (p / 'package.json').is_file())
meta = json.loads((package / 'package.json').read_text())
if (meta['name'], meta['version']) != ('@earendil-works/pi-coding-agent', '0.99.2'):
    raise SystemExit('Only Pi 0.99.2 reviewed; stop for version review')
scope = Path('node_modules/@earendil-works')
scope.mkdir(exist_ok=True)
link = scope / 'pi-coding-agent'
if link.is_symlink():
    assert link.resolve() == package
elif link.exists():
    raise SystemExit('Refusing to replace a local package')
else:
    link.symlink_to(package, target_is_directory=True)
PY
npm run typecheck
npm run build
```

Only `import type` accesses Pi in production source; generated gateway/bridge JS
has no Pi runtime import. Installed declarations and nested dependencies remain
read-only. `npm ls` labels this deliberately untracked link extraneous. Do not
infer compatibility with other Pi versions from TypeScript compilation.

### Manual launch and pairing

Set `COMPANION` to the absolute path of this checkout (not a Pi agent directory).
In the intended project terminal, explicitly load the built extension:

```sh
pi --extension "$COMPANION/dist/extension/bridge.js"
```

In a second terminal, from the companion checkout:

```sh
npm start
```

Open **http://127.0.0.1:4317** and submit the gateway's terminal-provided pairing
secret in the password form. It is never a URL parameter or localStorage value.
Only that exact host/origin is accepted (not `localhost`). The gateway binds literal
127.0.0.1; do not expose/proxy it remotely for C2. Cookie is HttpOnly, same-origin,
SameSite Strict, eight hours, and non-Secure solely for this loopback HTTP slice.
Restart requires new pairing. The secret is intentionally printed once to the
launching terminal, not to ordinary request/application logs.

Both processes default to the validated owner-only short `/tmp/pi-c2-<uid>` runtime
leaf. For an isolated alternative, set the **same absolute short `C2_RUNTIME`** in
both terminals. `C2_PORT` selects a literal loopback port (1024–65535; default 4317)
and establishes its exact host/origin. Multiple reachable bridges produce a conflict
notice, never silent selection. No session drawer exists. A second gateway for the
same runtime fails; its lock inode is never deleted. Kernel release on process exit
or crash permits restart. Stop gateway with Ctrl-C; Pi remains terminal-owned.

## Boundary and minimum complexity receipt

- **One package, three source boundaries:** ordinary extension, Fastify gateway,
  bundled React/Vite frontend. Strict ESM TypeScript and TypeBox validate the small
  registration/snapshot payloads. No generic plugin/transport framework.
- **Dependencies:** Fastify and official cookie/static/helmet plugins own public
  HTTP parsing, cookies, assets and security headers; Node HTTP owns private UDS.
  `fs-ext` is necessary for descriptor flock, not PID/mtime heuristics. React,
  safe react-markdown/remark-gfm and PhotoSwipe provide messages and actual zoom
  without custom gesture/dialog code. Vite, TypeScript, Vitest and Playwright are
  build/validation tools. No sharp, uploads, optional component suite or second Pi.
- **One bridge server and two disposable resources:** owner-only socket plus
  capability registration. Socket paths are generation-specific so closing an old
  listener cannot unlink the next generation's socket. Instance is random process identity retained through
  module reload via an extension-owned global symbol; generation/capability renew
  on native session start. Shutdown/replacement closes its sockets/resources.
  Only public passed context/session-manager APIs are read. No model tool,
  prompt/provider/settings mutation, AgentSession, transcript writer or manager
  mutation exists in production.
- **Snapshot/media:** raw active-branch finalized native records, generation/native
  entry IDs, bounded text/history, tool disclosures (names, not arbitrary argument
  objects), native content images. Hidden custom messages/state metadata are not
  published. Image references are HMAC-bound to generation, native entry and block;
  media requests recheck reachable authenticated peer and active native membership.
  Media is streamed, not base64 in snapshots/SSE, and not durably duplicated.
- **Bounds:** 300 branch entries, 64 blocks/item, 128,000 text characters total,
  16,000/block, 900,000 serialized snapshot bytes; 24 images, 4 MB/image, 16 MB per
  disposable snapshot, 20 million pixels/image. Unsupported/invalid/over-budget
  images and truncation are explicit. Native Pi remains the recovery source.
- **Gateway state:** one held lock descriptor, <=32 discovery records, <=8 browser
  sessions, 64 public TCP connections, four SSE readers/four media requests,
  eight-event replay ring. One
  non-overlapping periodic reachability/snapshot poll and one heartbeat timer;
  no bridge subscription or native cancellation on client departure. One native
  browser EventSource receives snapshot/status changes (not token streaming).
  IDs are gateway epoch/counter; unknown/expired IDs fall back to newest snapshot.
  A write returning false is accepted and waits for native drain, not a delivery
  failure. Each reader has a FIFO byte allowance of 8,110,000 bytes (queued frame
  bytes including framing reservation plus Node writable bytes) and a 15-second
  deadline per blocked write. Queue overflow or missed drain closes only that
  reader and frees timers, queued frames and admission. Auth expires live streams.
- **Security:** uid/mode/type/no-follow checks, short Darwin paths, capability-auth
  UDS (no bridge TCP), exact Host/Origin and cross-site rejection, bounded pairing
  body plus Origin/CSRF marker/rate limit, opaque media only, fixed safe headers,
  no CORS/forwarded-header trust, no arbitrary filesystem/remote-media endpoint.
  Markdown HTML and executable links are not rendered; external markdown images
  never fetch. Bundled browser assets only. Ordinary logs are disabled.
- **Fixture obligation:** default tests use controlled native-context fixtures;
  the separate explicit real-Pi command owns isolated HOME/config/agent/session/cwd,
  short IPC dir, environment allowlist and PTY. It copies the unchanged reviewed
  fixed-response test extension, not production provider code. Python reuses the
  reviewed cleanup helper and drains bounded PTY output while browsers work. Only
  the CLI owner runs the built-in `read`. No real keys/settings/sessions are read.

## Checked validation and screenshot evidence

Final clean bootstrap and checks all exited **0**:

```sh
npm ci --ignore-scripts
npm rebuild fs-ext
# exact-version public type-link snippet above
npm run typecheck
npm run build
npm test
npm run test:browser
npm run test:pi
python3 -B -c 'from pathlib import Path; p=Path("tests/real-pi.py"); compile(p.read_text(),str(p),"exec"); print("Python syntax: passed")'
npm audit --omit=dev --json
```

Browser engines were explicitly installed in ignored project-local cache, exit 0:

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright npx playwright install chromium webkit
```

- **Vitest 4.1.11:** 2 files / **11 tests passed** (including the P1 regressions below). Format/MIME/size/unavailable
  checks, history/escaped JSON budgets and unique IDs, unsafe runtime/symlink/path
  rejection, genuine authenticated UDS and generations, owned-inode cleanup, stale unreachable registry,
  Fastify authorization/CSRF/Host/Origin/body limits/media bytes/security headers,
  traversal/remote rejection and multiple-owner conflict. Real child gateways test
  parallel-launch exclusion, SIGKILL/kernel release with identical lock inode,
  actual SSE reader admission/fallback/disconnect and surviving bridge reachability.
- **Playwright:** **4 tests passed** in Chromium and desktop WebKit at 320 and
  390 px. Browser pairing, HttpOnly/no-localStorage, native image loading, viewer
  open/close/Escape/focus return, no remote requests/raw HTML/executable links,
  unavailable-image and truthful parent/background labels, no horizontal overflow.
- **Build:** strict TypeScript and production build passed; bundled frontend is
  ~408.46 kB JS / 124.45 kB gzip, ~6.09 kB CSS. No dev HTTP service is required.
- **Audit:** final full install/ci audit and production audit report **0 vulnerabilities**.
  Initial Vitest 4.1.10 had two moderate development mocker advisories; owning pin
  changed to release-age-eligible 4.1.11 before final clean validation. Integration
  dependencies were not remediated or changed.
- **Real Pi:** `verdict: completed`, Pi 0.99.2 TUI, exactly two synthetic assistant
  responses and **one genuine built-in read**, zero external/paid provider requests
  by the fixed adapter. Controlled Chromium-page screenshot is **240×160 PNG,
  5,050 bytes**, SHA-256:

  `ce244c6160de7bc07812f54626d5cb5200729036a28274e5753d707b2af3beee`

  Both actual browser engines assert the native tool entry ID and identical fetched
  image bytes, inline intrinsic size, PhotoSwipe loaded bytes, and **viewer width
  larger than the inline width**, not merely an open overlay. Gateway restart
  recovers identical instance/generation/ref; native `/reload` retains instance and
  changes generation, with stale old media rejected. Browser/gateway disconnect
  leaves Pi alive and tagged terminal input handled; Pi exit 0. `childReaped`,
  `gatewayReaped`, `ptyClosed`, `runtimeRemoved`, `umaskRestored`, `ownerOnlyRuntime`
  all true; `cleanupErrors: []`.

Reproducible ignored evidence images (no secrets/desktop capture):
`test-results/controlled-fixture.png`, `test-results/real-pi-chromium-inline.png`,
`test-results/real-pi-chromium-enlarged.png`, corresponding `real-pi-webkit-*` files.
These are browser fixture/test artifacts, not a product durable media store. The
owned fixture PNG is read by genuine Pi before its temporary tree is removed.
The controlled screenshot and Chromium enlarged/WebKit inline captures were also
visually inspected. Default tests never launch Pi or invoke models; `test:pi` is
explicit. Tests use fixed local ports 4391–4396 and will fail on conflicts.

### Resolved implementation iterations

Initial registry Pi type install stopped at ETARGET before dependency bootstrap;
supervisor approved only read-only installed type links. Initial strict compile
found native bash/summary messages lack `content`; the observer now discriminates
public native variants. First socket tests rejected long platform TMPDIR paths;
fixtures now use short canonical owner-only `/tmp` leaves (four empty failed-test
leaves removed). An initial real `/reload` test stalled because its runner did not
drain PTY output during browser work, not because Pi had lost native image data.
The runner now drains bounded output and puts gateway/browser children in owned
process groups. The first failure exposed one unreaped gateway; that exact owned
child was terminated, and all subsequent successful/failure cleanups and final
process inspection found none remaining. The final native smoke was repeated after
these repairs. TypeScript also caught nullable PhotoSwipe pan-area typing during
actual-enlargement work; the fit fallback was repaired before final checks.

## Remaining limits and review gate

Desktop WebKit is not an iPhone. No Tailscale/remote HTTPS, touch hardware, paid
model/provider, broad Pi-version, Linux, real subagent-work survival, input receipt
or questionnaire/browser integration claim. The test provider is explicit fixed
instrumentation reused unchanged from C1-M. Offline isolation is not an OS network
sandbox or packet capture.

PNG container CRC/chunks, JPEG markers/dimensions and WebP container/chunks plus
pixel/byte bounds are checked before delivery; this is **not a full native decoder**
and browser decode failures show unavailable. Real end-to-end image proof is PNG;
JPEG/WebP accepted-format code is not equivalent real-provider/browser evidence.
The public `getBranch()` itself materializes native history owned by Pi; transport
bounds cannot bound Pi's own session memory. Snapshot polling can allocate/decode
bounded media and is not a benchmark for very large sessions. Replay/backpressure
limits and paused real-TCP queue/deadline cleanup are tested, but sustained hostile-load
and actual slow-phone/network stress are not proved. Local same-uid trusted processes are not sandboxed by these
owner checks. Cookie privacy is local HTTP only pending a later approved HTTPS
boundary. Known disconnects show unavailable parent state; cached conversation may
remain readable without being labeled live.

**Accepted locally:** the initial fresh review identified the media P1; parent also
reproduced the SSE P1 below. Both were fixed within their owning boundaries. Targeted
review found no issues. Parent inspected the repairs and reran strict types/build,
11 unit/process tests, four Chromium/WebKit tests and real-Pi smoke, all exit 0. No next-checkpoint features were added, no staging/commit/push/publish,
and no governing/probe/integration file was edited. Root has no Git metadata;
integration cached diff remains empty.

## Exact project files changed

New: `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`,
`tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`;
`src/shared/protocol.ts`, `src/shared/runtime.ts`;
`src/extension/bridge.ts`, `src/extension/media.ts`, `src/extension/snapshot.ts`;
`src/gateway/cli.ts`, `src/gateway/lock.ts`, `src/gateway/peer.ts`,
`src/gateway/server.ts`; `web/index.html`, `web/src/main.tsx`, `web/src/style.css`;
`tests/fixture.ts`, `tests/observer.test.ts`, `tests/process.test.ts`,
`tests/browser-fixture.mjs`, `tests/browser.spec.ts`, `tests/real-browser.mjs`,
`tests/real-pi.py`; this document `docs/c2-observer.md`.
Updated: `README.md` status and reproduction/evidence link only.

## C2 P1 owning-boundary fixes — checked continuation

Local fix verdict: **completed; targeted review passed and parent accepted**.
Only `src/extension/media.ts`, `src/gateway/server.ts`, `src/shared/protocol.ts`,
`tests/observer.test.ts`, `tests/process.test.ts`, and this evidence document changed
in this continuation. Dependencies, configs, web, README, Pi version, probes,
integration and governing documents were not changed. No C3 work or authority
expansion occurred.

### Media correction

The repeated-group base64 regex overflowed V8's stack for an allowed-size block,
before the previous parser's try/catch. It is removed rather than caught. Encoded
length bounds and the existing bounded decode/reencode equality now enforce
canonical base64 in constant stack space, followed by the unchanged byte/pixel/MIME
and container checks. Invalid image content becomes unavailable while native text,
other images and parent activity remain observable.

The added regression builds a genuinely valid **1150×1150 RGB PNG**, filter-zero
scanlines, valid chunk CRCs, and a verified round-tripping stored DEFLATE stream:
**3,969,318 bytes**, **5,292,424 base64 characters**, below the unchanged 4 MB cap.
It is accepted as a native image and survives a snapshot beside each invalid block.
The parent/reviewer reproduction `'A'.repeat(5333332)` decodes to **3,999,999 bytes**
and now returns unavailable instead of throwing; the equally bounded noncanonical
base64 variant ending in `%` also returns unavailable. Remaining text and `working`
parent state survive both cases; one valid native image remains available.

### SSE correction and bounded behavior

Node `write(false)` means a complete frame was accepted above the high-water mark.
It is no longer treated as a failed write. One gateway-owned FIFO per reader queues
subsequent complete frames, resumes on the native `drain` event, and never retries
or drops an already accepted frame. Publication, initial replay, connection markers
and heartbeats all use this same owning-boundary mechanism.

`limits.sseBufferedBytes` is **8,110,000**: enough for the existing eight maximum
replay frames plus one in-flight frame and framing. Each enqueue checks reserved
queued wire bytes (+32 bytes/frame for HTTP chunk framing) plus current Node
`writableLength`. `limits.sseDrainMs` is **15,000**. A blocked write starts a deadline
that publication/heartbeats cannot extend; only actual drain permits progress and a
new blocked-write deadline. Overflow, deadline, disconnect, auth expiry and gateway
shutdown clear that reader's timer, drain listener, queue and admission entry, and
close its socket without changing Pi ownership. Four-reader admission and the
eight-frame global replay ring remain unchanged, as do 900,000-byte snapshots and
128,000-character text. These are application/Node buffer bounds, not a claim about
OS kernel TCP buffers or total process heap.

Two additional real TCP regressions use the production bridge/gateway, not Fastify
injection alone:

- One native user item with eight 16,000-character text blocks delivers a complete
  initial >128 KB EventSource-equivalent frame. Parsed publications and replay
  restore all three subsequent states in order, including the latest state.
  Native regeneration reaches both readers, unknown IDs fall back to the latest
  full snapshot, and teardown leaves the authenticated bridge reachable.
- A paused TCP reader with ~768 KB escaped-text snapshots exceeds its bounded
  queue and is disconnected; a new reader receives the latest full state. A paused
  multi-frame initial replay then exceeds the actual drain deadline without further
  publication; admission for all four readers is recovered, a fifth is denied,
  Node writable bytes remain bounded, and the native owner survives.

### Commands and outcomes

Final affected checks, all **exit 0**:

```sh
npm run typecheck
npm run build
npm test
npx --no-install vitest run tests/process.test.ts
npm run test:browser
npm run test:pi
```

- Strict TS and production build passed; unchanged frontend size ~408.46 kB JS /
  124.45 kB gzip and ~6.09 kB CSS.
- Vitest: **2 files / 11 tests passed** (three new P1 regressions). The focused real
  process/TCP suite was repeated independently: **1 file / 3 tests passed**.
- Pure `node --input-type=module` against the built media module, with built-in
  assert/zlib and a CRC-correct PNG generator, exited 0 on Node **26.5.0**: invalid
  encoded 5,333,332 / decoded 3,999,999 unavailable; noncanonical unavailable;
  valid 3,969,318-byte / 1150×1150 PNG accepted with matching bytes.
- Playwright: **4 Chromium/WebKit tests passed** at 320/390 px.
- Reused approved isolated real-Pi smoke: **completed**, Pi **0.99.2**, two fixed
  assistant responses, one genuine native `read`, both engines match native item
  and bytes and show actual enlargement. Controlled screenshot remains 240×160,
  5,050 bytes, SHA-256
  `ce244c6160de7bc07812f54626d5cb5200729036a28274e5753d707b2af3beee`.
  Restart/reload stale rejection and terminal survival all true; Pi exit 0;
  child/gateway reaped, PTY closed, runtime removed, umask restored, owner-only
  runtime true; `cleanupErrors: []`. The smoke ran after browser tests to retain
  its ignored controlled screenshot artifacts.
- Scoped formatter invocation using the existing read-only Biome executable exited
  0 and touched only the five owning TypeScript files. No dependency installation.
- Root is not Git; integration cached diff remains empty and its prior C1 dirty
  source status is preserved. Final owned-process inspection found none remaining.

One first regression run exited **1** because Vitest deep equality of two multi-MB
Buffers exceeded its default 5-second test timeout (10/11 otherwise passed).
Fixture/content assertions now use native `Buffer.equals` instead of expanding
millions of byte assertions. No production or test budget was reduced, and the
full affected suite plus repeated TCP suite passed afterward.

Residual limits remain: real end-to-end image proof is the small PNG smoke, with
near-cap valid PNG proved by native-context regression and pure Node, not a large
provider/browser experiment. No complete image decoder, sustained hostile-load,
actual slow phone, iPhone/Tailscale, other Pi versions, external provider or real
subagent-runtime evidence is claimed. Required targeted independent review follows.
