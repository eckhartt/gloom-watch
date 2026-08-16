---
id: 01M04JE8WAQAS23RVW7JTYD669
type: decision
title: The price ceiling is dropped from the push rule
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XAA33X9BVPKF8BP747MZV
    type: supersedes
---
## Resolution

**The price ceiling is removed from the push rule. Priority is the sole instant-push
trigger; every other unowned match goes to the digest. Instant pushes are also listed
in the following digest.**

This supersedes the trigger and batching sections of *What earns a push notification*
(`01m03xaa33`). **Everything else in that ticket stands** — Declarative Web Push as
transport, no quiet hours, both dedupe layers including the salted seller hash, the
content shape and character targets, the platform constraints, the badge's honest
limitation, scanner failure detection, and unmatched listings never pushing.

## The new rule

A listing pushes when **all** hold:

1. it matched with sufficient confidence (unmatched never pushes)
2. the variant — or the card, per the partial-match ruling — is **not owned**
3. it is **not** a lot, proxy or custom art

Then:

- **variant clears the priority bar** → **instant push**
- **otherwise** → **next digest**
- **an instant push is also listed in the next digest**

## Why the ceiling was dropped

**It could not do the job it was there for.** Its purpose was to let a listing notify
even when the owner had never prioritised that variant — "you didn't flag this one, but
it's cheap."

But **an absolute number cannot distinguish a bargain from a rip-off.** That requires
comparing against market value, which is ruled out of scope (`01m03xaxxs`). Across the
Oddish line a common Gloom is a couple of dollars and a 1st Edition Vileplume is
several hundred; **no single number is meaningful for both.** What the ceiling actually
implemented was an impulse-buy threshold, not a deal detector, and it was never
described as one.

**It also created a contradiction the map never resolved.** The scanner covers US, GB,
DE and AU — four currencies — while the rule compared against one ceiling and the
worked example rendered `$42 AUD`, with an FX API explicitly out of scope. Removing the
ceiling **dissolves that contradiction entirely** rather than solving it: no conversion
is needed anywhere, and notifications show each listing's native price and currency.

**The volume argument that motivated it does not survive scrutiny.** The ceiling
existed to keep the digest small. But **a digest summarises rather than enumerates** —
"89 variants you need today, from $3" is one notification whether it covers nine
listings or nine hundred. The digest is a doorbell, not an inventory. Filtering it by
price was also mildly at odds with the domain: in a masterset, everything unowned is
wanted by definition.

## Why instants are repeated in the digest

**iOS stores exactly one undelivered push per bundle ID** — confirmed against Apple's
documentation, which adds that the survivor is "in most cases" but **explicitly not
guaranteed** to be the latest.

The digest was designed around this. Instant pushes were exempt from that mitigation,
which meant the pushes the owner most cares about were the ones most exposed: two rare
cards appearing during one tunnel journey collapse to a single surviving notification.

Listing instants in the following digest costs **no new mechanism and no extra push** —
the digest was being sent anyway. An overwritten instant resurfaces within ~12 hours
instead of vanishing silently.

## Tap targets off-tailnet — accepted limitation

**A notification tap cannot resolve while the phone is off the tailnet.** The
`navigate` target must be same-origin and inside the manifest scope, and the origin is
tailnet-only. Commissioning step 8 deliberately proves pushes *arrive* in that state;
the tap then fails.

**Accepted as inherent.** The only fix is a publicly reachable origin, which forfeits
the tailnet-as-perimeter model the hosting decision rests on and reopens the auth
question.

**Compensation, and it is a requirement rather than polish: the notification must carry
enough to make the go/no-go decision without opening anything** — card, set, language,
finish, price with currency, condition, and listing format. The tap becomes a
convenience rather than the payoff. This tightens the content budget, which remains
~35 characters of title and ~100 of body against a ~3.5 KB payload ceiling.

## What is now a tunable, and what is not

The **priority bar** is the only remaining dial on the push rule, and priority is
already a field on the variant. There is no price threshold to tune, in any currency.

If the digest proves too noisy against real volume, a price floor on **digest
inclusion** is a cheap later addition — made with measured numbers rather than guessed
ones.

## Alternatives weighed and rejected

- **Per-marketplace ceilings in native currency** — four numbers instead of one,
  no conversion, contradiction dissolved. Rejected because it preserved a mechanism
  that could not tell a deal from a rip-off regardless of how many numbers it had.
- **A hand-entered rate table** — would have restored a single AUD ceiling and AUD
  notification bodies. Rejected with the ceiling itself.
- **Scanning US only in v1** — one currency, one ceiling, and Japanese cards reach the
  US marketplace anyway. Rejected as a real coverage loss to solve a problem that
  disappeared.
- **Accepting instant-push loss** — simplest, and high-priority collisions are rare.
  Rejected because the repeat costs nothing.
- **Coalescing undelivered instants into a rolling summary** — would guarantee no loss,
  but needs delivery state the platform cannot supply (Apple returns 201 for dead
  subscriptions).
- **An offline fallback screen for taps** — better than a failed load, but needs the
  payload persisted client-side at push time, which the declarative path makes awkward.
- **Public ingress so taps always work** — forfeits tailnet-only hosting and reopens
  auth.
