---
id: 01M04BCAM9CD59GMR02VGT83MA
type: session
title: "session: How is the collection backed up, exported and restored?"
status: closed
parent: 01M042KP8G0DGKBTRHKXEMCHAY
---
# Session close-out

Interview session resolving `01m042kp8g` — backup, export and restore. Two rounds
plus two owner-initiated design changes. **Every decision ticket on this map is
now ruled.** One prototype ticket was graduated from fog.

## What changed

- **`01m042kp8g` is `ruled`** — backup, export, restore.
- **Created `01m04b901s`** — "Images are stored as BLOBs in SQLite", with a
  **`supersedes` edge to `01m03xaamk`**, whose image-storage portion is now
  overridden. Everything else in that ticket still stands.
- **Created `01m04b91r3`** — "Offline writes use an outbox queue", clearing the
  offline-writes fog.
- **Created `01m04bb8bb`** — "What are the PWA's screens?", a `ticket=prototype`
  graduated from fog now that variant granularity and the collection model are
  settled. **This is the only item on the frontier.**
- **Updated the glossary** `01m041423p` with **Outbox**.
- **Narrowed the auth fog patch:** hosting is settled, so the tailnet is the
  perimeter and the honest answer may be "no application auth at all".

## Decisions made

### Backup

- **`VACUUM INTO`** — `bun:sqlite` has no `backup()`, and `.serialize()` would
  load the whole DB into memory.
- **Daily via `Bun.cron`, plus a debounced snapshot after collection writes.**
  The debounce must be minutes-scale, because a snapshot is ~1s once image blobs
  are in the file, not ~1ms.
- **90-day retention**, deliberately matching the listing window so eBay payloads
  never outlive their purpose in a backup.
- **Encrypted to cloud object storage plus a local copy**, with an **`age`
  keypair whose private key lives off the box**. The server holds only the public
  key and writes backups it cannot read — avoiding the trap where the decryption
  key dies with the machine.
- **CSV + JSON export archived every backup and kept forever.** This is what makes
  90-day snapshot retention safe: the snapshot expires, the export does not, and
  it contains no eBay data. **It must be re-importable** — an export you cannot
  load back is documentation, not a backup.
- **Verification after every backup:** read-only open, `integrity_check`, row and
  blob counts compared against live, result surfaced beside the scanner staleness
  banner.
- **Blanket coverage** — corpus images are backed up too. The original plan
  excluded them to save 21 MB; if TCGdex vanishes, the backup is the only copy.

### Images as BLOBs — owner-initiated, supersedes `01m03xaamk`

All images move into SQLite as **BLOBs, not base64** (native type; base64 costs
33% for nothing). Blobs under ~100 KB read *faster* from SQLite than from the
filesystem, and corpus images average 59 KB.

**Owner photos are resized and recompressed to webp (~1600px) on upload** — this
is what makes it viable. Raw iPhone photos would push the database past a
gigabyte. It also strips EXIF, removing GPS from photos taken at home.

Result: one ~125 MB artifact, atomically consistent. **The database/filesystem
consistency problem no longer exists** — which was a class of bug the backup
verification step existed to catch.

### Offline writes — outbox, not a phone database

Writes queue in IndexedDB and replay on reconnect, with optimistic UI. TanStack
Query already provides offline mutation persistence.

The owner asked about SQLite on the phone, and it was taken seriously: **the
phone and server write disjoint tables** (server owns corpus and listings; phone
owns copies, confirmations, aliases, priorities), so even full local-first would
need no conflict resolution. Rejected anyway — a sync protocol is a permanent
obligation, every migration would have to run in two places, and iOS OPFS
behaviour would need verifying. For ~765 rows that is a lot of machinery.

**The upgrade path is additive** if it is ever revisited: the outbox stays and a
read-only mirror layers underneath.

## Open questions

**Frontier is one, and it is a prototype ticket:**

- **`01m04bb8bb` — the PWA's screens.** `ticket=prototype`, `hitl=yes`. Build
  throwaway screens against real TCGdex data and react to them; do not build
  production components. The surfaces are already committed by earlier decisions:
  masterset browse (~765 rows, virtualised, filters in typed URL params), card
  detail, listing feed, confirm queue, lots view, collection entry, and health
  surfaces. The open questions are how completion is presented, browse-by-set vs
  browse-by-variant, and how much is v1.

**Whether this must be resolved before `ork-spec` runs is the owner's call.** A
spec can be written without pinned UI, with screens specified per build ticket —
but the v1 scope explicitly includes browsing, a confirm queue and a lots view,
and those are surfaces with no defined shape.

## Still fog

- **Phone→server auth** — narrow now; the tailnet is the perimeter and the
  answer may be "none".
- **Marketplaces beyond eBay** — weakened by the finding that Japanese cards
  reach `EBAY_US` anyway.

## Links

- Commits: `orchestrator` branch — `01m042kp8g`, `01m04b901s`, `01m04b91r3`,
  `01m04bb8bb`, glossary `01m041423p`, map `01m03x4d6h`
- PR: none
