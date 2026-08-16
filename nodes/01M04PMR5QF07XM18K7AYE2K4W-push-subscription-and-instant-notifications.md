---
id: 01M04PMR5QF07XM18K7AYE2K4W
type: feature
title: Push subscription and instant notifications
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
---
## What to build

The phone buzzing when a card you need appears.

**Declarative Web Push** is the transport, with a classic service-worker handler for iOS
16.4–18.3. The subscription records which it supports; the server sends one shape, never
both. Declarative is **exempt from the silent-push penalty**, which is the strongest
reliability decision available on this platform.

**The silent-push rule is load-bearing and cannot be tested in development.** The worker
calls `showNotification()` **unconditionally, from the encrypted payload, inside
`waitUntil()` — never after a fetch to the origin.** Each push arms its own 30-second timer;
failures accumulate on a counter that never decays; the third revokes every subscription for
the origin. WebKit suppresses enforcement whenever an inspector is attached, so this cannot
be observed in dev by design.

**Content must be self-sufficient.** A tap cannot resolve off the tailnet, so the
notification itself carries enough to decide: card, set, language, finish, price with
currency, graded or ungraded, and format.

A listing pushes when it matched with sufficient confidence, the variant — or the card, at
card grain — is **not owned**, and it is not a lot, proxy or custom art. **Priority is the
only instant trigger; there is no price gate.**

## Acceptance criteria

- [ ] VAPID keypair generated once, stored in the environment file, never rotated casually
- [ ] Soft-ask precedes the system prompt; permission requested only from a user gesture
- [ ] Standalone display mode **and** Push API presence both checked at runtime
- [ ] Subscription records its transport; server sends the matching shape only
- [ ] **Worker calls `showNotification()` unconditionally from the payload, never after a fetch** — enforced by review and by a test on the handler's shape
- [ ] Push fires only when unowned, confident, and not a lot or proxy; card-grain owns-none qualifies
- [ ] Instant push only for priority at or above the configured level
- [ ] Payload under ~3.5 KB; positive TTL; `navigate` target same-origin and inside manifest scope
- [ ] Notification carries the full go/no-go detail; **no condition grade, no image, no action buttons**
- [ ] Listing detail route resolves on a cold load
- [ ] Permanent, gesture-gated re-enable button
- [ ] Server-side echo log records every push, its size and the endpoint response
- [ ] **Demo: a high-priority card you need is listed and the phone buzzes**
