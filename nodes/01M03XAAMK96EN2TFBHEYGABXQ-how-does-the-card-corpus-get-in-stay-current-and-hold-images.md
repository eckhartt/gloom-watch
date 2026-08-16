---
id: 01M03XAAMK96EN2TFBHEYGABXQ
type: decision
title: How does the card corpus get in, stay current, and hold images?
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
meta:
  ticket: grilling
  hitl: yes
  claimed: interview-session
---
## The question

How does the card corpus get into SQLite, stay current, and where do the images
live?

The masterset is not static. New sets release, sources correct their data, and
the masterset boundary decision may be refined after the first import — each of
which has to be absorbable without hand-editing rows.

## What to decide — ingest

- **Shape.** A one-shot import script run by hand, a scheduled sync, or an
  import that can be re-run idempotently on demand. Given that new sets arrive a
  few times a year, a scheduled daily sync may be over-engineering.
- **Filtering.** Whether the full Pokémon corpus is pulled and filtered locally
  to the Oddish line, or only matching cards are fetched. Pulling everything
  costs disk but makes re-scoping free — and the masterset boundary may well be
  refined later.
- **Idempotency and identity.** What the stable local key for a card is, and how
  a re-import updates existing rows without duplicating them or orphaning the
  collection copies that point at them. **Copies pointing at a card that a
  re-import renumbers is the failure mode to design against.**
- **Source corrections.** What happens when the upstream source changes a card's
  data or deletes a record the owner has a copy of.
- **Synthesized variants.** If the boundary decision splits rows more finely
  than the source publishes — separate 1st Edition rows the source does not
  have — decide where those rows come from and how they survive a re-import.
- **Provenance.** Whether each row records which source it came from and when it
  was last synced. Cheap to add, and the only way to debug a bad import later.

## What to decide — images

- **Local copies or hotlinks.** Storing them costs disk and needs a fetch
  pipeline; hotlinking is free until the source rate-limits, changes URLs, or
  goes away — and leaves the PWA useless offline.
- **Where.** Filesystem beside the database, or blobs in SQLite.
- **Sizes.** Whether thumbnails are generated for list views, and what
  resolution the detail view needs.
- **Offline.** Whether images are precached by the service worker for the
  collection, cached on demand, or not cached at all.
- **Terms.** Whatever the data-source research found about permission to store
  local copies is binding here.

## How to resolve

Largely a technical decision the agent can make from the research findings, but
the disk-space and offline trade-offs are worth putting to the owner in one
line each rather than deciding silently.

Resolve into: the ingest mechanism and its trigger, the identity/idempotency
rule, and the image storage and caching approach.
