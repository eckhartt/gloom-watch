---
id: 01M04MT0SV4MAXGQKY0S90PDE6
type: decision
title: The scanner backfills existing inventory once at commissioning
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
---
## Resolution

**The scanner performs a one-time backfill sweep of existing inventory at commissioning,
before the forward cursor starts.**

This fills a gap none of the map's decisions noticed, exposed by a fact-check of
*Which eBay API surfaces newly-listed cards* (`01m03x9xfd`).

## The gap

The scan design cursors forward on **`itemStartDate`**, and eBay documents that filter
and `sort=newlyListed` as keying off **`itemOriginDate`**:

> "The date and time when the **listing was first made available**. **This date will be
> retained if an item is relisted.**"

Two consequences follow, neither of them previously recorded:

1. **The scanner only ever sees listings created after it starts running.** Everything
   already for sale is permanently outside every window it will ever request. eBay
   currently carries ~25,000 active Gloom listings in the US card category alone — on
   day one the app would be blind to all of them.
2. **Relisted stock is invisible.** Because `itemOriginDate` survives a relist, an item
   relisted today still carries its original date and never re-enters a newest-first
   window.

For a masterset hunt this inverts the value of the feed: **a card that has sat unsold for
six months is exactly the obscure printing the collection needs**, and it is precisely
the card a forward-only cursor can never surface.

## The backfill

At commissioning, and before the forward cursor is armed:

```
for each (keyword, marketplace):
    page through active inventory  (limit 200, follow `next`)
    run every result through the matcher
    record listings, matches and confirm-queue entries as normal
    seed seen_items with every itemId encountered
then:
    set each marketplace cursor to now
    arm the forward scan
```

**Cost is trivial and one-off.** ~25,000 listings at 200 per page is roughly 125 calls per
keyword-marketplace pair, against a 5,000/day quota — a single-digit percentage of one
day's budget, spent once.

**Seeding `seen_items` is the point, not a side effect.** Without it the first forward
cycles would re-notify everything the backfill already recorded.

**The backfill does not notify.** It populates the corpus of observed listings and the
confirm queue; it does not push. A cold start that fired a digest of several hundred cards
would be noise, and the owner can browse the backfilled feed directly.

## What this does NOT change

**The relist guard from `01m04je8wa` is still needed and is not dead code.** Relists that
retain their `itemId` and `itemOriginDate` are invisible and need no suppression — but a
seller who *ends* a listing and creates a genuinely new one produces a **new `itemId` and
a new `itemOriginDate`**, which is visible to the cursor and is exactly what the guard
catches. The guard's job is narrower than originally described, not absent.

## Re-sweeps are deliberately not scheduled

A periodic full re-sweep was considered and rejected for v1: it costs quota continuously,
produces large duplicate result sets to dedupe against `seen_items`, and buys little once
the backfill has run and the forward cursor is healthy. **If relisted stock later proves
worth catching, the cheap upgrade is a periodic re-sweep rather than a redesign** — and the
`seen_items` table already makes it safe to run.

## Alternatives weighed and rejected

- **Backfill plus a scheduled monthly re-sweep** — nothing stays invisible for long, at
  continuous quota cost and with duplicate handling on every sweep. Deferred rather than
  refused; see above.
- **No backfill, new listings only** — simplest, and the collection would fill as stock
  turns over. Rejected: the app would launch blind to the entire existing market, which is
  most of the market, and the cards it would miss are disproportionately the ones a
  masterset needs.
- **Keying the cursor on `itemCreationDate` instead** — that field *is* returned on every
  summary and does change on a relist, so it would catch relists. Rejected because it is
  **neither filterable nor sortable**: there is no way to request a window on it, so the
  scanner would have to over-fetch and filter client-side, spending far more quota to
  solve a problem the backfill plus the guard already covers.
