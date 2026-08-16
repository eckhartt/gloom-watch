---
id: 01M03XA9GZ6ZRV3CBTF2F460EN
type: decision
title: How does an eBay listing resolve to a specific card?
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XAA33X9BVPKF8BP747MZV
    type: blocks
meta:
  ticket: grilling
  hitl: yes
  claimed: interview-session
---
## Resolution

**A layered parse against the local corpus, biased toward precision, with a
manual confirm queue as the pressure valve and corrections that generalise as
aliases.**

The framing that decides the approach: **the corpus is small and closed.** ~765
variants, every card name, set name and card number a known local string. That
makes matching a **lookup** problem rather than a guessing one, which is why a
per-listing LLM call was not needed as the front door.

## The pipeline

```
1  CHEAP FILTER
   category 183454 + Oddish-line name regex
   + proxy/custom-art exclusion
   -> drops junk-word "gloom" and fakes

2  PARSE TITLE against the local corpus
   name -> set -> card number -> features -> finish -> language
   e.g. "Erika's Gloom 1st Edition Gym Heroes 43/132 PSA 8"
        => (gym1-45, {normal, 1st-edition}), grade PSA 8

3  SCORE CONFIDENCE
   >= threshold  -> auto-match
   <  threshold  -> confirm queue

4  RECORD
   raw payload + matched variant + confidence + matcher version
```

The **confidence threshold is a tunable, not a constant fixed here.** The
*bias* is decided; the value is set empirically once real listings arrive.

## Precision over recall — and why

**The two errors are not symmetrical.**

- A **wrong auto-match** is silent and persistent. It corrupts have-it/need-it,
  tells the owner they already have a card they do not, and may never be
  discovered.
- A **queued listing** is visible, gets resolved once, and teaches an alias that
  shrinks the queue.

So the auto-match bar sits high and the queue absorbs everything else.
**Accepted cost:** the queue will feel heavy early, before aliases have
accumulated.

## Corrections become aliases, not overrides

This is the mechanism that makes the system improve with use.

A correction teaches the parser a **name alias**, not a fact about one listing:

```
you fix:  "クサイハナ ホロ ジャングル" -> JA Jungle Gloom, holo
stored:   alias "クサイハナ" -> gloom (ja)
result:   every future listing containing it parses unprompted
```

Per-listing overrides were rejected because a relisted item re-asks the same
question forever and the queue never gets smarter.

**This is not ML training on eBay content.** It is a hand-curated alias table the
owner owns — legally clean under eBay's prohibition, and debuggable in a way a
trained model would not be.

**The alias table is irreplaceable data with no upstream source.** It belongs in
the backup story alongside copies and photographs — recorded on `01m042kp8g`.

## Language resolution

In order:

1. **Explicit marker in the title** — "japanese", "jp", kana, kanji, "german",
   "french", and so on.
2. **`itemLocation.country`** — returned free in every search result, so a
   JP-located listing is strong evidence even under an English title.
3. **Default to English.**

A wrong language guess is a wrong variant, but routing all ~26% of unmarked
listings to the queue would drown it. Measured base rates on eBay US: English
18,501, Japanese 4,227, Chinese 307, Korean 88.

## Lots are flagged, never resolved

A title naming several cards, or carrying "lot" / "bundle" / "x50" / "bulk" /
"collection", is marked `is_lot` with the names it mentions and **no variant
link**.

Bargains genuinely hide in bulk lots, so they are surfaced in their own view —
but claiming a 50-card lot *is* a specific variant would corrupt have-it/need-it,
and matching it to every card named would flood the need-it view with one listing
repeated dozens of times.

## Proxies and custom art are filtered out

They can never fill a masterset gap. Two cheap signals: eBay's own **Features**
aspect (`Altered/Custom Art`, 553 live in a single Gloom search) and title
keywords — proxy, custom, fan art, repro, reproduction, orica, not official,
metal card, gold plated.

**Filtered listings must be logged, not silently dropped.** A keyword like
"custom" can catch a genuine card whose title mentions a custom sleeve, and an
invisible filter is one whose mistakes are never learned.

## Grade is parsed but never matches

`PSA 8` parsed from a title is stored **on the listing** as `grader` + `grade`,
and plays no part in choosing the variant — consistent with grading living on the
copy. A slab and a raw card are the same printed variant. eBay also signals
graded stock via `conditionId` `LIKE_NEW` (2750).

This makes "raw only" and "graded only" filters possible when hunting.

## Raw listings retained 90 days

Stored with the resolved match, the confidence, and **the matcher version**.

That last field is what makes improvement measurable: an improved matcher can be
re-run over ~90k–270k real listings and compared against the previous version's
results. Without stored raw data the parser could only ever be improved against
live traffic, one day at a time.

**At 90 days the eBay payload is deleted.** What survives is the variant link,
the owner's confirmations, the aliases and the notification history — so nothing
of the owner's is ever lost, only eBay's data expires.

This sits inside eBay's licence, which permits *"limited intermediate copies...
deleted when they are no longer required for the purpose for which they were
created."* An indefinite archive would not.

## Constraints inherited and honoured

- **No per-item aspects are available.** `localizedAspects` lives only on
  `getItem` — one call per listing from the same 5,000/day pool as the searches —
  so at 1,000–3,000 new listings/day, per-item enrichment is unaffordable. v1
  runs on title text plus result-set aspect filters.
- **eBay forbids training on its content.** Inference is permitted; fine-tuning a
  classifier on scraped titles is not. The alias table sidesteps this entirely.
- **The target grain is `(card_id, variantId)` in a specific language**, fixed by
  `01m03xa78k`. A harder target than card-level matching.

## Alternatives weighed and rejected

- **Aspect-filtered query fan-out** — elegant, since every hit on an
  aspect-filtered search is *known* to carry those aspects, removing parsing
  entirely. Rejected as the primary: sets × languages × finishes is hundreds of
  combinations against 5,000 calls/day, impossible to poll every 10 minutes.
  **Still viable as targeted enrichment for high-priority variants.**
- **LLM classification of every title** — handles messy phrasing and
  transliteration well, but costs a call per listing at 1,000–3,000/day, is
  nondeterministic across runs, and is hard to unit test. **Retained as a
  candidate fallback for the low-confidence tail**, not the front door.
- **Exact structured match only** — very high precision, would miss most vintage
  and Japanese listings, which is most of this masterset.
- **Discarding low-confidence listings** — would silently lose exactly the
  obscure Japanese cards this collection most needs.
- **An unmatched feed with no confirm step** — zero interaction cost, but nothing
  ever improves.
- **Matching lots to every card named** — floods the need-it view.
- **Discarding lots entirely** — loses how masterset gaps often get filled cheaply.
- **Per-listing correction overrides** — relists re-ask forever.
- **Language unknown unless stated** — thousands of queue items a month.
- **Always default English, ignoring location** — mis-files JP-seller listings.
- **Ignoring grade** — loses the ability to tell a $40 raw card from a $400 slab
  at a glance.
- **Indefinite raw retention** — sits badly against the intermediate-copies clause.

## Scope consequences

1. **The confirm queue is a v1 UI surface** — a screen with confirm / pick-other /
   not-a-match. Beyond the originally scoped v1, accepted deliberately.
2. **A lots view** is a second surface, smaller.
3. **Queue depth is a health signal** — growing fast means the parser needs work.
