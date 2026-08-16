---
id: 01M04PPBYBNZGMAY4C7ABK9PQE
type: session
title: "session: Gloom Watch — build"
status: closed
parent: 01M04PFVGGXDDF82HM2NY6J000
---
## What changed

**The build queue exists.** Fifteen `feature` tickets in a new build group,
*Gloom Watch — build* (`01m04pfvgg`), a root sibling of the planning map. Every ticket
carries `ticket=build` and an `implements` edge to the filed spec
*Gloom Watch — build-ready spec (rev 3)* (`01m04p3sx9`), so `ork backlinks` on the spec
finds the whole build.

**One ticket is takeable:** *Walking skeleton — server, database and PWA shell on the phone*
(`01m04pm855`). Everything else waits on it directly or transitively.

## The shape of the queue

Two chains fan out from the skeleton and rejoin at the matcher:

- **Collection side** — corpus ingest → binder → copies and completion → then filters,
  photographs, hand-added variants and the outbox in parallel.
- **Hunt side** — eBay client and forward scanner, which needs only the skeleton and can
  proceed alongside the collection work.

They meet at *Matcher* (`01m04pmphb`), which needs both a corpus to match against and
listings to match. From there: confirm queue, backfill and push all unblock together.

Backup (`01m04pmstb`) is last, gated on hand-added variants, because it is the ticket that
must protect everything the owner authored.

## Decisions made, and why

**Split the matcher ticket in two.** As originally proposed it carried the parse, the grain
model, confidence, lots, proxies, the queue state model and aliases — too much for one cold
context window. It is now *Matcher* (`01m04pmphb`), which is pure and deterministic, and
*Confirm queue and aliases* (`01m04pmq2j`), which is stateful and owner-facing. The seam
between them is clean: the matcher returns a resolution, the queue decides what to do with
an uncertain one.

**No push spike, by the owner's explicit call.** I recommended inserting one right after the
skeleton, on the grounds that iOS Web Push carries every real unknown in the project —
whether a tailnet-only origin delivers pushes with Tailscale off (still inference, not
confirmed), whether Tailscale Serve loads on the iPhone at all (issue 19147 open), whether
the iOS 26 install toggle behaves. **The owner chose to proceed without it.** Recorded so a
later session does not re-litigate it, and so that if push fails at ticket 12 the cause is
already written down.

**The scanner side deliberately does not wait for the collection side.** Only the skeleton
gates *eBay client and forward scanner* (`01m04pmc04`), so listings can be arriving and
being inspected long before there is anything to match them against. That is intentional:
the eBay integration has the most external unknowns after push, and running it early
surfaces quota, keyset and category-ID problems while there is still time.

## Open questions

- **The keyset gate is not a ticket and needs owner action.** A production eBay keyset is not
  live until the owner subscribes to *or opts out of* marketplace account-deletion
  notifications. The design depends on **opting out** — that is what keeps hosting
  tailnet-only. Nobody has done this yet, and *eBay client and forward scanner* cannot be
  finished without it.
- **GB, DE and AU category IDs are unresolved.** Only US 183454 is confirmed. Resolve via the
  Taxonomy API during `01m04pmc04`.
- **Commissioning step 8** — Tailscale off on the phone, push sent, banner confirmed — lands
  inside *Push subscription and instant notifications* (`01m04pmr5q`). It validates an
  inference the whole hosting model rests on. If it fails, the origin has to become publicly
  reachable and the auth question reopens.
- **Confidence scoring, digest membership and the confirm-queue layout** are deliberately
  left to their tickets, per the spec's *Deliberately left to the build*.

## Links

- Build group: `01m04pfvgg`
- Spec: `01m04p3sx9` (filed)
- Planning map: `01m03x4d6h`
- Review: `01m04hm3vs`
- Frontier: `ork frontier 01M04PFVGG`
