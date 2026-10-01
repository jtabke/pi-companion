# C5-A: one private HTTPS browser origin

## Configuration and security boundary

The gateway accepts optional `C2_PUBLIC_ORIGIN` (gateway option `publicOrigin`):

```sh
C2_PUBLIC_ORIGIN=https://companion.example.ts.net C2_PORT=4317 npm start
```

The example DNS name is synthetic. Use the actual device's Tailscale DNS name.
Only exactly authored `https://machine.tailnet.ts.net` is allowed: two lowercase
ASCII DNS labels, each 1–63 characters, alphanumeric ends and internal hyphens.
No wildcard, userinfo, explicit port (even `:443`), trailing slash, path, query,
fragment, uppercase/Unicode normalization, IP, localhost or other domain is allowed.
Empty configuration is invalid, not a default. Invalid origins fail before listening
with the CLI's generic startup failure, without printing a URL or pairing secret.

Omit the variable to retain exact `http://127.0.0.1:<C2_PORT>` behavior. Each launch
selects **one** browser origin; HTTPS mode does not also authorize the loopback URL.
The backend still listens on literal `127.0.0.1`. The OS process-lifetime flock,
independently random terminal-only pairing secret and volatile browser sessions are
unchanged. The CLI prints the selected browser URL; no credential is put in that URL.

The server validates exact raw Host on assets, reads, SSE and media. An incoming
Origin, when present, must exactly equal the selected origin. Pairing and every
mutation still require exact Origin plus their existing explicit CSRF marker.
Pairing, cookie/session, controller lease, current generation, fresh native owner,
conflict, departure and bounded admission gates remain unchanged. No CORS or
proxy-based authorization is added: `trustProxy: false` remains. Forwarded,
X-Forwarded, Tailscale identity and application capability headers cannot select
another host/origin, replace pairing or authorize browser requests. Tailscale
connectivity is not application authentication.

HTTPS cookies are Secure, HttpOnly, host-only (no Domain) and SameSite=Strict.
HTTPS responses, including hijacked SSE, use `Strict-Transport-Security:
max-age=31536000`, without includeSubDomains or preload. HTTP mode keeps HSTS
absent and its existing non-Secure cookie. Existing restrictive Helmet headers and
self/blob image CSP remain; no broader content sources or remote image policy.

## Proxy evidence and manual private Serve steps

