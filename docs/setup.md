# Setup and runtime guide

[Back to Pi Companion](../README.md) · [Usage guide](usage.md)

## Prerequisites

This currently runs **from a development checkout**, not a standalone published
package. Have a local checkout of this repository before following the steps below.

| Requirement           | Current support and setup                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pi                    | **0.99.2** is the earlier checked baseline; **1.0.1** is checked against the installed host's public bridge APIs, local fixtures and read-only live observations. Install Pi and authenticate/configure its provider separately; `pi` must be on your PATH and work in your project terminal. See [Pi's official getting-started instructions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#getting-started). Do not infer support for the latest Pi version. |
| Node.js and npm       | Tested with **Node 26.5.0 and npm 11.17.0**. Node 24 is a proposed baseline, not runtime-verified.                                                                                                                                                                                                                                                                                                                                                                                              |
| Operating system      | Tested on **macOS**. Linux/Windows compatibility is not established.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Native build tools    | A compiler/toolchain for the required `fs-ext` native build (on macOS, Xcode Command Line Tools).                                                                                                                                                                                                                                                                                                                                                                                               |
| Python                | **Python 3**, used by the declaration-link bootstrap below and the native build tooling.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Optional phone access | Tailscale installed and signed in on the computer and phone, both on the same tailnet, with access restricted to the owner. HTTPS feature consent may be required.                                                                                                                                                                                                                                                                                                                              |

The companion does not install Pi or set up provider credentials. Optional personal
registration uses Pi's local-package command to add only this package to your resource
settings. It does not replace unrelated settings or bundle another Pi runtime.
Development setup links to the existing installed Pi declarations.

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

Run this command from the companion root after **every `npm ci`**. It checks
the installed Pi and pi-ai versions, then creates the two ignored development links.
The pi-ai declarations are needed by the existing test fixture in the strict check.
Existing packages or mismatched links are not overwritten. These links are for
read-only use of installed declarations; do not edit installed package files.

```sh
npm run setup:types
```

The checked-in [declaration-link script](../scripts/link-pi-declarations.py) validates
both destinations before creating either link. Repeating it is safe when both links
already match; it refuses existing packages and different links without replacing them.

The setup has been checked in an isolated source copy on macOS using the existing Pi
host, npm cache and browser engines. This is not a clean-machine/network-download or
wider compatibility guarantee.

### 4. Check and build

```sh
npm run typecheck
npm run build
```

For the complete local fixture gate, with Chromium/WebKit installed under
`.cache/playwright`, run:

```sh
npm run check
```

This runs typecheck, build/unit/process checks, then build/browser checks. Both
`npm test` and `npm run test:browser` build first, so their fixtures cannot silently
use an older `dist` build. The aggregate deliberately repeats the small build so
both standalone test entry points remain safe. A failed build stops the tests.
Native Pi probes (`npm run test:pi`) and actual phone checks are separate opt-in
verification; the fixture gate does not call a model or touch private Serve.

### Formatting and static analysis

```sh
npm run format:check
npm run format
npm run analyze
```

`format:check` is read-only; `format` writes Prettier formatting. `analyze` runs
Fallow's read-only report and is not a clean-findings gate. These tools are separate
from the fixture gate. A static finding is evidence to inspect, not a reason to delete
safety guards or extract code merely to lower a complexity score.

## Normal Pi startup and one shared private runtime

Managed startup/reuse/status/stop/restart and certificate-checked HTTPS are now verified
on this Mac with the native Tailscale CLI. Automatic loading after a full Pi restart and
updated phone behavior are still unverified. The earlier phone journey used manual startup.

### 1. Register the bridge once, then restart Pi fully

After building, run this explicit personal registration from the companion root:

```sh
cd /path/to/pi-companion
pi install "$PWD"
```

This registers the local checkout, not a global npm installation or Pi upgrade. The
manifest exposes only the built bridge. Fully exit and restart existing Pi processes;
`/reload` is not the installation transition. Then launch `pi` normally in each intended
project. Only terminal UI sessions publish bridges; print, JSON and RPC modes do not.
The declaration remains in personal settings, so keep the checkout/build available.
To remove it later, use `pi remove /path/to/pi-companion` and fully restart Pi again.

### 2. Start or reuse the private runtime

First stop only your **known companion gateway and Serve commands** with Ctrl-C.
Leave Pi sessions alone. Do not kill an unknown PID, reset Serve or remove another route.
The managed command refuses every existing Serve configuration, even a matching one,
and refuses a legacy gateway that has no management channel.

Replace this **synthetic** hostname with your computer's exact Tailscale DNS name:

```sh
cd /path/to/pi-companion
npm start -- start --origin https://companion.example.ts.net --port 4317
```

The origin must be exact HTTPS with no port, trailing slash, path or query. Existing
`C2_PUBLIC_ORIGIN`/`C2_PORT` variables are also accepted; explicit flags take precedence.
The command returns after gateway/Serve readiness or reports a refusal. A second start
reuses only the same origin/port/runtime. The shared runtime survives closing the
launching terminal and is independent of Pi session lifetimes. No login service,
automatic restart or Tailscale `--bg` is installed.

