---
id: 01M040Q85739HCK6QWZ5DT29D0
type: session
title: "session: Build-ready spec for Gloom Watch, an Oddish-line masterset tracker"
status: closed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
---
# Session close-out

Charting session for the Gloom Watch wayfinder map. The map was created from
scratch on an empty graph in an empty repository, and all four research tickets
were fired and resolved. **Nothing was built** — no schema, no server, no PWA.

## What changed

- **Created the map** `01m03x4d6h` — "Build-ready spec for Gloom Watch, an
  Oddish-line masterset tracker". Destination: a build-ready spec that
  `ork-spec` can synthesize without further questions.
- **Created 12 tickets**: 4 research (all now `ruled`) and 7 grilling decisions
  (all `hitl=yes`, all still open), plus 1 ruled out of scope.
- **Wired 14 `blocks` edges**, plus two `relates` edges recording cross-links the
  research surfaced (eBay → hosting, iOS push → stack).
- **Ruled out of scope**: `01m03xaxxs` price-vs-market benchmarking — `moot` and
  archived, with reasoning preserved in its body.
- **Updated the map body once**, revising the "marketplaces beyond eBay" fog
  patch after the eBay research undermined the assumption behind it.

## Decisions made

All four are research resolutions; each ticket body holds the answer and each has
a child `research` node holding the full survey with citations.

- **`01m03x9wy0` — TCGdex is the canonical card corpus.** Free, **MIT-licensed**
  (clause quoted in the body), bulk-downloadable, and the only source modelling
  Japanese prints as first-class separate records. Verified live against
  `Erika's Gloom`, `Dark Gloom`, `Gloom δ` and `エリカのクサイハナ`.
  **pokemontcg.io is dead** — HTTP 500, absorbed into Scrydex. Scrydex is $29/mo
  with terms that never affirmatively permit local storage.
  **Corpus size is ~475 records → ~765 variant rows** — hundreds, not tens of
  thousands, which makes hand-curating the gaps tractable.
- **`01m03x9xfd` — eBay Browse API `item_summary/search`.** Finding/Shopping were
  decommissioned Feb 2025. Client-credentials auth suits an unattended box: no
  refresh token, no browser. It is a real cursor via `itemStartDate`. Quota 5,000
  calls/day → a 10-minute cycle across US+GB.
- **`01m03x9y1f` — iOS Web Push is viable, free, no Apple developer account.**
  But origin coupling is total, silent push is impossible with a three-strike
  lifetime penalty, and APNs stores only **one** message while offline.
- **`01m03x9ykk` — Node 24 LTS, not Bun.** Bun's stable has been frozen since May
  2026 pending a Zig→Rust rewrite, with open idle-server memory-growth reports.
  On macOS `bun:sqlite` silently links SQLite 3.43.2 with a known FTS5 corruption
  bug. Recommended stack: Hono, better-sqlite3, Drizzle (`generate` only), Vite 8,
  `vite-plugin-pwa` in `injectManifest` mode, croner, single package.

## Constraints every later session must respect

These came out of research and are easy to violate by accident:

- **The origin is permanent.** Hostname, port, scheme and the service worker's
  scope URL cannot change after first install without killing the icon, the SW
  registration, the permission grant and the push subscription simultaneously.
  WebKit has no migration path.
- **Notifications must be summaries, not a per-listing stream** — APNs keeps a
  queue of exactly 1 while the phone is offline.
- **The service worker must call `showNotification()` unconditionally** from the
  encrypted payload, never after a `fetch()` to the origin. Three 30-second
  failures ever — the counter has no reset path in WebKit's source — revoke all
  subscriptions for the origin. It cannot be reproduced under a debugger.
- **eBay forbids training ML on its content.** Rule-based or embedding-lookup
  matching against a corpus we own is fine; fine-tuning on scraped titles is not.
- **eBay licenses only "intermediate copies"** and caps *displayed* listing data
  at six hours old.
- **TCGdex ingest traps:** canonicalise `stamp` (`1st-edition` vs `1st edition`
  both occur); key on `(card_id, variantId)` because `variantId` is an attribute
  hash shared across cards; filter TCG Pocket digital-only set IDs.
- **Avoid runtime-specific APIs** (no Elysia, no `Bun.serve` routes, no
  `bun:sqlite`) so the Node-vs-Bun call stays cheap to reverse.

## Open questions

The frontier is three HITL tickets. **`01m03xa78k` should go first** — it blocks
three of the remaining four.

- **`01m03xa78k` — what is in the masterset, and what counts as one row?** The
  load-bearing decision. Does language split a row? Does 1st Edition? TCGdex can
  represent all of it, so this is purely a question about how the owner collects.
  eBay's facets confirm `Erika's Gloom` and `Dark Gloom` are real distinct card
  names with thousands of listings.
- **`01m03xa8cw` — lock the stack.** Two calls are genuinely close and deliberately
  left open: **Drizzle vs Kysely** (auto-generated SQLite table rebuilds vs
  hand-written migrations you read every statement of) and `better-sqlite3` vs
  `node:sqlite`. Everything else in the toolchain resolution is not close and
  should not be re-litigated.
- **`01m03xa8ys` — where the server runs and how the phone reaches it.** Must
  settle a permanent origin. A custom domain with a DNS-01 cert is more durable
  than any `*.ts.net`. **This ticket must include the five-minute empirical test:
  turn Tailscale off on the phone, send a push, confirm the banner arrives** —
  the outbound-only claim is well-reasoned inference, not something the research
  could confirm authoritatively.
- Also unresolved, and cheap to settle once a keyset exists: whether
  `itemStartDate` keys off `itemCreationDate` or `itemOriginDate`, the real
  listings-per-day figure, and GB/DE/AU category IDs.

## Still fog

PWA shape; how the phone authenticates to the server; offline behaviour; backup
and export of collection data (the corpus is re-derivable, the owned copies are
not); marketplaces beyond eBay — now weakened, since Japanese cards reach
`EBAY_US` anyway.

## Links

- Commits: on the `orchestrator` data branch — map `01m03x4d6h` and its children
- PR: none
