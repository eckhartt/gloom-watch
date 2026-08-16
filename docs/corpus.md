# The corpus

How the masterset gets into the database, and the facts about TCGdex that shape it.

Every number below was measured against the live API on **16 August 2026**. Where this document
and the spec disagree, this document is the observation and the spec was the estimate; each
disagreement is called out by name.

## What a sync does

```
languages   derive the language list from upstream            18 languages
brief       per language, the whole brief list, stored        138,909 records
            plus one dexId query per species per language     72 requests
detail      membership filtered LOCALLY over that store       497 survivors
            detail fetched for survivors only                 497 requests
sets        one request per (language, set) the cards         137 requests, first sync only
            landed on, for its release date
images      one webp BLOB per card, hash-manifest driven      382 images, 26.32 MiB
reconcile   anything upstream dropped is flagged, never deleted
```

A full first sync takes about two minutes; a re-sync with nothing changed takes about
45 seconds, downloads no images at all and sends no set requests.

Start it with the button in the app, or from the box:

```sh
bun run corpus:sync
```

Both write a row to `corpus_sync_jobs`. The button's `POST /api/corpus/sync` returns `202` in
about three milliseconds and the work runs on afterwards; `GET /api/corpus/sync/{id}` and
`GET /api/corpus/status` are how it is watched.

## Membership

`dexId ∈ {43, 44, 45, 182}` **unioned with** a name-contains sweep for Oddish, Gloom, Vileplume
and Bellossom, **minus** TCG Pocket set-ID prefixes, **minus** the `corpus_exclusions` table.

Both halves of the union earn their place, measured:

| Admitted by | Cards | Example |
| --- | --- | --- |
| dex only | 248 | every non-English printing — `Mystherbe`, `Myrapla`, `ナゾノクサ`, `走路草` |
| name only | 19 | `me02.5-001..003` Erika's Oddish/Gloom/Vileplume ex, which carry no `dexId` at all |
| both | 230 | the English catalogue |

The name sweep looks for the four **English** species names in every language, which is why
almost every non-English card arrives through its dex number instead.

### TCG Pocket

Excluded by the prefix `^(?:A\d|B\d|P-A)`. Checked against the live `tcgp` series: that pattern
matches all 15 TCG Pocket sets — `P-A A1 A1a A2 A2a A2b A3 A3a A3b A4 A4a B1 B1a B2 B2a` — and
nothing among the other 203. An equality list built from the unsuffixed IDs would miss eight of
the fifteen.

## Deviations from the spec's pipeline, and why

**The brief form does not carry `dexId`.** The spec's phase 1 filters `dexId` locally over the
brief list; `/v2/{lang}/cards` returns `{id, localId, name, image}` and nothing else. Sorting on
`dexId` does not project it either. So the dex half of membership is one narrow request per
species per language — `?dexId=eq:43` — whose *result* is stored in `corpus_brief` and filtered
locally from then on. The alternative was a detail fetch for all 138,909 brief records to obtain
one field.

**`eq:` is not optional on that query.** TCGdex's default filter is a *contains* match: a bare
`dexId=43` returns 403 English cards, because 431 contains 43. `dexId=eq:43` returns 32. The
pipe form (`dexId=eq:43|44|45|182`) returns zero against an array field, so the four queries stay
separate.

**The brief snapshot is stored, not streamed.** This is what makes the spec's "re-scoping never
means re-crawling" true across syncs rather than only within one: changing the species list or
the dex set re-runs `selectMembers` over `corpus_brief` and fetches detail only for the newly
included cards. It costs 138,909 rows and 10.35 MiB.

**The five axes are localised upstream, and the spec's observed values were English-only.** See
below. This is the largest divergence and the one most worth reviewing.

## The five axes

`variants_detailed` is the only source of variants. The legacy flat `variants`
`{firstEdition, holo, normal, reverse, wPromo}` object is not read at all.

TCGdex returns the axes as **display strings in the card's own language**, mixed with the slug
form, sometimes both within a single language. Raw values observed across the line:

