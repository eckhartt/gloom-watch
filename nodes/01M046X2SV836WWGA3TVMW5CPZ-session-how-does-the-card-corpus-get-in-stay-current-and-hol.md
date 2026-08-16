---
id: 01M046X2SV836WWGA3TVMW5CPZ
type: session
title: "session: How does the card corpus get in, stay current, and hold images?"
status: closed
parent: 01M03XAAMK96EN2TFBHEYGABXQ
---
# Session close-out

Interview session resolving `01m03xaamk` — corpus ingest and images. Two rounds,
ACKed, frozen. **Nine of ten decisions on this map are now ruled.**

## What changed

- **`01m03xaamk` is `ruled`.**
- **Narrowed the offline fog patch** on the map: reading offline is now settled,
  so the remaining fog is specifically **offline *writes*.**

## The decision

**Two-phase pull:** brief card list per language (23,546 EN cards in one 2.3 MB
response) → filter locally → ~475 detail fetches for matches, since only detail
carries `variants_detailed`. **Filtering locally is the point** — re-scoping later
costs a re-filter, not a re-crawl.

**Manual sync only**, last-synced date shown, no upstream check.

**Upsert by `(card_id, variantId)`, never hard-delete.** Vanished-upstream rows
are flagged and kept; import never touches `provenance = manual`; `stamp` is
canonicalised at ingest; every row records `source` and `last_synced_at`.

**Images: `high.webp` on the filesystem** (~20 MB for 361), incremental via
TCGdex's `datas.json` hash manifest, case-sensitive URLs. Owner photos alongside
in their own directory.

**Offline reading in three layers:** shell precached, images `CacheFirst`,
explicit user-initiated bulk warm.

**Manual variants by clone-and-edit** — most gaps are a Korean or Chinese
printing of a card that already exists, so cloning copies set, number and variant
attributes.

## Risks accepted, explicitly

- **Silent corpus drift.** Manual sync with no upstream check means "34 days ago"
  cannot tell you whether it matters. A new Gloom releases, you have not synced,
  and its listings hit the confirm queue as unmatched or match the wrong variant.
  Self-signalling eventually via queue noise, not immediately. **An upstream
  commit-feed check was offered and declined — cheap to add later.**
- **Image licensing.** TCGdex's MIT covers the *database*; images are TPCi /
  Nintendo / Creatures / GAME FREAK copyright and TCGdex cannot sublicense them.
  Their assets page states no policy either way. Standard posture for a
  single-user private tracker; recorded, not resolved.

## Open questions

Frontier is **one**:

- **`01m042kp8g` — backup, export and restore.** Irreplaceable: copies,
  owner photographs, manual variants, priorities, **the alias table and match
  confirmations**. Re-derivable: the corpus and its images. Key constraint:
  **`bun:sqlite` has no `backup()`** — only `.serialize()`, which loads the whole
  database into memory — so use **`VACUUM INTO`** (verified, 118 KB in 1 ms), and
  the target must be off-machine. Also worth covering: **the VAPID keypair**,
  and whether open-format export (CSV/JSON) is in v1.

**Ruling that one completes the map**, after which `ork-spec` synthesizes and
`ork-tickets` cuts the build queue.

## Still fog

PWA shape; how the phone authenticates (now narrow — the tailnet is the
perimeter); **offline writes** (the shell loads from cache while the API is
unreachable, so this needs an answer); marketplaces beyond eBay.

## Links

- Commits: `orchestrator` branch — `01m03xaamk`, map `01m03x4d6h`
- PR: none
