# C4-B — one local image and idle native feedback

## Verdict: completed locally, independently reviewed and parent accepted

The existing selected owner and explicit browser controller can send optional authored
text plus **one still PNG/JPEG/WebP** through the production gateway → private UDS →
generation-owned bridge → passed public `pi.sendUserMessage` image/text blocks.
Text-only input still uses the unchanged `/api/text` route. Terminal input remains usable.
Public send returns **void**: **Dispatched; outcome unconfirmed** is not a native
acceptance, persistence, successful model receipt, or per-request acknowledgement.

Checked environment: **Pi 0.99.2, Node 26.5.0, macOS arm64**, Chromium and desktop
WebKit. No iPhone/Tailscale/remote, broader platform/version, busy controls,
questionnaire, subagent, global installation/service or external/paid model claim.

## Setup and explicit operation

Use [C2 setup](c2-observer.md) and [C4-A host type links/control](c4-text-input.md).
The root lock now selects **sharp 0.35.5**. The approved installation was
`npm install --save-exact --ignore-scripts sharp@0.35.5`; no install hook/build was run.
After dependency installation, restore only the documented executable-derived,
name/version-checked read-only host development links, then typecheck/build. No second
Pi runtime is bundled. npm's three-day release-age policy remains unchanged.

1. Pair and select the actual terminal owner. Claim/take over browser control explicitly.
2. Use **One image for selected Pi (local picker)**. Selection is **local only**: preview,
   remove or replace without upload. Text is optional when an image is attached.
3. **Send** alone transmits the authored envelope. Unsupported formats, mismatch,
   animation/multipage, corrupt/truncated images and size breaches reject visibly.
   HEIC, SVG, GIF, audio/video/PDF are not supported. A filename is not validation.
4. On response loss, preserve the original immutable text/file/MIME/ID. Only deliberate
   **Retry same outstanding input** retries it; editing the current draft cannot mutate
   the outstanding request. Pairing, switching, reconnect, claim and restart never send.
5. Restart requires new pairing and deliberate control. Same-generation explicit retry
   can recover the surviving bridge receipt without another public invocation. Native
   generation loss remains unresolved; reload discards volatile browser state, not proof
   of non-delivery. Inspect Pi in the terminal rather than guessing from content.

The public current model must support image input. A present, successfully returning
public `pi.getSettings()` callback supplies an optional merged settings snapshot, not
filled defaults: omitted `images` or `images.blockImages` uses Pi 0.99.2's documented
**false** default, as does explicit false. Explicit true blocks images. Unavailable or
throwing getters, invalid snapshot/images object shapes and non-boolean block fields
remain unknown and fail closed. Missing or unsupported models also reject new attempts
with specific reasons; no production settings reads/writes or Pi runtime imports. A recorded receipt is recovered without a new
policy check/dispatch and is never upgraded. Public native send retains Pi's own
`autoResize`/per-model processing; the gateway only normalizes and never resizes to
bypass host settings. A too-large normalized image rejects rather than silently resizing.

## Bounds and complexity receipt

- **Existing drafts/operation:** <=32 volatile generation drafts, <=16,000 authored text
  characters each, one File per draft. Unique retained source files, including the one
  outstanding original, stay <=16,000,000 bytes. Only oldest inactive attachments are
  removed to free image budget, with explicit notice and retained text; the existing
  32-draft overflow notice/eviction remains. Outstanding source is not evicted or copied
  into every draft. One current object URL is revoked on replacement/removal/switch,
  pairing view departure and unmount. CSP adds only `blob:` to same-origin `img-src`;
  no data/remote images, raw markdown or browser persistent storage.
- **Fixed public image POST:** `/api/image`, query-free, exact JSON body with canonical
  original source base64, declared supported MIME, exact text, instance/generation/ID
  and private lease. Body <=5,500,000 bytes using Fastify's existing parser, limits and
  schemas, with a pre-validation type check preventing authored-field coercion. Existing
  cookie/Host/exact Origin/`x-c2-csrf: input` hooks run before body work. A single global
  image operation reserves **before body collection/parsing**; contention returns 429,
  no Promise queue. Body collection has a five-second departure timer. The existing
  per-instance `control.enter` is held before decode and until all work settles; claim,
  takeover, release and text cannot overlap that owner's decode. Other owners' accepted
  text and observation remain usable. No controller file change or second lease registry.
- **Gateway decoder (`upload.ts`):** source and normalized output <=4,000,000 bytes;
  input/output <=20,000,000 pixels. Sharp `failOn: warning`, input pixel cap and page
  inspection plus full decode/re-encoding validate PNG/JPEG/WebP. Narrow source container
  checks reject PNG checksum/truncation/APNG, JPEG MPO/concatenation/truncation (libvips
  otherwise silently reads only the first JPEG), and invalid WebP RIFF framing. Unsupported
  container signatures never reach native inspection. EXIF orientation is applied;
  same-format re-encoding strips EXIF/XMP/ICC/private profiles. One admitted native
  decoder, `sharp.concurrency(1)`, `sharp.cache(false)`; no files/temp store/upload IDs.
