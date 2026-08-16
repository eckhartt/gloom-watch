---
id: 01M04PMC04HN86FCJBYA2XW8D0
type: feature
title: eBay client and forward scanner
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
---
## What to build

Listings arriving from eBay on their own, every ten minutes, with nothing of eBay's stored
that should not be.

OAuth **client credentials** — no refresh token, no browser round trip, which is what makes
an unattended box possible. Re-mint on 401 rather than on a hard-coded expiry.

**Observed listings are stored as a field whitelist applied at the client boundary.** A raw
Browse summary contains `seller.username`; storing it would forfeit the account-deletion
opt-out and force a public HTTPS endpoint, killing tailnet-only hosting. The seller object
never reaches disk. The only derivative is an HMAC-SHA-256 seller hash for relist dedupe.

Cursors are **per-marketplace** — DE and AU run every fourth cycle, so a single global cursor
would lose most of their listings.

No matching in this ticket. Listings land, and the feed shows them.

## Acceptance criteria

- [ ] Client-credentials OAuth; token re-minted on 401
- [ ] Scanner runs as a `Bun.cron` OS-level job in its own process, with its own connection
- [ ] Field whitelist applied at the boundary; **a test asserts no persisted column anywhere holds a seller username**, against a fixture containing one
- [ ] Seller hash is HMAC-SHA-256 keyed by the configured salt, never displayed
- [ ] Per-marketplace cursors; a US-only cycle does not advance DE or AU
- [ ] A failed scan leaves its cursor and increments a failure count
- [ ] Paging follows through to exhaustion or the configured budget
- [ ] Daily call budget respected; 429 handled with backoff
- [ ] The seen-set records every item id and is never purged
- [ ] Listing records expire at 90 days, whole rows, not just a payload column
- [ ] Feed shows listings with "seen at" and an outbound link; **prices are hidden past six hours and the age is disclosed**
- [ ] **Demo: leave it running, come back, see real Gloom listings in the feed**
