---
id: 01M03XA8CW3DB9JC43TCTEPR8X
type: decision
title: "Lock the stack: runtime, storage, frontend, PWA build"
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XAAMK96EN2TFBHEYGABXQ
    type: blocks
  - to: 01M042KP8G0DGKBTRHKXEMCHAY
    type: blocks
meta:
  ticket: grilling
  hitl: yes
---
## Resolution

| Layer | Choice |
| --- | --- |
| **Runtime** | **Bun 1.4 canary**, pinned to an exact build |
| **HTTP** | **Hono** via `hono/bun` |
| **SQLite** | **`bun:sqlite`** — WAL, `busy_timeout = 5000`, **one connection**, **no FTS5** |
| **ORM / migrations** | **Drizzle**, `generate` only |
| **Scheduler** | **`Bun.cron`** OS-level jobs |
| **Frontend** | **React + Vite + TanStack Router + TanStack Query** |
| **PWA build** | **`vite-plugin-pwa`, `injectManifest` mode** |
| **Push** | `web-push` — verified byte-identical on Bun and Node |
| **Tests** | **Vitest** |
| **Lint** | TypeScript `strict` + Biome |
| **Repo** | Single package — `client/`, `server/`, `shared/` |

## This overrules the research recommendation on runtime

`01m03x9ykk` recommended **Node 24 LTS**, on the grounds that Bun's stable was
frozen at 1.3.14 with open memory-growth reports on idle servers. **That framing
was incomplete and was corrected during this interview.**

Evidence that changed the answer:

- **Prisma ran the Rust rewrite in production** for Prisma Compute's public beta
  (June 2026). On 1.3.14 stable their test crossed **900 MiB and the container
  was OOM-killed**; on the Rust canary the same 4096-iteration run **stayed flat
  at ~118 MiB**. Their connection pool also recovered after scale-to-zero, where
  stable counted dead connections as live.
- **Anthropic acquired Bun in December 2025**, and Claude Code has shipped as a
  Bun executable since v2.1.113.

So the rewrite is not an unproven alternative to a working stable — it is
specifically the thing that **fixes the long-lived-process leak** that made Node
look safer. **Bun 1.3.14 is now the worst of the three options**, not the
conservative one.

The research node stands as an accurate record of what was known then; this
ticket is the decision.

## Three choices re-derived during the interview

### FTS5 is dropped, which dissolves the macOS trap

The strongest remaining anti-Bun argument was that on macOS `bun:sqlite` links
Apple's system SQLite (**3.43.2**, in both 1.3.14 and 1.4 canary) which carries an
**FTS5 corruption bug on UPDATE/DELETE**.

**At ~765 variants, FTS5 was never needed.** A `LIKE` scan over that corpus is
microseconds. Dropping it removes the entire reason macOS mattered — no
`setCustomSQLite()`, no Homebrew dependency on every dev machine.

### Vite builds the client, so `Bun.serve`'s HTML import is not used

Web Push requires **custom `push` and `notificationclick` handlers inside the
service worker**, and Workbox's `generateSW` cannot host them. `injectManifest`
lets us author `sw.ts` and have only the precache manifest injected — and Bun's
bundler has no equivalent plugin.

So Bun serves the Vite-built assets as static files. The HTML-import trick, the
nicest thing about `Bun.serve`, is unavailable to this project.

### Hono over Elysia, because "lean into Bun" collapsed

Once Vite owned the client build, the Bun-native posture bought almost nothing
Hono would take away:

| | Kept with Hono? |
| --- | --- |
| `Bun.serve` HTML-import bundling | already lost to Vite |
| **`Bun.cron` OS-level jobs** | **yes** |
| **`bun:sqlite`** | **yes** |
| `bun install`, `bun build --compile` | **yes** |
| Elysia's typed routes | the only casualty |

Hono runs on Bun today via `hono/bun` and on Node tomorrow. Given the runtime is
a **canary officially not recommended for production**, keeping the retreat cheap
has real value — and it is now nearly free. Hono RPC gives end-to-end types
comparable to Elysia's Eden.

## Why Bun.cron

`Bun.cron(path, schedule, title)` registers an **OS-level cron job** keyed by
title, running a module that exports `default { scheduled(controller) }`.

**It survives process restarts and reboots.** Nothing in the Node ecosystem
matches it, and this project's worst failure mode is precisely a scanner that
quietly stops after a restart and is not noticed for weeks.

`last_scanned_at` is still persisted in SQLite so a restart computes what it
missed rather than double-scanning or silently skipping.

## Why Drizzle over Prisma

