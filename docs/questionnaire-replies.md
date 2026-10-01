# C1-Q: opt-in source questionnaire replies

Implementation verdict: **completed locally; independent review and parent disposition pending**.
Mission: 910d103f-53f3-4191-b34d-c6995eb03d90. No C2 advancement or installation.

## Owned change

Source at `integrations/rpiv-mono`, detached tag `v2.11.0` (`61904e6`), package
`packages/rpiv-ask-user-question` remains version 2.11.0. The new read-only config
`companionReplies: true` enables package-specific v1 request/reply/outcome/closure
channels through the existing event bus/root exports. Default-off and RPC legacy
behavior, tool schema/name and result envelope remain unchanged.

The existing `QuestionnaireSession` receives the same public `done`, through one
per-invocation once-only completion owner. External replies reconstruct question
and selected preview from normalized authored data, validate indexes/labels/kinds,
notes and payload bounds, and cannot affect another invocation. Actual TUI readiness
requires successful construction/binding plus public `onHandle`; no sensitive
request is emitted merely on validation or `hasUI`. Terminal remains usable on client
departure. Tool abort and public shutdown remove listeners/pending publication and
use existing cancellation results; late/inactive IDs are ignored without ack.

Public contract: [source API restoration guide](../integrations/README.md#public-contract).
Pi 0.99.2 references: `docs/extensions.md`, `docs/tui.md`,
`dist/core/extensions/types.d.ts` (`custom`, `onHandle`, tool signal, shutdown), and
`dist/modes/interactive/interactive-mode.js:2239–2306` (factory → showOverlay →
onHandle; done dismisses overlay). Source inspection only, no private runtime access.

## Reproduce

From the parent project (existing Pi **0.99.2**, Node and POSIX Python required):

```sh
python3 -B probes/run-questionnaire-replies.py
python3 -B probes/run-questionnaire-replies.py --default-off
cd integrations/rpiv-mono
node_modules/.bin/vitest run packages/rpiv-ask-user-question --maxWorkers=2
node_modules/.bin/biome check packages/rpiv-ask-user-question/{ask-user-question.ts,companion-replies.ts,companion-replies.test.ts,events.ts,config.ts,index.ts}
node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module Node16 --moduleResolution Node16 --esModuleInterop --resolveJsonModule --types node packages/rpiv-ask-user-question/{ask-user-question.ts,companion-replies.ts,companion-replies.test.ts,events.ts,config.ts,index.ts}
git diff --check
git diff --cached --name-only
```

Approved local setup: disabled sparse checkout to restore tagged `test/setup.ts`,
`packages/test-utils` and the locked workspace graph, read setup, then
`npm ci --ignore-scripts` (exit 0). No upgrade/dependency/lock edits or install hooks.
The existing lock audit reported 34 vulnerabilities; no remediation was attempted.

## Checked results

- Node **26.5.0**, npm **11.17.0**, Vitest **4.1.10**, unit-test Pi dependencies
  **0.80.6**. Final focused suite: **36 files / 706 tests passed**, exit 0; 40 new
  tests in `companion-replies.test.ts`. Focused strict TypeScript and non-writing
  Biome checks passed, exit 0. No broad/root auto-writing check was used.
- Real installed Pi **0.99.2** TUI, source-loaded questionnaire **2.11.0**:
  opted-in external-first, terminal-first and departure scenarios all passed,
  exit 0. Invalid reply rejected without completion; external winner used canonical
  question/preview; exactly one result and one closure per invocation; late replies
  produced no outcome; terminal input was handled after each dismissed overlay.
- Separate real default-off TUI run passed, exit 0: terminal answer, no new
  request/outcome/closure events, terminal input preserved.
- Both PTY runs: zero before-agent-start/agent-start/provider-request observations,
  zero native user messages/session files, `pending: false`, Pi exit 0. Owner-only
  runtime verified; child reaped, PTY closed, runtime removed, umask restored;
  `cleanupErrors: []`. Python syntax check passed without cache writing.
- Implementation iterations repaired missing real test keybindings and generic
  mock UI typing. First TypeScript command needed TS6's `--ignoreConfig`; corrected
  command above passed. These were local test/code repairs, not infrastructure or
  protocol fallback.
- Source Git: no staged files; `git diff --check` passed. Root manifest/lock unchanged;
  owning manifest changed only to ship `companion-replies.ts`. Tagged setup/test-utils
  restored unchanged. Parent has no Git metadata. No stage/commit/publish/global install.

## Changed files and complexity receipt

Under `packages/rpiv-ask-user-question`: `ask-user-question.ts`, `config.ts`,
`events.ts`, `index.ts`, `package.json` (shipping list only), `companion-replies.ts`,
`companion-replies.test.ts`, `README.md`, `docs/companion-replies.md`,
`docs/configuration.md`, `docs/hosts.md`, `docs/tool-schema.md`.
Parent: `probes/run-questionnaire-replies.py` and this evidence document.

One 198-line helper owns completion/validation, one focused 386-line helper test
file, one 254-line source-loaded PTY harness reusing the existing C1 cleanup utility.
One owned Pi child per run, temporary file trigger only, no transport/server/broker,
no new dependencies, no TUI session/reducer/views/Pi-core/other-package edits.
The main-file diff includes an outer cleanup boundary around lazy loading to handle
abort/shutdown before readiness. Governing docs and existing C1 probes untouched.

## Precise limits

The harness captures the public tool definition and invokes it directly from a
registered command with a real public context. This is **not native model tool
schema dispatch, durable persistence or a browser transport test**. Source loading
uses the checkout's locked extension dependencies, including Pi-TUI 0.80.6, inside
the installed Pi 0.99.2 owner; unit tests do not establish 0.99.2 compatibility by
themselves. Runtime abort/shutdown winner tests are source-focused; the PTY smoke
covers the required dual-surface winners/departure and orderly child shutdown.

No normal user's working session/config/auth was read or modified. The environment
was allow-listed and HOME/config/agent/sessions/cwd temporary; every ordinary probe
input was handled before model processing. Offline flags prevent documented auto
network activity; there is no packet capture/OS network sandbox claim. No provider
calls, endpoint, global package changes or Tailscale changes. Process crash cannot
emit closure; there is no replay service or tombstone/late-response broker.
Independent review remains required; parent owns checkpoint disposition.
