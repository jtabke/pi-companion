# C4-D: observed supported questionnaires

Implementation verdict: **accepted locally (source-loaded opt-in only)**.
Prior C4-C2 Stop remains accepted; browser Steer/Follow-up remains owner-deferred.
C4-E actual background-work survival is next; C5 private HTTPS/iPhone and C6 packaging remain later.

## Supported boundary

The bridge observes the documented source-only questionnaire v1 request/closed channels
through public `pi.events`. It emits only the documented reply channel and captures its
matching reply-outcome **before** emit. No runtime questionnaire import, universal dialog
interception, private TUI access, new dependency or second completion arbiter exists.
The source package remains uninstalled and unchanged by this checkpoint. Enable
`companionReplies: true` only in an explicitly authorized source-loaded environment;
see [the public source contract restoration guide](../integrations/README.md#public-contract).
Default-off, RPC, no-UI and requests published before bridge observation remain terminal-only.

A generation owns at most four live observed invocations. Each published JSON request
is limited to 65,536 UTF-8 bytes; aggregate live content is at most 262,144 bytes.
Questions/options are limited to four, headers to 16 and labels to 60 UTF-16 units;
question/description/preview strings are limited to 16,000 UTF-16 units. Invalid or
oversized requests are rejected whole, never truncated or substituted. Public fields
are projected into bridge-owned records. Duplicate active publication never replaces
an authored request. A bounded sticky generation-local terminal-only notice records
observation overflow, without overflow IDs, eviction, tombstones or history.

Private capability-authenticated UDS `GET /questions` reads current live state within
270,000 bytes; `POST /question-reply` names the exact instance/generation and public
invocation/reply IDs. The authenticated query-free browser `POST /api/question-reply`
adds the private lease. Both reply envelopes are bounded to 70,000 bytes and independently
enforce the inner public 65,536-byte cap and 8,192 UTF-16-unit custom/note bounds.
Strict non-coercing TypeBox validation, exact Host/Origin, CSRF/cookie, fresh canonical
ownership/reachability, no-wait per-instance admission and post-await authority/departure
checks reuse the accepted input boundary. Native current generation/session identity and
observed active invocation are checked immediately before public emit. Native idle/Stop
input eligibility is deliberately not a questionnaire eligibility gate.

Question IDs and outcomes are separate from the unchanged text/image/Stop 256-ID ledger.
Only a matching valid public outcome establishes acceptance by the same live completion
callback, **not native model dispatch or persistence**. Invalid active replies leave the
question pending. Missing/malformed outcomes, closure alone and timeout never establish
acceptance. A one-second active outcome wait is bounded inside IPC deadlines; departure
and generation death clean up its observer. There is no reply ledger, broker or answer store.

## Selected browser and recovery

Only selected-owner detail carries full question state; unselected discovery/status does
not fetch it. Existing selected detail caches, SSE/replay and backpressure remain the
transport owners. The full browser frame stays within 900,000 bytes by trimming a
scope-owned snapshot copy, including framing allowance and questionnaire content.
No capability, lease or canonical native path is included in browser views.

Accessible fieldsets, exact radio/checkbox labels, full safe Markdown descriptions and
previews, free/null/partial/empty responses, optional question/global notes and explicit
Submit/Cancel preserve the source owner's answer semantics. Read-only tabs can observe;
only fresh current-tab authority can submit. Browser forms are volatile, bounded by the
four selected live records and keyed to exact owner/generation/invocation. No browser
storage is used. The form never auto-selects or auto-submits an answer.

One immutable uncertain original reply is retained separately from editable form/input
state. There is no automatic retry. Deliberate repeat requires the original invocation
still observed under its original owner/generation, fresh control and a fresh random
reply ID; edits cannot substitute its payload. Missing/closed/owner-lost state remains
honest uncertainty, not a browser-won inference. Stale asynchronous receipts cannot
establish success for a switched/replacement/reclaimed authority. Re-pairing preserves
that volatile original; existing text/image drafts, original-source input retry and Stop
observation/retry remain independent.

Gateway reconstruction/new pairing recovers still-pending state from the surviving
bridge. It does not recover missed publication or state after native generation death.
Browser switch/departure, lease release/expiry and gateway shutdown never cancel a
question; the terminal remains the completion owner.

## Focused evidence and reproduction

```sh
npm run typecheck
npm run build
npm test -- tests/observer.test.ts -t 'C4 questionnaire|C4 Stop native|C4-A generation|C4-B original|C4-B production'
npm run test:browser -- --grep 'C4 questionnaire'
npm run test:browser -- --grep 'C4 Stop ignored'
npm run test:browser -- --grep 'C4 same-cookie controller'
python3 -B probes/run-questionnaire-replies.py --companion
python3 -B probes/run-questionnaire-replies.py
python3 -B probes/run-questionnaire-replies.py --default-off
```

Nine new focused observer tests cover public count/field/byte boundaries, overflow and
non-replacement, synchronous outcome plus closure, invalid/missing outcomes, stale native
session/generation/invocation, listener/departure cleanup, authenticated UDS/schema,
selected-only state and frame budgeting, no-wait admission and post-await expiry,
cookie expiry, canonical conflict, replacement, departure and shutdown. Real gateway
reconstruction retains an observed pending invocation. Retained text/image/Stop tests
exercise their unchanged shared ledger, original-source retry, admission and observation.

Four new browser scenarios pass in Chromium and desktop WebKit at 320/390 px: full safe
content/free/multi/notes/cancel, read-only and same-cookie takeover, terminal closure,
invalid correction, immutable deliberate repeat versus edits, owner switching, actual
gateway reconstruction/new pairing, generation invalidation, lost accepted response and
delayed stale receipt honesty, with input/image/Stop controls preserved. These are
supported-event fixtures, **not genuine TUI/model evidence or actual iPhone verification**.

The opt-in existing PTY probe source-loads questionnaire 2.11.0 inside installed Pi 0.99.2
and adds the production bridge, production gateway and Chromium browser/HTTP client.
One isolated owning Pi runs at a time, with allowlisted temporary HOME/config/agent/
sessions/cwd and only temporary explicit opt-in. Both real browser-first and terminal-
first answers resolve the same invocation once. Invalid then corrected replies, stale/
late IDs, reader/controller departure and switching, pending gateway reconstruction/new
pairing/control, terminal survival, native reload old-generation rejection and pending
orderly shutdown pass. Zero before-agent/agent/provider requests and native user messages
are checked both before reload and at final shutdown; zero native session files exist.
Browser/gateway/lock, owning Pi, PTY, temporary runtime and umask cleanup all pass.
The probe retains raw JSONL/TUI logs outside the removed runtime and reports their directory.

The public tool definition is invoked directly from a registered command, with a genuine
TUI/public context. This is **not native model tool dispatch or durable persistence**.
No provider/model, external endpoint, personal credential/config, desktop capture,
installed/global package change or Tailscale setup was used. Default and default-off
source paths are rerun because the shared probe changed. Exact protected questionnaire
source/package hashes and integration staged state are checked against the supplied
pre-edit baseline, not invented root Git history. Root has no Git metadata.

## Checked final results

- Strict types and production build: exit 0.
- Focused observer/retained text/image/Stop checks: 24 passed; 13 unrelated checks skipped.
- Combined focused Chromium/desktop-WebKit questionnaire and retained input/Stop scenarios:
  12 passed, exit 0; isolated questionnaire run also passed all eight engine checks.
- Genuine companion, prior source and default-off PTY paths: completed, Pi exit 0,
  zero model/native-user/session writes and all cleanup flags true, no cleanup errors.
- Supplied baseline: all 143 baseline copies verified against their manifest; all 96
  protected integration files unchanged; 11 existing root files changed and four added.
  Governing docs, dependency/lock files and other protected paths unchanged. Integration
  staged diff empty; root has no Git metadata. No install/stage/commit/publish occurred.

Iteration failures were repaired and affected checks rerun: volatile uncertain state
originally unmounted on re-pair; a browser check initially clicked stale closed content;
real client startup/reload/stdio shutdown needed harness synchronization; and a combined
focused run exposed fixture reset returning before replacement-generation discovery.
The owning fixture now waits for lightweight generation publication, without changing
production authority behavior. Final raw logs and actual baseline-copy diffs are retained
in the managed implementation report's evidence directory for fresh review.

## Retained Cancel serializer correction

The reviewer found that selecting **Choose options** without an authored radio could
serialize an empty (or previously typed non-label) option even when cancelling. The
existing serializer now emits an option only for an exact owner-authored label; an
unfinished option is omitted, or retains notes through the existing `custom: null`
notes-only representation. Valid answers and notes remain intact; widgets, transport,
public source validation and authority/retry behavior are unchanged.

Two bounded browser regressions inspect the exact actual public POST and same-invocation
closure: fresh unfinished options, and free-response-to-options with per-question/global
notes plus another valid multi answer. Before the fix all four Chromium/WebKit checks
failed on the invalid authored payload; after it these checks and the existing full-safe
scenario pass (six checks). Types/build pass. No prior genuine TUI work was repeated.

An additional downstream equality assertion exposed a separate existing transport defect:
Fastify/AJV coerces an authored `custom: null` into `custom: ""`. These are distinct allowed
values, not interchangeable. The Cancel fix proves the browser POST and valid cancellation,
not nullable end-to-end preservation. Parent kept that repair outside the browser-only
fix envelope, then made the separate owning-transport correction below. Raw failing equality
and final red/green logs are retained with the managed Cancel-fix report.

## Parent nullable-transport correction and acceptance

Parent reproduced authored null becoming empty string through the actual authenticated
gateway, production UDS and native public event bus. Both browser engines also failed the
restored downstream equality check. The fix removes only the question route's redundant
AJV body schema; the existing strict TypeBox check remains the body validator. Query/body/
inner-byte limits, auth/lease/generation/canonical-conflict/departure gates are unchanged.
No global AJV setting, new validator, body-copy workaround or source-package edit is added.

The gateway regression now distinguishes custom null/empty, multi null, notes and cancelled
answers, and rejects invalid numeric/boolean/unknown fields without forwarding. The browser
Cancel regression again checks the complete downstream payload equals the original POST.
Focused red: one unit failure and two browser failures. Focused green: ten questionnaire
unit checks and twelve browser checks; types/build pass. Targeted retained review found no
remaining Cancel, nullable-fidelity or route-validation issue.

Parent inspected the owning state/bridge/transport/selected view/forms, actual copy-based
scope and raw native JSONL/TUI records. Final aggregate commands, all exit 0:

```sh
npm run typecheck
npm run build
npm test
npm run test:browser
python3 -B probes/run-questionnaire-replies.py --companion
python3 -B probes/run-questionnaire-replies.py
python3 -B probes/run-questionnaire-replies.py --default-off
python3 -B tests/real-pi.py --stop
python3 -B tests/real-pi.py --image
python3 -B tests/real-pi.py --input
npm run test:pi
npm audit --json
```

Full results: **47 unit/process tests**, **32 Chromium/desktop-WebKit checks**, genuine
companion/prior/default-off source TUI, native Stop/image/text and prior two-owner paths
passed. Python syntax and empty integration staged diff passed; audit zero. Companion
TUI has both actual answer winners, invalid/stale safety, departure/switch, actual gateway
CLI-process restart while pending, terminal survival, reload/shutdown safety and zero
provider/native-user/session writes. All native cleanup flags pass with no errors; no owned
browser/gateway/Pi processes remain. All 96 protected questionnaire source/package files
remain unchanged. No staging, commit, global installation or Tailscale setup.

The initial 15-file root envelope, retained three-file Cancel correction and parent
three-file nullable correction stayed bounded. Governing docs changed only after parent
acceptance. C4-D is accepted locally; actual installed-package background-work survival
is next. The installation, model-dispatch/persistence and phone limits above still apply.

## Complexity receipt and limits

Reused: existing selected observation/replay/backpressure, public SafeMarkdown, control
lease/admission/auth/generation gates, UDS HTTP and public questionnaire completion owner.
Added: one cohesive generation-local observed-question owner, fixed question state/reply
schemas/transports, one bounded volatile questionnaire panel/original uncertain attempt,
nine source-named observer tests, four browser scenarios and an opt-in real-TUI browser
client. These obligations are required for bounded live observation, selected disclosure,
same-invocation reply correlation and honest stale/uncertain handling. No mechanism,
caller or persisted state was removed/replaced by the original implementation. The parent
correction removes redundant coercing body validation and reuses the existing strict
validator; it adds no validation mechanism. Scope stayed inside the original C4-D owners.

Public outcome wait expiry is uncertainty, not completion. Gateway restart in the probe replaces the production CLI process, releases/reacquires
its process-lifetime lock and pairs with its new secret; native Pi and bridge survive
throughout. Source loading is not global installation.
Only Pi 0.99.2 and the existing local engines are checked. Parent completed broad regression,
review and disposition for C4-D; future installation/phone/background-work decisions remain separate.
