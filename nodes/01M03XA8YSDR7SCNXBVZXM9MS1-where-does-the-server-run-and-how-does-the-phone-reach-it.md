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
  claimed: interview-session
---
## The question

Where does the server run, how does the phone reach it over HTTPS, and what
keeps it alive?

The owner has fixed self-hosting on hardware they already own — a home server or
a Mac, not a cloud VPS. That constrains everything else here, and iOS Web Push
adds requirements that a casual home setup does not meet by default.

## What to decide

- **The machine.** Which box, specifically. If it is a Mac that sleeps, that is
  a problem to solve, not a detail — a sleeping machine misses scan windows and
  drops push delivery.
- **HTTPS ingress.** Cloudflare Tunnel, Tailscale Funnel, a reverse proxy on a
  port-forward with Let's Encrypt, or something else. Web Push requires HTTPS,
  and it must be a real certificate, not self-signed.
- **Origin stability.** The push research will have established how tightly
  subscriptions bind to their origin. Whatever it found, choose an ingress whose
  hostname the owner is willing to keep forever, because changing it may
  invalidate every subscription and require re-installing the PWA.
- **Reachability.** Whether the app is reachable from cellular and other
  networks, or only from home. A Tailscale-only origin means the phone must be
  on the tailnet for the PWA to load — decide whether that is acceptable, and
  note that push delivery itself comes from Apple, not the server, so
  notifications may arrive even when the app cannot load.
- **Always-on and supervision.** launchd, Docker with a restart policy, pm2, or
  a systemd unit. What happens after a power cut or an OS update.
- **Scheduling.** How the periodic eBay scan is triggered — an in-process timer,
  a system cron, or a scheduler in the app — and how the "last scanned" cursor
  survives a restart mid-scan.
- **Backups.** Where the SQLite file is backed up to, and how often. The
  collection data is irreplaceable.
- **Secrets.** Where eBay credentials and VAPID keys live on the machine.

## Why it matters

This is the most likely place for the whole thing to quietly stop working: a
laptop lid closes, a tunnel token expires, an OS update reboots the box, and
notifications silently stop with nothing to alert the owner.

## How to resolve

Grill it out with the owner — only they know what hardware is available and how
it behaves. Bring the push research's origin-stability finding to the
conversation, since it may eliminate options.

Resolve into: the machine, the ingress with its hostname strategy, the
supervision mechanism, the scan trigger, and the backup target.
