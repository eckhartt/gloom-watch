---
id: 01M04HM3VSFAHKSSBFFAJ18K66
type: doc
title: Adversarial reader review — Gloom Watch build-ready spec
status: filed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
---
Three fresh readers attacked the draft spec **Gloom Watch — build-ready spec**
(`01m04f83a5`), each with no prior context and its own lens.

| Reader | Lens | Verdict |
| --- | --- | --- |
| Readiness | Build it mentally; record every stop-or-guess | **NOT BUILD-READY** — 10 blockers |
| Contradictions | Cross-reference every rule; hunt untestable claims | **INCONSISTENT** — 17 blockers |
| Fact-check | Verify every external claim against primary sources | **Partial** — see coverage below |

The two internal readers converged independently on five defects. That agreement,
reached without shared context, is the strongest signal in this review.

## The finding that invalidates a frozen decision

**Bun 1.4 does not exist — in any channel.** Verified directly:

```
$ npm view bun dist-tags
{ latest: '1.3.14', canary: '1.3.13-canary.20260425.1' }
```

The published version list ends at 1.3.14 (13 May 2026). The `canary` tag points at
1.3.13-canary and is **behind** stable.

**This makes `01m03xa8cw` unexecutable as written.** It specifies "Bun 1.4 canary,
pinned to an exact build". No such build was ever published. The supporting evidence
in that ticket — the Zig-to-Rust rewrite and the Prisma OOM benchmark — could not be
reached in any primary source.

**The repair is clean and reduces risk.** `Bun.cron`'s OS-level form shipped in
**1.3.11**, the in-process form in **1.3.12** — both before 1.3.14 stable. Everything
the design depends on is in the published stable release. Targeting 1.3.14 *removes*
the "canary in production" accepted risk rather than adding one.

Requires a **new decision superseding `01m03xa8cw`**, since that node is frozen.

## Where the reviewers were wrong

Recorded so it is not rediscovered as a defect later.

**Both internal readers claimed `Bun.cron` is in-process only and cannot survive a
reboot.** They read one of its two call forms. It has two:

| Form | Survives process exit / reboot |
| --- | --- |
| `Bun.cron(schedule, handler)` | No |
| `await Bun.cron(path, schedule, title)` | **Yes** |

The three-argument form writes a real crontab entry on Linux (`launchd` plist on
macOS, Task Scheduler on Windows), and `Bun.cron.remove(title)` reverses it.
Re-registering the same title overwrites in place. **The supervision split in
`01m03xa8cw` and `01m03xa8ys` is correct and stands.**

Two consequences the spec must absorb anyway:

- The scanner **must be a separate module file** default-exporting
  `{ scheduled(controller) }` — it cannot be a closure inside the HTTP server.
- Because it is genuinely a separate process, **"one connection" is one connection
  *per process***. The rationale "JavaScript is single-threaded, so writes serialise
  for free" does not hold across processes; WAL plus `busy_timeout = 5000` is the
  real concurrency story, including the daily `VACUUM INTO` running against a live
  writer.

## Blockers, triaged

### Class A — synthesis errors in the spec, fixable from the frozen record

- The print-variant axis is named four ways (`finish`, `print variant`, `features`,
  `stamp`). The glossary (`01m041423p`) already settles it: **finish** and **stamp**
  are separate attributes.
- Card-versus-variant cardinality and where the image BLOB hangs. `01m03x9wy0`
  settles it: **one image per card record** (~475), against ~765 variants.
- The glossary is referenced by ticket ID rather than inlined, in a document required
  to be self-contained.
- Price-ceiling direction is recoverable from the frozen record — the rejected
  alternative "cheap duplicates would notify constantly" fixes it as an upper bound
  with listings *under* it qualifying.
- Cursor granularity follows from the cadence ruling: DE/AU run every fourth cycle,
  so a single global cursor provably loses most of their listings. **Cursors are
  per-marketplace.**

### Class B — engineering consequences, derivable without an owner ruling

- Manual rows need a **synthetic `card_id` in a reserved namespace**. A Korean clone
  inherits its source's `card_id` *and* its `variantId` hash, colliding on the
  declared upsert key — the mechanism the whole manual-curation story rests on.
- The **`itemId` seen-set must outlive the 90-day payload purge** (hash-only), or
  relists re-notify silently at day 91.
- **Backup retention arithmetic is wrong.** A payload ingested at t=0 is deleted live
  at t=90, but a snapshot taken at t=89 retains it to t=179. Matching the two windows
  gives roughly double, not equal — and that property is the stated justification for
  the number.
- **`VACUUM INTO` cannot capture the secrets file**, which lives outside the database.
  A restore that silently omits the VAPID private key destroys every subscription.
- Six-hour display freshness needs a stated mechanism: suppress prices past the
  window, show "seen at", link out.
- Schema, HTTP surface, timezone and money conventions, outbox idempotency, badge
  reset semantics, relist-guard tolerances and salt custody, subscription lifecycle
  storage, binder ordering, the exclusion list's own persistence, pagination and
  retry policy — all absent and all decidable by an engineer.
- **Every tunable is homeless and defaultless**, and there is no configuration
  mechanism or settings surface anywhere, though the frozen notification ticket
  requires the owner to configure digest times.

### Class C — genuine gaps; nobody ever decided these

These change product behaviour and are **not** for the spec to invent.

1. **What the matcher outputs when a title fixes a card but not a variant.**
   `Gloom Jungle 44/64` leaves four variants live. Determines queue volume, push
   volume, and whether have-it/need-it is trustworthy.
