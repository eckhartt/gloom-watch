---
id: 01M03X9WY0D6AH6GYKG5V6K8VC
type: decision
title: Which source is canonical for the Oddish-line card corpus?
status: ruled
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA78KZN54BHSM6G9ZBPTV
    type: blocks
  - to: 01M03XA9GZ6ZRV3CBTF2F460EN
    type: blocks
  - to: 01M03XAAMK96EN2TFBHEYGABXQ
    type: blocks
meta:
  ticket: research
  hitl: no
---
## Resolution

**TCGdex is the canonical corpus.** It is the only surveyed source that is free,
**MIT-licensed**, bulk-downloadable, and models Japanese prints as **first-class
separate records** rather than translations hung off an English row.

It was verified against the live API on the exact cases the eBay facets say must
work:

| Case | TCGdex ID |
| --- | --- |
| Erika's Gloom | `gym1-45`, `gym1-46`, `me02.5-002` |
| Dark Gloom | `base5-36` |
| Gloom δ | `ex13-42` |
| エリカのクサイハナ (Japanese) | `MC-002` |

**Fallback / supplement: Bulbapedia as a one-off completeness auditor**, plus a
hand-sourced image path for the gaps below.

## What it gives us

- **Coverage** back to WOTC — Base Set, Jungle, Team Rocket, Gym Heroes, Neo,
  Southern Islands, Legendary Collection, Black Star Promos — and the Japanese
  side back to the original Pokémon Card Game era (`PMCG`, `PCG`, `ADV`, `VS`),
  including Japanese-only sets.
- **Separate ID namespaces per language.** Japanese Obsidian Flames Gloom is
  `SV3-002`; English is `sv03-002`; each 404s in the other's namespace. Exactly
  the shape a masterset wants.
- **`variants_detailed`** distinguishes 1st Edition, Shadowless, Unlimited,
  `1999-2000-copyright`, `missing-expansion-symbol`, holo and reverse holo —
  deeper than pokemontcg.io ever offered. Base Set Charizard resolves to four
  distinct variant rows.
- **Bulk access, no key, no auth.** All 23,546 English cards in one 2.3 MB
  response; `git clone` of `tcgdex/cards-database` is the full dump; and
  `assets.tcgdex.net/datas.json` is a per-card **image hash manifest** for
  incremental image sync.
- **Actively maintained** — the repo was pushed the day before the survey.

## Corpus size — small enough to change how we build

**~475 physical language-specific card records → ~765 variant rows.**

Derived by measurement, not estimate: 528 records across 13 languages via
`?dexId=eq:{43,44,45,182}`, minus 53 TCG Pocket digital-only cards, times a
measured variant multiplier of ×1.61 (EN ×1.76, JA ×1.41).

This is **hundreds, not tens of thousands.** SQLite is trivially comfortable,
and hand-curating the residual gaps is genuinely tractable rather than a
fantasy. That reframes several downstream decisions.

## Four traps that must be handled on ingest

1. **`stamp` is not normalised.** Both `1st-edition` and `1st edition` appear for
   the same concept at comparable frequency (18 vs 16 occurrences). **Canonicalise
   on ingest or a 1st Edition filter silently drops half the corpus.**
2. **`variantId` is not unique per card-variant.** It is a hash of the *variant
   attribute set*, shared across different cards — `endfynwn4n10gzq` ("normal,
   standard") appears on `base2-37`, `base5-36`, `gym1-45` and `neo1-36` alike.
   **The primary key must be `(card_id, variantId)`, never `variantId` alone.**
   Store the raw attributes too, since the vocabulary is demonstrably not tightly
   controlled.
3. **TCG Pocket digital-only cards are mixed into the same corpus** — 14 of 105
   English Oddish-line records, set IDs `A#`, `B#`, `P-A`. Not printed cards.
   Filter by set-ID prefix or the masterset count is corrupted.
4. **Image URLs are case-sensitive** — `/ja/SV/SV3/002/high.png` works, lowercase
   `sv` 404s.

## What TCGdex cannot do — this becomes work elsewhere

1. **No per-variant images.** One image per card record; no distinct Shadowless
   vs Unlimited vs 1st Edition scan. Confirmed: `images` is not among the
   `variants_detailed` keys.
2. **Japanese images only 28% covered** (19/68), all from 2021+ sets. **Every
   pre-2021 Japanese Oddish-line card has no image** — and Japanese is ~17% of
   the Gloom market on eBay.
3. **Korean and Simplified Chinese entirely absent** for this line — zero records
   in either, despite both languages existing in the database.
4. **"The Best of XY" missing in every language** (~4 cards). Found by
   cross-checking Bulbapedia — which is why Bulbapedia earns its place as an
   auditor.
5. **No updated-since query.** `?updated=gt:` returns nothing and `sort:field=updated`
   is not recency-ordered. Freshness must come from diffing a full pull or
   watching the git log.

Image sizes, measured: high.png ~310 KB, **high.webp ~59 KB**, low.webp ~14.5 KB.
The whole 361-image Oddish-line set is **~20 MB as webp** — trivial.

## Licence — quoted

The database is MIT, from the repo's `LICENSE`:

> "Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights to
> use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
> of the Software..."

This unambiguously permits a local copy in a self-hosted tracker.

**Caveat, stated honestly:** the MIT grant covers the *database*. The card
**images** are TPCi / Nintendo / Creatures / GAME FREAK copyright, and TCGdex has
no authority to sublicense them. `tcgdex.dev/assets` states no hotlink or
bulk-download policy either way. This is a genuine unresolved grey area, not
something a clause can be quoted for. For a single-user private tracker it is the
same posture every collection app takes.

## Sources ruled out

- **pokemontcg.io is dead.** `api.pokemontcg.io` returns **HTTP 500** on both
  `/v2/cards` and `/v2/sets` (verified 2026-08-16), and its homepage now reads
  only *"The Pokémon TCG API is now part of Scrydex."* Drop it.
- **Scrydex** — $29/mo floor, **no free tier**, English + Japanese only, and its
  Japanese translation is documented as *"still a work in progress"*. Its terms
  prohibit *"mirror[ing]"* without written authorization and **never
  affirmatively permit local storage**. It does beat TCGdex on one axis —
  per-variant images — but that is not worth a paid subscription whose terms
  don't grant what the project needs. *All Scrydex claims are documentation-only;
  the API returned 401 and could not be inspected.*
- **PokeWallet** is built on TCGplayer + CardMarket commerce catalogs, is
  pricing-first, uses opaque hash IDs with no stability guarantee, and inherits
  inconsistent variant vocabularies from two disagreeing upstreams.
- **TCGCSV** is disqualified outright: it *"does not share information about
  SKUs"*, and in TCGplayer's model the SKU is exactly where language, printing
  and condition live.

## Known gaps in this research

- **Korean / zh-cn gap is unquantified** — how many such Oddish-line prints
  actually exist was not established.
- **Scrydex and PokeWallet data were never inspected** (401 / key required).
- **Only Gloom and Vileplume** were audited against Bulbapedia; Oddish and
  Bellossom may hold further "Best of XY"-type gaps.
- **TCGdex rate limits are unpublished** — 25 rapid requests all returned 200
  with no throttling headers, but absence of an observed limit is not a guarantee.
- Whether the thinner Japanese variant multiplier (×1.41 vs ×1.76) reflects
  simpler Japanese printing practice or thinner data could not be distinguished.

Full survey with citations: see the child research node.
