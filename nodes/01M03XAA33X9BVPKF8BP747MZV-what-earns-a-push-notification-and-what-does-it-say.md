---
id: 01M03XAA33X9BVPKF8BP747MZV
type: decision
title: What earns a push notification, and what does it say?
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
meta:
  ticket: grilling
  hitl: yes
  claimed: interview-session
---
## The question

What earns a push notification, and what does it say?

iOS Web Push to a PWA has no silent delivery and a limited tolerance for
notifications the user ignores. Every push is a visible interruption, so the
policy has to be deliberately stingy.

## What to decide

- **The trigger.** Every new Oddish-line listing? Only listings matching a card
  not in the collection? Only above a match-confidence threshold? Only under a
  price ceiling? Combinations.
- **Instant vs digest.** One notification per listing as it is found, or a
  batched digest per scan or per day. A masterset search can return dozens of
  listings in a burst, and dozens of individual pushes would get notifications
  turned off within a week.
- **Deduplication.** Relisted and repeatedly-renewed items are the same card
  appearing "new" again. Decide what makes a listing already-seen — item ID,
  seller plus title, or something fuzzier — and for how long.
- **Quiet hours.** Whether pushes are suppressed overnight and delivered later,
  or simply dropped.
- **Content.** What the notification body says — card name, set, price,
  condition, whether it is a needed card. Whether a card image is attached, if
  the push research found that iOS supports it.
- **The tap target.** Where tapping lands: a listing detail view in the PWA, the
  card's page, a feed, or straight out to eBay. Deep-linking has to be designed,
  not assumed.
- **Failure visibility.** How the owner finds out the scanner has stopped
  running. Silence is indistinguishable from "no new listings", which is the
  failure mode this whole feature is most exposed to.
- **Unmatched listings.** Whether a listing the matcher could not place is worth
  a notification at all.

## Why it matters

The notification is the product. Everything else is a database with a web page
on it. Too noisy and the owner disables notifications and the app dies; too
quiet and they miss the card.

## How to resolve

Grill it out with the owner. Anchor it in real numbers from the eBay research:
how many Oddish-line listings actually appear per day. The right policy for
three a day and for eighty a day are different policies.

Resolve into: the trigger rule, the batching rule, the dedupe rule, the
notification content, the tap destination, and the scanner-health story.
