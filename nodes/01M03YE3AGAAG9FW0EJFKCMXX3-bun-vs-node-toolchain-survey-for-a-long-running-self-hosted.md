---
id: 01M03YE3AGAAG9FW0EJFKCMXX3
type: research
title: Bun vs Node toolchain survey for a long-running self-hosted PWA server
status: done
parent: 01M03X9YKKE3QR17H70HBXAEX2
---
*Research date: 16 August 2026. Empirical probes were run in a scratchpad directory, not in the repo. Locally installed runtimes were Bun 1.3.10 and Node 20.20.2; where a result depends on the Bun version, that is called out explicitly.*

---

## 1. Bun's fitness for a long-lived process

**The decisive finding is about release engineering, not benchmarks.**

Bun's published release history stops dead:

| Version | Released |
|---|---|
| bun-v1.3.14 | 2026-05-13 |
| bun-v1.3.13 | 2026-04-20 |
| bun-v1.3.12 | 2026-04-10 |
| bun-v1.3.11 | 2026-03-18 |

The npm `canary` dist-tag is `1.3.13-canary.20260425.1` — canaries had been publishing *daily* and stopped on 25 April 2026.

Meanwhile the repository is extremely active: commits landed on 15 August 2026, the day before this research. So the project is not abandoned — it has forked its own timeline. The explanation is in the repo itself:

- `GET /repos/oven-sh/bun/languages` returns **Rust: 42,030,627 bytes, C++: 13,407,891, TypeScript: 5,687,334** — and **no Zig at all**.
- `main`'s `package.json` declares version **1.4.0**; the `LATEST` file still declares **1.3.14**.

