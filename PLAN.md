# Implementation plan

## Current checkpoint

**C0 — Specification: complete.**
**C1 — Investigation: complete with documented limited verdicts.**
**C2 — One live session, one real screenshot: complete locally and accepted.**
**C3 — Multiple terminal sessions and reconnection: complete locally and accepted.**
**C4-A — Explicit browser control and idle text send: complete locally and accepted.**
**C4-B — Image preview/upload and native feedback: complete locally and accepted.**
**C4-C1 — Browser busy steer/follow-up: deferred by the owner.**
**C4-C2 — Explicit Stop: complete locally and accepted.**
**C4-D — Supported questionnaire: complete locally and accepted (source-loaded only).**
**C4-E — Actual background-work survival: complete locally and accepted.**
**C5-A — Exact private HTTPS application boundary: complete locally and accepted.**
**C5 — First private iPhone screenshot/feedback journey: accepted by owner report.**
The owner confirmed phone text/image input, uploaded and native read-tool image zoom,
lock/unlock reconnect and refresh followed by explicit session reselection. This is
manual owner verification, not instrumented mobile automation. Phone-specific Stop,
questionnaire, every picker format and keyboard/accessibility behavior are not claimed.
Independent C5-A review and parent types/build/51 unit/process checks passed.
**Current checkpoint — Initial commit preparation: complete and accepted.**
The README now covers newcomer prerequisites, copyable setup/start, current features,
limits, architecture and philosophy. Docs are indexed; the local nested questionnaire
checkout is ignored and its exact 12-file delta/license has portable restoration material.
Fresh read-only review found no issues. Parent independently checked all 1,143 restored
integration files against baseline/live bytes, 64 commit candidates, 69 documentation
links, protected source hashes and empty indices; the exact README declaration-link
command passed twice in an isolated directory. Types/build and all 51 tests passed.
No full browser/native suite or fresh dependency install was repeated for this docs-only
pass; earlier browser and compatibility limits remain recorded.
**Next ready action:** create the owner-authorized local initial commit, excluding
`docs/implementation-checkpoint.md` as a preserved local-only handoff. The candidate
set is now 63 files; its documentation link is removed. Then inspect the phone UI for
a bounded space-efficiency and interaction pass, separate from the initial commit.
Packaging/publishing remain deferred; no npm pack, push or publish. Runtime behavior
is unchanged by this commit preparation.
The approved manual gateway is running on literal loopback in HTTPS-origin mode;
foreground Serve became active after native owner consent. Parent verified the
certificate and actual HTTPS shell/assets, auth denials and exact Host/Origin gates.
No Funnel is enabled. Actual phone evidence is limited to the owner checks above. HTTPS certificates can publish the device DNS
name in Certificate Transparency; the owner has been warned. See docs/c5-private-https.md.
No global Pi install, autostart service, Funnel, route reset or settings replacement.
Preserve accepted inputs, Stop, questions, terminal and background-job ownership.
No busy sends, subagent-policy changes or paid/external test models.

### Initial commit preparation envelope

Existing source/test/probe directories already have coherent owners. Keep their paths
and bytes unchanged. Update the README into concise operating instructions, index docs,
and correct current phone status without deleting historical evidence. Preserve root
PLAN/SPEC/STACK paths to avoid an unnecessary caller/reference migration.

The local questionnaire checkout is a nested Git repo with reviewed uncommitted changes.
A parent Git entry would record upstream HEAD, not that delta. Ignore the local checkout
and preserve all 12 changed/new questionnaire files as one upstream-v2.11.0 patch, with
license/attribution and manual restore instructions. Prove clean-base application and
exact reconstructed bytes; do not change the live checkout, installed package or globals.

Closed worker files: .gitignore, README.md, SPEC.md, STACK.md, docs/c5-private-https.md,
docs/c4-questionnaire.md and docs/questionnaire-replies.md (only their ignored-checkout
contract links); new docs/README.md, integrations/README.md,
integrations/questionnaire-v2.11.0.patch, integrations/LICENSE.rpiv-mono. Parent owns PLAN.md and docs/implementation-checkpoint.md.
No new dependency, bootstrap script, runtime behavior, package/license choice, CI/service
or broad reformat. Check candidate files, ignored generated/private files, all protected
source hashes, empty index and patch restoration. Runtime logs/reports stay outside repo.
Completion: initial-commit candidates are portable and documented, with behavior unchanged;
parent reports actual staging/commit state. C6 packaging remains deferred.

