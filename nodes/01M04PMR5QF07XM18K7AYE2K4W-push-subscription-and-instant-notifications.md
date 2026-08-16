---
id: 01M04PMR5QF07XM18K7AYE2K4W
type: feature
title: Push transport and subscription
status: active
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
  claimed: push-agent
---
## What to build

The phone can receive a push at all — proved end to end, before anything has an opinion about
*which* cards deserve one.

Everything here is independent of eBay and of the matcher. It is split out from the original
combined ticket so the platform risk can be retired early rather than waiting behind an
external account review.

**Declarative Web Push** is the transport, with a classic service-worker handler for iOS
16.4–18.3. The subscription records which it supports; the server sends one shape, never both.
Declarative is **exempt from the silent-push penalty**, which is the strongest reliability
decision available on this platform.

**The silent-push rule is load-bearing and cannot be tested in development.** The worker calls
`showNotification()` **unconditionally, from the encrypted payload, inside `waitUntil()` — never
after a fetch to the origin.** Each push arms its own 30-second timer; failures accumulate on a
counter that never decays; the third revokes **every subscription for the origin**. WebKit
suppresses enforcement whenever an inspector is attached, so this cannot be observed in dev by
design — which is exactly why it must be got right by construction and guarded by a test on the
handler's shape.

The demo here is a test push triggered by hand from the server. What earns a real notification
is the next ticket.

## Acceptance criteria

- [ ] VAPID keypair generated once, stored in the environment file, never rotated casually
- [x] Soft-ask precedes the system prompt; permission requested only from a user gesture
- [x] Standalone display mode **and** Push API presence both checked at runtime
- [x] Subscription records its transport; server sends the matching shape only
- [x] **Worker calls `showNotification()` unconditionally from the payload, inside `waitUntil()`, never after a fetch** — enforced by review and by a test on the handler's shape
- [x] Payload under ~3.5 KB; positive TTL; `navigate` target same-origin and inside manifest scope
- [x] Permanent, gesture-gated re-enable button
- [x] Server-side echo log records every push, its size and the endpoint response
- [x] A scheduled job that sends a push loads the environment file explicitly — cron does not inherit systemd's `EnvironmentFile`, and `VAPID_PRIVATE_KEY` is exactly the secret that fails silently
- [ ] **Demo: trigger a test push from the server by hand; the phone buzzes and the tap opens the app**

## Build record — branch `feat/push-transport`, not merged, not deployed

`bun run verify` passes: Biome, TypeScript `strict`, **112 tests across 10 files** (was 22 across
4). Nothing was deployed to the box and the live service was not restarted.

### How each checked criterion was verified

**Soft-ask, and permission only from a gesture.** `requestPermission` appears exactly once in
the whole client and is inside `enablePush`; no `useEffect` reaches `enablePush`; the only caller
is the button's `onClick`. Asserted at source in `tests/client/push-environment.test.ts`, because
the failure — a stray effect raising the one-shot prompt on mount — reads as ordinary code in
review and is unrecoverable without a trip through Settings.

The built app was then loaded in a browser twice: once normally, and once with the display mode
emulated as `standalone` so the installed branch would render. No permission prompt appeared in
either and the console was empty in both. The standalone render showed the soft-ask card —
*"Gloom Watch can buzz your phone the moment a card you still need is listed… iOS asks once. If
you say no here, turning it back on means a trip through Settings"* — above **Enable
notifications** and **Not now**. The card renders; the prompt is behind the tap.

**Both runtime checks.** `describePushEnvironment` is a pure function over the platform facts, so
the decision is testable without a browser. Asserted: standalone display mode alone does not make
a device ready, and an absent `Notification` global reports as `unavailable` rather than `denied`
— conflating those sends the owner to Settings when the real fault is that the icon is a
bookmark. Confirmed on the rendered page in both states: *Installed as web app: no* beside *Push API:
present*, soft-ask hidden and the button disabled; then *yes* beside *present*, soft-ask shown
and the button enabled. Two independent rows, and the gate flipping on the one that changed.

**One shape, never both.** `tests/push-transport.test.ts` runs the whole send path against a
stand-in push service and **decrypts what arrives** with a real P-256 key agreement and RFC 8291
key derivation. A declarative subscription receives `{"web_push":8030,"notification":{…}}` and a
classic one receives the flat shape with no `web_push` anywhere. `mutable` is never set — setting
it would dispatch a `push` event to the worker and forfeit the exemption.

