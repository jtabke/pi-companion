# Native Pi probes

These opt-in checks are separate from `npm run check`. Run from the repository root
with already-installed prerequisites. Each uses disposable owner-only runtime/session
folders and a real Pi TUI, cleans its owned processes and files, and avoids personal
credentials, global installation and paid/network inference. Do not load probe
extensions into working sessions or substitute another provider to bypass a failure.

Version guards are intentional. An accepted version is not a general product
compatibility promise. Fixture success does not prove model consumption, physical-phone
behavior or compatibility with newer Pi. See [setup](../docs/setup.md#prerequisites).

## Public input and terminal questionnaire

Requires Pi **0.99.1 or 0.99.2**, Node, Python 3 with POSIX PTY support, and an existing
installed `@juicesharp/rpiv-ask-user-question` **2.11.0** directory:

```sh
export QUESTIONNAIRE_DIR='<existing installed questionnaire package directory>'
python3 -B probes/run-c1.py --questionnaire-dir "$QUESTIONNAIRE_DIR"
python3 -B probes/check-c1-interrupts.py --questionnaire-dir "$QUESTIONNAIRE_DIR"
```

Checks public input delivery/interception and terminal questionnaire completion
without a model. Direct tool invocation is test instrumentation: it bypasses normal
tool dispatch and does not establish transcript persistence, normal input acceptance
or busy-queue semantics. It does not install the browser questionnaire integration.

The interrupt regression sends real SIGINT at two wait boundaries and independently
checks child, file-descriptor, temporary-tree and umask cleanup. This is runner cleanup,
not native Pi abort behavior. The TUI check has a 45-second deadline plus shutdown waits.

## Native media and session reopen

Requires Pi **0.99.2**, Node and Python with POSIX PTY support:

```sh
python3 -B probes/run-native-media.py
python3 -B probes/run-native-media.py --check-interrupts
```

A fixed local provider drives a genuine built-in Read of an owned generated PNG.
Native events, finalized messages and active-branch data must preserve its bytes.
A second TUI reopens the host-written session without a turn and checks identity,
media and terminal input. No replacement tool, transcript writer or second AgentSession
is used. This does not prove screenshot capture, browser security or provider image limits.
Each owner has a 45-second deadline plus shutdown/cleanup waits.

## Browser/native input

Requires built Companion output, Pi **0.99.2** and the local browser engine:

```sh
npm run test:pi
npm run test:pi -- --input
npm run test:pi -- --image
npm run test:pi -- --stop
npm run test:pi -- --background
```

Pass one mode only. The default checks native media, two owners and browser recovery;
the named modes cover distinct input, image, Stop and background-survival paths.
Background mode additionally requires installed pi-subagents **0.73.1**.
The runner is [`tests/real-pi.py`](../tests/real-pi.py), using the fixed local provider.

## Source questionnaire replies

Intentionally restore the [source integration](../integrations/README.md) first.
Requires Pi **0.99.2** and questionnaire source **2.11.0**:

```sh
python3 -B probes/run-questionnaire-replies.py
python3 -B probes/run-questionnaire-replies.py --default-off
python3 -B probes/run-questionnaire-replies.py --companion
```

Default mode checks the public reply seam; `--default-off` checks unconfigured
terminal-only behavior. `--companion` checks the production bridge/gateway/browser
and requires built output and Chromium. It cannot be combined with `--default-off`.
No global package or settings change is included.

## Native slash commands

The runner accepts Pi **1.0.1 or 1.0.2** and requires Node, Python with POSIX PTY
support and freshly built Companion output:

```sh
npm run build
python3 -B probes/run-native-commands.py
```

Loads the declared production bridge before a custom-editor fixture and activates its
hook through exact terminal `/reload`. Authenticated Unix-socket requests check model
selection, `/new`, `/reload`, draft/unknown/stale rejection and same-ID receipt replay.
The custom editor and fixture command must keep working after lifecycle changes;
`/new` clears the conversation and `/reload` retains its native session.
A metadata-only provider fails inference attempts; all checks require zero model-input
fallthrough, agent starts and provider calls. Waits are bounded at 20 seconds and socket
reads at 3 seconds. This is native dispatch evidence, not HTTP authentication or phone evidence.

## Results and syntax checks

Exit 0 means assertions and cleanup passed. Failures emit sanitized stage/error classes,
not raw terminal output or credentials. The public-input and media runners return 130
after interrupted cleanup. Never interpret interrupting a runner as Pi cancellation.

To syntax-check a Python runner without creating caches:

```sh
python3 -B -c 'from pathlib import Path; p=Path("probes/run-c1.py"); compile(p.read_text(), str(p), "exec"); print("Python syntax: passed")'
```

Replace the path for another runner. Syntax checks do not execute the native fixtures.
