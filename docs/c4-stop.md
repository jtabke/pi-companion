# C4-C2 — explicit leased browser Stop

## Accepted locally

On Pi **0.99.2**, a deliberately controlling tab requests the selected reachable,
nonconflicted generation's current parent abort through **POST /api/stop → private
POST /stop → public ctx.abort(): void**. Native Pi arbitrates activity at dispatch;
there is no run-specific cancellation capability. Ordinary terminal input is unchanged.

Use the existing C2 setup and C4-A pairing/selection/control instructions. **Stop** is
disabled for read-only, disconnected, conflicted, idle/no-pending, expired/stale, or
already Stopping views. Existing 44px touch targets, focus styles and disabled styling
apply. Native idle/no-pending is checked again before a new abort attempt.

A void return reports **Dispatched; outcome unconfirmed**, not cancellation accepted
or completed. A thrown attempted abort remains **Uncertain**. **Stopping** persists
through idle polls and agent_end. Only a subsequent public agent_settled observed in
the current generation/context with current idle and no pending messages reports
**Parent: settled (observed)**. This is not an acknowledgement of the Stop request,
proof that abort caused settlement, or cancellation of queued/delayed/background work.
Background work remains explicitly unobserved. Subsequent parent work clears the
settled observation and appears Working. Ignored/stalled aborts remain Stopping.

A lost response retains one immutable, volatile Stop identity, separate from the text/
image draft and input retry. Only **Retry same Stop request** sends that original ID,
to that original generation under fresh authority; this retry does not require idle.
No reconnect, selection, pairing, lease, departure, shutdown or gateway restart aborts
Pi or automatically retries. Switching cannot redirect the outstanding request. Native
generation loss leaves uncertainty unresolved; page reload discards volatile state,
not proof that the request was unsent. New idle text/image attempts remain blocked
while the native generation has an unconfirmed stopping marker.

## Owning boundaries and complexity receipt

- Reused: exact Host/Origin/cookie/CSRF policy, explicit controller lease/revision,
  per-instance admission with no Promise waiting queue, fresh authenticated discovery/
  canonical-file conflict check, bounded UDS and receipt transport, summary/SSE path,
  generation lifecycle, existing native input ledger, existing draft/image admission
  and original-source retry, existing isolated PTY/provider/browser harness.
- Added: query-free 1,024-byte exact browser/private Stop schemas and two native
  rejection reasons (idle/stopping); one optional summary observation; one bounded
  generation marker with local event ordering and captured public session identity/
  context guards; one kind tag per existing ledger record; one separate outstanding
  browser Stop and bounded status string. Each serves Stop authority, deduplication,
  truthful observation or preservation of accepted input.
- Before public abort, the native marker and uncertain receipt are already recorded,
  including for synchronous callbacks. The **same <=256-ID ledger** retains all
  previous receipts, including rejected/uncertain requests; it never evicts or
  reinvokes a full ledger. Explicit kind checks prevent Stop/text/image aliasing.
  C4-A SHA-256(JSON.stringify(authored text)) and C4-B original-source image
  fingerprints remain unchanged. Receipts never upgrade to native cancellation proof.
- Replaced: the two-fixed-input forwarding helper now supports a third fixed Stop
  POST, not generic command forwarding. UI no longer labels Stop deferred.
- Added tests only: the existing context fixtures now supply the declared public
  getSessionId method used by the Stop context guard; ignored/throwing/synchronous
  abort and lifecycle fixtures; three
  browser scenarios; a separate opt-in --stop mode holds the existing second local
  fixed response until its public provider AbortSignal fires. No extra provider budget,
  tool, native read, dependency, transcript store or production hook is introduced.
- Removed obligations: none. No controller/decoder/media/snapshot/runtime/CLI/flock,
  installed Pi, integration, package/global configuration or governing-doc change.

## Focused evidence

Final checks, all **exit 0**:

```sh
npm run typecheck
npm run build
npx --no-install vitest run tests/observer.test.ts -t 'C4 Stop|lone-surrogate|deduplicates native IDs|omitted native blockImages|one native ledger for image'
npm run test:browser -- --grep 'C4 Stop'
python3 -B tests/real-pi.py --stop
python3 -B -c 'from pathlib import Path; p=Path("tests/real-pi.py"); compile(p.read_text(),str(p),"exec"); print("Python syntax passed")'
```

- Strict types/build passed; bundled frontend **420.70kB JS / 128.01kB gzip**, 6.64kB
  CSS. No production Pi runtime import or new dependency.
- **11 Vitest checks passed, 17 skipped**: seven new Stop checks plus four existing
  exact-text/image/default-policy ledger regressions. Authenticated real UDS tests
  prove one abort, identical-ID recovery, cross-kind mismatch, shared ledger-full bound,
  marker-before-call synchronous settled callback, prior/foreign/stale/replacement
  events, idle/end/pending insufficiency, current settled observation and future work,
  ignored/throwing abort, native unavailable/idle/stale rejection and no close abort.
  Gateway checks cover exact auth/Host/Origin/CSRF/query/schema/body/lease, real TCP
  bare-query rejection and departure during awaited discovery, bounded overlapping
  admission, takeover/release/expiry/cookie expiry/replacement/fresh canonical conflict/
  shutdown rejection, lost receipt and fresh-authority gateway-restart native dedup.
  Public view inspection rejects lease/capability disclosure. No native/private control
  capability is added to SSE or logs.
