---
id: 01M03XA78KZN54BHSM6G9ZBPTV
type: decision
title: What is in the masterset, and what counts as one card row?
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA7TY3EEWANSAG7KZSS3Y
    type: blocks
  - to: 01M03XA9GZ6ZRV3CBTF2F460EN
    type: blocks
  - to: 01M03XAAMK96EN2TFBHEYGABXQ
    type: blocks
meta:
  ticket: grilling
  hitl: yes
---
## The question

What is in the masterset, and what counts as **one row** in the cards table?

The owner has fixed the broad scope: the **Oddish line** — Oddish, Gloom,
Vileplume, Bellossom, plus cards whose name contains one of those. That settles
the species. It does not settle the two hard edges.

## Edge one — which printed objects are in

Work through these and rule on each:

- **Trainer-owned and mechanic variants.** Erika's Gloom, Dark Vileplume,
  Gloom ex, Vileplume VMAX, Vileplume V, Bellossom GX. In, presumably — but say
  so explicitly, because the rule "name contains" is what the ingest filter will
  literally implement.
- **Cards where the line appears but is not the subject.** Artwork cameos, a
  Trainer card named after Erika that pictures Gloom, Vileplume in the art of an
  unrelated card. Almost certainly out — confirm.
- **Non-standard formats.** Jumbo/oversized cards, Topps cards, stickers,
  Carddass, Amada, Bandai, vending-machine prints, and other non-TCG Pokémon
  cards depicting the line. These are a large and murky population.
- **Non-playable printings.** Deck exclusives, energy-swap promos, prerelease
  stamps, staff prints, World Championship reprints.
- **Sealed product** containing the line. Presumably out entirely — the app
  tracks cards, not product.

## Edge two — what makes two objects different rows

This is the load-bearing half. For each axis, decide whether it splits a row,
becomes a column on the row, or is ignored entirely:

- **Language.** Is English Base Set Gloom the same row as Japanese Base Set
  Gloom, with a language column, or two rows? Consider that card numbers,
  rarities and even sets diverge between regions.
- **Print run.** 1st Edition, Shadowless, Unlimited.
- **Finish.** Non-holo, holo, reverse holo, cosmos/confetti holo patterns.
- **Regional set differences.** Where a set has no clean cross-language
  equivalent.
- **Error and misprint cards.** Ink errors, miscuts, missing stamps.
- **Grading.** A PSA 10 and a raw copy are the same printed card. Grading almost
  certainly belongs on the *copy*, not the card — confirm and write down why, so
  nobody re-opens it.

## Why it matters

Masterset completion is counted against these rows. Set the granularity too
coarse and the tracker cannot express "I need the 1st Edition"; too fine and the
masterset becomes uncountable and permanently incomplete. This decision also
sets the target that eBay listing matching has to hit.

## How to resolve

Grill it out with the owner — this is a preference question about how *they*
collect, not a fact to be looked up. Bring the data source's actual granularity
to the conversation, because modelling a distinction the source does not publish
means synthesizing it by hand forever.

Resolve into: the inclusion rule stated precisely enough to implement as a
filter, and the list of axes that split a row versus those that are columns.
