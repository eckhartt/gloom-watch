---
id: 01M03XA8YSDR7SCNXBVZXM9MS1
type: decision
title: Where does the server run, and how does the phone reach it?
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M042KP8G0DGKBTRHKXEMCHAY
    type: blocks
meta:
  ticket: grilling
  hitl: yes
---
## Resolution

**An always-on Linux box, served at `<host>.<tailnet>.ts.net` via Tailscale
Serve.**

| | |
| --- | --- |
| **Machine** | Always-on Linux (NAS, mini PC, Pi or repurposed laptop) |
| **Ingress** | **Tailscale Serve** — managed Let's Encrypt cert, no inbound ports |
| **Origin** | `<host>.<tailnet>.ts.net`, on the existing tailnet name |
| **Reachability** | Tailnet-only. Phone keeps Tailscale connected |
| **Scanner** | `Bun.cron` OS-level job — survives reboots unaided |
| **Web server** | Separate process, `systemd Restart=always` |
| **Secrets** | Root-owned `0600` env file, included in backups |

**Serve, never Funnel.** Funnel would publish the app to the public internet,
which is not needed and would force the auth question that is still map fog.

Linux was chosen over a Mac for the simplest reason: **a Mac sleeps, and a
sleeping machine misses scan windows silently** — no error, no signal, just a gap.
Linux also avoids Apple's system SQLite 3.43.2, which restores `jsonb` and
ordered aggregates should the schema ever want them.

## Supervision splits in two

`Bun.cron` makes this natural, and the split is a feature rather than an
accident:

- **Scanner** — `Bun.cron(path, schedule, title)` registers a real **OS cron
  entry**. It survives process restarts *and* reboots with no supervisor, and
  reads `last_scanned_at` from SQLite on each run so a restart computes what it
  missed instead of double-scanning or silently skipping.
- **HTTP server** — a long-lived process under `systemd Restart=always` with
  `RestartSec=10`. Needed for the PWA to load and for notification taps to land.

**They fail independently, which is the point.** A dead web server does not stop
notifications arriving, because push delivery never touches this box's inbound
path.

## Why tailnet-only works

There are two separate reachability requirements, and conflating them is the
classic error:

| | Direction | Needed for |
| --- | --- | --- |
| **Origin reachability** | iPhone → this box, over HTTPS | install, open the app, register the SW, `subscribe()`, **and tapping a notification** |
| **Push delivery** | this box → `web.push.apple.com` (**outbound 443**), then Apple → phone | send time only |

The app server is always the HTTP *client* at send time, and the payload is
encrypted end-to-end, so the service worker never needs to reach this box to
display a notification. A residential-NAT home server therefore needs only
**outbound 443 to `*.push.apple.com`** — no port forwarding, no static IP, no
dynamic DNS.

**Consequence accepted:** with Tailscale off on the phone, notifications still
arrive but cannot be acted on until it reconnects. Tailscale iOS is a split
tunnel and stays connected at modest battery cost.

## eBay compliance and hosting fit together

Because `01m03xa7ty` ruled that **`seller.username` is never persisted**, the
account-deletion notification requirement can be satisfied by **opting out**
rather than subscribing — and subscribing would have required a **publicly
reachable HTTPS endpoint**, which would have killed tailnet-only hosting outright.

That earlier ruling is what makes this one possible. Worth stating explicitly so
nobody later "improves" the app by storing seller names.

## Secrets

Root-owned `0600` env file, read at startup, **included in the backup**
(encrypted):

```
VAPID_PUBLIC_KEY      ships to the client
VAPID_PRIVATE_KEY     avoid rotating
EBAY_CLIENT_ID
EBAY_CLIENT_SECRET
```

Rotating VAPID returns `400 VapidPkHashMismatch` and invalidates every existing
subscription; recovery needs a user tap on iOS. At one user that is a minor
annoyance rather than a disaster — avoid it casually, but it is not sacred.

