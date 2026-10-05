# Usage guide

[Back to Pi Companion](../README.md) · [Setup guide](setup.md)

## Features

- **One dashboard for your Pi terminals:** sessions are grouped by exact working
  directory, with the most recent directory first and newest sessions first within it.
  Directory headings sit above full-width session rows.
  Same-named folders in different locations stay separate and show their parent paths.
  **Full path** opens a dismissible path popover beside each directory heading.
  Status dots and labels show observed activity and questions needing answers. The drawer shows the selected session's
  model and rename pencil in its session row. The top shows only the live-terminal count.
  A separate compact footer keeps Leave session, browser control and Device access visible.
  On narrow screens, drag from the left edge to open
  the drawer, then drag left inside it to close. The drawer and backdrop follow your finger;
  release speed sets the remaining animation duration. Reduced motion removes the settling animation.
- **Image inspection:** tap native tool-returned images to enlarge/zoom them, without an
  extra frame or visible caption. Image buttons retain accessible labels and keyboard focus.
- **Readable tool output:** inspect compact tool stacks, filename and command summaries,
  execution states, highlighted code and added/deleted edit lines. Expand only the output you need.
- **Text and image feedback:** narrow-screen drafts stay on one row until they wrap, then use a full-width editor above the actions.
  Pick or paste up to four PNG/JPEG/WebP images into the composer.
  Preview/remove them locally before sending together. Send acquires free browser control for idle
  text or an image; pasting alone never sends or takes control.
- **Busy text:** choose Steer or Follow-up beside **+**, then tap the send arrow,
  without stopping Pi. **Queued** in the session status means Pi has messages waiting.
  Successful requests do not leave a permanent receipt.
- **Native slash commands:** run `/new` and `/reload` in the existing Pi terminal, or
  choose a model in the browser with `/model`. Prompt templates and skills remain available.
  Suggestions appear above the input; unverified commands stay terminal-only.
- **Direct actions:** Send, questionnaire responses, Rename and Stop acquire free control
  when clicked. Another browser holder still requires a separate explicit takeover.
- **Explicit Stop:** request that Pi stop its current parent activity while keeping
  terminal input available.
- **Supported questions:** answer the same live questionnaire as the terminal when
  the optional source integration is restored and enabled.
- **Private phone access:** use Tailscale HTTPS; reconnect after locking the phone or
  closing the browser without transferring ownership away from the Pi terminal.

## Browser input

The composer starts with +, text and Send on one compact row inside a rounded
surface. Use the header button to open sessions; the editor has no duplicate sessions button.
Short drafts use all the available editor width on that compact row. Once text wraps or
contains a newline, the editor gets a full-width row above the actions.
Shortening the draft to fit restores the compact row. An available busy-mode selector
keeps the editor above the actions. Text grows upward
as it wraps and scrolls natively after a height cap. CSS owns the shell layout, with the
composer in normal flow and the conversation in its own scroll area. One viewport adapter
adjusts only shell geometry at normal zoom. After viewport changes, page movement, app return,
orientation, focus or input, it remeasures each animation frame for one second after the
last event, then stops. This covers late keyboard or dictation measurements without
permanent polling. Unchanged measurements do not rewrite styles. Matching viewports,
invalid readings and pinch zoom remove overrides and use CSS viewport sizing instead
of retaining an old keyboard-sized shell. The adapter does not reset focus or scroll,
change drafts, reload the page or send input. The sessions drawer and model picker use
that same geometry so their scrollable contents and actions fit the visible area.
Text sizing stays at 100% to prevent Safari's automatic rotation
inflation; pinch zoom and explicit text enlargement remain available.
Uncertain input uses one outcome receipt with Details and explicit Retry;
a simultaneous browser-control blocker remains separate. Notices scroll within a bounded
area rather than pushing the editor offscreen.
Picking multiple images or pasting repeatedly appends local thumbnails in a horizontal
row above the editor; each image can be removed before sending. Tap a thumbnail, or
focus it and press Enter, to inspect and zoom the local image before sending. Close or
Escape returns focus to that thumbnail without changing the draft or attachments.
Previewing never uploads an image, sends input or acquires control. Short keyboard layouts
retain readable notices and complete touch targets without covering the delivery selector. Jump to latest is a floating circle centered above the composer, not a separate
row or full-width overlay. Pressing Jump to latest keeps the editor focused so keyboard
closure cannot move the button before release; the click scrolls to the newest content.
The session name, project and activity share one compact
header; long names are shortened visually, with full identity retained in the accessible
session button and drawer. Keyboard focus uses a small neutral ring around the drawer
icon, not a full-width header highlight; the whole header button remains tappable.