Bun 1.4.0 is [a port of roughly 530,000 lines of Zig to Rust](https://gigazine.net/gsc_news/en/20260723-claude-code-bun-in-rust/), version-bumped on 17 May 2026, still canary-only as of late July 2026. Per that report, Jared Sumner completed the migration in about 11 days using multiple Claude Code instances, and the stated motivation was memory safety — Zig's manual memory management producing leaks and use-after-free bugs.

That motivation is telling, because it matches the bug reports:

- [#25948](https://github.com/oven-sh/bun/issues/25948) (10 Jan 2026, Bun 1.3.5, Hono + Mongoose in Docker): memory climbing **50 MB → 170 MB in 12 hours on an idle server receiving no requests**, and a second instance going 300 MB → 1.5 GB in a day. Closed as duplicate of #12117 with no substantive discussion.
- [#27046](https://github.com/oven-sh/bun/issues/27046) (15 Feb 2026, Bun 1.3.9): "Bun keeps gobbling up memory for unknown reasons," ~10 hours of growth. Closed as duplicate.
- [#27525](https://github.com/oven-sh/bun/issues/27525) (27 Feb 2026, Bun 1.3.10, Windows): **segfault after 14.4 hours, 7.09 GB peak RSS, 47.1M page faults**, near-NULL pointer dereference. Reporter suspected a leak or use-after-free in JSC under sustained memory pressure.
- [Trigger.dev's write-up](https://trigger.dev/blog/firebun) documents a leak specific to Bun's HTTP model: an unresolved `Promise<Response>` on client disconnect retained request context at 500–2000 bytes per dropped connection. Bun shipped a fix around 30 March 2026. Note their conclusion is *conditionally* positive — they run Bun in production, but only after learning that Bun's promise-based response model requires every promise to settle, unlike Node's socket-based model.

To Bun's credit, [1.3.14's release notes](https://bun.com/blog/bun-v1.3.14) fix a lot of exactly this class of bug: TLS context duplication leaking ~50 KB per connection, subprocess and timer leaks affecting long-running processes, a `node:http` response leak when callbacks re-register after completion, use-after-free crashes in WebSocket / `fs.watch` / `node:http`, and event-loop leaks that prevented graceful shutdown.

**The problem is what comes after 1.3.14: nothing.** Any leak still present in that build is a leak you live with for the life of the deployment, because fixes are landing on a Rust rewrite that has not shipped. And the rewrite is finding its own regressions — [#32793](https://github.com/oven-sh/bun/issues/32793) (26 Jun 2026) is a `bun test` regression where a leaked `setSystemTime()` non-deterministically corrupts `Date.now()` in *other* test files, ~18 failures in a 320-test suite; it reproduces on `1.4.0-canary.1` and explicitly **does not** reproduce on 1.3.14.

None of this says Bun is bad software, and the Rust port is a serious attempt to fix the exact bug class that hurts long-running processes. In 12 months this recommendation may well invert. But "single-user app that must run unattended for weeks on a home machine" is precisely the workload with the least tolerance for a frozen stable branch.

**Supervisor behaviour:** `node:timers` is fully implemented in Bun and there is no evidence of timer drift over long uptimes specific to Bun. SIGTERM handling works ([#1657](https://github.com/oven-sh/bun/issues/1657) is long resolved), and 1.3.14 fixed event-loop leaks blocking graceful shutdown. Under either runtime, the supervisor is doing the real work: `Restart=always` with `RestartSec` under systemd, or a launchd plist with `KeepAlive` on a Mac.

---

## 2. SQLite access layer

**`better-sqlite3` is hard-refused by Bun.** This is not a rough edge, it is a wall:

```
=== NODE ===  { "load": "OK", "sqliteVersion": "3.53.2", "hasBackup": "function" }
=== BUN  ===  { "load": "FAIL: 'better-sqlite3' is not yet supported in Bun." }
```

Bun rejects it by name before the native module is even attempted. Related: [#19328](https://github.com/oven-sh/bun/issues/19328) (Node ABI mismatch), [#24956](https://github.com/oven-sh/bun/issues/24956) (crash), [#16050](https://github.com/oven-sh/bun/issues/16050) (request to make it work without recompilation).

**`node:sqlite` is absent from shipped Bun.** On Bun 1.3.10: `No such built-in module: node:sqlite`. Bun's *current documentation* claims it is "Fully implemented" with the caveat that "`backup()` runs synchronously and blocks the event loop for the duration of the copy (Node runs it on a worker thread)" — but those docs describe `main`, i.e. the unreleased 1.4 line. [#20412](https://github.com/oven-sh/bun/issues/20412) tracks the request. This is a general hazard worth internalising: **Bun's docs currently document a codebase with no shipped binary.**

Consequence: choosing Bun means `bun:sqlite` is your *only* SQLite driver, with no fallback.

**`bun:sqlite` itself is good, with one serious platform trap.** Measured behaviour (Bun 1.3.10, two connections to one WAL file):

```json
{
  "journalMode": "wal",
  "readDuringOpenWrite": "5000 (uncommitted not visible = correct)",
  "writeDuringOpenWrite": "SQLITE_BUSY",
  "blockedForMs": 5241,
  "serializeBytes": 118784,
  "hasBackupMethod": "undefined"
}
```

WAL behaves correctly: readers get a consistent snapshot and are never blocked by an open writer. A *second* connection attempting to write while the first holds the lock honours `busy_timeout` (blocked 5.2s) then throws `SQLITE_BUSY`.

**The concurrency answer for the one-process case is simple: use one connection.** `bun:sqlite` and `better-sqlite3` are both synchronous, so JavaScript's single-threadedness serialises writes for free — the scanner and the request handler cannot interleave a write. Two connections in one process only buys `SQLITE_BUSY` handling that is not needed. Set `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000` once at open.

**The macOS SQLite trap.** On macOS, `bun:sqlite` links against Apple's *system* SQLite, not a bundled one. Measured:

```json
{
  "sqlite_version": "3.43.2",
  "jsonb (3.45+)":           "FAIL: no such function: jsonb",
  "ORDER BY in agg (3.44+)": "FAIL: near \"ORDER\": syntax error",
  "json ->> op (3.38+)": "OK",  "FTS5": "OK",
  "STRICT tables (3.37+)": "OK", "RETURNING (3.35+)": "OK"
}
```

versus `better-sqlite3` on Node, which reports **3.53.2** with `jsonb` and ordered aggregates both working.

This is a known, confirmed bug: [#31247](https://github.com/oven-sh/bun/issues/31247) (23 May 2026) — "bun:sqlite on macOS arm64 still ships SQLite 3.43.2 in Bun 1.3.14 / 1.4.0-canary, despite blog claiming 3.53.0," closed as duplicate of #16717, with a prior identical report at #24957. **Critically, that reporter hit an FTS5 corruption bug in 3.43.2 causing database-corruption errors on UPDATE/DELETE in full-text tables, and had to downgrade FTS5 → FTS4.** For a card-search app, FTS5 over card names is an extremely likely feature, and this bug is directly in its path.

The knock-on: on macOS you get SQLite 3.43.2 (Oct 2023), on Linux you get 3.53.0. The stated deployment is "a home server **or** Mac" — so that would be different SQL dialects in dev and prod. The documented workaround, `Database.setCustomSQLite()`, does work — pointed at Homebrew's build it gave **3.51.3** — but it means every developer machine needs Homebrew SQLite installed and a runtime call before the first `Database` is constructed, and it still does not match Linux's 3.53.0.

`better-sqlite3` sidesteps all of this by compiling its own SQLite: same version everywhere, plus a real incremental `backup()` with rate and progress callbacks. `bun:sqlite` has no `backup` method at all — only `.serialize()`, which materialises the entire database as a `Uint8Array` in memory.

**Backup story regardless of driver:** `VACUUM INTO 'backup.db'` works fine under `bun:sqlite` (tested: 118 KB in 1 ms, backup verified readable and complete) and is the correct online-backup primitive — safe against a live WAL database and yielding a defragmented copy. Run it from the cron job and rotate the files.

---

## 3. ORM / query layer

Both are healthy and actively published: `drizzle-orm` 0.45.2 (12 Aug 2026), `kysely` 0.29.5 (10 Aug 2026).

Drizzle on `bun:sqlite` does work — verified end-to-end:
```json
{"drizzle":"0.45.2","rows":[{"id":1,"name":"Charizard"}]}
```
One Bun-specific wrinkle if that route is taken: drizzle-kit commands need a `bun --bun` prefix so the SQLite driver resolves through Bun's runtime rather than falling back to a Node shim, and drizzle-kit otherwise wants `better-sqlite3` or `@libsql/client` to connect — which, per §2, Bun refuses. That is a concrete friction point for the Bun+Drizzle combination specifically.

**On migration quality under heavy churn**, the deciding criterion for this project:

- **Drizzle** diffs the TS schema against a stored snapshot and emits SQL files (`drizzle-kit generate`), applied in order by `drizzle-kit migrate`. The reason this matters for SQLite specifically: SQLite's `ALTER TABLE` only supports add-column, rename, and drop-column. **Every** type change, constraint change, or primary-key change requires the full 12-step create-new-table / copy / drop / rename dance. Under a card/variant model that will churn hard, hand-writing those repeatedly is where migration bugs come from. Drizzle generating them is the single strongest argument in its favour.
- **Kysely** is a query builder, not an ORM, and has no schema declaration. Migrations are hand-written TypeScript via [`kysely-ctl`](https://github.com/kysely-org/kysely-ctl) (official, Knex-compatible, works on Node/Deno/Bun). Every statement is one you wrote and reviewed. Known limitation: rollback without `--all` is unsupported, because Kysely does not track migration batches.

**Guardrails if Drizzle is taken** (these matter more than the choice itself): use `drizzle-kit generate` and *never* `drizzle-kit push` outside a throwaway dev database — `push` applies diffs directly and is destructive. Set `strict: true` so drizzle-kit refuses destructive migrations. Read every generated `.sql` file before committing it; the SQLite dialect's table-rebuild output is where it can silently drop data. Commit the `drizzle/meta` snapshots — they are the diff baseline, and losing them corrupts future generation.

Raw SQL is a legitimate third option for an app this size, but it means hand-rolling both the type mapping and the 12-step rebuilds. Not worth it.

---

## 4. HTTP layer

- **Hono** 4.13.2, published 13 Aug 2026, ~38.2M weekly downloads, ~30.7k stars, ~322 contributors. Runs on Node, Bun, Deno, Workers. `serveStatic` from `hono/bun` or `@hono/node-server/serve-static` handles the PWA assets, with SPA fallback via a catch-all route serving `index.html`. There is an open request to add an `isSPA` flag ([honojs/hono#1859](https://github.com/honojs/hono/issues/1859)); until then it is a two-line catch-all.
- **Elysia** 1.4.29, published 13 Aug 2026, ~18.4k stars, ~119 contributors, ~461k weekly downloads. Faster on Bun-specific benchmarks (~2.5M req/s vs Hono's ~1.2M) but built on Bun-specific APIs. **Dropping Bun eliminates Elysia.** Even on Bun it would be the wrong call here — it welds the HTTP layer to the runtime whose stability is least certain.
- **Bare `Bun.serve`** deserves credit: its `routes` option (Bun ≥1.2.3) allows `import app from "./index.html"` and has Bun bundle and serve the frontend directly, including SPA fallback. It is genuinely the nicest single-process full-stack story of the three — and it is 100% non-portable. It is the main thing given up by not choosing Bun.

Throughput is irrelevant at this scale. For one user on a home server, pick the one with 322 contributors and 38M downloads.

---

## 5. Web Push from Bun — the "known-risky area" is a false alarm

This was the flagged risk, so it was tested rather than reasoned about. First the primitives `web-push` depends on:

```
=== NODE v20.20.2 ===              === BUN v1.3.10 ===
createECDH:            OK 65b      createECDH:            OK 65b
ecdhCompute:           OK 32b      ecdhCompute:           OK 32b
hmac:                  OK          hmac:                  OK
aes128gcm:             OK tag=16b  aes128gcm:             OK tag=16b
generateKeyPairSync_ec:OK          generateKeyPairSync_ec:OK
hkdf:                  OK          hkdf:                  OK
```

Then the real library — `web-push@3.6.7`, generating VAPID keys and running `generateRequestDetails()`, which is the actual VAPID-JWT-signing plus `aes128gcm` payload-encryption path, against a fabricated P-256 subscription:

```
=== NODE ===                            === BUN ===
generateVAPIDKeys: OK pub=87 priv=43    generateVAPIDKeys: OK pub=87 priv=43
encryptPayload:    OK body=117b         encryptPayload:    OK body=117b
contentEncoding:   aes128gcm            contentEncoding:   aes128gcm
hasVapidAuth:      vapid t=eyJ0...      hasVapidAuth:      vapid t=eyJ0...
```

Byte-identical. **No shim needed.** The `crypto.createECDH is not a function` error that gives this area its reputation is a **Cloudflare Workers / edge-runtime** problem — those runtimes have no `node:crypto`. Bun implements `node:crypto` on BoringSSL, and while BoringSSL does drop some algorithms (no `ed448`, `x448`, `rsa-pss`, `dsa`, `dh`, no `secp256k1`), **P-256 — the only curve Web Push uses — is present**.

So Web Push is not a reason to avoid Bun. It is also, therefore, not a reason to fear Node compat generally.

**On `web-push`'s maintenance:** last published 16 Jan 2024, v3.6.7, ~6.75M weekly downloads. That looks like rot but reads better as a finished implementation of a frozen spec (RFC 8291/8292). Modern alternatives exist if Web Crypto is preferred over `node:crypto`:

- [`web-push-neo`](https://github.com/ryoppippi/web-push-neo) — v0.1.2, created Mar 2026, ~5.3k weekly downloads. Runtime-agnostic (Web Crypto + fetch), ESM-only, stateless API, `aes128gcm` only, single dependency (`jose`). Promising but **0.1.x and five months old**.
- [`@pushforge/builder`](https://github.com/draphy/pushforge) — v2.0.5, ~30.9k weekly downloads, zero dependencies, returns `{endpoint, headers, body}` to `fetch` yourself.

For a single-user app on Node, `web-push` at 6.75M downloads/week is the lower-risk pick. Either alternative is a fine hedge if the app ever moves to an edge runtime.

---

## 6. Frontend and PWA build

**Vite 8.2.1** (6 Aug 2026) + **`vite-plugin-pwa` 1.3.0** (5 May 2026). Vite 8 support was a real gap — [#918](https://github.com/vite-pwa/vite-plugin-pwa/issues/918) and [#923](https://github.com/vite-pwa/vite-plugin-pwa/issues/923) were filed in March 2026 over peer-dep conflicts — and 1.3.0 resolved it by widening peers to `^3.1.0 || ... || ^8.0.0`. Current pairing is fine.

**Use `injectManifest`, not `generateSW`.** This is load-bearing and not a preference: Web Push requires custom `push` and `notificationclick` event listeners inside the service worker, and Workbox's `generateSW` produces a worker you cannot add handlers to. `injectManifest` allows writing `sw.ts` by hand and having Workbox inject only the precache manifest.

**Staleness — the stated concern about stranding the phone on old code.** The mechanism to get right:

- `registerType: 'autoUpdate'` plus `workbox: { clientsClaim: true, skipWaiting: true }`. `skipWaiting` stops a new worker idling in "waiting" behind the old one; `clientsClaim` makes it take control of already-open pages immediately.
- Add a periodic update check — `registration.update()` on an interval and on `visibilitychange`. This matters *more* on iOS than elsewhere: an installed iOS PWA is frequently resumed from a suspended state rather than cold-started, so without an explicit check on resume it may go a long time without ever asking the server for a new worker.
- Because the server is self-controlled, also send `Cache-Control: no-cache` for `sw.js` itself. A cached service worker script is the classic way a PWA pins itself to old code permanently.

**iOS specifics:**

- **Push requires installation to the Home Screen.** Safari on iOS/iPadOS will not allow even *requesting* notification permission from a browser tab — only from a PWA added via Share → Add to Home Screen. Requires iOS 16.4+ (Mar 2023).
- Permission must be requested from a **direct user gesture** (a button tap), not on page load. Design a two-step prompt: custom UI first, the native prompt only after opt-in — there is exactly one chance at the native prompt.
- **`<link rel="apple-touch-icon">` at 180×180 in the HTML `<head>` is mandatory.** iOS ignores the manifest's `icons` array when generating the Home Screen icon; with no `apple-touch-icon` it screenshots the page and uses that, blurred.
- The 180×180 PNG must have a **solid background** — iOS fills transparency with black and adds its own rounded corners.
- Manifest needs 192×192 and 512×512 `purpose: "any"` icons, plus a **separate** 512×512 `purpose: "maskable"` entry. Do not combine purposes in one entry: a maskable icon carries 10% padding per side, and reusing it as `any` renders the logo ~20% smaller than neighbouring icons. Maskable safe zone is the central 80% (circle of radius 40% of width).

---

## 7. Scheduling

- **`croner` 10.0.1** (5 Jun 2026) — zero dependencies, TypeScript-native, works on Node ≥18, Deno ≥2.0, Bun ≥1.0, and the browser. Handles DST and leap years, which is the part hand-rolled `setInterval` gets wrong. This is the pick.
- **`Bun.cron`** is genuinely nice and worth recording in case Bun becomes viable later. It landed in **1.3.11** (confirmed absent from 1.3.10 locally: `Bun.cron: undefined`) and has two overloads:
  - `Bun.cron(expr, callback)` — in-process, shares state with the server.
  - `await Bun.cron(path, schedule, title)` — registers an **OS-level** cron job running a module that exports `default { scheduled(controller) {...} }`, keyed by title so re-registering replaces in place. **This one survives process restarts and reboots**, which is unusual and directly addresses the durability question. It is the single most attractive Bun-only feature for this project.
- **System cron / systemd timers** remain the most restart-proof option but spawn a fresh process, so the scanner cannot share the server's in-memory state or connection.

**What actually survives a restart is not the scheduler — it is the database.** Whichever is picked, persist `last_scanned_at` (and per-query cursors) in SQLite and have the scanner compute what it missed on boot. Then a crash at 3am means a catch-up scan at 3:05, not a silent gap. Supervise with systemd `Restart=always` + `RestartSec=10` on Linux, or a launchd plist with `KeepAlive` on a Mac.

---

## 8. Repo shape

**Single package.** One `package.json`, `client/` and `server/` directories, one `tsconfig` with path aliases, and a `shared/` directory for the types crossing the boundary. For one developer and one deployable unit, a workspace adds a resolution layer and buys nothing.

Recorded for completeness: Bun's workspaces do the standard things (`bun install` covers all workspaces and dedupes; `--filter` scopes it; root `package.json` should hold no dependencies). The notable defect is [#16656](https://github.com/oven-sh/bun/issues/16656) — packages installed for one workspace are importable from another that never declared them, because everything hoists into a single root `node_modules`. That is phantom-dependency behaviour: it does not break the local machine, it breaks the machine that installs only a subset. With a single package the issue is moot.

---

## 9. Testing and lint

**`bun test`** is fast (~2–3× Vitest, ~50× Jest) but has real gaps as of 2026: `--coverage` is experimental with no HTML reports, no branch-coverage percentages and no threshold enforcement; `mock()` has known failures with re-export patterns and dynamic imports; no inline snapshots; no UI mode; no browser mode. And per §1, the 1.4 runner has a live isolation regression ([#32793](https://github.com/oven-sh/bun/issues/32793)) where mocked-clock state leaks across test files unless `--isolate` is passed — worth knowing given a scanner is exactly the kind of code tested with a mocked clock.

**Recommended baseline:** Vitest, because Vite is already in the project and it reuses that config — one toolchain instead of two, plus real coverage thresholds and mature module mocking. `node:test` is a credible zero-dependency alternative if adding Vitest to the server side is unwanted.

For the tests that matter here: run the scanner's parsing and dedup logic against recorded eBay API fixtures rather than the live API, and test migrations by applying the full chain to a temp file database — under heavy schema churn, "does the migration chain still apply from empty?" is the test that will actually save you.

Lint: TypeScript `strict: true` does most of the work. Biome or oxlint for the rest; this is the lowest-stakes decision in the document.

---

## 10. The honest alternative — stated plainly

**Yes: Node is materially less risky for this specific service, and the margin is not narrow.**

The case is not "Bun is immature." Bun is fast, `bun:sqlite` is good, WAL works correctly, `Bun.cron`'s OS-level registration is a genuinely better scheduling primitive than anything in the Node ecosystem, and the Web Push risk turned out to be a myth — tested, and it works perfectly. On features, Bun argues well.

The case is about **timing**. In August 2026, Bun is mid-transplant:

1. Stable has not moved in three months and will not, because development moved to an unreleased Rust rewrite of the entire runtime.
2. The last stable, 1.3.14, has open duplicate-closed reports of unexplained memory growth on **idle** servers — the exact failure mode for a process meant to sit quietly for weeks.
3. The next stable is ~530k lines rewritten in a different language, currently surfacing regressions that provably do not exist in 1.3.14.
4. On macOS, `bun:sqlite` silently gives SQLite 3.43.2 with a known FTS5 corruption bug — on a machine this may well deploy to, for a feature a card-search app will very likely want.
5. `better-sqlite3` is refused outright and `node:sqlite` is not in a shipped build, so there is no second SQLite driver to fall back to.

Set against a self-hosted service whose entire job is to run unattended and notify one person's phone, where the failure mode is "I stopped getting alerts three weeks ago and did not notice."

Node 24 LTS gets: security patches through April 2028, one SQLite version on every machine, a driver with a real incremental backup, and every library above running on its primary tested target.

**What choosing Node gives up:** `Bun.serve`'s HTML-import bundling (genuinely the best single-process full-stack DX available), `Bun.cron`'s reboot-surviving OS-level jobs, `bun install` speed, and one-binary `bun build --compile` deployment. Those are real losses. They are not worth an unattended process on a frozen runtime.

**When to revisit:** once Bun 1.4.x has been stable — not canary — for a couple of months, and [#16717](https://github.com/oven-sh/bun/issues/16717) (the macOS SQLite version bug) is closed. Because the schema and data live in plain SQLite behind a thin query layer, and because Hono, `croner`, `web-push`, Drizzle and Vite all run on both runtimes, this decision stays cheap to reverse. **Deliberately keep it that way: avoid runtime-specific APIs on both sides** — no Elysia, no `Bun.serve` route objects, no `bun:sqlite` import — and switching later is a `package.json` change plus a driver swap, not a rewrite.

---

## Sources

[oven-sh/bun releases](https://github.com/oven-sh/bun/releases) · [Bun v1.3.14 notes](https://bun.com/blog/bun-v1.3.14) · [Bun Node.js API compat](https://bun.com/docs/runtime/nodejs-apis) · [bun:sqlite docs](https://bun.com/docs/runtime/sqlite) · [Bun HTTP server docs](https://bun.com/docs/runtime/http/server) · [Bun workspaces](https://bun.com/docs/pm/workspaces) · [bun#25948](https://github.com/oven-sh/bun/issues/25948) · [bun#27046](https://github.com/oven-sh/bun/issues/27046) · [bun#27525](https://github.com/oven-sh/bun/issues/27525) · [bun#31247](https://github.com/oven-sh/bun/issues/31247) · [bun#32793](https://github.com/oven-sh/bun/issues/32793) · [bun#20412](https://github.com/oven-sh/bun/issues/20412) · [bun#16656](https://github.com/oven-sh/bun/issues/16656) · [bun#19328](https://github.com/oven-sh/bun/issues/19328) · [Trigger.dev: Why we replaced Node.js with Bun](https://trigger.dev/blog/firebun) · [GIGAZINE on Bun 1.4 Rust port](https://gigazine.net/gsc_news/en/20260723-claude-code-bun-in-rust/) · [Node.js release schedule](https://github.com/nodejs/Release) · [node:sqlite docs](https://nodejs.org/api/sqlite.html) · [nodejs/node#57445 stabilization](https://github.com/nodejs/node/issues/57445) · [Hono on Bun](https://hono.dev/docs/getting-started/bun) · [honojs/hono#1859 SPA flag](https://github.com/honojs/hono/issues/1859) · [Kysely migrations](https://kysely.dev/docs/migrations) · [kysely-ctl](https://github.com/kysely-org/kysely-ctl) · [Drizzle Bun SQLite](https://orm.drizzle.team/docs/sqlite/connect-bun-sqlite) · [vite-plugin-pwa](https://github.com/vite-pwa/vite-plugin-pwa) · [vite-plugin-pwa#918](https://github.com/vite-pwa/vite-plugin-pwa/issues/918) · [Vite PWA guide](https://vite-pwa-org.netlify.app/guide/) · [croner](https://github.com/hexagon/croner) · [web-push](https://github.com/web-push-libs/web-push) · [web-push-neo](https://github.com/ryoppippi/web-push-neo) · [pushforge](https://github.com/draphy/pushforge) · [Pushpad: iOS web push requirements](https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications) · [MagicBell: PWA iOS limitations](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
