# C4-E installed background survival

## Verdict and checkpoint

**Accepted locally after independent review and parent validation.** C5 private
HTTPS and actual iPhone testing are next; the gateway remains loopback-only.
Active plan: `PLAN.md`. Mission: `ce696be5-085c-4869-b8a7-65db9d8e3e1b`.
Prior C4-D is accepted locally/source-loaded; C4-C1 is owner-deferred; C4-E is
this completed slice; C5/phone/remote remains unproved. Next ready action is
read-only inspection of the C5 proxy/security boundary before remote setup.

The closed delta is `tests/input-fixture.ts`, `tests/real-pi.py`,
`tests/real-browser.mjs`, and this evidence document. No production, integration,
package, dependency, global settings, guidance, policy or governing-file changes.
Prior input/image/Stop/two-owner modes retain their strict assertions.

## Exact entry point and approved budget

Runtime guards verified Pi **0.99.2**, installed **pi-subagents 0.73.1** and Node
**26.5.0**. A normal isolated TUI explicitly loads the production bridge, installed
package `index.js` and existing public fixed-provider fixture. A temporary native
agent specifies `async: true`, `tools: read`, `c1m-disposable-script/fixed`, thinking
off, no inherited project/global context or skills, and explicit fixture extension
propagation with ambient extensions disabled. Status records requested model
`c1m-disposable-script/fixed`, normalized `c1m-disposable-script/fixed:off`; genuine
child-runtime acknowledgement names `c4-fixed-provider`.

Terminal entry: `/run c4-disposable <owned-tag>:native-read --bg`.
This installed route creates an in-parent workflow container and exactly one real
detached native child. Node runs `runner-peer-preload.mjs` plus
`src/runs/background/subagent-runner-bootstrap.js`; the native child session lives
inside that runner. No private executor, foreground substitution, external runner,
synthetic completion or display-only background record is used.

The user expressly superseded **only** the former zero-parent-response budget:
**two fixed child responses, one genuine owned read, and one fixed local parent
text acknowledgement after actual completion — three responses total per run**.
Parent requests remain **zero before completion**. Parent reads/tool calls/images
and idle switching-owner requests/reads remain **zero**. The existing public
provider is still the only model implementation; no external/default/paid call.

The package's documented native supervisor overlay adds `contact_supervisor` to
`read`. Both child declaration gates now accept **exactly those two names**, only
in background-child mode. Actual calls remain one exact `c4-owned-read` of the own
generated one-pixel PNG: no supervisor call, extra tool, or parent read. Other
modes still require exactly `read`. Native supervisor guidance/behavior is unchanged.

## Actual passing sequence

`python3 -B tests/real-pi.py --background` exited **0** on the final authorized
fresh-root attempt. Native child ID throughout:
**`b990ce95-d45e-45b1-9fe8-e4fde57032bb`**.
Workflow container: `87808022-acad-47f2-a014-5129c231a1b4`.

1. Normal owning TUI launched the real package child. Its first fixed response
   performed one genuine built-in read; its actual second provider response was
   held by a bounded 180-second owner-only test latch. Counts: two child requests,
   one emitted response, one read, zero parent requests.
2. The shipped Chromium UI paired through production auth/SSE, selected A→B→A,
   and closed its selected connection/browser. The same child stayed **running**,
   without another launch/request/read. B was a real idle TUI with no model work.
3. The **actual production gateway CLI process** was SIGKILLed: observed exit
   **-9**. The lock inode remained unchanged. A new CLI PID acquired its production
   flock and issued a new pairing secret; secret values were not recorded. A new
   browser deliberately paired/selected the same owner A. The same child was still
   **running**, held, with unchanged counts. Both terminals responded during loss.
4. Only after recovery was the actual provider latch released. The same child
   became **complete**, with exactly two emitted child responses/one read/one native
   user entry. Its generated PNG hash/native branch IDs matched the owned fixture.
5. Native child completion was awaited by the workflow; native workflow completion
   retained **`triggerTurn: true`**. Its normal `subagent-notify` message correlated
   the exact IDs and terminal artifacts. The same public fixture emitted exactly
   one fixed parent text acknowledgement and settled: one request/response, zero
   native parent input events or tool calls. No notification/wake was suppressed.
6. Both owning TUIs remained responsive after completion and after the recovered
   gateway closed; both exited **0** only during explicit fixture teardown.

Five lifecycle observations show the same child ID: running before browser,
running after A→B→A/close, running after CLI death, running after new pairing,
and complete after release/parent acknowledgement. Parent idle/background-unobserved
is correctly displayed during the live job; it is not package completion.

## Supported observation and cleanup

Owning-session public status RPC targeted the exact child. Its bounded **Run,
State, Workflow parent** text lines were verified against the request ID, actual
child artifact and observed parent-child link. The separate `asyncSnapshot` roots
remain workflow roots, not relabeled child/fleet IDs. Only sanitized IDs/states,
counts and owned native fixture identity are retained. Exact temporary
`status.json`/`events.jsonl` checked one child execution, one read, completion and
extension propagation. No actual user session/transcript/environment was captured.

