---
id: 01M04VPX16J7DTGA1QE2EX7VFB
type: feature
title: Push triggering rules — what earns a notification
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
---
## What to build

The phone buzzing when a card you actually need appears — the rules that decide which listings
earn an instant notification, and what the notification says.

The transport is already built and proved by *Push transport and subscription*. This ticket is
the judgement layer on top of it.

**Content must be self-sufficient.** A tap cannot resolve off the tailnet, so the notification
itself carries enough to decide without opening anything: card, set, language, finish, price
with currency, graded or ungraded, and format.

A listing pushes when it matched with sufficient confidence, the variant — or the card, at card
grain — is **not owned**, and it is not a lot, proxy or custom art. **Priority is the only
instant trigger; there is no price gate.**

## Acceptance criteria

- [ ] Push fires only when unowned, confident, and not a lot or proxy; card-grain owns-none qualifies
- [ ] Instant push only for priority at or above the configured level
- [ ] Notification carries the full go/no-go detail; **no condition grade, no image, no action buttons**
- [ ] Listing detail route resolves on a cold load
- [ ] A listing that is already owned, low priority, or a lot produces no push — asserted, not assumed
- [ ] **Demo: a high-priority card you need is listed and the phone buzzes**
