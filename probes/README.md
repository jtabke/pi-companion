# Disposable C1 public-boundary probe

Requires the already-installed `pi` executable on PATH (exactly Pi 0.99.1 or
0.99.2), Node, Python 3
with POSIX PTY support, and `@juicesharp/rpiv-ask-user-question` 2.11.0. No install
or package manifest is needed. Set the installed questionnaire directory yourself:

```sh
export QUESTIONNAIRE_DIR='<existing installed questionnaire package directory>'
python3 -B probes/run-c1.py --questionnaire-dir "$QUESTIONNAIRE_DIR"
```

Run from the project root. The runner discovers Pi via PATH and its resolved
executable's package ancestor; it refuses versions outside those inspected. It
creates an owner-only temporary HOME, agent/config/session directories, workspace,
and extension wrapper; starts one real Pi TUI in a 120×40 PTY; sends only tagged
handled fixture input and registered probe commands; answers the published
questionnaire with normal Enter; shuts Pi down; and removes all runtime files.
It does not start an HTTP server or socket, inherit credentials, install an
extension globally, or use a model. Raw terminal output is never printed/saved.

Exit 0 means every assertion passed. Exit 1 emits a sanitized blocked stage/error
class. SIGINT/KeyboardInterrupt emits a sanitized `interrupted` outcome and returns
130 after cleanup. Cleanup independently kills/reaps the owned child if necessary,
closes both PTY descriptors, removes the runtime, and restores the umask before
updating the report. Narrow OS cleanup errors are reported and force exit 1;
remaining cleanup still runs. Further SIGINT is ignored only during cleanup; other
fatal exceptions are not swallowed. The real-TUI check has a 45-second deadline
plus bounded shutdown waits. Do not retry an unrelated infrastructure failure
with another CLI/agent mode.

`c1-extension.ts` is a template, not a standalone extension: the runner substitutes
its package-entry import in a temporary copy. The package's public factory receives
a registration-forwarding facade capturing its tool definition unchanged. A
registered command directly invokes that definition with the real public command
context (the questionnaire uses its ExtensionContext fields). This bypasses normal
tool hooks/schema dispatch/transcript persistence and is **test instrumentation**,
not a remote-answer API. Neither `ctx.ui` nor Pi internals are patched.

External delivery uses a one-shot temporary file trigger and public
`pi.sendUserMessage`, not a companion transport prototype. The tagged input hook
returns `handled` before model processing. It proves delivery/interception only;
it does not prove normal acceptance, persistence, or busy message queue semantics.

The probe permits Pi 0.99.1 and 0.99.2; Companion itself is checked only on 0.99.2.
This allowlist is not a general product compatibility range. Questionnaire remains
guarded at exactly 2.11.0. Browser questionnaires need the separate default-off
[source integration](../integrations/README.md); this probe does not install it.

Focused interrupt regression:

```sh
python3 -B probes/check-c1-interrupts.py --questionnaire-dir "$QUESTIONNAIRE_DIR"
```

The small harness invokes the runner's `main()` in-process and uses Python tracing
only to choose deterministic wait boundaries: entry into the ready wait after Pi
launch, and return from the rendering wait with the actual questionnaire still
pending (before Enter). It sends a real kernel SIGINT to that Python process, not
a fabricated exception, and asserts the runner returns 130 with sanitized JSON.
Independent checks verify `waitpid` finds no child to reap, both saved PTY file
descriptors yield EBADF, the captured temporary root is gone, and the prior umask
is restored, before harness backup cleanup. No Pi code, UI, input, or runtime
internals are patched. Exit 0 means both cases passed; no normal questionnaire
answer or native `ctx.abort` behavior is implied by interrupting the runner.

Syntax-only check without writing Python caches:

```sh
python3 -B -c 'from pathlib import Path; p=Path("probes/run-c1.py"); compile(p.read_text(), str(p), "exec"); print("Python syntax: passed")'
```

## C1-M native media and reopen

Requires already-installed **Pi 0.99.2**, Node, and Python with POSIX PTY support.
No questionnaire, network service, credentials, or dependency installation is used:

```sh
python3 -B probes/run-native-media.py
python3 -B probes/run-native-media.py --check-interrupts
python3 -B -c 'from pathlib import Path; p=Path("probes/run-native-media.py"); compile(p.read_text(), str(p), "exec"); print("Python syntax: passed")'
```