Normal cleanup has matching documented **observed** process-terminal proof for the
captured runner instance, exit **0**, signal **null**, plus exact PID/start identity
inspection establishing that instance absent. Artifact directory and immutable
instance identity are retained even on late discovery. Live authorization is
separate from exit observation; dead/terminating argv is not required to persist,
and a reused PID is never signaled. All Pi/gateway/browser/PTY/latch/temp resources
were removed; owner-only modes and umask restoration passed; cleanup errors were empty.

Failed/held cleanup now uses supported `/subagents-stop <verified workflow ID>`,
not destructive SIGTERM. It activates an explicit cleanup-only fixture state and
preserves the native stopped/failed notification/wake. The supervisor approved
using the **same single parent response slot** for a correlated stopped/failed
terminal acknowledgement during cleanup only; never a second acknowledgement,
running/unknown acknowledgement, or successful-survival receipt. Matching native
process proof and exact physical termination are still required, otherwise the
root is retained. Parent subsequently exercised this branch: SIGINT interrupted the
real harness while the child held its second response. Supported native stop and
one cleanup-only acknowledgement completed; matching process proof was observed,
exit zero/signal null, all cleanup flags true and no cleanup errors. The harness
correctly exited 130 with a blocked job verdict, not a survival-success claim.

## Immutable failed history

Earlier failures remain exit **1**, with their original false cleanup flags:
- Child `3721dbda-fb3a-486f-b1ea-313a5ba89301`: test expected the wrong bootstrap
  entry; no child-ready response/read evidence captured. Later exact inspection
  found no runner.
- Child `e7cbb104-be40-4943-bdb0-503e45452d50`: fixture rejected the supported native
  supervisor declaration before fixed responses/reads. Later own failed status,
  observed process proof and physical cleanup were recorded separately.
- First resumed repair child `45a257a9-575e-4b98-9b62-d252aecc407a`, workflow
  `511bd4c0-613c-45e9-88e3-2fb5e58638e0`: real first response/read/held second request
  succeeded, but a test incorrectly required the child in top-level snapshot roots.
  Verified SIGTERM cleanup yielded **unknown / writer-close-unverified**, with
  recorded runner close; raw false flags and unknown proof remain unchanged.
  The parent separately approved physical removal of that exact controlled root
  after independently verified owner/0700/nonsymlink and no exact process/group.
  That exception is **not** passing native writer proof or survival acceptance.

No automatic retry or infrastructure fallback occurred. Each subsequent native
attempt was separately supervisor-authorized after the exact assertion failure
and cleanup were reported. No production/package failure was established.

## Validation, review disposition and limits

Python in-memory syntax, browser JavaScript syntax, strict typecheck and production
build passed after substantive repairs. Final runtime exited **0**; raw sanitized
results/proofs, immutable failure hashes and copy-based baseline diff are retained
in the managed handoff, outside the repository. Worker did not rerun prior pipelines or broad suites. The copy-based baseline covers
1,201 files; all 1,143 integration hashes remained equal. Before parent governing
updates, only the three allowed fixtures and this new document differed; no staged diff.

Accepted review P1s: exact native declaration overlay recognized; the newly approved
parent acknowledgement preserves normal completion wake; complete immutable runner
ownership/artifact capture separates authorization from termination proof. The
additional target-status projection assertion was corrected without changing the
package's public contract. Fresh review and targeted retained review cleared the
three findings; parent inspected the final source, copy scope and raw results.

This proves one local installed native child and one actual gateway crash/recovery.
It does not prove Pi owner shutdown/reload survival, browser job enumeration/control,
Stop/cancellation of arbitrary jobs, remote/phone/Tailscale, external providers,
or other versions/platforms.

## Parent validation and acceptance

Parent independently passed strict types/build, 47 unit/process tests, the genuine
background survival check and a native input regression for the shared provider.
The same parent-validated child stayed running through browser loss and actual CLI
crash/new pairing, then completed with two child responses/one read and one parent
acknowledgement. Both normal and deliberately interrupted held-job cleanup passed.
No owned process/root/latch remains; protected integration hashes and empty index
were checked. No production, dependency, global, policy or Tailscale change occurred.

The full browser run passed 31/32 tests. Chromium's existing delayed pre-takeover
claim/renew test timed out on disabled Take control; its focused rerun passed.
The browser spec, its fixture and production code are unchanged by C4-E. Preserve
this non-reproduced failure as a validation limit, not an all-green full-suite claim.

The first parent interrupt monitor could not identify the held stage from Pi argv;
that run completed normally with cleanup and is not interrupt evidence. A corrected
monitor used only its own child PID/cwd, observed the held response and triggered
SIGINT. Its expected exit 130 and observed native-stop cleanup are separate proof.
Raw logs/results and copy scope remain in parent-managed temporary evidence, with
all original worker failures/unknown writer proof preserved.

C4-E is accepted locally. Native ordinary completion behavior remains unchanged;
the fixed parent acknowledgement is test instrumentation, not companion policy.
Actual iPhone/Tailscale access and browser job enumeration/control remain unproved.

Complexity receipt: reused fixed provider/caps, generated PNG, isolation/PTY/browser/
CLI helpers and native lifecycle. Added one explicit mode, child evidence/latch,
public targeted-status projection, one correlated parent acknowledgement slot and
cleanup-only state, plus immutable owned runner/proof capture. Each supports actual
job identity, normal native wake, budget or safe cleanup. Replaced faulty fixture
assertions/termination bookkeeping only; no production mechanism or migration.
