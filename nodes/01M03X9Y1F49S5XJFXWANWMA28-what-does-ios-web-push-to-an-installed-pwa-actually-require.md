---
id: 01M03X9Y1F49S5XJFXWANWMA28
type: decision
title: What does iOS Web Push to an installed PWA actually require?
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA8YSDR7SCNXBVZXM9MS1
    type: blocks
  - to: 01M03XAA33X9BVPKF8BP747MZV
    type: blocks
  - to: 01M03XA8CW3DB9JC43TCTEPR8X
    type: relates
meta:
  ticket: research
  hitl: no
---
## Resolution

**The feature is viable, free, and needs no Apple developer account** — confirmed
from four first-party sources. It is fragile in three specific ways, and one of
them dictates the hosting decision.

## 1. Origin coupling is total — this is the constraint that propagates

Four pieces of state are **all** keyed to `scheme://host:port`, and all four die
together:

- the Home Screen icon (an iOS web clip storing a URL)
- the service worker registration
- the notification permission grant
- the push subscription

Change the hostname, the tunnel provider, the port, or the tailnet name and
every one of them dies at once. **WebKit has no PWA origin-migration mechanism** —
`migrate_from` is a Chromium incubation with no WebKit standards position. A 301
from old to new does not help: the app runs on the new origin with entirely
fresh state.

Recovery is: delete the icon, re-add it, re-grant permission, re-subscribe by
tap.

**Therefore: choose the origin once, before the first install, and treat it as
permanent.** A hostname fully controlled (custom domain, Let's Encrypt via
DNS-01 — which needs no inbound reachability) is materially more durable than any
provider-issued name, because it survives changing the box, the ISP, the tunnel
provider and the VPN mesh. `*.ts.net`, `*.trycloudflare.com` and ngrok
subdomains weld the feature to that provider forever.

Also never change the **service worker's scope URL** — the subscription is keyed
to the scope, not merely the origin. Register at `/` and leave it.

## 2. A Tailscale-only origin does deliver pushes — traffic is outbound-only

There are **two independent reachability requirements**, and conflating them is
the classic error:

| Requirement | Direction | When it matters |
| --- | --- | --- |
| Origin reachability | iPhone → server, HTTPS | Install, open, register SW, `subscribe()`, **and whenever the user taps a notification** |
| Push delivery | server → `web.push.apple.com` (**outbound 443**); Apple → phone via APNs | Send time only |

The app server is always the HTTP *client*. For a home server behind residential
NAT the send-side requirement is **outbound TCP 443 to `*.push.apple.com`** — no
port forwarding, no static IP, no dynamic DNS. The payload is encrypted
end-to-end (RFC 8291) and carries its own content, so the service worker never
needs to call home to display a notification.

Tailscale specifics: Serve (not Funnel) gives a real Let's Encrypt cert and keeps
it tailnet-only. `.ts.net` names land in **public Certificate Transparency logs**
— the machine name becomes public, the service stays private. One open
unresolved bug: `tailscale#19147`, iPhone cannot establish a secure connection to
Serve `*.ts.net` HTTPS endpoints (opened 2026-03-27, no root cause, no
workaround).

⚠️ **The last-hop claim is inference**, from protocol plus documented iOS
split-tunnel behaviour, not from an authoritative statement or a first-hand
report. **The hosting decision must include the five-minute empirical test:
Tailscale off on the phone, send a push, see whether the banner appears.** Do not
design around it before running it.

## 3. Silent push is impossible, and failing to show a notification is a permanent kill

Confirmed from WebKit source at HEAD, not from docs:

```cpp
constexpr unsigned maxSilentPushCount = 3;                    // WebPushDaemonConstants.h
static constexpr Seconds silentPushTimeoutForProduction { 30_s };  // NotificationData.h
```

Three findings not present in any documentation:

1. **"Timely manner" = 30 seconds.**
2. **The counter never resets.** `incrementSilentPushCount` only increments —
   there is no decrement or reset path anywhere in `PushDatabase.cpp`. Successful
   notifications earn no credit back. **Three scattered failures across a year
   kill it.**
3. Revocation removes **all** subscriptions for the origin.

Two things make this treacherous:

- **It cannot be reproduced under a debugger** — WebKit suspends silent-push
  enforcement for service workers attached to Web Inspector. The most dangerous
  production bug is invisible in dev by design.
- A service worker that `fetch()`es the origin *before* calling
  `showNotification()` accumulates strikes whenever the origin is unreachable —
  which, on a home server behind a VPN, is often.

**Mitigations, both mandatory:** put the full notification content in the
encrypted payload and call `showNotification()` unconditionally inside
`event.waitUntil()`; and use **Declarative Web Push** (iOS 18.4+), which is
explicitly exempt from the silent-push penalty. That exemption is the single
strongest reliability decision available on this platform.

## 4. Subscriptions silently die and you cannot detect it client-side

