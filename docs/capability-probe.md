# C1 terminal Pi/public extension capability probe

## Outcome: investigation completed

**Same-process public input delivery is feasible. Browser answers to the existing
custom questionnaire are blocked at its separate-package boundary.** No app,
gateway, replacement UI, provider, or C2 implementation was created. This probe
closes only the assigned capability investigation, not every item in the broader C1
plan (subagents and other boundary comparisons are not tested here).

Original investigation: Pi **0.99.1**, questionnaire **2.11.0**, Node **26.5.0**,
Python **3.14.7** on macOS. Cleanup follow-up: narrowly reviewed the used public
seams and reran on the now-installed Pi **0.99.2**, with the same questionnaire.
The probe guards exactly Pi {0.99.1, 0.99.2} and questionnaire 2.11.0; this is not
a product compatibility range.

| Capability | Verdict | Evidence and precise limit |
| --- | --- | --- |
| Same owning TUI receives extension text + native image block | Supported, narrowly | Real Pi: `sendUserMessage` produced exactly one `input` receipt with `source: extension`, one byte-matching PNG block. A public hook returned `handled` before model processing. This is pipeline delivery/interception, **not** normal model acceptance/persistence/queue behavior. |
| Terminal remains functional | Supported, narrowly | Tagged normal terminal input was handled once before and once after the real questionnaire. No editor replacement or input patch. Concurrent drafts/terminal-vs-browser races were not tested. |
| Input acceptance/queue acknowledgement | Limited / missing at ordinary ExtensionAPI seam | `sendUserMessage` declares `void`; observed return was `undefined`. No request ID or accepted/queued result. `hasPendingMessages()` is an aggregate boolean, not a per-input receipt. Hook receipt cannot establish durable native acceptance. |
| Published questionnaire observation | Supported, narrowly | Actual factory/tool code in actual TUI emitted one prompt and blocked `true → false`; Pi emitted `ui_prompt_start/end` with `kind: custom`. Prompt options have `hasPreview`, not preview content or request identity. |
| Actual questionnaire terminal completion | Supported with test instrumentation | Actual overlay rendered the fixture question; normal PTY Enter returned `cancelled: false`, answer `Terminal`. Direct captured-tool invocation bypassed native tool event dispatch/persistence; not a model-issued invocation. |
| Browser questionnaire response | **Blocked** | Public exports are factory and prompt/blocked notifications. No reply listener, request ID, response API, or answer handle. Completion is owned by the custom component's local `done` callback. No invented event was emitted/tested. Requires separately authorized integration in questionnaire or Pi. |
| Universal standard/custom dialog answering while retaining terminal | Blocked at observer seam | Public `ui_prompt_start/end` expose kind/title only, no callback or response handle. No global `ctx.ui` rebinding or RPC substitution used. |
| Active branch and native images | Supported API; partial runtime check | Real public `getBranch()`/session ID/file availability checked on an ephemeral session. Declarations/docs expose branch entries and native image content for user/tool-result messages. No real screenshot/tool-image recovery or populated branch traversal was tested. |
| Idle send / busy steer / follow-up | Supported API; runtime limited | ExtensionAPI accepts string or text/image blocks and `deliverAs: steer / followUp`. Only idle handled delivery tested. Busy streaming/queue timing/normal model persistence **not tested**. |
| Abort / settled lifecycle | Supported API; source-only | Public `ctx.abort(): void`, `agent_settled`, and lifecycle events exist. No cancellation or background-subagent behavior tested. Abort is not immediate-completion acknowledgement. |

## Reproduction and isolation

Use [probe instructions](../probes/README.md). Commands below use an environment
input for the existing installed questionnaire path; no personal paths are retained:

```sh
python3 -B probes/run-c1.py --questionnaire-dir "$QUESTIONNAIRE_DIR"
python3 -B probes/check-c1-interrupts.py --questionnaire-dir "$QUESTIONNAIRE_DIR"
python3 -B -c 'from pathlib import Path; p=Path("probes/run-c1.py"); compile(p.read_text(), str(p), "exec"); print("Python syntax: passed")'
test ! -d .git && echo 'No Git metadata; no staging performed'
```