eBay credentials are re-issuable from the developer portal and matter far less.

## On origin permanence — correctly sized

Four things bind to the origin (`scheme://host:port`) and die together if it
changes: the Home Screen icon, the service worker registration, the notification
permission, and the push subscription. WebKit has no origin-migration mechanism
and a 301 does not help.

**But this is a single-user app, and the PWA is a thin client over server-side
SQLite.** Changing origin costs: re-add the icon, re-grant permission, tap
subscribe. **No collection data is touched** — copies, photographs, aliases,
manual variants and priorities all live in the database and are entirely
unaffected.

So origin permanence is a **minor operational annoyance, not a constraint that
should drive the hosting choice.** An earlier framing in this map treated it as
near-catastrophic; that calibration is correct for a multi-user product and wrong
here, and it is corrected on the record.

This is also why the "buy a domain so the origin is portable" argument was
declined: it was buying insurance against a two-minute inconvenience.

## Accepted risk: tailscale#19147

Open since 2026-03-27, no root cause and no workaround — *"iPhone cannot
establish secure connection to Tailscale Serve `*.ts.net` HTTPS endpoints"*,
failing in both Safari and Chrome while the same endpoints validate server-side.
One unresolved report, not a general breakage.

**Accepted deliberately.** If it bites, the response is to switch ingress — a
named Cloudflare Tunnel on an owned domain, or Caddy with a DNS-01 cert on the
tailnet interface — and reinstall the PWA. Given the sizing above, that is a
cheap recovery, not a disaster.

Cheap check worth doing anyway: load the site on the iPhone over HTTPS once
before the first Add to Home Screen, since that is exactly where this bug
surfaces.

## Commissioning checklist

Carried from `01m03x9y1f`, and step 8 is the one that matters:

1. Tailscale Serve running, cert issued
2. iPhone loads the site over HTTPS
3. Add to Home Screen — confirm **"Open as Web App" is ON** (iOS 26 lets users
   turn this off, producing a plain bookmark with **no Push API**)
4. Verify `display-mode: standalone` and `'PushManager' in window`
5. Permission granted from a user gesture
6. `subscribe()` succeeds, endpoint stored server-side
7. Test push received
8. **Tailscale OFF on the phone, send another push, confirm the banner arrives**

Step 8 validates the outbound-only claim, which is well-reasoned inference from
protocol behaviour and documented iOS split-tunnel behaviour, **not a confirmed
fact** — no first-hand report was found of an iOS Home Screen web app receiving a
push while its origin was unreachable. Unlike the origin question, getting this
wrong would change the design.

## Alternatives weighed and rejected

- **A Mac, kept awake** — usable with `pmset`/`caffeinate` and a lid-close
  override, but sleep failures are silent, and that is this project's worst
  failure mode.
- **Own domain + DNS-01 cert pointed at the tailnet IP** — makes the origin
  portable and repointable to a public tunnel later without the PWA noticing.
  Rejected once origin changes were correctly sized as trivial.
- **Named Cloudflare Tunnel on an owned domain** — works from cellular with no
  VPN, but publicly reachable, so it would force the auth question now.
- **Quick Cloudflare tunnels** — generate a new random URL every restart,
  orphaning the PWA and its subscription each time. Never usable for an installed
  app.
- **ngrok free** — serves an HTML interstitial whose documented bypass is a
  request header, which cannot be set on a top-level navigation or the browser's
  service-worker script fetch. Breaks install and SW registration.
- **Port-forward + HTTP-01** — self-owned end to end, but opens a port, needs
  dynamic DNS, and carries the exposure directly.
- **Tailscale Funnel** — public, unnecessary, and forces auth.
- **One process for scanner and server** — simpler, but forfeits the
  reboot-survival that made `Bun.cron` worth choosing.
- **Docker with a restart policy** — reproducible, but adds a container layer to
  a single-user app and complicates `Bun.cron`'s OS-level registration.
