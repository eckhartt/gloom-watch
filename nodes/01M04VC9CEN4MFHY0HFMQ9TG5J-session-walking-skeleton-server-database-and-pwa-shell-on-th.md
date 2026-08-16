---
id: 01M04VC9CEN4MFHY0HFMQ9TG5J
type: session
title: "session: Walking skeleton — server, database and PWA shell on the phone"
status: closed
parent: 01M04PM855DTPPT8EY05664CC5
---
## What changed

**The walking skeleton (`01m04pm855`) is done and commissioned.** All 13 acceptance criteria
verified, ticket bound to `feat/walking-skeleton`, merged and pushed to `main` at
`https://github.com/eckhartt/gloom-watch` (public, created this session).

Nine commits: the stack, then a tenth correcting the runbook against what the real box did.

**The deployment box exists and is live.** `htpc` — Ubuntu 22.04.2, Intel N95, always-on
(146 days uptime before this session's reboot), reachable as `nicholas@100.65.249.74`. The app
runs at `/opt/gloom-watch` as the system account `gloom`, fronted by Tailscale Serve at
**`https://htpc.tail594f35.ts.net`**, which is now the PWA's permanent origin. Installed to the
owner's iPhone Home Screen in web-app mode.

The box was upgraded (143 of 153 pending packages; Docker held back deliberately) and rebooted
onto kernel `5.15.0-1108-intel-iotg` from `1098`. Everything came back.

## Decisions made

**Tailscale issue 19147 did not reproduce, and the risk is retired.** The hosting decision
(`01m03xa8ys`) accepted it on paper with a fallback of switching ingress and reinstalling the
PWA. An iPhone 15 Pro loaded the Serve endpoint over HTTPS and installed without incident. One
box, one handset — the pre-install check stays in the runbook for any future origin, but this is
no longer a live threat to the design.

**The schema table is `app_state`, not `settings`.** The spec's settings surface is
owner-editable tunables; this table also holds a job heartbeat, which is health. Naming it
`settings` would have forced the later settings ticket to inherit a health column or rename.
Reviewed and kept.

**The branch was moved to the box as a git bundle, not by pushing.** Publishing was the owner's
call and was made separately, after commissioning. `origin` on the box points at GitHub but the
box was never the thing that published.

**Docker held at current versions during the upgrade.** `docker-compose-plugin` 2.40 → 5.4 is a
major jump affecting an unrelated media stack; one variable in play through a first boot on a
new kernel was enough. `apt-mark unhold` when someone wants it.

## Open questions

**The eBay production keyset still needs owner action, and now it is the critical path.**
`eBay client and forward scanner` (`01m04pmc04`) is takeable *today* and cannot finish without
it. A keyset is not live until the owner subscribes to **or opts out of** marketplace
account-deletion notifications; the design depends on **opting out**, because subscribing needs
a publicly reachable HTTPS endpoint and that would kill tailnet-only hosting. Nobody has done
this. It has external lead time.

**The cron process does not inherit systemd's `EnvironmentFile`.** Harmless today because every
path resolves from the repository root. The moment a scheduled job needs a secret —
`EBAY_CLIENT_ID` for the scanner, `VAPID_PRIVATE_KEY` for the digest sender — it must load that
file explicitly or fail silently. This is the sharpest trap in the codebase right now.

**The box sits at 98% disk**, 9.9G free of 376G, with 307G of unrelated media. Gloom Watch needs
2–3GB so this is not blocking, but SQLite wants headroom to checkpoint and `VACUUM INTO` needs
room for a full second copy of the database. Worth resolving before the backup ticket.

**`htpc.tail594f35.ts.net` is now load-bearing.** Renaming the machine or the tailnet kills the
Home Screen icon, the service worker registration, the notification permission and the push
subscription together. Cheap to recover at one user, but no longer free.

## Links

- Repository: https://github.com/eckhartt/gloom-watch — `main` at `bd5bee7`
- Origin: https://htpc.tail594f35.ts.net
- Runbook: `docs/deploy.md`, corrected against the real commissioning
- Frontier now open: `01m04pm8q4` Corpus ingest, `01m04pmc04` eBay client and forward scanner
