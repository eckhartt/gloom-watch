---
id: 01M04PM9T9XT74KN0SYZ41ZFC0
type: feature
title: Copies and completion
status: done
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
  - to: 01M04PMABR6SV1W2V18DQC6YA1
    type: blocks
  - to: 01M04PMAX67AJSF3H22Z0VB3NZ
    type: blocks
  - to: 01M04PMBEPRKRVGC1GJPMBNR18
    type: blocks
  - to: 01M04PMS9DHFMM2HR6H4H618W9
    type: blocks
bindings:
  branch: feat/copies-completion
meta:
  ticket: build
  claimed: copies-agent
---
## What to build

Recording the cards you actually own, and the completion figure that follows from it.

A copy is **one physical card**, pointing at exactly one variant — never a quantity count.
Condition uses the hobby ladder `NM / LP / MP / HP / DMG`, which is **not** eBay's
vocabulary and is not claimed to be.

Money is stored as integer minor units paired with an ISO 4217 code, never a float. Grade is
integer tenths so `PSA 8.5` compares exactly.

Disposal retains the row.

## Acceptance criteria

- [x] Add, edit and dispose a copy from the variant sheet
- [x] Condition, grader, grade, cert number, price with currency, home-currency snapshot with its rate date, acquisition source and note all persist
- [x] Grade requires a grader; a home-currency amount requires its currency and rate date
- [x] Two copies of one variant coexist with different conditions and prices
- [x] Disposed copies keep their row and drop out of ownership
- [x] **Every ownership query filters on owned status** — verified by a test that would fail if one did not
- [x] Completion numerator counts variants with at least one owned copy
- [x] Completion denominator excludes `missing_upstream` variants **unless owned**
- [x] Completion is invalidated on corpus sync, copy creation and disposal
- [x] Priority is settable on an unowned variant
- [x] Client-generated UUIDs are the identifiers for copies
- [x] **Demo: mark cards owned and watch completion move** — in a browser at 390×844

---

## Commissioning record

Deployed to `htpc` at `799c6e0`. The database was backed up with
`VACUUM INTO data/pre-copies-backup.db` before the migration ran.

| check | result |
| --- | --- |
| migrations applied | **5** |
| corpus after migration | 817 variants — unchanged |
| `GET /api/completion` | `{"owned": 0, "total": 817, "missingUpstreamExcluded": 0}` |
| binder entries carrying `priority` | all 817 |
| grade without a grader | **400** — *"a grade needs a grader — PSA 9 and BGS 9 are different claims"* |
| non-UUID id | **400** — *"id must be a UUID minted by the client"* |
| home amount without its currency | **400** — *"a home-currency amount needs its currency"* |
| rows written by those probes | **none** — completion still `0 / 817` |

**No copy was created on the production database.** There is deliberately no delete route, so a
test row would have been permanent in the owner's collection. The write path was proved in a
browser instead; the first real copy is the owner's to make.

### The demo, driven in a browser at 390×844

`0 / 176` → record a copy (NM, 12.50 AUD, source ebay) → State reads **"1 copy owned"**,
completion `1 / 176` → dispose it as *sold* → the row stays with `NM` struck through and
`disposed 2026-08-16 · sold`, State reverts to **"needed"**, completion back to `0 / 176`.

The denominator rule was visible in the same run: 180 variants, 4 flagged missing upstream and
unowned, denominator **176**. Priority set to `3 — pushes instantly` survived closing and
reopening the sheet. Console clean at all eleven checkpoints.

## The ownership filter is enforced, not asserted

The criterion asks for a test that catches the **class**. Four things close it:

1. **There is exactly one ownership query** — `readOwnedCopyCounts`, the seam the binder ticket
   left. `readCompletion` calls it rather than querying the table again, so the surface where the
   filter can be forgotten is one function, not a growing list.
2. **`tests/helpers/sql-spy.ts` shadows `prepare` on the SQLite connection**, which Drizzle's
   `bun-sqlite` driver calls for every statement. `tests/ownership-filter.test.ts` exercises the
   HTTP surface and the document builders, then holds every captured `SELECT` that reads `copies`
   to one rule: **the text after the select list must name `status`**. Cutting away the select
   list is the sharp part — `select "status" from "copies"` mentions the column and constrains
   nothing, and a check that could not tell those apart would pass the exact query this exists to
   catch. The rule has no exceptions, including where it is redundant against a primary key,
   because a rule with one exception is one a reader has to check rather than trust.
3. **A source-level boundary**: exactly two modules may import the `copies` table. A new
   ownership query cannot be written somewhere no test exercises. Asserted as an equality against
   the allow-list rather than "no offenders", so it cannot pass by matching nothing.
4. **The behavioural half**: a database holding nothing but disposed cards reads as a collection
   of nothing, on all four surfaces at once, while every row is still there.

**Verified independently at review by deleting `.where(eq(copies.status, OWNED))`** — 4 tests
across 2 files fail, both the statement spy and the behavioural check.

## Schema

Migration `0004_copies.sql`: two `CREATE TABLE`s, two `CREATE INDEX`es. **No `DROP`, no `ALTER`,
no rebuild.** Rehearsed on the real upgrade path — apply `0000`–`0003`, add corpus rows, then
migrate — 4 → 5 migrations, corpus untouched, idempotent on re-run.

`copies.id` is the client's UUID and the primary key. The variant is a **composite foreign key**
onto `corpus_variants(card_key, variant_id)`, and `PRAGMA foreign_keys = ON` was already set in
`server/db/client.ts`, so a copy of half an identity is unrepresentable rather than discouraged.
That matters because `variant_id` alone is shared by 264 cards on the live corpus.

