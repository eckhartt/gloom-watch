---
id: 01M03X9XFD2CCGM718GJ6D5MBP
type: decision
title: Which eBay API surfaces newly-listed cards, and at what cost?
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA9GZ6ZRV3CBTF2F460EN
    type: blocks
  - to: 01M03XAA33X9BVPKF8BP747MZV
    type: blocks
  - to: 01M03XA8YSDR7SCNXBVZXM9MS1
    type: relates
meta:
  ticket: research
  hitl: no
  claimed: wayfinder-charting
---
## Resolution

**The Browse API — `GET /buy/browse/v1/item_summary/search`.** Finding and
Shopping were **decommissioned 2025-02-04**, not merely deprecated, and Browse is
the named replacement. There is nothing newer for keyword search over active
listings.

Auth is OAuth **client credentials**: scope `https://api.ebay.com/oauth/api_scope`,
2-hour token, **no refresh token, no browser round-trip, no user consent**. A
headless home server holds only the App ID and Cert ID and re-mints on expiry.
This is the best possible answer for an unattended box.

## The scan design

One call per (keyword, marketplace) pair per cycle:

```
GET /buy/browse/v1/item_summary/search
  ?q=gloom
  &category_ids=183454              # CCG Individual Cards (US, leaf)
  &sort=newlyListed
  &limit=200
  &filter=buyingOptions:{FIXED_PRICE|AUCTION},itemStartDate:[<lastScan-30m>]
X-EBAY-C-MARKETPLACE-ID: EBAY_US
```

**It is a cursor, not a differ** — `itemStartDate` is a real "since" filter — but
keep an `itemId` dedupe set anyway, because the filter's timestamp and the
`sort=newlyListed` key (`itemOriginDate`) are documented differently and relists
muddy both.

**Quota: 5,000 Browse calls/day.** Recommended cadence is **10 minutes**, US+GB
every cycle with DE+AU folded in every 4th — roughly 2,100 calls/day, ~58%
headroom. A 5-minute cycle across US+GB is ~3,500/day and still fits, but leaves
little room for enrichment or retries.

**`buyingOptions` is not optional.** By default the search returns only listings
where `FIXED_PRICE` is an option — so **every auction that has received a
qualifying bid silently disappears** unless the filter is set explicitly.

## The finding that shapes the matching decision

**Search results carry no item aspects.** `localizedAspects` lives on `CoreItem`
(the `getItem` response), not on `ItemSummary`. `fieldgroups=EXTENDED` adds only
`shortDescription` and `itemLocation.city`.

So per-listing structured card data (set, card number, print variant, grade)
costs **one `getItem` call each, out of the same 5,000/day pool as the searches**.
At the measured listing volume that is unaffordable, and the bulk `getItems` is
Limited Release.

What *is* available cheaply is aspect **filtering** and **facets** at the result-set
level:

```
&aspect_filter=categoryId:183454,Character:{Gloom|Oddish|Vileplume|Bellossom}
```

Run it as a sibling request alongside the plain keyword query and union on
`itemId` — aspect filters only match listings where the aspect was populated.

## Volume and noise — measured, 2026-08-16

Live facets for `gloom pokemon` inside category 183454, eBay US alone:

- **24,939 active listings.** Bare `gloom`: 34,574. `oddish`: 42,139.
- `Card Name`: Gloom 14,215 · **Erika's Gloom 2,379** · **Dark Gloom 1,133**
- `Language`: English 18,501 · **Japanese 4,227** · Chinese 307 · Korean 88
- `Features`: 1st Edition 1,724 · Unlimited 3,132 · Shadowless 45 · **Altered/Custom Art 553**
- `Finish`: Regular 12,149 · Reverse Holo 5,997 · Holo 5,433 · Not Specified 3,348

Estimated **1,000–3,000 new listings/day** across the line and marketplaces.
Flagged by the researcher as an order-of-magnitude estimate, not a measurement —
eBay exposes no "listed in last 24h" facet. **Design for four digits, not three.**
Aspect population is ~80% for `Character`, and degrades exactly where this
collection cares most: Japanese-language and non-catalog vintage listings are
more often free-form.

## There is no eBay Japan — and it does not matter

`EBAY_JP` is **absent from the Buy API marketplace list** (AT, AU, BE, CA, CH,
DE, ES, FR, GB, HK, IE, IT, NL, PL, SG, US). eBay's Japanese consumer site closed
in 2004; eBay Japan is a cross-border export operation today.

This resolves benignly: **Japanese cards are reachable through `EBAY_US`** — 4,227
Japanese-language listings in a single US search. Target them with
`Language:{Japanese}` or `filter=itemLocationCountry:JP`.

Category IDs **differ per marketplace** and are unpublished — 183454 is confirmed
for US only. Resolve GB/DE/AU via the Taxonomy API rather than assuming.

## Terms of use — three clauses with teeth

- **Six-hour freshness.** *"Displayed item listing information may not be more
  than six (6) hours older than information displayed on the eBay Site."* A
  10-minute poll is fine; the clause bites on **display** — showing a cached
  price from a notification fired 12 hours ago violates it. Cheapest compliance:
  link out to `itemWebUrl` and show a "seen at HH:MM" stamp.
- **Intermediate copies only.** Local storage is licensed as *"limited
  intermediate copies... All intermediate copies must be deleted when they are no
  longer required for the purpose for which they were created."* A rolling window
  is defensible; an indefinite archive of eBay listing data is not.
- **No training on eBay Content.** Explicitly prohibits using eBay Content to
  *"train algorithms, conduct machine learning... train artificial intelligence
  systems."* **This directly constrains the matching decision**: rule-based or
  embedding-lookup matching against a card corpus we own is fine; fine-tuning a
  classifier on scraped eBay titles is a breach.

There is **no personal-use or non-commercial exemption** — the same terms apply
to a hobby project.

## Two things to plan for, neither fatal

1. **Production keyset gate.** A keyset is not live until you subscribe to *or
   opt out of* eBay marketplace account-deletion notifications. Subscribing needs
   a **public HTTPS endpoint** — which couples to the hosting decision. Opting
   out requires attesting you do not persist eBay user data, and
   `seller.username` **is** eBay user data. So either expose an endpoint, or
   discard/hash seller usernames on ingest.
2. **Deep paging is capped at 10,000 items** per result set, and `offset` must be
   a multiple of `limit`. Another reason the `itemStartDate` cursor beats paging.

## Known gaps, stated by the researcher

- New-listings-per-day is **estimated, not measured**. One day of real polling
  once a keyset exists settles it.
- Whether `itemStartDate` keys off `itemCreationDate` or `itemOriginDate` is
  **undocumented**. Both are returned in every summary, so one test call resolves
  it.
- **GB/DE/AU category IDs are unverified.**
- Aspect-population rate **for Japanese-language listings specifically** was not
  sliced out — and that number sets v1 matching precision for the part of the
  collection that matters most.

## Sold comps — confirmed unreachable

Marketplace Insights (`item_sales/search`) is Limited Release, requires eBay-team
approval oriented to Partner Network members, and holds only **90 days** of
history. Effectively unavailable to a single-user hobby app. This retroactively
justifies ruling price benchmarking out of scope: the agreement *also* requires
written permission to derive *"average selling price... for any eBay category."*

Full findings with citations: see the child research node.