Conversation spacing and code padding are compact without reducing text or touch-target
sizes. Hover feedback applies only on hover-capable devices; pressed buttons have transient
feedback. Selected rows retain their own highlight, and keyboard focus remains visible,
including image controls inside the scrolling conversation. Assistant messages omit visible
Pi headings while retaining accessible identity. Native Thinking stays collapsed until
opened and retains that choice while the same item updates. Observed active work uses
three subtle dots with an accessible activity label; reduced-motion mode shows static dots.
Consecutive tool results share compact icon-labelled stacks; each output expands independently.
Recognized native file tools show the filename; shell tools show the command. The full
bounded path or command is available inside the disclosure. Native execution events show
Running; finalized results show Done or Failed, with a short failure preview visible without expanding. Nested calls appear
only while observed running; their output remains owned by the parent tool. Progress is sampled
on existing gateway refreshes, so short calls may finish between observations.
Successful native edits expose their structured diff with distinct added/deleted backgrounds;
result text stays available. Lowlight highlights fenced code, native Read output and edit
diffs using the fence language or file extension, rendered as escaped React elements.
Unknown languages and code over 100,000 characters stay plain text; shell logs and
Edit/Write receipts are not interpreted as source code. Highlighting does not change copied text.
Copy answer copies the displayed answer's Markdown text, not reasoning or tool output;
shortened answers remain previews, not the full native history. A small muted Copy icon sits
just below each answer, aligned with the text, inside a 44px touch target. Code copying
stays separate.
The selected session row places its observed model at bottom-right beside the activity
status, with the rename pencil at top-right. Long model names wrap when needed. Context usage is not displayed.
Markdown tables keep readable natural column widths in a separate horizontal scroll area,
with Left/Right-arrow controls when that area is focused. They do not widen the page.

The send button uses an arrow in both idle and busy states. While busy text is available,
a **Steer / Follow-up** selector appears beside **+**. Tapping the arrow or pressing
unmodified **Enter** in the editor requests the selected mode. Its accessible label is
**Steer** or **Send Follow-up**. Changing the mode sends nothing. The selection remains
visible after sending, and resets to Steer when Pi becomes idle or you switch sessions.
Idle Send is unchanged. There is no hold menu or separate Follow-up button.
Pressing the arrow keeps the editor focused until the click completes, so keyboard closure
cannot move Send before release. The click requests dispatch and then closes the keyboard;
a canceled press or scrolling gesture does not send.
**Alt+Enter** in the editor requests Follow-up directly without changing the selection.
**Shift+Enter** inserts a newline; Stop stays separate. Pi owns steering boundaries and follow-up timing;
these requests do not interrupt a running tool.
Steer uses Pi's next steering boundary; Follow-up waits until after the current run.
This guidance does not reserve conversation or composer space. Successful requests do not
leave a permanent receipt. The session status says **Queued** while Pi reports messages
waiting, then returns to the observed activity when the queue clears. This status covers
Pi's queue, including terminal input; it does not identify individual messages or confirm
their completion. Delivered messages appear in Pi's native conversation. Multiple deliberate
requests are allowed. Lost responses retain the original ID/text/mode for explicit retry; refreshing
or reconnecting never resends input. Busy image attachments remain local and must be
removed before requesting busy text. Their routine explanation stays in the editor's accessible description, not above the thumbnails. Safety and error
notices remain visible.

While Pi is idle, type `/` for suggestions from that selected session. The scrollable
suggestions appear above the input as compact command-and-description rows. Terminal-only
extension commands are not suggested. Typing `/` or a matching prefix shows no warning.
Tap a supported native command, prompt template or skill, or use Arrow keys and Enter/Tab to select,
then tap **Send**. Selection only edits the draft; Escape closes suggestions.
Prompt-template and skill arguments remain unchanged.

### Native commands

Companion uses the public custom-editor hook to reach Pi's existing terminal submission
handler. It does not copy command implementations, send these commands to a model,
modify Pi source, or simulate terminal keystrokes.