Read-only source inspection by the parent used installed Tailscale **1.102.4**:
[version-pinned serve.go](https://raw.githubusercontent.com/tailscale/tailscale/v1.102.4/ipn/ipnlocal/serve.go).
Its TCP reverse proxy sets `r.Out.Host = r.In.Host`; `addProxyForwardedHeaders`
adds X-Forwarded-Host and X-Forwarded-Proto=https under TLS. This supports using
a root-path TCP HTTP target without rewriting the browser Host. It is source
evidence, not proof of this machine's live TLS path.

References: [Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)
and [HTTPS certificates](https://tailscale.com/docs/how-to/set-up-https-certificates).
Serve is private to the tailnet subject to its access rules; restrict access to
the owner. Never use Funnel. HTTPS feature consent may be required, and the device
DNS name may be published in Certificate Transparency.

After independent gateway review/validation, the parent operates the approved
manual setup (not run by the implementation worker):

1. Read the device DNS name and existing Serve/Funnel status. Do not overwrite
   another route, reset Serve, enable Funnel, change ACL/DNS/autostart or install
   globally. If native HTTPS feature consent is needed, give its prompt/link to
   the owner; do not silently bypass it.
2. Build with `npm run build`, then launch the gateway using the exact actual
   origin in `C2_PUBLIC_ORIGIN` and the intended `C2_PORT`.
3. In a separate terminal run a foreground, nonpersistent private proxy:
   `tailscale serve --https=443 http://127.0.0.1:4317`. Do not use `--bg`, a UDS
   target or path/Host rewriting. Keep the gateway and Serve terminals running.
4. Give the owner the printed HTTPS URL. Pair with the gateway's terminal secret,
   entered explicitly in the browser, never appended to the URL or shared in logs.
5. Verify actual TLS and iPhone Safari separately: screenshot inspection/enlargement,
   idle image feedback, supported questions/Stop, suspension and reconnect. Closing
   the browser or gateway must leave the existing Pi owners usable. Stop Serve
   with its terminal interrupt and stop the gateway explicitly when finished.

## Checked application evidence and limits

Focused regressions in `tests/observer.test.ts` exercise invalid authored origins,
unchanged loopback policy, HTTPS pairing/cookie/HSTS/CSP, protected reads/media,
every mutation's Origin/CSRF/auth gates, hostile raw Host/Origin with spoofed proxy
and identity headers, and current leased native fixture dispatch/generation rejection.
`tests/process.test.ts` spawns the **compiled production CLI**, reaches its real
loopback HTTP backend with the chosen raw headers, checks the printed URL, pairing,
authentication, SSE/HSTS, invalid-env startup failure, process exit and retained flock
inode/recovery. It does not create certificates or perform a TLS handshake.

Validation commands: `npm run typecheck`, `npm run build`, and
`npx vitest run tests/observer.test.ts tests/process.test.ts` (the owning security
and default process regressions only). Red/green output and copy-based scope evidence
are retained in the managed implementation handoff, not a repository report.

**C5-A application boundary is accepted locally.** Fresh independent review found no
issues. Parent inspected the owning delta and independently passed strict types,
production build and all 51 unit/process tests. Copy-based scope matched all 1,143
protected integration hashes with an empty integration index. The earlier unrelated
browser timeout remains recorded; this checkpoint did not rerun that browser suite.

The owner approved manual private Serve. Parent launched the gateway on literal
loopback in exact HTTPS-origin mode, with its secret printed only in the gateway
Terminal. The foreground Serve command reported that Serve is not enabled on the
tailnet and supplied its native consent page. Parent relayed that page without bypass;
The initial HTTPS request could not connect; that result remains a failed connection,
not a TLS pass. The owner then confirmed native consent. The same foreground Serve
command became active with only the approved root HTTPS proxy and no Funnel.

Parent verified actual certificate-checked HTTPS shell and bundled JavaScript/CSS,
HSTS and restrictive CSP. Live snapshot/SSE without pairing returned 401, including
spoofed identity/forwarded headers. Wrong raw Host and cross-origin requests returned
403. Pairing without Origin returned 403; exact-Origin incorrect-secret pairing returned
401. The working link and terminal-secret pairing instructions were given to the owner.
The secret was not captured. These Mac TLS checks alone do not prove phone behavior.
Certificate Transparency DNS publication was warned. Runtime details and the consent
link stay outside this document.

## Manual recovery and owner phone evidence

Before the phone checks, both manual processes (gateway and foreground Serve) were
found absent; the cause is unknown. They were restarted manually, and parent verified
certificate-checked HTTPS with HTTP 200 before the owner resumed. This outage does
not establish a crash cause or automatic recovery. Keep both terminals open; there
is no autostart. Gateway restart creates a new pairing secret.

The owner then confirmed phone pairing/session use, text/image input, uploaded-image
zoom, genuine native read-tool returned-image zoom, lock/unlock reconnect and refresh
followed by explicit session reselection. **C5's first private phone screenshot/feedback
journey is accepted on this manual owner report.** It is not instrumented mobile
automation. Phone Stop, questionnaire, every picker format and full keyboard/accessibility
behavior are not claimed. A missing native terminal thumbnail for an uploaded user
image does not itself imply lost model delivery; returned tool images are a separate path.

No native Pi/model or accepted background-work retest, global install,
automation-permission change, autostart, ACL or credential capture was performed for
this documentation update.
