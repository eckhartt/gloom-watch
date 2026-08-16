---
id: 01M045CGNAHNS9DAYXJZN0977T
type: session
title: "session: Lock the stack: runtime, storage, frontend, PWA build"
status: closed
parent: 01M03XA8CW3DB9JC43TCTEPR8X
---
# Session close-out

Interview session resolving `01m03xa8cw` — the stack. Four rounds, two of them
triggered by the owner challenging an earlier conclusion. ACKed, frozen.

## What changed

- **`01m03xa8cw` is `ruled`.** Full stack table, guardrails, inherited platform
  constraints and rejected alternatives are in its body.
- **Two tickets unblocked:** `01m03xaamk` (ingest) is now takeable;
  `01m042kp8g` (backup) still waits on hosting.

## The decision

**Bun 1.4 canary** (pinned) · **Hono** via `hono/bun` · **`bun:sqlite`** (WAL,
one connection, **no FTS5**) · **Drizzle** `generate`-only · **`Bun.cron`**
OS-level jobs · **React + Vite + TanStack Router + TanStack Query** ·
**`vite-plugin-pwa` `injectManifest`** · **Vitest** · single package.

## This overrules `01m03x9ykk`, and why

The research recommended **Node 24 LTS** because Bun's stable was frozen at
1.3.14 with idle-server memory growth. **The owner challenged that and was
right.** Verified during the session:

- **Prisma ran the Rust rewrite in production** (Prisma Compute public beta, June
  2026). 1.3.14 crossed **900 MiB and was OOM-killed**; the Rust canary stayed
  **flat at ~118 MiB** across 4096 iterations, and its connection pool recovered
  after scale-to-zero where stable's did not.
- **Anthropic acquired Bun in Dec 2025**; Claude Code has shipped as a Bun
  executable since v2.1.113.

So the rewrite is not an unproven alternative to a working stable — it is the
thing that **fixes** the long-lived-process leak. **1.3.14 is now the worst
option of the three.** The research node remains an accurate record of what was
known then; this ticket is the decision.

## Three choices re-derived, not inherited

- **FTS5 dropped**, which dissolves the macOS SQLite trap entirely. At ~765
  variants a `LIKE` scan is microseconds — FTS5 solved a problem this project
  does not have. No `setCustomSQLite()`, no Homebrew dependency.
- **Vite builds the client**, because Web Push needs custom `push` handlers in
  the service worker and `generateSW` cannot host them. Cost: `Bun.serve`'s
  HTML-import bundling is unused.
- **Hono over Elysia.** Once Vite owned the client build, the Bun-native posture
  bought nothing Hono removes — `Bun.cron`, `bun:sqlite`, `bun install` and
  `bun build --compile` are kept either way. On a canary runtime, a nearly-free
  retreat path is worth taking.

**Prisma was seriously considered** (Rust-free in v7, runs on Bun) and lost on
stack coherence: on Bun it requires `@prisma/adapter-libsql`, introducing a
second SQLite implementation. Prisma Migrate is the stronger migration tool and
that was the real cost.

## Constraints carried to other tickets

- **`01m042kp8g` (backup):** `bun:sqlite` has **no `backup()`** — only
  `.serialize()`, which loads the whole DB into memory. Use **`VACUUM INTO`**,
  verified working (118 KB in 1 ms).
- **`01m03xaamk` (ingest):** no `jsonb` on macOS (SQLite 3.43.2) and no ordered
  aggregates; `->>` works. Use text JSON functions, never `jsonb`.
- **Service worker:** `injectManifest` + `autoUpdate` + `clientsClaim` +
  `skipWaiting` + periodic `registration.update()` on `visibilitychange` +
  `Cache-Control: no-cache` on `sw.js`, or a cached SW pins the phone to old code.

## Standing risk

**Bun 1.4 is canary and officially not production-recommended.** Prisma's
evidence is one company's workload. Mitigations chosen: pin an exact build,
frequent `VACUUM INTO` backups, and **add no further Bun-specific APIs** — retreat
to Node is a `package.json` change plus `bun:sqlite`→`better-sqlite3` and
`Bun.cron`→`croner`. Choosing Hono was the point.

## Open questions

Frontier is two:

- **`01m03xa8ys` — hosting and origin** (`hitl=yes`). Must fix a **permanent**
  origin: hostname, port, scheme and service-worker scope can never change after
  first install without killing the icon, subscription and permission together.
  Must include the **Tailscale push test**. Note `Bun.cron` registers OS-level
  jobs, so the supervision story changes shape — the OS runs the scanner, not a
  supervisor keeping a process alive.
- **`01m03xaamk` — corpus ingest and images.** Newly unblocked. Carries the
  `stamp` canonicalisation requirement, the manual-row survival constraint, and
  the `jsonb` restriction above.

Then `01m042kp8g` (backup) unblocks and the map is decided.

## Links

- Commits: `orchestrator` branch — `01m03xa8cw`
- PR: none