The executable is discovered with PATH; the installed package metadata is read
only. Pi receives these flags:

```text
--offline --no-session --no-approve --no-extensions --no-skills
--no-prompt-templates --no-themes --no-context-files --no-tools
--extension <owner-only temporary probe.ts>
```

The runner constructs an allow-listed environment rather than copying it. HOME,
XDG config, Pi agent/session directories, TMPDIR, and cwd are fresh temporary
directories, verified mode 0700 under a 0700 root. No real settings, sessions, auth
files, environment dump, context files, or unrelated extensions are loaded.
`--no-extensions` still allows the one explicit probe extension. The questionnaire
is imported by that extension's temporary factory wrapper, not installed globally.
No socket/network endpoint is created. The external trigger is a disposable file,
not a transport or gateway design commitment.

Only three uniquely tagged fixture inputs are submitted, all handled by the
public input hook; the remaining submissions are registered probe commands and
the normal questionnaire Enter key. No ordinary model prompt is submitted.
`PI_OFFLINE=1`, `PI_SKIP_VERSION_CHECK=1`, and telemetry off prevent documented
automatic network activity. No provider keys/preloads/proxies are inherited.

## Checked execution evidence

A first run failed **before creating runtime files or launching Pi**: package
ancestor discovery assumed `dist/cli.js`, but the installed entry is
`dist/bundle/cli.js`; `FileNotFoundError` on `dist/package.json`, exit 1. The local
probe discovery bug was fixed to find the package ancestor (no installed changes).
Two subsequent real-TUI runs passed, exit 0. The last run included permission
assertions. Syntax check exit 0: `Python syntax: passed`. Checkout check exit 0:
`No Git metadata; no staging performed`.

The cleanup-follow-up successful rerun on Pi 0.99.2 also exited 0 with all the
same public-boundary assertions, plus explicit PTY/umask cleanup reporting.
Current successful-run sanitized assertions/output summary:

```json
{
  "verdict": "completed",
  "piVersion": "0.99.2",
  "questionnaireVersion": "2.11.0",
  "piExit": 0,
  "realTUI": true,
  "questionRendered": true,
  "handledInputs": [
    {"label": "external", "source": "extension", "imageCount": 1, "imageMatches": true},
    {"label": "terminal-before", "source": "interactive", "imageCount": 0},
    {"label": "terminal-after", "source": "interactive", "imageCount": 0}
  ],
  "sendReturnedUndefined": true,
  "questionPromptCount": 1,
  "questionBlocked": [true, false],
  "uiPromptKinds": ["custom", "custom"],
  "terminalAnswer": "Terminal",
  "beforeAgentStart": 0,
  "agentStart": 0,
  "providerRequest": 0,
  "nativeUserMessages": 0,
  "pending": false,
  "sessionFiles": 0,
  "ownerOnlyRuntime": true,
  "childReaped": true,
  "ptyClosed": true,
  "runtimeRemoved": true,
  "umaskRestored": true,
  "cleanupErrors": []
}
```

This is assertion evidence, not a raw terminal transcript. Rendering was checked
by detecting fixture text in bounded in-memory PTY output, never printing it.
`session_shutdown` was observed, the owned child exited normally, PTY descriptors
were closed, and all temporary files were removed. The corrected cleanup boundary
also covers KeyboardInterrupt, independently of result bookkeeping, with bounded
TERM/KILL/reap, PTY closure, runtime removal, and umask restoration. See the
focused regression evidence below; the earlier code's broad failure-cleanup claim
was incomplete for SIGINT.

**No paid/model calls:** zero before-agent-start/agent-start/provider-request
observations plus early handled interception and zero native user messages.
**Outbound limitation:** offline isolation prevents documented automatic network
activity; no outbound model request was initiated. There was no packet capture or
OS-level network sandbox, so this is not a packet-level audit of all installed
module behavior. The questionnaire documents that it makes no model calls itself.

