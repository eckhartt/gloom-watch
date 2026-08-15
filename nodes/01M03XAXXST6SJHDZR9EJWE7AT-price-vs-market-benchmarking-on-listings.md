---
id: 01M03XAXXST6SJHDZR9EJWE7AT
type: decision
title: Price-vs-market benchmarking on listings
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
---
## The question, as it was asked

Should each eBay listing show how its price compares to market — a
TCGplayer/Cardmarket benchmark or eBay sold comps — so the owner can tell a deal
from a rip-off at a glance?

## Ruled out of scope

The owner dropped this from v1 when scoping the map. It sits past the
destination.

The reasoning, recorded so it does not have to be rediscovered:

- It drags in a **second data source**, and probably a paid one. The free card
  corpus APIs are strong on card metadata and weak on pricing; the sources that
  are strong on pricing are commercial.
- It needs a **price history store**, not just a current number. "Compared to
  market" is meaningless without knowing whether market moved.
- It needs a **currency model**. An Oddish-line masterset is full of Japanese
  cards listed in yen, and a benchmark in dollars is not a comparison.
- eBay's sold-comps data is behind the **Marketplace Insights API**, which has
  restricted access — it is not simply available to a personal developer
  account.

None of that is needed for the loop the owner actually asked for: a new listing
appeared, here it is, do I already have it.

## If it comes back

This does not graduate back into this map. It would be a fresh effort, and it
would want its own data-source decision, a pricing schema, and a policy for how
stale a benchmark may be before it is worse than no benchmark at all.
