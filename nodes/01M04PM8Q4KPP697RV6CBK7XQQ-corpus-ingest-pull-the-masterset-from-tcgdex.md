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

- [ ] Card identity includes **language**; en `base1-58` and fr `base1-58` are different rows
- [ ] Variant identity is `(card identity, variant_id)`; two cards sharing one `variant_id` produce two rows
- [ ] A `variant_id` of the literal string `"generated"` is handled as an opaque token
- [ ] Five axes stored; `stamps` is a canonicalised, order-independent list
- [ ] `1st-edition` and `1st edition` canonicalise to the same value
- [ ] TCG Pocket excluded by set-ID **prefix**, catching suffixed IDs like `A2b` and `B1a`
- [ ] Corpus images stored as webp BLOBs, one per **card** record; incremental sync via the image hash manifest
- [ ] Image URLs built case-correctly in every path segment
- [ ] Re-import never deletes or renumbers a row; a variant absent upstream is flagged and kept
- [ ] `provenance` and last-synced timestamp recorded per row
- [ ] Sync is a job with observable progress, not a blocking request
- [ ] **Demo: press sync, see the variant count and last-synced time in the app**
