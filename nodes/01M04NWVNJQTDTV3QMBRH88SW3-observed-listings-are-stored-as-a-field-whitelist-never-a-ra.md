---
id: 01M04NWVNJQTDTV3QMBRH88SW3
type: decision
title: Observed listings are stored as a field whitelist, never a raw payload
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA9GZ6ZRV3CBTF2F460EN
    type: relates
---
## Resolution

**Observed listings are stored as a field whitelist, never as a raw eBay payload. The
seller block is never written to disk in readable form.**

This resolves a contradiction introduced when the spec first described a stored `payload`,
and it protects the ruling in `01m03xa7ty` that makes tailnet-only hosting possible.

## The contradiction

Three statements could not all hold:

1. *"Raw listing payloads are retained 90 days… so an improved matcher can be re-run over
   retained listings and compared."* (`01m03xa9gz`)
2. *"`seller.username` is never persisted in readable form."* (`01m03xa7ty`)
3. A test asserting *"no code path writes a readable seller username."*

**A raw Browse `ItemSummary` contains `seller.username`.** Storing it verbatim for ninety
days is persisting eBay user data in readable form — the largest such copy in the whole
design — and the test written to forbid it would pass only by declining to look at the
column.

The stakes are not abstract. Persisting eBay user data removes the option to **opt out** of
eBay's marketplace account-deletion notifications, forcing a **subscription**, which
requires a **publicly reachable HTTPS endpoint** — which would kill tailnet-only hosting
outright.

## What is stored

A **whitelist**, applied at ingest, before anything touches disk:

```
item_id, marketplace, title, price + currency, buying option,
condition id (graded/ungraded only), item web url,
item location country, item origin date, observed at,
result-set aspects returned with the summary
```

Plus the derived `seller_hash` — salted, one-way, never displayed, used solely as a relist
dedupe key.

**Everything else eBay returns is discarded at the boundary**, including the entire seller
object. The scrub happens on receipt, not on write: no code path downstream of the eBay
client ever holds a full payload.

## Why matcher re-runs survive this

**The matcher only ever reads the title and a little metadata.** Its declared inputs are
the title, listing metadata, the corpus and the alias table — it has never had any use for
the seller block, the shipping options, the returns policy or the image URLs.

So a whitelist that keeps everything the matcher reads preserves the entire value of the
90-day retention: an improved matcher can still be re-run over real historical listings and
compared against the previous version's results. **Nothing that made `matcher_version`
worth recording is lost.**

## Consequences

- The stored listing is **already the whitelist** — there is no separate "raw" column, and
  no scrubbing step to forget on some future code path.
- **Listing rows need their own retention rule**, not just a payload purge: the whitelist
  *is* eBay content, so the row itself is deleted at 90 days. Only `seen_items` (an opaque
  identifier and a timestamp), the variant link, confirmations, aliases and notification
  history survive.
- The `seller_hash` expires with its listing row, as originally intended.
- The guarantee is now **testable for real**: assert that no persisted column of any table
  contains a seller username, against a fixture payload that includes one.

## Alternatives weighed and rejected

- **Drop raw retention entirely**, keeping only parsed fields and the match result —
  safest on compliance and simplest. Rejected because it forfeits re-running an improved
  matcher over real listings, which is the only reason `matcher_version` exists.
- **Keep full payloads and drop the seller ban** — would require subscribing to
  account-deletion notifications, hence a public HTTPS endpoint, forfeiting tailnet-only
  hosting and reopening the auth question the map deliberately closed.
- **Store raw payloads and scrub on read** — the data would still be on disk, so the ban
  would still be violated and a backup would still carry it.
