# C4-C1 busy-control disposition

## Verdict and owner decision

Browser Steer/Follow-up is deferred for the first phone test. The owner approved
continuing with explicit Stop, supported questions, background-work checks and then
separately approved Tailscale/iPhone testing. C4-A/B idle input remains accepted.
This deferral is not a completed busy-control implementation or a claim that Pi cannot
queue messages. Terminal busy controls remain available.

## Checked source evidence

Parent and read-only oracle inspected installed Pi 0.99.2. Package-relative evidence:

- `dist/core/extensions/types.d.ts:1222–1229`: ordinary extension
  `sendUserMessage(content, { deliverAs })` returns void.
- `dist/core/agent-session.js:1786–1813`: exported session send awaits prompt.
- `dist/core/agent-session.js:1455–1499`: prompt awaits input handlers before choosing
  streaming delivery or a new idle run.
- `dist/core/agent-session.js:2650–2657`: the extension wrapper discards that Promise.
- Public lifecycle events have no native request/run ID. Input handlers can delay,
  transform or handle input; a pre-model hook is not a completion acknowledgement.

A handler can remain unresolved while the current parent reports settled and idle.
Releasing a companion busy-attempt reservation at that point would admit another
attempt before the first completes preprocessing. Content matching, timeouts and
aggregate pending state do not establish the missing correlation.

The exported SDK's awaited send is not available to this ordinary live bridge.
A replaced-session callback is not authority to reopen or replace the terminal owner.
A generation-retained reservation avoids ordinary settled-release but permits only
one new busy attempt and does not prove that native continuations stop on replacement.
Neither workaround nor a Pi core change is approved.

These are source findings, not an executed delayed-input race or native busy smoke.
The oracle proposed a deterministic two-fixed-response, zero-read delayed-handler
race; it was not executed and is not required to implement deferred controls.

## Next independent slice

C4-C2 implements explicit Stop through public `ctx.abort(): void`. Record the request
before invoking the public method, deduplicate it and show Stopping until a later
supported parent-settled observation with current idle/no-pending evidence. Parent
settlement is an observation, not proof the abort caused it, every message was cancelled,
or every background job finished. Browser departure, switching and gateway restart
must not invoke abort or clear native queues. No private Promise, queue or run access.

Stop remains incomplete until focused real-entry-point validation and parent acceptance.
