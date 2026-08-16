---
id: 01M042KP8G0DGKBTRHKXEMCHAY
type: decision
title: How is the collection backed up, exported and restored?
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
meta:
  ticket: grilling
  hitl: yes
---
## The question

How is the irreplaceable half of this system backed up, exported and restored?

This was fog on the map until the collection model resolved. It is specifiable
now because we know exactly what is irreplaceable and what is not.

## What is at stake

**Re-derivable, and therefore cheap to lose:**

- the card corpus — a fresh TCGdex pull rebuilds it
- corpus images — re-downloadable, ~20 MB as webp
- observed eBay listings — and eBay's licence only permits keeping them as
  *"intermediate copies... deleted when no longer required"* anyway

**Irreplaceable, and gone forever if lost:**

- every **copy** record — condition, grader, grade, cert number, price paid,
  currency, the **home-currency snapshot whose historical rate cannot be
  recovered**, acquisition date, source, notes
- **owner photographs** of individual cards, which for most pre-2021 Japanese
  variants are the only image that will ever exist
- **manually added variants** — Korean, Simplified Chinese, "The Best of XY" —
  which have no upstream source at all
- **priority flags** on variants
- **the matcher alias table and the owner's match confirmations** — hand-curated
  over months of using the confirm queue, with no upstream source. Losing them
  does not just lose data: it resets the matcher's accuracy to day one and
  re-floods the queue with questions already answered once.

## What to decide

- **What is actually backed up.** The whole SQLite file, or only the
  irreplaceable tables? A full-file backup is simpler and self-consistent; a
  selective one is far smaller and sidesteps the eBay retention clause entirely.
- **The mechanism.** `VACUUM INTO` is the correct online primitive for a live WAL
  database and yields a defragmented copy — but confirm it against whichever
  SQLite driver the stack decision picked, since `better-sqlite3` also offers a
  real incremental `backup()`.
- **Photographs.** They are blobs, not rows. Decide whether they live in the
  database (and so ride along in any DB backup) or on the filesystem (and so need
  their own sync). This choice is the difference between one backup job and two.
- **Where backups go.** Another disk on the same machine is not a backup. An
  off-machine or off-site target is the point — and the hosting decision
  determines what the box can reach.
- **Cadence and retention.** How often, how many kept, and whether a backup runs
  after a write or on a schedule.
- **Export in an open format.** Whether the owner can get their collection out as
  CSV or JSON without the app — insurance against the project being abandoned,
  and the only real answer to "what if this thing stops working in five years".
- **Restore, actually tested.** An untested backup is a belief, not a backup.
  Decide what proves a restore works and how often that is exercised.
- **Secrets.** The **VAPID keypair must be backed up and never rotated** —
  rotating it destroys every push subscription and costs a user tap to recover.
  eBay credentials are re-issuable and matter less.

## Why it matters

Every other failure on this map is recoverable by re-running something. This one
is not. A lost `copies` table means re-photographing and re-typing a collection
from memory, including purchase prices that were only ever recorded here.

## How to resolve

Largely a technical decision the agent can drive, but the cadence, the off-site
target and whether open-format export is in v1 are the owner's calls. Bring a
concrete proposal rather than a menu.

Resolve into: what is backed up, by what mechanism, to where, how often, how it
is restored, and how the restore is proven.