Tailscale must be running with owner-only tailnet access. If HTTPS consent is needed,
complete its native owner flow; no consent bypass or Funnel is used. Certificates may
publish the device DNS name in Certificate Transparency. The backend still listens only
on `127.0.0.1`; managed mode authorizes only the exact HTTPS browser origin.

#### If Companion cannot find the Tailscale CLI

Managed commands use `tailscale` from PATH. If the macOS app CLI is missing from PATH
or your shell wrapper does not use `exec`, run this once in the terminal you use for
Companion commands:

```sh
export PATH="/Applications/Tailscale.app/Contents/MacOS:$PATH"
```

This changes only that terminal's environment. A wrapper without `exec` prevents
reliable shutdown of Companion's owned Serve process.

### 3. Pair and remember your device

```sh
npm start -- status
npm start -- pair
```

`pair` prints a six-digit, single-use code only to an actual terminal; redirected output
is refused. Each code expires after five minutes. Issuing another replaces the old code
but does not reset attempt limits. Start/status never print credentials.

Open the reported HTTPS URL on your phone, enter the code and tap **Pair this device**.
Leave **Remember this device** checked for access that survives gateway restarts and
expires 30 days after pairing, without renewal. Unchecked access lasts eight hours and
is lost on gateway restart. Five failed guesses lock the code; exchanges are limited
to ten per minute per gateway. A replacement code does not reset that attempt window.
Use the same Safari browsing context and hostname; clearing
cookies or switching to private browsing does not preserve access. Never put a code or
cookie in a URL, file or log. Then tap the session title to open **Live sessions** and
choose the terminal by its name and working-directory group. Session rows show names
and activity, with a quiet full-row selected highlight. Per-session diagnostic IDs and
Details disclosures are not shown; action receipts retain their required safety details.
On narrow touch screens, swipe right from
within 44px of the left edge outside the editor to open the same drawer.
A small diagonal start remains undecided until movement is clearly horizontal or vertical.
After the gesture is claimed, the drawer follows horizontal movement and the backdrop
follows its visible fraction. A 64px swipe still completes opening or closing; short,
reversed or canceled gestures return to their starting state. The remaining motion uses
recent swipe speed and distance, bounded to 80–300ms; a pause before release is not a fling.
Reduced motion keeps direct dragging but removes the settling animation.
Code, image and input controls keep their gestures; vertical scrolling and multi-touch
do not open the drawer. Other dialogs retain ownership of their surfaces.
Send/questionnaire/Stop acquire free control on the deliberate action. A competing
holder requires a separate takeover click, then another deliberate action. Nothing is
sent by page loading, selecting a session, takeover, reconnect or lease expiry.

If you override `C2_RUNTIME`, use the same value for Pi and every companion command.
Pairing codes and raw credentials are not saved. Remembered-device hashes and bounded
identity/expiry metadata are stored in `~/.pi-companion` (or `C2_AUTH_DIR`). Keep the same
runtime, auth directory and exact origin when restarting. No transcripts or Pi settings
are stored there. At most eight devices/sessions are allowed; there is no silent eviction.

Use **Forget this device** in the session sidebar to revoke the current device. Wait for
confirmation; an unavailable or lost response does not confirm revocation. To inspect or
revoke access from the local managed-runtime terminal, use `npm start -- devices` or
`npm start -- revoke <device-id>`. Revocation does not
cancel native work already dispatched.

## Install on your phone

The frontend includes a web manifest, home-screen icons and a standalone launch mode.
Use the same private HTTPS address; installation does not start a gateway, grant access,
take browser control or send input. This is still a companion to Pi running on the Mac.

- **iPhone:** open the address in Safari, tap **Share → Add to Home Screen**, and open
  the new Pi Companion icon. If the installed app asks for pairing, obtain a fresh code
  and pair that browsing context explicitly; do not assume Safari's access transferred.
- **Other supported browsers:** use the browser menu's **Install app** or **Add to
  Home Screen** option. Availability depends on the browser.
- Installation instructions are also under **Device access → Install on this device**
  in the sessions drawer; they are hidden in standalone mode, including iPhone's
  standalone indicator. The stable app ID and start address are `/`; choose a terminal
  after opening it. Drafts and reading positions remain in memory, not browser storage.
- If offline setup fails or the browser does not support it, **Device access** shows a
  quiet notice. Online access still works; the notice does not request new permissions.

After an online visit installs the service worker, a later offline launch can show a
static recovery page. It cannot display conversations, inspect media or send actions.
Only the public recovery document, stylesheet and icon are cached—not the app document,
API responses, transcripts, media, credentials or input requests. Nothing queues or
replays when connectivity returns. An earlier uncertain request can still have reached
Pi; check its outcome rather than assuming an offline page cancelled it.

Worker updates wait for old controlled windows to close; they do not force a reload
while input may be uncertain. **Forget this device** revokes access, not Pi's ongoing
work. Removing the home-screen icon alone is not confirmed device revocation.

