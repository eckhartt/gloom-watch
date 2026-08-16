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

bun run vapid:generate  # the push keypair — ONCE, ever; see docs/deploy.md
bun run push:test       # send a test push by hand, from the server
```

`bun run dev` starts Vite on 5173 proxying `/api` to a `bun run dev:server` on 3000. The
service worker is only registered against the built app, so exercise it through
`bun run build && bun run start`.

Deploying to the always-on box — Tailscale Serve, systemd and the OS-level cron jobs — is
[`docs/deploy.md`](docs/deploy.md).

## Status

Pre-alpha. The spec is frozen, the build queue is published, and the walking skeleton is
**commissioned** — running on the always-on box behind Tailscale Serve and installed to the
owner's Home Screen.

Proved on real hardware rather than asserted: systemd brings the server back from `SIGKILL`,
an OS-level `Bun.cron` job survives a full reboot and writes to the same SQLite file the
server reads, and Serve's HTTPS endpoint loads on an iPhone — Tailscale issue 19147 did not
reproduce.

**Push transport** is built and proved as far as a development machine can prove it: RFC 8291
encryption, VAPID signing, both payload shapes and the echo log are exercised end to end against
a stand-in push service that decrypts what arrives. What only the real origin and the real
handset can settle — that an iPhone displays the notification, and that it arrives with Tailscale
off — is [`docs/deploy.md`](docs/deploy.md) steps 10 and 11. **Read the three-strike warning in
step 10 before sending a push to a real device.**

**The corpus** is ingested. Pressing sync pulls the masterset from TCGdex and fills the
database: **497 cards, 817 variants across 11 languages**, with 382 card images stored as webp
BLOBs totalling 26 MiB. Re-syncing with nothing changed moves zero image bytes — the incremental
path keys off TCGdex's own hash manifest. Card identity includes language, because en `base1-58`
and fr `base1-58` are different cards; variant identity is `(card, variant_id)`, because all 817
variants share only 21 distinct variant IDs and the worst is shared by 264 cards.

**The binder** is the app's first screen. `GET /api/binder` answers with every variant, its five
axes and its ownership state in **one unpaginated document** — ~290 KB for the live corpus, with
an ETag so an unchanged binder revalidates for nothing. The grid over it is virtualised, card
images are served from the stored BLOBs and cached `CacheFirst` by the service worker, and
tapping a card opens a bottom sheet rather than navigating, so the binder keeps its scroll
position. Default order is set release date descending, then card number — which is why the
corpus sync grew a **sets phase**: no TCGdex endpoint but `/v2/{lang}/sets/{setId}` carries a
release date, so it is fetched once per set and never asked for again.

**Copies** are recorded. A copy is **one physical card** pointing at one variant — a PSA 9 and a
raw copy of the same printing are two rows, never a count of two — carrying its condition or its
grade, a cert number, what was paid in the currency it was paid in, a home-currency value with the
date its rate was taken, where it came from and a free-text note. Money is integer minor units
paired with an ISO 4217 code, so ¥4,200 is `4200` and not `420000`; a grade is integer tenths, so
`PSA 8.5` is `85`. Adding, editing and disposing all happen in the binder's bottom sheet, which
stays component state rather than becoming a route.

**Disposal retains the row** — there is no route in this application that deletes a copy — which is
why every ownership query filters `status = 'owned'`. That rule is held by a test watching the
statements the application actually issues, rather than by a list of the queries somebody
remembered, so a new query that forgets it fails the first time its code path runs.

**Completion** is the count of variants with at least one owned copy, over every variant except
those flagged `missing_upstream` that the owner does not hold. It is computed from the database on
every read and never cached server-side, because the corpus sync that moves the denominator runs
in a different OS process. Expect it to go *down* after a sync that finds a new language — the
target got bigger. How it is presented numerically is still open in the spec, so `/status` shows
the numerator over the denominator and nothing else.

The condition ladder is `NM / LP / MP / HP / DMG`, which is the hobby's. **It is not eBay's and
this repository contains no mapping between them** — eBay's Card Condition has four values and no
rung for a damaged card.

## Licence

Card data comes from TCGdex under the MIT licence. This repository carries no card
images; they are fetched at ingest time.
