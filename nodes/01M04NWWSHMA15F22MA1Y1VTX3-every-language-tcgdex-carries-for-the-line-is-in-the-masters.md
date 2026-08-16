---
id: 01M04NWWSHMA15F22MA1Y1VTX3
type: decision
title: Every language TCGdex carries for the line is in the masterset
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA78KZN54BHSM6G9ZBPTV
    type: relates
---
## Resolution

**Every language TCGdex carries for the Oddish line is ingested. The masterset is all of
them.**

This fills a gap no decision on the map had noticed: the ingest pipeline said *"per
language"* and never said **which** languages, leaving the completion denominator — the
product's headline number — undetermined.

## Why it matters more than it looks

Completion is the emotional core of a masterset tracker. Its denominator is "every variant
except…", so **the language set silently decides the number the whole app is built around.**
Two implementers reading the same document could ship products whose central figure differs
by a multiple, and neither could tell they had diverged.

The `~765 variants` figure the map has used throughout was derived from a **13-language**
count, so it already assumed this answer without stating it.

## What is ingested

All languages in which TCGdex holds Oddish-line records. Measured live:

| Language | Oddish | Gloom | Vileplume | Bellossom |
| --- | --- | --- | --- | --- |
| en | 32 | 31 | 27 | 15 |
| fr | 26 | 27 | 24 | 15 |
| de | 24 | 25 | 23 | 12 |
| ja | 21 | 20 | 19 | 8 |
| es | 14 | 15 | 12 | 5 |
| it | 14 | 15 | 12 | 5 |
| pt | 12 | 12 | 11 | 4 |
| zh-tw | 6 | 7 | 4 | 2 |
| th | 4 | 5 | 2 | 2 |
| id | 3 | 3 | 3 | 0 |
| **ko** | **0** | **0** | **0** | **0** |
| **zh-cn** | **0** | **0** | **0** | **0** |

**Korean and Simplified Chinese are populated languages in TCGdex** (95 sets / 239 cards
and 57 sets / 877 cards respectively) **that carry zero Oddish-line records.** Confirmed by
`dexId` query and independently by native-script name search (`뚜벅쵸` → 0, `走路草` → 0),
with a Traditional Chinese control returning 6 to prove the technique sound.

**That absence is the entire reason manual variant entry exists** as a v1 feature. This
ruling does not create those rows; it establishes that when TCGdex ever adds them, they are
in scope automatically.

## Why not a narrower set

**Because "masterset" means every printing.** Narrowing to English and Japanese would be a
different product with a different name — and the owner's brief said "the whole Oddish
line" and "language variations" from the first message.

The counter-argument considered and rejected: the eBay feed is ~80% English and ~17%
Japanese, so a Thai or Indonesian variant will almost never surface a listing. **True, and
irrelevant to the denominator.** The scanner's coverage and the masterset's definition are
different questions; a card being hard to find does not make it not part of the set. It
does mean the completion figure will move slowly at the tail, which is what a masterset is.

## Consequences

- **The language list is a configuration key**, defaulted to every language TCGdex reports
  for the line and re-derived on each corpus sync rather than hard-coded — so a language
  gaining its first Oddish-line record is picked up without a code change.
- **The denominator grows when upstream adds a language.** Completion can go *down* after a
  sync. This is correct behaviour for a masterset and must not be "fixed"; the variant-count
  warning already specified will make it visible rather than mysterious.
- **Ingest cost scales with the language count** — roughly 475 detail fetches at the
  measured 13-language breadth, politely paced. Still a single-digit-minute job.

## Alternatives weighed and rejected

- **English and Japanese only** — the two languages that dominate both the market and the
  owner's collecting, giving a far more achievable denominator and losing almost nothing
  from the eBay feed. Rejected as a different product: it is a *subset* tracker wearing the
  word masterset.
- **English, Japanese and Western European** (adding fr/de/es/it/pt) — everything that
  trades meaningfully on the four scanned marketplaces. Rejected for the same reason, less
  severely: it draws the boundary at what is easy to buy rather than at what was printed.
