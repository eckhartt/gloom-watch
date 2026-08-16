---
id: 01M04BB8BBHWV24EP97K29RP28
type: decision
title: What are the PWA's screens, and how does the collection read?
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
meta:
  ticket: prototype
  hitl: yes
  claimed: prototype-session
---
## The question

What are the screens, and how does the collection actually read?

This was fog while variant granularity and the collection model were open — the
UI is a view over a schema, and the schema did not exist. **Both are now settled,
so this is specifiable.**

## Why it is a prototype ticket, not a grilling one

"How should it look" is the wrong question to answer in conversation. Build two
or three cheap, throwaway screens against real data and react to them. The
corpus is ~765 rows and already well understood, so a static mock with real card
names, sets and images is quick to produce.

## What the surfaces are

The decisions on this map have already committed to these, whether or not their
shape is designed:

- **The masterset browse view** — ~765 variants, image-heavy, needs
  virtualisation. Filters over set, language, finish, print variant, owned/needed
  and priority. Filters live in typed URL search params (`01m03xa8cw`), so a
  filtered view is shareable and survives reload.
- **A card / variant detail view** — the corpus image, the owner's own
  photographs, copies held, and current listings.
- **The listing feed** — what the scanner found, with have-it/need-it state.
- **The confirm queue** (`01m03xa9gz`) — confirm / pick-other / not-a-match, plus
  whatever teaches an alias.
- **The lots view** (`01m03xa9gz`) — listings flagged as bundles, never resolved
  to a variant.
- **Collection entry** — adding a copy, and clone-and-edit for manual variants
  (`01m03xaamk`).
- **Health surfaces** — last scan time, last backup verified, corpus last synced,
  outbox pending count.

## What to decide

- **How completion is presented.** Masterset progress by set, by language, by
  species, or one headline number. This is the emotional core of a masterset
  tracker and deserves more thought than a progress bar.
- **Browse-by-set vs browse-by-variant** as the primary axis, given that a card
  can be up to four rows.
- **Whether the listing feed is its own view or folded into card pages.**
- **How a needed card is visually distinguished** from one already owned, at a
  glance, in a dense grid.
- **How the notification tap lands** — `navigate` deep-links to a same-origin
  route, so a listing detail route must exist and resolve on cold load.
- **How much of this is v1** versus deferred once the loop works.

## Constraints already fixed

- Tap targets must be **same-origin and inside the manifest scope**.
- The manifest icon is the **only** notification icon, so it does real work.
- Images cache `CacheFirst` with an explicit bulk warm — a dense grid on first
  load will be network-bound.
- The outbox surfaces a pending count.

## How to resolve

Build throwaway screens against real TCGdex data, put them in front of the owner,
and record what they react to. Do not build production components.