| Axis | Raw values |
| --- | --- |
| `type` → `finish` | `normal`(279) `Normal`(135) `Reverse`(125) `reverse`(90) `holo`(72) `Holo`(54) `reversa`(22, es) `básico`(16, es) `Normale`(16, it) `Olografica`(9, it) |
| `size` | `standard`(347) `Standard`(343) `estándar`(64, es) `Padrão`(64, pt) |
| `foil` | `pokeball` `masterball` `energy` `cracked-ice` `Energia`(it,pt) `Energía`(es) `Énergie`(fr) `Pokéball`(es) `Poké Ball`(it) `Poké Bola`(pt) |
| `stamp` | `1st-edition`(18) `1st edition`(16, ja) `1re Édition`(11, fr) `1. Auflage`(11, de) `set-logo` `Set-Logo`(de) `Logo de la série`(fr) `ross-cawthorn` `bulbasaur` `chris-fulop` `Chris Fulop`(fr) |
| `subtype` | `unlimited`(ja) `missing-expansion-symbol`(en) `Symbole d’extension manquant`(fr) `Fehlendes Erweiterungssymbol`(de) |

The spec names the axes and lists `normal`/`holo`/`reverse` and friends — which is what an
English inspection shows. Across eleven languages the vocabulary is not fixed, and the spec makes
all four filterable axes filterable across the corpus while language is a filter rather than a
grouping. Storing the upstream string would split every axis by language.

So `server/corpus/canonical.ts` canonicalises in two steps:

1. **Slug** — NFKD, drop combining marks, lowercase, runs of anything else to one hyphen. This
   alone settles the spelling case the spec names by hand: `1st-edition` ≡ `1st edition`. It also
   settles `Holo` ≡ `holo` and `Set-Logo` ≡ `set-logo`.
2. **Synonym** — an explicit per-axis table mapping a localised slug onto the English token,
   hand-authored from the values in the table above.

The effect is measurable. `1st-edition` after canonicalisation covers **56 variants** across
en(17), ja(17), fr(11) and de(11). With the slug step alone it would be 34; with neither, 18.

An unrecognised value is **kept as its slug and reported** on the sync job as an unknown axis
value, never dropped. A language TCGdex adds later shows up as a warning rather than as silence.

## Identity

**A card is `(language, set_id, local_id)`**, held as `card_key = "{language}:{card_id}"` with a
unique index on the triple. Language is not decoration: 103 `(set, number)` pairs in this corpus
exist in more than one language, and dropping language from the key collapses **497 cards to
166**.

**A variant is `(card_key, variant_id)`** — the composite primary key, so keying on `variant_id`
alone is unrepresentable rather than merely discouraged. The 817 variants in this corpus carry
**21 distinct `variant_id`s**. The most-shared is held by 264 different cards. The literal string
`"generated"` is held by 106. Keyed on `variant_id` alone the masterset is 21 rows.

`variant_id` is an opaque token and is never parsed.

Hand-added rows take `manual:{uuid}`. `manual` is not a TCGdex language code, and the sync
asserts on every run that upstream has not started minting one.

## Set release dates

The binder's default order is **set release date descending**, and the date is stored nowhere
else. Three endpoints were checked against the live API before this phase was built:

| Endpoint | Carries `releaseDate`? |
| --- | --- |
| `/v2/{lang}/cards/{id}` — the card's `set` object | **No.** `{id, name, cardCount, logo, symbol}` |
| `/v2/{lang}/sets` — the set list | **No.** Not on any entry |
| `/v2/{lang}/series/{id}` | Dates the **series**; lists its sets undated |
| `/v2/{lang}/sets/{setId}` | **Yes** — plus `serie`, `abbreviation`, `cardCount` |

So there is no bulk form and no conditional-fetch story: the ordering costs one request per set.
The phase runs **after `detail`**, over the `(language, set_id)` pairs the cards actually landed
on — **137 pairs**, not the 506 that 46 sets × 11 languages would suggest, because most sets
exist in only one or two of the languages this line appears in.

**It never asks twice.** A release date is a historical fact, so a set already held with one is
skipped. A first sync spends 137 requests; a re-sync of an unchanged corpus spends none. Three
states are re-asked, because each means the fact is still missing: no row, no date on the row, or
a row flagged `missing_upstream`. That is also what makes the phase resumable — a sync
interrupted half way through leaves the rows it wrote and the next one picks up the rest.

