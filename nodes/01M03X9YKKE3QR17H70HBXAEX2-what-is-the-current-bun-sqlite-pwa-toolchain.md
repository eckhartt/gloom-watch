---
id: 01M03X9YKKE3QR17H70HBXAEX2
type: decision
title: What is the current Bun + SQLite + PWA toolchain?
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
meta:
  ticket: research
  hitl: no
---
## The question

What is the current, credible toolchain for a Bun server with SQLite serving an
installable PWA — and is Bun the right runtime for a long-running scanner on a
home machine?

The owner proposed Bun with a question mark. Treat it as a proposal to test, not
a settled choice.

## What to find out

- **Bun's fitness for a long-lived process.** Stability of a Bun process running
  for weeks, memory behaviour, crash/restart story, and how it behaves under a
  process supervisor. Any known issues with timers or scheduled work over long
  uptimes.
- **`bun:sqlite`.** Maturity relative to `better-sqlite3`. WAL mode, concurrent
  read/write from a scanner and a request handler in one process, backup story,
  and whether it is a good target for query builders and migration tools.
- **ORM / query layer.** Drizzle vs Kysely vs raw SQL for this shape of schema —
  which have first-class Bun and SQLite support today, and which have a
  migration story that survives schema churn. The card/variant schema will churn.
- **HTTP layer.** `Bun.serve` bare, Hono, Elysia — current state, and which is
  actually a good fit for a small self-hosted app that also serves static PWA
  assets. Note Web Push library support, since that is a specific need.
- **Web Push from Bun.** Whether `web-push` or an equivalent works under Bun, or
  whether the VAPID/encryption path needs Node compatibility shims.
- **Frontend and PWA build.** What produces a well-behaved installable PWA today
  — Vite plus a PWA plugin, or something else. Service worker generation,
  manifest, icon requirements for iOS specifically, and update/versioning
  behaviour so a stale service worker does not strand the phone on old code.
- **Repo shape.** Single package serving both, or separate client and server
  packages in a workspace. What Bun's workspace support does well and badly.
- **The honest alternative.** If Node with the same libraries is materially less
  risky for an always-on personal service, say so. This ticket is allowed to
  conclude "not Bun".

## What resolving this looks like

A concrete recommended stack — runtime, HTTP layer, SQLite access, migrations,
frontend, PWA build — with the reasoning, and any part where the choice is
genuinely close so the stack-lock decision can weigh it.

Park the detail on a `research` node parented to this ticket.
