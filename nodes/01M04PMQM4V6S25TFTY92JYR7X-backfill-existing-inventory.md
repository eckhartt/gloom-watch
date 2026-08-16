---
id: 01M04PMQM4V6S25TFTY92JYR7X
type: feature
title: Backfill existing inventory
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
---
## What to build

The sweep that stops the app launching blind.

The forward cursor keys off `itemStartDate`, which eBay documents as the moment a listing
became available — and **that date is retained across a relist**. So a forward-only scanner
sees nothing that existed before it started. eBay currently carries ~25,000 active Gloom
listings in the US category alone; without this ticket, none of them are ever seen.

**Deep paging is capped at 10,000 items, which is less than the inventory**, so this cannot
simply page to exhaustion. It sweeps **backwards in date windows**, narrowing any window
whose result count approaches the cap, until it reaches the configured horizon.

It is a **job, not a request**: resumable, with a persisted per-marketplace completion
marker. Until a marketplace is marked complete its forward cursor does not run, or the
scanner is armed against a half-swept market.

**It notifies nothing.** It seeds the seen-set so the first forward cycles do not re-announce
everything it just found.

## Acceptance criteria

- [ ] Sweeps backwards in date windows, narrowing near the paging cap
- [ ] Honours the configured horizon
- [ ] Resumable: a restart mid-sweep continues rather than restarting
- [ ] Per-marketplace completion marker persisted
- [ ] **A marketplace's forward cursor does not run until its backfill is complete**
- [ ] Obeys the daily call budget and may span days
- [ ] Seeds the seen-set for every item encountered
- [ ] **Sends no notification**, and the first forward cycle after it re-notifies nothing
- [ ] A listing whose origin date predates the cursor window is found by the backfill and **not** by the forward scan
- [ ] Progress observable while running
- [ ] **Demo: run it at commissioning and find the market already in the feed**
