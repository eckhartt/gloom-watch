---
id: 01M04B901S99E5XSDB6D1AKEYW
type: decision
title: Images are stored as BLOBs in SQLite, not on the filesystem
status: ruled
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XAAMK96EN2TFBHEYGABXQ
    type: supersedes
---
## Resolution

**All images are stored as BLOBs in SQLite. There is no image directory on the
filesystem.**

This **supersedes the image-storage portion of `01m03xaamk`**, which ruled that
corpus images live on the filesystem beside the database with owner photographs
in a separate directory. **Everything else in that ticket still stands** — the
two-phase pull, local filtering, manual sync, the upsert rules, `stamp`
canonicalisation, `missing_upstream` flagging, clone-and-edit manual entry, and
the three-layer offline reading model are all unchanged.

## What changed

| | Was (`01m03xaamk`) | Now |
| --- | --- | --- |
| Corpus images | filesystem, `high.webp` | **SQLite BLOB** |
| Owner photos | separate filesystem directory | **SQLite BLOB** |
| Backup | database + photo directories | **one file** |

## Why

**One artifact, atomically consistent.** `VACUUM INTO` now covers the entire
application state. There is no database/filesystem consistency problem to get
wrong — no half-synced photo directory, no orphaned files, no restore that has to
reunite two stores. That class of bug was precisely what the backup verification
step existed to catch, and it no longer exists.

**Blobs of this size belong in SQLite.** SQLite's own benchmarking found blobs
under ~100 KB read *faster* from the database than from the filesystem.
`high.webp` corpus images average **59 KB** — squarely in that band.

**Not base64.** SQLite has a native `BLOB` type. Base64 would inflate storage by
33% and cost an encode/decode on every read, for no benefit.

## Owner photos are processed on upload

**This is what makes the decision viable, and is part of it.**

Photographs are **resized and recompressed to webp** (~1600px long edge) on
upload. A raw iPhone photo is 3–5 MB; three hundred of them would exceed a
gigabyte and every snapshot would copy it. At ~200 KB each, five hundred photos
is ~100 MB.

Full archival fidelity is not the goal — the point of an owner photo is
documenting *this* copy's centering, wear or slab, not preserving a master
image. Recompression also **strips EXIF**, which removes GPS coordinates from
photos taken at home.

## Resulting size

| | |
| --- | --- |
| corpus images | 361 × ~59 KB ≈ **21 MB** |
| owner photos | ~500 × ~200 KB ≈ **100 MB** |
| everything else | ~5 MB |
| **database total** | **~125 MB** |

## Consequences

- **`VACUUM INTO` is now ~1 second, not ~1 millisecond.** The write-triggered
  backup must use a real minutes-scale debounce rather than firing per edit.
- **Content-defined dedup does the heavy lifting** across repeated snapshots,
  since the overwhelming majority of blobs are unchanged between them.
- **Images are served by the application**, not as static files — a read plus an
  HTTP response. Immaterial at one user, and the service worker still caches them
  `CacheFirst` exactly as before.
- **A restore is a single file.** No second sync to reunite.

## Alternatives weighed and rejected

- **Owner photos in the database, corpus images on disk** — keeps snapshots
  smaller by leaving the re-derivable 21 MB out, at the cost of two stores and
  two consistency stories.
- **All images on disk, backed up alongside** (the original ruling) — smallest
  database and fastest snapshots, but the database and photo directory can drift
  out of sync.
- **Base64-encoded images** — 33% inflation and pointless encode/decode work when
  a native BLOB type exists.
- **Storing photo originals untouched** — full fidelity, gigabyte-scale backups,
  and it would have made database storage untenable.