- `/new` starts a fresh native conversation. The old browser view is cleared; Pi remains
  the history owner. The terminal process and Companion instance remain the same.
- `/reload` reloads Pi resources and replaces the bridge generation without replacing
  the terminal or native session. Companion follows the same instance with fresh authority.
  After observing Pi's native reload event in a new live snapshot, Companion shows
  **Pi reloaded** for four seconds. Dispatch alone, refresh and session selection do not
  show this confirmation; uncertain command receipts remain unresolved.
- Selecting `/model` in autocomplete (tap or Enter/Tab), or submitting bare `/model`,
  opens a scrollable list from Pi's available model snapshot, limited to its scoped models
  when configured. Choose a model with touch or the radio group's Arrow keys.
  **Use model** writes `/model provider/model` into the draft; **Send** executes Pi's
  native command. Opening the list and choosing a model never claim control or send input.
  Cancel/Escape sends nothing. At most
  128 models within a 65,536-byte catalog are shown. Use the terminal for other models.

These native commands require idle Pi with no queued input, no images, and an empty
terminal draft. If the terminal contains unsent text, clear or send it there first.
If another extension replaces the editor after the bridge installs its hook, native
commands become unavailable rather than calling a stale editor.
Forwarding is not a completion receipt. A lost response retains the command and original
identity. Native commands have no retry button: inspect Pi, then **Dismiss command receipt
without retrying** before making another deliberate request. Reload, reconnect and session
changes never resend input or acquire browser control automatically.

| Terminal-only commands                                                                                 | Why                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/settings`, `/thinking`, `/scoped-models`, `/tree`, `/fork`, `/resume`, `/clone`, `/import`, `/trust` | Their terminal interaction or session workflow has no verified browser adapter in this slice.                                                 |
| `/login`, `/logout`                                                                                    | Provider authentication remains terminal-owned; no browser credential flow is implemented.                                                    |
| `/export`, `/share`, `/bug`, `/compact`, `/quit`                                                       | File, publication, provider-call or process-exit effects are outside this command slice.                                                      |
| `/copy`, `/name`, `/session`, `/changelog`, `/hotkeys`, terminal-only novelty/debug commands           | Use the terminal. Companion's existing Copy answer and Rename controls remain available separately.                                           |
| Extension commands                                                                                     | Arbitrary dialogs and custom terminal components are not browser-mirrored. Their interaction and authority must be verified before admission. |

Unknown commands, unsupported native commands, busy slash input and slash-with-image input
are rejected, never sent as ordinary model text. This is not full terminal-command parity.
The hook and native lifecycle are tested on Pi **1.0.1** with isolated no-inference fixtures;
this is not a compatibility claim for another Pi version or a physical phone.

Pi loads the bridge's TypeScript source entry through its extension loader; the gateway
still uses the compiled build. This lets native `/reload` load bridge changes instead of
reusing a compiled JavaScript entry cached by the owning process. The hook captures the
editor after the remaining synchronous session-start handlers, preserving editor extensions
such as Pi Vim. A later editor replacement still disables native command admission.

For an existing terminal with the old bridge, activate the update once through native
terminal `/reload` while Pi is idle and its editor is empty. This retains the process and
native session. A terminal manager may send that exact command after verifying the owning
process, idle state and empty editor; it must not clear a draft or retry uncertain delivery.
After activation, Companion's `/reload` uses the native callback directly, with no terminal
manager dependency. Restart the known gateway with its existing origin/runtime/auth directory
and refresh the browser for UI updates. Initial package installation still requires the full
Pi restart [described in setup](setup.md#1-register-the-bridge-once-then-restart-pi-fully).
Remembered access does not need a new pairing code.

## Rename a session

Open **Live sessions**. The drawer heading and Close remain available while its contents
scroll. The rename pencil appears beside the selected session's row.
Choose the pencil (**Rename session**), edit the native name, then select **Save** or **Cancel**. Names must be nonblank and at most 120 UTF-16 units. Save uses
Pi's public session-name API, not model input or a browser name store. Older bridges
without rename support do not offer the action.

Cancel/Escape before forwarding cancels preparation; it cannot undo a forwarded rename.
An uncertain response retains the original owner/name without resending. Check the native
name before acting again. A displayed native name is an observation, not proof of a
per-request durable commit. Automatic naming remains the naming extension's responsibility.