## Cleanup follow-up and narrow 0.99.2 compatibility check

Fresh review found a P2: KeyboardInterrupt bypassed `except Exception`, leaving
`result` unset; cleanup then raised TypeError before closing the PTY, deleting the
runtime, or restoring the umask. The runner now catches KeyboardInterrupt
specifically and returns sanitized `interrupted`/KeyboardInterrupt JSON with code
130. Owned cleanup completes before result updates; nested finally boundaries
ensure narrow process/descriptor/filesystem failures cannot skip remaining
cleanup. Sanitized cleanup errors force code 1. A second SIGINT is ignored during
cleanup only; other fatal outcomes propagate, not broad BaseException swallowing.
Temporary-directory creation is inside that same umask-restoring boundary.

The first follow-up harness attempt exited **2 before runtime creation or Pi
launch**: installed Pi had changed to 0.99.2 and the preserved 0.99.1 guard correctly
refused it. This was not a cleanup regression. Parent explicitly approved reviewing
only the used 0.99.2 seams before adding exactly 0.99.2 to the version allowlist;
questionnaire guard and all isolation/no-model controls remain unchanged.

Read the current `docs/cli.md`, `docs/extensions.md`,
`docs/environment-variables.md`, and `docs/tui.md` completely, plus current
`examples/extensions/send-user-message.ts` and `input-transform.ts`. Relevant
0.99.2 declaration/source inspection (within @earendil-works/pi-coding-agent):

- `dist/cli/args.js:86–87,104–105,145–150,174–184,218–222`: every used isolation,
  trust, offline, and explicit extension flag still parses as documented.
- `dist/core/extensions/types.d.ts:246,609–614,865–887,1222–1225`: public shutdown,
  session-shutdown lifecycle, extension input/image/handled contract, and ordinary
  void-returning user-message delivery remain compatible. The `ui.custom`
  overlay/completion contract and `ToolDefinition.execute` signature remain intact.
- `dist/core/agent-session.js:1455–1518,1786–1814,2650–2657,2703–2705`: input
  interception still precedes model/auth validation; send normalizes text/images
  with `source: extension`, routes async errors without a receipt, and shutdown
  delegates to the TUI's public-context handler. Inspection only; no private API
  accessed by the probe.
- `dist/core/extensions/runner.js:359–389`: custom UI still wraps public prompt
  start/end. `dist/modes/interactive/interactive-mode.js:1999,2239` still uses the
  actual custom factory/overlay; `:3384–3417` retains orderly runtime disposal on
  shutdown. `dist/core/agent-session-runtime.js:296–302` emits session_shutdown.

No relevant incompatibility was found; actual unchanged extension/questionnaire
execution and native shutdown were then checked on 0.99.2. No broad patch-version
compatibility was inferred.

`check-c1-interrupts.py` exited **0**. It invokes runner main in-process and traces
only the Python runner to deliver a real kernel SIGINT at two deterministic
boundaries: ready-wait entry after launch, and rendering-wait completion with the
actual questionnaire pending. The latter additionally verifies custom UI start,
blocked `[true]`, rendered fixture text, and no questionnaire result before SIGINT.
It never changes Pi input/UI or extension code. Both runner invocations returned
**130**, `errorType: KeyboardInterrupt`, with sanitized outcomes. For **both**:

```json
{
  "childReaped": true,
  "ptyClosed": true,
  "runtimeRemoved": true,
  "umaskRestored": true,
  "independentChecks": true
}
```

Before backup cleanup, independent assertions observed ChildProcessError from
waitpid (already reaped), EBADF for both saved PTY descriptors, no runtime root,
and restored prior umask. Tests retain no raw terminal transcript or local path.
Interrupting the disposable runner is **not** a test of Pi's native abort API,
questionnaire cancellation result, or a browser response seam.

## Original Pi 0.99.1 public/source evidence (package-relative citations)

