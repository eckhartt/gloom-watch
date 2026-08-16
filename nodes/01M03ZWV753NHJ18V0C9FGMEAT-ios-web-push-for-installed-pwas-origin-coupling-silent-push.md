---
id: 01M03ZWV753NHJ18V0C9FGMEAT
type: research
title: "iOS Web Push for installed PWAs: origin coupling, silent-push penalty, presentation limits"
status: done
parent: 01M03X9Y1F49S5XJFXWANWMA28
---
*Research date: 2026-08-16. Current shipping versions: iOS/iPadOS 26.6, Safari 26.6 (2026-07-27); Safari 27 beta announced at WWDC26 (2026-06-08). **Verified: Safari 26.4 (2026-03-24), 26.5 (2026-05-11), 26.6, and the Safari 27 beta announcement contain zero changes to Web Push, the Notifications API, or Home Screen web apps.** The functional state of Web Push on iOS has been stable since iOS 18.4 (March 2025).*

---

## 1. Baseline requirements

**iOS version floor: 16.4** (March 2023). Apple's docs: *"Add web push to Home Screen web apps in iOS 16.4 or later and Webpages in Safari 16 for macOS 13 or later."* Note the asymmetry — on **macOS**, ordinary Safari *webpages* can receive push; on **iOS, only Home Screen web apps can**.

**Practical floor: iOS 18.4** (March 2025), if you want Declarative Web Push. Given a single known user on a modern iPhone, target 18.4+ and use the declarative path.

**Home Screen installation is still required on iOS. Safari tabs do not qualify — unchanged through iOS 26.6.** The Push API is simply not exposed in an iOS Safari tab.

**iOS 26 changed *installability*, not the *push requirement*.** From [WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/):

> "There are now zero requirements for 'installability' in Safari. Users can add any site to their Home Screen and open it as a web app on iOS 26 and iPadOS 26."
> "Giving users a web app experience simply no longer requires a manifest file."

Previously a site needed a manifest with `display: standalone|fullscreen`, or the legacy `<meta name="apple-mobile-web-app-capable">`. As of iOS 26 neither is required for the web-app *experience*.

**But iOS 26 introduced a new failure mode.** From [News from WWDC25: WebKit in Safari 26 beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/):

> "By default, every website added to the Home Screen opens as a web app. If the user prefers to add a bookmark that opens in their default browser, they can turn off 'Open as Web App'."

