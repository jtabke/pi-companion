# C1-M disposable native-media probe

## Verdict: completed

On installed **Pi 0.99.2**, one genuine built-in `read` invocation returned a
byte-matching native PNG image in `tool_execution_end`, finalized `message_end`,
and the owning TUI's active branch. After orderly shutdown, a new real TUI owner
opened the same host-written temporary session **without a turn**. Its public
`getBranch()` returned the same session/file identity, entry IDs, parent IDs,
entry fingerprints, tool-result entry ID, tool-call ID, and exact image bytes.
Only one owning Pi process was alive at a time.

This proves the joined native dispatch → image observation → host persistence →
reopen observation seam with **synthetic assistant responses**. It is not a real
model/provider integration, desktop screenshot capture, browser rendering,
security audit, or iPhone evidence. C1 subagent validation and C2 remain separate.
The earlier [input receipt policy](capability-probe.md#follow-up-native-input-receipt-policy)
is unchanged: public send returns void, not a correlated acceptance receipt.

## Method and public boundary

[Reproduction](../probes/README.md#c1-m-native-media-and-reopen).
The explicitly loaded temporary extension registers only
`c1m-disposable-script/fixed` through documented public `pi.registerProvider`.
This is local test instrumentation, not a product provider. Its adapter has no
fetch, HTTP client, socket, login, discovery, or refresh implementation. The
required base URL is unused `.invalid` metadata and the static dummy auth string
is not a secret. Request/response instrumentation hooks receive explicitly
synthetic payload/status metadata; no HTTP request or response occurs.

The first TUI starts with only built-in `read` active. A registered `/c1m-read`
command calls ordinary public `pi.sendUserMessage` once. The input hook observes
that extension-origin input and returns `continue`, **not handled**. Pi's normal
pipeline creates the native user message and starts the native tool loop:

1. Fixed assistant response: one `read` tool call, for the owned PNG path only.
2. Pi executes its unmodified built-in `read` through genuine native dispatch.
3. The adapter checks the actual tool-result image in its follow-up context and
   emits one fixed final assistant text response.
4. `agent_settled` and a shutdown command inspect public `getBranch()`.
5. Pi shuts down normally, then another real TUI opens that exact temporary session
   with `--session`. `session_start` and its shutdown command inspect `getBranch()`;
   there are **zero** user dispatches, scripted requests, or tool executions there.

The adapter emits balanced public start/content/end/done stream events and a
terminal error on cancellation/failure. Response count is bounded to two. The
input/tool hooks reject unexpected input, calls, paths, or nesting and request
shutdown. Automatic retries, compaction, and cache warming are disabled only in
temporary settings. No tool is registered/replaced and no result is substituted.
There is no native transcript reader/writer in this probe, synthetic tool-result
append, custom-message substitution, session-manager mutation, or second
`AgentSession` constructor. Only the CLI hosts own their respective sessions.

Terminal fixture input is handled once before and after the native turn, and
before/after inspection in the reopened owner: four interactive receipts total.
This checks the actual editor/input surface, not terminal model prompting or
concurrent input policy. Inline terminal image rendering is deliberately disabled;
native image content, not visual terminal pixels, is the seam under test.

## Fixture, isolation, and cleanup

The deterministic generated RGB PNG is **1×1**, **69 bytes**, SHA-256:

```text
b1ff9c8ea3a780bad09b346c423d2d0e46815926879b18e841d928376a946640
```

PNG chunks and fixed compressed pixel bytes are generated in the runner. No
capture API or sensitive content is used. Every observation decodes native
`ImageContent.data`, checks one `image/png` block, and compares all bytes against
the owned fixture. The tiny PNG passes Pi's normal default image processing
without conversion/resizing; this does not establish larger-image/provider limits.

The executable is discovered via PATH and its resolved package ancestor. An exact
package-name/version guard runs before runtime creation: **only 0.99.2** is
reviewed. Public package-root imports resolve through temporary read-only links
to the installed Pi package and its existing Pi AI dependency. No install,
dependency declaration, manifest, lockfile, or installed package change occurs.

Owner-only temporary HOME, config, agent, sessions, workspace, TMPDIR, runtime,
and extension/module-link directories are created under umask 077. Every owned
regular file/directory is asserted mode 0600/0700, including the host session.
Package symlinks point outside ownership and are not followed for permissions
or removal. An allowlisted environment omits real credentials, preload hooks,
proxies, existing Pi markers/settings, and unrelated resources. Pi uses:

```text
--offline --no-approve --no-extensions --no-skills --no-prompt-templates
--no-themes --no-context-files --tools read
--provider c1m-disposable-script --model fixed --thinking off
--extension <temporary probe.ts>
```

The second owner additionally uses `--session <host-created temporary session>`.
Persistence is enabled; unlike the earlier handled-input check, this does not use
`--no-session`. One host session file is verified to exist without opening its
contents. Evidence files contain only bounded assertion metadata/identities/hashes,
never raw messages, paths, image base64, or PTY transcripts. All are removed.
Raw PTY output is bounded to 128 KiB in memory, never printed or retained. Each
owner has a 45-second deadline plus bounded exit/cleanup waits.

The runner reuses unchanged `run-c1.py:cleanup_runtime` for TERM/KILL/reap, PTY
closure, temporary-tree removal, and umask restoration. SIGINT is ignored only
inside cleanup, including the between-owner release. A KeyboardInterrupt returns
130 after cleanup; ordinary failure returns sanitized blocked stage/error class.
This is not a Pi abort test. Offline flags and the network-free adapter prevent
intentional/documented network activity here; no OS network sandbox or packet
capture was performed.

## Checked validation

Final focused commands, all exit **0**:

```sh
python3 -B -c 'from pathlib import Path; p=Path("probes/run-native-media.py"); compile(p.read_text(), str(p), "exec"); print("Python syntax: passed")'
python3 -B probes/run-native-media.py
python3 -B probes/run-native-media.py --check-interrupts
```

Syntax output: `Python syntax: passed`. The actual probe passed initially and
again after strengthening session-file identity and void-return assertions.
Focused strict TypeScript checking of the extension also exited **0**, using the
existing source-checkout compiler and Node types in a disposable linked harness:
`tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext
--moduleResolution NodeNext <temporary probe.ts>`. No dependencies were installed
and no compiler output/cache was written to the project.

Sanitized successful real-TUI output (all assertions enforced):

```json
{
  "verdict": "completed",
  "piVersion": "0.99.2",
  "realTUI": true,
  "nativeToolEventImage": true,
  "finalizedMessageImage": true,
  "activeBranchImage": true,
  "nativePersistenceReopened": true,
  "sameEntryIdentitiesAndBytes": true,
  "reopenWithoutTurn": true,
  "ownerOnlyRuntime": true,
  "owners": [
    {"phase": "first", "piExit": 0, "requests": 2, "toolCalls": 1, "terminalInputs": 2, "childReaped": true, "ptyClosed": true},
    {"phase": "reopen", "piExit": 0, "requests": 0, "toolCalls": 0, "terminalInputs": 2, "childReaped": true, "ptyClosed": true}
  ],
  "childReaped": true,
  "ptyClosed": true,
  "runtimeRemoved": true,
  "umaskRestored": true,
  "cleanupErrors": []
}
```

The integrated focused interrupt checks send **real kernel SIGINT** using Python
tracing only at runner-owned boundaries: (1) entry into the first ready wait,
with a launched owner pending startup; (2) return from the native-turn wait, with
the genuine read observed and the owner still alive after settling. Both runners
returned **130**, `KeyboardInterrupt`, no cleanup errors. Before backup cleanup,
independent checks found no child left for `waitpid`, EBADF for both saved PTY
FDs, no temporary root, and restored prior umask. Neither Pi/input/UI internals
nor the tool/provider response was mocked for these cleanup checks. They do not
prove cancellation of an active native tool.

Root has no Git metadata. Integration status remains the prior unstaged C1-Q
questionnaire source changes/untracked reply files; its cached diff is empty.
No integration file, existing probe code, governing document, app, global
configuration, service, or Tailscale setting was changed. No stage/commit/push.

## Inspected installed references and maintenance receipt

Package-relative documents read in full: `docs/custom-provider.md`,
`extensions.md`, `cli.md`, `environment-variables.md`, `configuration.md`,
`settings.md`, `models.md`, `providers.md`, `message-types.md`, `sessions.md`,
`session-format.md`, `sdk.md`, and `tui.md`. Applicable examples/declarations:

- `examples/extensions/custom-provider-anthropic/index.ts`: public legacy
  registration and balanced custom stream example; its network/auth code was
  inspected, not copied or executed.
- `examples/extensions/send-user-message.ts`: ordinary command-triggered send.
- `dist/core/extensions/types.d.ts`: `ProviderConfig.streamSimple`, lifecycle,
  input/tool/message events and read-only context/session view.
- `dist/index.d.ts`: public coding-agent root exports.
- Pi AI public `dist/index.d.ts`, `types.d.ts`, and
  `utils/event-stream.d.ts`: stream factory, normalized transcript/tools, content,
  callback, and event contracts. Event stream and faux-provider implementation
  were also inspected as stream-protocol references, not imported privately.
- Built-in `dist/core/tools/read.js`: inspection confirms default image handling;
  runtime uses the existing built-in tool, not direct definition execution.

New maintenance is restricted to two probe files and their reproduction/evidence:
(1) the fixed adapter and observer assertions pin public 0.99.2 stream/branch
contracts and require review before changing the version guard; (2) the POSIX PTY
runner owns isolation, permission, reopen, and cleanup checks, needed to make this
disposable test safe and reproducible; its SIGINT cases protect that ownership
boundary; (3) evidence docs preserve the synthetic-vs-real distinction. No
provider framework, server, transport, dependency, or product API was introduced.
The runner depends on the earlier reviewed cleanup helper; changes to that helper
require rerunning these focused ownership regressions. Fresh read-only review found
no issues, with the stated lack of a root Git baseline. Parent inspected both probe files
and independently reran normal/reopen and interrupt checks, all exit 0, then accepted
this narrow C1-M result. No product compatibility range is claimed.
