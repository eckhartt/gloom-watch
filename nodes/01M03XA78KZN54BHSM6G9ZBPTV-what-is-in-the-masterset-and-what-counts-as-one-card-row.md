---
id: 01M03XA78KZN54BHSM6G9ZBPTV
type: decision
title: What is in the masterset, and what counts as one card row?
status: ruled
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA7TY3EEWANSAG7KZSS3Y
    type: blocks
  - to: 01M03XA9GZ6ZRV3CBTF2F460EN
    type: blocks
  - to: 01M03XAAMK96EN2TFBHEYGABXQ
    type: blocks
meta:
  ticket: grilling
  hitl: yes
---
## Resolution

**A row is one variant, in one language.** The masterset is every physically
printed TCG variant in the Oddish line — **~765 rows** sourced from TCGdex, plus
hand-added rows for what TCGdex lacks.

## What makes two objects different rows

| Axis | Splits a row? | Why |
| --- | --- | --- |
| **Language** | **Yes** | English `sv03-002` and Japanese `SV3-002` are two collectibles. Set names, card numbers and rarities genuinely diverge, and TCGdex 404s each ID in the other's namespace. A language column would have to lie. |
| **Print variant** | **Yes** | TCGdex `variants_detailed`: holo, reverse, normal, `1st-edition`, `shadowless`, `unlimited`, `1999-2000-copyright`. Base Set Charizard → four rows. |
| **Grading** | **No** | Lives on the **copy**. A PSA 10 and a raw card are the same printed variant, so a graded eBay listing still resolves to the same row. |
| **Per-object defects** | **No** | Not modelled anywhere — see the error line below. |

**Identity is `(card_id, variantId)`.** Never `variantId` alone: it is a hash of
the attribute set and is shared across different cards.

## What is in

Cards matching TCGdex `dexId ∈ {43, 44, 45, 182}` **unioned with** a
name-contains sweep for Oddish / Gloom / Vileplume / Bellossom.

**The union is the decision, not either half.** `dexId` alone provably missed ~3
English records where TCGdex left the field unset, and a masterset cares about
exactly those stragglers. The name sweep will pull in occasional false hits,
which need a small manual exclusion list.

Caught automatically by this rule: `Erika's Gloom` (`gym1-45`, `gym1-46`),
`Dark Gloom` (`base5-36`), `Gloom δ` (`ex13-42`), `エリカのクサイハナ` (`MC-002`).

Also in, as a **consequence** of the print-run rule rather than a separate vote:
prerelease `set-logo` stamps (7 occurrences) and World Championship deck stamps
`chris-fulop` (2) and `ross-cawthorn` (2) — roughly 11 rows. They sit in
`variants_detailed`, so the rule pulls them in.

## What is out

- **TCG Pocket digital-only cards** — 53 records, set IDs `A#`, `B#`, `P-A`.
  Never printed, cannot be held, cannot appear on eBay. Including them would make
  the masterset permanently incompletable. Filter by set-ID prefix on ingest.
- **Non-TCG physical items** — Topps, Bandai Carddass, Amada, vending-machine
  prints, stickers, jumbo/oversized.
- **Sealed product** — the app tracks cards, not product.
- **Cameo/art-only appearances** — a card picturing the line without carrying the
  name does not match the filter. Treated as correct behaviour, not a gap.

The reason non-TCG items lost: TCGdex carries none of them, so each would be a
hand-typed row with no image, no stable ID, and nothing for the eBay matcher to
recognise. The cost is real and recurring; the benefit is a handful of items the
owner did not ask to track.

## The error line

**Systematic print-run distinctions are variants. Per-object defects are not
modelled at all.**

- **A variant row:** `missing-expansion-symbol`, `shadowless`, `1st-edition`,
  `unlimited`, `1999-2000-copyright` — a whole batch left the press that way, and
  two collectors' copies of it are the same collectible.
- **Not modelled anywhere:** miscuts, ink errors, colour shifts, crimps,
  off-centre and square cuts. Two miscut Glooms are not the same collectible as
  each other, and there is no source, ID or image for any of them.

This line was drawn to resolve a genuine contradiction: "variant is the row using
`variants_detailed`" and "ignore errors entirely" collide on
`missing-expansion-symbol`, which TCGdex ships *inside* `variants_detailed`. The
print-run/per-object distinction makes both answers consistent at a cost of
exactly one row.

**This binds the collection model.** There is to be **no per-copy defect or error
field** — that follows from "ignore errors entirely" and is not re-litigable in
the copies ticket.

## Manual card entry — a v1 scope addition

Hand-added variants are **first class and count toward completion**, so Korean,
Simplified Chinese and "The Best of XY" can actually be tracked. TCGdex has zero
Oddish-line records in `ko` or `zh-cn` despite carrying those languages, and is
missing Best of XY (~4 cards) in every language.

This is **beyond the originally scoped v1** and was added deliberately.

**Hard constraint it creates, for the ingest decision:** a corpus re-import must
never delete a manual row, never renumber one, and never orphan a copy pointing
at one. Rows should carry their provenance (`source = tcgdex | manual`).

## Alternatives weighed and rejected

- **One row per card with a language column** — rejected because set name, card
  number and rarity all differ per language; the columns would have to lie or
  become per-language sub-tables, which is separate rows with extra steps.
- **English rows with other languages as translations** — rejected because
  Japanese-only sets have no English parent to hang from.
- **Card as the row with variants as flags** (~475 rows) — rejected because
  owning any printing would mark the card complete, making "have Unlimited, still
  hunting 1st Edition" inexpressible and the completion percentage an overstatement.
- **Coarse holo/non-holo split only** — rejected for the same reason, less
  severely.
- **`dexId` only** — rejected: incomplete by construction.
- **Name-contains only** — rejected: more noise than the union, with no
  compensating gain.
- **Hand-curated inclusion list** — rejected: tractable at this corpus size, but
  requires a manual re-audit on every new set release.
- **Graded and raw as different variants** — rejected: would multiply the
  masterset by every grade on every grading scale and make completion unreachable.
- **Every known error as its own variant** — rejected: no upstream source, so
  every row would be hand-curated forever.
- **Deferring manual entry to v2** — rejected: the owner wants genuine
  completeness, and the known gaps are small and countable enough to be worth it now.

## Implementation constraints this creates

1. **Canonicalise `stamp` on ingest.** Both `1st-edition` and `1st edition`
   appear in TCGdex at comparable frequency (18 vs 16). Miss this and the 1st
   Edition filter silently drops half the corpus. An ingest requirement, not a
   decision.
2. **Key on `(card_id, variantId)`.**
3. **Filter TCG Pocket by set-ID prefix** before counting anything.
4. **Manual rows must survive re-import** — see above.
5. **Maintain a manual exclusion list** for false hits from the name sweep.

Terms settled here are recorded in the **domain glossary** (`01m041423p`).
