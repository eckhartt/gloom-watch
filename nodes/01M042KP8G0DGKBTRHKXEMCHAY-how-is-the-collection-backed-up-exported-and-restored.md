---
id: 01M042KP8G0DGKBTRHKXEMCHAY
type: decision
title: How is the collection backed up, exported and restored?
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
meta:
  ticket: grilling
  hitl: yes
---
## Resolution

**Everything lives in one SQLite file, and one job backs it up.**

## What is backed up

**The whole database, including all image BLOBs** — corpus images and owner
photographs alike. See the superseding decision on image storage; there is no
filesystem side to keep in sync.

**Blanket coverage was chosen deliberately over excluding the re-derivable
corpus images.** The original plan excluded them to save ~21 MB. That was
optimising the wrong thing: if TCGdex disappears, changes its URL scheme, or the
licensing grey area ever forces the issue, **the backup becomes the only copy of
those images**. 21 MB is not worth that exposure.

## Mechanism

**`VACUUM INTO`.** `bun:sqlite` has no `backup()` — only `.serialize()`, which
materialises the entire database in memory. `VACUUM INTO` is the correct online
primitive for a live WAL database, is safe against concurrent readers, and
produces a defragmented copy. Verified working (118 KB in 1 ms on a small file).

At ~125 MB the operation is closer to a second than a millisecond, which matters
for the write-triggered path below.

## Cadence and retention

- **Daily**, scheduled via `Bun.cron`.
- **Plus a debounced snapshot after any collection write** — adding a copy,
  confirming a match, adding a manual variant. **The debounce must be real** (a
  minutes-scale window, not per-keystroke), because a snapshot is no longer free
  once image blobs are inside the file.
- **Retention: 90 days**, deliberately matching the listing retention window, so
  **eBay payloads never persist in a backup longer than they persist live.** That
  keeps the "intermediate copies... deleted when no longer required" posture
  intact without needing a second backup job.

The write trigger exists because collection edits are the one thing here that
cannot be rebuilt. A daily-only schedule can lose an afternoon of cataloguing.

## Destination

**Encrypted, to cloud object storage *and* a local copy.**

- **Local** (second disk or NAS share) — fast routine restores, no egress.
- **Cloud** (B2, R2 or similar) — survives fire, theft and flood.

Content-defined dedup (restic or equivalent) keeps repeated 125 MB snapshots
cheap, because the overwhelming majority of blobs are unchanged between them.

## Key custody — the bootstrap trap

**An `age` keypair, with the private key held off the box**: password manager,
plus an offline copy.

The server holds **only the public key**, so it can write backups it cannot
itself read. That is the correct property for an append-only backup target
anyway, and it avoids the classic failure:

> the only copy of the decryption key lives on the machine that died, leaving a
> perfect encrypted backup that can never be opened.

The backup contains the **VAPID private key** and **eBay credentials**, so it is
genuinely sensitive.

## Export — CSV and JSON, archived forever

Generated and archived **with every backup**, and **kept indefinitely**.

This is what makes a 90-day snapshot retention safe. The snapshot expires; the
export does not. It contains **only the owner's data** — no eBay payloads — so
indefinite retention carries no licence tension.

Contents: one row per copy (card, set, number, language, variant, condition,
grader, grade, cert, price, currency, acquired, source, status, notes), plus
manual variants, aliases, match confirmations and priorities.

### The export must be re-importable

**Recorded as a requirement on the format, not a nice property.** If the only
artifact older than 90 days is a CSV that cannot be loaded back, it is
documentation, not a backup.

Restoring from export must be a supported path: rebuild the schema, re-ingest the
corpus from TCGdex, re-download corpus images, and reconstruct copies, manual
variants, aliases, confirmations and priorities from the export file.

It is also the answer to *"what if this app stops working in five years"* — and
the migration path to any other tracker.

## Verification — after every backup

An untested backup is a belief.

1. Open the snapshot **read-only**
2. `PRAGMA integrity_check`
3. Compare row counts against live — copies, variants, aliases, confirmations
4. Confirm image blob counts and total blob bytes
5. Record `verified_at` and the counts

**Surfaced in-app beside the scanner staleness banner**: *"backup verified 6h
ago, 312 copies"*.

This catches the failures that otherwise stay silent: a truncated snapshot, a
disk that filled up three weeks ago, or a backup that is valid SQLite but missing
data.

## What is irreplaceable, and what is not

**Irreplaceable — the reason this ticket exists:**

- every **copy** record, including the **home-currency snapshot whose historical
  rate cannot be recovered**
- **owner photographs** — for most pre-2021 Japanese variants, the only image
  that will ever exist
- **manually added variants** — Korean, Simplified Chinese, "The Best of XY" —
  with no upstream source
- **the alias table and match confirmations**, hand-curated over months. Losing
  them resets matcher accuracy to day one and re-floods the confirm queue with
  questions already answered
- **priority flags**
- **the VAPID keypair** — rotating it invalidates every push subscription

**Re-derivable:** corpus rows and corpus images (backed up anyway, per above) and
observed listings.

## Alternatives weighed and rejected

- **Two-tier backup** (short-retention full snapshot + long-retention
  collection-only export as separate jobs) — the same outcome is achieved by the
  archived export, without a second job.
- **Irreplaceable tables only** — smallest and cleanest on licensing, but a
  restore cannot produce a working app without re-ingesting first.
- **Indefinite snapshot retention** — archives eBay listing payloads years past
  their purpose.
- **Weekly or daily-only cadence** — risks losing collection edits, the one thing
  that cannot be rebuilt.
- **Another tailnet machine as the only destination** — no cost and no third
  party, but everything remains in one building.
- **Cloud only** — every restore is a download, including routine ones.
- **External USB drive** — immune to remote compromise, dependent on remembering
  to plug it in.
- **Passphrase-based symmetric encryption** — simpler, but the box then holds a
  secret that decrypts every backup it ever wrote.
- **Key file replicated to the local target only** — survives one machine dying,
  not the house.
- **Manual restore drills** — no code, but depends on remembering.
- **Integrity check without row comparison** — catches corruption, misses a
  backup that is valid SQLite and missing data.