**Language is part of a set's identity**, held as `set_key = "{language}:{set_id}"`. The Japanese
`SV3` released on 2023-07-28 and the English `sv03` on 2023-11-03; one row per set ID would order
one of them by the other's date and be silently wrong.

`release_date` is an **ISO `YYYY-MM-DD` string and never an epoch**. A set released "on 16 June
1999" was not released at an instant, and `new Date("1999-06-16")` formatted west of UTC reads as
the 15th. Null is tolerated — upstream dates every set this corpus references today, promos
included (`miscp` → `1996-01-01`) — and the binder orders undated sets **last**, never first.
`GET /api/corpus/status` reports how many sets have no date, because a number climbing there is
the only warning that the default order has stopped meaning what it says.

A set that 404s is **flagged, not deleted**, and a placeholder row is written if there was
nothing to flag — cards still point at it, and without a row there would be no record that the
question had already been asked. A set fetch that fails at the transport leaves no row at all and
is retried next sync; a failure is not a disappearance.

## Images

One `high.webp` BLOB per **card** record. 382 of the 497 cards have an image upstream;
**26.32 MiB** in total, mean 71 KB, largest 184 KB.

**The URL is upstream's `image` field with `/high.webp` appended, never reassembled.** Every path
segment is case-sensitive: `/EN/…`, `/…/BASE2/…` and `/…/HIGH.webp` all return 404 while the
lowercase forms return the image. Japanese set IDs are naturally uppercase (`SV3`, `S9a`,
`PMCG2`) and the language segment is `zh-tw`; our own columns cannot be trusted to reproduce
that casing, and upstream's URL already carries it.

Incremental sync is driven by `datas.json` — 6.4 MB, keyed `language → series → set → localId →
hash`, not by card ID. The coordinates are read back off the image URL's four segments, which is
also the only place the *series* is named (nothing in the card payload carries it). All 382
cards with an image resolve to a manifest entry.

The manifest carries an `ETag` and honours `If-None-Match`, so a re-sync with nothing changed
costs one conditional request and downloads no images. That is the whole conditional-fetch story
— the manifest has none of its own at the per-card level.

## Re-import safety

- Upsert keys are `(card_key)` and `(card_key, variant_id)`.
- **Nothing is ever deleted or renumbered.** A row upstream no longer carries is flagged
  `missing_upstream` with a `missing_since` stamp and kept; if it comes back the flag clears and
  `first_seen_at` is untouched, so a copy pointing at it still resolves.
- **A row with `provenance = 'manual'` is never touched** — `WHERE provenance <> 'manual'` on the
  update half of every upsert.
- **`corpus_exclusions` is never written by a sync.**
- Reconciliation is scoped to the languages that sync actually completed. A language whose fetch
  failed does not have its whole corpus declared vanished.

`variant_count_before` and `variant_count_after` are recorded on every job, and the status
document raises `variantCountDropped`. Completion has no oracle: a membership regression that
silently drops rows shrinks the denominator and makes the percentage go *up*, with every test
still green. This is the only warning that would ever fire.

## Storage

After three syncs against the live API:

| | |
| --- | --- |
| database file | 43.5 MiB |
| `corpus_cards` (incl. 26.32 MiB of image BLOBs) | 26.71 MiB |
| `corpus_brief` | 10.35 MiB |
| `corpus_variants` | 0.13 MiB |
| `corpus_sets` (137 rows) | negligible |

Comfortably under the spec's 125 MB estimate for the finished application, most of which is owner
photographs that do not exist yet.

## Known gaps

- **`ja|E3-003` lists the same variant twice upstream**, with identical `variantId`. Identity is
  `(card, variant_id)`, so it is one row — which is why the corpus holds 817 variants where a
  naive count of `variants_detailed` entries gives 818.
- **Korean and Simplified Chinese carry zero Oddish-line records**, confirmed again here. They are
  in the derived language list and are swept every sync, so a first record would be picked up
  without a code change. Until then they are what manual entry exists for.
