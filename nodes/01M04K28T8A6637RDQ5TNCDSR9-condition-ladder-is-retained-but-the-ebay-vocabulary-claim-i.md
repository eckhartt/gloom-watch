---
id: 01M04K28T8A6637RDQ5TNCDSR9
type: decision
title: Condition ladder is retained, but the eBay-vocabulary claim is withdrawn
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
---
## Resolution

**The condition ladder stays `NM` / `LP` / `MP` / `HP` / `DMG`, but the reason given for
it in `01m03xa7ty` was false and is withdrawn.**

This supersedes the condition-vocabulary claim in *What does the app record about a copy
you own?* (`01m03xa7ty`). **Every other field in that ticket stands unchanged** — the
one-row-per-physical-card model, grading fields, currency handling, the seller-username
ban, disposal retention, photographs, and priority living on the variant.

## What was claimed, and what is actually true

`01m03xa7ty` asserted the ladder was **"exactly eBay's Card Condition vocabulary,
measured live"**, listing Near Mint or Better, Lightly Played, Moderately Played and
Heavily Played with facet counts, and concluded that a listing's condition maps onto a
copy's **"with no translation layer and no judgement call"**.

**eBay's Card Condition vocabulary has four values and three of the four names differ:**

| `01m03xa7ty` claimed eBay says | eBay actually says |
| --- | --- |
| NM — "Near Mint or Better" | "Near mint or better" — matches |
| LP — "Lightly Played" | **"Excellent"** |
| MP — "Moderately Played" | **"Very good"** |
| HP — "Heavily Played" | **"Poor"** |
| DMG — "Damaged" | **no such value** |

Verified against eBay's own seller help page *Item conditions by category* (id=4765),
in which the strings "Lightly", "Moderately", "Heavily" and "Played" occur **zero
times**, and corroborated by the Sell Metadata API OpenAPI contract, which gives
descriptor `40001` = "Card Condition" and value `400012` = "Very Good".

**`NM / LP / MP / HP / DMG` is the TCGplayer / Cardmarket ladder.** The two were
conflated during that interview.

## The second, independent failure — and it is the expensive one

**Card condition is not reachable from a search result at all.**

For trading cards, `conditionId` encodes only a binary:

- **`2750` (`LIKE_NEW`) = graded**
- **`4000` (`USED_VERY_GOOD`) = ungraded**

The real condition lives in **`conditionDescriptors`**, which is present on the Browse
API's `Item` schema — returned by `getItem` — and **absent from `ItemSummary`**, the
object `item_summary/search` returns.

So obtaining a listing's card condition costs **one `getItem` call per listing**, out of
the same 5,000/day pool as the searches. At 1,000–3,000 new listings a day that is
precisely the per-item enrichment already ruled out of scope.

**Therefore the no-translation property was void regardless of which ladder was chosen.**
There is nothing to translate *from* in the data the scanner actually receives.

## What follows

- **The ladder is retained on its own merit**: it is the vocabulary the hobby uses, the
  one every other marketplace and price guide shows, and the one the owner will use in
  conversation. It is no longer justified by an eBay mapping.
- **Listings carry graded/ungraded only.** The raw-only and graded-only hunting filters
  from `01m03xa9gz` still work, because that binary *is* on `ItemSummary`.
- **Notifications cannot include a listing's condition.** Any content template implying
  otherwise is wrong.
- **A documented foot-gun:** `conditionId` `4000` has the display name "Very Good" and
  the token `USED_VERY_GOOD`, but for a trading card it means **ungraded**. A naive
  `conditionId` → ladder mapping would read every raw card on eBay as "Very Good". Never
  map `conditionId` to a condition for trading cards.
- **Never hard-code condition descriptor IDs.** eBay does not publish them statically and
  directs integrators to `getItemConditionPolicies` in the Metadata API, per category per
  marketplace. The Browse contract twice instructs implementers to "code so that your app
  gracefully handles any future changes to this list."
- **The cert-number descriptor is confirmed as a concept but not as a number.** It is an
  optional, free-text descriptor (max 30 characters) available for graded cards, with
  Grader and Grade required alongside it. The ID `27503` cited in `01m03xa7ty` could not
  be verified in any primary source and **must not be hard-coded**.

## Alternatives weighed and rejected

- **Adopt eBay's four values** (Near mint or better / Excellent / Very good / Poor) —
  would match what a `getItem` call returns if enrichment is ever added. Rejected: no
  collector uses that vocabulary conversationally, and it has no rung for a damaged card,
  so the owner would lose expressiveness on their own collection to match a field the app
  does not read.
- **Keep the ladder and maintain an explicit mapping to eBay's four** — would let a
  future enrichment populate condition automatically. Rejected for v1 as work in service
  of a call the app does not make; the mapping is also lossy, since nothing on eBay's
  side maps to `DMG`. Revisit if per-item enrichment is ever added for high-priority
  variants.

## Why this is recorded rather than quietly corrected

`01m03xa7ty` is frozen, and its stated reasoning is load-bearing for anyone later asking
"why these five values, and can we read condition off a listing?" Leaving a false
justification in place would invite an implementer to build the enrichment it implies is
free.
