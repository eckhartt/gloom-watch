---
id: 01M044240FPBFF1WCSQZJWVH1F
type: session
title: "session: How does an eBay listing resolve to a specific card?"
status: closed
parent: 01M03XA9GZ6ZRV3CBTF2F460EN
---
# Session close-out

Interview session resolving `01m03xa9gz` — listing → card matching, the hardest
problem on the map. Three rounds, ACKed, frozen.

## What changed

- **`01m03xa9gz` is `ruled`.** Full pipeline, rejected alternatives and scope
  consequences are in its body.
- **Updated `01m042kp8g`** (backup) to add the **alias table and match
  confirmations** to the irreplaceable list — they are hand-curated over months
  with no upstream source, and losing them resets matcher accuracy to day one.
- **Updated the glossary** `01m041423p`: added Lot, Alias, Confirm queue, and
  Match confidence / matcher version; extended Listing with the 90-day retention.
- **`01m03xaa33` (notification policy) is unblocked** — it was the last ticket
  waiting on two things at once.

## Decisions made

**Layered parse against the local corpus.** The framing that decided it: the
corpus is small and closed — ~765 variants, every name/set/number a known local
string — so matching is a **lookup** problem, not a guessing one.

- **Precision-biased.** The errors are asymmetric: a wrong auto-match is silent,
  persistent and corrupts have-it/need-it; a queued listing is visible and
  self-correcting. High auto-match bar, queue absorbs the rest. Accepted cost: a
  heavy queue early, before aliases accumulate.
- **Corrections become aliases, not per-listing overrides.** This is the
  mechanism that makes the queue shrink with use rather than re-ask on every
  relist. Explicitly *not* ML training on eBay content — a hand-curated table the
  owner owns.
- **Language:** title marker → `itemLocation.country` (free in search results) →
  default English. Routing all ~26% unmarked listings to the queue would drown it.
- **Lots flagged, never resolved** to a variant.
- **Proxies and custom art filtered out** via eBay's Altered/Custom Art aspect
  plus keywords — but **filtered items are logged, not silently dropped**, since
  "custom" can catch a genuine card with a custom sleeve.
- **Grade parsed onto the listing, never affects the match** — a slab and a raw
  card are the same variant.
- **Raw listings retained 90 days** with confidence and **matcher version**, so
  an improved matcher can be re-run over 90k–270k real listings and *measured*.

## Scope consequences

- **The confirm queue is a v1 UI surface** (confirm / pick-other / not-a-match),
  beyond the original v1 selection and accepted deliberately.
- **A lots view** is a second, smaller surface.
- The **confidence threshold is a tunable**, set empirically once real listings
  arrive. The bias is decided; the number is not.

## Kept as candidates, not chosen

- **Aspect-filtered query fan-out** — every hit on an aspect-filtered search is
  *known* to carry those aspects, so no parsing is needed. Unusable as the
  primary (hundreds of set × language × finish combinations vs 5,000 calls/day)
  but **genuinely viable as targeted enrichment for high-priority variants**.
- **LLM classification** — rejected as the front door (a call per listing at
  1,000–3,000/day, nondeterministic, hard to test) but **retained as a candidate
  fallback for the low-confidence tail**. Inference is permitted by eBay's terms;
  fine-tuning on their content is not.

## Open questions

Frontier is three, all `hitl=yes`:

- **`01m03xaa33` — notification policy.** Newly unblocked, and now the one with
  the most inherited constraints: APNs stores only **one** message while the
  phone is offline, so notifications must be **summaries, not a per-listing
  stream**; no images, no action buttons, `tag` does not coalesce; and the feed
  is 1,000–3,000 listings/day. Priority flags on variants exist as the filter.
- **`01m03xa8cw` — lock the stack.** Drizzle vs Kysely is the close call.
- **`01m03xa8ys` — hosting and origin.** Permanent origin, plus the Tailscale
  push test.

Still blocked: `01m03xaamk` ingest (stack), `01m042kp8g` backup (stack + hosting).

Unresolved and cheap to settle once a keyset exists: the real listings-per-day
number, and whether `itemStartDate` keys off `itemCreationDate` or
`itemOriginDate`.

## Links

- Commits: `orchestrator` branch — `01m03xa9gz`, `01m042kp8g`, glossary
  `01m041423p`
- PR: none
