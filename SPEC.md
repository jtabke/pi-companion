# Pi Companion specification

## 1. Purpose

Let the owner use a phone to see and interact with Pi sessions already running in
terminals on this computer. Show tool-generated screenshots as real images, with
an enlarged view, and accept image feedback from the phone.

The first release targets this Mac and an iPhone browser over Tailscale.
Linux-friendly local IPC and service boundaries are preferred. Linux validation
is a later decision; Windows support is not part of the initial scope.

## 2. Product principles

1. Pi owns agent behavior and durable conversations.
2. The companion owns presentation and routing, not agent policy.
3. Tailscale owns private network connectivity; it does not sandbox Pi.
4. Adapt existing mechanisms before introducing a parallel one.
5. Prove the real phone screenshot workflow before adding workspace features.
6. Keep essential connection and media policy explicit at its owning boundary.

The project may reuse suitable libraries and proven implementation patterns.
It must not import a second agent framework just to obtain a frontend.

## 3. Required user journeys

### A. Discover and view running sessions

1. Start Pi normally in two terminals with the companion extension loaded.
2. Launch the companion gateway from a terminal.
3. Open the dashboard locally or through its private Tailscale HTTPS address.
4. See both reachable Pi instances, their project, session name, and activity.
5. Select either session and view its current conversation and tool activity.
6. Switch sessions without stopping either agent or creating another agent.

A process with a loaded bridge must be discoverable whether it starts before or
after the gateway. An uninstrumented terminal process cannot be attached automatically.

### B. Review a screenshot and respond

1. Ask Pi to capture or read a screenshot using the existing tools.
2. Show returned image content inline beside the relevant tool/message.
3. Tap to enlarge, inspect details with touch zoom, then return to the same position.
4. Attach a screenshot or photo from the phone, preview/remove it, and send feedback.
5. Pi receives the image through its own supported input API and continues the same session.

The UI must distinguish uploading an image from displaying a tool-produced image.
Showing an absolute filesystem path or a JSON image block does not satisfy this journey.

### C. Disconnect and return

Pi continues when the browser closes, the phone locks, or the gateway restarts.
When the phone reconnects, restore the active branch and finalized media from Pi's
native session data, plus any available live state. Do not duplicate messages.
Do not automatically resend uncertain input or replay side-effecting commands.

### D. Respond to interactive tools

The phone must show supported pending questions and submit a response to the
same live invocation. A terminal answer must dismiss the corresponding browser
request, and vice versa. Never auto-confirm a question.

The existing questionnaire extension can use custom TUI, not just standard dialogs.
Compatibility is an early gate, not an assumed feature. Unsupported interactions
must remain in the terminal and produce a clear browser notice.

## 4. Invariants and scope

### Must preserve

- The host Pi process, its cwd, resource loading, project-trust decisions, and credentials.
- Global/project guidance, tools, skills, extensions, and existing pi-subagents behavior.
- Native Pi session persistence and active-branch semantics.
- The terminal as a working control surface.
- One owning Pi process per attached session. The gateway never opens an AgentSession
  for that session, invokes another model, or writes transcript JSONL.
- Bounded memory, streamed media delivery, and explicit error/connection states.

An observer extension necessarily adds local resources and commands. It must not
replace prompts, tool implementations, or orchestration policies.

### Initial scope

- Terminal-launched gateway and Pi bridge extension.
- Live-session list and switching.
- Active-branch text, collapsible thinking, tool activity, and image content.
- Full-screen image inspection and validated phone image input.
- Send, explicit steer/follow-up, and Stop where the installed public API supports them.
- Reconnect, question compatibility, private remote access, and lifecycle cleanup.

### Not in the initial release

- A terminal emulator, filesystem browser/editor, Git UI, or web IDE.
- Browser editing of auth, models, trust, packages, prompts, or subagent settings.
- New subagent tools, goal loops, profiles, or model-provider integrations.
- Arbitrary custom TUI rendering.
- Starting/resuming saved sessions from the gateway.
- Public sharing, cloud relay, Funnel, telemetry, or multi-user tenancy.
- Video/audio/PDF support, transcription, or annotations.

Video/audio/PDF viewing is a later checkpoint decision. Browser playback and
model understanding are separate capabilities; neither follows from image support.

## 5. Proposed architecture

