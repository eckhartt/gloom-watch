---
id: 01M041423P4521SRPQW783146Y
type: doc
title: domain glossary
status: living
---
The ubiquitous language of Gloom Watch. This says what words **mean** here — not
how they are implemented and not what is planned. Living document: update it the
moment a term resolves.

## Oddish line

The species scope of the collection: **Oddish, Gloom, Vileplume, Bellossom**.

Operationally, a card is in the Oddish line if it matches **either** TCGdex
`dexId ∈ {43, 44, 45, 182}` **or** a name-contains sweep for those four names —
the union of the two, not either alone. `dexId` alone provably misses records
where TCGdex left the field unset; the name sweep alone pulls in false hits that
need a small manual exclusion list.

The union catches the trainer-owned and mechanic variants automatically:
`Erika's Gloom` (`gym1-45`, `gym1-46`), `Dark Gloom` (`base5-36`), `Gloom δ`
(`ex13-42`), `エリカのクサイハナ` (`MC-002`).

A card that merely *pictures* the line without carrying the name is **not** in
scope. Cameo art is out.

## Masterset

Every distinct **variant** in the Oddish line that was **physically printed** as
a **Pokémon Trading Card Game** card.

Three words are load-bearing:

- **Physically** — TCG Pocket digital-only cards (TCGdex set IDs `A#`, `B#`,
  `P-A`) are excluded. Never printed, cannot be held, cannot appear on eBay.
- **Printed** — sealed product is excluded. The app tracks cards, not product.
- **Trading Card Game** — Topps, Bandai Carddass, Amada, vending-machine prints,
  stickers and jumbo/oversized cards are all excluded. TCGdex carries none of
  them, so each would be a hand-typed row with no image, no stable ID, and
  nothing for the eBay matcher to recognise.

Size: **~765 variants** from TCGdex, plus manual rows.

## Variant

**The unit of collecting — one row in the masterset, and the thing a completion
percentage counts.**

A variant is a card together with its print-variant attributes, taken from
TCGdex's `variants_detailed`: finish (`normal` / `holo` / `reverse`), and subtype
or stamp such as `1st-edition`, `shadowless`, `unlimited`,
`1999-2000-copyright`, `missing-expansion-symbol`, prerelease `set-logo`, and
World Championship deck stamps (`chris-fulop`, `ross-cawthorn`).

So Base Set Charizard resolves to four distinct variants, and "I have the
Unlimited, I still need the 1st Edition" is expressible. Any coarser grain would
mark a card complete on owning any one printing.

**Identity:** `(card_id, variantId)`. Never `variantId` alone — it is a hash of
the *attribute set* and is shared across different cards.

## Card

One **language-specific printed card record**, as TCGdex models it:
`{setId}-{localId}` inside a language namespace.

English Obsidian Flames Gloom (`sv03-002`) and Japanese Obsidian Flames Gloom
(`SV3-002`) are **two different cards**, not one card in two languages. Their set
names, card numbers and rarities genuinely diverge, and TCGdex 404s each ID in
the other's namespace.

A card is not the collectible unit. A **variant** is.

## Print-run distinction vs per-object defect

**The rule that decides whether something earns a variant row.**

- A **print-run distinction** affected a whole batch as it left the press.
  Shadowless, 1st Edition, Unlimited, `1999-2000-copyright`,
  `missing-expansion-symbol`. Two collectors' copies of it are the same
  collectible, so **it gets its own variant row**.
- A **per-object defect** happened to one physical card. Miscuts, ink errors,
  colour shifts, crimps, off-centre and square cuts. Two miscut Glooms are not
  the same collectible as each other, and there is no source, ID or image for
  any of them, so **it is not modelled anywhere** — not as a variant, and not as
  a field on a copy.

## Copy

**One physical card the owner actually holds**, pointing at exactly one variant.

The variant is the abstract printed thing; the copy is the object in the binder.
Condition, grading and purchase details belong to the copy, never to the variant
— a PSA 10 and a raw card are the same printed variant, so a graded eBay listing
still resolves to the same row.

A copy carries **no defect or error field**, per the per-object-defect rule
above — but it does carry a free-text `note`, and **defects may appear there as
remarks**. The distinction that holds: defects are not data, but they can be
prose. Nothing counts, filters or matches on a note.

**One row per physical card**, never a quantity count — two copies of the same
variant routinely differ in condition, grade and price.

A disposed copy **keeps its row** with `status = disposed` and a date, so
purchase history survives. Completion counts only `status = owned`.

Price is stored in the currency actually paid **plus a home-currency snapshot
taken at the moment of purchase** (home currency: **AUD**), because the
historical exchange rate is unrecoverable later.

## Provenance — `tcgdex` | `manual`

**Where a variant row came from.** A property of the masterset, not of anything
the owner holds.

**Manual variants are first class and count toward completion.** They exist
because TCGdex has zero Oddish-line records in Korean or Simplified Chinese
despite carrying those languages, and is missing "The Best of XY" (~4 cards) in
every language.

Consequence for ingest: a corpus re-import must never delete a manual row, never
renumber one, and never orphan a copy pointing at one.

**Do not call this "source"** — see below.

## Acquisition source — `ebay` | `shop` | `trade` | `gift` | `auction` | `other`

**Where the owner got a particular copy.** A property of one physical card.

Distinct from **provenance**, which is about where a *variant row* came from.
The two were briefly both called "source"; they are not the same thing and a
single word covering both would become two implementations.

**eBay's `seller.username` is never stored here.** Persisting eBay user data
would remove the option to opt out of eBay's account-deletion notifications,
forcing a public HTTPS endpoint and ruling out a tailnet-only deployment. A
free-text note the owner types themselves is fine.

## Priority

An optional ranking on a **variant** the owner does not yet hold.

There is no want-list: in a masterset, anything unowned is implicitly wanted.
Priority exists as the dial the notification policy needs against a feed of
1,000–3,000 listings per day.

## Listing

**One eBay item observed by the scanner**, which may or may not resolve to a
known variant.

A listing is raw observed data, not a claim about the collection. Resolving a
listing to a variant is a separate, fallible act — see the matching ticket.
