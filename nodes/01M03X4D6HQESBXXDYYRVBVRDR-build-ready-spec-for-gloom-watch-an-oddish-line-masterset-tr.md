---
id: 01M03X4D6HQESBXXDYYRVBVRDR
type: group
title: Build-ready spec for Gloom Watch, an Oddish-line masterset tracker
status: todo
---
## Destination

A build-ready spec for **Gloom Watch**: a self-hosted, single-user PWA that
tracks a masterset of the Oddish evolutionary line, records which copies are
owned, and pushes an iOS notification when a new matching eBay listing appears.

The map is done when every decision below is resolved and `ork-spec` can
synthesize the spec without asking anything further. **Nothing is built during
this map** — no schema, no server, no PWA shell. Prototypes are only permitted
where a `ticket=prototype` says so.

## Notes

### The domain

- **Masterset** — every distinct printed card in a chosen scope, across all
  sets, languages and print variants. The owner's scope is the **Oddish line**:
  Oddish, Gloom, Vileplume, Bellossom, plus cards whose name contains one of
  those (Erika's Gloom, Dark Vileplume, Gloom ex, Vileplume VMAX, and so on).
  The exact boundary is still a live decision — see the boundary ticket.
- **Variant** — the unit of collecting. Two objects with the same set and card
  number may still be different collectibles (1st Edition vs Unlimited,
  holo vs reverse holo, English vs Japanese vs German). How finely the schema
  splits these is the single most load-bearing decision on this map: every
  other table hangs off what counts as one row.
- **Copy** — one physical card the owner holds, pointing at exactly one variant.
- **Listing** — one eBay item observed by the scanner, which may or may not
  resolve to a known variant.

### Fixed by the owner, not up for re-litigation

- **Single user.** No multi-tenancy, no account system, no sharing. Auth exists
  only to keep the internet out.
- **Self-hosted on hardware the owner already has** — a home server or a Mac.
  Not a cloud VPS. This constrains the always-on story and the HTTPS ingress,
  and iOS Web Push requires both.
- **TypeScript throughout**, with **SQLite** as the store. Bun is the presumed
  runtime but is explicitly a decision, not an assumption.
- **iOS PWA installed to the Home Screen** is the only client that matters. iOS
  Web Push only works for Home-Screen-installed PWAs, which rules out any design
  depending on browser-tab notifications.

### Prior art the owner named

These are starting points for the data-source research, not endorsements:

- <https://scrydex.com/> — commercial card-data API, includes pricing
- <https://tcgdex.dev/> — open multi-language Pokémon TCG API
- <https://www.pokewallet.io/> — collection-tracking product, useful as UX prior art

### Working the map

- One ticket per session, **except** `ticket=research`, which may be fired in
  parallel.
- `hitl=yes` tickets need the owner in the room. Do not answer the owner's side.
- Write the resolution into the ticket body **before** moving it to `ruled` —
  a decision freezes on close and a bricked resolution cannot be repaired.

## Not yet specified

- **The shape of the PWA itself.** Browse-by-set vs browse-by-variant, how
  masterset completion progress is shown, whether the listing feed is a separate
  view or folded into the card pages. Cannot be phrased sharply until variant
  granularity and the collection model are settled — the UI is a view over a
  schema that does not exist yet.
- **How the phone authenticates to the home server.** Hangs on the hosting and
  ingress decision: a Tailscale-only origin and a public Cloudflare Tunnel imply
  completely different answers, and one of them may need no auth at all.
- **Offline behaviour.** What the installed PWA can still do with no network —
  browse the collection, view cached images, queue edits. Hangs on the stack
  decision and on where images live.
- **Marketplaces beyond eBay.** A masterset of the Oddish line is full of
  Japanese-only prints, which trade heavily on Yahoo Japan Auctions and Mercari
  JP. This looked essential when the map was charted; the eBay research has since
  weakened it. There is no `EBAY_JP` in the Buy APIs, but Japanese cards reach
  `EBAY_US` anyway — a single US search returned 4,227 Japanese-language
  listings. So eBay alone is no longer obviously insufficient. Revisit once the
  scanner has run against real data and the actual Japanese coverage is
  measurable rather than assumed; it may graduate into tickets, or prove to sit
  past the destination.

## Out of scope

- **Market price comparison** — showing each listing's price against a
  TCGplayer/Cardmarket/sold-comps benchmark to flag deals. Consciously dropped
  from v1 by the owner: it drags in a second paid data source, a pricing history
  store, and a currency model, none of which the "is this new, do I have it"
  loop needs. Ticket: "Price-vs-market benchmarking on listings" — see the
  archived `moot` ticket for the full reasoning.
