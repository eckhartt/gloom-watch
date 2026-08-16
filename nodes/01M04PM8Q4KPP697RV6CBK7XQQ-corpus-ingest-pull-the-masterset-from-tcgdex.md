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
bindings:
  branch: feat/corpus-ingest
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
- [x] **Demo: press sync, see the variant count and last-synced time in the app**

## Commissioning record — 2026-08-16

Synced on `htpc` against the live TCGdex API, then re-synced from the iPhone Home Screen app.

```
languages derived   18        languages carrying the line   11
brief records       138,909   members after local filter    497 cards
variants            817       images  382 (26.32 MiB)
database on disk    42 MB     failures                      0
```

The re-sync from the phone fetched **zero image bytes** — every hash still matched the manifest.
That is the incremental path proving itself on the device rather than in a test.

A corpus image served over the real origin: `GET /api/corpus/cards/en%3Abase2-58/image` →
`200 image/webp`, 65,680 bytes.

## What the live API disagreed with the spec about

Three of the spec's factual premises did not survive contact. The rulings were kept; how they
are achieved changed.

**`dexId` needs `eq:`.** TCGdex's default filter is a *contains* match: `dexId=43` returns 403
English cards because 431 contains 43, where `dexId=eq:43` returns 32. Verified live during
review. Without it the ingest pulls a tenth of the English catalogue in as Oddish-line, and the
failure looks exactly like success.

**The brief form carries no `dexId`**, so that half of the filter cannot be local from the brief
list alone. Resolved with narrow per-species dex queries stored alongside the brief snapshot;
every membership rule still runs locally over that table.

**The five axes are localised display strings, not a fixed vocabulary.** Italian sends
`Olografica`, Spanish `básico`, French `1re Édition`, German `1. Auflage`. Stored raw, a binder
filtered to "holo" silently misses every Italian row — the same defect class the spec names for
`1st edition`. A 15-entry synonym table maps localised slug to English token; unknown values are
kept as their slug and reported rather than dropped. 56 first-edition variants are findable where
slug normalisation alone finds 34.

**`es-mx` is an eighteenth language** absent from TCGdex's own documentation, carrying 6 cards.
Deriving the language list from upstream was already necessary on the day this was built, not a
precaution against future change.

## The collision measured, and why identity is shaped as it is

The spec estimated one `variant_id` shared by ~90 cards. Live, **all 817 variants carry only 21
distinct tokens**, the worst shared by 264 cards. Keyed on `variant_id` alone the masterset is 21
rows. A composite primary key on `(card_key, variant_id)` makes that unrepresentable rather than
merely discouraged.

Likewise language: 103 `(set, number)` pairs exist in more than one language, so dropping
language from the key collapses 497 cards to 166 — 331 rows silently overwritten.

## Fixed after the owner misread it

The summary line reported `imagesFetched` — a delta — at the end of a list of totals, so a no-op
re-sync read `0 image(s)` and was taken to mean the corpus had lost its images. A sync reporting
zero of something is exactly when a reader starts hunting for data loss. It now reads
`382 image(s) — none newly fetched`, with five tests including the no-op case. `jobSummary` was
private and untested, which is how the wording drifted.

## Left for later tickets

- **Set release dates are not stored**, and the binder's default order needs them. The card
  payload's `set` object carries no date; getting it means a per-set fetch across 46 sets × 11
  languages.
- **`corpus_exclusions` has no write endpoint.** The filter honours it; nothing yet creates a row.
- **Completion's denominator rule is unimplemented** — `missing_upstream` is populated and
  correct, but the rule needs the copies table.
- **`variantCountDropped` is computed and has never been true.** It is the only warning a
  membership regression will give, and whoever builds the health surface decides how loudly it
  shows.
- **Multi-stamp variants are untested against real data** — none exist in this line.
