# Questionnaire source integration

`rpiv-mono/` is an **ignored local nested Git checkout**, not a commit candidate
or submodule. A parent Git entry would record upstream HEAD, not its local
questionnaire changes. Do not delete, reset or overwrite the existing checkout or its
index. The committed restoration material is:

- [questionnaire-v2.11.0.patch](questionnaire-v2.11.0.patch): all **nine modified and
  three new files**, only under `packages/rpiv-ask-user-question`.
- [LICENSE.rpiv-mono](LICENSE.rpiv-mono): upstream MIT license, copyright 2026 juicesharp.

Upstream: **https://github.com/juicesharp/rpiv-mono.git**, tag **v2.11.0**, detached
commit **61904e69e1a50e12585bdf15f0310e633a62ba36**. Package version remains 2.11.0.
The patch preserves the reviewed default-off companion reply seam and its tests/docs;
it does not change the installed/global package. The copied license covers upstream
material; it is not a license choice for Pi Companion.

## Manual restoration

Run only when intentionally restoring a new local source checkout. No bootstrap,
dependency install, global install or settings change is included. Set `COMPANION`
to the companion checkout's absolute path.

**If `integrations/rpiv-mono` already exists, stop before cloning or checkout.** Do not
reset, clean, force-checkout or apply onto a dirty checkout. The owner's current
checkout is already patched; it must be preserved. Inspect existing state separately,
or restore into a new disposable location rather than overwriting it.

For a new checkout only:

```sh
CHECKOUT="$COMPANION/integrations/rpiv-mono"
if [ -e "$CHECKOUT" ] || [ -L "$CHECKOUT" ]; then
  printf '%s\n' 'Refusing to overwrite an existing checkout' >&2
  exit 1
fi
git clone --branch v2.11.0 https://github.com/juicesharp/rpiv-mono.git "$CHECKOUT" || exit 1
git -C "$CHECKOUT" checkout --detach v2.11.0 || exit 1
```

Before applying, require the exact upstream commit and an empty tracked/untracked
status (ignored dependencies are not part of the patch). Stop on any failure:

```sh
test "$(git -C "$CHECKOUT" rev-parse HEAD)" = \
  61904e69e1a50e12585bdf15f0310e633a62ba36 || exit 1
test -z "$(git -C "$CHECKOUT" status --porcelain=v1 --untracked-files=all)" || exit 1
git -C "$CHECKOUT" apply --check "$COMPANION/integrations/questionnaire-v2.11.0.patch" || exit 1
git -C "$CHECKOUT" apply "$COMPANION/integrations/questionnaire-v2.11.0.patch" || exit 1
git -C "$CHECKOUT" status --short
```

Expected status: nine modified files and three untracked files, all in the owning
questionnaire package. Ordinary `git diff` omits the new files; the supplied patch
includes them. Do not apply it twice. In an already-patched checkout,
`git apply --reverse --check` with the same patch can inspect whether the delta is
present **without reversing it**; this is not permission to overwrite unrelated
changes or a substitute for reviewing status. Never run the actual reverse apply on
the owner's checkout.

Preparation verified `git apply --check` and application to a disposable **local
`git archive` of the exact upstream commit**, then compared all 12 reconstructed
files byte-for-byte with the protected local source baseline. No network or live
checkout mutation was used for that verification. Restoring source does not install
its dependencies or prove another Pi/runtime version.

## Public contract

After restoration, the authoritative public API document is
`rpiv-mono/packages/rpiv-ask-user-question/docs/companion-replies.md`, supplied by
the patch. This path intentionally exists only in a restored local checkout; it is
not a committed documentation link. Read that source document for configuration,
versioned events, validation, once-only completion and stale-reply semantics rather
than duplicating the contract here.

Use the source package only with explicit source-loading authorization and opt-in
`companionReplies: true`; default behavior remains off. Global installation or a
questionnaire replacement requires a separate decision. Companion depends on this
public event/reply contract, not private TUI methods. The integration preserves terminal
completion and rejects stale replies; it does not bridge arbitrary custom dialogs.
Source restoration and fixture checks do not prove global installation, another Pi
version, or real-phone questionnaire behavior. See [current limits](../README.md#limitations).
