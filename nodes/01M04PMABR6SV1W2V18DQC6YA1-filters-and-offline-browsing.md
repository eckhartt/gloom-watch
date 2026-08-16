---
id: 01M04PMABR6SV1W2V18DQC6YA1
type: feature
title: Filters and offline browsing
status: active
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
  claimed: filters-agent
---
## What to build

Narrowing the binder, and doing it with no connection.

Filters over every variant axis plus set, language, owned/needed and priority. **The Gap is
a filter, not a screen** — "what I still need" is one of these, never its own page.

Filter state lives in **typed URL search parameters**, so a filtered view survives reload and
can be returned to.

Filtering happens **client-side** over the cached binder document, which is what makes the
whole thing work offline. Plus a user-initiated bulk image warm for before a card fair.

## Acceptance criteria

- [ ] Filters over finish, subtype, stamps, foil, set, language, owned/needed and priority
- [ ] Multi-select within an axis behaves as OR; across axes as AND
- [ ] Filter state serialises to typed URL search params and survives a reload
- [ ] Filtering runs client-side against the cached document — no request per filter change
- [ ] With the tailnet unreachable, the binder still renders and **filters still work**
- [ ] Bulk image warm is explicit and user-initiated, never automatic, with visible progress
- [ ] **Demo: put the phone in aeroplane mode and filter the binder to what you still need**