2. **One price ceiling against four marketplace currencies**, with an FX API ruled
   out of scope and the notification example rendering `$42 AUD`.
3. **Whether owner photographs get more than 90 days.** Called the irreplaceable
   asset; absent from the indefinitely-kept export; exist only inside snapshots that
   expire.
4. **Whether a notification tap must work off-tailnet.** Commissioning step 8
   deliberately proves pushes arrive with Tailscale off; the tap then cannot resolve,
   and minimal notification content is justified *on the assumption the tap delivers
   the detail*.
5. **Whether `missing_upstream` variants sit in the completion denominator.** If they
   do, an upstream deletion permanently caps completion below 100% — the exact
   "permanently incompletable" failure the TCG Pocket exclusion exists to prevent.
6. **Whether high-priority instant pushes accept the APNs one-message loss** the
   digest exists to solve. They are the pushes the owner most cares about and are
   exempt from the mitigation. Never acknowledged.
7. **What "browses fully offline" promises.** All three offline layers cover the
   shell and images; collection data comes from the HTTP cache and filtering is a
   server query, so the warmed grid has nothing to render into once a filter changes.

Also unresolved, and flagged by both readers: **the silent-push rule has no detection
mechanism.** The echo log observes the send side only; the failure happens on-device
and is invisible server-side; the checklist runs once, before the failure can occur.
The spec presents two mechanisms and has none.

And: **completion has no oracle.** "765" has no stated source, and a membership
regression that drops rows makes the percentage *higher* with every test still green.

## Fact-check coverage

**Group A — iOS Web Push / WebKit: COMPLETE. Claims hold.** Verified against WebKit
source at HEAD, MDN browser-compat-data, Apple's documentation and RFCs 8030/8291/8292.

Confirmed in source: `maxSilentPushCount = 3`; `silentPushTimeoutForProduction { 30_s }`;
Web Inspector suspending enforcement; Declarative Web Push's exemption (an explicit
branch that skips the potential-silent-push queue); no `actions` key in
`NotificationJSONParser.cpp`; `pushsubscriptionchange` `version_added: false` on
`safari_ios`; `icon` and `tag` settable-but-inert; the 4096/3993-octet ceiling quoted
from RFC 8291 §4; VAPID self-generation and rotation semantics from RFC 8292; WebKit
bug 268797 real, filed 2024-02-05, still NEW.

Three corrections:

- **The silent-push counter is not unresettable.** It never decays and success never
  credits it, but a full unsubscribe/re-subscribe inserts a fresh row at zero. The
  spec's "no reset path anywhere in WebKit's source" is too strong.
- **The mechanism is worse than the loose reading.** Each push independently arms a
  30-second timer; failures accumulate on a counter that never decays; three failures
  weeks apart revoke every subscription for the origin.
- **New build requirement:** the manifest must carry a non-default `display` value or
  the `Notification` constructor throws `ReferenceError`. Absent from the spec.

Two refinements: APNs stores one notification **per bundle ID**, and the survivor is
"in most cases" but explicitly *not guaranteed* to be the latest — which strengthens
the digest-over-queue argument beyond what the spec claims. And `Notification.silent`
is `false` on iOS, with several instance properties unreadable — nothing should read
properties back off a `Notification` on iOS.

**Groups B and C — NOT VERIFIED.** The session's WebSearch budget was exhausted
(200/200) before these ran. Every eBay claim (decommissioning date, quota,
`buyingOptions` default, category 183454, the three terms-of-use clauses, condition
descriptor 27503, the NM/LP/MP/HP/DMG mapping) and every TCGdex claim (MIT licence,
`variants_detailed`, no updated-since query, absent Korean/Simplified Chinese records)
**remains unchecked**. They are carried as assumptions, not as verified facts, and
must be checked before the spec is filed.

The eBay condition-vocabulary claim is the one to check first: the spec asserts the
ladder maps to eBay's with "no translation layer", and a schema enum depends on it.

## What held

Recorded so a later round does not re-litigate it.

- **Per-object defects excluded everywhere** — four independent statements, no drift.
- **TCG Pocket exclusion** consistent across five places.
- **`(card_id, variantId)` never `variantId` alone** — holds everywhere except the
  manual-clone case above.
- **Priority on the variant, not the copy**, with no want-list.
- **The seller-username chain reconciles.** The ban, the salted-hash narrowing for the
  relist guard, and the cross-cutting rule are three consistent statements, and the
  hash's ≤90-day life comfortably covers the ~30-day guard window.
- **`status = 'owned'` filtering** stated, repeated, motivated and given a test.
- **Manual rows never touched, never renumbered, counting toward completion.**
- **`missing_upstream` flagged and never deleted**, with a behavioural test.
- **`stamp` canonicalisation** appears as an ingest rule and in two test seams.
- **The commissioning checklist has exactly 8 steps**, matching its cross-reference,
  with the outbound-only claim correctly labelled inference and given the one test
  that could falsify it.
- **Notification examples respect their own budgets** — titles 22 and 16 characters
  against ≤~35; bodies 25 and 45 against ≤~100.
- **Lots and proxies** consistent across stories, the matching section and the tests.
- **Every Out of Scope entry traces to a decision** with a reason and, where relevant,
  a revisit condition. No orphans.
- **The stack table leaves no layer requiring a choice** — every row names a version
  or a mode, and each guardrail carries its reason.
- **The testing section is the most implementation-ready part of the document**, with
  three of four seams given explicit signatures and Vitest chosen over `bun test` for
  a specific named reason.
