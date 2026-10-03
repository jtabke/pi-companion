# Pi Companion Agent Guide

Purpose: deliver small, safe changes with little code and few maintenance obligations.
Prefer fewer concepts and moving parts, not the lowest line count at any cost.

## Scope and ownership

- Read the approved request or issue and the relevant existing code before editing. Use `README.md` for current behavior, architecture, technology boundaries and setup; use `docs/extension-display.md` for its publisher contract. Approved task-specific restrictions still apply.
- Track unfinished work in issues and completed changes in Git commits. Do not recreate plan or checkpoint-history files.
- Trace the real entry point and owning boundary. Check whether existing behavior or configuration already meets the request. Reproduce a reported bug when practical.
- Define one observable outcome, a closed file envelope, and the smallest useful validation. Deliver thin end-to-end slices; do not build speculative infrastructure first.
- Use one active writer per checkout. Keep unrelated user changes intact. Delegate only when isolated context, specialist judgment, or independent review adds value; handle small tasks directly.
- Stop and ask before an unapproved product, architecture, dependency, persistence, release, or safety decision. Do not stage, commit, publish, or deploy without authorization.

## Small, maintainable code

- Prefer changing the existing owner, using existing configuration, or deleting obsolete behavior over adding a parallel mechanism.
- Before adding an abstraction, dependency, option, persisted field, compatibility path, or background process, identify the required outcome that fails without it and verify that claim in code, callers, or a focused test.
- Keep one owner for each policy. Fix a bug at the narrowest shared boundary that preserves caller contracts; do not stack local patches around it.
- Use direct control flow, clear domain names, strict TypeScript, and existing interfaces. Avoid `any`, hidden coupling, speculative flexibility, and generic frameworks for one use case.
- Extract code only to name a stable concept, remove actual duplication, or isolate an owned policy. Do not add wrappers or split cohesive logic just to shorten functions.
- Optimize for fewer concepts, states, branches, and maintenance obligations. Do not compress readable code, remove safety checks, or weaken tests to meet a line-count target.
- Reuse existing UI components and CSS tokens. Include labels, keyboard operation, visible focus, usable touch targets, and relevant pending/error states in the implementation.
- Before handoff, remove unnecessary additions introduced by the change. Keep scope closed; do not add adjacent improvements or optional-work lists.

## Runtime boundaries and safety

- `src/extension/` owns live Pi integration and native command dispatch; `src/gateway/` owns browser authentication, routing, control, and media; `src/shared/` owns browser-safe contracts; `web/src/` owns the browser UI.
- Pi owns the agent, settings, tools, and conversation history. Do not create another agent session, duplicate transcripts, or bundle a second Pi runtime.
- Preserve authentication, exact-origin/CSRF checks, session identity, control ownership, and input admission. Reconnection must not send input or acquire control automatically. Never silently resend an uncertain input.
- Keep credentials out of URLs, logs, and browser storage. Persist only explicitly approved data through its existing owner.
- Use isolated local fixtures for tests. Do not modify personal Pi settings, installed extensions, live gateways, Tailscale/Serve, or provider state without approval. Fixture success is not proof of real-phone or live-Pi behavior.
- Start only processes needed for the task. Retain their identity, avoid duplicates, and clean up only processes and temporary data the task owns.

## Tests that earn their cost

Before adding a test, answer:

1. What observable behavior or independent contract does it protect?
2. What specific broken behavior must make it fail?
3. Which existing test owns this contract, and what distinct failure justifies another test?

Prefer one primary test owner per contract. Extend an existing case table when appropriate. Keep tests at another layer only for distinct failures, such as HTTP authorization, browser recovery, or native dispatch mapping. Use the cheapest boundary that proves the required behavior; not every case needs a browser.

- Assert outcomes with independent expected values. Avoid assertion-free coverage probes, self-comparisons, mocks that implement the behavior under test, and duplicated implementation inventories.
- Negative tests must reach the intended guard. Keep fixtures small and deterministic; use bounded condition waits rather than arbitrary sleeps.
- Test through existing production boundaries. Do not add production exports, flags, wrappers, or injection hooks solely for tests.
- Add regression coverage proportional to changed behavior. Do not build broad fixture families or audit/delete unrelated tests without approval.

## Validation and review

- During iteration, run the changed test file or smallest relevant selection. Do not turn each edit into a release gate.
- Standalone `npm test` and `npm run test:browser` build first because fixtures use compiled code. Preserve that contract. Use their file/name filters for focused checks.
- Select final checks from the changed contracts before running them. For a behavior-preserving change within one backend owner, prefer typechecking and that owner's test file or relevant cases. Run browser cases when browser behavior or a browser-only contract is affected; use file/name and engine filters. Do not make the full browser suite a default gate for every refactor.
- Use `npm run check` when an approved release/integration gate requires it or the change affects enough independent contracts to need the full suite. It includes typechecking, build, unit/process tests, and browser tests. Run required aggregates once; do not run their suites separately and then repeat them through `check` on the same unchanged candidate.
- Before a check expected to take more than two minutes, state why the broad selection is necessary and give its observed runtime. Prefer narrowing the selection over lowering timeouts, weakening assertions, or adding parallel workers to shared-state fixtures.
- Reuse passing evidence only while the covered code, tests, configuration, and relevant environment remain unchanged. After a fix, rerun affected checks, not every successful suite. Run broader checks again only when the change invalidates their evidence.
- Do not run application tests or builds for documentation-only changes. Check affected links and command descriptions instead. UI copy that changes layout needs focused wrapping/overflow review.
- Bound checks using observed runtimes. A full browser suite can take several minutes; do not copy another project's short timeout. After a timeout, inspect the output and change the approach rather than repeating the same command blindly.
- Self-review is sufficient for routine, bounded, low-risk changes unless the approved plan says otherwise. Use one fresh independent review of the stable diff for authentication, command authority, persistence/security, or broad cross-cutting changes. Reuse a clean review for unchanged work; re-review only material affected changes.
- Fix accepted findings in one writer pass. Do not loop on optional polish or repeat checks merely to improve a report.

## Handoff

Report changed files, behavior, exact checks and results, and concrete residual risks. State what was not tested and whether anything was staged or committed. Keep logs and screenshots outside the repository. Do not claim deployment, phone verification, or compatibility beyond the evidence.
