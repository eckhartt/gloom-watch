---
id: 01M04PMQ2J370TWBEH3SWF1KB9
type: feature
title: Confirm queue and aliases
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
---
## What to build

The queue that makes the matcher improve with use, and the aliases that stop it asking twice.

Queue membership is **explicit state**, never inferred from a confidence score. These must be
distinguishable, or the queue either re-asks forever or cannot be emptied:

```
unattempted   auto_matched   queued   resolved   not_a_match
```

**Aliases may resolve to a variant, not only a card.** This is the fix for the queue's
dominant case: a card-grain match has already resolved the card, so a card-only alias would
teach nothing, and every listing for a partly-owned card would ask again forever.

The carve-out is precise. The **matcher** still never guesses a variant. An owner confirming
in the queue is not a guess, and that resolution is recorded and generalises.

Aliases stay owner-authored at either grain, which is what keeps them clear of eBay's
training prohibition.

## Acceptance criteria

- [ ] Queue states are explicit; `not_a_match` and `unattempted` are distinguishable
- [ ] A listing resolved `not_a_match` never re-queues
- [ ] Confirm, pick-a-variant and not-a-match all available from the queue
- [ ] A card-grain listing for a partly-owned card shows its candidate variants side by side
- [ ] Confirming teaches an alias; **picking a variant teaches a variant-grain alias**
- [ ] A subsequent listing with the same phrasing resolves without queueing — **verified by test**
- [ ] Owner confirmation may write ownership state; matcher inference may not
- [ ] Aliases are editable and deletable
- [ ] Queue depth surfaced as a health signal
- [ ] **Demo: resolve a queued Japanese listing once, watch the next one with that phrasing parse itself**
