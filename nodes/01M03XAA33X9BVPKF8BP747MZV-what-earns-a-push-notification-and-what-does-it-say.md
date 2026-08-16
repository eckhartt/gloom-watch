---
id: 01M03XAA33X9BVPKF8BP747MZV
type: decision
title: What earns a push notification, and what does it say?
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
meta:
  ticket: grilling
  hitl: yes
---
## Resolution

**Unowned variants above a priority or price bar. High priority pushes instantly;
everything else lands in two digests a day. No quiet hours.**

## Transport: Declarative Web Push

Not an implementation detail — it shapes the whole policy. iOS **18.4+** floor.

- **Exempt from the three-strike silent-push penalty**, which is the single
  strongest reliability decision available on this platform.
- Supplies **`navigate`**, bypassing `notificationclick` — broken on iOS since
  Feb 2024, last confirmed failing 2026-08-12.
- Supplies **`app_badge`** with no JavaScript.

A classic service-worker handler remains the fallback for iOS 16.4–18.3.

## Trigger

A listing pushes when **all** hold:

1. it matched a variant with sufficient confidence (unmatched never pushes)
2. the variant is **not owned**
3. it is **not** a lot, proxy or custom art
4. the variant clears the **priority** bar, **or** the price clears a ceiling

The funnel: ~1,000–3,000 listings/day → Oddish-line matched → minus lots and
proxies → minus variants already owned → minus below the bar → **a handful worth
interrupting for**. Without the owned-and-priority filter this is hundreds of
pushes a day, and notifications get switched off within a week.

**The price ceiling is a tunable**, like the match confidence threshold. The rule
is decided; the number is set once real data arrives.

## Batching — hybrid, and why the digest is structural

- **High-priority variant** → instant push, one card. Rare enough to be safe.
- **Everything else** → **two digests per day** (morning and evening, times
  configurable). A listing waits at most ~12 hours.

The digest is not merely politeness. **APNs stores exactly one message while the
device is offline** — confirmed by an Apple engineer: a queued push is
overwritten by the next.

```
phone offline 1 hour, 5 qualifying listings found
  instant-per-listing -> 1 arrives, 4 lost silently
  digest              -> 1 summary, all 5 inside it
```

A digest **summarises** rather than queues, so the one-message limit costs
nothing.

## No quiet hours

A high-priority card can push at any hour, including 3am. **Accepted
deliberately** — auctions end at inconvenient times and a sniped card is gone.
Digests are on a fixed schedule and are daytime by construction.

## Deduplication — two layers

1. **`itemId` seen before → never re-notify.**
2. **Relist guard, ~30 days:** same seller + near-identical title + similar price
   → suppress even under a new `itemId`.

eBay retains `itemOriginDate` across a relist but the `itemId` can change, so
without layer 2 an unsold card renewed weekly would buzz every week forever.

**Accepted risk:** a genuine second copy from the same seller gets suppressed.
Rare, and it still appears in the app.

### The seller-identity collision, and how it was resolved

Layer 2 needs seller identity, and `01m03xa7ty` ruled that eBay's
`seller.username` is never persisted — because storing eBay user data removes the
option to *opt out* of account-deletion notifications, forcing a public HTTPS
endpoint and killing a tailnet-only deployment.

**Resolved with a salted hash used solely as an opaque dedupe key.**

| | `01m03xa7ty` rejected hashing because | Here |
| --- | --- | --- |
| Purpose | know who you bought from | mechanical dedupe |
| Displayed | yes | **never** |
| Readable | yes | **no — salted, one-way** |
| Lifetime | forever | **90 days, with the listing** |

Different enough to justify a different answer. No eBay user data is readable
anywhere, the opt-out stands, and hosting stays unconstrained.

Rejected alternatives: dropping seller entirely (vintage listings use
near-identical boilerplate titles, so two sellers collide and the second is
silently lost) and storing the plaintext username (would need a new decision
superseding `01m03xa7ty`, and forfeits tailnet-only hosting).

## Content and tap target

