# C4-A — explicit browser control and idle text

## Verdict: completed locally, independently reviewed and parent accepted

One selected, reachable terminal Pi **0.99.2** accepts explicitly authored idle text
from an explicitly controlling browser through gateway → authenticated private UDS →
production generation-owned bridge → ordinary passed public `pi.sendUserMessage`.
The browser is read-only by default. Terminal input remains usable; no production
input hook, terminal restriction, trust approval, prompt/tool/provider replacement,
AgentSession, transcript writer, or direct model invocation was added.

Only **C4-A** is implemented. Uploads, Steer/Follow-up/Stop, questionnaire replies,
actual subagent survival, iPhone/Tailscale/HTTPS and broader platform/version support
remain later slices. Public send returns **void**: **Dispatched; outcome unconfirmed**
is not accepted, queued, persisted, model received, or successful. Uncorrelated native
errors or matching conversation content never upgrade a request receipt.

## Portable setup and operation

Follow the exact locked setup and existing read-only host Pi type-link instructions
in [C2 observer](c2-observer.md). No dependency, lock, configuration, CLI, flock, media
parser, installed Pi code, or release-age policy was changed. Node **26.5.0**, macOS,
Pi **0.99.2** and desktop Chromium/WebKit are the checked environment, not a broader
compatibility claim.

The new opt-in fixed provider fixture uses public `pi-ai` exports. The supervisor
approved this **additional ignored read-only development type link**, not an install
or another runtime. The existing `pi-coding-agent` link stays unchanged. After `npm ci`,
restore the C2 link and then this one before the strict check:

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
    raise SystemExit('Only Pi 0.99.2 reviewed')
public_ai = package / 'node_modules/@earendil-works/pi-ai'
ai = json.loads((public_ai / 'package.json').read_text())
if (ai['name'], ai['version']) != ('@earendil-works/pi-ai', '0.99.2'):
    raise SystemExit('Only public pi-ai 0.99.2 reviewed')
link = Path('node_modules/@earendil-works/pi-ai')
if link.is_symlink():
    assert link.resolve() == public_ai.resolve()
elif link.exists():
    raise SystemExit('Refusing to replace a local package')
else:
    link.symlink_to(public_ai, target_is_directory=True)