Run from the project root. The exact-version guard precedes runtime creation.
`native-media-extension.ts` is instrumentation loaded only through a temporary
copy; do not install it or load it into a working session. It registers one
network-free local scripted provider through public Pi APIs. One command sends
an ordinary native user message; fixed synthetic assistant responses trigger the
**genuine built-in read**, then one final response. Only the owned generated PNG
can be read. Native events, finalized message, and public active branch must all
carry its exact bytes. This fixture is not a screenshot or a real-model test.

The runner creates owner-only isolated HOME/config/agent/session/cwd/TMPDIR/runtime
directories and public-root package links, uses an allowlisted environment, and
starts one real TUI at a time. It shuts down the first owner normally and opens
the same host-written temporary session in another real TUI with **no turn**.
Branch/session/result identities and image bytes must match; tagged terminal
input works before/after in both owners. No transcript writer, synthetic result
append, replacement tool, custom-message substitution, or second AgentSession.
PTY output is bounded in memory and never retained. All runtime files are removed.

Exit 0 means all assertions passed. Exit 1 reports a sanitized blocked stage/error;
SIGINT returns 130 after cleanup. Cleanup reuses unchanged `run-c1.py` ownership
logic. `--check-interrupts` traces only Python runner wait boundaries and sends real
SIGINT while startup is pending and after the genuine native turn settles with
the owner still alive. Both inner runs must exit 130; independent child/FD/tree/
umask checks run before backup cleanup. This is not a Pi abort/cancellation test.
The check itself exits 0 when both cases pass. Each owner has a 45-second deadline
plus bounded shutdown/cleanup waits. No unrelated probe suites are required.

This does not prove browser rendering/security, larger-image/provider limits, real
screenshot capture or iPhone support. See [Companion's setup and verification notes](../docs/setup.md#prerequisites).

## Browser/native input fixture

`npm run test:pi` runs `tests/real-pi.py` with a temporary source wrapper and the fixed
local provider above. Its default path exercises native images, two owners and browser
recovery. `npm run test:pi -- --input`, `--image`, `--stop` or `--background` select
separate fixture paths (pass one mode only). Pi must be exactly 0.99.2; background mode
also requires the existing installed pi-subagents 0.73.1. These runners use isolated
HOME/session/runtime directories, not personal sessions. Check their version guards
before running; do not substitute a paid/network provider.

## Source questionnaire fixture

After intentionally restoring the [source integration](../integrations/README.md),
these separate no-model TUI checks require Pi 0.99.2 and questionnaire source 2.11.0:

```sh
python3 -B probes/run-questionnaire-replies.py
python3 -B probes/run-questionnaire-replies.py --default-off
python3 -B probes/run-questionnaire-replies.py --companion
```

Default mode checks the source reply seam; `--default-off` checks unconfigured
terminal-only behavior. `--companion` checks the production bridge/gateway/browser and
requires built Companion output and the local Chromium engine. It cannot be combined
with `--default-off`. No global install/settings change is included.

## Native slash commands

Requires the already-installed **Pi 1.0.1**, Node, Python with POSIX PTY support,
and freshly built Companion output:

```sh
npm run build
python3 -B probes/run-native-commands.py
```

The runner starts one disposable real Pi terminal with isolated HOME/config/session/runtime
folders, no ambient extensions or credentials, and a metadata-only local provider that
fails any inference attempt. It loads the production bridge from the package's declared
entry before `native-command-extension.ts` installs its custom editor. This protects the
editor load-order contract. Exact terminal `/reload` activates the hook without replacing
Pi or its session. Capability-authenticated Unix-socket requests then exercise native
model selection, `/new`, `/reload`, draft/unknown/stale rejection and same-ID receipt replay.
The real terminal's custom editor and registered fixture command still work after lifecycle
changes. Previous conversation content disappears after `/new`; `/reload` retains the native
session. All checks require zero model-input fallthrough, agent starts and provider calls.

This is bridge/native evidence, not HTTP browser-authentication or phone evidence. The
browser fixtures cover the picker and uncertain-command recovery separately. Each wait is
bounded at 20 seconds and socket reads at 3 seconds; the runner drains the PTY during reads
to prevent terminal backpressure. It cleans only its owned child, descriptors and runtime.
Exit 0 means all assertions and cleanup passed; failure emits a sanitized stage/error class.
Raw terminal output and credentials are not saved. It does not install anything globally,
change personal settings, start a second runtime for Companion, or touch working terminals.

All native probes are separate from `npm run check`. Fixture success does not prove
model consumption, actual-phone behavior or compatibility with a newer Pi version.