Read the relevant Pi documents completely: `docs/extensions.md`, `docs/cli.md`,
`docs/environment-variables.md`, `docs/configuration.md`, `docs/sessions.md`,
`docs/session-format.md`, `docs/message-types.md`, and `docs/tui.md`. Read examples
`examples/extensions/send-user-message.ts`, `input-transform.ts`, `hello.ts`, and
`qna.ts`; qna was inspection only (its model call was never executed).

Within **@earendil-works/pi-coding-agent**:

- `dist/core/extensions/types.d.ts:223,242–244`: read-only session manager,
  `abort`, aggregate pending state. `:850–882`: input source/text/images and
  `handled`. `:1211–1220`: ordinary ExtensionAPI send user message returns void,
  text/image content and steer/follow-up options. Fresh *replacement command*
  contexts have a different Promise-returning signature; those are not the
  observer's general input receipt API and were not used.
- `dist/core/extensions/types.d.ts:762–775`: UI prompt lifecycle kind/title
  only; `:937–950`: tool-result content contains text/image blocks.
- `dist/core/session-manager.d.ts:178,246–247,306–321`: public read-only branch,
  current session ID/file, compaction-aware entries/projection. Do not infer that
  all mutators or `buildSessionContext()` on the full manager are available on the
  read-only extension view. `getBranch` is raw active history; context projection
  honors context edits/compaction as described in `docs/session-format.md`.
- `docs/message-types.md`: native ImageContent is base64 `data` plus `mimeType`;
  user and tool-result messages carry it. This makes native images inspectable,
  not proof that every screenshot tool persists an image.
- Source explanation only, never accessed at runtime:
  `dist/core/agent-session.js:1455–1513` processes public input hooks before model/
  auth validation; handled returns before queuing/building messages.
  `:1780–1806` passes extension input into that pipeline with `source: extension`;
  `:2644–2651` launches the async session send and reports rejected promises as
  extension errors without returning a receipt through ExtensionAPI.

Within **@juicesharp/rpiv-ask-user-question**:

- Read `README.md`, `docs/tool-schema.md`, `docs/hosts.md`, and
  `docs/keyboard.md` completely. `package.json` exports only `.` and `./events`.
- `events.ts`: complete exported contract is `rpiv:ask-user:prompt` with
  question/options/hasPreview and `rpiv:ask-user:blocked` with `active`. No reply,
  request ID, invocation identity, or result payload. Blocked false can mean
  answer, cancellation, or error; it does not reveal the answer.
- `index.ts`: public factory registers tool/reconciler.
  `ask-user-question.ts:313–405`: execute validates, emits notifications, loads
  its real session, awaits `ctx.ui.custom`, builds the result, clears blocked in
  finally. `:187–229` binds the local component completion callback. Source search
  for `events.on`, `events.emit`, and `pi.on` found only the two notification
  emits and the reconciler's `before_agent_start` listener, not a reply listener.
- `docs/hosts.md`: RPC uses a sequential primitive-dialog fallback with reduced
  notes/previews; it would replace the required TUI surface, not add a browser
  response channel to this running custom overlay. No RPC test was substituted.

## Scope, risks, and next boundary

Changed files: `probes/c1-extension.ts` (public instrumentation),
`probes/run-c1.py` (isolated assertion runner), `probes/README.md` (reproduction),
`docs/capability-probe.md` (portable evidence). Cleanup follow-up additionally adds
`probes/check-c1-interrupts.py` (focused real-SIGINT regressions), changes the runner
and run/evidence docs only, and leaves `c1-extension.ts` unchanged. Governing docs unchanged. No
manifest/lockfile/dependency/app/global configuration changes; no staging/commit
operations (not a Git checkout).

Not tested: browser UI, real screenshots, paid provider/image preprocessing,
busy queues, request retries, durable receipt, phone/iPhone, Tailscale, IPC security,
subagent background execution, and abort completion. Notifications cannot safely
correlate concurrent questionnaire invocations or resolve browser/terminal races.
Stop at the questionnaire boundary; parent owns any separate integration decision
and governing-document updates. No C2 work is authorized by this evidence.