```text
Pi process (one per terminal)
  existing Pi runtime + TUI
             ↕ public extension API
  companion bridge
             ↕ private per-user local IPC
  terminal-launched gateway
             ↕ authenticated same-origin HTTP + SSE
  browser UI, locally or through Tailscale Serve
```

Use one gateway rather than publishing a changing HTTP port for every Pi session.
A private Unix-domain socket per Pi process is the preferred local transport.
Confirm socket-path limits and runtime-directory behavior on macOS before committing.
Do not expose bridge endpoints to the LAN.

One application package can contain the bridge, gateway command, shared protocol,
and bundled frontend. These are responsibilities, not requirements for separate services.

Permit one authoritative gateway per owner/runtime directory. Enforce exclusion with
a process-lifetime lock and verified stale-owner recovery; a second launch must attach
to the existing gateway or fail clearly, not create a competing controller authority.

The selected stack direction is documented in [STACK.md](STACK.md): TypeScript,
Node.js, Fastify, React + Vite, and established browser components. Public Pi API
compatibility remains a C1 gate. Do not create a general plugin system or transport
abstraction without a demonstrated need.

### Discovery

Each bridge registers minimal connection metadata in an owner-only runtime directory.
Records include an instance ID, generation, local endpoint, protocol version, and
non-secret session identity. Never publish credential values.

The gateway authenticates the local peer/capability and checks reachability before
listing an instance as connected. PID checks or session-file modification times alone
do not establish liveness. Stale registrations must not survive as apparently live sessions.

Register/update at appropriate session lifecycle boundaries; clean up idempotently.
Reload, new, resume, fork, and shutdown invalidate old contexts and generations.
A reused process ID must not inherit the old instance's identity.

Discovery state is disposable. It is not a session database. Resolve local directories
through Pi/platform mechanisms; do not store application code inside Pi's agent directory.

### Session identity and ownership

Identify a connection by instance ID and generation, not only persisted session ID.
Use opaque browser IDs. Keep session paths server-side.

If two processes advertise the same canonical session file, show an ownership conflict
and refuse browser mutation for it; do not pretend the companion can stop unrelated
terminal processes from writing it.

Saved history is distinct from live registration. History browsing may be added later
through read-only Pi APIs. Never label a stored file as a running process.

### Events and state

Use public Pi events and the session manager's current active branch. Do not flatten
abandoned branches or reconstruct activity by repeatedly tailing JSONL.

Use Pi entry/tool-call IDs when available; assign generation-scoped IDs for live items
without persisted IDs. Reconcile final records with live updates explicitly.

Use one browser SSE connection carrying lightweight discovery/activity summaries for
all registered instances and detailed conversation events for the selected instance.
Unselected sessions must stay current without full-transcript browser subscriptions.
SSE requires event IDs, bounded replay, snapshot fallback, heartbeats, and cleanup.
Gateway restart must obtain fresh snapshots from surviving bridges.
Bound text previews and avoid forwarding large base64 images in every state update.

Do not interpret agent_end as the session being done. Use agent_settled where supported.
A settled parent can still own background extension work. Report known Pi activity
without claiming that idle means every subagent is finished.

Show Working, Idle, Disconnected, and Error. Show Needs input only when a supported
pending interaction is explicitly known. Stop remains Stopping until confirmed;
extension tools can ignore abort signals, so do not claim immediate cancellation.

### Input and controllers

Serialize browser mutations per instance. Permit multiple readers and one explicitly
claimed browser controller; other tabs remain read-only until deliberate takeover.

This lease does not disable terminal typing. Pi arbitrates terminal/browser input;
show when messages were accepted, queued, rejected, or have an uncertain outcome.

Bound and deduplicate request IDs within a live generation. A reconnect or gateway
restart must not silently retry an input whose acceptance is unknown.
Idle send and busy steer/follow-up must follow the installed public APIs.
For the first phone test, the owner deferred browser busy steer/follow-up. Pi's public
busy dispatch exists; safe automatic release of a companion outstanding-attempt slot
is not proved. Keep these controls in the terminal; do not change Pi core for this slice.
Stop requests abort of the selected generation's current parent activity. A later
public settled observation is not a per-request cancellation acknowledgement and does
not prove cancellation of queued, delayed-input, or background work.
Closing or switching browser views must not stop work or clear queues.

### Extension interactions: feasibility gate

A normal observer extension is not automatically entitled to intercept other extensions'
ctx.ui calls. Verify the available public hook before promising a universal dialog bridge.

