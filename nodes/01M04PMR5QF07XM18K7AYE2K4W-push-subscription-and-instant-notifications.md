---
id: 01M04PMR5QF07XM18K7AYE2K4W
type: feature
title: Push transport and subscription
status: done
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
  - to: 01M04VPX16J7DTGA1QE2EX7VFB
    type: blocks
bindings:
  branch: feat/push-transport
meta:
  ticket: build
---
## What to build

The phone can receive a push at all — proved end to end, before anything has an opinion about
*which* cards deserve one.

**Declarative Web Push** is the transport, with a classic service-worker handler for iOS
16.4–18.3. The subscription records which it supports; the server sends one shape, never both.
Declarative is **exempt from the silent-push penalty**, which is the strongest reliability
decision available on this platform.

**The silent-push rule is load-bearing and cannot be tested in development.** The worker calls
`showNotification()` **unconditionally, from the encrypted payload, inside `waitUntil()` — never
after a fetch to the origin.** Each push arms its own 30-second timer; failures accumulate on a
counter that never decays; the third revokes **every subscription for the origin**.

## Acceptance criteria

- [x] VAPID keypair generated once, stored in the environment file, never rotated casually
- [x] Soft-ask precedes the system prompt; permission requested only from a user gesture
- [x] Standalone display mode **and** Push API presence both checked at runtime
- [x] Subscription records its transport; server sends the matching shape only
- [x] **Worker calls `showNotification()` unconditionally from the payload, inside `waitUntil()`, never after a fetch** — enforced by review and by a test on the handler's shape
- [x] Payload under ~3.5 KB; positive TTL; `navigate` target same-origin and inside manifest scope
- [x] Permanent, gesture-gated re-enable button
- [x] Server-side echo log records every push, its size and the endpoint response
- [x] A scheduled job that sends a push loads the environment file explicitly
- [x] **Demo: trigger a test push from the server by hand; the phone buzzes and the tap opens the app**

## Commissioning record — 2026-08-16

Deployed to `htpc` and proved against the owner's iPhone at the live origin
`https://htpc.tail594f35.ts.net`.

**The subscription came back `declarative`**, which settles the one thing the build could not:
the transport probe had never run on a real iOS 18.4+ device. It ran, and it was right. That
also means this device is **exempt from the three-strike penalty**, so the classic handler —
whose shape is guarded at source, at behaviour and in the minified bundle — is the fallback
rather than the live path.

```
subscription  transport=declarative  endpoint=web.push.apple.com
payload       {"web_push":8030,"notification":{…,"navigate":"https://htpc.tail594f35.ts.net/"}}
bytes         175   (budget 3500)
result        status=201 accepted=true retired=false
```

Banner arrived on the handset. Tapping it opened the app at the tailnet origin. Encrypted on
the box, through Apple, rendered by WebKit, tap resolved back — the whole path.

## The bug commissioning found

Running the sender with a **cron-shaped environment** (`env -i`) refused: `GLOOM_WATCH_ORIGIN`
was absent, so the tap target resolved to loopback.

The environment-file loader was correct and general but called **one layer too deep** — only
from `loadVapidConfig`, which runs *after* configuration is read. A scheduled job got its VAPID
secrets and nothing else, and the secrets were the half everyone was watching. A nightly digest
would have failed every night, or buzzed the phone and opened nothing.

Fixed in `f42d66d`: `loadConfig` stays pure, `loadDeploymentConfig` wraps it for processes
systemd did not start, and all five entry points cron or a shell can reach use it. Three tests
pin it, including that a one-off command-line override still wins.

## Departure from the spec, applied on the box

**`/etc/gloom-watch/gloom-watch.env` is `root:gloom 0640`, not `root:root 0600`.**

The spec asks for two things that cannot both hold: the file is root-only, *and* a scheduled job
loads it explicitly because cron does not inherit systemd's `EnvironmentFile`. Those jobs run as
`gloom`. `0640` with group `gloom` is the smallest change that satisfies both; systemd still
reads it as root before dropping privileges, so the only new reader is the same account running
the same application. Verified on the box: `gloom` can read it, `nobody` cannot.

## Commissioning checklist step 8 — confirmed, and it was the one that mattered

**Tailscale off on the phone, push sent, banner arrived.** `201 accepted`, subscription not
retired, notification displayed on a handset with no route to the origin.

The spec carried this as *"well-reasoned inference from protocol behaviour, not a confirmed
fact"* — no first-hand report could be found of an iOS Home Screen web app receiving a push
while its origin was unreachable — and noted that, unlike the origin-permanence question,
**getting it wrong would change the design**.

It is now first-hand fact on this hardware. Push delivery is genuinely outbound-only: the box is
the HTTP client at send time, the payload is encrypted end to end, and the service worker never
needs to reach the box to display a notification. Tailnet-only hosting stands — no port forward,
no public endpoint, and the authentication question stays closed.

The tap does not resolve while Tailscale is off, which is expected and is exactly why the spec
requires notification content to carry enough to decide without opening anything.
