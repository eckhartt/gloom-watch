---
id: 01M04PM855DTPPT8EY05664CC5
type: feature
title: Walking skeleton — server, database and PWA shell on the phone
status: active
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
  - to: 01M04PM8Q4KPP697RV6CBK7XQQ
    type: blocks
  - to: 01M04PMC04HN86FCJBYA2XW8D0
    type: blocks
meta:
  ticket: build
  claimed: skeleton-agent
---
## What to build

The thinnest complete path through every layer, ending on the owner's phone: a Home Screen
web app that renders data the server read out of SQLite.

This is the ticket where the whole stack is stood up and proved together — runtime, HTTP
server, database, migrations, client build, service worker, ingress and supervision. It
looks large because it is one integration, not because it is many features.

Pin **Bun 1.3.14** exactly. The manifest must declare a **non-default `display`** value, or
iOS refuses the Notification constructor later. Register the service worker at `/` and never
move its scope. Serve `sw.js` with `Cache-Control: no-cache`, or a cached worker pins the
phone to old code permanently.

## Acceptance criteria

- [x] Bun 1.3.14 pinned exactly; `bun install` reproducible
- [x] Hono serves over `hono/bun`; one SQLite connection with WAL and `busy_timeout = 5000`
- [x] Drizzle configured `generate`-only with `strict: true`; one migration generated, read and committed, with its meta snapshot
- [x] `drizzle-kit` runs under a `bun --bun` prefix
- [x] Vite + React + TanStack Router build the client; `vite-plugin-pwa` in `injectManifest` mode
- [x] Manifest declares a non-default `display` and a real icon
- [x] Service worker registered at `/`, `sw.js` served `no-cache`, `registerType: 'autoUpdate'` with `clientsClaim` and `skipWaiting`
- [x] Tailscale Serve fronts the app with a valid certificate; **the site loads on the iPhone over HTTPS**
- [x] HTTP server runs under `systemd` with `Restart=always`, `RestartSec=10`
- [x] A `Bun.cron` OS-level job is registered and survives a reboot, proving the three-argument form works on this box
- [x] Vitest runs under Bun and can open `bun:sqlite` in a test
- [x] Biome and TypeScript `strict` pass
- [x] **Demo: add to Home Screen, open, and see a value that came from SQLite**

## Commissioning record

Built on a macOS development machine, then commissioned on the target box on **2026-08-16**.

**The box.** `htpc`, Ubuntu 22.04.2 LTS, Intel N95, x86_64. Origin
`https://htpc.tail594f35.ts.net`. Application at `/opt/gloom-watch`, running as the system
account `gloom`. Environment file at `/etc/gloom-watch/gloom-watch.env`, root-owned, mode 0600.

**Supervision proved, not asserted.**

- `SIGKILL` to the server: `Main process exited, code=killed, status=9/KILL` → restart counter
  0 → 1 → serving again.
- The `Bun.cron` three-argument form writes a real entry to `/var/spool/cron/crontabs/gloom`
  with absolute paths, which is what makes it independent of whatever cwd cron chooses.
- Reboot onto a kernel ten revisions newer than the running one: every service came back
  enabled, and `lastHeartbeatAt` advanced at the next ten-minute slot — a *new* timestamp after
  boot, which is the honest proof rather than the crontab file merely still existing.

**Two processes, one database.** The cron job runs outside systemd and writes the heartbeat;
the HTTP server reads it back. They agree because every relative path resolves against the
repository root rather than the working directory.

**tailscale#19147 did not reproduce.** The accepted risk carried since `01m03xa8ys` — an iPhone
unable to establish a secure connection to a Serve `*.ts.net` endpoint — did not occur. An
iPhone 15 Pro loaded the origin over HTTPS and installed to the Home Screen, full screen with no
Safari chrome, confirming the web-app mode that the Push API depends on. One box and one
handset, so the pre-install check stays in the runbook for any future origin.

Tailscale Serve also passes `Cache-Control: no-cache` through untouched on `sw.js`. A proxy
that rewrote it would have pinned the phone to stale worker code with no server-side recovery.

## Notes for the reviewer

**The schema is one table, `app_state`** — key/value, holding `installed_at`, `timezone` and
`last_heartbeat_at`. Deliberately not named `settings`: the spec's settings surface is a set of
owner-editable tunables, and this table also carries a job heartbeat, which is health rather
than configuration. Naming it `settings` now would force the later settings ticket to inherit a
health column or perform a rename.

**The trap for the next session:** the cron process gets a minimal environment and does **not**
inherit systemd's `EnvironmentFile`. Harmless today because every path resolves from the
repository root, but any later job needing a secret — the scanner wants `EBAY_CLIENT_ID`, the
digest sender wants `VAPID_PRIVATE_KEY` — must load that file explicitly or fail silently.

**Re-registering cron is not optional after a schedule change.** Editing `scan_interval_minutes`
or `digest_times` without re-running `bun run cron:register` leaves the stored value and the
running job disagreeing, with nothing to signal it.

**Drizzle's own documentation is wrong for this stack.** It points at
`drizzle-orm/better-sqlite3/migrator`; with `bun:sqlite` the correct import is
`drizzle-orm/bun-sqlite/migrator`, and following the docs would pull in the dependency the
`bun --bun` guardrail exists to avoid.

**`bun upgrade --to <version>` does not exist.** Pinned installs go through
`curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"`.

`bun run verify` runs the version check, Biome, `tsc -b` and Vitest. 22 tests across 4 files.
