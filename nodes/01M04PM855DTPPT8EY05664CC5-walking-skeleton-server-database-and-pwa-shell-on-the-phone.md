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

- [ ] Bun 1.3.14 pinned exactly; `bun install` reproducible
- [ ] Hono serves over `hono/bun`; one SQLite connection with WAL and `busy_timeout = 5000`
- [ ] Drizzle configured `generate`-only with `strict: true`; one migration generated, read and committed, with its meta snapshot
- [ ] `drizzle-kit` runs under a `bun --bun` prefix
- [ ] Vite + React + TanStack Router build the client; `vite-plugin-pwa` in `injectManifest` mode
- [ ] Manifest declares a non-default `display` and a real icon
- [ ] Service worker registered at `/`, `sw.js` served `no-cache`, `registerType: 'autoUpdate'` with `clientsClaim` and `skipWaiting`
- [ ] Tailscale Serve fronts the app with a valid certificate; **the site loads on the iPhone over HTTPS**
- [ ] HTTP server runs under `systemd` with `Restart=always`, `RestartSec=10`
- [ ] A `Bun.cron` OS-level job is registered and survives a reboot, proving the three-argument form works on this box
- [ ] Vitest runs under Bun and can open `bun:sqlite` in a test
- [ ] Biome and TypeScript `strict` pass
- [ ] **Demo: add to Home Screen, open, and see a value that came from SQLite**
