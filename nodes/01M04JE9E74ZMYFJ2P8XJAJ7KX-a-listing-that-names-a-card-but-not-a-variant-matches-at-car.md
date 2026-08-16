---
id: 01M04JE9E74ZMYFJ2P8XJAJ7KX
type: decision
title: A listing that names a card but not a variant matches at card grain
status: ruled
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA9GZ6ZRV3CBTF2F460EN
    type: relates
---
## Resolution

**When a listing title identifies a card but not a unique variant, the matcher resolves
to the card, records the candidate variants, and leaves the variant unresolved in the
confirm queue.**

Critically: **need-it is still decidable at card level.** If the owner holds **none** of
that card's variants, the listing is needed whichever variant it turns out to be — so it
**qualifies for notification without ever being disambiguated.**

This fills a gap left open by *How does an eBay listing resolve to a specific card?*
(`01m03xa9gz`), which specified the pipeline, the precision bias and the confirm queue,
but never said what the matcher outputs in the most common real case. Everything in that
ticket stands.

## The case

The collection is tracked at variant grain — English and Japanese are separate rows,
holo and reverse are separate rows, 1st Edition and Unlimited are separate rows. **Most
eBay titles do not carry that discrimination.**

```
"Gloom Jungle 44/64"
  -> card resolved:    Jungle Gloom (en)
  -> variants live:    normal, reverse holo, 1st edition, unlimited
  -> variant:          UNRESOLVED
```

This is not an edge case. It is the ordinary shape of a vintage listing, and it sets
queue volume, push volume, and whether have-it/need-it can be trusted.

## Why card-level resolution is enough for notification

**The question a notification answers is "do I need this?", not "which row is it?"**

| Owner holds | Needed? | Action |
| --- | --- | --- |
| none of the card's variants | **yes, certainly** | qualifies for push, no disambiguation |
| all of the card's variants | **no, certainly** | suppressed, no disambiguation |
| some of the card's variants | **unknown** | confirm queue |

Only the third row needs the owner. Early in a masterset — when most cards are owned in
no printing at all — the first row dominates, which is exactly when notification
coverage matters most and when queue patience is thinnest.

**This is why the precision bias is not violated.** Nothing is auto-matched to a variant
on a guess. The collection state is never written from an underdetermined match. What is
asserted is only what the title actually supports: *this is that card*.

## What gets recorded

A listing carries its resolution **grain** explicitly:

```
match_grain   'variant' | 'card' | 'none'
card_id       set when grain is 'card' or 'variant'
variant_id    set ONLY when grain is 'variant'
candidates    the live variant set when grain is 'card'
confidence    as before
matcher_version as before
```

**A card-grain match never writes ownership state** and never marks a variant owned or
needed. It is a claim about the listing, not about the collection.

## Disambiguation is one tap, not a form

When a card-grain listing does need the owner — the partly-owned case — the confirm
queue shows the candidate variants side by side, and picking one resolves it. As with
every other correction, this teaches an **alias** where the title contained a
generalisable string, so the same phrasing parses unprompted next time.

Where the title genuinely carries no variant information at all, there is nothing to
learn and no alias is taught — the listing is simply resolved once.

## Consequences

1. **The matcher's return shape is not `variant + confidence`.** It returns a grain, a
   card, an optional variant, a candidate set, a language, a lot flag, a filter verdict
   with its reason, and any parsed grade. The spec's earlier one-line signature was
   wrong and could not have produced the outputs its own tests asserted.
2. **The push rule reads ownership at the grain of the match** — card-grain listings
   test "owns none of this card's variants".
3. **Queue volume is far lower than a variant-strict reading would give**, because the
   dominant case resolves without asking.
4. **Completion is unaffected.** Nothing here writes to the collection.

## Alternatives weighed and rejected

- **Queue every underdetermined listing** — the strictest reading of the precision bias,
  and where the spec's silence would most likely have landed an implementer. Rejected:
  the queue would absorb most of four-digit daily volume, and the notification stream
  would go quiet precisely when the collection is emptiest and nearly every listing is
  genuinely needed.
- **Guess the most likely variant** (base printing, or the commonest) — keeps the queue
  small and notifications flowing. Rejected outright: this is the silent wrong
  auto-match the precision bias exists to prevent, and it corrupts have-it/need-it
  invisibly.
- **Emit a variant set and let downstream decide** — rejected as under-specified rather
  than wrong: "is it owned" is undecidable over a set where some members are owned,
  which is precisely the case that needs an answer.
