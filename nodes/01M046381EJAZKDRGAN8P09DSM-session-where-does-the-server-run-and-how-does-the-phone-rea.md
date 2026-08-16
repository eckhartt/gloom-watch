---
id: 01M046381EJAZKDRGAN8P09DSM
type: session
title: "session: Where does the server run, and how does the phone reach it?"
status: closed
parent: 01M03XA8YSDR7SCNXBVZXM9MS1
---
# Session close-out

Interview session resolving `01m03xa8ys` — hosting and origin. Two rounds plus a
recalibration prompted by the owner. ACKed, frozen.

## What changed

- **`01m03xa8ys` is `ruled`.**
- **`01m042kp8g` (backup) is unblocked** — the last blocking edge cleared.
- **A framing error in this map was corrected on the record** (see below).

## The decision

**Always-on Linux box**, served at `<host>.<tailnet>.ts.net` via **Tailscale
Serve** (never Funnel), managed Let's Encrypt cert, no inbound ports.

**Supervision splits in two:** `Bun.cron` registers a real OS cron entry for the
scanner, which survives reboots unaided and reads `last_scanned_at` to compute
what it missed. The HTTP server runs separately under `systemd Restart=always`.
They fail independently — a dead web server does not stop notifications arriving.

Linux over Mac because **a sleeping Mac misses scan windows silently**, which is
this project's worst failure mode. Secrets in a root-owned `0600` env file,
included in backups.

## The correction — origin permanence was over-weighted

Earlier sessions treated the permanence of the origin as near-catastrophic:
hostname, port, scheme and service-worker scope all bind the icon, the SW
registration, the permission grant and the push subscription, and WebKit has no
migration path.

**The owner pointed out this is a single-user app and the PWA is a thin client
over server-side SQLite.** Changing origin costs: re-add the icon, re-grant
permission, tap subscribe. **No collection data is touched** — copies,
photographs, aliases, manual variants and priorities all live in the database.

So origin permanence is a **minor operational annoyance, not a design
constraint.** That calibration is right for a multi-user product and wrong here.
It is corrected in the ticket body. Consequences:

- `.ts.net` is a better fit than earlier framing suggested.
- The "buy a domain so the origin is portable" argument was insurance against a
  two-minute inconvenience, and was declined.
- **`tailscale#19147` (open, no root cause: iPhone cannot establish a secure
  connection to Serve `*.ts.net`) is accepted.** If it bites, switch ingress and
  reinstall — cheap recovery.

**Do not re-inflate this risk in later sessions.** The facts in `01m03x9y1f`
about origin binding remain accurate; only the *consequence weighting* was wrong.

## Why tailnet-only works

Two distinct reachability requirements, and conflating them is the classic error:

- **Origin reachability** (iPhone → box, HTTPS) — install, open, register SW,
  `subscribe()`, and **tapping a notification**.
- **Push delivery** (box → `web.push.apple.com`, **outbound 443**; Apple → phone)
  — send time only.

The box needs only outbound 443. No port forwarding, no static IP, no dynamic
DNS. With Tailscale off on the phone, notifications still arrive but cannot be
acted on until it reconnects.

**`01m03xa7ty` is what made this possible:** ruling out storing
`seller.username` allows *opting out* of eBay's account-deletion notifications.
Subscribing would have required a publicly reachable HTTPS endpoint and killed
tailnet-only hosting. **Nobody should later "improve" the app by storing seller
names.**

## Commissioning checklist — step 8 matters

1. Serve running, cert issued
2. iPhone loads the site over HTTPS (where #19147 would surface)
3. Add to Home Screen — **confirm "Open as Web App" is ON**; iOS 26 lets users
   turn it off, producing a bookmark with **no Push API**
4. Verify `display-mode: standalone` and `'PushManager' in window`
5. Permission granted from a user gesture
6. `subscribe()` succeeds, endpoint stored server-side
7. Test push received
8. **Tailscale OFF on the phone, send another push, confirm the banner arrives**

Step 8 validates the outbound-only claim, which is **inference, not confirmed
fact** — no first-hand report was found of an iOS Home Screen web app receiving a
push while its origin was unreachable. Unlike the origin question, getting this
wrong would change the design.

## Open questions

**Every HITL-gating decision on this map is now resolved.** Frontier is two, both
largely technical:

- **`01m03xaamk` — corpus ingest and images.** Carries: canonicalise `stamp`
  (`1st-edition` vs `1st edition`, 18 vs 16 occurrences — missing it silently
  halves the 1st Edition corpus); key on `(card_id, variantId)`; filter TCG
  Pocket set-ID prefixes; **manual rows must survive re-import**; Japanese images
  only 28% covered so owner photos fill the gap; no `updated-since` query so
  freshness means diffing a full pull or watching the git log.
- **`01m042kp8g` — backup, export and restore.** Newly unblocked. Irreplaceable:
  copies, photographs, manual variants, priorities, **the alias table and match
  confirmations**. Note **`bun:sqlite` has no `backup()`** — use `VACUUM INTO`
  (verified, 118 KB in 1 ms). Off-machine target required.

**Once those two are ruled, the map is done and `ork-spec` can synthesize.**

## Still fog

PWA shape; how the phone authenticates to the server (now much narrower — the
tailnet is the perimeter); offline behaviour; marketplaces beyond eBay.

## Links

- Commits: `orchestrator` branch — `01m03xa8ys`
- PR: none
