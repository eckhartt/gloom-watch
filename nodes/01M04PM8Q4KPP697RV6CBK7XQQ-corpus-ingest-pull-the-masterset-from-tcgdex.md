---
id: 01M04PM8Q4KPP697RV6CBK7XQQ
type: feature
title: Corpus ingest — pull the masterset from TCGdex
status: active
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
  - to: 01M04PM99F3T138S12SFCPGM1G
    type: blocks
  - to: 01M04PMPHBTEM7KP49Y0153B2N
    type: blocks
meta:
  ticket: build
  claimed: corpus-agent
---
## What to build

Pressing sync fills the database with the masterset.

Two-phase pull from TCGdex — brief form per language, then detail for survivors — with
**filtering done locally** so re-scoping never means re-crawling. Membership is
`dexId ∈ {43,44,45,182}` **unioned with** a name-contains sweep for the four species, minus
TCG Pocket sets.

**Every language TCGdex carries for the line is ingested**, and the language list is derived
on each sync rather than hard-coded.

The variant model has **five axes** — `finish`, `subtype`, `stamps` (a list), `foil`, `size`
— taken from `variants_detailed`. The legacy flat `variants` object disagrees with it and is
ignored.

## Acceptance criteria

- [x] Card identity includes **language**; en `base1-58` and fr `base1-58` are different rows
- [x] Variant identity is `(card identity, variant_id)`; two cards sharing one `variant_id` produce two rows
- [x] A `variant_id` of the literal string `"generated"` is handled as an opaque token
- [x] Five axes stored; `stamps` is a canonicalised, order-independent list
- [x] `1st-edition` and `1st edition` canonicalise to the same value
- [x] TCG Pocket excluded by set-ID **prefix**, catching suffixed IDs like `A2b` and `B1a`
- [x] Corpus images stored as webp BLOBs, one per **card** record; incremental sync via the image hash manifest
- [x] Image URLs built case-correctly in every path segment
- [x] Re-import never deletes or renumbers a row; a variant absent upstream is flagged and kept
- [x] `provenance` and last-synced timestamp recorded per row
- [x] Sync is a job with observable progress, not a blocking request
- [x] Demo: press sync, see the variant count and last-synced time in the app — **in a desktop browser at phone width, not yet on the phone**

## What the corpus actually contains

Measured against the live API on **16 August 2026**, three full syncs.

| | |
| --- | --- |
| languages derived | 18 |
| languages carrying the line | 11 — en fr de ja es it pt zh-tw id th **es-mx** |
| brief records stored | 138,909 |
| members after filtering | 497 cards |
| variants | 817 |
| images | 382 of 497 cards, **26.32 MiB** |
| database on disk | 43.5 MiB |
| first sync | ~2 minutes; re-sync ~45 s and no image traffic |

Membership: 248 cards admitted by `dexId` alone, 19 by name alone, 230 by both. Both halves
of the union are load-bearing and each was measured, not assumed.

Two numbers that make the identity rulings concrete: dropping language from the card key
collapses 497 cards to 166; keying variants on `variant_id` alone collapses 817 variants to
21, because the line's 817 variants carry only 21 distinct tokens and one of them is shared by
264 cards.

## Facts the build found that the spec did not have

**The brief form carries no `dexId`.** `/v2/{lang}/cards` returns `{id, localId, name, image}`,
and sorting on `dexId` does not project it either. The dex half of membership therefore takes
one narrow query per species per language, whose *result* is stored in `corpus_brief` and
filtered locally from then on. `eq:` is mandatory: the default filter is a contains match, and
a bare `dexId=43` returns 403 English cards where 32 are wanted, because 431 contains 43.

**The five axes are localised, not a fixed vocabulary.** `variants_detailed` returns display
strings in the card's own language, mixed with the slug form and sometimes both within one
language: `Olografica`, `Normale`, `básico`, `reversa`, `Padrão`, `estándar`, `Poké Bola`,
`Énergie`, `1re Édition`, `1. Auflage`, `Symbole d'extension manquant`. The spec's observed
values were an English inspection. Since the axes are filterable across the corpus while
language is only a filter, canonicalisation is slug-then-synonym, with the table built from
values live data actually contains. Effect: `1st-edition` covers **56** variants across
en(17) ja(17) fr(11) de(11); slug alone would give 34, neither would give 18.

**`es-mx` is missing from the documented language list** and carries six Oddish-line cards.
Deriving the list from upstream is load-bearing on day one, not a precaution.

**No variant in the line carries more than one stamp.** `stamps` is still stored as a sorted
list per the spec, but the multi-stamp behaviour is asserted against a synthetic fixture.

**`ja|E3-003` lists the same variant twice upstream**, identical `variantId`. Identity is
`(card, variant_id)`, so it is one row — which is why the corpus holds 817 where a naive count
of `variants_detailed` entries gives 818.

Full detail, with every measured number, is in `docs/corpus.md`.

## Notes for the reviewer

**The demo was run in a desktop browser at 430×932, not on the iPhone.** Pressing the button
returns 202 in ~3 ms, the panel shows live phase and progress, and the finished state shows
497 cards / 817 variants / 382 images and the last-synced time. The Home Screen half needs the
box and the handset.

**The brief snapshot is stored, not streamed** — 138,909 rows, 10.35 MiB. That is what makes
"re-scoping never means re-crawling" true across syncs rather than only within one. If the
owner would rather not carry 138k rows of unrelated cards, the alternative is a re-crawl on
every boundary change and the table can go.

**Sync runs in the HTTP server's process, not as a `Bun.cron` entry.** Cron is for the jobs
that must run with nobody present; the spec fixes corpus refresh as manual, so there is no
schedule to register. A job left `running` by a restart is reconciled to `interrupted` at boot
— verified with `SIGKILL` mid-sync against a live database, corpus intact afterwards.

**Set release dates are not stored**, and the binder's default order needs them. The card
payload's `set` object carries only `{id, name, cardCount, logo, symbol}`; getting the date
means `/v2/{lang}/sets/{id}`. Left for the ticket that needs the ordering.

`bun run verify` passes: 98 tests across 10 files.