- **6 Playwright checks passed**: three scenarios in Chromium and desktop WebKit.
  Deliberate control/read-only, ignored/throwing abort, idle/end/pending insufficiency,
  same-ID retry while working/Stopping, switching, real gateway restart/new pairing/
  explicit claim, takeover/replacement and no automatic abort/retry; separate original
  image-input retry survives Stop without changing source/text/MIME/ID or edited draft.
  Desktop WebKit is not an actual iPhone/native-abort acceptance result.
- **Genuine opt-in --stop completed**: one normal Pi 0.99.2 TUI owner, one native user
  input, two network-free fixed response requests and one genuine built-in read. The
  second provider response genuinely remains held; read-only-tab departure and browser
  switching leave it alive. Browser Stop through the production gateway/UDS/public
  context abort triggers its real provider signal, then public parent-settled plus
  idle/no-pending observation. Deliberately lost browser response, exact-ID retry and
  gateway restart/fresh pairing/control recover the surviving native receipt/observation
  without another user turn. Draft and unsent attachment remain intact. Owning drained
  TUI shows the tagged native input, fixture.png tool and held response text; terminal
  tags remain usable after gateway departure/restart. Pi exits **0**. Child/gateway
  reaped, PTY closed, runtime removed, umask restored and owner-only tree checks passed;
  **cleanupErrors: []**. No external/paid/default model, owner credentials or desktop
  capture. Ignored-abort fixtures are not substituted for this native result.
- Controlled `test-results/real-pi-stop.png` was visually inspected: selected connected
  owner, honest parent observation/dispatch receipt, disabled idle Stop, preserved
  draft/local image and native read output. It is not a desktop screenshot. Source
  controlled image: 240x160 PNG / 5,050 bytes, SHA-256
  `ce244c6160de7bc07812f54626d5cb5200729036a28274e5753d707b2af3beee`.

Validation repairs were local: an overloaded Pi event registration required explicit
public registrations (initial typecheck exit 2); Fastify injection normalizes a bare
question mark, so its rejection check now uses real TCP (initial focused test exit 1);
fixture reset changes generation, so immutable browser retry compares its actual
original generation rather than a stale poll-list value (initial browser check exit 1).
All affected final checks passed. Test cookie reuse preserves the existing eight-cookie
cap. No production policy was weakened for tests.

## Changed files and remaining limits

Production: src/shared/protocol.ts, src/extension/input.ts, src/extension/bridge.ts,
src/gateway/peer.ts, src/gateway/server.ts, web/src/main.tsx.
Tests: tests/observer.test.ts, tests/fixture.ts, tests/browser-fixture.mjs, tests/browser.spec.ts,
tests/input-fixture.ts, tests/input-browser.mjs, tests/real-pi.py.
Documentation: docs/c4-stop.md.

Root has no Git metadata or historical Git baseline. Changes are measured against the
parent's supplied pre-edit copies. No staging/commit was performed; the separate
integration checkout's staged diff is empty and it was not modified. Owned fixture/
gateway/native processes were cleaned up.

Public events have no request/run ID. Observation is generation/local-event ordered,
not causal cancellation proof; discovery is not an atomic cross-process ownership lock.
Native ledger is generation-local and refuses fresh IDs when full. A stalled abort can
remain Stopping indefinitely; no timeout or private completion Promise is used. Native
background work remains unobserved. Only Pi 0.99.2/Node26/macOS is runtime checked;
iPhone/Tailscale, other versions/platforms, busy Steer/Follow-up, questionnaires and
actual subagent survival are not claimed.

## Parent acceptance

Fresh read-only review found no issues after inspecting source, supplied baseline copies,
test code, controlled screenshot and retained raw final writer output. Parent inspected
the owning native ledger/context/observation, bridge, authority gates, fixed transport and
separate browser Stop retry. The 14-file source/test/evidence delta matches the approved
envelope; governing documents and other supplied baseline hashes were unchanged before
parent acceptance edits.

Parent independently ran strict types/build, the full **37 unit/process tests**, full
**20 Chromium/desktop-WebKit checks**, genuine native **--stop, --image, --input** and
prior **two-owner test:pi**, audit zero and Python syntax. All exited 0. Each native check
reported Pi exits 0, all cleanup flags true and no cleanup errors. No owned test/gateway/
Pi processes remain; integration staged diff is empty. Parent visually inspected the
390px controlled native Stop page, including honest settled/dispatch labels, preserved
local draft/attachment and genuine read image.

Genuine native gateway restart proves receipt/observation recovery, not same-page draft
preservation; the latter is deterministic browser evidence. Public events still cannot
prove causal or universal cancellation. C4-C2 is accepted locally. C4-D supported
questionnaire integration is next; no remote/iPhone or background-work verdict is added.
