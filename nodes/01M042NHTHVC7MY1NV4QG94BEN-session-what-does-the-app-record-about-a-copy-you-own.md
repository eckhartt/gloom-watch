---
id: 01M042NHTHVC7MY1NV4QG94BEN
type: session
title: "session: What does the app record about a copy you own?"
status: closed
parent: 01M03XA7TY3EEWANSAG7KZSS3Y
---
# Session close-out

Interview session resolving the collection-model ticket `01m03xa7ty`. Three
rounds, ACKed, frozen. One fog patch graduated into a new ticket.

## What changed

- **`01m03xa7ty` is `ruled`** — "What does the app record about a copy you own?"
  Full field table and rejected alternatives are in its body.
- **Created `01m042kp8g`** — "How is the collection backed up, exported and
  restored?" Graduated from map fog, now that the collection model defines what
  is irreplaceable. Blocked by the stack and hosting tickets.
- **Removed the backup fog patch** from the map body; it lives in one place now.
- **Updated the glossary** `01m041423p`: expanded Copy, added Acquisition source
  and Priority, and **renamed the variant-level `source` to `provenance`** to
  break a genuine collision with the copy-level acquisition source.

## Decisions made

**One row per physical card**, pointing at exactly one variant. Quantity counts
rejected — grading lives on the copy, so a PSA 9 and a raw card cannot share a
row.

- **Condition: `NM`/`LP`/`MP`/`HP`/`DMG`, optional.** Chosen because it is
  *exactly* eBay's Card Condition vocabulary, so a listing maps onto a copy with
  no translation layer. A numeric 1–10 scale was rejected for needing one.
- **Grading: grader + grade + cert number.** The cert number uniquely identifies
  the physical slab and eBay carries it as condition descriptor 27503, so the
  owner could recognise their own card if it resurfaced.
- **Price in original currency + a home-currency snapshot taken at purchase**
  (home currency **AUD**, rate entered by hand, no FX API in v1). The historical
  rate is unrecoverable later — capture at entry or lose it permanently.
- **Owner photos stored, optional per copy.** TCGdex has images for only 28% of
  Japanese cards and none pre-2021, so the owner's scan is often the only image
  that will exist.
- **Disposal retains the row** with `status` + date. Completion counts only
  `status = owned`.
- **Priority lives on the variant, not the copy.** No want-list: in a masterset,
  unowned already means wanted.

## Two rulings that reach beyond this ticket

- **Free-text notes coexist with the no-defect-field ban.** `01m03xa78k` barred a
  defect *field* — column, filter, variant row. A note is unqueryable prose.
  **Defects are not data, but they can be remarks.**
- **`seller.username` is never persisted, and this protects the hosting
  decision.** Storing eBay user data would remove the option to *opt out* of
  eBay's account-deletion notifications, forcing a subscription and therefore a
  public HTTPS endpoint — killing a tailnet-only deployment before
  `01m03xa8ys` is even taken. Hashing was rejected as an untested grey area.

## Open questions

Frontier is three, all `hitl=yes`:

- **`01m03xa9gz` — listing → card matching.** The hardest problem on the map, and
  now fully specified: a listing must resolve to `(card_id, variantId)` in a
  specific language. Note two constraints already fixed — eBay forbids training
  ML on its content, and search results carry **no per-item aspects**, so v1
  matching runs on title text plus aspect filters.
- **`01m03xa8cw` — lock the stack.** Drizzle vs Kysely is the close call.
- **`01m03xa8ys` — hosting and origin.** Must settle a permanent origin and must
  include the Tailscale push test. Now unconstrained by eBay compliance, thanks
  to the seller-data ruling.

Blocked and waiting: `01m03xaa33` notification policy (needs matching),
`01m03xaamk` ingest (needs stack), `01m042kp8g` backup (needs stack + hosting).

## Links

- Commits: `orchestrator` branch — `01m03xa7ty`, `01m042kp8g`, glossary
  `01m041423p`, map `01m03x4d6h`
- PR: none