[Background survival evidence](docs/c4-background-survival.md) proves one actual installed
pi-subagents 0.73.1 native child on Pi 0.99.2, active through shipped browser A/B/A closure
and actual CLI crash/new PID/new pairing/flock recovery, then same-ID completion after
release. The owner approved two fixed child responses/one read plus one fixed parent
acknowledgement; normal completion wake is preserved. Three reviewed fixture defects
were repaired. Parent passed types/build, 47 unit/process tests, real background/input
checks and normal/held-interrupt cleanup. Full browser run passed 31/32; an unchanged
Chromium control-race test timed out, then its focused rerun passed. This remains a
recorded validation limit, not an all-green suite claim. No production/global change;
cleanup passed and protected hashes are unchanged. C5/actual iPhone remain unproved.

The owner approved deferring browser Steer/Follow-up to reach the first phone test.
Public busy dispatch exists, but automatic release of a one-outstanding-attempt slot
cannot use settled/idle as input-processing acknowledgement. No Pi core change or
one-send-per-generation workaround is approved. See [busy-control evidence](docs/c4-busy-controls.md).
Stop is independent: observe parent settlement, not per-request cancellation, queue
cancellation, or completion of background work. C4-E is accepted as the prerequisite
for private phone setup; it does not add browser job status or cancellation guarantees.

[Questionnaire evidence](docs/c4-questionnaire.md) proves the same opted-in source TUI
invocation through production bridge/gateway/browser, terminal/browser once-only winners,
invalid/stale safety and pending gateway-process restart. Review found unfinished-option
Cancel serialization; its retained correction has actual POST red/green coverage. Parent
then reproduced nullable reply coercion and removed only the redundant route body validator;
strict existing TypeBox validation remains. Targeted review cleared both fixes. Parent
passed types/build, 47 unit/process tests, 32 Chromium/WebKit checks, genuine companion/
prior/default-off TUI probes, native Stop/image/text/two-owner checks and audit zero.
Cleanup passed; source package/global installation remain unchanged. Direct public tool
execution is not model dispatch or persistence. C4-D is accepted locally, not iPhone/remote.

[Stop evidence](docs/c4-stop.md) proves explicit leased browser Stop through public
ctx.abort(), the shared 256-ID ledger, immutable deliberate retry and truthful parent
settlement observation. Fresh read-only review found no issues. Parent inspected the
owning code and baseline-relative envelope, then independently passed types/build,
37 unit/process tests, 20 Chromium/WebKit tests, genuine native Stop/image/text and
prior two-owner checks, audit zero and Python syntax. Cleanup passed; the controlled
Stop screenshot was inspected. Stop is accepted locally, not phone/remote, per-request
cancellation acknowledgement or cancellation of queued/delayed/background work.

[C4-B evidence](docs/c4-image-input.md) proves one local still PNG/JPEG/WebP preview,
validated gateway normalization and genuine same-owner native image feedback. Exact
Sharp 0.35.5 is installed locally with scripts disabled; native load and audit passed.
Fresh review cleared the owning path. Parent found an overly strict default-policy
instruction: omitted native blockImages must use documented false. Retained correction
has UDS red/green and real-native omitted-setting proof; targeted review found no issues.
Parent inspected code and independently passed types/build, 30 unit/process tests,
14 browser tests, native image/text smokes, prior two-owner smoke and audit; cleanup
passed and screenshot inspected. Cooperative decoder timeout is not hard wall-time;
admission remains held through native settlement. C4-B is accepted locally, not phone/remote.

[C4-A evidence](docs/c4-text-input.md) proves explicit same-cookie tab-independent
control/takeover, volatile per-generation drafts and real browser text through public
send, with no automatic retry. Independent review found a lossy UTF-8 payload hash;
the retained writer corrected it with JSON string serialization and an actual UDS
red/green regression. Targeted review found no issues. Parent inspected the owning
boundaries and independently reran types/build, 20 unit/process tests, 10 browser
tests, real native text smoke and prior two-owner smoke; all passed with cleanup.
C4-A is accepted locally, not iPhone/remote or native acceptance/persistence proof.
The native input receipt policy is resolved as limited: public send returns void, so
report dispatched/outcome-unconfirmed or uncertain, not native accepted/queued receipts.
See the follow-up in [capability evidence](docs/capability-probe.md). Busy queues and
native per-request acknowledgements remain unproved; do not change Pi core or repeat
handled-input tests as proof of those stages.

[Native-media evidence](docs/native-media-probe.md) proves a genuine built-in read
image in native events and active history, plus identical host-written session recovery
in a new sequential TUI owner. The owner approved a disposable local scripted provider;
its two fixed responses make no external/paid model calls. The generated PNG is not a
screenshot. Python syntax, strict focused TypeScript, normal/reopen and real-SIGINT
ownership checks passed. Fresh review found no issues; parent independently reran normal
and interrupt checks and accepted C1-M. No browser, phone or subagent-runtime proof.