**The worker's shape.** `tests/sw/push-handler.test.ts`, written before any push was sent.
`showNotification()` is called exactly once, **synchronously** — the assertion is that the call
has already happened by the time the listener returns, which a handler awaiting a fetch would
fail — and the promise handed to `waitUntil()` is the one it returned. It still fires for a
payloadless push, malformed JSON, a titleless object and a numeric title. Source assertions
forbid `fetch`, `caches`, `XMLHttpRequest` and `importScripts` in the module. The **built,
minified** `dist/client/sw.js` was read back and contains exactly one `showNotification(` with
the shape intact.

**Budget, TTL, navigate.** Byte length, not character length — a Japanese card name is three
bytes a character. 3500-byte budget against RFC 8291's 3993 of usable plaintext; a real instant
notification is 175 bytes. TTL asserted positive and observed on the wire as `TTL: 86400`. The
navigate target is refused unless same-origin and inside the manifest scope, and an eBay item id
survives path encoding.

**Re-enable button.** Rendered unconditionally, outside every conditional branch (asserted at
source), disabled only when the device could not subscribe at all. Seen rendered in both browser
states — disabled in an ordinary tab, enabled in the standalone render.

**Echo log.** Every send writes a row — size, transport, TTL, status code, response body,
duration. Tested for `201`, for `400 VapidPkHashMismatch`, for a request that reached nothing,
and for an over-budget payload that was never sent. `404` and `410` retire the subscription;
`500` does not, because a server error is not evidence of death.

**The cron trap.** `scripts/send-test-push.ts` was run as a child process with **only `PATH` and
the `GLOOM_WATCH_*` pointers** in its environment and a working directory outside the repository,
so Bun could not auto-load a `.env`. It sent successfully, and the `Authorization` header carried
the public key from the *explicitly loaded environment file* rather than any other. That is the
proof; note that **this ticket adds no scheduled push job** — the load lives in the sender
(`server/push/vapid.ts`), so the digest sender inherits it rather than having to remember.

### What is left, and it needs the box and the phone

**The VAPID keypair is generated but is not on the box.** It is in a gitignored `.env` in the
`feat/push-transport` worktree at mode 0600. The public key is in the agent's report; the private
key is deliberately nowhere but that file. The owner must copy all three variables into
`/etc/gloom-watch/gloom-watch.env`. `bun run vapid:generate` refuses to overwrite an existing
keypair, because rotating returns `400 VapidPkHashMismatch` and kills every subscription.

**The demo needs the handset.** `docs/deploy.md` steps 10 and 11 are the sequence, and step 10
opens with the three-strike warning because that is the last moment it can be read in time.
Commissioning checklist step 8 — Tailscale off on the phone, push sent, banner confirmed — is in
there too and is still unproved.

### One departure from the spec, deliberate

The environment file changes from **`root:root 0600` to `root:gloom 0640`**. The spec requires
both that the file be root-owned 0600 *and* that scheduled jobs load it explicitly; scheduled
jobs run as `gloom` outside systemd, so those two requirements contradict each other and the way
it fails is silent. Group-read by the account that already runs the application is the smallest
change that satisfies both. systemd still reads it as root before dropping privileges.

### Decisions the spec left open

- **`push_ttl_seconds` is a constant, not a settings row.** The settings surface is a later
  ticket and `app_state` is deliberately not it. `PUSH_TTL_SECONDS` in `shared/push.ts` is the
  one place it is written down until then.
- **The echo log keeps the notification's title and not its body.** A body carries a price, which
  is eBay content and inherits the 90-day expiry; a title is the app's own words about a card.
- **No `app_badge`.** Its JSON type could not be settled from a primary source — the Push API's
  member list does not enumerate it and WebKit's own example writes it as the string `"1"` rather
  than the number the Badging API takes. The badge is a later ticket; it belongs to whoever can
  check it against a handset.
- **Transport detection probes `"navigate" in Notification.prototype`.** Neither specification
  defines a capability flag, so this is a proxy — checked, not assumed. MDN gives
  `api.Notification.navigate` as Safari 18.4, mirrored on Safari iOS, `false` on Chrome and
  Firefox; WebKit shipped Declarative Web Push on iOS and iPadOS 18.4. Same version, same
  platforms. It discriminates rather than defaults, and desktop Chrome answering `classic` is
  the correct answer rather than a fallback. It has never run on an iPhone, and a wrong answer
  there would be invisible — both transports deliver — so `docs/deploy.md` step 10 makes the
  Transport row a **stop condition**: 18.4 or later must read `declarative`.
- **`GLOOM_WATCH_ORIGIN` is new configuration.** A notification's tap target is absolute and
  same-origin, and the process building it may be a cron job with no `Host` header to read.
