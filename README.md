# Gloom Watch

A self-hosted, single-user PWA that tracks a **masterset** of the Pokémon Oddish
evolutionary line — Oddish, Gloom, Vileplume and Bellossom — records which copies
are owned, and pushes a notification to the owner's iPhone when a matching eBay
listing appears.

It runs on one machine on a private [Tailscale](https://tailscale.com) network and
is not reachable from the public internet. The tailnet is the security perimeter;
there is no login screen.

## What it does

- **The masterset** — every card of the line that [TCGdex](https://tcgdex.dev)
  carries, in every language and every printing variant, is a member. The binder
  view renders them all as a grid, and the completion percentage is the fraction
  of that grid the owner holds.
- **Copies** — an owned card is a *copy* of a variant, with its condition, what it
  cost and where it came from. One variant can have many copies.
- **The scanner** — polls the eBay Browse API for newly listed items, resolves each
  listing to a card or a specific variant, and notifies the phone when it matches
  something not yet owned.
- **The confirm queue** — a listing the matcher cannot resolve confidently waits for
  the owner to rule on it. Their ruling becomes an *alias*, so the next listing
  phrased the same way resolves on its own.

## Stack

Bun · Hono · SQLite (`bun:sqlite`) · Drizzle · React · TanStack Router and Query ·
Vite with `vite-plugin-pwa` · Vitest · Biome

## The plan lives in the repository

Every decision behind this project — what was chosen, what was rejected and why —
is recorded as a context graph on the **`orchestrator`** branch, read through the
[`ork`](https://github.com/eckhartt/ork) CLI:

```sh
ork ls                              # the roots
ork show 01M04P3SX --body           # the build-ready spec
ork frontier 01M04PFVGG             # build tickets takeable right now
```

The spec is the build document. It specifies **invariants, not DDL** — the schema
and the route shapes are the implementer's to write; the constraints are not.

## Running it

Bun is pinned to **1.3.14 exactly**; `bun install` refuses to run under any other version.

```sh
curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"

bun ci                # install exactly what bun.lock says
bun run build         # build the client into dist/client
bun run start         # serve the API and the client on http://127.0.0.1:3000

bun run verify        # Bun version, Biome, TypeScript strict, Vitest
```

`bun run dev` starts Vite on 5173 proxying `/api` to a `bun run dev:server` on 3000. The
service worker is only registered against the built app, so exercise it through
`bun run build && bun run start`.

Deploying to the always-on box — Tailscale Serve, systemd and the OS-level cron jobs — is
[`docs/deploy.md`](docs/deploy.md).

## Status

Pre-alpha. The spec is frozen and the build queue is published. The walking skeleton's
software stack is built and tested; it has **not** yet been commissioned on the deployment
box, so Tailscale Serve, systemd supervision, the `Bun.cron` registration and the Home
Screen install are all still unproven.

## Licence

Card data comes from TCGdex under the MIT licence. This repository carries no card
images; they are fetched at ingest time.
