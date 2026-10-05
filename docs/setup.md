# Setup and runtime guide

[Back to Pi Companion](../README.md) · [Usage guide](usage.md)

## Prerequisites

Companion runs from a **development checkout**, not a standalone published installer.

- **Pi:** installed, authenticated and working in your project terminal. Follow
  [Pi's getting-started instructions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#getting-started)
  separately; Companion does not install Pi or configure providers.
- **Node.js/npm:** Node 24 or newer is declared; the tested environment is Node 26.5.0
  and npm 11.17.0. Node 24 runtime behavior is not verified.
- **macOS:** the checked platform. Linux/Windows compatibility is not established.
- **Native build tools:** a compiler for `fs-ext` (Xcode Command Line Tools on macOS).
- **Python 3:** required for declaration setup and native build tooling.
- **Phone access:** Tailscale installed and signed in on both devices, with tailnet
  access restricted to the owner.

Pi 0.99.2 and 1.0.1 have recorded verification. Declaration setup accepts 0.99.2,
1.0.1 and 1.0.2; the native-command runner accepts 1.0.1 and 1.0.2. These allowlists
are not proof of complete compatibility with every accepted version. See
[native probes](../probes/README.md) for each runner's requirements. Clean-machine
setup and current physical-phone behavior are not established by local fixtures.

## Install and build from the checkout

Run in the repository root. Stop on any command failure.

### 1. Install locked dependencies with scripts disabled

```sh
cd /path/to/pi-companion
npm ci --ignore-scripts
```

### 2. Inspect and build the required native dependency

```sh
cat node_modules/fs-ext/package.json node_modules/fs-ext/binding.gyp
```

The required hook is `node-gyp configure build`, targeting local `fs-ext.cc` with
NAN headers. After inspecting it, build only this dependency:

```sh
npm rebuild fs-ext
```

Do not enable arbitrary dependency scripts or override npm release-age policy.

### 3. Link the installed development declarations

After **every `npm ci`**, run:

```sh
npm run setup:types
```

The [script](../scripts/link-pi-declarations.py) links read-only declarations from
the installed Pi and matching pi-ai packages. It refuses unsupported versions,
existing packages and mismatched links without overwriting them. Repeating it is
safe when both links already match. Do not edit installed package files.

### 4. Check and build

```sh
npm run typecheck
npm run build
```

For the full local fixture gate, install Chromium/WebKit under `.cache/playwright`
if needed, then run:

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright npx playwright install chromium webkit
npm run check
```

`check` runs typechecking, unit/process tests and browser tests. Standalone `npm test`
and `npm run test:browser` each build first. Native probes and physical-phone checks
are separate; the fixture gate does not call a model or touch private Serve.

Formatting and analysis commands:

```sh
npm run format:check
npm run format
npm run analyze
```

`format:check` and Fallow's `analyze` report are read-only; `format` writes changes.
Analysis findings are not a clean-findings gate. Contributor policy is in [AGENTS.md](../AGENTS.md).

## Normal Pi startup and one shared private runtime

### 1. Register the bridge once, then restart Pi fully

After building, run from the Companion root:

```sh
pi install "$PWD"
```

This registers the local checkout's TypeScript bridge, not a global npm package or
Pi upgrade. Fully exit and restart existing Pi processes; `/reload` is not the
initial installation transition. Launch `pi` normally in each intended project.
Only terminal UI sessions publish bridges; print, JSON and RPC modes do not.
Keep the checkout/build available. To remove the registration, use
`pi remove /path/to/pi-companion` and fully restart Pi again.

### 2. Start or reuse the private runtime

If migrating from foreground commands, stop only your **known Companion gateway
and Serve commands** with Ctrl-C. Leave Pi alone. Do not kill unknown PIDs, reset
Serve or remove unrelated routes. New managed startup refuses existing Serve
configuration and unmanaged legacy gateways.

Replace the example hostname with your computer's exact Tailscale DNS name:

```sh
npm start -- start --origin https://companion.example.ts.net --port 4317
```

The origin must be exact HTTPS with no port, trailing slash, path or query.
`C2_PUBLIC_ORIGIN`/`C2_PORT` are also accepted; flags take precedence. The command
returns after readiness or reports refusal. A second start reuses only the same
origin/port/runtime. The shared runtime survives closing its launching terminal;
no login service or automatic restart is installed.

Complete Tailscale's native HTTPS consent flow if required. Certificates may publish
the device DNS name in Certificate Transparency. The gateway listens on `127.0.0.1`
behind private Serve; do not enable Funnel. Browser access can control an agent with
your user's permissions, so restrict tailnet access to the owner.

#### If Companion cannot find the Tailscale CLI

Managed commands use `tailscale` from PATH. If the macOS app CLI is missing or your
shell wrapper does not use `exec`, run this in the Companion command terminal:

```sh
export PATH="/Applications/Tailscale.app/Contents/MacOS:$PATH"
```

This changes only that terminal's environment. A non-exec wrapper prevents reliable
shutdown of Companion's owned Serve process.

### 3. Pair and remember your device

```sh
npm start -- status
npm start -- pair
```

Open the reported HTTPS address, enter the six-digit code and tap **Pair this device**.
Then open **Live sessions** and choose a terminal; see [usage](usage.md) for controls.

- Codes are single-use and expire after five minutes. `pair` prints only to an actual
  terminal, not redirected output. Start/status never print credentials.
- Five failed guesses lock a code; exchanges are limited to ten per minute per gateway.
  Issuing another code replaces the old one without resetting attempt limits.
- **Remember this device** retains access across gateway restarts for 30 days from
  pairing, without renewal. Unchecked access lasts eight hours and is lost on restart.
- Use the same hostname and browsing context. Clearing cookies or switching to private
  browsing does not preserve access. Never put codes or cookies in URLs, files or logs.

If overriding `C2_RUNTIME`, use the same value for Pi and every Companion command.
Remembered-device hashes and bounded identity/expiry metadata live in `~/.pi-companion`
(or `C2_AUTH_DIR`), not transcripts or Pi settings. Codes and raw credentials are not
saved. Keep the runtime, auth directory and exact origin unchanged across restarts.
At most eight devices/sessions are allowed, without silent eviction.

Use **Forget this device** in the drawer to revoke access, or use local managed commands:

```sh
npm start -- devices
npm start -- revoke <device-id>
```

Wait for confirmation: an unavailable or lost response does not prove revocation.
Revocation does not cancel native work already dispatched.

## Install on your phone

- **iPhone:** open the HTTPS address in Safari, then **Share → Add to Home Screen**.
- **Other browsers:** use **Install app** or **Add to Home Screen**, when available.
- The drawer also offers **Device access → Install on this device** outside standalone mode.

If the installed app asks for pairing, pair that browsing context explicitly; do not
assume Safari's access transferred. Installation grants no access, takes no control
and sends no input. Removing the icon is not device revocation.

After an online visit installs the service worker, offline launch can show only a
static recovery page—not conversations or media. Only that public page, its stylesheet
and icon are cached; no credentials, app document, API responses or input requests.
Nothing queues or replays when connectivity returns. An uncertain request may already
have reached Pi. Worker updates wait for old windows to close rather than forcing reload.
If offline setup fails, online access remains available.

Actual iPhone installation, standalone cookies, keyboard behavior and VoiceOver
remain owner-operated checks; browser fixtures do not establish these claims.

## Manual local HTTP mode

Without personal registration, load the bridge explicitly:

```sh
cd /path/to/pi-companion
COMPANION="$PWD"
cd /path/to/your-project
pi --extension "$COMPANION/src/extension/bridge.ts"
```

In another terminal, run `npm start` from the Companion root. Keep it open, browse to
**http://127.0.0.1:4317** (not `localhost`) and pair with its printed code. Restart only
this known foreground gateway if the code expires. Managed `pair`, `devices` and
`revoke` commands do not apply to this mode. Do not run both gateway owners together
or expose local HTTP through Funnel; use managed HTTPS for phone access.

## Stop, restart and reconnect

Save unsent browser drafts before refreshing. To rebuild and restart a ready managed gateway:

```sh
npm run restart
```

This accepts no arguments and preserves the exact origin, port, runtime and auth
directory. Build failure leaves the gateway running; unconfirmed cleanup prevents
replacement startup. On macOS, the launcher falls back to the native Tailscale app
CLI for a missing CLI or the documented non-exec shim, without changing global settings.
Explicit executables and exclusive PATHs remain unchanged.

- To stop, use `npm start -- stop`; it stops only the owned gateway/Serve and verifies
  cleanup. Refusal or `cleanup-unconfirmed` is not proof of shutdown. Pi stays running.
- Foreground gateways require Ctrl-C in their known terminals. Stopped or unmanaged
  gateways need explicit startup; restart does not guess a host.
- Older managed gateways without the auth-directory management field are refused with
  `runtime-not-ready` before shutdown. Use managed stop/start with the same environment.
- Bridge changes require native `/reload` in each **idle** owning terminal with its
  draft saved and editor empty. This retains the native session; browser refresh or
  gateway restart alone does not replace loaded bridge code. Initial installation
  requires the full Pi restart described above.
- Remembered devices retain access within their fixed lifetime. Temporary, expired or
  revoked access requires a new code; legacy long-secret cookies require pairing again.
- Refresh restores session selection, not drafts or control. Reconnect never silently
  resends uncertain input. Missing terminal thumbnails for uploaded images alone do
  not imply lost delivery; tool-returned images use a separate viewing path.

### iPhone reconnect check

With Tailscale connected and the same origin/runtime/auth directory:

1. Pair with Remember checked, choose a session, refresh, then lock/unlock the phone.
   Access and selection should recover without input being sent or control acquired.
2. Stop/start the managed gateway and refresh. Remembered access should still work.
3. Forget the device and wait for confirmation; refresh should require pairing.
   With Remember unchecked, a gateway restart should also require pairing.
4. Leave an unsent draft. Open/dismiss the keyboard, switch away and return, and rotate
   portrait → landscape → portrait, including with the keyboard open. The header and
   composer must return onscreen without changing or sending the draft.

Leave Pi running and do not send test input. These are verification steps, not a claim
of completed physical-phone testing.

### Refresh these screenshots

After development setup, run from the repository root:

```sh
# Once, if Chromium is not installed:
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright npx playwright install chromium
npm run screenshots
```

The command rebuilds the UI; the [script](../scripts/screenshots.mjs) captures
sample-only API responses on a temporary loopback server. It does not read live sessions, call a model
or change access. It closes its browser/server and overwrites only the three images
in `docs/screenshots/`. Review images and captions together; change the script's sample
scenario when the illustrated journey changes.
