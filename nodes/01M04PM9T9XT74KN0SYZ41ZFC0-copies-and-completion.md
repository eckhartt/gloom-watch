---
id: 01M04PM9T9XT74KN0SYZ41ZFC0
type: feature
title: Copies and completion
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
---
## What to build

Recording the cards you actually own, and the completion figure that follows from it.

A copy is **one physical card**, pointing at exactly one variant — never a quantity count.
Condition uses the hobby ladder `NM / LP / MP / HP / DMG`, which is **not** eBay's
vocabulary and is not claimed to be.

Money is stored as integer minor units paired with an ISO 4217 code, never a float. Grade is
integer tenths so `PSA 8.5` compares exactly.

Disposal retains the row.

## Acceptance criteria

- [ ] Add, edit and dispose a copy from the variant sheet
- [ ] Condition, grader, grade, cert number, price with currency, home-currency snapshot with its rate date, acquisition source and note all persist
- [ ] Grade requires a grader; a home-currency amount requires its currency and rate date
- [ ] Two copies of one variant coexist with different conditions and prices
- [ ] Disposed copies keep their row and drop out of ownership
- [ ] **Every ownership query filters on owned status** — verified by a test that would fail if one did not
- [ ] Completion numerator counts variants with at least one owned copy
- [ ] Completion denominator excludes `missing_upstream` variants **unless owned**
- [ ] Completion is invalidated on corpus sync, copy creation and disposal
- [ ] Priority is settable on an unowned variant
- [ ] Client-generated UUIDs are the identifiers for copies
- [ ] **Demo: mark cards owned and watch completion move**