The owner authorized the disposable probe and its cleanup repair. See
[capability evidence](docs/capability-probe.md): real-TUI text/image handled delivery and
terminal questionnaire completion passed; normal durable acceptance/queueing remains
unproved; the installed questionnaire still has no public reply seam. Ready-wait and
pending-questionnaire SIGINT cleanup regressions passed; fresh focused review found
no issues.

The approved local source now has a default-off public reply interface. See
[questionnaire integration evidence](docs/questionnaire-replies.md): 706 owning-package
unit tests passed and real source-loaded Pi 0.99.2 PTY checks proved both answer winners,
client departure, late-reply safety, and unchanged default-off behavior. Fresh review
found no issues; parent accepted C1-Q locally. No browser/phone transport is proved.

The owner approved a short-term source change to the existing questionnaire extension.
Its current terminal behavior must remain unchanged when the integration is unused.
A future replacement/removal is a possibility, not an approved implementation target.
The companion must depend on a documented question/reply contract, not TUI internals.
The source checkout is under integrations/rpiv-mono/ at upstream tag v2.11.0.
Installed packages and global configuration remain unchanged; installation is a separate
explicit decision after local validation.

C2's single root npm package and exact lock are installed locally. Scripts were disabled
except the inspected local fs-ext build. Pi remains an optional exact host peer with a
read-only ignored development type link; npm release-age policy remains unchanged.
Local Chromium/WebKit engines are installed only for tests. No global Pi/extension,
services or Tailscale change. The separate integration manifest/lock remain unchanged.

[C2 evidence](docs/c2-observer.md) records native Pi 0.99.2 read of a controlled browser
screenshot, authenticated inline/enlarged rendering in both desktop engines, native
reload/stale-media rejection, gateway restart and terminal survival. Review found media
base64 stack overflow; parent also reproduced valid-large-SSE reset. Both owning-boundary
fixes have regression coverage and targeted review found no issues. Parent independently
reran strict types/build, 11 unit/process tests, 4 browser tests and real-Pi smoke, all
passed. C2 is accepted locally, not remote/phone or general background-work proof.

## C1 — Verify the real integration boundary

Purpose: a disposable investigation is necessary because attaching to a live TUI,
image delivery, and dual-surface questions depend on public interfaces that have
not yet been proved. It prevents building a frontend around an unavailable API.

Scope:
- Inspect the installed Pi declarations and smallest relevant extension examples.
  The probe inspected 0.99.1 and narrowly verified its used seams on 0.99.2;
  its exact-version guard is not an application compatibility range.
- Verify access to active-branch snapshot, image results, lifecycle, send/images,
  steer/follow-up, abort, and actual session identity.
- Inspect the existing questionnaire and pi-subagents integration seams without
  changing their configuration or implementation.
- Compare adapting kkkiio's boundary with a minimal independent bridge.
- Record each capability as supported, limited, or blocked, with checked evidence.

Do not build a general protocol framework during this investigation.
Do not load new extensions into working conversations without approval.

Completion verdict: a documented, supported path for the first real screenshot slice,
plus a precise questionnaire verdict. Stop and ask if a required behavior needs
private APIs, a change to another package, or altered agent behavior.

### C1-Q — Opt-in questionnaire reply integration

**Completed locally; not installed.** Tests and source review passed within the exact
limits recorded in docs/questionnaire-replies.md. Do not repeat this implementation or
install it globally while proceeding with other C1 work.

Approved outcome: a browser-facing companion can observe and answer the same pending
questionnaire that is displayed in the terminal, through an explicit public interface.
Terminal-first and external-first answers must resolve once and dismiss the other surface.

First inspect the existing completion/state boundary and tests. Then define a bounded
contract for invocation identity, full question content, validated replies, completion,
and stale-response rejection. Preserve the existing tool envelope and default behavior.
The extension must not start a network server or gain new model-facing tools.

Use the isolated source checkout, not the installed package. Do not implement a second
questionnaire renderer/orchestrator or a general adapter framework. A client disconnect
must leave terminal completion available. Test terminal/external races and cleanup through
the real TUI without model calls, plus focused source regressions.

Completion verdict: opt-in public reply seam proved end-to-end and independently reviewed,
with no global install and exact limitations documented. Stop and ask if native Pi changes,
new product policy, or further package ownership is required. Native receipt policy
and installed subagent observation have limited verdicts; C1-M is proved as above.
Busy input/control and real gateway/subagent survival tests belong to C4.