- **Deadline/departure:** native `.timeout({seconds:3})` is cooperative libvips output
  evaluation cancellation, not a hard wall-clock deadline. It excludes libuv queue wait;
  metadata inspection has no cancel API. Monotonic elapsed checks discard late results
  even if the system clock changes. Departure,
  cookie/lease expiry, reload/conflict or gateway stop discards before forwarding.
  Browser authority loss/switch/pagehide aborts only its pending image HTTP request;
  it does not cancel a dispatched Pi turn. All started metadata/output promises must
  settle before **both** global and instance admission release, exactly once. No
  `Promise.race` early release or claim that stream destroy cancels native decoding.
  A permanently stalled native job blocks image admission until process exit, rather
  than spawning orphan decodes. Encoded/pixel/admission caps do not guarantee hard
  CPU/RSS/time bounds against hostile input or all codec internals.
- **Fresh gates/private transport:** fresh authenticated reachable/canonical-conflict
  discovery before decode, then again after decode, with cookie/lease/departure/stop
  checks after waits and immediately before fixed forwarding. Private `/image` uses
  existing capability-authenticated UDS, four-connection/time budgets and same-size
  bounded schema/canonical normalized payload. No arbitrary command/path/URL forwarding.
  Native independently checks generation, idle/pending, current model and effective
  image-block policy immediately before public send. Production has no input hook,
  provider, runtime import, AgentSession or transcript writer.
- **Same native ledger, raw identity:** image fingerprint hashes injective
  `JSON.stringify(["image", exactText, declaredMime, gatewayComputedOriginalSHA256])`.
  Text continues hashing `JSON.stringify(exactText)` unchanged; kinds cannot alias.
  The gateway hashes the original **binary** source itself, never a client digest.
  Only trusted capability-authenticated private IPC carries that digest plus normalized
  image; browser schema rejects it. The same generation ledger retains <=256 IDs without
  eviction and small hashes/receipts, not source bytes or another transcript. Re-decoding
  on explicit original retry is safe even if normalized encoder bytes change after
  restart; no first lost response must return processed bytes. Changed metadata-only
  original files still mismatch even when they normalize identically. Changed text/MIME
  or text-versus-image reuse likewise rejects without another invocation.

## Checked evidence

Initial full C4-B checks (before the narrow native-default correction below), all **exit 0**:

```sh
npm run typecheck
npm run build
npm test
npm run test:browser
python3 -B tests/real-pi.py --image
python3 -B tests/real-pi.py --input
npm run test:pi
npm audit
python3 -B -c 'from pathlib import Path; p=Path("tests/real-pi.py"); compile(p.read_text(),str(p),"exec"); print("Python syntax passed")'
```

- **29 unit/process tests / 3 files passed**, retaining all 20 accepted tests. New
  decoder tests cover all three formats, orientation/private metadata, mismatches,
  malformed/corrupt/truncated/animated/MPO/concatenated/multipage rejection, source and
  input pixel edges, and deterministic output byte/pixel cap tests. Output boundary
  tests stub a settled encoder result; normal format/decode tests use the real binary.
- Production gateway/UDS tests cover auth/Host/Origin/CSRF/query (including real TCP bare
  `?`), exact schema/type/size before decode, unfinished/disconnected/timed-out body slot,
  original restart retry and different original EXIF bytes normalizing alike, changed
  encoder bytes deduplicating, text/image kind separation, native unsupported/blocked/
  unknown policy and unchanged text. Deferred real metadata/output wrappers prove
  retention while late/departed/stop work remains unresolved, then release after actual
  settlement with zero forwarding on deadline/lease/auth expiry, reload, conflict,
  client departure and stop. Takeover during owned decode gets 429, not a queued revoke;
  expiry then invalidates the held lease. Other owner's text passes during a held decode.
- **14 Playwright tests passed**, Chromium/WebKit at 320/390px, preserving accepted
  selection/rendering/security/control races. Picker preview/removal/replacement and
  generation drafts, object URL revocation, image-only send, no automatic actions,
  original same-ID source/MIME/text retry despite draft editing, actual gateway restart
  with the same page's volatile outstanding request, deliberate new pairing/claim, and
  authority/storage privacy passed. Desktop WebKit is not iPhone Safari.
- **Opt-in real `--image`: completed**, one actual normal Pi TUI owner, one native user
  input with one uploaded image, two network-free fixed responses, one genuine built-in
  read. Browser uses production gateway/UDS/public send. In this isolated fixture only,
  image autoResize is disabled; the latest correction smoke omits blockImages and uses
  Pi's native false default (the initial smoke used explicit false). Normalized submitted
  PNG equals public input-event image, provider user image, native active-branch user
  image and authenticated browser native-user media. The independent tool read remains
  byte-matching too. Lost response, explicit original retry and gateway restart cause
  zero extra native inputs. Owning drained TUI shows exact native user tag, tool filename
  and fixed final text; terminal tagged input survives gateway departure. These hook,
  provider and branch checks are fixture pipeline/content proof, not a native receipt.
- Existing **`--input`** and prior **two-owner `test:pi`** completed unchanged: one/two
  actual terminal owners; all cleanup flags true, Pi exits 0, `cleanupErrors: []`.
