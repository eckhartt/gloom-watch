---
id: 01M04PM99F3T138S12SFCPGM1G
type: feature
title: Binder view — the visual grid of every variant
status: active
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
  - to: 01M04PM9T9XT74KN0SYZ41ZFC0
    type: blocks
bindings:
  branch: feat/binder-view
meta:
  ticket: build
  claimed: binder-agent
---
## What to build

The binder — the app's primary surface. A visual grid of every variant where the collection
and its holes are readable at a glance.

Served as **one cacheable document** containing every variant plus ownership state. Not
paginated: this single request is what makes offline browsing and client-side filtering
possible later.

Tapping a card opens a **bottom sheet**, not a new page — the binder stays as context.

Default order is set release date descending, then card number. **No aggregate density map
above the grid.** Style is dense, precise and typographic.

## Acceptance criteria

- [x] One request returns the whole binder document; it is cacheable and unpaginated
- [x] Grid is virtualised and scrolls smoothly over ~765 cells on the phone
- [x] Card images served from BLOBs, cached `CacheFirst` by the service worker
- [x] Owned and needed are distinguishable at a glance without reading text
- [x] Tapping a card opens a bottom sheet showing the corpus image and the variant's axes
- [x] The sheet does not navigate away; dismissing it returns to the same scroll position
- [x] No aggregate summary rendered above the grid
- [ ] **Demo: browse the entire masterset on the phone** — awaiting the owner's handset

---

## Commissioning record

Deployed to `htpc` at `c2e2878` and exercised against the live corpus. The database was backed
up first with `VACUUM INTO data/pre-binder-backup.db`, before the migration ran.

| check | result |
| --- | --- |
| migrations applied | **4** |
| corpus after deploy | 497 cards, 817 variants, 382 images — unchanged |
| `GET /api/binder` | `200`, **297,461 bytes**, `private, no-cache` + strong ETag |
| conditional `GET` | `304`, **0 bytes** |
| ETag across two requests, 2s apart | **identical** |
| binder entries | **817** |
| distinct entry keys | **817 of 817** |
| distinct `variant_id`s | **21** |
| entries with no release date | **0** |
| entries owned | 0 — there is no copies table yet |

### The `variant_id` collapse is real, and it is live

817 entries carry **21 distinct `variant_id`s**. A React key of `variant_id` alone renders 21
cells and drops 796 with no error anywhere. `binderEntryKey(cardKey, variantId)` lives in
`shared/contract.ts` so the server and client cannot compose it differently, and it is pinned by
a test.

### Order, verified on real data

Newest first: `2026-01-30 me02.5-001 en Erika's Oddish`. Oldest last:
`1997-03-05 PMCG2-002 ja ナゾノクサ` — the Japanese Jungle print, which is the oldest Oddish-line
card there is. Within a set, card number ascending, and the several printings of one card
grouped together by `variant_id`.

The comparator is hand-rolled rather than `Intl.Collator`, because `local_id` holds `44`, `002`,
`SH3`, `XY99` and `TG05` and because a collator's answer depends on the ICU version the runtime
was built against — the binder's order must not shift because Bun updated. The order is
**total**, which is load-bearing: the ETag hashes the entries, so an order that depended on
SQLite's row order would change the ETag without the corpus changing.

## The `sets` phase

The binder's default order needs set release dates and nothing stored them. Checked against the
live API before any code was written:

| endpoint | carries `releaseDate`? |
| --- | --- |
| a card's own `set` object | no |
| `/v2/{lang}/sets` (the list) | **no** |
| `/v2/{lang}/series/{id}` | dates the *series*; lists its sets undated |
| `/v2/{lang}/sets/{setId}` | **yes**, plus `serie`, `abbreviation`, `cardCount` |

So there is no bulk form. Built as a new `sets` phase of the corpus sync, after `detail`, over
the `(language, set_id)` pairs the cards actually landed on. New table `corpus_sets`, keyed
`{language}:{set_id}` — language is part of a set's identity for the same reason it is part of a
card's: Japanese `SV3` shipped 2023-07-28 and English `sv03` 2023-11-03, and one row per set ID
would order one of them by the other's date.

`release_date` is an ISO `YYYY-MM-DD` string and is **rendered verbatim, never converted to an
epoch** — `new Date("1999-06-16")` is midnight UTC, which formatted west of UTC reads as the
15th.

### Measured on the box

| | |
| --- | --- |
| first sync | **137 sets fetched**, 0 flagged missing, **0 without a release date** |
| re-sync | **0 fetched, 137 unchanged** |

137, not 46 × 11 = 506: most sets exist in only one or two of the languages this line appears
in. The count was computed independently against the production database before the ticket was
briefed, and the implementation arrived at the same 137.