- **`pushsubscriptionchange` is not implemented on iOS Safari** (MDN BCD:
  `version_added: false`). When iOS revokes, the page gets no event.
- WebKit Bug 273063 — subscriptions becoming invalid — filed 2024-04-22, still
  NEW.
- Apple's endpoint has been reported returning **`201` for dead subscriptions
  rather than `410`**, unlike Google/Microsoft/Mozilla. Handle 410/404 when they
  arrive, but **absence of 410 is not evidence the subscription is alive.**
- `Notification.permission` is unreliable (WebKit Bug 320551, filed 2026-07-29,
  100% reproducible): OS-level-off is indistinguishable from never-asked. **Use
  the server as source of truth.**

**Consequence:** ship a permanent, gesture-gated "re-enable notifications"
button. On iOS `subscribe()` needs a user tap **even when permission is already
granted**, so silent re-subscription on launch is impossible.

## 5. What this forces on notification design

- **Every server→phone message must be user-visible.** Push cannot be used for
  background sync.
- **APNs stores only ONE message per app while the device is offline.** An Apple
  engineer confirmed it: a queued push is overwritten by the next. If the phone
  is offline for an hour and five listings appear, **at most one notification
  survives**. Send *summaries* that point into the app, or reconcile server-side
  on open — never assume a backlog drains. A positive `TTL` is mandatory.
- **No images.** The card image cannot appear in the notification.
- **No action buttons.** `event.action` is always `""`. (The Declarative Web Push
  explainer and WWDC25 session 235 both imply `actions` works — **contradicted by
  the shipping source**; `NotificationJSONParser.cpp` has no `actions` key.)
- **`tag` does not coalesce on iOS.** N pushes with the same tag = N tray
  entries. The `Topic` header coalesces *undelivered queued* messages only.
- **`icon` is ignored** — iOS always shows the manifest icon. Invest in it; it is
  the only icon available.
- **Payload ceiling 4096 bytes on the encrypted body**; ~3993 usable plaintext
  per RFC 8291. Budget under ~3.5 KB.
- **Deep-linking via `notificationclick` is broken** — WebKit Bug 268797, open
  since Feb 2024, last confirmed failing 2026-08-12. Use Declarative Web Push's
  `navigate` field, which bypasses the click event entirely. Target must be
  same-origin and inside the manifest `scope`.
- **App badge works** (16.4+), is callable from a worker context, and Declarative
  Web Push exposes `app_badge` with no JavaScript at all.

## 6. Onboarding is not optional polish

- **Home Screen installation is still required on iOS — Safari tabs never get the
  Push API.** Unchanged through iOS 26.6.
- **iOS 26 added a new failure mode:** every added site opens as a web app *by
  default*, but the user can toggle "Open as Web App" off, producing a plain
  bookmark with **no Push API**. Detect at runtime with
  `matchMedia('(display-mode: standalone)').matches && 'PushManager' in window`.
- **A user gesture is mandatory**, and `subscribe()` throws `NotAllowedError`
  without one (`requestPermission()` merely resolves without prompting).
- **Denial is effectively permanent.** There is no reliable Settings-based
  recovery; flipping the toggle does not restore the web-visible state. The
  documented fix is delete icon → clear Safari website data → re-add. **A
  soft-ask before the real prompt is therefore mandatory, not polish** — there is
  exactly one chance.

## 7. VAPID

Self-generated P-256 keypair; **nothing is registered with Apple**. The public key
is stored on the subscription permanently. **Rotation destroys every existing
subscription** and, on iOS, costs a user tap to recover. Generate once, back it
up, never rotate unless compromised — treat it at the same criticality as the
origin hostname. JWT `sub` must be a `mailto:` or full `https://` URL; don't
refresh the JWT more than hourly.

## 8. Development loop

Requires a real HTTPS origin the phone can reach and a **physical iPhone** — the
Simulator has no viable path (Add to Home Screen is unreliable there, and
`simctl push` addresses a bundle ID a web app does not have).

Safari Web Inspector **does** support installed Home Screen web apps (Develop
menu → device → "Home Screen Web Apps"). But seeing `push` events is racy, and
Web Inspector suspends silent-push enforcement — so **build a server-side echo
log as the real fallback**.

Avoid cloudflared *quick* tunnels and ngrok free for anything installed: quick
tunnels generate a new random URL per restart, which orphans the PWA and its
subscription every single time.

## Explicitly not verified

Carried forward so the hosting and notification decisions do not treat these as
settled:

- That an iOS web app receives a push while its origin is unreachable — **the
  Tailscale test above.**
- Whether a denied-but-never-granted web app gets a Settings entry. **Design as
  if it does not.**
- Whether `notificationclick` (Bug 268797) is fixed on iOS 26.x — contradictory
  reports.
- Whether Safari enforces same-origin on declarative `navigate`.
- The `Urgency` → `apns-priority` mapping (undocumented by Apple).
- Subscription survival across iOS upgrades and across delete-and-reinstall.

Full findings with citations: see the child research node.
