---
id: 01M03XA9GZ6ZRV3CBTF2F460EN
type: decision
title: How does an eBay listing resolve to a specific card?
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
meta:
  ticket: grilling
  hitl: yes
---
## The question

How does a raw eBay listing become a specific card in the masterset?

This is the hardest product problem on the map. The have-it/need-it feature —
one of the three things the owner named as v1 — is entirely this problem. Get it
wrong and every notification is either noise or a lie.

## The difficulty

eBay titles are written by sellers, not by a schema. Real examples of the shape:

- `Pokemon Gloom 44/102 Base Set WOTC 1999 LP`
- `Gloom Holo Japanese Jungle Set Pokemon Card`
- `POKEMON CARD LOT 50x Vintage Vileplume Gloom Oddish NM`
- `Erika's Gloom 1st Edition Gym Heroes 43/132 PSA 8`

The system has to place each of these against a variant row whose granularity
was fixed by the masterset boundary decision — including language, print run and
finish, which titles state inconsistently, abbreviate, or omit entirely.

## What to decide

- **The approach.** A hand-written heuristic parser over titles, fuzzy matching
  against the card corpus, an LLM classification pass, eBay's structured item
  aspects if the API research found them usable, or a layered combination.
- **Confidence and the unmatched.** What happens when the system is unsure.
  Options: discard, show as "unmatched" in a feed, or queue for the owner to
  resolve by hand. Decide whether a manual confirm queue exists at all — it is a
  whole UI surface if it does.
- **Multi-card listings.** Lots and bundles naming several cards. Match to all,
  to none, or flag as a lot and handle separately.
- **Wrong-Pokémon noise.** Listings using "gloom" as an English word, or
  non-Pokémon results. Where they get filtered.
- **Graded listings.** Whether the grade parsed from a title is recorded on the
  listing and used in matching, given that grading lives on copies rather than
  cards.
- **Correction.** Whether the owner can override a bad match, and whether that
  correction teaches the system anything or is a one-off fix.
- **Storage.** Whether the raw listing is stored alongside its resolved match,
  so the matching logic can be re-run later without re-querying eBay. Strongly
  suggested — re-running against improved logic is otherwise impossible.

## Why it matters

Notification policy sits directly on top of this: "only tell me about cards I do
not own" is unanswerable unless listings resolve to variants reliably enough to
trust the answer.

## How to resolve

Grill it out with the owner, with real eBay search results in hand from the API
research. Their tolerance for false positives versus missed listings is the
deciding input, and only they can supply it.

Resolve into a named strategy, an explicit confidence policy, and a ruling on
whether a manual confirm queue is in v1.
