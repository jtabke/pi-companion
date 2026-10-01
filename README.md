# Pi Companion

See and interact with your running Pi terminal sessions from a local browser or your
phone. Review tool-generated screenshots at full size, send image feedback, and switch
between sessions without starting another agent.

Pi remains the agent. The companion is a private viewing and input surface, not a
replacement for Pi's terminal, tools, extensions or conversation storage.

## Features

- **One dashboard for your Pi terminals:** select a live session and view its current
  conversation, tool activity and connection state.
- **Image inspection:** view native tool-returned images inline and enlarge/zoom them.
- **Text and image feedback:** explicitly take browser control, then send idle text or
  one PNG/JPEG/WebP image with a local preview and remove option.
- **Explicit Stop:** request that Pi stop its current parent activity while keeping
  terminal input available.
- **Supported questions:** answer the same live questionnaire as the terminal when
  the optional source integration is restored and enabled.
- **Private phone access:** use Tailscale HTTPS; reconnect after locking the phone or
  closing the browser without transferring ownership away from the Pi terminal.

## Architecture and philosophy

```text
Pi terminals (each owns its session)
  + companion bridge
          | private Unix-domain sockets
Loopback gateway (127.0.0.1)
          +---- local browser (HTTP)
          +---- private Tailscale Serve (HTTPS) ---- phone browser
```

Pi owns behavior, history, tools, settings and subagents. Each terminal remains the
session owner; the gateway never creates a second agent or writes a parallel transcript.
Browser control is explicit, access requires pairing, and uncertain input is never
silently resent. Closing the browser or gateway does not stop Pi.

## Prerequisites

This currently runs **from a development checkout**, not a standalone published
package. Have a local checkout of this repository before following the steps below.

