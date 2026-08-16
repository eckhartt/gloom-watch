---
id: 01M05BVK53F7SDK0SCNFBVTGD3
type: session
title: "session: Filters and offline browsing"
status: closed
parent: 01M04PMABR6SV1W2V18DQC6YA1
---
## What changed

Three build tickets shipped, each built by its own agent in its own worktree, reviewed, merged,
deployed to `htpc` and commissioned before the next one started. `main` went `bf24a43` →
`b7e617a`. Six of fifteen build tickets are now done.

| ticket | commit | tests after |
| --- | --- | --- |
| Binder view (`01m04pm99f`) | `c2e2878` | 249 / 22 files |
| Copies and completion (`01m04pm9t9`) | `799c6e0` | 315 / 29 files |
| Filters and offline browsing (`01m04pmabr`) | `b7e617a` | 379 / 31 files |

The box runs `b7e617a`: 5 migrations, 497 cards, 817 variants, 382 images, **137 sets with
release dates**, completion `0 / 817`. Databases were backed up with `VACUUM INTO` before each
migrating deploy — `data/pre-binder-backup.db` and `data/pre-copies-backup.db`.

Each ticket's own body carries its full commissioning record. This is what a later session needs
that those do not each repeat.

## Decisions made

**Set release dates go in the corpus pipeline, not a separate fetcher.** Decided before briefing,
on evidence: `/v2/{lang}/sets` omits `releaseDate` and `/v2/{lang}/series/{id}` dates only the
series, so only the per-set detail carries it and there is no bulk form. The corpus references
**137 distinct `(language, set_id)` pairs**, not 46 × 11 = 506 — counted against production
first, and the implementation independently arrived at the same 137. Release date has the same
provenance as `set_name`, which the corpus already stores, so splitting them would mean two
fetchers reading one upstream object. A re-sync costs **zero** further requests; a date is a
historical fact.

**Language is part of a set's identity**, keyed `{language}:{set_id}`, for the same reason it is
part of a card's: Japanese `SV3` shipped 2023-07-28 and English `sv03` 2023-11-03, and one row
per set ID would order one by the other's date.

**No copy was ever written to the production database.** There is deliberately no delete route,
so a test row would be permanent in the owner's collection. The write path was proved in a
browser; the validators were probed live and confirmed to reject and write nothing. The first
real copy is the owner's to make.

**Completion is not cached server-side, deliberately.** A memo would have to be invalidated by a
corpus sync running as an OS-level `Bun.cron` entry in a *different process*, so the cache would
be precisely the thing that made the figure wrong after the first event the spec names.

**`variant_priorities` is its own table**, not a column on `corpus_variants`. The sync owns every
column of that table; a priority among them would survive only as long as nobody added it to an
`excluded.*` list. Separate, surviving a re-import is structural.

## What the live corpus proved that documents only asserted

- **`variant_id` collapse is real**: 817 binder entries carry **21 distinct `variant_id`s**. A
  React key of `variant_id` alone renders 21 cells and drops 796 with no error anywhere.
- **The spec and the binder ticket disagree on the sharing factor** — the spec's *Identity*
  section says 90, the live measurement is **264**. Nothing depends on which is right; the
  identity is composite either way. Worth correcting if a rev 4 is ever cut.
- **Ordering works end to end**: newest `2026-01-30 me02.5`, oldest `1997-03-05 PMCG2` — the
  Japanese Jungle print, the oldest Oddish-line card there is. Zero undated sets.

## Three defects that no test suite would have caught

Each was found by running or looking at the thing, and each is now pinned by a test:

1. **The binder ETag hashed `generatedAt`.** Every test passed because they froze the clock;
   against a running server no `If-None-Match` ever matched and the phone would have
   re-downloaded ~290 KB on every revalidation. Verified fixed on the box — identical ETags two
   seconds apart.
2. **The owned ring was an inset `box-shadow`** on an element whose full-bleed `<img>` paints on
   top of it. Perfectly correct computed style, zero pixels on screen.
3. **`?priority=7&state=needed` replaced the binder with the router's error page.** TanStack
   Router validates per matched route and merges each result **over its parent's**; the root
   route has no validator, so a parameter the index route *rejected* still reaches the component.
   It only crashes when at least one other axis validates, which is why the obviously-malformed
   URLs looked fine.

## Open questions

- **The three handset demos are the only unmet acceptance criteria.** Browse the masterset;
  mark a card owned and watch completion move; aeroplane mode and filter to what you still need.
  All three need the owner's iPhone. **The third is the one that matters most**: the browser's
  offline emulation left `navigator.onLine` as `true`, so the paused-query path that
  `networkMode: "offlineFirst"` defends against was never exercised outside a unit test. A real
  iPhone in aeroplane mode is the only proof.
- **Anything reading `useSearch` must treat its input as untrusted** until the root route gains a
  `validateSearch`. That is the cheapest permanent fix and nobody has made it.
- **A mistaken disposal cannot be undone through the API.** No un-dispose route, and `PATCH`
  refuses to touch `status`. Permanent short of a SQL statement. Flagged twice now; **whoever
  next touches that surface should decide about it rather than inherit it silently.**
- **The sheet's copy trail does not render off-tailnet** — it is a live request per variant. The
  grid and its ownership state do. Correct for these tickets; the outbox (`01m04pms9d`) is where
  it changes.
- **The owned tile treatment drops from three cues to two on cards with no artwork** — the
  desaturation half has nothing to act on. 497 cards hold 382 images, so ~115 are affected. The
  border and dot carry it, but the three-signal claim is true only where there is a picture.
- **No corpus sync has ever run against a database holding copies.** The re-import safety is
  structural — the sync never deletes and never names `copies` or `variant_priorities` — but it
  is untested against real data.
- **`GET /api/binder` must stay parameterless.** The service worker caches by URL; a URL that
  varied by filter would leave it holding one arbitrary slice of the masterset. Asserted by test
  and re-verified on the box by ETag.
- **The eBay keyset is still the long pole.** The owner's developer account is under manual
  review, and it gates `01m04pmc04` and five tickets behind it.

## Links

- Commits: `c64b712`, `c2e2878` (binder) · `799c6e0` (copies) · `b7e617a` (filters)
- Branches: `feat/binder-view`, `feat/copies-completion`, `feat/filters-offline` — all merged
  fast-forward, worktrees removed
- Frontier now: `01m04pmax6` Owner photographs · `01m04pmbep` Hand-added variants ·
  `01m04pms9d` Offline writes — the outbox · `01m04pmc04` eBay client (owner-gated)
- Housekeeping: Docker build cache pruned on the box, **11.71 GB** freed, 98% → 95%, 11G → 21G
  free. Passwordless sudo is still enabled at `/etc/sudoers.d/nicholas-nopasswd`.