Complexity receipt: two original probe code files plus one focused interrupt
harness; one owned Pi child at a time; one one-shot
file trigger; zero servers/sockets/new dependencies; public APIs only at runtime;
one captured public tool definition; bounded PTY output/time; ephemeral evidence
only. Retained artifacts are reproducible probe code and this report.

## Follow-up: native input receipt policy

Source inspection on installed Pi **0.99.2** closes the receipt-policy investigation
with a limited public API verdict. No additional runtime test or app code was added.
The earlier handled-input probe already proves the available pre-processing observation;
repeating it cannot prove ordinary acceptance, queueing, or persistence.

Within @earendil-works/pi-coding-agent:
- `dist/core/extensions/types.d.ts:1217–1225`: ordinary `sendUserMessage` returns
  `void`, accepts text/images and steer/follow-up options, and supplies no request ID.
- `dist/core/extensions/types.d.ts:241–244`: abort returns void and pending state
  is an aggregate boolean, not a per-input acknowledgement.
- `dist/core/extensions/types.d.ts:864–887,1164–1185`: public input and lifecycle
  events provide observation, not a correlated send receipt.
- Explanatory source only: `dist/core/agent-session.js:2650–2657` discards the
  internal send Promise and reports asynchronous rejection as an extension error.
  The companion must not access this internal method or depend on its implementation.

Approved caller policy for later input implementation:
- **Dispatched; outcome unconfirmed:** the bridge invoked the public method. This
  does not mean accepted, queued, persisted, or processed by the model.
- **Uncertain:** a connection or generation change prevents knowing whether dispatch
  occurred. Do not automatically resend. A completed dispatch can also remain unconfirmed.
- A public input-hook observation means only that the pipeline saw the input.
  Other extensions can transform or handle it before normal processing.
- Message events and branch entries describe conversation state. Content matching
  is ambiguous and is not a native per-request receipt. An in-memory branch read
  alone does not prove a durable disk write.
- Reject invalid or stale requests before dispatch. Do not attribute an uncorrelated
  asynchronous Pi error to a particular browser request.

Bounded request-ID deduplication belongs to the future bridge/gateway, not a new probe
framework. Keep it generation-scoped; do not claim exactly-once native acceptance.
This source-only follow-up did not test normal busy queues or native acceptance.
The subsequent [native-media probe](native-media-probe.md) separately proves native
host persistence/reopen with fixed local responses, not a correlated receipt API.

## Follow-up: installed subagent boundary

Read-only inspection of installed **pi-subagents 0.73.1** found no blocker to the
first one-session native-image observer. Package-relative references:
- `docs/extension-api.md:96–156`: documented same-process event-bus RPC has read-only
  status/Fleet projections, but also mutation methods. It is not a cross-process
  browser attach API. The companion must not emit subagent mutation requests.
- `docs/observability.md:180–219,301–323`: child-status and async lifecycle events
  are hints, not restart replay; status snapshots own recovery state. They describe
  package jobs, not the native parent transcript or image bytes.
- `docs/extension-api.md:579–617`: the parent can settle while detached jobs continue.
  Status age and last-update time are not reliable proof that work has stopped.
- Public `external-runs` and `background-work` exports are package-specific display
  and wait facilities, not a second agent controller or universal activity feed.

C2 must show parent activity explicitly; when it does not observe background work,
show that limitation instead of claiming everything is idle. Observe native parent
history/images without replacing subagent tools, configuration, or policy. No new
subagent fixture framework, model call, package change or runtime test was needed.

C4 must test actual browser disconnect and gateway restart while real package work
continues, reconcile current status, and verify terminal/package controls remain intact.
Source inspection does not prove that journey. Child-session/media attachment and
universal background-work enumeration are not established public capabilities.

C1 is complete with these limited verdicts and the accepted native-media and
questionnaire evidence. The first C2 observer can proceed; no global installation,
external/paid model request or Tailscale setup is authorized by that transition.