Manifest, worker lifecycle, cache exclusions and offline behavior have local browser
fixture evidence. Desktop WebKit offline navigation was proved with actual isolated
server loss because its driver's offline mode fails internally. Actual iPhone
installation, standalone cookies, keyboard and VoiceOver remain unverified.

## Manual local HTTP mode

The original foreground path remains available without personal registration:

```sh
cd /path/to/pi-companion
COMPANION="$PWD"
cd /path/to/your-project
pi --extension "$COMPANION/src/extension/bridge.ts"
```

In another terminal, run `npm start` from the companion root. Keep it open, browse to
**http://127.0.0.1:4317** (not `localhost`), and pair with its printed six-digit code.
If that code expires, restart only this known foreground gateway for a fresh code;
managed `pair`, `devices` and `revoke` commands require the managed runtime.
This no-argument command is the legacy foreground gateway, not the managed runtime.
For phone access, prefer the explicit managed HTTPS path above. Do not run both gateway
owners together or expose loopback HTTP through Funnel.

## Stop, restart and reconnect

From the companion root, rebuild and restart the running managed gateway with:

```sh
npm run restart
```

Feature implementation includes the required bounded managed gateway restart; agents do
not need a second permission prompt for that operation. Save unsent browser drafts before
refreshing the browser after readiness. The command
accepts no arguments. It builds before shutdown and reuses the running gateway's exact
origin, port, runtime and authentication directory. Pi sessions remain running. Build
failure leaves the gateway alone; unconfirmed cleanup prevents replacement startup.
On macOS, the launcher uses the native Tailscale app CLI when ordinary PATH lacks it
or resolves the documented non-exec shim; explicit executables and exclusive PATHs
remain unchanged. It does not modify global PATH or settings.

The command requires a ready managed gateway with the updated management interface.
An older running gateway lacks the authentication-directory field and is refused with
`runtime-not-ready` before shutdown. For that first upgrade only, use the existing
managed stop and start commands with the same origin/port/runtime/auth environment.
Stopped or unmanaged gateways require explicit startup; restart does not guess a host.

- From the companion root, stop the managed runtime with `npm start -- stop`.
  It stops only its gateway/owned foreground Serve and verifies cleanup. A refusal or
  `cleanup-unconfirmed` is not proof that shutdown succeeded. Pi sessions stay running.
- For manual foreground startup, use Ctrl-C in the known gateway/Serve terminals.
- Remembered devices reconnect without a new code after a gateway restart, within their
  fixed 30-day lifetime and with the same origin/runtime/auth directory. Temporary,
  revoked or expired access requires a fresh code. Existing long-secret cookies do not
  migrate; pair once with a short code after updating the gateway.
- Browser refresh restores the session identified by the URL fragment after authentication.
  It does not retain drafts or acquire control. Lock/unlock reconnect does not automatically
  resend input; uncertain originals require deliberate retry.
- For this bridge update on Pi 1.0.1, save terminal drafts and run `/reload` in each
  idle owning terminal, then restart the known gateway when safe. This retains each native
  session. Initial package installation still requires a full Pi restart. Refreshing the
  browser alone does not replace already-loaded bridge code.
- Uploaded user images need not have native terminal thumbnails. Missing thumbnails
  alone do not imply lost model delivery; tool-returned images use a separate viewing path.

### iPhone reconnect check

After rebuilding and restarting the known gateway with the existing origin/port:

1. Keep Tailscale connected on the Mac and iPhone. Open the existing HTTPS URL in Safari.
2. Run the managed `pair` command above, enter its code and leave Remember checked.
3. Select a session, refresh, then lock/unlock the phone. Access and selection should
   recover without another code; reconnection must not send input or acquire control.
4. Stop and start the managed gateway using the same configuration. Refresh Safari;
   remembered access should still work. Leave Pi sessions running during this check.
5. Choose Forget this device and wait for confirmation. Refresh should require a fresh
   code. Optional temporary-access check: pair with Remember unchecked, restart the
   gateway, and confirm that another code is required.

For layout recovery, use the same Safari or home-screen app surface you normally use.
Leave an unsent draft, repeatedly open/dismiss the keyboard, switch away and return,
and rotate portrait → landscape → portrait. The header and composer must return onscreen;
the draft must remain unchanged and no input may be sent. Repeat with the keyboard open
when switching away or rotating. Do not send the test draft.

These steps are an owner check, not a claim of completed iPhone or soft-keyboard testing.

### Refresh these screenshots

After the [development setup](#install-and-build-from-the-checkout), run from the repository root:

```sh
# Once, if the project's Chromium binary is not installed:
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright npx playwright install chromium

# Rebuild the current UI and regenerate all three images:
npm run screenshots
```

[`scripts/screenshots.mjs`](../scripts/screenshots.mjs) serves the built UI on a temporary
loopback port and uses Playwright with isolated sample API responses. It does not connect
to the running gateway, read private sessions, call a model, or change browser access.
It closes its browser and server after capture. The command overwrites only the three
images in `docs/screenshots/`; review the images and captions together before committing.
Update the sample scenario in the script when the illustrated journey changes.
