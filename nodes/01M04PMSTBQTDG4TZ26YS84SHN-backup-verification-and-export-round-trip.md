---
id: 01M04PMSTBQTDG4TZ26YS84SHN
type: feature
title: Backup, verification and export round-trip
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
---
## What to build

The safety net, and the artifact that outlives the application.

Everything lives in one SQLite file, so one job backs it up. **`VACUUM INTO`** is the
mechanism — `bun:sqlite` has no incremental backup API, only whole-database serialisation
into memory, which at ~125 MB is not viable.

**Expire eBay content before snapshotting.** Otherwise a payload ingested at day zero, purged
live at day 90, still lives in a snapshot until day 179 — the backup silently doubles its
life and the intermediate-copies posture becomes nominal rather than real.

**Stated plainly: the box can read its own backups.** An automated backup needs its
credentials on the box, and the write-only property is not achievable alongside automated
deduplication. The repository password is also kept off-box in a password manager — that is
disaster recovery, not access control.

**`VACUUM INTO` cannot capture the environment file**, so the backup job archives it
alongside. A restore that silently omits the VAPID private key destroys every subscription.

The **export** is what survives past ninety days, and it must carry **hand-added cards**, not
just hand-added variants — otherwise a restored Korean printing points at a card that cannot
exist.

## Acceptance criteria

- [ ] Daily snapshot via `Bun.cron`, plus a snapshot debounced minutes after a collection write
- [ ] eBay content expired **before** snapshotting
- [ ] Environment file archived alongside the snapshot
- [ ] restic to a local target and cloud object storage, with deduplication working across snapshots
- [ ] Append-only or object-lock enabled at the remote where supported
- [ ] Verification after every backup: integrity check, row counts against live, blob counts and bytes, timestamp recorded
- [ ] **Remote verified too**, not just the local plaintext snapshot
- [ ] Verification result surfaced in-app beside the staleness banner
- [ ] Export written as CSV and JSON with every backup, kept **outside** the 90-day repository with no expiry
- [ ] Export contains copies, hand-added **cards and variants**, aliases, exclusions, confirmations and priorities; rows join on identity, not display strings
- [ ] **An import route exists and round-trips**: export, rebuild an empty schema, re-import, assert the collection matches
- [ ] Restore drill: restic restore to a scratch location, database opens, counts match
- [ ] **Demo: restore yesterday's backup into a scratch database and prove it matches**