Test the user's actual questionnaire tool and pi-subagents behavior. Prefer an existing
explicit integration seam. Do not monkey-patch private runtime methods or silently bind
a replacement global UI context that disables terminal interaction.

The owner approved an opt-in public reply integration in the existing questionnaire
extension's source as a short-term solution. Preserve default terminal behavior and its
tool-result envelope; validate once-only completion and stale responses. Do not modify
the installed copy or global settings without separate installation approval.

The companion depends on the documented question/reply contract, not the extension's
TUI implementation. A possible future questionnaire replacement is not in current scope.
If integration requires changing Pi itself, another package, or product policy, stop at
that boundary, report the demonstrated limitation, and ask before expanding authority.

## 6. Media boundary

### Returned images

Native Pi image blocks are the first source. Serve them through opaque references
scoped to the authorized session, generation, and message/tool result.

Finalized images should remain viewable while their native session data remains
available. Temporary live-only images may expire; show an explicit unavailable state.
Do not promise recovery of content that Pi never persisted.

### File artifacts

A path printed by the model is not authorization to read that file. Initial support
does not provide arbitrary path URLs. If existing tools return only paths, prefer
having Pi read the image through its existing read tool.

A separate artifact-publishing mechanism requires evidence that native image content
cannot meet the approved workflow and a bounded follow-on decision.

### Phone uploads

Validate actual file contents, byte/pixel/count limits, model image capability, and
Pi image settings. Preview before sending. Apply orientation and remove private
metadata where supported without changing what the user intended to show.
Respect Pi's provider limits; explain any resizing and rejection.

Prefer decoding outside latency-sensitive Pi event handlers. Do not turn upload
processing into unbounded background work or block terminal input.

Initial image types: PNG, JPEG, and WebP. Inspect actual iPhone picker behavior and
report unsupported HEIC/other types; add conversion only when needed for the real journey.

## 7. Security and privacy

Treat access as remote control of an agent with the host user's permissions.

- Bind the gateway to literal 127.0.0.1; use private Tailscale Serve, never Funnel.
- Require an authenticated browser session, explicit local/Tailscale host and origin
  allow-lists, CSRF protection, and validated bounded request schemas.
- Local IPC and registration files must be owner-only. Local capabilities are not
  exposed to the browser or written to ordinary logs.
- Use HttpOnly cookies, restrictive security headers, and no credential in persistent URLs.
- Render untrusted text safely; disable raw HTML and executable link schemes.
- Do not allow arbitrary remote images by default. Media endpoints require authorization.
- Never return auth.json, keys, OAuth tokens, arbitrary environments, or arbitrary files.
- Browser control does not approve project trust or suppress security questions.
- Keep frontend assets bundled; no telemetry or third-party content fetching by default.
- Document that Tailscale access rules must restrict access to the owner.

Loopback binding is not sufficient authentication. Same-host processes and malicious
web pages still inform the threat model. Pi and loaded extensions are trusted code,
not an OS sandbox.

No automatic Tailscale changes, global extension installation, autostart service, or
host sleep-policy changes without explicit confirmation at the relevant checkpoint.

## 8. Phone UI

```text
Sessions drawer: project / name / actual activity
────────────────────────────────────────────────
Header: selected session | connection | controller
Conversation: text, image thumbnails, tool disclosures
Image viewer: enlarge / touch zoom / close
Composer: attachment preview | text | Send
Busy controls: Steer | Follow-up | Stop
Pending supported question: visible, answerable panel
```

Use accessible controls, visible focus, comfortable touch targets, safe-area spacing,
and software-keyboard-aware layout. Test at 320 px wide and approximately 390×844.
No action may require hover. Respect reduced motion and system light/dark preference.
Autoscroll only when near the bottom; otherwise offer Jump to latest.

Disconnected views are readable but cannot send. Switching sessions preserves separate
drafts without sending them. Default browser storage must not retain transcripts or media.

## 9. Acceptance

1. Two independently launched terminal Pi processes appear in one dashboard.
2. A bridge started before the gateway is discovered; a later bridge also appears.
3. Selecting a session attaches without constructing another agent or modifying its prompt/tools.
4. A real tool-produced screenshot renders inline and enlarges on the phone.
5. A phone-uploaded image enters the same Pi session through a public API.
6. A browser disconnect and gateway restart leave both Pi processes working.
7. Reconnection restores active-branch messages/media without duplicates.
8. Generation changes, crashed processes, ownership conflicts, and stale requests fail safely.
9. Standard interactions and the user's actual custom questionnaire are tested; limitations
   are reported explicitly before any separate integration work.