PY
npm run typecheck
npm run build
```

Use the existing C2/C3 manual terminal extension and `npm start` launch. Pair at
**http://127.0.0.1:4317** (literal host), choose **Select live session**, then:

1. **Take control** explicitly. A separate same-cookie tab remains read-only.
2. If occupied, **Take over browser control** deliberately revokes the previous
   browser capability. This does not take terminal ownership or stop native work.
3. Type in **Text for selected Pi (local draft)**; only **Send** transmits text.
   Slash-prefixed text is plain authored input: public send explicitly uses
   `expandPromptTemplates: false`; no extension command/skill/template expansion.
4. **Renew control (60s)** explicitly extends only a still-valid held capability.
   **Release control** returns to read-only. No auto-claim/takeover/renewal exists.
5. Busy/pending, disconnected, conflicted, unselected or expired views cannot send.
   Native busy/pending is also rechecked at dispatch; terminal races or async native
   errors can still make the outcome unknown after a void public call.

Drafts are separate for instance+generation, volatile, <=32 drafts and <=16,000
characters each. Switching retains them without sending; exceeding the cap explicitly
notices oldest inactive draft removal. No auth/capability/transcript/draft is put in
URLs or browser storage. One view admits one outstanding operation. A lost response
retains immutable original ID/text and displays **Uncertain**. An explicit **Retry same
outstanding input** can recover the native receipt; it never generates a new ID/text.
No SSE reconnect, selection change, pairing, claim or restart resends input.

Switching, page departure, transport loss and expiry discard local authority and
best-effort release only companion control. Failed departure release is bounded by the
60-second lease; it cannot cancel Pi. Reconnect stays read-only until deliberate claim
or takeover. Gateway restart requires new pairing and a new deliberate claim. Native
replacement/reload invalidates the old generation/IDs. An uncertainty for a lost
native generation remains unresolved and blocks another send in that view; inspect
Pi in the terminal. Reloading the page discards all volatile drafts/receipt state,
**not** proof that uncertain text was unsent.

## Boundary and complexity receipt

- **Lease (`gateway/controller.ts`):** <=32 concrete instance records, each bound to
  authenticated cookie + generation + independent random 256-bit private capability,
  expiring after 60 seconds. Capability goes only in the holder's response/body and
  volatile frontend memory. Public SSE/detail projection contains held/expiry and an
  independently random 128-bit **non-authorizing revision**. New claim/takeover changes
  revision; renewal preserves it. Revision is not accepted as input/release/renew
  authority. This approved revision prevents same-millisecond takeover being mistaken
  for the old lease when expiry is identical. Frontend confirms a response against a
  fresh public projection before enabling control; stale/delayed claim/renew responses,
  revision mismatch, disconnect, expiry and generation change never restore authority.
  Discovery/auth expiry prune leases. No second registry/control transport exists.
- **Serialization/admission:** one gateway operation per instance; concurrent operations
  on that instance get **429**, not an unbounded Promise tail. <=32 active instance
  operations; unrelated owners are independent. There is **no waiting queue**. Claims,
  takeover, renewal, release and text share this boundary. Serialization covers gateway
  operations, **not** the internal async turn behind public void send.
- **Mutation schemas/gate:** only fixed browser `POST /api/control` and `POST /api/text`,
  plus fixed private `POST /text`. Exact authenticated cookie/Host/Origin and custom
  `x-c2-csrf: input` are required for every new public mutation, including empty-query
  URLs. Unknown query/body properties, malformed identities/capabilities and oversized
  text are rejected. Control/pairing keep **1,024-byte** body limit; text uses a
  route-specific **100,000-byte JSON allowance** for <=16,000 authored characters
  (including worst-case JSON escaping). Fresh authenticated discovery checks exact
  instance/generation, reachability and private canonical native-file conflict before
  mutation. Final authentication/lease gates run after async discovery and immediately
  before fixed forwarding. Bridge schema/current generation/idle/pending checks precede
  public send. Responses are small fixed/redacted envelopes; receipts <=1,024 bytes.
  The unchanged kernel gateway lock remains the one gateway authority.
- **Native ledger (`extension/input.ts`):** one disposable ledger per actual bridge
  generation, **256 IDs maximum**. Records SHA-256 of `JSON.stringify(request.text)`
  and a small receipt, never a second transcript. This serialization preserves exact
  authored JS string identity, including lone surrogates. Same ID/text returns its prior receipt,
  including recorded busy rejection or uncertainty; different payload rejects. Valid
  generation requests consume admission even when rejected by idle policy. Stale or
  malformed requests cannot invoke send. Full ledger explicitly rejects fresh IDs;
  no eviction/reinvocation. Receipt is recorded before attempting public send; a
  synchronous throw after attempt remains uncertain. Async errors do not change it.
  Gateway restart preserves this bridge-owned ledger; generation cleanup discards it.
- **Transport:** existing owner-only capability-authenticated Node HTTP UDS, bounded
  four connections and existing deadlines; fixed text POST only, no arbitrary command,
  method/path/URL forwarding. Per-body buffering is bounded; departure cannot cancel a
  dispatched native turn. C3 discovery/detail/replay and accepted constant-stack media,
  snapshot, image and SSE backpressure budgets remain intact.
- **Fixture obligation:** the unchanged C1 provider requires command-owned dispatch,
  so it cannot prove browser-origin input. `tests/input-fixture.ts` is isolated public
  instrumentation only: accepts one exact tagged extension input, continues it normally,
  emits balanced public streams for exactly two fixed local responses (one owned built-in
  `read`, then fixed final text), and rejects other provider requests. Terminal-only
  fixture tags are handled only by this test extension. Production registers no provider,
  model tool or input interceptor. Existing real PTY harness owns isolated HOME/config/
  agent/session/cwd/env/process groups/resources and continuously drains native TUI;
  cleanup helpers and old probes remain unchanged. No paid/network/real-credential read.

## Checked evidence and reproduction

Initial implementation checks (all **exit 0**; P1 follow-up evidence below):

```sh
npm run typecheck
npm run build
npm test
npm run test:browser
python3 -B tests/real-pi.py --input
npm run test:pi
python3 -B -c 'from pathlib import Path; p=Path("tests/real-pi.py"); compile(p.read_text(),str(p),"exec"); print("Python syntax passed")'
```

- Strict root TypeScript includes the new fixture. Build has no Pi runtime imports in
  production; frontend ~415.98 kB JS / 126.66 kB gzip, 6.48 kB CSS.
- **Vitest: 2 files / 19 tests passed**, preserving all 14 C2/C3 tests (including real
  TCP large-SSE replay/backpressure and constant-stack near-cap media regressions).
  Five C4 tests prove native identical/mismatched/busy/stale/throw/full ledger policy,
  raw UDS auth/content/body/schema rejection, all mutation auth/Host/Origin/CSRF/body/
  schema/query gates, same-cookie distinct capability/explicit takeover/release,
  admission, gateway restart native dedup, newly appearing private canonical conflict,
  stale/unreachable owner, expiry after awaited fresh reachability, fixed-clock lease
  expiry/renewal/revision and <=32 record/admission bounds. Revision alone cannot mutate.
- **Playwright: 10 tests passed**, Chromium and desktop WebKit, retaining C2/C3 image,
  320/390 px accessibility/focus/no-overflow/security/selection/reload checks. New checks
  cover separate A/B/A drafts, same-cookie read-only/explicit takeover with **identical
  expiry under fixed clock**, loss of old holder state, lost send response, actual SSE
  socket break/reconnect without auto-send/claim, deliberate reclaim and identical-ID
  retry invoking native fixture exactly once, public/storage/URL capability privacy,
  delayed pre-takeover claim and renewal responses never restoring old authority.
  These are supported-context/socket fixtures, not native model/phone evidence.
- **Opt-in native `--input`: completed**, one real normal Pi 0.99.2 TUI, exactly **one
  native user entry/input**, **two fixed local responses**, **one genuine built-in read**.
  Chromium claims and posts authored text through the production gateway/bridge/public
  send. The first browser response is deliberately lost; native turn completes, no
  automatic resend occurs, explicit identical-ID browser retry gets Dispatched without
  another turn. Native branch/read image bytes are rendered in the same owning browser;
  drained **owning TUI** contains exact native user tag, `fixture.png` tool display and
  fixed final response. Uncontrolled/stale/revoked requests cause **zero** extra inputs.
  Gateway loss preserves terminal tagged input. Restart/new pairing/deliberate claim
  causes no turn; explicit old-ID retry recovers the surviving bridge receipt. Native
  owner exits **0**. Child/gateway reaped, PTY closed, runtime removed, umask restored,
  owner-only tree all true; `cleanupErrors: []`.
- **Prior opt-in C3 `test:pi`: completed**, two real owners, four unchanged fixed C1
  responses/two real reads, both engines inline/enlarged, A/B/A/native image isolation,
  same-cookie independent selections, gateway restart/reload/stale media rejection,
  disconnected cached selection and terminal survival. Both Pi exits **0**, all cleanup
  flags true, `cleanupErrors: []`.

Controlled screenshot remains **240×160 PNG / 5,050 bytes**, SHA-256
`ce244c6160de7bc07812f54626d5cb5200729036a28274e5753d707b2af3beee`.
Ignored `test-results/real-pi-input.png` captures only the controlled native fixture page,
not desktop/credentials. The controlled C4 screenshot was visually inspected. The C4 native browser evidence is Chromium; desktop WebKit C4
control is fixture evidence, while its genuine native read viewing remains C3 evidence.

Validation repairs: initial strict fixture resolution required the separately approved
read-only public pi-ai type link. Adding two browser cases exceeded the unchanged eight
cookie admission cap; the later same-cookie race test now reuses the prior cookie (no
production cap increase). A browser offline toggle did not reliably close an already
open SSE; the fixture now breaks actual public sockets, proving onerror/reconnect rather
than claiming a toggle was a transport break. Full checks were rerun after these repairs.

## P1 authored-payload hash correction — checked continuation

Independent review blocked C4-A on one P1: raw UTF-8 hashing converts distinct lone
surrogates (for example `"\ud800"` and `"\ud801"`) to the same replacement bytes,
so a changed same-ID payload incorrectly recovered the first Dispatched receipt.
The native ledger now hashes `JSON.stringify(request.text)`: its escaped serialization
preserves exact JS string identity before UTF-8 hashing. Authored text passed to public
send, accepted text/schema semantics, generation/request-ID checks, 256-ID admission,
no-eviction/no-reinvocation and receipt policy are unchanged.

The added **actual authenticated bridge/UDS** regression dispatches `"\ud800"` once,
deduplicates its identical same-ID retry, rejects same-ID `"\ud801"` and `"\ufffd"`
(replacement character) with `rejected/mismatch`, and asserts the native dispatch stub
still received only the exact first string. This is socket/native-ledger fixture proof,
not a new real-provider/browser claim.

Red/green and assigned checks:

```sh
# Before correction: exit 1, one regression failed as expected.
npx --no-install vitest run tests/observer.test.ts -t 'lone-surrogate'
# After correction: all commands exit 0.
npx --no-install vitest run tests/observer.test.ts -t 'lone-surrogate|deduplicates native IDs'
npm run typecheck
npm run build
npm test
```

Before correction the changed lone surrogate returned `dispatched/outcome-unconfirmed`
instead of `rejected/mismatch`. After correction the focused new and existing owning
receipt tests both pass (**2 passed / 14 skipped**); strict types/build pass, and the
full default suite passes (**2 files / 20 tests**), preserving all previous 19 tests.
No models/providers were called. Previous native/browser smoke was not repeated for
this bounded correction. Only `src/extension/input.ts`, `tests/observer.test.ts` and
this document changed; no dependency/configuration/global/integration edits or staging.
Root has no Git metadata; integration staged diff remains empty. This was the bounded
writer handoff; parent acceptance and post-fix broad validation are recorded below.

## Parent acceptance after correction

Targeted retained reviewer found the P1 fixed and no new issue in its blast radius.
Parent inspected native input, bridge, peer, gateway mutation gates, controller and
frontend authority/receipt code. Parent independently reran, after the fix:

- `npm run typecheck`, `npm run build`, `npm test`: exit 0; **20 tests** passed.
- `npm run test:browser`: exit 0; **10 Chromium/WebKit tests** passed.
- `python3 -B tests/real-pi.py --input`: exit 0; one native user/input, two fixed local
  responses, one genuine read; lost response/explicit retry and gateway-restart dedup,
  zero extra uncontrolled/stale/revoked inputs, owning TUI and terminal-survival checks.
- `npm run test:pi`: exit 0; prior two-owner C3 smoke passed unchanged.

All native cleanup flags passed with no cleanup errors. Parent inspected the controlled
page screenshot and found no owned test/gateway/Pi processes remaining. C4-A is accepted
locally; C4-B image feedback is next. No native receipt upgrade, phone or remote claim.

Workflow recovery: the fix writer completed, but its parent workflow emit failed on an
undefined optional output field before review launch. Parent inspected the saved fix and
captured its focused source delta, then resumed only targeted review via the same
subagent protocol. No fallback runtime or duplicate writer was used.

## Changed files, preserved scope and residual risks

Production: `src/shared/protocol.ts`, `src/extension/bridge.ts`, new
`src/extension/input.ts`, `src/gateway/peer.ts`, `src/gateway/server.ts`, new
`src/gateway/controller.ts`, `web/src/main.tsx`, `web/src/style.css`.
Tests: `tests/fixture.ts`, `tests/observer.test.ts`, `tests/browser-fixture.mjs`,
`tests/browser.spec.ts`, `tests/real-pi.py`, new `tests/input-fixture.ts`, new
`tests/input-browser.mjs`. Documentation: `README.md`, this document.

Implementation/fix writers did not edit governing PLAN/SPEC/STACK/checkpoint,
dependency/lock/configuration, media parser, shared runtime, CLI/flock, old probes,
integrations or installed/global resources. Parent updated checkpoint/status documents
only after review and its independent validation.
Root is not Git; no staging/commit/push/publish. Integration cached diff is empty;
its pre-existing C1 dirty source paths remain untouched. Owned-process inspection found
no remaining fixture/gateway/real-Pi children.

Residual limits: public void send cannot confirm or serialize the native asynchronous
turn, arbitrate terminal races, correlate later errors or guarantee native acceptance.
A full native ledger refuses fresh requests until native generation replacement; it is
not durable across native restart. Discovery and UI status are polled observations,
not an atomic cross-process lock on other terminal owners or proof of all-work idle.
Conservative stale-response handling may drop browser authority; explicit reclaim is
required, never automatic restoration. Closing/suspending can miss best-effort release;
expiry bounds companion authority and Pi continues. Same-uid trusted native processes
are not sandboxed. No remote HTTPS/iPhone, other Pi/platforms, real subagent/background
survival, busy control, questionnaire/upload or broad hostile-load guarantee is claimed.

C4-A is accepted locally. The next ready slice is C4-B image feedback; remaining
C4 behavior, iPhone/Tailscale and package operation are not complete.