## C2 — One live session, one real screenshot

End-to-end outcome: a normally launched Pi with a temporary explicit extension can
be viewed through a terminal-launched local gateway; one native image tool result
renders inline and enlarges in a browser.

Include from the start:
- Authenticated local access and scoped image delivery.
- Active-branch snapshot and stable live identity.
- Bounded streaming and disconnect cleanup.
- No second agent, transcript database, or prompt/tool replacement.

Validation: focused rendering/security tests plus a real-Pi screenshot smoke.
Use a temporary approved fixture workspace. The owner approved the network-free local
scripted-provider probe; its fixed responses may be reused for the C2 native read smoke.
Use a screenshot of a controlled browser fixture, not the owner's desktop or credentials.
External/paid model requests still require explicit approval.

Local implementation setup may install locked project dependencies and browser test
engines when needed. Keep install scripts disabled by default; inspect and allow only
required local build scripts. No global installs or runtime/settings changes. Enforce the
single gateway from the start with an OS process-lifetime file lock. The lock file stays
in place; kernel lock release, not age/PID guessing, permits recovery after a crash.

Completion verdict: screenshot observation works against the real Pi entry point;
closing the browser/gateway leaves Pi usable in the terminal.

## C3 — Multiple terminal sessions and reconnection

End-to-end outcome: one gateway lists and switches between two existing Pi bridges,
including bridges started before/after it.

Include:
- Owner-only discovery, reachability checks, instance/generation identity.
- Session replacement and crash cleanup.
- Duplicate session-file conflict handling.
- Replay/snapshot reconciliation and gateway restart recovery.

Validation: real two-process attachment; deterministic stale-record, reconnect,
duplicate-message, ownership-conflict, and old-generation tests.

Completion verdict: two real Pi owners remain independent and survive gateway restart.

## C4 — Phone input and supported questions

Deliver the required behavior in these serial thin slices, not one broad writer task:
- **C4-A (accepted locally):** explicit single browser controller/takeover plus idle text send,
  separate per-session drafts, generation/conflict gates, bounded request deduplication,
  and dispatched/outcome-unconfirmed or uncertain status. Terminal remains usable.
- **C4-B (accepted locally):** image preview/removal, bounded validated PNG/JPEG/WebP upload and native
  image feedback; respect native model/image settings. Use the controller established in A.
- **C4-C1 (owner-deferred):** browser busy steer/follow-up; preserve terminal controls.
  Do not implement speculative completion tracking or a Pi core acknowledgement change.
- **C4-C2 (accepted locally):** explicit Stop with truthful stopping/parent-settled observation.
- **C4-D (accepted locally, source-loaded only):** observe/answer the approved questionnaire public contract once, without
  installing the source modification globally or replacing its TUI.
- **C4-E (accepted locally):** actual installed-package background-work survival across browser/gateway
  disconnect/restart, with no changes to subagent policy or new orchestration framework.

Each slice requires focused checks and independent review where risk warrants it.
Reuse approved network-free fixed test responses in isolated fixtures; external/paid
models and global installation still require explicit approval.

End-to-end outcome for the first phone test: send idle image feedback to the attached
session, request Stop through supported APIs, and answer supported pending questions.
Browser busy steer/follow-up is explicitly deferred, not completed or native-unsupported.

Include:
- Single browser controller with explicit takeover; terminal remains usable.
- Validated image uploads, preview/removal, Pi capability/settings checks.
- Request IDs and uncertain-outcome handling; no silent command replay.
- Actual questionnaire and subagent compatibility checks from C1.

Validation: real terminal/browser input and background-work smoke tests; fake
queue/abort/dialog tests; reconnect during a pending question and image upload.

Completion verdict: real inputs reach the existing owner exactly as evidenced,
and supported interactions resolve once. Stop at unapproved cross-package changes.

### C4-D bounded implementation decision

Read-only reconnaissance found the existing source-only v1 question/reply contract
sufficient. The bridge must observe before publication; the contract has no replay or
late-attachment getter. Gateway recovery reads surviving bridge state, not a transcript.
No questionnaire-package, installed/global extension or dependency change is approved.

Use at most four live invocation records per generation, each <=65,536 UTF-8 JSON bytes
and aggregate <=262,144 bytes. Preserve the source's <=4 questions/options and header/
label limits; bound each question/description/preview to 16,000 UTF-16 code units.
Reject an entire oversized/invalid request without truncating meaning. When observation
cannot fit, show a sticky generation-local terminal-only notice; do not evict an active
record or collect an unbounded overflow registry. Terminal completion remains available.
Only selected-owner views carry full pending content. Keep the complete SSE frame within
the existing 900,000-byte budget by trimming snapshot entries through its current owner.

