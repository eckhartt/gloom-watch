---
id: 01M04B91R3RYWJT0804F9M3HDP
type: decision
title: Offline writes use an outbox queue, not a phone database
status: ruled
parent: 01M03X4D6HQESBXXDYYRVBVRDR
---
## Resolution

**Offline writes queue in an outbox and replay on reconnect. There is no database
on the phone and no sync engine.**

This resolves what was the last substantive fog patch on the map: *what happens
to a write made with no connection.*

## The mechanism

```
OFFLINE
  tap "I own this"
    -> mutation appended to an outbox in IndexedDB
    -> UI updates optimistically
    -> pending count surfaced in the app

RECONNECT
  -> replay in order, one request each
  -> reconcile against server responses
  -> clear the outbox
```

TanStack Query — already chosen in `01m03xa8cw` — provides offline mutation
persistence, so this is a small build rather than a subsystem.

## Why this is proportionate

**The offline window is narrow by construction.** The origin is tailnet-only, so
the app cannot load remotely without Tailscale up. The realistic offline case is
a cached shell opening while the tunnel is briefly unreachable — a train, a lift,
a dead spot. It is a tunnel, not a lifestyle.

**One user, one device.** There is no second writer to conflict with, so
last-write-wins on a row is sufficient and no merge logic is required.

## The structural fact that made the alternatives tempting

**The phone and the server write disjoint tables:**

| Written by the server | Written by the phone |
| --- | --- |
| corpus, variants, sets | copies |
| observed listings | match confirmations |
| match results | aliases, priorities |

Because ownership is disjoint, a genuine local-first design would **not** have
needed conflict resolution either — which is what made "SQLite on the phone"
worth taking seriously rather than dismissing.

It was still rejected: a sync protocol is a permanent obligation, every Drizzle
migration would have to run on the phone in step with the server, and iOS storage
quota and OPFS behaviour under an installed PWA would need verifying first. For a
corpus of ~765 rows that fits comfortably in a JSON response, that is a great
deal of machinery for very little.

## What still comes from the network

Reads. The service worker precaches the app shell and caches images `CacheFirst`,
with an explicit bulk warm available — all per `01m03xaamk`. Collection *data*
reads come from the HTTP cache, not from a local database.

## Alternatives weighed and rejected

- **Local mirror + outbox ("local-first lite")** — sync a read-only copy of
  corpus and collection metadata (~5 MB, no blobs) so browsing is instant and
  fully offline, with an outbox for writes. No merge logic needed thanks to
  disjoint ownership. Rejected as a real sync protocol to build, version and keep
  in step with every schema migration.
- **Full SQLite WASM over OPFS with bidirectional sync** — a genuinely
  local-first app. Rejected: a sync engine is a permanent obligation, migrations
  must run in two places, and iOS storage quotas and OPFS behaviour would need
  verifying before committing. *(Encouraging note from `01m03x9y1f`: installed
  PWAs are exempt from ITP's 7-day eviction, and push-subscribed origins are
  exempt from time-based eviction — so persistence is better than feared if this
  is ever revisited.)*
- **Refusing writes when offline** — zero complexity and no queued-write risk,
  but you could not catalogue a card on a plane.

## If this is revisited

The upgrade path is additive: the outbox stays, and a read-only local mirror is
layered underneath it. Nothing here forecloses local-first later.
