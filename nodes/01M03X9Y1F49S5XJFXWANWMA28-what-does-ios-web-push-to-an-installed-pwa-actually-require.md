---
id: 01M03X9Y1F49S5XJFXWANWMA28
type: decision
title: What does iOS Web Push to an installed PWA actually require?
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
meta:
  ticket: research
  hitl: no
---
## The question

What does iOS actually require for Web Push to an installed PWA, and where does
it break?

This is the feature most likely to quietly not work. Apple's Web Push support is
real but narrow, and several of its constraints reach back into decisions about
hosting, origin stability and notification design.

## What to find out

- **Baseline requirements.** iOS version floor, the Home Screen install
  requirement, HTTPS, service worker, manifest fields that are actually load
  bearing. Confirm whether Web Push still requires Home Screen installation on
  current iOS or whether Safari tabs now qualify.
- **Permission flow.** Must the permission prompt come from a user gesture? What
  happens if the user denies — is it recoverable in-app, or does it require
  deleting and reinstalling the PWA? This shapes onboarding.
- **VAPID.** Key generation, how keys bind to the subscription, and what happens
  to existing subscriptions if the keys are rotated.
- **Origin coupling.** How tightly a push subscription binds to its origin. If
  the server later moves from one hostname or tunnel to another, do all
  subscriptions die? This is the constraint that most affects the hosting
  decision, so be specific.
- **Delivery reliability.** Behaviour when the device is asleep, offline, in Low
  Power Mode, or when the PWA has not been opened in weeks. Does Apple throttle
  or drop pushes to PWAs the user ignores? Any documented budget for how many
  notifications an unengaged PWA may receive.
- **Silent push.** Whether a push can arrive without showing a notification —
  for background sync. Expect the answer to be no; confirm it, because if it is
  no then every server-to-phone message must be user-visible.
- **Payloads and presentation.** Payload size ceiling, image/badge support,
  action buttons, whether tapping can deep-link into a specific route, and app
  badge count support on iOS.
- **Local development.** How to test push against an iOS device when the server
  is on a home network — what the shortest honest feedback loop is.

## What resolving this looks like

A plain statement of what is possible, what is not, and which constraints
propagate to other tickets — especially any origin-stability requirement, since
the hosting ticket has to satisfy it.

Park the detail on a `research` node parented to this ticket.