10. Existing subagent work survives browser switching, disconnect, and gateway restart.
11. Security tests reject unauthorized requests, cross-site mutations, and arbitrary file access.
12. Type checks, focused tests, production build, and phone browser checks pass.

Use deterministic fixtures for automated tests. Real-Pi/model smoke tests are opt-in
and must not run by default. A mock-only result cannot close a checkpoint claiming
real Pi or iPhone compatibility.

## 10. Evidence and remaining decisions

Verified installed environment: Pi 0.99.1, Node v26.5.0, npm 11.17.0.
Installed docs confirm session listing, native branch context, extension lifecycle,
user-message delivery, and settled events. They do not establish a built-in
cross-process live attach service or a universal dual-surface TUI bridge.

The [capability probe](docs/capability-probe.md) verified public text/image delivery
with handled interception, actual questionnaire observation, and terminal completion.
It did not verify normal durable input acceptance, queueing, or real screenshots.
The installed questionnaire exposes notifications, not a public reply API. The owner
approved a separate source-only integration, now completed and reviewed locally:
[questionnaire reply evidence](docs/questionnaire-replies.md). Its default-off interface
passed source tests and real-TUI instrumented answer-race checks, not browser/phone tests.
The installed copy remains unchanged pending separate installation approval.
The cleanup repair and two real SIGINT checks passed on Pi 0.99.2; focused fresh review
found no issues. These are probe results, not full companion compatibility.

References relative to the installed @earendil-works/pi-coding-agent package:
- docs/sessions.md, docs/sdk.md, docs/session-format.md, docs/extensions.md
- examples/sdk/11-sessions.ts and examples/sdk/06-extensions.ts

Discover the package location on the target host; do not assume a personal installation path.

Prior source comparisons:
- kkkiio/pi-web-ui: same-process architecture; inspected tool output becomes text/JSON.
- @narumitw/pi-webui 0.49.3: focused companion, but remote access explicitly unsupported.
- agegr/pi-web: actual tool-image rendering, but separate SDK sessions and runtime differences.
- xing-shuyin/pi-web-ui: media features with overlapping agent policy.

These comparisons are inspection evidence, not installed compatibility results.
Recheck versions before reusing code. Record attribution/license requirements.

Unresolved at the capability checkpoint: exact public API reachability, questionnaire
integration, IPC transport details, supported media limits, and version dependency policy.
[STACK.md](STACK.md) records the technology direction. Exact dependency versions and
Pi compatibility declarations remain contingent on the capability investigation.

Explicit browser Stop is now accepted locally on Pi 0.99.2; see [Stop evidence](docs/c4-stop.md).
The genuine held-provider abort and later public parent-settled observation passed
independent review and parent regression checks. The receipt remains outcome-unconfirmed;
there is no per-request, queued/delayed or background cancellation guarantee.
Supported questionnaire browser integration is accepted locally against the approved
source-loaded opt-in package; see [questionnaire evidence](docs/c4-questionnaire.md).
Both real TUI/browser winners, pending gateway restart and default-off behavior passed.
Cancel serialization and null-preserving reply transport have reviewed regressions.
This does not install the source package or prove native model dispatch/persistence.
Actual installed-package background-work survival is accepted locally; see
[background evidence](docs/c4-background-survival.md). One same-ID native child and
normal/held-interrupt cleanup passed review and parent validation. Its completion wake
remains native; three fixed local responses include one approved parent acknowledgement.
This does not add browser job control or prove owner-Pi shutdown/reload survival.
C5-A exact HTTPS application boundary is accepted after independent review and parent
types/build/51 unit/process checks. Native owner consent enabled manual private Serve;
parent verified actual TLS, shell/assets and live auth/Host/Origin denials. The owner
manually confirmed phone pairing/session use, text/image input, uploaded-image zoom,
native read-tool image zoom, lock/unlock reconnect and refresh with explicit session
reselection. C5's first screenshot/feedback journey is accepted on that owner report,
not instrumented mobile automation. Phone Stop/questionnaire, every picker format and
full keyboard/accessibility behavior are not certified. No autostart is implied.
See [private HTTPS evidence](docs/c5-private-https.md).
