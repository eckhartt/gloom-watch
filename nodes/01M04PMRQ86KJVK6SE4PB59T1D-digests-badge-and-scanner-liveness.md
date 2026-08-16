---
id: 01M04PMRQ86KJVK6SE4PB59T1D
type: feature
title: Digests, badge and scanner liveness
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
---
## What to build

The rest of the notification story, and knowing the scanner is alive.

**Two digests a day.** The digest is structural, not politeness: iOS stores exactly one
undelivered push per bundle ID, and the survivor is not guaranteed to be the latest. Five
instant pushes during a tunnel journey become one arrival; a digest survives intact.

**A digest carries no prices.** It may summarise up to twelve hours after observation, and
the six-hour display rule binds on display — a notification is display. It names cards and
counts; the app carries the prices.

**Instant pushes are also listed in the next digest**, so one lost to the single-message
queue resurfaces within twelve hours.

**Silence is ambiguous** — no notifications for three days could mean an empty market or a
dead scanner — and a dead server cannot send its own funeral notice. So the primary liveness
signal is in-app, not a push.

## Acceptance criteria

- [ ] Two digests a day at configurable times, interpreted in the configured timezone
- [ ] Digest summarises rather than enumerates; **carries no prices**
- [ ] Instant pushes appear in the following digest
- [ ] Changing a digest time re-registers the OS-level cron entry
- [ ] Badge counts qualifying listings not yet seen; **seen means rendered in the feed with the app foregrounded**
- [ ] Badge is server-derived from a client acknowledgement, not computed independently on both sides
- [ ] Staleness banner shows last successful scan on every app open, red past the threshold
- [ ] Last successful scan is the **oldest** across enabled marketplaces, not the newest
- [ ] One gap-recovery push when the scanner returns after an outage
- [ ] **Demo: receive a morning digest, and see the staleness banner go red when the scanner is stopped**
