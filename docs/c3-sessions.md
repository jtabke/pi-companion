# C3 — multiple live terminal owners and reconnection

## Verdict: completed, independently reviewed and accepted locally

Two independently launched real Pi **0.99.2** TUI owners appear in one authenticated
local gateway, including one bridge before and one after gateway launch. The browser
selects either genuine native conversation/image, switches back, and two same-cookie
tabs observe different owners independently. Both owners survive browser departure
and gateway restart; fresh pairing and snapshots recover native entries/images without
duplicates. Actual selected-owner `/reload` changes generation without disturbing the
other owner. Selected-owner shutdown leaves explicitly disconnected cached content,
not a silently substituted owner. Tagged terminal input remains usable on both.

This is read-only C3, not C4/C5. No browser input, uploads, controller, questionnaires,
subagent status/control, model invocation, AgentSession construction, manager mutation,
transcript writing, prompt/tool replacement, Tailscale, global installation or service
setup exists in production. Parent idle is explicitly **not** all-work idle.

## Portable operation

Use the exact locked C2 setup and read-only installed Pi type-link instructions in
[C2 observer](c2-observer.md). Dependencies, release-age policy, build configuration,
CLI/lock, media parser and installed Pi resources are unchanged. Pi must already be
**exactly 0.99.2**; only Node **26.5.0** was runtime-checked (>=24 is the development
policy, not Node 24 evidence). No dependency installation was needed for this slice.

From the checkout:

```sh
npm run typecheck
npm run build
```

Set `COMPANION` to this checkout's absolute path. In each intended project terminal:

```sh
pi --extension "$COMPANION/dist/extension/bridge.js"
```

Start the gateway from the companion checkout, before or after either bridge:

```sh
npm start
```

Open **http://127.0.0.1:4317**, submit the terminal-provided pairing secret, and use
**Select live session**. Each option shows project/session, native parent activity,
short opaque instance and any ownership conflict. The selected instance/generation
and connection state remain visible. The choice belongs to this **view/tab**, not the
cookie or gateway. Choosing a session invokes no Pi command. Images remain native
inline/PhotoSwipe images; raw HTML, executable links and external markdown images
remain disabled. No transcript/media is stored in localStorage/sessionStorage.

Reuse the same short absolute **C2_RUNTIME** in all participating processes if isolation
is needed; the unchanged default is `/tmp/pi-c2-<uid>`. **C2_PORT** remains the loopback
port selector (default 4317); open its literal 127.0.0.1 host, not `localhost`. Nothing
attaches an uninstrumented Pi: explicitly loading the bridge is required. There is no
saved-history/path reader, resume endpoint or browser filesystem/session path.

### Recovery and ownership

- Close a tab, change selection or stop the gateway with Ctrl-C: Pi remains native
  terminal-owned. No abort/shutdown/queue operation is sent to Pi.
- A transient browser transport break retains readable cached content marked not live.
  EventSource retries the same selected instance/generation; unknown/expired replay IDs
  fall back to the current full snapshot. The browser replaces native-ID keyed content,
  not appends duplicate events/messages/images.
- After gateway restart, use **Pair again** with the new terminal secret. In an existing
  view the opaque selection remains in memory; a new page deliberately chooses again.
  Nothing silently persists auth or replays commands to simulate recovery.
- Native new/resume/fork/reload boundaries use the public shutdown/start lifecycle:
  process instance remains stable, generation/capability/socket renew. An existing view
  may reattach the same process's new generation read-only with a fresh snapshot. Old
  details/replay/media are not treated as current. A disappeared instance stays selected
  and disconnected until deliberately choosing another; a different instance is never
  substituted automatically.
- Duplicate canonical native session files produce an **ownership conflict** warning for
  reachable owners. Read-only observation is permitted. This is explicit groundwork for
  future mutation gating, **not** prevention of unrelated terminal writes. Conflict is
  neither inferred from PID/mtime/age nor retained for an unreachable stale registration.
- The gateway retains the descriptor-held OS flock and persistent lock inode. Never
  delete its lock file to force a second gateway. Kernel release permits crash recovery.
  Discovery is disposable; stale/unreachable records are ignored, not age-pruned. Bridge
  cleanup removes only its owned registration/socket inode, with generation-specific
  sockets protecting replacements.

## Identity, bounds and complexity receipt

Every new interface/state serves selection, ownership or recovery:

- `IdentitySchema`/`SummarySchema`: opaque process/generation and bounded public
  project/session/parent summary. `View` carries <=32 live summaries, selected identity,
  conflict/connection and at most one detailed snapshot. No global selected owner.
- **Private authenticated `/status`** reads public `ctx.cwd`, `ctx.isIdle()` and
  read-only session-manager `getSessionName()`/`getSessionFile()`. It never calls
  `getBranch()` or decodes media. Canonical identity uses read-only `realpath` of the
  supported native file; before Pi's first write, resolve its existing parent plus
  native basename. No supplied arbitrary path is accepted. A nonpersistent session has
  null file identity. Paths/capabilities/native private metadata stay in owner-only IPC
  and gateway memory, never projected into browser snapshots/URLs/errors/logs.
