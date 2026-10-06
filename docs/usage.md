# Usage guide

[Back to Pi Companion](../README.md) · [Setup guide](setup.md)

## Choose a session

Tap the session title to open **Live sessions**, then choose a terminal by its name
and working-directory group. Same-named folders stay separate; **Full path** shows
the directory's location. The selected row shows its model and rename action.
On narrow touch screens, swipe right from the left edge outside the editor to open
the drawer, or drag left inside the drawer to close it.

Pi remains the session owner. Disconnected content is read-only. Refresh restores
selection from the URL fragment, but not unsent drafts. For pairing, device access
and phone installation, see [setup](setup.md).

## Read the conversation

- Expand individual tool outputs to inspect commands, paths, results and edit diffs.
  Thinking stays collapsed until opened.
- Tap tool-returned images to inspect and zoom them.
- **Copy answer** copies the displayed answer's Markdown, not reasoning or tool output.
  A shortened answer is a preview, not the full native history. Code copying is separate.
- Tables scroll horizontally; when focused, use Left/Right arrows to scroll them.
- **Jump to latest** returns smoothly to the newest content; reading gestures or opening
  a disclosure interrupt the return. Reduce Motion makes it immediate. Streaming and
  restored history do not smooth-scroll. New native user messages animate only while
  following latest, not on initial load or with Reduce Motion. Sending does not create
  an optimistic conversation message.

Activity and **Queued** labels reflect Pi's observations, not confirmation that a
particular message completed. Extension status cards scroll with the conversation;
Subagents counts describe observed work items, not exact child counts. Missing or zero
background status does not prove all work ended.

## Send text and images

Type a message and tap the send arrow, or press **Enter**. **Shift+Enter** inserts a
newline. The editor expands as text wraps. Drafts and attachments stay local until
sent and are not preserved by a page refresh.

Use **+** or paste to attach up to four PNG/JPEG/WebP still images. Preview or remove
thumbnails before sending; tap one, or focus it and press Enter, to inspect it.
Close or Escape returns to the thumbnail without changing the draft. Previewing
never uploads, sends or takes browser control. Audio and video are not supported.

### While Pi is busy

Choose **Steer** or **Follow-up** beside **+**, then tap the arrow or press Enter:

- **Steer** delivers at Pi's next steering boundary.
- **Follow-up** waits until after the current run. **Alt+Enter** requests it directly
  without changing the selector.

Neither interrupts a running tool. Changing the selector sends nothing; it resets to
Steer when Pi becomes idle or you switch sessions. Busy image attachments stay local
and must be removed before requesting busy text.

### Control and uncertain outcomes

Send, questionnaire responses, Rename and Stop acquire free browser control when
clicked. If another browser holds control, take over explicitly, then repeat the
intended action. Takeover itself never resumes a blocked request. Terminal input
remains available.

Forwarding is not proof that Pi consumed or completed input. If a response is lost,
inspect Pi and the outcome receipt before using **Retry**. A retry retains the original
request ID, text and mode; reconnecting never silently resends it. Native commands
have a separate no-retry rule below. New browser input IDs expire after ten minutes:
check Pi before making a new deliberate request if an outstanding retry expires.
Receipts retire automatically without changing the terminal generation or browser
control; expired requests can never execute again. Older browser IDs retain their
generation-long deduplication protection.

**Stop** requests that Pi stop its current parent activity. Parent idle does not
confirm cancellation of every queued input or background job.

## Commands and model selection

While Pi is idle, type `/` for suggestions. Tap a supported command, prompt template
or skill, or use Arrow keys and Enter/Tab to select, then tap **Send**. Selection only
edits the draft; Escape closes suggestions. Template and skill arguments remain unchanged.

| Native command | Action                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `/new`         | Start a fresh native conversation in the same terminal.                                                                                    |
| `/reload`      | Reload Pi resources while retaining the native session. **Pi reloaded** appears only after observing the reload, not merely forwarding it. |
| `/model`       | Open Pi's model picker. Choose a model, then **Use model** to write `/model provider/model` into the draft; **Send** executes it.          |

Opening the model picker, choosing a model or canceling never sends input or takes
control. The picker follows Pi's scoped models when configured and shows at most
128 models within a 65,536-byte catalog; use the terminal for others.

Native commands require idle Pi, no queued input, no images and an empty terminal
draft. Clear or send unsent terminal text there first. If another extension replaces
the terminal editor after the bridge hook installs, these commands become unavailable.

Unknown or unsupported commands, busy slash input and slash-with-image input are
rejected, never sent as model text. Other native and extension commands remain
terminal-only, including settings, history navigation, authentication, file export,
publication and process exit. Companion does not mirror arbitrary terminal dialogs.

A lost native-command response has **no Retry button**. Inspect Pi, then choose
**Dismiss command receipt without retrying** before making another deliberate request.
Reload, reconnect and session changes do not resend commands or acquire control.
See [setup](setup.md#stop-restart-and-reconnect) for bridge activation and updates.

## Rename a session

Open **Live sessions**, choose the selected row's pencil (**Rename session**), edit
its name, then choose **Save** or **Cancel**. Names must be nonblank and at most
120 UTF-16 units. Older bridges without rename support do not offer the action.

Save changes the native Pi name. Cancel/Escape cannot undo a forwarded rename.
If the response is uncertain, check the native name before acting again; it is not
a per-request durable receipt. Automatic naming remains the naming extension's job.

## Answer supported questions

Browser questionnaires require the optional [source integration](../integrations/README.md)
with `companionReplies: true`. Answer the same live questionnaire as the terminal;
terminal completion remains available and stale replies are rejected. Other custom
terminal dialogs are not supported.