Zero on a re-sync because a release date is a historical fact. Three states *are* re-asked, each
meaning the fact is still missing: no row, a row with no date, a row flagged `missing_upstream`.
That "no row" case is also what makes the phase resumable — an interrupted sync leaves the rows
it wrote.

A 404 flags rather than deletes and writes a placeholder, so there is a record that the question
was asked. A transport failure is **not** a disappearance: nothing is written, nothing flagged,
and the next sync asks again.

## Three defects found by looking, not by testing

1. **The ETag hashed the whole body, including `generatedAt`.** Every test passed because the
   tests froze the clock; against a running server two consecutive requests produced different
   ETags, no `If-None-Match` ever matched, and the phone would have re-downloaded ~290 KB on
   every revalidation. Now hashes the entries only — which is also the right semantics, since
   what the client is asking is *has the masterset changed*. Verified on the box: identical
   ETags two seconds apart, `304` with an empty body.
2. **The owned ring was an inset `box-shadow`.** An inset shadow paints in the background layer
   and the artwork is a full-bleed in-flow `<img>` that paints on top of it — a perfectly correct
   computed style and not one pixel on screen. Moved to a positioned overlay.
3. **The needed rim used `--rule` (#22322a) against `--ground` (#0c1310)** — literally
   indistinguishable. A cue that is specified but invisible is worse than none, because it gets
   counted as one of the three.

## Ownership, and what the next ticket inherits

`server/binder/ownership.ts` is one function, `readOwnedCopyCounts(db)`, which honestly returns
an empty map because there is no copies table. Ownership already travels the whole way —
repository, document, wire contract, cell treatment, sheet — so **the copies ticket fills in that
one function and nothing else moves**. A hardcoded `false` in the client would have had to be
unpicked in five places, and the "distinguishable at a glance" criterion could not have been
proved before copies existed.

For `01m04pm9t9`:

- Key the index on `binderEntryKey(cardKey, variantId)`. **Never on `variantId`** — see above.
- **Filter `status = 'owned'` inside that function.** Disposed copies keep their rows; counting
  them inflates completion.
- `ownedCopies` is a count, not a boolean: a PSA 9 and a raw copy of one variant are two rows.
- Recording a copy must invalidate the `["binder"]` query. The ETag will differ because
  `ownedCopies` is inside the hash.

## Other changes worth knowing

- **`/` is now the binder; the old home screen is `/status`.** The spec's ruling is that the
  binder *is* the app. The SPA fallback already serves `index.html` for unmatched paths, so a
  cold load of `/status` works without the service worker.
- Service worker: `CacheFirst` for corpus images into their own cache with
  `purgeOnQuotaError: true` — iOS evicts storage without notice, and a strategy that throws on a
  full cache fails the image rather than merely not storing it. `NetworkFirst` with a 5s timeout
  for the binder document, the opposite trade, because it changes whenever the owner does
  anything.
- The image route matcher is tested against the **percent-encoded** `card_key`
  (`en%3Abase2-44`). A matcher written for the characters somebody expects in an identifier
  matches none of the 382 images, and the failure is invisible until the phone leaves the tailnet.
- Each tile carries an axis badge (`1ED · SHDW`, `HOLO`). Images attach to the **card**, not the
  variant, so four printings of Base Set Gloom are four cells sharing one picture — without the
  badge they are four identical tiles.
- `@tanstack/react-virtual` added, chosen for an explicit React 19 peer range and because it is
  headless, so the grid stays ordinary DOM the project's own CSS styles.
- `setsWithoutReleaseDate` is surfaced on `/status` in alarm colour when non-zero: the binder
  orders undated sets last, and a number climbing there is the only warning that the default
  order has stopped meaning what it says for part of the collection.

## Still open

- **The demo criterion.** Browsing the masterset on the handset needs the owner. Everything
  reachable without it is done, including a real browser at 390×844 against a database seeded to
  twice the live corpus: 4 columns, **40 cells in the DOM out of 1,584**, scroll → tap → escape
  returning to the same 5,000px offset, and no console output at any point.
- **That the service worker actually caches images on iOS**, and that the binder is browsable
  with the tailnet off. Strategies registered, matchers tested; Cache Storage under iOS eviction
  is not something a desktop browser proves.
- **No owned cell has ever rendered on real data.** The treatment was verified by temporarily
  faking the ownership index; that patch was reverted.
- Whether four columns is the right density in the owner's hand — `MIN_CELL_WIDTH` in
  `client/routes/binder.tsx` is the constant.
- The needed rim is deliberately faint (~6% contrast at the tile edge); the loud signal for
  needed is desaturation. Worth a second opinion on a real screen in real light.