Question replies use their public invocation/reply correlation, not the text/image/Stop
ledger. Capture matching public outcomes before emitting; public accepted means only
the same completion callback, not native dispatch/persistence. Missing outcome remains
uncertain; no automatic retry or closed-invocation tombstones. A deliberate repeat must
name the original still-observed active invocation under fresh control and a fresh reply
ID. Closure/state loss does not prove the browser answer won. Require fresh auth/lease/
owner/conflict/departure gates, but do not require native idle to answer a live question.
Preserve the public 65,536-byte reply cap and 8,192-code-unit custom/note limits.

Reuse the source-loaded no-model real-TUI harness for actual browser/terminal winners,
invalid/stale replies, departure and gateway restart during a pending question. Prove
production bridge/gateway/browser transport, no provider/native user/session writes,
terminal survival and complete resource cleanup. Do not claim native model tool dispatch
or actual iPhone based on that direct public tool execution.

## C5 — Private iPhone use

### C5-A approved HTTPS boundary

Add one optional `C2_PUBLIC_ORIGIN` and matching gateway option: one canonical HTTPS
Tailscale device origin at default port 443, with no path/query/userinfo/fragment or
wildcard. Default remains exact loopback HTTP. Select one origin per gateway launch;
do not add simultaneous multi-origin policy. Keep listening on literal 127.0.0.1.
Use exact request Host/Origin and unchanged pairing/auth/CSRF/controller/owner gates.
HTTPS mode uses Secure host-only cookies and HTTPS security headers; forwarded and
Tailscale identity headers do not authorize or change the chosen origin. Keep
trustProxy false and CORS disabled. CLI prints the configured browser URL.

Closed writer envelope: src/gateway/server.ts, src/gateway/cli.ts,
tests/observer.test.ts, tests/process.test.ts, docs/c5-private-https.md. No dependency,
protocol/bridge/browser/job/prompt/global changes. Parent owns governing documents
and live Serve launch after review/validation. Focused schema/security and real CLI
checks must preserve loopback and test hostile Host/Origin/forwarded headers.

The owner requested private Serve and a usable link. Parent may inspect this device's
local DNS/Serve metadata and start a manual nonpersistent foreground HTTPS Serve proxy
only after gateway checks. Never use Funnel, reset routes, override another service,
bypass tailnet consent, install globally or change autostart/ACL/DNS settings silently.
If Tailscale needs HTTPS feature consent, report its native prompt/link to the owner.
Actual iPhone verification remains separate; local headers or desktop WebKit are not
phone proof. Existing unrelated browser control timeout remains recorded.

End-to-end outcome: the screenshot-and-feedback journey works on the owner's iPhone
through Tailscale HTTPS with the Mac running Pi.

Include:
- Exact proxy host/origin handling, authentication, CSRF, security headers.
- Mobile session drawer, image zoom, keyboard/safe-area behavior.
- Disconnected/read-only states and accessible controls.

Validation: approved Tailscale Serve setup plus actual iPhone Safari testing;
automated narrow-screen, malicious-content, auth, and cross-origin tests.

Completion verdict: screenshot capture → phone inspection → image reply → reconnect
works privately, with no change to Pi's guidance or orchestration.

Do not claim iPhone verification based only on desktop Chromium emulation.

## C6 — Package and operating instructions

End-to-end outcome: installable companion package, terminal launch, and documented
manual lifecycle with reproducible validation.

Include:
- Proven supported Pi version policy and dependency lock.
- Build/typecheck/test scripts, installation/removal, connection recovery.
- Explicit list of supported and unsupported interactive tools.
- Logs without credential/media disclosure; process-owned resource cleanup.

Validation: fresh install/start/stop in an approved test setup and repeat C5 smoke.

Completion verdict: the owner can operate and remove the companion without relying
on development-only steps. Manual launch remains the default.

Autostart and global extension installation are explicit later decisions, not part
of the default completion. Do not add optional features while closing this checkpoint.

## Checkpoint discipline

Before implementation, define the owning files and focused validation for the current
slice. Keep one writer per checkout. Record commands, results, changed files, and
remaining concrete risks. Do not advance on a mock-only verdict.

If a checkpoint discovers an unapproved scope or safety decision, stop only that
boundary and report the evidence. Do not silently substitute a new Pi runtime,
monkey-patch internals, or replace the user's existing orchestration.
