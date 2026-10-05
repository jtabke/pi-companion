# Pi Companion Agent Guide

Deliver small, complete changes with few concepts and maintenance obligations. Use [README](README.md) for behavior/setup, [architecture](docs/architecture.md) for ownership, and [extension display](docs/extension-display.md) only for publisher work.

## Scope and implementation

- Trace the real entry point and owner; check existing behavior/configuration before adding a mechanism. Define one observable outcome, a closed file envelope, and proportional validation. Reproduce bugs when practical.
- Change the existing owner. New abstractions, dependencies, options, persisted fields, compatibility paths, or processes need a demonstrated requirement in callers or focused evidence. Extract only for a stable concept, real duplication, or owned policy; do not split cohesive code to reduce line count.
- Use strict TypeScript, direct control flow, existing interfaces, shared UI components and CSS tokens. Avoid `any`, speculative flexibility, and test-only production hooks. Include accessible labels, keyboard/focus, touch targets, and applicable pending/error states.
- Use one writer per checkout across all sessions/children; independent writers need isolated worktrees from committed state. Preserve unrelated changes. Delegate only when isolation, specialist judgment, or independent review earns its cost.
- Track unfinished work in issues and completed work in commits; do not recreate plan/history files. Escalate unapproved product, architecture, dependency, persistence, release, or safety decisions. Commit authorized checkpoints after checks; publishing/deployment require their own authority.

## Runtime and security boundaries

- `src/extension/` owns live Pi integration/native dispatch; `src/gateway/` owns browser authentication, routing, control, and media; `src/shared/` owns browser-safe contracts; `web/src/` owns browser UI.
- Pi owns agents, settings, tools, and history. Never duplicate sessions/transcripts or bundle another Pi runtime.
- Preserve authentication, exact-origin/CSRF checks, session identity, control ownership, and input admission. Reconnect must not send input or acquire control. Never silently resend uncertain input.
- Keep credentials out of URLs, logs, and browser storage. Persist only approved data through its existing owner. Test with isolated fixtures.

## Managed runtime updates

A feature implementation request authorizes its required local build and bounded restart of the known Companion runtime. Do not ask again for that restart. Follow [the managed lifecycle](docs/setup.md#stop-restart-and-reconnect): preserve exact origin, port, runtime/auth directory and remembered access; identify owned gateway/Serve processes; verify readiness after replacement. A failed build leaves the running gateway alone. This authority excludes unrelated Serve routes, personal Pi settings/provider state, and Pi installation/upgrades.

Gateway restart neither stops Pi terminals nor reloads their bridge. Bridge updates require a supported session-preserving restart at an idle boundary, retaining the same native session. Never kill a busy terminal or inject model input to force restart. If tools cannot perform it, report the exact terminal-owner action remaining; do not claim bridge changes are live after only a gateway restart.

Verify changed behavior through running Companion after an applicable restart, preferably read-only. Do not send agent input or call paid providers merely to verify UI. Fixtures do not prove live-Pi or physical-phone behavior; phone checks remain owner-operated unless a device is available. Documentation edits need no restart. Start only needed processes, retain identity, avoid duplicates, and clean up only owned processes/data.

## Tests and final validation

A test must protect observable behavior or an independent contract, reject a specific regression, and add a distinct failure beyond existing coverage. Extend the primary owner's case table where useful; retain other layers for distinct HTTP authorization, recovery, or dispatch risks. Use independent expected values, negative cases reaching the intended guard, small deterministic fixtures, and bounded condition waits. Avoid self-proving mocks, copied implementation inventories, broad fixture families, and unrelated test audits/deletions.

- Iterate with affected files/cases. Standalone `npm test` and `npm run test:browser` build first because fixtures use compiled code; preserve this contract and use file/name filters.
- Bounded backend changes use `npm run typecheck` and affected tests. Browser behavior/contracts need relevant cases and engine filters, not the full browser suite by default.
- Use `npm run check` for an approved release/integration gate or changes spanning independent contracts. It includes typechecking, build, unit/process and browser suites. Run it once per stable candidate; do not separately repeat its constituent suites.
- Docs-only changes need scoped formatting, links, and command checks, not application tests/builds. Copy affecting dimensions needs wrapping/overflow evidence.
- For mobile UI, define the journey and layout criteria first. Review the complete screen's content width, permanent chrome, keyboard and touch behavior. State claims still requiring a real phone.
- Bound checks by observed runtime. Before checks expected to exceed two minutes, explain the broad selection and known runtime. Narrow selection before weakening timeouts/assertions or parallelizing shared fixtures. Inspect timeout diagnostics before changing approach.
- Reuse passing evidence while covered code, tests, configuration and relevant environment remain unchanged. After fixes, rerun affected checks. Self-review suffices for routine work; one independent stable-diff review covers auth, command authority, persistence/security, or broad changes. Re-review only materially invalidated evidence.

Report files, behavior, exact checks/results, untested claims, concrete risks, and commit/deployment state. Keep logs/screenshots outside the repo and do not claim phone or compatibility evidence beyond what was observed.
