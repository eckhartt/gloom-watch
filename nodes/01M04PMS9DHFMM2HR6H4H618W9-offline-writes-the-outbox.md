---
id: 01M04PMS9DHFMM2HR6H4H618W9
type: feature
title: Offline writes — the outbox
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
---
## What to build

Cataloguing a card with no connection, and having it land exactly once when you reconnect.

The offline window is narrow by construction — the origin is tailnet-only, so the realistic
case is the cached shell opening while the tunnel is briefly unreachable. But marking a card
owned in that state has to go somewhere.

**Writes queue in an outbox in IndexedDB and replay in order on reconnect.** There is no
database on the phone and no sync engine. TanStack Query supplies offline mutation
persistence, so this is a small build rather than a subsystem.

**Replay is idempotent because client-generated UUIDs are the primary keys** — a create whose
response was lost replays into the same row, not a duplicate. One user, one device, so
last-write-wins is sufficient and no merge logic is needed.

Photo uploads are **not** outbox-eligible: they are multi-megabyte and are held with an
explicit pending state instead.

## Acceptance criteria

- [ ] Copy create, update and dispose, priority changes, match confirmations and alias creation all queue while offline
- [ ] UI updates optimistically
- [ ] Pending count surfaced in the app
- [ ] Replay happens in order on reconnect
- [ ] **Replaying the same client-generated id twice yields one row** — verified by test
- [ ] A failed replay does not silently drop the mutation
- [ ] Photo uploads are excluded and held with a visible pending state
- [ ] **Demo: mark a card owned in aeroplane mode, reconnect, watch it land once**
