---
id: 01M04PMR5QF07XM18K7AYE2K4W
type: feature
title: Push transport and subscription
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
  - to: 01M04VPX16J7DTGA1QE2EX7VFB
    type: blocks
meta:
  ticket: build
  claimed: push-agent
---
## What to build

The phone can receive a push at all — proved end to end, before anything has an opinion about
*which* cards deserve one.

Everything here is independent of eBay and of the matcher. It is split out from the original
combined ticket so the platform risk can be retired early rather than waiting behind an
external account review.

**Declarative Web Push** is the transport, with a classic service-worker handler for iOS
16.4–18.3. The subscription records which it supports; the server sends one shape, never both.
Declarative is **exempt from the silent-push penalty**, which is the strongest reliability
decision available on this platform.

**The silent-push rule is load-bearing and cannot be tested in development.** The worker calls
`showNotification()` **unconditionally, from the encrypted payload, inside `waitUntil()` — never
after a fetch to the origin.** Each push arms its own 30-second timer; failures accumulate on a
counter that never decays; the third revokes **every subscription for the origin**. WebKit
suppresses enforcement whenever an inspector is attached, so this cannot be observed in dev by
design — which is exactly why it must be got right by construction and guarded by a test on the
handler's shape.

The demo here is a test push triggered by hand from the server. What earns a real notification
is the next ticket.

## Acceptance criteria

- [ ] VAPID keypair generated once, stored in the environment file, never rotated casually
- [ ] Soft-ask precedes the system prompt; permission requested only from a user gesture
- [ ] Standalone display mode **and** Push API presence both checked at runtime
- [ ] Subscription records its transport; server sends the matching shape only
- [ ] **Worker calls `showNotification()` unconditionally from the payload, inside `waitUntil()`, never after a fetch** — enforced by review and by a test on the handler's shape
- [ ] Payload under ~3.5 KB; positive TTL; `navigate` target same-origin and inside manifest scope
- [ ] Permanent, gesture-gated re-enable button
- [ ] Server-side echo log records every push, its size and the endpoint response
- [ ] A scheduled job that sends a push loads the environment file explicitly — cron does not inherit systemd's `EnvironmentFile`, and `VAPID_PRIVATE_KEY` is exactly the secret that fails silently
- [ ] **Demo: trigger a test push from the server by hand; the phone buzzes and the tap opens the app**
