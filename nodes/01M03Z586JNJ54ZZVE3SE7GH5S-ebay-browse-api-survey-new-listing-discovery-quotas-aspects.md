---
id: 01M03Z586JNJ54ZZVE3SE7GH5S
type: research
title: "eBay Browse API survey: new-listing discovery, quotas, aspects and licence terms"
status: done
parent: 01M03X9XFD2CCGM718GJ6D5MBP
---
*Research date: 2026-08-16. `developer.ebay.com` blocks automated fetches (WebFetch times out, curl gets 403); doc text below was read from eBay's own mirror `www.edp.ebay.com` at identical paths, and from eBay's published OpenAPI contract (Browse `v1.20.4`). Canonical URLs are cited. Live listing counts and aspect facets were measured directly off eBay search pages on 2026-08-16 before eBay throttled the researcher.*

---

## 1. Which API

**The Browse API. Finding is gone, not merely deprecated.**

The [API Deprecation Status page](https://developer.ebay.com/develop/get-started/api-deprecation-status) lists, in the *decommissioned* table:

> **Finding API — All — 2025/02/04** — "This API has been replaced by the Browse API."
> **Shopping API — All — 2025/02/04** — "This API has been replaced by the Browse API."

The Merchandising API is deprecated (2024/07/29) with decommission "TBD". There is no newer keyword-search API. eBay's GraphQL Explorer exists but currently serves the **Inventory Mapping API** (a selling tool), not buyer-side search.

**Endpoint:** `GET https://api.ebay.com/buy/browse/v1/item_summary/search`
Sandbox: `https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search`

**Availability to an individual developer.** Mixed signals, resolved in favour of "yes":

- [Buy APIs Requirements](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html) opens with: *"Many of the Buy APIs are a (Limited Release). The use of eBay's Buy APIs in production is intended for eBay partners only. You must apply for production access through the eBay Partner Network... There is no guarantee that your application for production use of the APIs will be approved."*
- The [API Call Limits page](https://developer.ebay.com/develop/get-started/api-call-limits) footnotes every Buy API with `* Buy APIs require an additional license.`
- **However**, in eBay's own Browse OpenAPI contract, the Limited Release badge appears on exactly one Browse path: `/item/` (`getItems`, the bulk item fetch) — *"This is a (Limited Release) available only to select Partners."* `item_summary/search`, `item_summary/search_by_image` and `/item/{item_id}` (`getItem`) carry **no** such badge.
- [Buy APIs Overview](https://developer.ebay.com/api-docs/buy/static/buy-overview.html) explicitly prefixes Deal API, Feed API beta, Offer API and Order API with "(Limited Release)" and does **not** prefix Browse.

**Conclusion:** `item_summary/search` and single-item `getItem` are open to any production keyset. Feed, Deal, Order, Offer, Marketplace Insights and Browse `getItems` are partner-gated. The blanket "partners only" wording in the Requirements page is a residual policy risk, not an operative gate on search.

**Real gate on production access:** per [Create the eBay API keysets](https://developer.ebay.com/api-docs/static/gs_create-the-ebay-api-keysets.html):

> *"Before you can use your Production keyset, you must subscribe to or opt out of eBay marketplace account deletion/closure notifications. If you see the 'Your Keyset is currently disabled' message, click the link in the message to begin the compliance process."*

Opting out requires attesting you do **not** persist eBay user data ([Marketplace User Account Deletion](https://developer.ebay.com/develop/guides-v2/marketplace-user-account-deletion)). Note that `ItemSummary.seller.username` *is* eBay user data — if seller usernames are stored in the local DB, the honest path is to subscribe, which needs a publicly reachable HTTPS endpoint with a valid certificate. Alternatively, discard/hash usernames on ingest and opt out. No business verification, company entity, or revenue is required either way.

---

## 2. New-listing discovery

Both mechanisms exist. This is a **cursor**, not a differ.

**Sort.** From the contract's `sort` parameter (`cos:SortField`), the complete valid set is:

| Value | Meaning |
|---|---|
| `price` / `-price` | total cost (price + shipping), asc/desc |
| `distance` | requires all four pickup filters |
| `newlyListed` | *"Returned items are sorted based on their `itemOriginDate`. Newly listed items are shown first."* |
| `endingSoonest` | by scheduled end date/time |
| *(omitted)* | Best Match (default) |

**Filter.** From [Buy API Field Filters](https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html):

> **`itemStartDate`** (Browse: search, searchByImage)
> `filter=itemStartDate:[2018-11-14T07:47:48Z..2018-12-14T07:47:48Z]`
> "Only items scheduled to start within the specified date-time range are returned... **Note: This filter is based on the timestamp recorded by eBay the moment the listing became available.**"
> Open-ended form: `filter=itemStartDate:[2018-11-14T07:47:48Z]` returns "every listing starting after that". Values in UTC `yyyy-MM-ddThh:mm:ss.sssZ`.

There is also `itemEndDate` with the same syntax.

**Timestamps returned on every `ItemSummary`** (both marked *"always returned with itemSummaries"*):

- **`itemCreationDate`** — "The date and time when the item listing was created."
- **`itemOriginDate`** — "The date and time when the listing was first made available. **This date will be retained if an item is relisted.** This timestamp is used to sort the response when the `sort=newlyListed` parameter is used."
- `itemEndDate` — scheduled end (returned when applicable, not guaranteed).

**Practical consequence.** `itemStartDate`'s prose ("the moment the listing became available") reads like `itemOriginDate`, but eBay does not state the mapping explicitly, and the two diverge for relists. Since both fields come back in every summary, measure the mapping empirically on day one. Regardless, overlap the window (`lastScan − 30 min`) and dedupe on `itemId` — index lag and clock skew are cheaper to absorb than to reason about.

**Critical default-behaviour trap.** From the `search` method description:

> *"Only listings where `FIXED_PRICE` (Buy It Now) is a buying option are returned by default... an auction listing enabled with the Buy it Now feature will initially show `AUCTION` and `FIXED_PRICE` as buying options, but **if/when that auction listing receives a qualifying bid, only `AUCTION` remains**. If this happens, the `buyingOptions` filter would need to be used to retrieve that auction listing."*

Without `filter=buyingOptions:{FIXED_PRICE|AUCTION}` every auction that has attracted a bid is silently lost. Note the filter's own caveat: *"This filter is defined at the leaf category level and should be used with a leaf category ID."* 183454 is a leaf, so this is satisfied.

**Feed API — not usable here.** [Feed API beta guide](https://developer.ebay.com/api-docs/buy/static/api-feed_beta.html) documents exactly what is wanted and then gates it:

- `getItemFeed` with `feed_scope=NEWLY_LISTED` — "a daily Item feed file containing all the newly listed items for a specific category, date, and marketplace."
- `getItemSnapshotFeed` — hourly file of items changed in that hour, including "Item created within the specified hour".
- But: *"This is a (Limited Release). For information on how to obtain access to this API in production, see the Buy APIs Requirements."* — i.e. eBay Partner Network approval.
- And: *"The Feed API methods require an eBay L1 (top-level) category ID."* For cards that is 220 (Toys & Hobbies) — a whole-category daily file, streamed in ≤100 MB `Range` chunks, TSV_GZIP.
- And the feeds are pre-filtered: *"Daily Feeds (NEWLY_LISTED): **Fixed-price** items"*, further restricted to *"eBay Top Rated and Above Standard items"*, excluding condition 7000. Auctions and ordinary sellers are absent.

Feed API v1 (the non-beta successor) supports only `CURATED_ITEM_FEED`, `PRODUCT_FEED`, `PROMOTION`, `PROMOTION_V2`, `CBT_ITEM_ALL_ACTIVE` — none is a newly-listed feed ([Feed API guide](https://developer.ebay.com/api-docs/buy/static/api-feed.html)).

Verdict: Feed is the architecturally correct answer and is unavailable to a non-partner. Browse polling is the path.

---

## 3. Auth model

**Client credentials only. No user token, no browser.**

The Browse contract's security scheme:

```
securitySchemes:
  api_auth:
    type: oauth2
    flows:
      clientCredentials:
        tokenUrl: https://api.ebay.com/identity/v1/oauth2/token
        scopes:
          https://api.ebay.com/oauth/api_scope: "View public data from eBay"
          https://api.ebay.com/oauth/api_scope/buy.item.bulk: "Retrieve eBay items in bulk."
```

`item_summary/search` and `/item/{item_id}` require `https://api.ebay.com/oauth/api_scope`. Only `getItems` (Limited Release anyway) needs `buy.item.bulk`.

Request ([client credentials grant flow](https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html)):

```
POST https://api.ebay.com/identity/v1/oauth2/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)

grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope
```

- Response: `access_token`, `expires_in: 7200`, `token_type: "Application Access Token"`.
- **No refresh token is issued** for this flow — mint a new one when it expires ([Access token types](https://developer.ebay.com/api-docs/static/oauth-token-types.html)).
- No user consent, no redirect URI, no RuName in the request path. A headless home server holds only the App ID and Cert ID.

**Token minting is itself rate-limited.** [Access token rate limits](https://developer.ebay.com/api-docs/static/oauth-rate-limits.html): each application has a daily cap on requests to `/identity/v1/oauth2/token`, differing per `grant_type`; eBay's stated best practice is *"use an access token until it expires, then create a new one"*. Minting on a 2-hour schedule is 12 calls/day — nowhere near any ceiling. Do not mint per request.

Recommended: cache the token in memory with a ~5-minute safety margin, re-mint on expiry or on a `401`.

---

## 4. Rate limits and quotas

From [API Call Limits](https://developer.ebay.com/develop/get-started/api-call-limits), verbatim:

| API | Default limit |
|---|---|
| **Browse API \*** | All methods except `getItems`: **5,000 API calls per day**; `getItems`: 5,000 API calls per day |
| Deal API \* | 5,000/day |
| Feed Beta API \* | `item`, `item_group`, `item_priority`: 10,000/day; `item_snapshot`: 75,000/day |
| Feed v1 API \* | 75,000/day |
| Taxonomy (Commerce) | 5,000/day |
| Developer Analytics API | 5,000/day |

`* Buy APIs require an additional license. See the API documentation for details.`

**Buckets are per-API, not shared** — Browse's 5,000 is separate from Taxonomy's 5,000. Within Browse, `getItems` has its own 5,000 distinct from everything else; `item_summary/search` and `getItem` share the "all methods except getItems" pool. That matters: **per-item enrichment via `getItem` competes directly with search calls.**

The page frames these as *"default API call limit rates for individuals and smaller businesses"*, raisable via the [Application Growth Check](https://developer.ebay.com/api-docs/static/gs_use-the-application-growth.html) — *"You must request an application growth check if you want to use restricted APIs in Production. The check is done by the eBay team as a final step before allowing your Production keyset to access restricted APIs."* For a personal tool, do not plan around getting an increase.

**Behaviour at the ceiling:** requests fail rather than throttle; the classic signal is error `10001`, *"Service call has exceeded the number of times the operation is allowed to be called"*, subdomain `RateLimiter`. Counters reset nightly at midnight Pacific (community reports of drift exist; do not build tight logic around the exact reset instant). Monitor with the Developer Analytics API `getRateLimits` / `getUserRateLimits`.

**License-level backing** — [API License Agreement](https://developer.ebay.com/join/api-license-agreement), §*API Call Limitations*:

> *"eBay reserves the right to limit the number of periodic API calls you are allowed to make. Unused API calls will not roll over to the next call limit period. eBay may temporarily suspend your access to an API if you exceed API call limits. **Attempts to circumvent API call limits may result in suspension** of your access to the Developer Tools, and/or suspension of your access to all or some APIs or may result in termination of this API License Agreement..."*

**Implied polling interval.** Budget = calls/cycle × cycles/day ≤ 5,000, keeping ~20% headroom for retries and enrichment.

| Design | Calls/cycle | 5 min (288/day) | 10 min (144/day) | 15 min (96/day) |
|---|---|---|---|---|
| 6 keywords × US only | 6 | 1,728 | 864 | 576 |
| 6 keywords × US+GB | 12 | 3,456 | 1,728 | 1,152 |
| 6 keywords × US+GB+DE+AU | 24 | 6,912 ✗ | 3,456 | 2,304 |

**Recommended:** 10-minute cycle, US+GB at every cycle, DE+AU folded in every 4th cycle. ~2,100 calls/day, ~58% headroom. A second page (`offset=200`) is only needed if a cycle returns a full 200 for one query — make it conditional, not unconditional.

---

## 5. Query surface

**Keyword semantics** (`q` parameter):

- Comma-separated terms = **AND**: `q=iphone,ipad` returns items with both.
- Space-separated terms = **OR**: `q=iphone ipad` returns either.
- The `*` wildcard is **not** allowed.
- One of `q`, `category_ids`, `epid`, `gtin` is required.
- `q` cannot be combined with `epid` or `gtin`.
- Matches title only, unless `filter=searchInDescription:true` is added (Browse `search` only).

**Category.** Pokémon singles on eBay US: **183454 — CCG Individual Cards** (leaf, under Toys & Hobbies 220 → Collectible Card Games & Accessories 2536). Only **one** category ID per request is currently accepted. **Category IDs are not the same across marketplaces** — the docs say so explicitly and the list is unpublished; resolve GB/DE/AU IDs via the [Taxonomy API](https://developer.ebay.com/api-docs/buy/buy-categories.html) rather than assuming 183454 is universal.

**Noise from the English word "gloom" — measured, not estimated.** Live eBay US facet data (2026-08-16), query `gloom pokemon` restricted to category 183454:

- **Total active listings: 24,939.**
- `Character` facet: **Gloom 20,038**, Oddish 3,067, Vileplume 2,228, Charizard 2,785, Charmander 2,475, Eevee 1,786, Blastoise 1,015, Pikachu 2,345
- `Card Name` facet: **Gloom 14,215**, **Erika's Gloom 2,379**, **Dark Gloom 1,133**, Reversal 1,013, Pokémon Reversal 758, Charizard 450, Oddish 390, Pikachu 285
- `Language`: English 18,501 · **Japanese 4,227** · Chinese 307 · Korean 88 · Spanish 48 · French 27 · Italian 23 · German 17

Bare-keyword counts in 183454: `gloom` **34,574**; `oddish` **42,139**.

The category constraint does the heavy lifting: unrestricted, "gloom" collides with Gloomhaven, the Atlas Games *Gloom* card game, Warhammer Gloomspite, books, films and music. Inside 183454 the residual noise is (a) other TCGs with a card named Gloom, (b) bulk lots and multi-card titles where Gloom is one of many names listed, (c) proxies and custom art — the `Features` facet shows **Altered/Custom Art 553**.

**Estimated new listings/day.** ~25k active for one query variant on one marketplace; the whole line across US+GB+DE+AU plausibly 80k–120k active. Against typical card-listing lifetimes this implies **roughly 1,000–3,000 new listings/day** reaching the matcher. Treat this as an order-of-magnitude figure — **it could not be measured directly** (eBay exposes no "listed in last 24h" facet, and eBay throttled the scraping before further sampling) — but design for four digits, not three.

**Precision lever.** `aspect_filter` requires the category ID **twice** (as `category_ids` and inside the filter) and the two must match:

```
category_ids=183454
&aspect_filter=categoryId:183454,Character:{Gloom|Oddish|Vileplume|Bellossom}
```

Pipe `|` is the value delimiter; a literal pipe inside a value must be backslash-escaped; all values URL-encoded. This only matches listings where the seller (or eBay's catalog auto-fill) populated the aspect — so run it *alongside* a plain keyword query and union the results, rather than instead of one.

**Structured fields returned per `ItemSummary`** (Browse `v1.20.4`):

`itemId` · `legacyItemId` · `title` · `shortDescription` (with `fieldgroups=EXTENDED`) · `condition` · `conditionId` · `price` (`value` + `currency`) · `currentBidPrice` · `bidCount` · `marketingPrice` · `unitPrice` / `unitPricingMeasure` · `buyingOptions[]` · `itemCreationDate` · `itemOriginDate` · `itemEndDate` · `categories[]` · `leafCategoryIds[]` · `epid` · `seller` (`username`, `feedbackScore`, `feedbackPercentage`, `sellerAccountType`) · `itemLocation` (`country`, `postalCode`, `stateOrProvince`, `city` with EXTENDED) · `listingMarketplaceId` · `shippingOptions[]` · `image` / `thumbnailImages[]` / `additionalImages[]` · `itemWebUrl` · `itemAffiliateWebUrl` · `itemHref` · `itemGroupHref` / `itemGroupType` · `watchCount` · `adultOnly` · `priorityListing` · `topRatedBuyingExperience` · `qualifiedPrograms[]` · `availableCoupons`

**Pagination:** `limit` 1–200 (default 50); `offset` must be 0 or a multiple of `limit`; **maximum 10,000 items per result set**. Deep paging past 10k is impossible — another reason the `itemStartDate` cursor beats brute-force paging.

**Full filter list for `search`:** `bidCount`, `buyingOptions`, `charityOnly`, `conditionIds`, `conditions`, `deliveryCountry`, `deliveryOptions`, `deliveryPostalCode`, `excludeCategoryIds`, `excludeSellers`, `guaranteedDeliveryInDays`, `itemEndDate`, `itemStartDate`, `itemLocationCountry`, `itemLocationRegion`, `maxDeliveryCost`, `paymentMethods`, `pickupCountry`, `pickupPostalCode`, `pickupRadius`, `pickupRadiusUnit`, `price`, `priceCurrency`, `priorityListing`, `qualifiedPrograms`, `returnsAccepted`, `searchInDescription`, `sellerAccountTypes`, `sellers` (max 250).

`price` requires `priceCurrency` alongside it. `itemLocationCountry` takes exactly one ISO-3166 code and conflicts with `itemLocationRegion`.

---

## 6. Item aspects — the matching-difficulty answer

**Structured card metadata exists on eBay, but the search endpoint does not return it.**

`localizedAspects` (array of `TypedNameValue`) is defined on **`CoreItem`** — the `getItem` response — not on `ItemSummary`. Confirmed by walking the schema in the contract. The `getItem` description promises *"all item aspects"*. The `search` response gives `title`, `condition`, `conditionId`, `categories`, `leafCategoryIds` and price/seller/location — and nothing else structured about the card.

`fieldgroups=EXTENDED` on search adds only two fields: `shortDescription` and `itemLocation.city`. Not aspects.

What search *can* give is aspect **facets** at the result-set level: `fieldgroups=ASPECT_REFINEMENTS` returns an `aspectDistributions` container (name + value + match count), and `aspect_filter` allows *constraining* by aspect. So you can filter on aspects without ever seeing per-item aspect values.

**Which aspects exist for Pokémon singles (183454), observed live on eBay US:**

| Aspect | Sample values (with live counts from the `gloom pokemon` result set) |
|---|---|
| **Character** | Gloom (20,038), Oddish (3,067), Vileplume (2,228), Charizard, Eevee, Pikachu… |
| **Card Name** | Gloom (14,215), Erika's Gloom (2,379), Dark Gloom (1,133)… |
| **Language** | English (18,501), Japanese (4,227), Chinese (307), Korean (88), Spanish, French, Italian, German |
| **Set** | Base Set, Jungle (2,696), Team Rocket (1,531), SV: Scarlet & Violet 151, Crown Zenith, SV03: Obsidian Flames, Unlimited… |
| **Rarity** | Common, Uncommon (12,269), Rare, Holo Rare, Reverse Holo, Secret Rare, Super Rare, Ultra Rare |
| **Features** | 1st Edition (1,724), Unlimited (3,132), Full Art (1,633), Promo, Alternative Art, Shadowless (45), Chase, Altered/Custom Art (553) |
| **Finish** | Regular (12,149), Reverse Holo (5,997), Holo (5,433), Foil (448), Not Specified (3,348) |
| **Card Condition** | Near Mint or Better (16,912), Lightly Played (5,077), Moderately Played (1,861), Heavily Played (505), Not Specified (1,177) |
| **Manufacturer** | ArtBox, Bandai, Nintendo, WOTC… |

Also present in listings but not surfaced as top-level facets: Card Number, Card Size, Card Type, Stage, HP, Creature/Monster Type, Year Manufactured, Game, Speciality, Grade / Graded, Professional Grader, Certification Number.

**Reliability of seller population.** Good but not complete. Evidence: 20,038 of 24,939 (~80%) carried a `Character` value; only 3,348 of ~25k were "Not Specified" for `Finish`; `Card Condition` had 1,177 "Not Specified". eBay auto-fills many of these when a seller lists against its catalog, which is why coverage is high for mainstream English sets. Coverage degrades exactly where this collection cares most: Japanese-language listings and non-catalog/vintage listings are more often listed free-form.

**Graded cards** use condition IDs rather than aspects: for trading-card categories (183050, 183454, 261328) sellers set `LIKE_NEW` (2750) for graded and `USED_VERY_GOOD` (4000) for ungraded, with graded detail carried in [condition descriptors](https://developer.ebay.com/api-docs/user-guides/static/mip-user-guide/mip-enum-condition-descriptor-ids-for-trading-cards.html) (e.g. Certification Number = descriptor 27503). Condition descriptors are **not** returned by `item_summary/search` either.

**Net effect on architecture.** To attach a listing to a specific card (set, number, print variant, grade), `getItem` is needed per listing — one call each, out of the same 5,000/day pool as the searches. At 1,000–3,000 new listings/day this is not affordable, and `getItems` (20 IDs per call) is Limited Release and returns a restricted field set with no aspects at all. So:

- **v1:** match on `title` + `Character`/`Card Name`/`Language` aspect filters + `conditionId`. Accept fuzzy matching.
- **v2 (if needed):** `getItem` only for listings that survive a cheap title-based pre-filter, budgeted at a few hundred/day.

---

## 7. Sold comps (recorded, out of scope for v1)

**Marketplace Insights API**, `GET /buy/marketplace_insights/v1_beta/item_sales/search` (spec version `v1_beta.2.2`):

> *"**(Limited Release)** This method searches for sold eBay items by various URI query parameters and retrieves the sales history of the items **for the last 90 days**."*

- Same query surface as Browse: `q`, `category_ids`, `epid`, `gtin`, `aspect_filter`, `filter`, `fieldgroups`, `sort`, `limit`, `offset`.
- Adds the `lastSoldDate` filter (`filter=lastSoldDate:[2018-08-30T00:00:00Z..2018-09-17T00:00:00Z]`), shares `buyingOptions`, `price`, `priceCurrency`, `itemLocationCountry` with Browse. `BEST_OFFER` is explicitly *not* supported in the `buyingOptions` filter here.
- **Access:** Limited Release. The [Application Growth Check page](https://developer.ebay.com/api-docs/static/gs_use-the-application-growth.html) lists Marketplace Insights among the restricted APIs requiring eBay-team approval before a production keyset can call it. Approval is discretionary and oriented to eBay Partner Network members with a commercial business model.

**Assessment:** effectively unreachable for a single-user hobby app. Only 90 days of history even if granted. If pricing ever comes into scope, the realistic options are third-party comp datasets or recording your own observations over time — not this API.

---

## 8. International sites

**One query covers one marketplace.** The `X-EBAY-C-MARKETPLACE-ID` header selects it:

> *"This header identifies the seller's eBay marketplace. It is required for all marketplaces outside of the US. Note: If the marketplace ID value is invalid or missing, the default value of `EBAY_US` is used."*

**The single most important finding for this collection: there is no eBay Japan marketplace for the Buy APIs.** [Buy API Support by Marketplace](https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html) enumerates the Buy-API marketplaces exhaustively:

> EBAY_AT (ebay.at), EBAY_AU (ebay.com.au), EBAY_BE, EBAY_CA, EBAY_CH, EBAY_DE, EBAY_ES, EBAY_FR, EBAY_GB (ebay.co.uk), EBAY_HK, EBAY_IE, EBAY_IT, EBAY_NL, EBAY_PL, EBAY_SG, EBAY_US

**EBAY_JP does not appear.** (`EBAY_JP` exists in the shared `MarketplaceIdEnum` used across eBay's APIs, which is why it looks available at first glance — but the Buy APIs do not serve it.) eBay's Japanese consumer marketplace launched in 2001 and closed in 2004; eBay Japan today is a cross-border **export** operation. Japanese sellers list on ebay.com.

This is good news operationally: **Japanese cards are reachable through `EBAY_US`.** The live facet data proves it — 4,227 Japanese-language listings inside a single `gloom pokemon` search on eBay US, alongside 307 Chinese and 88 Korean. Reach them with `aspect_filter=...,Language:{Japanese}` and/or `filter=itemLocationCountry:JP`.

Per the support table, `item_summary` (search) is supported in **AT, AU, BE, CA, CH, DE, ES, FR, GB, HK, IE, IT, NL, PL, SG, US** — every listed marketplace. (`searchByImage` is narrower: *"only supported in US, DE, UK, and AU marketplaces."*)

`Accept-Language` is a separate header, needed only for multi-locale marketplaces (e.g. `fr-BE` for Belgium's French locale, `fr-CA` for Canada). Not relevant to a US-centric scan.

**Practical coverage plan:** `EBAY_US` is mandatory and catches the overwhelming majority including Japanese-origin stock. `EBAY_GB` is the strong second. `EBAY_DE` and `EBAY_AU` are marginal for this line — poll them at a reduced cadence. Each marketplace multiplies the call count linearly, and category IDs must be re-resolved per marketplace.

---

## 9. Terms of use

All quotations from the [eBay Developers Program Terms of Use and API License Agreement](https://developer.ebay.com/join/api-license-agreement) as published 2026.

**Storing listing data locally.** The Authorized Use grant is narrow:

> *"eBay grants you a non-exclusive, non-transferable, non-sublicensable... license to use the Developer Tools (including to access and use eBay APIs) solely during the Term and solely for the purpose of facilitating your own or Your Users' use of eBay Services, such licensed uses limited to the following (the 'Authorized Use'): Enabling your Application to interact with, and ongoing interactions with, eBay's databases...; **Making limited intermediate copies of eBay Content only as necessary to perform an activity permitted under this API License Agreement. All intermediate copies must be deleted when they are no longer required for the purpose for which they were created**; Rearranging or reorganizing eBay Content within your Application...; Displaying eBay Content consistent with this API License Agreement..."*

Read plainly: a local store of seen-item IDs and listing snapshots is an "intermediate copy" permitted *for the purpose of the notification feature*, and must be deleted when no longer needed for that purpose. A rolling window (delete records once the listing has ended and the notification has been delivered) is defensible; an indefinite historical archive of eBay listing data is not what this clause contemplates.

**Freshness — the six-hour clause.** This is the one hard number in the agreement:

> *"**Age of Displayed eBay Content.** eBay Content displayed within your Application must be kept reasonably up to date. **Displayed item listing information may not be more than six (6) hours older than information displayed on the eBay Site**, and other eBay Content must be no more than twenty-four (24) hours older than content displayed on the eBay Site. If your displayed item listing is not as current as the listing on the eBay Site, you will disclose in your Application how much older your displayed item listing is than the same listing on the eBay Site."*

A 5–10 minute poll is comfortably inside this. The clause bites in the other direction: if the PWA shows a cached price or availability from a notification fired 12 hours ago, that is a violation unless re-checked or timestamped. Cheapest compliance: link out to `itemWebUrl` and show a "seen at HH:MM" stamp.

**Public Display constraints** (relevant if the PWA is ever shared):

> *"To the extent eBay Content is publicly available within an eBay Service, you may display such eBay Content within your Application to promote eBay and enable Your Users to search and browse listings ('Public Display'), subject to the following restrictions: (1) **When the eBay Content is no longer publicly available, you must delete it from your Application.** For example, when an eBay User ID is publicly available in connection with a listing... but if that eBay User ID is no longer viewable in connection with the listing or is otherwise anonymized, you may no longer display the eBay User ID...; (2) **eBay Content in a Public Display may not be co-mingled or combined with non-eBay Content.** For example, all eBay Content in a Public Display must be visually isolated from third-party listings or other non-eBay information..."*

Clause (2) matters if eBay results are ever merged with another source (TCGplayer, Yahoo Auctions) in one feed — they must be visually separated.

**Polling frequency.** There is no numeric polling cap in the agreement. The governing language is a reasonableness standard tied to the published documentation:

> *"[You may not] Use any API in a manner that **exceeds reasonable request volume, constitutes excessive or abusive usage** or otherwise fails to comply or is inconsistent with any part of any posted eBay Developer Documentation. eBay may update these requirements from time to time, and you must ensure compliance with currently posted standards."*

In practice "reasonable" is operationalised by the published 5,000/day Browse quota. Staying inside it, without parallel keysets or IP rotation, is the compliance posture. The anti-circumvention clause quoted in §4 is the one to avoid tripping.

**Personal / non-commercial use.** There is **no personal-use exemption and no non-commercial carve-out** in the agreement — the same terms apply to a hobby project as to a commercial partner. Two related prohibitions worth knowing:

> *"[You may not] **Use eBay Content, including without limitation any Personal Information, to train algorithms, conduct machine learning, develop synthetic data sets, train large learning models, and/or train artificial intelligence systems.**"*

Directly relevant if the matcher ever moves from rules to a trained model — training a classifier on scraped eBay titles would breach this. Rule-based or embedding-lookup matching against a card corpus you own is fine; fine-tuning on eBay Content is not.

> *"You must have eBay's express prior written permission to use or display eBay Content in any way that enables derivation of... Any site-wide statistics across eBay Sites or within any eBay Site; ... Statistics relating to the performance (financial or otherwise) of any eBay Service; **Average selling price or gross merchandise sold for any eBay category.**"*

This is the clause that makes the "pricing is out of scope for v1" decision more than a scoping convenience — deriving average selling prices for a category needs written permission regardless of where the data came from.

**Other operative obligations:** Application Keys are eBay property, may not be shared or transferred, must be kept confidential, and may be revoked at any time. Non-compliance with the marketplace account-deletion requirement is called out as grounds for termination of Developer Tools access.

---

## Suggested v1 request shape

```
GET https://api.ebay.com/buy/browse/v1/item_summary/search
  ?q=gloom
  &category_ids=183454
  &sort=newlyListed
  &limit=200
  &offset=0
  &filter=buyingOptions:{FIXED_PRICE|AUCTION},itemStartDate:[2026-08-16T09:30:00.000Z]
  &fieldgroups=EXTENDED

Authorization: Bearer <application access token>
X-EBAY-C-MARKETPLACE-ID: EBAY_US
```

All `filter` values must be URL-encoded. Pair it with an aspect-filtered sibling request for precision:

```
  &category_ids=183454
  &aspect_filter=categoryId:183454,Character:{Gloom|Oddish|Vileplume|Bellossom}
```

and union the two result sets on `itemId`.

---

## Known gaps in this research

Stated plainly so a later session can decide whether any warrant a follow-up:

1. **New-listings-per-day is an estimate, not a measurement.** eBay exposes no "listed in last 24h" facet and throttled the scraping after ~6 requests. The 1,000–3,000/day figure is derived from active-listing counts and assumed turnover. The cheapest way to get a real number is one day of actual API polling once a keyset exists.
2. **`itemStartDate` → which timestamp?** eBay does not document whether the filter keys off `itemCreationDate` or `itemOriginDate`. Both are returned in every summary, so this resolves in one test call — but it is unresolved on paper.
3. **GB/DE/AU category IDs for Pokémon singles** are unverified. 183454 is confirmed for US only; eBay states IDs differ across marketplaces. Resolve via Taxonomy API before coding them in.
4. **Aspect-population rates for Japanese-language listings specifically** — the aggregate is known (~80% `Character` coverage) but was not sliced by language. If Japanese cards matter most, that slice is worth measuring, as it directly sets v1 matching precision for the part of the collection that matters most.

---

## Source index

- [API Deprecation Status](https://developer.ebay.com/develop/get-started/api-deprecation-status) — Finding & Shopping decommissioned 2025-02-04
- [Browse API `item_summary/search`](https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search) — parameters, sort values, pagination caps
- [Browse API OpenAPI contract, v1.20.4](https://developer.ebay.com/api-docs/buy/browse/overview.html) — schema of `ItemSummary` / `CoreItem`, security schemes, Limited Release badges
- [Buy API Field Filters](https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html) — `itemStartDate`, `buyingOptions`, `searchInDescription`, full filter list
- [Buy API Support by Marketplace](https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html) — supported marketplaces (no EBAY_JP)
- [Buy APIs Overview](https://developer.ebay.com/api-docs/buy/static/buy-overview.html) / [Buy APIs Requirements](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html) — Limited Release designations, production access process
- [Browse API guide](https://developer.ebay.com/api-docs/buy/static/api-browse.html) · [Feed API guide](https://developer.ebay.com/api-docs/buy/static/api-feed.html) · [Feed API beta guide](https://developer.ebay.com/api-docs/buy/static/api-feed_beta.html)
- [API Call Limits](https://developer.ebay.com/develop/get-started/api-call-limits) — 5,000/day Browse
- [Application Growth Check](https://developer.ebay.com/api-docs/static/gs_use-the-application-growth.html) — restricted-API access route
- [Client credentials grant flow](https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html) · [Access token types](https://developer.ebay.com/api-docs/static/oauth-token-types.html) · [Access token rate limits](https://developer.ebay.com/api-docs/static/oauth-rate-limits.html)
- [Create the eBay API keysets](https://developer.ebay.com/api-docs/static/gs_create-the-ebay-api-keysets.html) · [Marketplace User Account Deletion](https://developer.ebay.com/develop/guides-v2/marketplace-user-account-deletion)
- [API License Agreement](https://developer.ebay.com/join/api-license-agreement)
- [Marketplace Insights `item_sales/search`](https://developer.ebay.com/api-docs/buy/marketplace-insights/resources/item_sales/methods/search) (contract `v1_beta.2.2`)
- [Condition Descriptor IDs for Trading Cards](https://developer.ebay.com/api-docs/user-guides/static/mip-user-guide/mip-enum-condition-descriptor-ids-for-trading-cards.html) · [Categories for Buy APIs](https://developer.ebay.com/api-docs/buy/buy-categories.html) · [Taxonomy `getItemAspectsForCategory`](https://developer.ebay.com/api-docs/commerce/taxonomy/resources/category_tree/methods/getItemAspectsForCategory)
- Live facet/count measurements taken 2026-08-16 from `https://www.ebay.com/sch/183454/i.html?_nkw=gloom+pokemon&_sop=10` and sibling queries