If that toggle is **off**, the icon is a plain bookmark opening a browser tab — **no Push API, no subscription possible**. You cannot read the toggle at add-time. Detect at runtime with `window.matchMedia('(display-mode: standalone)').matches && 'PushManager' in window`, and show a re-add instruction if it fails. (No single source states this conjunction; it follows from the two documented facts above plus [heise, 2025-10-10](https://www.heise.de/en/news/iOS-26-and-iPadOS-26-Changed-web-app-behaviour-on-the-home-screen-10749652.html): *"If 'Open as web app' is deactivated, a bookmark is written again."*)

**HTTPS: required, no exception that helps you.** Service workers and Push API require a secure context ([W3C Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/)). The `http://localhost` / `127.0.0.0/8` exemption is evaluated against the origin *as the browser sees it* — an iPhone loading `http://192.168.1.50:3000` sees a plain-HTTP non-loopback host and gets nothing. There is no way to extend the localhost exemption to a second device.

**Load-bearing manifest fields (iOS 26 — all now optional for install, but still functionally significant):**

| Field | Status | Why it still matters |
|---|---|---|
| `display` | No longer required to install (iOS 26) | Still the correct signal; required on iOS 16.4–18.x |
| `scope` | **Effectively required** | iOS uses it to decide what stays inside the standalone window. Out-of-scope links open the in-app browser. Practitioner warning: *"Although the default for this is `/`, omitting this DOES NOT WORK in iOS — all links will open Mobile Safari"* ([naildrivin5](https://naildrivin5.com/blog/2023/08/24/braindump-of-pwa-on-ios.html)) |
| `icons` | Strongly recommended | This icon appears on **every notification** — see §7. Without one, iOS generates *"a monogram icon using the first letter of the site's name"* |
| `start_url` | Recommended | Where the app lands when `notificationclick` fails to navigate — which happens (§7) |
| `id` | Recommended | Gives stable identity across `start_url` / manifest-path changes **within the same origin**. Does not help across origins on WebKit |
| `name` | Recommended | Appears in the permission alert and in Settings > Notifications |

Safari 26.0 also added SVG icon support: *"you leverage infinite vector scaling, and rely on Safari to do the work of creating rasterized icons at multiple sizes."*

**Service worker:** required for classic Web Push. **Not** required for Declarative Web Push (iOS 18.4+), which can subscribe via `window.pushManager.subscribe()`. If a root-scoped service worker exists, it shares the same subscription.

---

## 2. Permission flow

**A user gesture is mandatory.** From [WebKit, Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/):

> "A web app that has been added to the Home Screen can request permission to receive push notifications as long as that request is in response to direct user interaction — such as tapping on a 'subscribe' button provided by the web app."

Apple's docs: *"Provide a method for the user to grant permission with a gesture… call the push subscription method immediately from the gesture's event handler code."* WebKit's [User Activation API post](https://webkit.org/blog/13862/the-user-activation-api/) lists `requestPermission()` among **activation-consuming** APIs.

Two different failure modes without a gesture:

- `Notification.requestPermission()` — **does not throw**; resolves without prompting.
- `pushManager.subscribe()` — **throws `NotAllowedError`**.

**Critical iOS-only rule: `pushManager.subscribe()` requires a user gesture even when permission is already `granted`.** Chrome does not. You therefore **cannot silently re-subscribe on launch** after losing a subscription. Mitigation: call `pushManager.getSubscription()` on every app open; if null, surface a gesture-gated re-subscribe button.

**Denial is effectively permanent and not recoverable in-app.** WebKit's wording is conditional on the grant: *"**Once allowed**, the user can manage those permissions per web app in Notifications Settings."* No Apple/WebKit statement was found that a denied-but-never-granted web app gets a Settings entry, on any iOS version through 26.x.

Worse, even where a Settings toggle *is* present, flipping it does not restore the web-visible state. [FlutterFire #11369](https://github.com/firebase/flutterfire/issues/11369) (opened 2023-07-25, closed **wontfix** 2025-06-06) documents exactly this: deny → Settings → Notifications → toggle on → return to app → status **still `denied`**.

**The documented recovery is delete and re-add.** [OneSignal](https://documentation.onesignal.com/docs/en/web-push-for-ios): *"If permission is denied, the home screen app must be removed and re-added for the permission prompt to appear again."* [Progressier's procedure](https://intercom.help/progressier/en/articles/8462095-reset-push-notifications-permissions-on-ios) is the same. Vendors add a belt-and-braces step because deleting the icon does not always take the storage container with it: **delete icon → Settings > Safari > clear website data → re-add**.

**`Notification.permission` is unreliable on iOS — treat it as advisory only.** [WebKit Bug 320551](https://bugs.webkit.org/show_bug.cgi?id=320551), filed **2026-07-29**, still NEW, `rdar://184115018`, 100% reproducible:

| State | iOS returns | Should return |
|---|---|---|
| Granted, then user turns OFF the Settings toggle | `"default"` ❌ | `"denied"` |
| Denied, then user turns ON the Settings toggle | stays `"denied"` ❌ | `"granted"` |

Reporter's diagnosis: *"the web app process caches permission state and does not re-query the OS-level (UNUserNotificationCenter) authorization status when it changes externally."* **OS-level-off is indistinguishable from never-asked.** Use your *server* as source of truth.

**Onboarding implications:**

1. A **soft-ask / pre-prompt is mandatory, not polish**. [web.dev, Permission UX](https://web.dev/articles/push-notifications-permissions-ux): *"If the user blocks the permission request, your web app can't ask for permission again."* Show your own explanatory dialog first; only fire the real prompt if they say yes.
2. Gate the whole flow on `display-mode: standalone` — in a Safari tab there is no Push API at all, so show an "Add to Home Screen" instruction instead of a subscribe button.
3. Ship a permanent, gesture-gated **"Re-enable notifications"** button. It will be needed: after a silent-push revocation (§5) or a spontaneous subscription death, this is the only recovery.
4. Document the delete-and-re-add escape hatch. It is the only recovery for a denial.

**Legacy gotcha:** `Settings > Apps > Safari > Advanced > Feature Flags > Notifications`. Required on in iOS 16.4; default-on since iOS 17. But an [Apple Community thread (2024-02-23)](https://discussions.apple.com/thread/255493027) found it off on 8 of 8 iOS 17 devices whose owners had never touched it. With it off, `requestPermission()` returns `denied` with no prompt while `'Notification' in window` still returns `true` — **feature detection lies**.

---

## 3. VAPID

**Generation.** A P-256 ECDSA keypair you generate yourself (`npx web-push generate-vapid-keys`). **Nothing is registered with Apple.** Apple's docs: *"Prepare a Voluntary Application Server Identification (VAPID) key pair for your server. You use this to identify your server to the push notification services when you send a push notification."* Public key must be base64url-encoded.

**Binding.** The public key is passed as `applicationServerKey` to `pushManager.subscribe()` and is **stored on the subscription permanently**. Apple: *"The public key you include in requests must match the public key provided to `PushManager.subscribe`."*

**Rotation destroys every existing subscription, and on iOS the cost is a user tap.** Three independent mechanisms enforce this:

- **Server side:** Apple returns `400 VapidPkHashMismatch` — *"The VAPID public key from the push subscription doesn't match the VAPID public key in the request."*
- **Client side:** [W3C Push API](https://w3c.github.io/push-api/) — calling `subscribe()` again with different options: *"If any attribute on options contains a different value to that stored for subscription, then reject with an `InvalidStateError`."* You must `unsubscribe()` first.
- **iOS side:** the fresh `subscribe()` requires a user gesture (§2).

**Therefore: generate the VAPID keypair once, back it up, and never rotate unless the private key is compromised.** Treat it as a permanent secret at the same criticality as the origin hostname.

Two format rules that bite in practice:

- The JWT `sub` claim must be a `mailto:` address or a full `https://` URL, else 403. Real-world instance: an auto-generated `mailto:...@localhost` subject broke Apple Web Push. **This is a format check; there is no evidence Apple dereferences the URL.**
- Apple: *"Don't refresh your JWT more frequently than once per hour."*

---

## 4. Origin coupling — the load-bearing finding

**Four separate pieces of state are all keyed to the origin (`scheme` + `host` + `port`), and all four die together.**

| State | Binding | Source |
|---|---|---|
| Service worker registration | Same-origin enforced; `SecurityError` if the script URL's origin differs from the page | [MDN, `ServiceWorkerContainer.register()`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register) |
| Push subscription | *"A push subscription has an associated **scope**, which is a URL"*; *"A push subscription's associated service worker registration is the service worker registration whose scope URL equals the push subscription's scope"* — and scope URLs are absolute, origin-inclusive | [W3C Push API](https://w3c.github.io/push-api/) |
| Notification permission | Per-origin (standard permissions model) | Notifications Standard |
| The Home Screen icon itself | An iOS **web clip** storing a URL | — |

**Consequence: if the server moves hostname or tunnel provider, everything breaks at once.**

- The icon still points at the old URL, which now fails to resolve.
- The service worker registration for the old origin is dead and cannot be transferred.
- The push subscription is dead. Its opaque `https://web.push.apple.com/...` endpoint will keep being accepted by your `web-push` library, but the message has nowhere to go.
- The permission grant is gone; it belonged to the old origin.

**Yes, the PWA must be deleted and reinstalled.** There is no other path. Then: re-grant permission (fresh system alert), re-subscribe (user tap), store the new endpoint server-side.

**There is no migration mechanism on WebKit.** Chromium is shipping *Web App Origin Migration* (`migrate_from` in the new manifest + `allow_migration` in `/.well-known/web-app-origin-association` on the old origin) — see [Chrome for Developers](https://developer.chrome.com/blog/seamless-pwa-origin-migration) and [WICG/manifest-incubations](https://github.com/WICG/manifest-incubations/blob/gh-pages/pwa-migration-explainer.md). **WebKit has registered no standards position on it and has not implemented it.** It is a Chromium incubation, not a shipped web standard. Do not plan around it.

**A 301 redirect from old origin to new does not save you.** The web clip would follow it, but the app then runs on the *new* origin with entirely fresh state — no service worker, no permission, no subscription. Functionally identical to a reinstall, except more confusing.

**What you *can* change without breaking anything:**

- The path of `start_url`, and the manifest's own path — **provided the manifest declares a stable `id`** and the origin is unchanged. Same-origin migration is silent and preserves permissions.
- Notification content, payload shape, service worker code.

**What you must never change after the first install:**

- Hostname (including any subdomain change, and including the tailnet name in `box.tailnet-name.ts.net`)
- Port
- Scheme (`http` → `https` is an origin change)
- The service worker's **scope URL** — the subscription is keyed to the scope, not merely the origin. Register the service worker at root scope (`/`) and leave it there. Moving it from `/` to `/app/` creates a different registration and therefore a different subscription.

**Hosting implication:** the durability of your origin is the durability of the feature. A hostname you own (custom domain, cert via Let's Encrypt DNS-01, which requires no inbound reachability) survives moving the box, changing ISP, changing tunnel provider, and changing VPN mesh. Any provider-issued name — `*.ts.net`, `*.trycloudflare.com`, an ngrok subdomain — welds the feature to that provider forever.

---

## 5. Delivery reliability

**Device asleep / locked / screen off: delivered immediately, not coalesced.** iOS web push is *always* a user-visible alert and never a background push, so it never enters the throttled category. WebKit: *"The notifications from web apps work exactly like notifications from other apps. They show on the Lock Screen, in Notification Center, and on a paired Apple Watch."* Apple's `Urgency` header takes `very-low | low | normal | high`; *"To attempt to deliver the notification immediately, specify `high`."* The throttling language in Apple's APNs docs attaches to `apns-priority` 5/1 and `apns-push-type: background`, which web push does not use.

*Unverified:* the `Urgency` → `apns-priority` mapping used by `web.push.apple.com` is undocumented by Apple. The mapping circulating online comes from a third-party relay implementation, not Apple's.

**Offline: store-and-forward exists, but APNs stores only ONE message.** Apple's web push doc, on `TTL`:

> "If the push service can't deliver a notification immediately, it may store the notification for 30 days or fewer, depending on the value you specify… **The number of notifications the push services stores while the device is offline is limited.**"

The underlying APNs rule, which `TTL` maps onto:

> "APNs stores only one notification per bundle ID. When you send multiple notifications to the same device for a bundle ID, APNs selects only one notification to store. In most cases, the latest notification is stored."

Confirmed by an Apple engineer, September 2025 ([Forums 802539](https://developer.apple.com/forums/thread/802539)): *"APNs holds a queue of 1 undelivered push request. If another push request arrives before it is delivered, the first one is overwritten by the second one, and so on."*

**Design consequence for a listing watcher:** if the phone is offline for an hour and five listings appear, at most **one** notification survives. Either make each notification a *summary* pointing into the app ("3 new listings"), or maintain the queue server-side and reconcile on app open. Do not assume a backlog drains. `TTL: 0` means fire-and-forget (dropped if unreachable); a positive `TTL` is **mandatory** (`400 BadTtl` otherwise).

**Low Power Mode: no documented effect on web push.** Nothing from Apple or WebKit links Low Power Mode to user-visible push delivery. Everything connecting the two concerns *background/silent* notifications for native apps — a category web push cannot use. Vendor troubleshooting pages claiming "Low Power Mode disables push" are not authoritative.

**Unengaged PWA: there is no engagement-based push budget in WebKit.** Two protections actively work in your favour:

- Installed Home Screen web apps are **exempt from ITP's 7-day script-writable storage cap**: *"Web applications added to the home screen… have their own counter of days of use… We do not expect the first-party in such a web application to have its website data deleted."* ([WebKit, 2020](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/))
- WebKit trunk added time-based eviction (default 180 days) in May 2026 — then explicitly exempted push: *"This exempts all origins with an active push subscription from time-based website data eviction."* ([Bug 314872](https://bugs.webkit.org/show_bug.cgi?id=314872), 2026-05-18). *Ship status unconfirmed — `main`-branch commits; Safari 26.6 release notes mention neither.*

**The real killer is the silent-push counter — a lifetime budget, not a rolling window.** From WebKit source at HEAD (2026-08-15):

```cpp
// Source/WebKit/Shared/WebPushDaemonConstants.h
// If an origin processes more than this many silent pushes, then it will be unsubscribed from push.
constexpr unsigned maxSilentPushCount = 3;

// Source/WebCore/Modules/notifications/NotificationData.h
static constexpr Seconds silentPushTimeoutForProduction { 30_s };
```

Three findings not present in any documentation:

1. **"In a timely manner" = 30 seconds.** A per-push timer starts; if `showNotification()` hasn't landed in 30s, the counter increments.
2. **The counter never resets.** `PushDatabase::incrementSilentPushCount` only ever increments; there is no decrement or reset path anywhere in `PushDatabase.cpp`. Successful notifications earn no credit back.
3. **Revocation removes *all* subscriptions for the origin**, logged as *"Removing all subscriptions associated with … since it processed %u silent pushes."*

Apple's docs state the rule plainly: *"Safari doesn't support invisible push notifications… If you don't [present them], Safari revokes the push notification permission for your site."* WWDC22 session 10098 gave the number: *"after three push events where you fail to post a notification in a timely manner, your site's push subscription will be revoked… You will need to go through the permission workflow again."*

**Two things make this treacherous:**

- **It cannot be reproduced under a debugger.** WebKit *"suspend[s] silent push enforcement"* for service workers attached to Web Inspector. Your dev loop will never show you this bug.
- A service worker that tries to `fetch()` your origin *before* calling `showNotification()` accumulates strikes every time the origin is unreachable — which, on a home server behind a VPN, is often. **Put the full notification content in the encrypted push payload and call `showNotification()` unconditionally inside `event.waitUntil()`.**

**Declarative Web Push (iOS 18.4+) is exempt entirely.** [WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/): *"Because there is always a user visible notification… browsers don't have to apply their 'silent push penalties' to Declarative Web Push messages."* Confirmed in the implementing commit: *"if a pending push message is declarative… do not start the silent push timer."* **This is the strongest single reliability decision available on iOS.**

*Note, May 2026:* WebKit is closing the show-then-immediately-close workaround — [Bug 309940](https://bugs.webkit.org/show_bug.cgi?id=309940) makes persistent notifications un-closable within 30s of display.

**Subscriptions do silently die, and you cannot detect it client-side.**

- **`pushsubscriptionchange` is not implemented on iOS Safari.** MDN browser-compat-data: `"safari_ios": { "version_added": false }`. When iOS revokes, your page gets no event.
- [WebKit Bug 273063](https://bugs.webkit.org/show_bug.cgi?id=273063) — "iOS service worker - webPush subscription becomes invalid for few users", filed 2024-04-22, **still NEW**. Apple engineer Ben Nham noted fixes in iOS 17.5 RC, in Web.app rather than WebKit — *Web.app deleting subscriptions after reporting lost permissions*.
- [Apple Forums 769794](https://developer.apple.com/forums/thread/769794) (Nov 2024 – Feb 2025, iOS 18.1.1), multiple independent devs: endpoints change randomly; `getSubscription()` returns `null` after app restart *while notifications still arrive*. **No Apple response.**
- **You cannot rely on `410 Gone` for cleanup on iOS.** The same thread reports *"POSTing to deleted notification endpoints returns 201 instead of an error"* — unlike Google/Microsoft/Mozilla. Handle 410/404 when they arrive, but absence of 410 is not evidence the subscription is alive.

*Not verified:* whether push subscriptions survive iOS version upgrades (only scattered "had to resubscribe after 17.6" reports), or whether the old subscription is reaped on delete-and-reinstall.

**Rate limits at `web.push.apple.com`: no documented numeric limit.** Apple engineer, Sept 2025: *"While there are no 'documented' limits on how many and how fast you can send your push requests, obviously things are not unlimited… your push requests can get throttled, your connections dropped, and in the end your IP address could get blocked."*

Documented status codes: `201` success · `400` (`BadTtl`, `BadUrgency`, `BadWebPushTopic`, `BadJwtToken`, `BadVapidPublicKey`, `PayloadTooLarge`) · `403` auth error · `404` invalid path · `405` non-POST · `410` device token expired · `413` payload too large · `429` `TooManyRequests` (*"received too many consecutive requests to the same device token"*) · `500` · `503`. Note `429` is scoped **per device token**, not per app server. Connection limits: ≤100 unacknowledged requests on HTTP/1.1; respect `SETTINGS_MAX_CONCURRENT_STREAMS` on HTTP/2.

---

## 6. Silent push — confirmed impossible

**Every server-to-phone message must be user-visible. There is no exception and no workaround.**

Apple's docs: *"Safari doesn't support invisible push notifications."* WebKit, 2022: *"When a web application registers a push subscription, they promise that pushes will always be user visible… Violations of the `userVisibleOnly` promise will result in a push subscription being revoked."* Declarative Web Push hardens this further: *"No silent push messages are allowed"* — a non-empty `title` is mandatory in the payload schema.

Attempting it is not merely ineffective — it is actively destructive, via the three-strike lifetime counter in §5.

**Design consequence: you cannot use push for background sync.** Data refresh has to happen when the user opens the app (or on a visible push whose handler also updates local state before showing the notification). Every message costs a notification.

---

## 7. Payloads and presentation

**Payload ceiling: 4096 bytes, measured on the ENCRYPTED body.** Apple: `PayloadTooLarge` → *"The payload size is over the limit of 4 KB"*; HTTP 413. [RFC 8030 §7.2](https://datatracker.ietf.org/doc/html/rfc8030#section-7.2): *"Push services MUST NOT return a 413 status code in responses to an entity body that is 4096 bytes or less in size."*

**Usable plaintext: 3993 bytes**, stated exactly in [RFC 8291 §4](https://datatracker.ietf.org/doc/html/rfc8291#section-4): *"Absent header (86 octets), padding (minimum 1 octet), and expansion for AEAD_AES_128_GCM (16 octets), this equates to, at most, 3993 octets of plaintext."* Check your library's padding default; Declarative Web Push's JSON wrapper costs ~40 bytes. **Engineering budget: keep plaintext under ~3.5 KB.**

**NotificationOptions support — the engine-level truth.** WebKit's `NotificationOptions.idl` on `main` (2026-08-16) shows which members the engine parses; everything commented out is **silently dropped during WebIDL conversion — no exception is thrown**:

| Option | iOS Home Screen web app | Evidence |
|---|---|---|
| `title`, `body`, `data`, `dir` | ✅ Supported (16.4+) | IDL + MDN BCD |
| `navigate` | ✅ Supported (18.4+) | Declarative Web Push |
| `icon` | ⚠️ **Accepted, readable, never rendered** | [WebKit Bug 280162](https://bugs.webkit.org/show_bug.cgi?id=280162), NEW since 2024-09-22 |
| `tag` | ⚠️ **Accepted, readable, does not coalesce** | [WebKit Bug 258922](https://bugs.webkit.org/show_bug.cgi?id=258922), NEW since 2023-07-06 |
| `actions` | ❌ Not implemented, silently dropped | IDL commented out |
| `image` | ❌ Not implemented | [Bug 280161](https://bugs.webkit.org/show_bug.cgi?id=280161) |
| `badge` (mono image) | ❌ Not implemented | [Bug 280160](https://bugs.webkit.org/show_bug.cgi?id=280160) |
| `renotify`, `requireInteraction`, `vibrate`, `timestamp` | ❌ Not implemented | IDL commented out |
| `silent`, `lang` | ⚠️ **Contradictory** — in WebKit IDL, but MDN BCD says `safari_ios: false`. Untested | — |

**Images: no.** There is no big-picture notification on iOS. For an eBay listing, the card image cannot be shown in the notification — only after the user taps through.

**Icon: iOS always shows the web app's Home Screen icon, regardless of what you pass.** MDN BCD for `Notification.icon` on Safari: `"version_added": false, "notes": "The property can be set, but has no effect."` [Apple Forums 740688](https://developer.apple.com/forums/thread/740688): *"It always just defaults to using the icon defined in the PWA's manifest instead."* Same on macOS Safari. **Invest in the manifest icon; it is the only icon you get.**

**Action buttons: not supported.** [Apple Forums 726793](https://developer.apple.com/forums/thread/726793): *"My self-defined actions seem to be ignored and not displayed."* Long-press gives only the system "View" action. `event.action` is readable and will always be `""`.

⚠️ **Contradiction worth knowing:** the WebKit Declarative Web Push explainer *shows* an `actions` array, and WWDC25 session 235 claims *"anything supported by the W3C standard NotificationOptions dictionary is respected here."* **Contradicted by the shipping source** — `NotificationJSONParser.cpp` has no `actions` key. Treat "declarative actions work on iOS" as **false** as of Aug 2026.

*Fallback UX:* one notification = one tap = one destination. If you need a choice, deep-link to a screen presenting the options as real buttons.

**`tag` does not replace notifications on iOS — N pushes with the same tag = N entries in the tray.** WebKit engineer Ben Nham, [Bug 258922](https://bugs.webkit.org/show_bug.cgi?id=258922) comment 4: *"the tag attribute on Notification is exposed… But the browser currently doesn't use the property to coalesce notifications."* Still NEW, last modified 2026-07-31; [Bug 319860](https://bugs.webkit.org/show_bug.cgi?id=319860) (2026-07-20) confirms it is broken under Declarative Web Push too.

The `Topic` header (Apple: *"Optional identifier that the push service uses to coalesce notifications. Use a maximum of 32 characters from URL or filename-safe Base64"*) coalesces **undelivered messages queued at the push service** — it does *not* replace an already-displayed notification. Useful for the offline case in §5, not for live replacement. iOS's default "Automatic" grouping stacks all notifications from one web app; you have no sub-grouping control (`thread-id` is unreachable from web push).

**Deep-linking — the weakest part of the platform.**

The classic `notificationclick` path is unreliable. [WebKit Bug 268797](https://bugs.webkit.org/show_bug.cgi?id=268797) — "notificationclick events in serviceworkers not firing" — filed 2024-02-05, **still NEW, last updated 2026-08-12**. Push events fire and `showNotification()` works, but the click handler never runs. A 2025-07-19 comment: *"in iOS 18.5 this is even worse than it was before. Even the timeout doesn't provide a workaround any more."* [Bug 263687](https://bugs.webkit.org/show_bug.cgi?id=263687) documents `client.navigate()` failing with `TypeError: navigate failed`. When the handler does nothing, **iOS launches the web app at `start_url`** — an iOS/Android divergence (on Android nothing happens).

*Contradictory datapoint:* one reporter could not reproduce on iOS 26.0 (Dec 2025), while a detailed failure report on iOS 18.7 / Safari 26.6 landed Aug 2026. **Test on your actual device.**

**Use the Declarative Web Push `navigate` field instead (iOS 18.4+).** WebKit: *"That's where the required `navigate` value comes in. It describes a URL that will be navigated to by the browser upon activation."* This **bypasses `notificationclick` entirely** — per spec, if `navigationURL` is non-null the UA navigates and returns; the click event is never fired. That is almost certainly why Apple built it. Payload shape:

```json
{ "web_push": 8030,
  "notification": { "title": "…", "navigate": "https://…/listing/123",
                    "body": "…", "app_badge": 3 } }
```

Non-supporting browsers ignore `web_push: 8030` and deliver the raw payload to the `push` event as normal, so a classic handler remains a valid fallback for iOS 16.4–18.3.

**URL constraints:** the target must be **same-origin** *and* inside your explicitly-declared manifest `scope`. Out-of-scope navigation opens the in-app browser rather than staying in the web app. *(Whether Safari enforces same-origin on declarative `navigate` is unverified.)*

**App badge: supported, iOS 16.4+.** From [Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/):

- *"The badge will only appear if the user has granted notifications permission."*
- *"The Badging API is exposed in Web Worker contexts"* — **yes, callable from a `push` event handler.**
- *"available exclusively for web apps the user has added to their home screen"* — not in Safari tabs on iOS.
- Caller must be same-origin with the top-level document.

Declarative Web Push exposes `app_badge` as a top-level payload member, letting you update the badge with **no JavaScript at all**. *Caveat: one unverified report claims macOS Safari 18.5 crashed when `app_badge` was present. Smoke-test it.*

**Title/body truncation: no Apple-documented character limits exist.** Apple's HIG advises the opposite of pre-truncating — *"don't truncate your message — the system does this automatically, if necessary."* All circulating numbers are unsourced third-party estimates. **Safe targets: title ≤ ~35 chars, body ≤ ~100 chars, front-load the meaning** (the Dynamic Island shows only the title and the first few words).

---

## 8. Local development and testing

**No Apple developer account is required — paid or free. Confirmed from four first-party sources.**

- [WebKit, iOS 16.4 post](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/): *"You do not need to be a member of the Apple Developer Program to use it."*
- [WebKit, Meet Web Push](https://webkit.org/blog/12945/meet-web-push/): *"You don't need to join the Apple Developer Program to send Web Push notifications."*
- Apple docs: *"You don't need to join the Apple Developer Program to send web push notifications."*
- [WWDC22 session 10098](https://developer.apple.com/videos/play/wwdc2022/10098/): *"We are using the same Apple Push Notification service that powers native push… but no Apple Developer account is required to reach Safari users."*

No Apple-issued certificate, no `.p8`, no `.p12`, no App ID, no App Store. Just a self-generated VAPID keypair.

*Contrast:* **native APNs push does** require the paid program (the `.p8` auth key / push certificate are issued only via Certificates, Identifiers & Profiles). And the **legacy macOS-only "Safari Push Notifications"** flow — Website Push ID (`web.com.example`), `.p12` signing cert, pushPackage — *did* require *"An Apple developer license."* macOS-only, irrelevant to iOS PWAs. *(Apple's 2022 position was "it will continue to work"; secondary claims it was removed in Ventura are unconfirmed against any first-party source.)*

**The shortest honest feedback loop: a real HTTPS origin the phone can reach + a real iPhone. There is no shortcut.**

| Option | Trusted cert | Stable origin | Verdict |
|---|---|---|---|
| **Tailscale Serve** | ✅ Let's Encrypt | ✅ | Zero config, tailnet-only, no inbound ports. Same origin in dev and prod = no re-subscribe churn. Risk: [issue #19147](https://github.com/tailscale/tailscale/issues/19147) |
| **Own domain + Let's Encrypt DNS-01** | ✅ | ✅ | **Most durable.** [DNS-01 needs no inbound reachability](https://letsencrypt.org/docs/challenge-types/) — validates a TXT record. Point an A record at your LAN IP or run split-horizon DNS. Needs a domain + DNS API automation |
| **cloudflared quick tunnel** | ✅ | ❌ | *"generates a new random URL each time"* — **every restart orphans the installed PWA and its subscription** (§4). Only usable as a *named* tunnel with your own hostname |
| **ngrok free** | ✅ | ❌ | **Poor fit.** Free tier serves an HTML interstitial; the documented bypass is a request header, which you cannot set on a top-level navigation or the browser's service-worker script fetch. Breaks install and SW registration |
| **mkcert / self-signed + CA profile** | Local only | ✅ | Works, with caveats below |

**Self-signed on iOS, if you go that route:** `mkcert -install` → get `rootCA.pem` onto the phone → install the profile → **then the step everyone misses: Settings > General > About > Certificate Trust Settings > enable full trust for the root.** Without it the cert is installed but untrusted and Safari still fails. Also respect the **825-day** validity cap (Apple Support 103769) — exceed it and Safari fails with *"could not establish a secure connection"*, **no warning dialog, no bypass, no explanation**. Issue leaves at ≤397 days. *Unverified: no first-party confirmation that `pushManager.subscribe()` works on an origin chaining to a user-installed CA. Per spec it should. Test `subscribe()` early.*

**Safari Web Inspector against an installed Home Screen web app — explicitly supported.** From [Apple, Inspecting iOS and iPadOS](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios):

1. On the Mac: Safari > Settings > Advanced > **"Show features for web developers"** (replaced the old "Show Develop menu" checkbox in Safari 16.4).
2. On the iPhone: **Settings > Apps > Safari > Advanced > Web Inspector** (on).
3. Connect by cable and trust the Mac. *"In Safari, the device will appear in the Develop menu."*
4. Verbatim: *"When a Home Screen web app is in the foreground, you can inspect it from the Develop menu. Find the menu item for the iOS or iPadOS device you wish to inspect, and then find the web app's URL in the **Home Screen Web Apps** section near the bottom of the menu."*

Wireless works too, but only after a first cabled connection (then enable *Connect via Network*).

**Service workers:** *"You can only inspect service workers that are currently running… This section doesn't appear if there aren't any service workers currently running."*

**Two traps in this loop:**

- **Seeing `push` events is undocumented and racy.** A push-triggered service worker start is short-lived, so there is a race between the worker spinning up and the inspector attaching. Practical approach: keep the web app **foregrounded** (keeps the SW alive and inspectable), attach the inspector, then fire the push. *Unverified that this reliably surfaces `push` events.* **Build a server-side echo/logging path as your real fallback.**
- **Web Inspector suspends silent-push enforcement** (§5). Your most dangerous production bug is invisible in dev by design.

**iOS Simulator: no viable path.** Web Inspector works against simulators, but **Add to Home Screen is broken/unreliable** there — WebKit's Brady Eidson: *"Simulator support for A2HS is known to be buggy (In Safari, too)"*; Apple's Jen Simmons: *"testing with real devices works."* Since iOS web push is Home-Screen-only, no A2HS means no push. And `simctl push` addresses a **bundle identifier**, which a web app does not have. *(Those quotes are from Feb/Mar 2023; current iOS 26 Simulator status unverified — but there is no documented path.)* **Test on a physical iPhone.**

---

## 9. Self-hosted specifics — direction of traffic

**Nothing about Web Push requires your server to be publicly reachable. The app server is always the HTTP *client*.**

[RFC 8030 §5](https://www.rfc-editor.org/rfc/rfc8030.html): *"An application server requests the delivery of a push message by sending an HTTP POST request to a push resource distributed to the application server by a user agent."* §6: the user agent maintains its own connection to the push service, which uses HTTP/2 server push to deliver. Apple's docs: *"send the notification request over HTTP/1.1 or HTTP/2 to the endpoint you stored from the recipient's push registration."*

WebKit phrases the network requirement purely as an **egress allowlist**: *"Just be sure to allow URLs from `*.push.apple.com` if you are in control of your server push endpoints."*

**So the send-side requirement for a residential-NAT home server is: outbound TCP 443 to `*.push.apple.com`.** No port forwarding, no static IP, no inbound firewall rule, no dynamic DNS.

**But there are two independent reachability requirements — don't conflate them:**

| Requirement | Direction | When it matters |
|---|---|---|
| **Origin reachability** | iPhone → your server, HTTPS | Install, open the app, register the SW, `subscribe()`, POST the subscription home, **and whenever the user taps a notification** |
| **Push delivery** | your server → `web.push.apple.com` (outbound); Apple → phone via APNs | Send time only |

The push payload is encrypted end-to-end ([RFC 8291](https://datatracker.ietf.org/doc/html/rfc8291)) and carries its own content, so **the service worker never needs to call home to display a notification** — provided you author the handler that way. This is what makes push independent of origin reachability, and the same thing that protects you from the silent-push counter (§5).

**Tailscale-only origin: viable for delivery.**

- **Secure context:** [W3C Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/) — *"If origin's scheme is either 'https' or 'wss', return 'Potentially Trustworthy'."* No clause disqualifies private/CGNAT addresses or non-public DNS names.
- **Real cert:** [Tailscale, Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https) — *"Tailscale will automatically request a certificate for this machine on this domain, using Let's Encrypt."* Requires MagicDNS + "Enable HTTPS" in the admin console.
- **Privacy caveat, verbatim:** *"All TLS certificates on the web are recorded in the Certificate Transparency (CT) append-only public ledger, which anyone can access… Notably, this includes the fully qualified domain name of your devices."* Your machine name becomes public knowledge; the *service* stays private.
- **Use Serve, not Funnel.** [Serve](https://tailscale.com/kb/1312/serve) keeps it tailnet-only; [Funnel](https://tailscale.com/kb/1223/funnel) exposes it to the public internet, which you do not need.
- **Working reference implementation exists:** [AltanS/collie](https://github.com/AltanS/collie) is a PWA built for exactly this shape — *"served over Tailscale"*, `tailscale serve` *"terminates TLS (managed cert, nothing to obtain or renew)"*, iOS Add to Home Screen, web push on state change, tap-to-open-at-the-right-place. Its README also warns: *"Plain-HTTP modes… are not a secure context, so push silently won't fire there"*, and *"Never `tailscale funnel` this."*

**Does the phone need Tailscale up to RECEIVE a push? Reasoned answer: no.** The push travels Apple push service → APNs → device, never touching your origin. Tailscale on iOS is a **split tunnel** — only tailnet ranges (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`) and advertised routes go through it, so APNs traffic is unaffected whether Tailscale is on or off. **Tapping the notification does require the tailnet**, since the app then loads from your origin. So does subscribing.

⚠️ **This specific point is inference from the protocol plus documented split-tunnel behaviour. No authoritative statement and no first-hand report was found of an iOS Home Screen web app receiving a push while its origin was unreachable. It is a five-minute empirical test — turn Tailscale off on the phone, send a push, see if the banner appears. Run it before designing around it.**

**Known Tailscale + iOS risk:** [tailscale#19147](https://github.com/tailscale/tailscale/issues/19147), opened **2026-03-27, still open, no root cause and no workaround** — *"iPhone cannot establish secure connection to Tailscale Serve *.ts.net HTTPS endpoints"*, failing in both Safari and Chrome while the same endpoints validate server-side. One unresolved report, not a general breakage, but it is the one concrete iOS + Serve + HTTPS failure on record. (A separate report, [#14095](https://github.com/tailscale/tailscale/issues/14095), of Tailscale delaying push is **Android/FCM**; no iOS equivalent found.)

**Recommended posture:** if you use Tailscale Serve, understand that the `.ts.net` hostname *is* your origin forever (§4). A custom domain fronting the same box — cert via DNS-01, resolved over split-horizon DNS or pointed at the tailnet IP — keeps the same operational simplicity while making the origin portable if you ever change VPN mesh, ISP, or machine.

---

## Summary of what changed since the iOS 16.4 launch state

| Area | iOS 16.4 (Mar 2023) | Current (through iOS 26.6, 2026-08-16) |
|---|---|---|
| Feature flag | `Safari > Advanced > Feature Flags > Notifications` had to be on | Default-on since iOS 17; occasionally still found off |
| Installability | Manifest with `display: standalone`/`fullscreen` required | **Zero requirements** (iOS 26); every added site opens as a web app **by default, but user-toggleable** |
| Home Screen required for push | Yes | **Yes — unchanged.** Safari tabs still never get Push API on iOS |
| Gesture requirement | Required | **Unchanged** |
| Denial recovery | Delete + re-add | **Unchanged** — no Settings-based recovery has been added |
| Declarative Web Push | n/a | **Shipped iOS/iPadOS 18.4** (Mar 2025) — silent-push-exempt, `navigate`, `app_badge`, no service worker required |
| Badging API | Shipped in 16.4 | Unchanged |
| `icon` / `image` / `actions` / `tag` | Not implemented | **Still not implemented** — all bugs still NEW as of 2026-08-16 |
| `notificationclick` reliability | — | Open bug since Feb 2024, last failure report 2026-08-12 |
| `pushsubscriptionchange` | Not implemented on iOS | **Still not implemented** |
| EU availability | n/a | iOS 17.4 beta removed Home Screen web apps in the EU; **Apple reversed this in March 2024.** Some 2026 vendor pages still repeat the removal claim — **it is wrong** |
| Safari 26.4 / 26.5 / 26.6 / 27 beta | — | **No Web Push or Notifications changes whatsoever** |

## Explicitly not verified

- That an iOS web app receives a push while its origin is unreachable (inference; test it).
- Whether a *denied-but-never-granted* web app gets a Settings > Notifications entry on iOS 17/18/26. **Design as if it does not.**
- Whether `silent: true` and `lang` have observable effect on iOS (WebKit IDL and MDN BCD contradict each other).
- Whether `notificationclick` (Bug 268797) is fixed on iOS 26.x — contradictory reports; test on target device.
- Whether Safari enforces same-origin on declarative `navigate`.
- Whether the May 2026 WebKit eviction-exemption commits have shipped to users.
- The `Urgency` → `apns-priority` mapping at `web.push.apple.com` (undocumented by Apple).
- Push subscription survival across iOS version upgrades and across delete-and-reinstall.
- Current iOS 26 Simulator Add-to-Home-Screen status (no supported push path found regardless).
- Whether Push API subscription works on an origin chaining to a user-installed CA (spec says it should).
