---
id: 01M04PMBEPRKRVGC1GJPMBNR18
type: feature
title: Hand-added variants and the exclusion list
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
  - to: 01M04PMSTBQTDG4TZ26YS84SHN
    type: blocks
meta:
  ticket: build
---
## What to build

The cards TCGdex does not have. Korean and Simplified Chinese carry **zero** Oddish-line
records despite being populated languages, and "The Best of XY" is missing everywhere — so
hand-added rows are a first-class part of the masterset, not an escape hatch.

Entry is **clone-and-edit**: find the nearest existing printing, clone it, change the
language and whatever else differs. A blank form stays available.

Hand-added rows mint identities in a **reserved namespace** upstream can never produce, so a
future TCGdex addition of Korean cannot collide with them.

Also here: the **exclusion list** for false hits from the name sweep, which is owner-curated
data with no upstream source and needs the same protection.

## Acceptance criteria

- [ ] Clone-and-edit creates a new card and variant from an existing one
- [ ] A blank entry form exists for anything with no relative to clone
- [ ] Hand-added identities use a reserved namespace; a clone never inherits its source's identity
- [ ] Hand-added rows count toward completion exactly like imported ones
- [ ] Hand-added rows can be edited and deleted
- [ ] Exclusion list is editable and applied on ingest
- [ ] **A corpus re-import touches neither hand-added rows nor the exclusion list** — verified by test
- [ ] **Demo: add a Korean Gloom, see completion change, run a sync, see it survive**
