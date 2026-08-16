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

## Acceptance criteria — verified

Verified on macOS arm64, Bun 1.3.14, over plain HTTP on `localhost`, on branch
`feat/walking-skeleton` (7 commits, `28e3efe`…`f47e6f4`).

- [x] Bun 1.3.14 pinned exactly; `bun install` reproducible
- [x] Hono serves over `hono/bun`; one SQLite connection with WAL and `busy_timeout = 5000`
- [x] Drizzle configured `generate`-only with `strict: true`; one migration generated, read and committed, with its meta snapshot
- [x] `drizzle-kit` runs under a `bun --bun` prefix
- [x] Vite + React + TanStack Router build the client; `vite-plugin-pwa` in `injectManifest` mode
- [x] Manifest declares a non-default `display` and a real icon
- [x] Service worker registered at `/`, `sw.js` served `no-cache`, `registerType: 'autoUpdate'` with `clientsClaim` and `skipWaiting`
- [x] Vitest runs under Bun and can open `bun:sqlite` in a test
- [x] Biome and TypeScript `strict` pass

## Acceptance criteria — NOT VERIFIED, need the deployment box

The build session ran on macOS arm64 with no Tailscale CLI, no systemd and no iPhone. The
artifacts for all four are written and committed — `deploy/gloom-watch.service`,
`server/jobs/register-cron.ts`, `server/jobs/heartbeat.ts` — and `docs/deploy.md` is the
runbook naming which step verifies which criterion. **None of them has been executed.**

- [ ] Tailscale Serve fronts the app with a valid certificate; **the site loads on the iPhone over HTTPS**
- [ ] HTTP server runs under `systemd` with `Restart=always`, `RestartSec=10`
- [ ] A `Bun.cron` OS-level job is registered and survives a reboot, proving the three-argument form works on this box
- [ ] **Demo: add to Home Screen, open, and see a value that came from SQLite**

Partial evidence that carries over: `Bun.cron` exists in 1.3.14 with arity 3, matching the
OS-level `(path, schedule, title)` form; and the heartbeat module's `scheduled()` handler is
tested, writing through its own connection and read back through a second one. What is
unproven is registration, crontab persistence and reboot survival.

## Build notes

**The schema is one table, `app_state`** — a key/value store of server-owned scalars
(`installed_at`, `timezone`, `last_heartbeat_at`). Deliberately not named `settings`: the
spec's settings surface is a set of owner-editable tunables, and folding a job heartbeat into
that table would confuse configuration with health as soon as either grows. Cards, variants,
copies, listings and aliases are untouched — they belong to their own tickets.

**Paths resolve against the repository root, not the working directory.** The HTTP server
runs under a systemd `WorkingDirectory`; an OS-level cron job gets whatever cron chose.
Resolving from cwd would let the two open different database files with neither reporting an
error.

**The database is at `data/gloom-watch.db`**, overridable by `GLOOM_WATCH_DB`. `.gitignore`
already excludes `data/`, and this repository is public.

Not pushed. No pull request opened. Publishing is the owner's call.