- Discovery checks capability-authenticated `/status` identity against the registration's
  instance/generation. Status is capped at **8,192 bytes**, canonical path at **4,096
  characters**, records at **1,024 bytes**, and discovery at **32 records**. Over-limit
  discovery is unavailable, never an apparently live unverified owner.
- Per-selection scopes: **four detailed snapshot/replay caches plus one lightweight
  list scope**, with **eight events per scope**. Identical selection readers share one
  in-flight snapshot; only active selected scopes are periodically read in detail.
  Idle caches are bounded LRU-evicted; active/pending reader scopes are reserved against
  eviction. Loss of selected liveness/detail validation purges connected-detail replay;
  reconnecting to a stale generation yields only explicitly disconnected state.
  Cache loss, unknown IDs, gateway epochs and cross-selection/generation IDs safely
  obtain current snapshots. No branch/media cache is added to the bridge.
- A selected SSE carries all lightweight live summaries plus its detailed finalized
  native branch. The complete JSON event is trimmed to **900,000 bytes**, including
  summaries (oldest detailed items removed with explicit truncation). Old callbacks
  are closed/identity-keyed in the browser. Switching closes the old EventSource before
  opening the next; there is one active EventSource per view. Cached UI content is only
  the selected identity in volatile React state.
- Accepted C2 bounds remain: **300 native entries**, **64 blocks/item**, **128,000 text
  characters**, **16,000/block**, **24 images**, **4 MB/image**, **16 MB per disposable
  snapshot**, **20 million pixels/image**. Constant-stack canonical base64 validation
  and the media parser are untouched. Media rechecks authenticated generation and
  active native membership and streams bytes; identical-image/native-tool-call
  collisions across owners do not authorize cross-owner references.
- Four SSE readers/four media requests, eight auth cookies, 64 public connections,
  nonoverlapping poll and heartbeat timers remain bounded. The accepted reader-local
  FIFO remains **8,110,000 bytes** including queued/reserved framing and Node writable
  bytes, with a **15,000 ms** blocked-write deadline. `write(false)` is accepted, not
  retried/dropped. Overflow, deadline, disconnect, auth expiry and shutdown free only
  companion resources. Each selection's replay increases bounded gateway memory; these
  limits do not claim a bound on total V8/OS heap or Pi's own history materialization.
- Fixture additions are only owning-boundary regressions and the existing opt-in real
  harness. The browser fixture's reload/disconnect routes are test-only context/bridge
  lifecycle, never compiled production routes or native-agent mutation interfaces.
  The real harness owns two isolated config/session/cwd trees, PTYs, process groups,
  browser/gateway children and one short shared IPC leaf, and drains both PTYs while
  browsers work. The reviewed fixed provider is copied **unchanged byte-for-byte** for
  each test owner; it is not production code or a new probe/framework.

## Focused validation

Final production/source checks all exited **0**:

```sh
npm run typecheck
npm run build
npm test
npm run test:browser
npm run test:pi
python3 -B -c 'from pathlib import Path; p=Path("tests/real-pi.py"); compile(p.read_text(),str(p),"exec"); print("Python syntax: passed")'
```

- **Vitest: 2 files / 14 tests passed.** Prior constant-stack near-cap valid PNG,
  malformed media, large-SSE ordered replay and paused-reader byte/deadline/admission
  regressions remain. New checks cover before/after gateway discovery, unselected
  `getBranch()` count **zero**, shared simultaneous detail requests, opaque selected
  snapshot/media isolation despite identical native entry/image fixtures, stale native
  replacement and disappearance, authorization/crosssite/schema/path-query rejection,
  canonical duplicate conflict/privacy and stale registration exclusion. Real TCP tests
  use one cookie for independently selected readers, cross-scope ID fallback, ordered
  reconnect, generation fallback/no duplicates and no substituted owner.
- **Playwright: 6 tests passed** in Chromium and desktop WebKit. Retained 320/390 px
  security/image/enlargement/Escape/focus/no-overflow checks, plus two same-cookie tabs,
  rapid A/B/A switching, same-scope reselection, native-context generation replacement,
  disconnected cached selection and empty browser storage. These are supported-context
  fixtures, not claims of real native writes or iPhone proof.
- **Build:** strict TypeScript passed; bundled frontend **410.32 kB JS / 124.95 kB gzip**,
  **6.14 kB CSS**. No package/lock/build-config or npm policy change.