Index `(status, card_key, variant_id)` — status first, because the one ownership query filters on
it and then groups by the pair, so that index *is* the query.

Five `CHECK` constraints, chosen on one principle: **only the invariants whose violation is
silent**. A `status` of `Owned` drops a card out of the collection with no visible symptom; a bad
`condition` shows up as a strange label, so that one is validated in TypeScript instead. The
constraints exist alongside the validator because an import route and an outbox replay are both
stated requirements, and a rule enforced only in a request handler holds only for requests.

`variant_priorities` is **its own table, not a column on `corpus_variants`**. The sync owns every
column of that table and upserts them from upstream; a priority sitting among them would survive
only for as long as nobody added it to an `excluded.*` list. In a separate table, surviving a
re-import is structural. Clearing deletes the row rather than storing a zero, because `0` is a
real rung on the 0–3 scale.

## Completion

```
numerator   = variants with >= 1 copy at status = 'owned'
denominator = variants, except those flagged missing_upstream that are not owned
```

A variant whose *card* is flagged counts as flagged — the same rule `buildBinderDocument`
applies, so the grid and the figure cannot disagree. The document carries
`missingUpstreamExcluded` because the denominator rule is otherwise invisible: the figure can
move without the owner touching anything.

**Nothing is cached server-side, deliberately.** A memo would have to be invalidated by a corpus
sync — and `bun run corpus:sync` is an OS-level `Bun.cron` entry in a **different process**,
which cannot reach the HTTP server's memory. The cache would be precisely the thing that made
the figure wrong after the first event the spec names. It is a scan of ~800 rows against an
index.

The caches that do exist are invalidated: the client's query cache maps an event to the keys it
falsifies (a copy write drops `["binder"]` and `["completion"]`; a sync drops those plus
`["corpus-status"]`, because the denominator is not constant), and the binder's ETag hashes the
entries and therefore `ownedCopies`.

Completion is shown on `/status` as `owned / total` — **not above the grid**, which the binder
ticket forbids, and **not as a percentage**, because rounding `312 / 817` to `38%` is a
presentation decision nobody has made and throws away the only two figures anybody agreed on.

## Money

`¥4,200` is **4200** minor units, not 420,000. A blanket multiply-by-a-hundred would have stored
every Japanese price a hundred times too large — and a large part of this masterset is Japanese,
so it would have been most of the collection, reported by nothing. The zero-decimal and
three-decimal ISO 4217 codes are a table rather than an `Intl` lookup, for the same reason the
binder's card-number comparator is hand-rolled: an answer that depends on the runtime's ICU
version is not an answer.

**More decimal places than the currency has is a rejection, never a rounding.** The same shape
catches a units mistake on grades: `parseGradeTenths` refuses anything below 1.0, so a `9` typed
into a field expecting tenths — 0.9, plausible and a tenth of what was meant — becomes a message
instead of a wrong slab.

The split is: **the client converts, the server validates.** The server never sees `8.5` or
`12.50`, only `85` tenths and `1250` minor units.

## Open, and named rather than smoothed over

- **A mistaken disposal cannot be undone through the API.** There is no un-dispose route and
  `PATCH` deliberately refuses to touch `status`, so an edit cannot take a card out of the
  collection by accident. A mis-tap on Dispose is permanent short of a SQL statement. The confirm
  step and the wording are the mitigation. **The next ticket that touches this surface should
  decide about it rather than inherit it silently.**
- **The sheet's copy list does not work offline** — it is a live request per variant. The binder
  grid and its ownership state do, because they are in the cached document. Correct for this
  ticket (offline writes are `01m04pms9d`), but opening a sheet off-tailnet shows the ownership
  count and an error where the purchase trail should be.
- **The binder's three-signal owned treatment is weaker on cards with no artwork.** The
  desaturation cue has nothing to act on, leaving the green border and corner dot — both
  unmistakable, but two signals rather than three. On the live corpus **497 cards hold 382
  images**, so roughly 115 cards are affected. Flagged, not redesigned: the treatment belongs to
  the binder ticket.
- **No copy has ever existed on the production database**, so no owned cell has rendered on real
  data and no corpus sync has run against a database holding copies. The re-import safety is
  structural — the sync never deletes and never names either new table — but it is untested
  against real copies.
- **`cert_no` is not unique.** The spec's "uniquely identifies this physical slab" is a statement
  about what the number means, not a constraint that could safely be enforced.
- **`HOME_CURRENCY` is a constant, not a setting.** Making it tunable would require answering
  what happens to `price_home_minor` amounts already stored against the old one.
- **The spec and the binder ticket disagree on how many cards share a `variant_id`** — the spec's
  *Identity* section says 90, the binder's commissioning record measured 264 live. Nothing
  depends on which is right; the identity is composite either way.

## What the next ticket inherits

- `server/copies/repository.ts` owns every statement touching the collection's tables, and the
  ownership-filter test enforces that boundary.
- **Every mutation is already idempotent**, which is exactly what the outbox (`01m04pms9d`)
  needs: the create is keyed on the client's UUID and answers `200` rather than `201` on a
  replay, the patch is last-write-wins, the disposal keeps the first disposal's date, and the
  priority write is a replacement. Routes: `POST /api/copies`, `PATCH /api/copies/{id}`,
  `POST /api/copies/{id}/disposal`, `PUT /api/priorities`.
- **Filters (`01m04pmabr`)** get `ownedCopies` and `priority` on every binder entry — both named
  as filter axes by the spec.
- **Photographs (`01m04pmax6`)** attach to `copies.id`, a stable client-minted UUID.
- **Hand-added variants (`01m04pmbep`)** must insert a `corpus_variants` row before a copy or a
  priority can point at it — two composite foreign keys depend on it.
- `shared/money.ts` is where any future price should go through.
