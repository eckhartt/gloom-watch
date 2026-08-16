---
id: 01M03XA7TY3EEWANSAG7KZSS3Y
type: decision
title: What does the app record about a copy you own?
status: ruled
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XAA33X9BVPKF8BP747MZV
    type: blocks
meta:
  ticket: grilling
  hitl: yes
---
## Resolution

**One row per physical card.** Each card the owner holds is its own row,
pointing at exactly one **variant**. Quantity counts were rejected: grading lives
on the copy, so a PSA 9 and a raw card of the same variant cannot share a row,
and duplicates are rarely identical enough for a count to describe them.

## The copy record

| Field | Required | Notes |
| --- | --- | --- |
| `variant_id` | **yes** | `(card_id, variantId)` — exactly one |
| `condition` | no | `NM` / `LP` / `MP` / `HP` / `DMG` — omitted for graded slabs |
| `grader` | no | PSA / BGS / CGC / SGC / ACE |
| `grade` | no | numeric |
| `cert_no` | no | uniquely identifies this physical slab |
| `price` | no | amount actually paid |
| `currency` | **with price** | never a bare number — see below |
| `price_home` | no | converted value **at time of purchase** |
| `home_currency` | no | assumed **AUD** |
| `rate_date` | no | the date the conversion was taken |
| `acquired_at` | no | date it arrived |
| `source_type` | no | `ebay` / `shop` / `trade` / `gift` / `auction` / `other` |
| `source_note` | no | free text, typed by the owner |
| `note` | no | free-form prose about this specific card |
| `photos` | no | zero or more owner photographs |
| `status` | **yes** | `owned` / `disposed` |
| `disposed_at` | no | set when status becomes `disposed` |
| `disposal_kind` | no | sold / traded / lost |

## Why the condition ladder is NM/LP/MP/HP/DMG

It is **exactly eBay's Card Condition vocabulary**, measured live: Near Mint or
Better (16,912), Lightly Played (5,077), Moderately Played (1,861), Heavily
Played (505). A listing's condition therefore maps onto a copy's with **no
translation layer and no judgement call**. A numeric 1–10 scale was rejected
precisely because it would require one.

## Why the cert number is worth transcribing

It is the only field that uniquely identifies the owner's physical slab in the
world, and **eBay exposes it as condition descriptor 27503**. That makes it
possible to recognise your own card if it ever resurfaces on the market.

## Currency — original plus a snapshot

Price is stored in the currency actually paid, **plus a home-currency value
captured at the moment of purchase.**

This is not redundancy. Roughly 17% of the Gloom market is Japanese cards priced
in yen, and **the historical exchange rate is unrecoverable later** — capture it
at entry or the number is gone permanently. Live conversion at display time was
rejected because it silently changes as rates move and misstates what was
actually paid.

**Assumption:** the rate is entered by hand. No FX API is in v1.

## Own photos are stored

Optional, zero or more per copy. Not vanity: **TCGdex has images for only 28% of
Japanese cards and none at all before 2021**, and Japanese is ~17% of this
market. For much of this collection the owner's scan is the only image that will
ever exist. Stock art also never shows the actual slab, centering or wear.

**Consequence:** photos join the owned copies as irreplaceable data, which is
what pushed backup out of map fog and into its own ticket.

## Disposal retains the row

A sold or traded card keeps its row with `status = disposed` and a date.

Retaining preserves the purchase history — deleted rows lose what was paid,
permanently — and keeps the upgrade trail visible (sold the LP once the NM
arrived). **Cost, stated plainly: every ownership query must filter on
`status = owned`, and it is easy to forget exactly once.**

## Two rulings that reach outside this ticket

### Free-text notes vs the no-defect-field ban

`01m03xa78k` barred a defect **field** — no enum column, no `is_miscut` boolean,
no filter or sort by defect, no miscut variant rows. A free-text note is
**unqueryable prose**: writing "slightly off-centre, bought cheap because of it"
does not resurrect per-object defects as modelled data, because nothing can
count, filter or match on it.

**The line that holds: defects are not data, but they can be remarks.**

### Seller data, and why it protects the hosting decision

**eBay's `seller.username` is never persisted.** Source is recorded as a coarse
category plus free text the owner types.

This is a compliance decision, not a modelling preference. Persisting eBay user
data removes the option to *opt out* of eBay's marketplace account-deletion
notifications — forcing a **subscription**, which requires a publicly reachable
HTTPS endpoint with a valid certificate. That would rule out a tailnet-only
deployment before `01m03xa8ys` had even been decided.

Hashing the username was rejected: whether a hash counts as persisted user data
is untested, and a grey area is not worth the feature.

## Priority lives on the variant, not the copy

Anything not owned is **implicitly wanted** — it is a masterset, so a separate
want-list would be redundant. What is added is an optional **priority** on the
variant, which is the dial the notification policy needs against a feed of
1,000–3,000 listings/day.

Recorded here because it came out of this interview, but note it is a field on
the variant table, outside the copies schema.

## Alternatives weighed and rejected

- **One row per variant with a quantity count** — condition and grade cannot
  describe several different physical cards at once.
- **Hybrid: row per condition/grade combination with a count** — collapses
  identical duplicates, but loses per-card purchase price and date.
- **Numeric 1–10 condition scale** — finer, but needs a translation layer against
  every eBay listing.
- **Free-text condition** — cannot be filtered, sorted or compared to a listing.
- **Not tracking condition** — loses the ability to tell an upgrade from a duplicate.
- **Grader + grade without cert number** — loses the ability to identify the
  specific slab.
- **BGS subgrades** — four more fields that are empty on almost every card.
- **Storing eBay usernames** — would force a public HTTPS origin; see above.
- **Hashing usernames** — untested legally, no compensating benefit.
- **Separate want-list table** — redundant against masterset semantics.
- **Deleting disposed copies** — loses purchase history irreversibly.
- **Live FX conversion at display time** — misstates what was paid.
- **No owner photos** — leaves most Japanese variants with a blank placeholder forever.

## Assumptions stated and confirmed

1. **Home currency is AUD** — inferred from context, confirmed at ACK.
2. **FX rate is entered by hand**; no FX API in v1.
3. **Condition is optional**, since graded slabs use grade instead.

Terms are recorded in the **domain glossary** (`01m041423p`).
