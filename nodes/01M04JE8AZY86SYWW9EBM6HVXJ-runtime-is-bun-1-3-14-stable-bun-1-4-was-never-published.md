---
id: 01M04JE8AZY86SYWW9EBM6HVXJ
type: decision
title: Runtime is Bun 1.3.14 stable — Bun 1.4 was never published
status: ruled
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA8CW3DB9JC43TCTEPR8X
    type: supersedes
---
## Resolution

**The runtime is Bun 1.3.14 stable, pinned.** This supersedes the runtime row of
*Lock the stack* (`01m03xa8cw`), which specified "Bun 1.4 canary, pinned to an exact
build".

**Everything else in `01m03xa8cw` stands unchanged** — Hono via `hono/bun`,
`bun:sqlite`, Drizzle `generate`-only, `Bun.cron`, React + Vite + TanStack,
`vite-plugin-pwa` `injectManifest`, `web-push`, Vitest, Biome, single package.

## Why the earlier decision could not be executed

**Bun 1.4 was never published, in any channel.** Verified directly:

```
$ npm view bun dist-tags
{ latest: '1.3.14', canary: '1.3.13-canary.20260425.1' }
```

The published version list ends at **1.3.14 (13 May 2026)**. The `canary` tag points
at `1.3.13-canary.20260425.1` and is **behind** stable, not ahead of it.

You cannot pin an exact build of a version that does not exist, so the instruction in
`01m03xa8cw` had no referent.

**The supporting evidence could not be reached either.** That ticket overruled the
Node recommendation on two claims — a Zig-to-Rust rewrite, and a Prisma production
benchmark showing 1.3.14 crossing 900 MiB and being OOM-killed while the canary stayed
flat at ~118 MiB. A fact-check found **no primary source for either**. They are not
disproven; they are unverified, and they were load-bearing.

**Recorded plainly: this was an error in research this map produced, not a change of
mind.** The owner chose Bun on evidence that has not held up.

## Why 1.3.14 is the right answer rather than a retreat to Node

**Everything the design depends on is already in stable:**

- **`Bun.cron` OS-level jobs shipped in 1.3.11** (18 Mar 2026)
- **`Bun.cron` in-process scheduling shipped in 1.3.12** (9 Apr 2026)

Both predate 1.3.14. The single most attractive Bun-only feature for this project —
reboot-surviving scheduled jobs — is available without touching a canary.

**The memory-growth concern is largely defused by the architecture already chosen.**
The worry was unbounded growth in a long-lived process. But the scanner is an
**OS-level cron job**: it starts, scans, exits. It is not long-lived. The only
long-lived process is the HTTP server, which already runs under
`systemd Restart=always`. The exposure is far smaller than the original framing
assumed.

**This removes an accepted risk.** `01m03xa8cw` carried "Bun 1.4 is canary and
officially not recommended for production" as a standing risk with mitigations. That
risk is now simply gone.

## Consequences for the spec

- The stack table names **Bun 1.3.14**, pinned exactly.
- The "Bun 1.4 canary" entry under accepted risks is **deleted**, not softened.
- The retreat-to-Node path stays cheap and stays worth preserving: add no further
  Bun-specific APIs beyond `bun:sqlite` and `Bun.cron`.

## Two facts confirmed while resolving this

**`Bun.cron` genuinely registers an OS-level job.** Two independent reviewers claimed
it was in-process only and could not survive a reboot. **They were wrong** — they read
one of its two call forms.

| Form | Survives process exit / reboot |
| --- | --- |
| `Bun.cron(schedule, handler)` | No |
| `await Bun.cron(path, schedule, title)` | **Yes** |

The three-argument form writes a real crontab entry on Linux (`launchd` plist on
macOS, Task Scheduler on Windows); `Bun.cron.remove(title)` reverses it; re-registering
the same title overwrites in place. **The supervision split in `01m03xa8cw` and
`01m03xa8ys` is correct and stands.**

Two consequences to carry into the build:

1. The scanner **must be a separate module file** default-exporting
   `{ scheduled(controller) }`. It cannot be a closure inside the HTTP server.
2. Because it is genuinely a separate process, **"one connection" means one connection
   per process.** The rationale in `01m03xa8cw` — "JavaScript is single-threaded, so
   writes serialise for free" — does not hold across process boundaries. WAL plus
   `busy_timeout = 5000` is the real concurrency story, including the daily
   `VACUUM INTO` running against a live writer.

## Alternatives weighed and rejected

- **Node 24 LTS** — the original research recommendation, still entirely defensible.
  Rejected because it costs `Bun.cron`'s reboot-surviving jobs and `bun:sqlite` for no
  gain now that the canary risk has evaporated.
- **Waiting for the release train to move** — the canary tag has not advanced since
  25 April and stable not since 13 May. An open-ended hold on a project that is ready
  to build.
- **Bun 1.3.14 with the memory concern unmitigated** — rejected as a framing rather
  than an option: the cron-process architecture already mitigates it.