- **Real Pi:** `verdict: completed`; **two normal TUI owners**, **four fixed local
  assistant responses**, **two genuine built-in reads**, no external/paid model call.
  A bridge was observed alone before gateway, then the second after gateway. Both real
  owners read identical controlled-browser screenshot bytes: **240×160 PNG, 5,050
  bytes**, SHA-256:

  `ce244c6160de7bc07812f54626d5cb5200729036a28274e5753d707b2af3beee`

  Both engines select A/B/A, match native tool entry IDs and exact bytes, check full
  branch unique IDs/counts, and prove PhotoSwipe image width exceeds inline width.
  Same-cookie tabs select different real owners. Gateway restart/new pairing restores
  both original instances/generations/native entries/refs/bytes without duplicates;
  both remain alive and receive tagged terminal input. Live actual `/reload` of selected
  A preserves instance/native entries/image bytes, changes generation, automatically
  resnapshots, rejects old media with **410**, and leaves B's generation/entries intact.
  Live selected B `/c1m-finish` exits B **0** while the page retains disconnected cached
  B and A remains live. A receives tagged input after gateway/browser/B departure and
  exits **0** normally. All `childReaped`, `gatewayReaped`, `ptyClosed`, `runtimeRemoved`,
  `umaskRestored`, `ownerOnlyRuntime` true; `cleanupErrors: []`.
- **Precisely mocked conflict evidence:** only read-only public-context
  `getSessionFile()` returns two fixture aliases of one canonical fixture file; both
  bridges, private authentication, gateway discovery and projection are real sockets.
  No two real Pi writers were aimed at the same file. The file is never parsed as
  transcript. Closing one bridge and leaving a stale valid record clears conflict;
  canonical paths, alias paths, runtime paths and capabilities never enter responses.

Ignored screenshots: `test-results/controlled-fixture.png`,
`test-results/real-pi-{chromium,webkit}-{a,b}-{inline,enlarged}.png`.
They capture only controlled browser pages, not desktop/credentials. Chromium A
enlargement and WebKit B inline captures were also visually inspected. Test output
and fixture evidence files are disposable instrumentation, not a transcript database.

### Repairs during validation

One new TCP test initially counted expected errors from intentionally destroyed
readers as transport failures; it now checks still-live readers and bounded-frame
errors separately. Chromium initially selected before fixture options arrived; the
fixture test now waits for discovery. First live-reload real runs exposed same-scope
reselection clearing cached UI without changing the subscription key; the owning
selector now treats identical instance/generation as a no-op, with browser regression.
Final self-inspection also purged old connected-detail replay on selected liveness
loss; a real TCP stale-generation reconnect regression proves no old details replay.
Its first iteration republished unchanged disconnected state after clearing an already
empty ring on every poll; clearing now happens only at the connected-detail boundary.
All affected checks and the complete real two-owner smoke passed afterward. Failed
real runs also reported complete owned-child/PTY/temp/umask cleanup. Production/private
identity diagnostics are redacted; no raw terminal output or pairing secret is logged.

## Changed files and review boundary

- `src/shared/protocol.ts`: public summary/selection and private status schema.
- `src/extension/bridge.ts`, `snapshot.ts`: lightweight status/private public-native
  identity; selected snapshots preserve accepted native media/lifecycle behavior.
- `src/gateway/peer.ts`, `server.ts`: authenticated lightweight discovery, canonical
  conflict projection, per-selection routing/replay/shared bounded fetch/reader cleanup.
- `web/src/main.tsx`, `style.css`: accessible selector, per-view subscription/cache,
  generation recovery, explicit disconnect/conflict presentation and narrow controls.
- `tests/fixture.ts`, `observer.test.ts`, `process.test.ts`, `browser-fixture.mjs`,
  `browser.spec.ts`, `real-browser.mjs`, `real-pi.py`: affected fixtures/regressions and
  real two-owner smoke.
- `README.md`, this document: status, launch/recovery links and evidence.

No `src/shared/runtime.ts`, media parser, CLI/lock, dependencies/lock/configs, old
probes, integrations, global settings or governing PLAN/SPEC/STACK/checkpoint edits.
Root is not Git; no staging/commit/push/publish occurred. Integration cached diff is
empty and its prior C1 dirty source paths remain untouched. Final process inspection
found no owned gateway/fixture/real-Pi children remaining.

Residual limits: only local Pi 0.99.2/macOS/Node 26.5.0 and desktop engines checked.
No actual iPhone/Tailscale, external provider, real subagent survival/control, native
busy receipt/queue/question flow, alternate Pi versions/platforms, full image decoder
or hostile-load/slow-phone guarantee. Lightweight status still reads native identity
and polls; it is not a real-time subagent/work completion API. Native new/resume/fork
use the same public lifecycle covered by deterministic replacement tests; only reload
is exercised against real Pi here. Fresh independent review found no issues. Parent
inspected selection/private-identity/replay/browser boundaries and reran strict types,
production build, 14 unit/socket/process tests, six browser tests and two-real-owner
smoke; all exited 0. C3 is accepted locally, not C4/C5 or global installation approval.
