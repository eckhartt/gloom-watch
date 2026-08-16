---
id: 01M04214D3WJXH0QRFC1S1Y17R
type: session
title: "session: What is in the masterset, and what counts as one card row?"
status: closed
parent: 01M03XA78KZN54BHSM6G9ZBPTV
---
# Session close-out

Interview session resolving the masterset boundary ticket `01m03xa78k` — the
load-bearing decision on the map. Three rounds of questions, ACKed, frozen.

## What changed

- **`01m03xa78k` is `ruled`** — "What is in the masterset, and what counts as one
  card row?" Its body holds the full resolution with rejected alternatives.
- **Created the domain glossary** `01m041423p` (`living`), with entries for
  Oddish line, Masterset, Variant, Card, Print-run distinction vs per-object
  defect, Copy, Source, and Listing.
- **Two tickets unblocked** by the ruling: `01m03xa7ty` (what a copy records) and
  `01m03xa9gz` (listing → card matching).

## Decisions made

**A row is one variant, in one language.** ~765 rows from TCGdex plus manual rows.

- **Language splits rows** — `sv03-002` (EN) and `SV3-002` (JA) are two
  collectibles. Set names, numbers and rarities diverge per region, so a language
  column would have to lie.
- **Print variant splits rows** — TCGdex `variants_detailed` is the grain. Chosen
  over card-as-row (~475) because that would mark a card complete on owning any
  printing, making "have Unlimited, still hunting 1st Edition" inexpressible.
- **Grading does not split rows** — it lives on the copy. A graded eBay listing
  still resolves to the same variant.
- **Inclusion is `dexId ∈ {43,44,45,182}` UNIONED with a name sweep.** The union
  is the decision; `dexId` alone provably missed ~3 records.
- **Out:** TCG Pocket digital (53 records), non-TCG physical (Topps, Bandai,
  Carddass, jumbo, stickers), sealed product, cameo art.
- **The error line:** systematic print-run distinctions are variants; per-object
  defects are not modelled at all. Drew this to resolve a real contradiction —
  `missing-expansion-symbol` ships inside `variants_detailed`, so "variant is the
  row" and "ignore errors entirely" collided on exactly that subtype.
- **Manual card entry is in v1 and counts toward completion** — a deliberate
  scope addition beyond the original v1, so Korean, Simplified Chinese and Best
  of XY become trackable.

## Constraints this creates for later tickets

- **`01m03xa7ty` (copies):** there is to be **no per-copy defect or error field**.
  That follows from the error line and is not re-litigable there. Grading fields
  do belong on the copy.
- **`01m03xaamk` (ingest):** a re-import must **never delete, renumber, or orphan
  a manual row**. Variants carry `source = tcgdex | manual`.
- **`01m03xaamk` (ingest):** canonicalise `stamp` — both `1st-edition` and
  `1st edition` occur at comparable frequency (18 vs 16); missing this silently
  drops half the 1st Edition corpus.
- **`01m03xa9gz` (matching):** the target grain is now fixed — a listing must
  resolve to a `(card_id, variantId)` in a specific language, which is a harder
  target than card-level matching.
- Maintain a **manual exclusion list** for false hits from the name sweep.

## Open questions

The frontier is now four, all `hitl=yes`:

- `01m03xa7ty` — what a copy records. Newly unblocked, and the natural next one:
  it is the other half of the schema and it blocks the notification policy.
- `01m03xa9gz` — listing → card matching. Newly unblocked. The hardest problem on
  the map, now with a fixed target to hit.
- `01m03xa8cw` — lock the stack. Drizzle vs Kysely is the genuinely close call.
- `01m03xa8ys` — hosting and origin. Must settle a permanent origin and must
  include the Tailscale push test.

Unquantified: how many Korean and Simplified Chinese Oddish-line prints actually
exist. It bounds the manual-entry workload but blocks nothing.

## Links

- Commits: `orchestrator` branch — ticket `01m03xa78k`, glossary `01m041423p`
- PR: none
