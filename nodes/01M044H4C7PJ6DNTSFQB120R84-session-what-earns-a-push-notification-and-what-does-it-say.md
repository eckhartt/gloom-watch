---
id: 01M044H4C7PJ6DNTSFQB120R84
type: session
title: "session: What earns a push notification, and what does it say?"
status: closed
parent: 01M03XAA33X9BVPKF8BP747MZV
---
# Session close-out

Interview session resolving `01m03xaa33` — notification policy. Three rounds,
ACKed, frozen. One collision with an earlier ruling surfaced and resolved.

## What changed

- **`01m03xaa33` is `ruled`.** Trigger, batching, dedupe, content, badge,
  failure detection and rejected alternatives are in its body.
- **Updated the glossary** `01m041423p` with **Digest**.

## Decisions made

**Transport is Declarative Web Push (iOS 18.4+ floor)** — exempt from the
three-strike silent-push penalty, and it supplies `navigate` (bypassing the
`notificationclick` bug open since Feb 2024) and `app_badge` with no JavaScript.

- **Trigger:** matched + unowned + not a lot/proxy + clears a priority or price
  bar. The price ceiling is a tunable.
- **Hybrid batching:** high-priority pushes instantly; everything else in **two
  digests a day**. Structural, not stylistic — APNs stores exactly **one**
  message while offline, so instant bursts lose everything but the last.
- **No quiet hours.** A high-priority card can push at 3am. Accepted: a sniped
  auction is worse than a buzz.
- **Dedupe:** `itemId`, plus a ~30-day relist guard on seller + title + price.
- **Content** front-loads card identity; tap lands **in-app** because `navigate`
  must be same-origin and in manifest scope — deep-linking to eBay is impossible.
- **Badge** counts unseen qualifying listings.
- **Failure detection:** in-app staleness banner on every open, plus one push on
  gap recovery. A dead server cannot send its own funeral notice.
- **Unmatched listings never push** — they wait in the confirm queue.

## The collision, and how it resolved

The relist guard needs seller identity, but `01m03xa7ty` ruled `seller.username`
is never persisted — storing eBay user data forfeits the account-deletion opt-out
and forces a public HTTPS endpoint.

**Resolved with a salted hash used solely as an opaque dedupe key**: never
displayed, not readable, expires with the 90-day listing window. That is a
narrower use than the earlier ticket rejected, where the purpose was storing
seller identity as provenance to be read back. **The opt-out stands and
tailnet-only hosting remains viable.**

## Limitation recorded, not discovered late

**The app badge cannot update between pushes.** Silent push is impossible on iOS
and `app_badge` rides inside a notification payload, so the count refreshes only
when a notification is shown or when the app is opened. It is a **lagging
indicator**, useful as a passive signal that survives a dismissed notification,
but never live.

## Open questions

Frontier is two — both infrastructure, both `hitl=yes`:

- **`01m03xa8cw` — lock the stack.** Drizzle vs Kysely is the genuinely close
  call; `better-sqlite3` vs `node:sqlite` is the other. Everything else in the
  toolchain research is not close.
- **`01m03xa8ys` — hosting and origin.** Must settle a **permanent** origin
  (hostname, port, scheme and service-worker scope can never change after first
  install) and must include the **Tailscale push test**: turn Tailscale off on
  the phone, send a push, confirm the banner arrives. The outbound-only claim is
  well-reasoned inference, not confirmed fact.

Blocked behind those two: `01m03xaamk` ingest (stack), `01m042kp8g` backup
(stack + hosting).

**Once both infrastructure tickets are ruled, the map is decided and `ork-spec`
can synthesize.** Every product decision is now frozen.

## Still fog

PWA shape; how the phone authenticates to the server; offline behaviour;
marketplaces beyond eBay.

## Links

- Commits: `orchestrator` branch — `01m03xaa33`, glossary `01m041423p`
- PR: none
