---
id: 01M03X9YKKE3QR17H70HBXAEX2
type: decision
title: What is the current Bun + SQLite + PWA toolchain?
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA8CW3DB9JC43TCTEPR8X
    type: blocks
meta:
  ticket: research
  hitl: no
  claimed: wayfinder-charting
---
## Resolution

**Not Bun. Node 24 LTS.** The research was run as empirical probes on both
runtimes, not from reputation, and the finding that decides it is about release
engineering rather than benchmarks.

Bun's last stable is **1.3.14 (13 May 2026)** and nothing has shipped since,
because the team ported ~530k lines from Zig to Rust and moved development to an
unreleased 1.4 line. The choice today is a frozen three-month-old stable with
open unexplained-memory-growth reports **on idle servers**, or a canary of a
from-scratch runtime rewrite that is surfacing regressions provably absent from
1.3.14. Neither suits a scanner running unattended for weeks on a home machine,
where the failure mode is "I stopped getting alerts three weeks ago and did not
notice".

Two Bun findings bear directly on this app specifically:

- On **macOS**, `bun:sqlite` links Apple's system SQLite — measured **3.43.2**,
  no `jsonb`, no ordered aggregates — while Linux gets 3.53.0. A confirmed bug
  (oven-sh/bun#31247, dup of #16717). One reporter hit **FTS5 corruption on
  UPDATE/DELETE in 3.43.2** and had to fall back to FTS4. A card-search app over
  card names is very likely to want FTS5, and the owner's stated deployment is
  "home server **or** Mac" — so this is squarely in the path.
- `better-sqlite3` is **refused by name** under Bun, and `node:sqlite` is absent
  from any shipped Bun build. Choosing Bun means `bun:sqlite` is the only driver,
  with no fallback.

## The recommended stack

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | **Node 24 LTS** | Patched to Apr 2028; the target every library below is tested against |
| HTTP | **Hono** | Runtime-agnostic, ~38M weekly downloads; `serveStatic` covers PWA assets |
| SQLite | **better-sqlite3 13.x** | Bundles its own SQLite (3.53.2) so dev and prod match; real incremental `backup()` |
| Migrations | **Drizzle, `generate` only** | Auto-generates SQLite's 12-step table rebuilds — the churn argument |
| Frontend | **Vite 8** | `vite-plugin-pwa` 1.3.0 widened peers to `^8.0.0` in May 2026 |
| PWA | **`vite-plugin-pwa`, `injectManifest`** | Web Push needs custom `push`/`notificationclick` handlers; `generateSW` cannot host them |
| Web Push | **`web-push` 3.6.7** | Tested byte-identical on both runtimes |
| Scheduler | **`croner` 10.x** + OS supervisor | In-process timers never survive restarts on their own |
| Repo | **Single package**, `client/` + `server/` | A workspace buys a solo developer nothing and costs hoisting surprises |
| Test/lint | **Vitest + `strict` + Biome** | Reuses the Vite config — one toolchain, not two |

## The Web Push risk was a myth — worth recording

The ticket flagged `web-push` under Bun as a known-risky area. It was tested
directly rather than reasoned about: VAPID key generation plus the full
`aes128gcm` encryption path produced **byte-identical output on Node and Bun**.
The `crypto.createECDH is not a function` folklore is a **Cloudflare Workers /
edge-runtime** problem — those runtimes have no `node:crypto` — not a Node or
Bun one. P-256, the only curve Web Push uses, is present in Bun's BoringSSL.

So Web Push is not an argument against Bun, and this should not be re-raised as
one.

## What choosing Node gives up

Real losses, stated honestly: `Bun.serve`'s HTML-import bundling (the best
single-process full-stack DX of the three), **`Bun.cron`'s OS-level jobs that
survive reboots** — genuinely better than anything in the Node ecosystem and the
most attractive Bun-only feature for this project — `bun install` speed, and
one-binary `bun build --compile` deploys.

## Keeping the decision cheap to reverse

Hono, `croner`, `web-push`, Drizzle and Vite all run on both runtimes, so this
stays a `package.json` change plus a driver swap **provided nobody reaches for
runtime-specific APIs**: no Elysia, no `Bun.serve` route objects, no `bun:sqlite`
import. That constraint should carry into the spec.

**Revisit when** Bun 1.4.x has been stable — not canary — for a couple of months
and oven-sh/bun#16717 (the macOS SQLite version bug) is closed.

## What is genuinely close, and left for the stack-lock decision

- **Drizzle vs Kysely.** Drizzle generates SQLite's awkward table rebuilds for
  you (churn velocity); Kysely + `kysely-ctl` means hand-written TypeScript
  migrations where every statement is one you reviewed. This is where the
  owner's opinion actually matters.
- **`better-sqlite3` vs `node:sqlite`.** The latter is the obvious successor but
  is still Stability 1.2 (release candidate). Revisit in a year.

Everything else above is **not** close and should not be re-litigated in the
stack-lock session.

Full survey with citations and probe output: see the child research node.
