---
id: 01M03XA8CW3DB9JC43TCTEPR8X
type: decision
title: "Lock the stack: runtime, storage, frontend, PWA build"
status: proposed
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
## The question

Lock the stack: runtime, HTTP layer, SQLite access, migrations, frontend, PWA
build, and repository shape.

The toolchain research will have produced a recommendation. This ticket is where
the owner accepts it, amends it, or overrules it — and where the answer is
frozen so no later session re-opens it.

## What to decide

- **Runtime.** Bun or Node. The owner proposed Bun with a question mark; the
  research may have argued either way. Weigh developer pleasure against the risk
  of a process that has to stay up for weeks on a home machine.
- **HTTP layer.** Bare `Bun.serve`, Hono, Elysia, or otherwise. It has to serve
  the PWA's static assets as well as the API.
- **SQLite access and migrations.** Driver, query layer, and the migration tool.
  The card and variant schema will churn as the masterset boundary is refined,
  so a migration story that tolerates churn matters more than raw ergonomics.
- **Frontend.** Framework and build tool, and whether the UI is a client-side
  app talking to a JSON API or something server-rendered with islands.
- **PWA build.** How the service worker and manifest are produced, and how a new
  deploy reliably replaces a stale service worker on a phone that may not have
  opened the app in weeks.
- **Repo shape.** Single package or a workspace with separate client and server.
- **Testing and lint.** What the baseline is, so tickets cut from the spec do
  not each invent their own.

## Why it matters

Every build ticket cut from the spec inherits this. Leaving it half-decided
means each ticket re-litigates it, and the codebase ends up with two of
everything.

## How to resolve

Present the research recommendation to the owner with the genuinely close calls
flagged as such, and take their ruling. Do not present choices that are not
actually close — that wastes the conversation.

Resolve into a named stack, one line of reasoning per component, and an explicit
note of anything deliberately deferred.