- **npm audit: zero vulnerabilities.** Sharp and Darwin binaries have no install
  lifecycle scripts; no new native build/hook ran. A separate bounded timeout experiment
  rejected cooperatively after ~1.96s for a one-second progress budget and counters were
  zero after promise settlement, demonstrating why this is not a hard elapsed bound.
- Controlled native image screenshot `test-results/real-pi-image.png` was visually
  inspected: 390px connected owner, honest dispatch status, empty cleared picker/draft,
  native user image plus separate read result and final response, no horizontal overflow.
  It captures only the controlled page, not desktop or credentials. Root has no Git
  metadata; the separate integration staged diff is empty. No owned test processes remain.

The controlled source is 240×160 PNG, 5,050 bytes, SHA-256
`ce244c6160de7bc07812f54626d5cb5200729036a28274e5753d707b2af3beee`.
No installed host files, global settings, other dependencies/configuration, runtime/CLI/
flock/media/snapshot/old probes/integrations or parent-owned PLAN/SPEC/STACK/checkpoint
were edited by the implementation/fix writers. Parent updated governing/status docs
only after review and its independent validation; later slices remain deferred.

## Native-default policy correction — independently reviewed

Parent inspection found that the initial explicit-false requirement rejected ordinary
Pi 0.99.2 settings omission. Public settings documentation defines blockImages default
false, while the public `getSettings()` snapshot preserves optional fields instead of
filling defaults. The public native getter uses `images?.blockImages ?? false`.
The parent-approved clarification therefore permits omitted fields from a valid,
successfully returned snapshot, without requiring any owner settings change.

The production correction is confined to `extension/input.ts`: check the returned
snapshot/images object containers and the owned blockImages field, then apply the
known false default only for omission. Explicit true remains blocked; unavailable or
throwing callback, invalid containers or malformed non-boolean block remain unknown.
No general settings validator/defaults framework, settings-file access, runtime import,
ledger ordering, fingerprint, recorded rejection recovery or receipt semantics changed.

Actual authenticated bridge/UDS regression covers `{}`, `{images:{autoResize:false}}`,
empty images, explicit false and optional undefined block, each invoking public send
once and deduplicating its retry. Explicit true gives zero new calls. Missing/throwing
getters and malformed snapshot/images/block values remain fail-closed. Existing missing
model, unsupported model, recorded blocked-receipt recovery, text-only and native ledger
checks remain intact. The new default regression failed on the old policy:
**omitted images: expected dispatched, received rejected** (exit 1).

Repair validation (all green commands **exit 0**):

```sh
# Red on the old policy: exit 1; green after correction.
npx --no-install vitest run tests/observer.test.ts -t 'omitted native blockImages defaults'
# Assigned focused native/image/ledger checks: 7 passed, 14 skipped.
npx --no-install vitest run tests/observer.test.ts -t 'C4-B|lone-surrogate|deduplicates native IDs'
npm run typecheck
npm run build
npm test
python3 -B tests/real-pi.py --image
python3 -B -c 'from pathlib import Path; p=Path("tests/real-pi.py"); compile(p.read_text(),str(p),"exec"); print("Python syntax passed")'
```

Full unit/process suite: **30 tests / 3 files passed**, including unchanged text and
ledger regressions. The isolated real image fixture now configures only
`images:{autoResize:false}` and asserts/reports **blockImagesSettingOmitted:true**;
explicit false no longer masks native defaults. The real existing-owner browser image
path completes with **one native user/image/input, two fixed local responses and one
genuine native read**. Normalized public input/provider/branch/browser media relation,
original lost-response/restart retry without an extra turn, owning TUI text and terminal
survival remain proved. Pi exits 0; all cleanup flags true, `cleanupErrors: []`.

Only this narrow four-file correction was made: native input, owning socket tests,
existing real-Pi harness and this document. No dependency/install, decoder/gateway/
protocol/React/repository-config/integration/global/governing-document changes. Broad browser,
prior C3 and native text smokes were intentionally not repeated for this correction;
the parent owns final aggregate runs. Existing cooperative decoder/void receipt and
platform/phone limits remain unchanged.

## Parent acceptance

Fresh initial review cleared the approved owning path. Parent separately found that
its explicit-false instruction contradicted documented native defaults, and required
the narrow correction above. Targeted retained review found the correction complete
with no new issue. Parent inspected native input/settings, bridge/protocol/peer,
gateway early admission/fresh gates, decoder and browser draft/authority/source retry.

After correction, parent independently reran all commands in the checked-evidence
block: strict types/build, **30 unit/process tests**, **14 Chromium/WebKit tests**,
real `--image` with **blockImagesSettingOmitted:true**, unchanged `--input`, prior
two-owner `test:pi`, **audit zero**, Python syntax and empty integration staged diff.
All exited 0. Native image/text/two-owner cleanup flags passed with no cleanup errors;
parent found no owned test/gateway/Pi processes remaining and visually inspected the
controlled native image page. C4-B is accepted locally. C4-C busy controls are next;
no iPhone/Tailscale or native acceptance/persistence claim is added.
