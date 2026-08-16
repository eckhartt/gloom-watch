---
id: 01M03XAAMK96EN2TFBHEYGABXQ
type: decision
title: How does the card corpus get in, stay current, and hold images?
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
meta:
  ticket: grilling
  hitl: yes
  claimed: interview-session
---
## Resolution

**A two-phase pull from TCGdex, filtered locally, upserted without ever
hard-deleting, with images stored on disk as webp.**

## Ingest — two phases

```
1  GET /v2/{lang}/cards            per language, brief form
   -> 23,546 EN cards in one 2.3 MB response
   -> filter LOCALLY:
        dexId ∈ {43, 44, 45, 182}
        UNION name-contains {oddish, gloom, vileplume, bellossom}
        MINUS TCG Pocket set-ID prefixes (A#, B#, P-A)

2  GET /v2/{lang}/cards/{id}       ~475 detail fetches
   -> only detail carries variants_detailed
```

**Filtering locally rather than server-side is the decision.** If the masterset
boundary is ever revised, re-scoping costs a re-filter of data already held
instead of a fresh crawl.

No API key, no auth, no published rate limit — but the detail fetches are
politely paced regardless. 25 rapid sequential requests all returned 200 with no
throttling headers, which is an absence of evidence, not a guarantee.

## Refresh — manual only

**Sync runs when the owner presses the button.** The app shows the last-synced
date; it does **not** check upstream for changes.

**Accepted consequence, recorded plainly: the corpus can drift silently.** New
sets release a few times a year, and TCGdex has no `updated-since` query
(`?updated=gt:` returns nothing, and `sort:field=updated` is not
recency-ordered), so nothing surfaces a stale corpus automatically.

Concretely: a new Gloom releases, the corpus is not synced, and its listings
arrive at the matcher for a card that does not exist locally — landing in the
confirm queue as unmatched, or matching the wrong variant. This is
self-signalling *eventually*, through queue noise, but not immediately.

An upstream-change check against the cards-database commit feed was offered and
declined — it would have turned "34 days ago" into "34 days ago, 12 changes
since". Cheap to add later if drift becomes annoying.

## Re-import safety

The rules that keep a re-import from breaking the collection:

- **Upsert key: `(card_id, variantId)`.** Never `variantId` alone — it is a hash
  of the variant attribute set and is shared across different cards.
- **Import never touches `provenance = manual` rows.**
- **A variant that vanishes upstream is flagged `missing_upstream` and kept**,
  never deleted. A copy or an owner photograph may point at it, and upstream
  removing a record by mistake must not take an ownership record with it.
- **Canonicalise `stamp` on the way in.** Both `1st-edition` and `1st edition`
  occur in TCGdex at comparable frequency (18 vs 16). **Missing this silently
  drops half the 1st Edition corpus** — the filter returns results, just the wrong
  ones, which is why it must happen at ingest and not at query time.
- **Record `source` and `last_synced_at` per row.** Cheap, and the only way to
  debug a bad import six months later.

Delete-and-rebuild was rejected outright: it orphans copies pointing at rows that
moved. Hard-deleting vanished rows was rejected for the same reason.

## Images

**`high.webp` for every matched card, stored on the filesystem beside the
database.**

| Format | Size for 361 images |
| --- | --- |
| high.png | ~107 MB |
| **high.webp** | **~20 MB** |
| low.webp | ~5 MB |

- **Incremental sync via `assets.tcgdex.net/datas.json`** (6.4 MB), a
  per-language/per-set/per-card **image hash manifest** — refetch only what
  actually changed.
- **URLs are case-sensitive**: `/ja/SV/SV3/002/high.png` works, lowercase `sv`
  404s.
- **Owner photographs live alongside in a separate directory.** Both go in the
  backup, but only owner photos are irreplaceable — corpus images are
  re-downloadable, and for most pre-2021 Japanese cards the owner's photo is the
  only image that will ever exist (TCGdex covers 28% of Japanese cards, none
  before 2021).

Hotlinking was rejected: it breaks offline browsing entirely and leaves the app
exposed to URL changes, rate limits, or the project disappearing.

## Offline — three layers

1. **Precache** (`injectManifest`): app shell, JS, CSS, icons. Small, fast
   install.
2. **Runtime `CacheFirst`**: card images as they are viewed.
3. **Explicit bulk warm**: a "download all images" action, ~20 MB, for before a
   card fair or a flight. **Always user-initiated, never automatic.**

Precaching all 361 images was rejected: it makes service-worker install slow and
fragile, and a single 404 can fail the entire install.

## Manual variant entry — clone and edit

Most gaps are a Korean or Simplified Chinese printing of a card that already
exists in English or Japanese. **Cloning copies set, number and variant
attributes**, so the owner changes language and little else — far less typing and
far fewer subtle mistakes than a blank form.

```
find   Gloom, Jungle, ja
clone  -> new row, provenance = manual
edit   language ja -> ko; set name / number if they differ
photo  upload own (TCGdex has no image for it regardless)
```

A blank full-entry form remains available for anything with no relative to clone.

Known gaps this addresses: Korean (0 Oddish-line records despite 239 Korean cards
in TCGdex), Simplified Chinese (0 records), and "The Best of XY" (~4 cards, with
English rows to clone from).

## Unresolved: image licensing

**TCGdex's MIT licence covers the database, not the images.** Card images are
TPCi / Nintendo / Creatures / GAME FREAK copyright and TCGdex has no authority to
sublicense them. Their assets page documents URL formats but states no hotlink
policy and no bulk-download policy, either permitting or forbidding.

For a single-user private tracker this is the same posture every collection app
takes. **Recorded as a known, accepted risk — not something a clause resolves.**

## Alternatives weighed and rejected

- **`git clone` of cards-database** — full detail offline, no API load, and
  `git log` is the changelog the API lacks. Rejected because the data lives in
  TypeScript source under `data/` and `data-asia/`, so ingest would parse TS and
  couple to their internal file layout.
- **Server-side filtered queries** — smallest transfer, but re-scoping means
  re-crawling.
- **Weekly scheduled re-pull** — would have removed drift entirely; declined in
  favour of manual control.
- **Upstream-change check via the commit feed** — declined; cheap to add later.
- **Delete-and-rebuild on import** — orphans copies.
- **Hotlinked images** — no offline, and hostage to upstream.
- **Thumbnails only, full size on demand** — smaller, but detail views need
  network.
- **Precache every image** — slow, fragile installs.
- **Blank-form-only manual entry** — more typing, more mistakes.
- **Scrape-from-URL manual entry** — least typing when it works, a scraper to
  maintain when it does not.
