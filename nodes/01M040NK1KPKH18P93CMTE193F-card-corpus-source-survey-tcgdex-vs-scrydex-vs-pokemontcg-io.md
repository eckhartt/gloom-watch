---
id: 01M040NK1KPKH18P93CMTE193F
type: research
title: "Card corpus source survey: TCGdex vs Scrydex vs pokemontcg.io vs PokeWallet"
status: done
parent: 01M03X9WY0D6AH6GYKG5V6K8VC
---
*Research date: 2026-08-16. Marketing pages proved unreliable, so most findings come from querying live APIs directly rather than reading docs. `pokemontcg.io` and `docs.pokemontcg.io` both returned HTTP 403 to automated fetches — worked around by curling the homepage with a browser user-agent and hitting `api.pokemontcg.io` directly. `docs.scrydex.com` does not resolve (ENOTFOUND); the real docs are at `scrydex.com/docs`. Bulbapedia was used as an independent completeness check.*

---

## 1. TCGdex — RECOMMENDED

Sources: [tcgdex.dev](https://tcgdex.dev/), [github.com/tcgdex/cards-database](https://github.com/tcgdex/cards-database), live `api.tcgdex.net/v2`.

### Coverage

218 English sets, 183 Japanese sets, 21 series. Back to WOTC: Base Set (`base1`), Jungle (`base2`), Team Rocket (`base5`), Gym Heroes (`gym1`), Neo Genesis (`neo1`), Southern Islands (`si1`), Legendary Collection (`lc`), Wizards Black Star Promos (`basep`), every McDonald's Collection 2011–2024, every Black Star Promo series. Japanese side (`data-asia/`) covers `PMCG`, `PCG`, `ADV`, `DP`, `DPt`, `L`, `BW`, `SM`, `S`, `SV`, `M`, `VS` — back to the original Japanese Pokémon Card Game era, including `VS1-059` and Japanese-only sets like `MC` (Start Deck 100 Battle Collection, 2025-12-19).

The 91 English physical Oddish-line cards span Jungle → Phantasmal Flames (2025-11-14) and Ascended Heroes (2026-01-30). Cross-checked Gloom and Vileplume against [Bulbapedia Gloom (TCG)](https://bulbapedia.bulbagarden.net/wiki/Gloom_(TCG)) and [Vileplume (TCG)](https://bulbapedia.bulbagarden.net/wiki/Vileplume_(TCG)). The only English set Bulbapedia lists that TCGdex lacks is **The Best of XY** (Gloom 002, Vileplume 003) — confirmed zero matches for "best of xy" across en/fr/de/it/es.

Everything else reconciled, including the awkward cases: Aquapolis `ecard2-H31`, both Legends Awakened Glooms (`dp6-96`, `dp6-97`), both Team Rocket Dark Vileplumes (`base5-13` holo, `base5-30` non-holo), both Gym Heroes Erika's Glooms.

**Caveat:** TCGdex mixes **TCG Pocket digital-only cards** (set IDs `A1`, `A2`, `A4`, `B1a`, `P-A`) into the same corpus — 14 of 105 English Oddish-line records. Not printed cards. Filter with a set-ID prefix rule or the masterset count is corrupted.

### Languages — separate records, separate ID namespaces

11 languages return Oddish-line data: en, fr, de, ja, es, it, pt, zh-tw, th, id (pt-br returns TCG Pocket only). Modelled as **separate records in separate ID namespaces**, exactly right for a masterset.

Verified: `GET /v2/ja/cards/sv03-002` → 404, `GET /v2/en/cards/SV3-002` → 404. Japanese Obsidian Flames Gloom is `SV3-002` (`黒炎の支配者`); English is `sv03-002`. Distinct rows, not translations of one row.

Korean (`ko`) and Simplified Chinese (`zh-cn`) return empty arrays for this line despite having 239 and ~150 cards respectively — a real gap, not a query error (also tried the Korean name `냄새꼬` directly).

### Variant granularity

Two parallel models. The legacy `variants` object is four booleans (`normal`, `reverse`, `holo`, `firstEdition`, `wPromo`). The newer **`variants_detailed`** array is the useful one. Union of all keys observed across the Oddish line: `type`, `subtype`, `stamp`, `size`, `foil`, `variantId`, `pricing`.

Observed values across 159 EN+JA cards / 256 variant rows:

- `type`: normal (155), reverse (53), holo (48)
- `subtype`: unlimited (17), missing-expansion-symbol (1) — and on Base Set Charizard, `shadowless` and `1999-2000-copyright`
- `stamp`: 1st-edition (18), **1st edition (16)**, set-logo (7), bulbasaur (2), chris-fulop (2), ross-cawthorn (2)
- `size`: standard (256/256)

So Shadowless, 1st Edition, holo, reverse holo, Unlimited, prerelease set-logo stamps and World Championship deck stamps (`chris-fulop`, `ross-cawthorn`) are all modelled. Base Set Charizard resolves to four distinct variant rows:

```
{type: holo, subtype: unlimited}
{type: holo, subtype: shadowless, stamp: [1st-edition]}
{type: holo, subtype: shadowless}
{type: holo, subtype: 1999-2000-copyright}
```

**Two things that MUST be synthesized by hand:**

- **`stamp` is not normalised** — both `1st-edition` and `1st edition` appear for the same concept at comparable frequency (18 vs 16). Canonicalise on ingest or the 1st Edition filter silently drops half the corpus.
- **No per-variant images** (confirmed: `images` is not among the union of `variants_detailed` keys). One image per card record only.

### Identifiers

Card IDs are `{setId}-{localId}`, human-readable and derived from set structure (`base2-37`, `gym1-45`, `SV3-002`). Stable in practice and reconstructible from set+number even if reissued.

**`variantId` is a trap.** Not unique per card-variant — it is a hash of the *variant attribute set*, shared across cards. `endfynwn4n10gzq` ("normal, standard") appears identically on `base2-37`, `base5-36`, `gym1-45` and `neo1-36`; `2fnyg4g532wu2uft0spaa3eefrz` ("normal, standard, 1st-edition") likewise.

**The primary key must be `(card_id, variantId)`, never `variantId` alone.** As a hash of attributes it should survive reissues so long as the attribute vocabulary is unchanged — but the `1st-edition`/`1st edition` inconsistency shows the vocabulary is not tightly controlled, so treat `variantId` as advisory and store the raw attributes too.

### Images

Per [tcgdex.dev/assets](https://tcgdex.dev/assets): two qualities — `high` (600x825) and `low` (245x337), confirmed by reading PNG headers — and three extensions: `png` (transparent), `jpg` (black background), `webp` (transparent, compact). URL is the card's `image` field plus `/{quality}.{extension}`; the field is **case-sensitive** (`/ja/SV/SV3/002/high.png` works, lowercase `sv` 404s).

Measured average over 12 real cards: high.png 310 KB, high.webp 59 KB, low.webp 14.5 KB.

Image coverage on the 475 physical Oddish-line records is **361 (76%)**, very unevenly distributed:

| lang | coverage | | lang | coverage |
|---|---|---|---|---|
| es / it / pt | 100% | | de | 56% |
| en | 95% (86/91) | | id | 33% |
| fr | 89% | | **ja** | **28% (19/68)** |
| th | 69% | | ko / zh-cn | n/a (no records) |
| zh-tw | 63% | | | |

All 19 Japanese images are from `S`/`SV`-era sets (2021+). Every Japanese card from `PMCG`, `PCG`, `E1`–`E3`, `neo1`, `VS1`, `SM`, `MC` has no image. Given Japanese is ~17% of the Gloom market, this is the single biggest practical weakness.

**Rough disk size for the whole Oddish-line image set (361 images):** ~107 MB as high.png, **~20 MB as high.webp** (recommended), ~5 MB as low.webp. Trivial for a home server.

No stated hotlink restriction or bulk-download prohibition on the assets page.

### Access & cost

Free, no API key, no auth headers. Fired 25 rapid sequential requests, all 200; no `RateLimit`, `Retry-After` or `X-*` throttling headers emitted. No published limit, so be polite anyway. REST + GraphQL, official SDKs for JS/TS, Python, Java, Kotlin, PHP.

**Bulk options are excellent:**

- `GET /v2/en/cards` returns all 23,546 English cards in one 2.3 MB response (brief form). Same per language.
- `git clone github.com/tcgdex/cards-database` is the full source dump (~110 MB), TypeScript under `data/` and `data-asia/`.
- `https://assets.tcgdex.net/datas.json` (6.4 MB) is a per-language/per-set/per-card **image hash manifest** — ideal for incremental image sync without refetching.

### Licensing — verbatim

The database is MIT. From [LICENSE](https://raw.githubusercontent.com/tcgdex/cards-database/master/LICENSE):

> "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software."

And from the README:

> "This database is not produced, endorsed, supported or affiliated with Nintendo or The Pokémon Company
>
> The Database is licensed under the MIT License."

This unambiguously permits storing a local copy in a self-hosted personal tracker. Note the MIT grant covers the *database*; the card **images** are The Pokémon Company / Nintendo / Creatures / GAME FREAK copyright and TCGdex does not (and cannot) license them to you. For a single-user private tracker this is the same posture every collection app takes, but it is not something TCGdex's MIT licence actually grants.

### Freshness

Excellent. Repo pushed **2026-08-15T23:44Z** — the day before this survey — with active translation commits. Ascended Heroes (2026-01-30) and Phantasmal Flames (2025-11-14) both present. Every card carries an `updated` ISO timestamp; on the Oddish line, 71 cards touched in 2026-08 and 41 in 2026-07.

**But there is no updated-since query.** `?updated=gt:2026-08-01` returns 0 results, and `sort:field=updated` returns cards in an order inconsistent with recency (`ex8-1`, `ex8-2`, `ex8-3`). Freshness tracking must be done by diffing a full pull against the local copy, or by watching the git commit log.

---

## 2. Scrydex — viable but paid, and licence-constrained

Sources: [scrydex.com](https://scrydex.com/), [/docs/pokemon/cards](https://scrydex.com/docs/pokemon/cards), [/docs/pokemon/api-reference](https://scrydex.com/docs/pokemon/api-reference), [/pricing](https://scrydex.com/pricing), [/terms](https://scrydex.com/terms).

The API could not be queried — `api.scrydex.com` returns 401 and there is no free tier — so everything here is documentation-derived and **unverified against live data**.

**Coverage.** Docs claim "every major expansion" for both English and Japanese, plus trainer kits, promos and non-core expansions. Could not confirm WOTC-era or Gym Heroes / Erika's Gloom presence.

**Languages.** English and Japanese only. URL-scoped: `/pokemon/v1/en/cards`, `/pokemon/v1/ja/cards`; omitting the prefix returns multi-language data. Cards carry `language` and `language_code`. Docs explicitly warn: *"The Japanese card data translation is still a **work in progress**. Not all fields are guaranteed to have translations into English, and vice versa."* No French, German, Spanish, Italian, Portuguese, Chinese, Thai or Indonesian.

**Variant granularity.** Strong on paper, and **better than TCGdex on one axis**: variants are an array with a `name` like `unlimitedHolofoil` or `firstEditionShadowlessHolofoil`, **and each variant carries its own `images` array**. That directly solves TCGdex's per-variant image gap.

**Identifiers.** Card IDs are `{expansion_id}-{number}` (`base1-4`), same shape as TCGdex/pokemontcg.io. **No variant IDs** — variants identified only by their `name` string, more fragile than TCGdex's hashed `variantId`.

**Images.** Three sizes: `small`, `medium`, `large`. Pixel dimensions not documented.

**Access & cost.** Starter $29/mo (5,000 credits), Growth $99/mo (50,000), Professional $399/mo (250,000), Enterprise custom. **No free tier or trial.** Auth via `X-Api-Key` + `X-Team-ID`. Most requests 1 credit; Price History 3, Vision 5. 429 on rate-limit breach. Webhooks for price and population updates. No documented bulk export, no documented updated-since parameter.

**Licensing — the problem.** Verbatim from the Terms of Service prohibited-conduct clause:

> "Resell, sublicense, redistribute, mirror, or commercially exploit the Services without prior written authorization from Scrydex"

and

> "Use the Services primarily as a substitute backend, proxy, or wholesale data source for a competing commercial product or service without written authorization from Scrydex"

and on termination:

> "Scrydex may delete or render inaccessible account data following termination and has no obligation to retain or provide such data."

There is **no clause granting a right to cache or store data locally**, and none addressing personal or self-hosted use at all. The pricing page recommends users "cache data on your end" to conserve credits, which implies caching is expected — but "mirror" is explicitly prohibited, and a local SQLite copy of the full corpus is arguably a mirror. A single-user private tracker is not a "competing commercial product," so that second clause is not triggered. Still: a paid subscription whose terms never affirmatively permit what the project needs, versus MIT which explicitly does.

**Freshness.** Not documented. Webhooks exist for prices and population reports, not for new card/set additions.

---

## 3. Pokémon TCG API (pokemontcg.io) — DEAD, do not use

**Absorbed, and the API is down.** Fetching `https://pokemontcg.io/` with a browser user-agent returns a page whose entire body is:

> "Pokémon TCG API - Now part of Scrydex. The Pokémon TCG API is now part of Scrydex - a suite of TCG developer APIs. Explore Scrydex"

The API itself is failing. Verified 2026-08-16:

- `GET https://api.pokemontcg.io/v2/cards?q=name:gloom` → **HTTP 500**, `content-type: text/html`
- `GET https://api.pokemontcg.io/v2/sets` → **HTTP 500**

Both `pokemontcg.io` and `docs.pokemontcg.io` return 403 to automated fetchers, so the docs could not be read directly. Historically English-only with no Japanese card records, exposing variant information only indirectly through TCGplayer price keys (`1stEditionHolofoil`, `reverseHolofoil`) rather than as first-class variant records — which alone would disqualify it for a multi-language masterset. The 500s may or may not be transient, but combined with the homepage wind-down, treat as end-of-life.

---

## 4. PokeWallet — a commerce catalog, not a print catalog

Sources: [pokewallet.io](https://www.pokewallet.io/), [/api-docs](https://www.pokewallet.io/api-docs).

**What it is built on: TCGplayer + CardMarket.** Not TCGdex, not Scrydex, not pokemontcg.io. Describes itself as "a free REST API for real-time Pokémon TCG card prices and a complete card database, with live pricing from TCGPlayer and CardMarket," and names TCGdex, pokemontcg.io, Scrydex, PokemonPriceTracker and PriceCharting as competitors in its own FAQ. ~50,000 cards, English and Japanese sets.

**Variants** come straight from the upstream marketplaces, and the docs are explicit that the two disagree: TCGplayer supplies "Normal," "Holofoil," "Reverse Holofoil," "1st Edition," "Unlimited," "Shadowless"; CardMarket supplies only "normal" and "holo." There are "CardMarket-only sets" (Japanese sets, European promos). Variant granularity is therefore inconsistent depending on which upstream carries the card — a genuine modelling hazard.

**Identifiers are opaque hashes**: `pk_` + hex for TCG cards, bare hex for CardMarket-only cards. Derived from commerce catalogs, with no stated stability guarantee across reissues. Poor foundation for a permanent local corpus.

**Access.** Free tier 100 req/hr, 1,000/day; "Coffee" tier via Ko-fi donation (1,000+/hr); Pro €20/mo (5,000/hr, 50,000/day). Auth via `X-API-Key` or `Authorization: Bearer`, keys shaped `pk_live_*` / `pk_test_*`. Endpoints were probed and card search could not be reached without a key (`/api/cards?name=gloom` → 404, `api.pokewallet.io/v1/cards` → `{"error":"Endpoint not found"}`), so coverage claims are unverified.

**Verdict:** centre of gravity is pricing, explicitly out of scope. Its catalog exists to hang prices on, not to enumerate every printing. Hash IDs plus inconsistent cross-marketplace variant vocabularies make it a bad canonical source. Not recommended.

---

## 5. TCGCSV — free, but disqualified on variants

Source: [tcgcsv.com](https://tcgcsv.com/).

Free CSV/JSON mirror of TCGplayer's API (categories, groups, products, pricing), refreshed daily around 20:00 UTC, funded by optional Patreon. Products carry `extendedData` for card text, rarity, set number.

**Disqualifying limitation, stated by the project itself: it "does not share information about SKUs."** In TCGplayer's model the SKU is precisely where language, printing and condition live. Without SKUs you get one row per product — no 1st Edition vs Unlimited, no holo vs reverse holo, no language dimension. That is the entire axis this masterset is built on. Licensing terms not stated on the site. Useful only as a cross-reference for TCGplayer product IDs, which TCGdex already embeds in its pricing block anyway.

---

## 6. Bulbapedia — recommended as the completeness auditor

Sources: [Gloom (TCG)](https://bulbapedia.bulbagarden.net/wiki/Gloom_(TCG)), [Vileplume (TCG)](https://bulbapedia.bulbagarden.net/wiki/Vileplume_(TCG)).

Not an API and not a corpus — no structured export, no stable IDs, no variant records, and it lists cards English-first with Japanese set names as parenthetical annotations rather than as separate cards. But its per-Pokémon TCG pages are the most complete human-curated enumeration available, and they earned their place here: cross-referencing them is how the "The Best of XY" gap in TCGdex was found, which appears on both the Gloom and Vileplume pages (`002/171` and `003/171`) and nowhere in TCGdex. Use as a one-off manual audit against the ingested corpus, not as a live source.

---

## Corpus size: how many distinct Oddish-line cards exist?

**~475 physical card records; ~765 distinct card-variant rows.** Derivation, all measured rather than estimated:

1. Queried TCGdex `?dexId=eq:{43,44,45,182}` (Oddish, Gloom, Vileplume, Bellossom) across 13 language codes. Returned **528 language-specific records**.
2. Stripped TCG Pocket digital-only cards by set-ID prefix (`A#`, `B#`, `P-A`): **53 removed → 475 physical records.** Per language: en 91, fr 81, de 77, ja 68, es 39, it 39, pt 39, zh-tw 19, th 13, id 9.
3. Fetched full detail for all 159 EN+JA physical cards and counted `variants_detailed` rows: **91 EN cards → 160 variants (×1.76); 68 JA cards → 96 variants (×1.41); combined ×1.61.**
4. Applied the measured 1.61 multiplier to all 475 records: **≈765 variant rows.**

Sanity checks: a name-based sweep of the full 23,546-card English corpus found 108 Oddish-line records, 94 physical — within 3 of the dexId-based 91, the difference being records with no `dexId` set. And TCGdex's 27 physical English Gloom-named cards reconcile against Bulbapedia's 30 (26 standard + 1 Dark + 3 Erika's), the delta being The Best of XY plus two Bulbapedia entries that are Japanese sets listed under English names.

Adjustments to expect: **+4** for The Best of XY, **+unknown** for Korean and Simplified Chinese (absent from TCGdex; Korean prints of this line certainly exist), **−53** if TCG Pocket is deliberately excluded. Order of magnitude is firmly **several hundred to ~1,000 distinct card-variants**, not tens of thousands. Small enough that SQLite is comfortable and hand-curating residual gaps is genuinely tractable.

---

## Known gaps

1. **Korean and Simplified Chinese entirely missing from TCGdex for this line.** Zero Oddish-line records in `ko` (despite 239 Korean cards total in the DB) and zero in `zh-cn` (despite ~150 Simplified Chinese sets existing). Confirmed by both dexId and native-name query (`냄새꼬`). How many Korean/zh-cn Oddish-line cards actually exist in reality was **not** established, so the size of this gap is unquantified.
2. **"The Best of XY" absent from TCGdex in every language checked** (en/fr/de/it/es). Bulbapedia lists Gloom 002/171 and Vileplume 003/171 there; presumably Oddish 001 and Bellossom 004 too, giving ~4 missing cards. Not independently confirmed beyond Bulbapedia.
3. **Scrydex's actual data was never inspected.** No free tier, `api.scrydex.com` returns 401. Every Scrydex claim about coverage, Japanese depth, WOTC-era presence and variant image availability is documentation-derived and **unverified**. Specifically could not confirm whether Scrydex has Gym Heroes / Erika's Gloom, or Japanese WOTC-era cards.
4. **PokeWallet's catalog was never inspected** — API key required. Coverage, ID stability and Japanese depth are documentation claims only.
5. **No verbatim licence clause exists covering TCGdex *images*.** The MIT quote above covers the database. `tcgdex.dev/assets` documents URL formats but states no terms, no hotlink policy, and no bulk-download policy either permitting or forbidding. Images are TPCi/Nintendo/Creatures/GAME FREAK copyright and TCGdex has no authority to sublicense them. A genuine unresolved legal grey area rather than something a clause could be quoted for.
6. **TCGCSV's licensing terms could not be established** — not stated on the site. Moot given it is disqualified on variant granularity.
7. **pokemontcg.io's 500s might be a transient outage** rather than permanent shutdown. The homepage wind-down message is strong evidence of end-of-life, but no dated shutdown announcement was found.
8. **TCGdex rate limits are unpublished.** 25 rapid requests all returned 200 with no throttling headers, but absence of an observed limit is not a guarantee of no limit. Prefer the bulk endpoints and git clone over hammering per-card requests.
9. **English completeness cross-checked for Gloom and Vileplume only.** Oddish and Bellossom were not audited against Bulbapedia, so additional "Best of XY"-type gaps may exist for those two.
10. **Japanese and non-English variant depth is likely under-modelled.** The ×1.41 JA multiplier versus ×1.76 EN may reflect genuinely simpler Japanese printing practice, or thinner data. The two could not be distinguished.
