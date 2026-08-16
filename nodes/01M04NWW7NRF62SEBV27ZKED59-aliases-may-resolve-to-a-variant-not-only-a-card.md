---
id: 01M04NWW7NRF62SEBV27ZKED59
type: decision
title: Aliases may resolve to a variant, not only a card
status: ruled
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M04JE9E74ZMYFJ2P8XJAJ7KX
    type: supersedes
---
## Resolution

**An alias may resolve a string to a variant, not only to a card. An owner-confirmed
variant pick is recorded and generalises.**

This supersedes *A listing that names a card but not a variant matches at card grain*
(`01m04je9e7`) in one respect only — the absolute "a card-grain match never writes
ownership state" gains a stated exception for owner confirmations. **The rest of that
ruling stands unchanged**, including the grain model, the needed-ness table, and the rule
that the *matcher* never guesses a variant.

## The defect

Two independent reviewers found the same thing.

An alias mapped a string to a **card**. But a card-grain match has *already* resolved the
card — that is what card grain means. So for any card where the owner holds
**some-but-not-all** variants:

```
listing arrives  -> resolves to card
owner holds some -> confirm queue
owner picks variant
alias taught: "string -> card"     <- teaches nothing new
next listing     -> resolves to same card -> queues again
```

**The queue never drains for exactly the cards being actively completed**, which is the
ordinary state of a masterset in progress. At 1,000–3,000 listings a day this is the
dominant path, and the guarantee that *"the same question is never asked twice"* was
unsatisfiable as written.

## The fix

**Aliases carry an optional `variant_id` alongside `card_id`.** A confirmation that
resolved a variant records the variant; a confirmation that only clarified a name records
the card, as before.

```
"クサイハナ ホロ ジャングル"  -> Jungle Gloom (ja), holo     [variant-grain alias]
"クサイハナ"                 -> Gloom (ja)                  [card-grain alias]
```

A future listing matching a variant-grain alias resolves at **variant grain** with high
confidence, and never queues.

## The carve-out, stated precisely

`01m04je9e7` ruled that a card-grain match never writes ownership state. That rule exists
to stop the **matcher** guessing a variant on thin evidence, and it is retained in full.

**An owner-confirmed pick is not a guess.** The distinction that holds:

| Source of a variant resolution | May write ownership state |
| --- | --- |
| Matcher inference from a title | **No** |
| Owner confirming in the queue | **Yes** |

The precision bias is untouched: nothing silent, automatic or probabilistic writes a
variant. Only a human decision does, which is exactly what the confirm queue was built to
capture.

## This remains clear of eBay's training prohibition

An alias is **owner-authored data**, hand-created one confirmation at a time. Adding a
`variant_id` column does not make it a learned artefact. eBay's clause bars using their
content to *"train algorithms, conduct machine learning, develop synthetic data sets, train
large learning models, and/or train artificial intelligence systems"* — a hand-curated
lookup table is none of those, at either grain.

## Alternatives weighed and rejected

- **Per-card queue suppression** — mark a card "stop asking" so its listings resolve
  silently at card grain. Simpler, and it never records *which* variant a listing was, so
  those listings stay permanently ambiguous in the feed and the collection learns nothing.
- **Accept the re-asking** — honest to the precision bias, but leaves the confirm queue
  permanently busy for precisely the cards being actively completed, and forces the
  withdrawal of the "never asked twice" guarantee.