```
INSTANT            title  Gloom – Jungle JA holo
                   body   $42 AUD – NM – auction 3d

DIGEST             title  7 cards you need
                   body   Gloom ×3, Vileplume ×2, Bellossom ×2 – from $8
```

Front-load the card identity: the Dynamic Island shows only the title and the
first few words. Target ≤~35 chars title, ≤~100 body. There are **no
Apple-documented character limits** — the HIG says not to pre-truncate — so these
are engineering targets, not rules.

**Platform constraints baked in, all confirmed against WebKit:**

- **No images.** The card image cannot appear in the notification.
- **No action buttons.** `event.action` is always `""`. The Declarative Web Push
  explainer and WWDC25 session 235 both imply otherwise; the shipping source
  contradicts them.
- **`tag` does not coalesce** — N pushes with one tag give N tray entries.
- **`icon` is ignored**; iOS always shows the manifest icon.
- Payload ≤4096 bytes encrypted (~3993 plaintext). Budget under ~3.5 KB.

**Tap lands in-app**, on the listing view. `navigate` must be **same-origin and
inside the manifest scope**, so deep-linking straight to eBay is impossible. The
in-app view carries the card image and the outbound eBay link.

## App badge — and its honest limitation

The badge counts **unseen qualifying listings**, set via Declarative Web Push's
`app_badge` with no JavaScript.

**Limitation, recorded so it is not discovered late: the badge cannot update
between pushes.** Silent push is impossible on iOS, and `app_badge` rides inside
a notification payload — so the count refreshes only when a notification is
shown, or when the app is opened and JavaScript sets it. Between the morning
digest and a 3pm find, the badge is stale.

It remains worth having as a passive signal that survives a missed or dismissed
notification, but it is a **lagging indicator, not a live one**.

## Scanner failure detection

**Silence is ambiguous** — "no notifications for three days" could mean no new
cards or a dead scanner, and this is the failure mode the whole feature is most
exposed to.

- **In-app staleness banner**: last successful scan time, shown on every app
  open, turning red past a threshold. No push required.
- **One push on gap recovery**: "scanner was down 6h, catching up".
- The badge gives a passive secondary signal.

A dead server cannot send its own funeral notice, so the primary check must live
where the owner will actually look. An **external watchdog** was considered and
rejected for v1 as another moving part to run — it is the only thing that
survives total server death, and remains the obvious upgrade if silence ever
bites.

## Unmatched listings never push

They wait in the confirm queue. Pushing one would convert a notification into
homework, since "might be a card you need, unsure" is not actionable.

**Named risk:** a rare Japanese card the parser cannot read is exactly the one
worth knowing about, and it will sit silently until the queue is opened.

## Inherited hard constraints honoured

- **Every server→phone message is user-visible.** Push cannot be used for
  background sync.
- **The service worker calls `showNotification()` unconditionally from the
  encrypted payload**, never after a `fetch()` to the origin. Three 30-second
  failures — a counter with **no reset path in WebKit's source** — revoke every
  subscription for the origin, and it cannot be reproduced under a debugger.
- **A positive `TTL` is mandatory** (`400 BadTtl` otherwise).

## Alternatives weighed and rejected

- **Instant per listing for everything** — bursts collapse to one surviving
  notification offline, and the volume gets notifications disabled.
- **Digest only** — most robust, but a rare card could be seen hours late.
- **Unowned with no further filter** — on a masterset you are mostly missing,
  still a very large number.
- **Every matched listing including owned** — market tracking, not a
  notification stream.
- **Price ceiling alone** — cheap duplicates would notify constantly.
- **`itemId`-only dedupe** — weekly relists buzz forever.
- **Quiet hours** — rejected; a sniped auction is worse than a 3am buzz.
- **Daily heartbeat digest even when empty** — unambiguous liveness proof, but
  trains the owner to ignore a notification that usually says nothing.
- **Verbose notification content** — truncates on the lock screen, and the
  useful part is what gets cut.
- **Pushing high-value unmatched listings** — pushes uncertainty.
