---
id: 01M041423P4521SRPQW783146Y
type: doc
title: domain glossary
status: living
---
The ubiquitous language of Gloom Watch. This says what words **mean** here — not
how they are implemented and not what is planned. Living document: update it the
moment a term resolves.

## Oddish line

The species scope of the collection: **Oddish, Gloom, Vileplume, Bellossom**.

Operationally, a card is in the Oddish line if it matches **either** TCGdex
`dexId ∈ {43, 44, 45, 182}` **or** a name-contains sweep for those four names —
the union of the two, not either alone. `dexId` alone provably misses records
where TCGdex left the field unset; the name sweep alone pulls in false hits that
need a small manual exclusion list.

The union catches the trainer-owned and mechanic variants automatically:
`Erika's Gloom` (`gym1-45`, `gym1-46`), `Dark Gloom` (`base5-36`), `Gloom δ`
(`ex13-42`), `エリカのクサイハナ` (`MC-002`).

## Masterset

Every distinct **variant** in the Oddish line that was **physically printed**.

"Physically printed" is load-bearing: TCG Pocket digital-only cards (TCGdex set
IDs `A#`, `B#`, `P-A`) are **excluded**. They were never printed, cannot be held,
and cannot appear on eBay — including them would make the masterset permanently
incompletable.

Current size: **~475 card records → ~765 variants.**

## Card

One **language-specific printed card record**, as TCGdex models it:
`{setId}-{localId}` inside a language namespace.

English Obsidian Flames Gloom (`sv03-002`) and Japanese Obsidian Flames Gloom
(`SV3-002`) are **two different cards**, not one card in two languages. Their set
names, card numbers and rarities genuinely diverge, and TCGdex 404s each ID in
the other's namespace.

A card is not the collectible unit. A **variant** is.

## Variant

**The unit of collecting — one row in the masterset, and the thing a completion
percentage counts.**

A variant is a card together with its print-variant attributes, taken from
TCGdex's `variants_detailed`: finish (`normal` / `holo` / `reverse`), and subtype
or stamp such as `1st-edition`, `shadowless`, `unlimited`,
`1999-2000-copyright`, `missing-expansion-symbol`.

So Base Set Charizard resolves to four distinct variants, and "I have the
Unlimited, I still need the 1st Edition" is expressible. Any coarser grain would
mark a card complete on owning any one printing.

**Identity:** `(card_id, variantId)`. Never `variantId` alone — it is a hash of
the *attribute set* and is shared across different cards.

## Copy

**One physical card the owner actually holds**, pointing at exactly one variant.

The variant is the abstract printed thing; the copy is the object in the binder.
Condition, grading and purchase details belong to the copy, never to the variant
— a PSA 10 and a raw card are the same printed variant.

*(What a copy records is still being decided — see the collection-model ticket.)*

## Listing

**One eBay item observed by the scanner**, which may or may not resolve to a
known variant.

A listing is raw observed data, not a claim about the collection. Resolving a
listing to a variant is a separate, fallible act — see the matching ticket.