| Requirement | Current support and setup |
| --- | --- |
| Pi | **0.99.2 only** is checked. Install Pi and authenticate/configure its provider separately; `pi` must be on your PATH and work in your project terminal. See [Pi's official getting-started instructions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#getting-started). Do not infer support for the latest Pi version. |
| Node.js and npm | Tested with **Node 26.5.0 and npm 11.17.0**. Node 24 is a proposed baseline, not runtime-verified. |
| Operating system | Tested on **macOS**. Linux/Windows compatibility is not established. |
| Native build tools | A compiler/toolchain for the required `fs-ext` native build (on macOS, Xcode Command Line Tools). |
| Python | **Python 3**, used by the declaration-link bootstrap below and the native build tooling. |
| Optional phone access | Tailscale installed and signed in on the computer and phone, both on the same tailnet, with access restricted to the owner. HTTPS feature consent may be required. |

The companion does not install Pi, set up provider credentials or modify global Pi
settings. Its development setup links to the existing installed Pi declarations;
it does not bundle another Pi runtime.

## Install and build from the checkout

Run these steps in the **companion repository root**. Replace `/path/to/pi-companion`
with your local checkout path. Stop on any command failure rather than continuing.

### 1. Install locked dependencies with scripts disabled

```sh
cd /path/to/pi-companion
COMPANION="$PWD"
npm ci --ignore-scripts
```

### 2. Inspect and build the required native dependency

```sh
cat node_modules/fs-ext/package.json node_modules/fs-ext/binding.gyp
```

The required hook is `node-gyp configure build`, targeting local `fs-ext.cc` with
NAN headers. After inspecting that hook and target, build only this dependency:

```sh
npm rebuild fs-ext
```

Do not enable arbitrary dependency install scripts or override npm release-age policy.
Plain `npm ci` alone is **not** a complete bootstrap.

### 3. Link the installed development declarations

Run this one-off command from the companion root after **every `npm ci`**. It checks
the installed Pi and pi-ai versions, then creates the two ignored development links.
The pi-ai declarations are needed by the existing test fixture in the strict check.
Existing packages or mismatched links are not overwritten. These links are for
read-only use of installed declarations; do not edit installed package files.

```sh
python3 -B - <<'PY'
from pathlib import Path
import json, shutil

executable = shutil.which('pi')
if not executable:
    raise SystemExit('Existing Pi required on PATH')
package = next(p for p in Path(executable).resolve().parents
               if (p / 'package.json').is_file())
meta = json.loads((package / 'package.json').read_text())
if (meta['name'], meta['version']) != ('@earendil-works/pi-coding-agent', '0.99.2'):
    raise SystemExit('Only Pi 0.99.2 reviewed; stop for version review')
public_ai = package / 'node_modules/@earendil-works/pi-ai'
ai = json.loads((public_ai / 'package.json').read_text())
if (ai['name'], ai['version']) != ('@earendil-works/pi-ai', '0.99.2'):
    raise SystemExit('Only public pi-ai 0.99.2 reviewed')
scope = Path('node_modules/@earendil-works')
scope.mkdir(exist_ok=True)
for name, target in [('pi-coding-agent', package), ('pi-ai', public_ai)]:
    link = scope / name
    if link.is_symlink():
        assert link.resolve() == target.resolve(), 'Existing type link differs'
    elif link.exists():
        raise SystemExit('Refusing to replace a local package')
    else:
        link.symlink_to(target, target_is_directory=True)
PY
```

This is the existing local development route, not a fresh-install compatibility
guarantee. The original setup details are in the [local setup guide](docs/c2-observer.md#portable-local-setup)
and [fixture declaration-link guide](docs/c4-text-input.md#portable-setup-and-operation).

### 4. Check and build

```sh
npm run typecheck
npm run build
```

## Start locally

### 1. Launch each Pi session in its intended project

In each Pi terminal, set the absolute companion path, **then change to the project
where Pi should work**. Replace both example paths:

```sh
cd /path/to/pi-companion
COMPANION="$PWD"
cd /path/to/your-project
pi --extension "$COMPANION/dist/extension/bridge.js"
```

Repeat for other project terminals. Existing Pi processes without the bridge cannot
be attached automatically; start the intended owner explicitly with the extension.

### 2. Start one gateway in another terminal

```sh
cd /path/to/pi-companion
npm start
```

Keep this terminal open. The default gateway listens on literal `127.0.0.1:4317`.

### 3. Pair and select a session

Open **http://127.0.0.1:4317** (not `localhost`). Enter the pairing secret printed in
the gateway terminal, use **Select live session**, then take control explicitly when
you want to send input. Other browser views can remain read-only; terminal input
stays usable. Never append the secret to the URL or copy it into logs.

## Optional: use your phone over private HTTPS

1. Check your existing Serve routes and tailnet access rules first. Follow the
   [private HTTPS guide](docs/c5-private-https.md); do not replace another route,
   reset Serve or bypass owner consent. Never enable Funnel.
2. Stop the local-mode gateway with Ctrl-C, then start it in HTTPS-origin mode from
   the companion root. Replace the **synthetic** hostname below with your computer's
   actual Tailscale DNS name. The origin must be exact HTTPS with no port, trailing
   slash, path or query:

   ```sh
   cd /path/to/pi-companion
   C2_PUBLIC_ORIGIN=https://companion.example.ts.net C2_PORT=4317 npm start
   ```

3. In a separate terminal, run the private **foreground** proxy:

   ```sh
   tailscale serve --https=443 http://127.0.0.1:4317
   ```

4. Keep **both gateway and Serve terminals open**. If Tailscale requests HTTPS
   feature consent, complete its native owner flow. HTTPS certificates may publish
   the device DNS name in Certificate Transparency. No `--bg` or autostart is used.
5. On the phone, open the gateway's printed HTTPS URL, pair with the new terminal
   secret and select the desired live session. HTTPS mode authorizes only that exact
   HTTPS origin, not the loopback browser URL; the backend still binds `127.0.0.1`.

## Stop, restart and reconnect

- Stop the gateway and foreground Serve explicitly with Ctrl-C in their respective
  terminals. Pi sessions remain owned by their terminals; exit Pi separately when
  you actually want to end them.
- A gateway restart creates a **new pairing secret**. Pair again and select a session.
- Browser refresh requires **explicit session reselection**. Lock/unlock reconnect
  does not automatically resend input; an uncertain send requires your deliberate decision.
- Uploaded user images need not have native terminal thumbnails. Missing thumbnails
  alone do not imply lost model delivery; tool-returned images use a separate viewing path.

## Limitations

- **Questions are optional and source-only:** restore the [questionnaire patch](integrations/README.md),
  explicitly source-load it and opt in with `companionReplies: true`. The interface is
  off by default; the installed questionnaire is unchanged. Arbitrary custom dialogs
  are not supported.
- **Busy input stays in the terminal:** browser Steer/Follow-up is deferred. Use Pi's
  terminal controls while it is working.
- **Stop is not a cancellation receipt:** it requests abort and observes parent
  settlement, not cancellation of every queued input or background job. The companion
  does not enumerate/control background jobs or claim that parent idle means all work ended.
- **Only existing bridged owners:** no automatic attachment to uninstrumented Pi and
  no browser launch/resume of saved sessions.
- **Still images only:** one bounded PNG/JPEG/WebP attachment per send; no HEIC, SVG,
  video, audio or PDF support.
- **Manual development setup:** native build and installed declaration links are
  required; no packaged installer, global integration install or autostart is provided.
- **Phone coverage is limited:** the owner manually confirmed text/image input,
  uploaded and native read-tool image zoom, lock/unlock reconnect and refresh with
  session reselection. This is not mobile automation or phone Stop/questionnaire,
  every picker format, or full keyboard/accessibility certification.

## Documentation

See the [documentation index](docs/README.md) for operator guides, design/philosophy,
current plans and preserved validation evidence. Packaging/publishing remain deferred.