Prisma was reconsidered mid-interview because it went **Rust-free in v7** and now
runs on Bun. Two things decided against it:

1. **On Bun, Prisma requires `@prisma/adapter-libsql`** — not `bun:sqlite` —
   because Bun cannot load the native driver `adapter-better-sqlite3` needs. That
   introduces **libSQL, a second SQLite implementation**, into a stack that
   already has one.
2. It adds a separate `.prisma` schema DSL and a codegen step, against Drizzle's
   TypeScript-native schema and no codegen.

Prisma Migrate is genuinely the stronger migration tool — migration history,
drift detection, shadow-database verification — and that was the real cost of
this decision. Drizzle wins on stack coherence, not on migration tooling.

Kysely was rejected earlier for requiring every SQLite 12-step table rebuild to
be hand-written, against a schema that will churn hard.

## Non-negotiable guardrails

- **`drizzle-kit generate`, never `drizzle-kit push`** outside a throwaway dev
  database — `push` applies diffs directly and is destructive.
- **`strict: true`** so drizzle-kit refuses destructive migrations.
- **Read every generated `.sql` before committing.** SQLite table rebuilds are
  where data silently vanishes.
- **Commit the `drizzle/meta` snapshots** — they are the diff baseline, and
  losing them corrupts future generation.
- **`drizzle-kit` needs a `bun --bun` prefix**, or it looks for `better-sqlite3`
  and fails.
- **One SQLite connection.** `bun:sqlite` is synchronous and JavaScript is
  single-threaded, so writes serialise for free; a second connection only buys
  `SQLITE_BUSY` handling nobody needs.

## Constraints inherited from the platform

- **`bun:sqlite` has no `backup()`** — only `.serialize()`, which materialises the
  whole database in memory. **Backups use `VACUUM INTO`**, verified working
  (118 KB in 1 ms) and the correct online primitive for a live WAL database.
  Carried to `01m042kp8g`.
- **No `jsonb` on macOS** (system SQLite 3.43.2), and no `ORDER BY` inside
  aggregates. `->>` works (3.38+). If the schema wants JSON, use the text
  functions, never `jsonb`.
- **`vite-plugin-pwa` must run in `injectManifest` mode**, with
  `registerType: 'autoUpdate'`, `clientsClaim`, `skipWaiting`, a periodic
  `registration.update()` on `visibilitychange`, and `Cache-Control: no-cache`
  on `sw.js` itself — otherwise a cached service worker pins the phone to old
  code permanently.

## The standing risk

**Bun 1.4 is canary and officially not recommended for production.** Prisma's
evidence is real but it is one company's workload.

Mitigations, all chosen deliberately:

- **Pin an exact canary build.** Floating on `canary` means a runtime that
  changes nightly.
- **Frequent `VACUUM INTO` backups.**
- **Retreat stays cheap:** Hono, Drizzle, Vite, TanStack and `web-push` all run
  on Node. Falling back costs a `package.json` change plus swapping
  `bun:sqlite` → `better-sqlite3` and `Bun.cron` → `croner` + a supervisor. **Do
  not add further Bun-specific APIs** — that is the whole point of choosing Hono.

## Alternatives weighed and rejected

- **Node 24 LTS** — the research's recommendation, and still entirely defensible.
  Lost to the Prisma production evidence plus `Bun.cron`'s reboot-surviving jobs.
- **Bun 1.3.14 stable** — the version Prisma measured leaking and being
  OOM-killed, and frozen, so it will never be fixed.
- **Elysia** — best DX on Bun, but welds the HTTP layer to a canary runtime.
- **Bare `Bun.serve`** — fewest dependencies, rebuilds routing and static
  serving by hand.
- **Prisma v7 + libSQL** — stronger migrations, second SQLite implementation.
- **Kysely** — every table rebuild hand-written.
- **`node:sqlite` under Bun** — unverified against the canary; absent from 1.3.10
  despite docs describing `main`.
- **React Router framework mode** — SSR-leaning, fights the precached SPA shell.
- **Server-rendered islands (Hono JSX + htmx)** — makes offline browsing hard.
- **Svelte / Solid** — smaller bundles, thinner ecosystems for virtualised image
  grids.
- **`bun test`** — 2–3× faster, but a live 1.4 regression leaks mocked-clock state
  across test files (`bun#32793`, reproduces on `1.4.0-canary.1`, not on 1.3.14),
  and the scanner's cursor logic is exactly what gets tested with a mocked clock.
- **Bun bundler + hand-rolled service worker** — owns cache versioning and the
  stale-SW trap manually.
