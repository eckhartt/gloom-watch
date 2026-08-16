---
id: 01M04P3SX9KAV082W044TGV9GD
type: doc
title: Gloom Watch — build-ready spec (rev 3)
status: draft
parent: 01M03X4D6HQESBXXDYYRVBVRDR
---
**Revision 3. This is the build document.**

Rev 1 was found not build-ready; rev 2 fixed its structural gaps and was found to contain
defects in the artifacts it added. **Rev 3 changes level deliberately: it specifies
invariants, not DDL.**

That is a considered choice, not a retreat. A column list is an implementation guess that
real code will contradict within a week; an invariant — what identity is composed of, what
states exist, what may never be stored, what must survive a re-import — is what actually
stops two builders shipping different things. The builder writes the schema and the routes.

**Nine decisions were frozen during the review of rev 1 and rev 2**, four of them
superseding earlier rulings that rested on facts which did not survive primary sources:
the runtime (`01m04je8az`), the push rule (`01m04je8wa`), card-grain matching
(`01m04je9e7`, amended by `01m04nww7n`), the completion denominator (`01m04jea06`), the
condition ladder (`01m04k28t8`), the backfill (`01m04mt0sv`), listing storage
(`01m04nwvnj`), alias grain (`01m04nww7n`) and the language set (`01m04nwwsh`).

Reviews are recorded at `01m04hm3vs`. Every external claim here has been checked against a
primary source except those listed under *Facts to verify at build time*.

**Open items are named rather than hidden. Build, and correct as evidence arrives.**

## Problem Statement

The owner collects a **masterset** of the **Oddish line** — every physically printed
Pokémon Trading Card Game **variant** of Oddish, Gloom, Vileplume and Bellossom, across
every set, language and print variant. That is roughly **765 variants**, a large
fraction of them Japanese-only prints, WOTC-era promos, trainer-owned cards (`Erika's
Gloom`, `Dark Gloom`) and mechanic variants (`Gloom δ`).

Two problems make this collection hard to run.

**Nobody knows what is held.** Existing trackers model a card, not a variant. They mark
Base Set Gloom "collected" when any printing is owned, so "I have the Unlimited, I still
need the 1st Edition" cannot be expressed. At that grain the collection is a spreadsheet
at best — no images, no completion figure that means anything, and no way to answer the
only question that matters standing in a card shop: *do I already have this one?*

**Nobody knows when a needed card appears.** eBay carries ~25,000 active Gloom listings
in the US card category alone, with an estimated **1,000–3,000 new Oddish-line listings
per day**. Manually watching for one missing Japanese Jungle holo is not a thing a
person can do, and the cards that matter most are buried deepest.

## Solution

**Gloom Watch** is a self-hosted, single-user Progressive Web App installed to the Home
Screen of the owner's iPhone, backed by one SQLite database on an always-on Linux box
reachable only over the owner's Tailscale tailnet.

**It holds the masterset.** The corpus is pulled from TCGdex, filtered to the Oddish
line, and stored at variant grain — one row per print variant per language. Gaps TCGdex
cannot fill (Korean, Simplified Chinese, "The Best of XY") are added by hand and count
toward completion like any imported row. Images live in the database as BLOBs.

**It tracks copies.** Each physical card is one row pointing at one variant, carrying
condition or grade, cert number, what was paid in the currency it was paid in, where it
came from, notes, and the owner's own photographs. The primary screen is a **binder
view**: a visual grid of every variant where owned and needed are obvious at a glance.

**It hunts.** A scanner polls eBay's Browse API every ten minutes, resolves listings
against the local corpus, and pushes an iOS notification when a card the owner does not
own appears. High-priority variants push instantly; everything else lands in two digests
a day.

## User Stories

### The masterset

1. As the owner, I want the app to hold every physically printed Oddish-line variant, so
   my completion figure is measured against a real target rather than a guess.
2. As the owner, I want digital-only TCG Pocket cards excluded, so the masterset is not
   permanently incompletable.
3. As the owner, I want to sync the corpus from TCGdex by pressing a button, so new sets
   appear when I choose rather than on a schedule I did not ask for.
4. As the owner, I want to see when the corpus was last synced, so I can tell whether a
   missing card is genuinely absent or merely unsynced.
5. As the owner, I want to add a variant by cloning an existing one and changing a few
   fields, so Korean and Simplified Chinese prints can be tracked without typing a whole
   card from scratch.
6. As the owner, I want my hand-added variants never deleted, renumbered or orphaned by
   a corpus re-import, so months of curation survive a sync.
7. As the owner, I want a variant that disappears from TCGdex flagged rather than
   deleted, so an upstream mistake cannot take my ownership record with it.
8. As the owner, I want a variant that disappeared upstream to leave my completion
   target unless I actually own it, so somebody else's data correction cannot cap me
   below 100%.
9. As the owner, I want card images held locally, so the binder renders without a round
   trip to a third party that may change its URLs or vanish.

### The binder

10. As the owner, I want a visual grid of every variant as the app's primary screen, so
    seeing the collection and its holes is the default act.
11. As the owner, I want owned and needed variants distinguishable at a glance in a dense
    grid, so I can read the state of the collection without reading text.
12. As the owner, I want "what I still need" to be a filter over that grid rather than a
    separate page, so I never lose the visual context of the binder.
13. As the owner, I want to filter the binder by set, language, finish, subtype, stamp,
    foil, owned/needed and priority, so I can narrow ~765 variants to the handful I care
    about.
14. As the owner, I want my filter state in the URL, so a filtered view survives a reload
    and can be returned to.
15. As the owner, I want tapping a card to open a bottom sheet rather than navigating
    away, so the binder stays as persistent context.
16. As the owner, I want the sheet to show the corpus image, my photographs, the copies I
    hold and any current listings, so one tap answers everything about that variant.
17. As the owner, I want the binder to browse and filter with no connection once warmed,
    so it is usable at a card fair or on a plane.

### Copies

18. As the owner, I want each physical card recorded as its own row, so a PSA 9 and a raw
    copy of the same variant are not collapsed into a count.
19. As the owner, I want to record condition using the vocabulary the hobby uses
    (NM/LP/MP/HP/DMG), so my collection reads the way every other price guide and trade
    conversation does.
20. As the owner, I want to record grader, grade and certification number, so I can
    recognise my own slab if it resurfaces on the market.
21. As the owner, I want to record what I paid in the currency I paid it in, with a
    home-currency value captured at purchase, so the historical rate is not lost forever.
22. As the owner, I want to record where a copy came from as a coarse category plus my own
    free text, so provenance is captured without the app storing eBay user data.
23. As the owner, I want a free-text note per copy, so I can remark on an off-centre cut
    without the app modelling defects as data.
24. As the owner, I want to attach my own photographs to a copy, because for most
    pre-2021 Japanese variants my scan is the only image that will ever exist.
25. As the owner, I want a sold or traded copy to keep its row marked disposed, so my
    purchase history and upgrade trail survive.
26. As the owner, I want completion to count only copies I currently own, so disposed
    cards do not inflate the figure.
27. As the owner, I want to set a priority on a variant I do not own, so the notification
    policy has a dial and the cards I most want can interrupt me.

### The hunt

28. As the owner, I want the app to sweep everything already for sale when I first set it
    up, so it does not launch blind to the twenty-five thousand listings that existed
    before I turned it on.
29. As the owner, I want the server to scan eBay for new Oddish-line listings every ten
    minutes without my involvement, so I do not have to watch.
29. As the owner, I want each listing resolved as precisely as its title allows — to a
    variant where the title says so, otherwise to a card — so have-it/need-it stays
    accurate without inventing detail the listing never carried.
30. As the owner, I want a listing for a card I own no printing of to count as needed
    without my having to disambiguate it, so the common case never becomes homework.
31. As the owner, I want listings the matcher cannot place held in a confirm queue rather
    than guessed at, because a wrong auto-match is silent and corrupts my collection state.
32. As the owner, I want confirming a queued listing to teach a reusable alias, so the
    same question is never asked twice.
33. As the owner, I want bundle listings flagged as lots and shown in their own filtered
    view, never resolved to a variant.
34. As the owner, I want proxies and custom art filtered out and the filtered ones logged,
    so fakes do not pollute the feed and I can still see what the filter caught wrongly.
35. As the owner, I want a listing's grade parsed and stored on the listing, so I can
    filter for raw-only or graded-only when hunting.
36. As the owner, I want every listing to link out to eBay with a "seen at" timestamp, so
    I act on the live page rather than on stale cached data.

### Notifications

37. As the owner, I want to install the app to my Home Screen and enable notifications
    through a soft-ask before the system prompt, because iOS gives exactly one chance and
    denial is effectively permanent.
38. As the owner, I want a permanent "re-enable notifications" button, because iOS
    silently invalidates subscriptions and gives the page no event when it does.
39. As the owner, I want an instant push when a high-priority card I do not own is listed,
    so I can act before an auction ends.
40. As the owner, I want everything else batched into two digests a day at times I
    configure, so the feed does not train me to switch notifications off.
41. As the owner, I want an instant push to also appear in the next digest, so one lost to
    the platform's single-message queue still reaches me.
42. As the owner, I want a notification to carry enough detail to decide whether to act
    without opening the app, because I may be away from my tailnet when it arrives.
43. As the owner, I want tapping a notification to land on that listing in the app when I
    am on my tailnet.
44. As the owner, I want a relisted item not to notify me again, so an unsold card renewed
    weekly does not buzz forever.
45. As the owner, I want an app badge counting unseen qualifying listings, so a dismissed
    notification still leaves a trace.

### Health and durability

46. As the owner, I want the last successful scan time shown on every app open, turning
    red past a threshold, because silence is ambiguous and a dead scanner cannot send its
    own funeral notice.
47. As the owner, I want one push when the scanner recovers from a gap, so I know a quiet
    period was an outage rather than an empty market.
48. As the owner, I want to mark a card owned while offline and have it replay on
    reconnect, so a dead spot does not cost me the catalogue entry.
49. As the owner, I want the pending offline-write count surfaced, so I know whether
    anything is unsent.
50. As the owner, I want the whole database backed up daily and again shortly after I edit
    my collection, because collection edits cannot be rebuilt.
51. As the owner, I want backups encrypted and stored off-site, with the credentials also
    held somewhere other than the box, so a dead or stolen machine costs me nothing.
52. As the owner, I want every backup verified and the result surfaced, because an
    untested backup is a belief.
53. As the owner, I want a CSV and JSON export archived with every backup and kept
    indefinitely, so my collection outlives the snapshot window and this application.
54. As the owner, I want that export re-importable, because an export that cannot be
    loaded back is documentation, not a backup.
55. As the owner, I want to warm the image cache on demand before a card fair or a flight.

## Implementation Decisions

### Stack — *Lock the stack* (`01m03xa8cw`), runtime superseded by *Runtime is Bun 1.3.14 stable* (`01m04je8az`)

| Layer | Choice |
| --- | --- |
| Runtime | **Bun 1.3.14 stable**, pinned exactly |
| HTTP | **Hono**, via `hono/bun` |
| Storage | **`bun:sqlite`** — WAL, `busy_timeout = 5000`, **no FTS5** |
| ORM / migrations | **Drizzle**, `generate` only |
| Scheduler | **`Bun.cron`** OS-level jobs |
| Frontend | **React + Vite + TanStack Router + TanStack Query** |
| PWA build | **`vite-plugin-pwa`**, `injectManifest` mode |
| Push | **`web-push`** |
| Tests | **Vitest** |
| Lint | TypeScript `strict` + Biome |
| Repo | Single package — `client/`, `server/`, `shared/` |

**Bun 1.4 does not exist and never did** — the published version list ends at 1.3.14
(13 May 2026), and the `canary` tag sits at `1.3.13-canary` *behind* stable. Everything
this design needs is in 1.3.14: `Bun.cron`'s OS-level form shipped in 1.3.11, its
in-process form in 1.3.12. There is no canary risk to mitigate.

**Guardrails, each with its reason:**

- `drizzle-kit generate`, **never `drizzle-kit push`** outside a throwaway database.
  `strict: true`, so drizzle-kit refuses destructive migrations.
- **Read every generated migration before committing.** SQLite's 12-step table rebuild is
  where data silently vanishes.
- **Commit the Drizzle meta snapshots** — the diff baseline; losing them corrupts future
  generation.
- `drizzle-kit` needs a `bun --bun` prefix, or it looks for `better-sqlite3` and fails.
- **No further Bun-specific APIs beyond `bun:sqlite` and `Bun.cron`.** Keeping the retreat
  to Node cheap is why Hono was chosen over Elysia.
- **No FTS5.** At ~765 variants a `LIKE` scan is microseconds.
- If the schema wants JSON, use the **text** functions, not `jsonb`.

**Processes and connections.** `Bun.cron`'s OS-level form registers a real crontab entry
that runs a **separate process**. Therefore:

- The scanner, the digest sender and the backup job are **separate module files**, each
  default-exporting `{ scheduled(controller) }`. None can be a closure inside the HTTP
  server.
- **One SQLite connection per process, not one globally.** Writes do not serialise for
  free across processes; **WAL plus `busy_timeout = 5000` is the actual concurrency
  story**, including a ~1-second `VACUUM INTO` running against a live writer.
- Registration is idempotent: re-registering a title overwrites in place, so the server
  may register its jobs on every boot.

**Service worker.** Hand-authored (`injectManifest`) because Workbox's generated worker
cannot host a custom `push` handler. Ship with `registerType: 'autoUpdate'`,
`clientsClaim`, `skipWaiting`, `registration.update()` on `visibilitychange`, and
**`Cache-Control: no-cache` on the worker script itself** — otherwise a cached worker
pins the phone to old code permanently.

**The manifest must declare a non-default `display` value** (`standalone`,
`fullscreen` or `minimal-ui`). On iOS the `Notification` constructor throws
`ReferenceError` unless the page is a Home Screen web app whose manifest sets this.

### Deployment — *Where does the server run* (`01m03xa8ys`)

An always-on **Linux** box served at `<host>.<tailnet>.ts.net` via **Tailscale Serve** —
never Funnel. Tailnet-only. Linux over macOS because a Mac sleeps and a sleeping machine
misses scan windows silently.

**Supervision splits in two and they fail independently:** the scheduled jobs are
`Bun.cron` OS-level entries surviving restarts and reboots unsupervised; the HTTP server
is a long-lived process under `systemd Restart=always`, `RestartSec=10`. A dead web
server does not stop notifications arriving.

**Two reachability requirements, not to be conflated:**

| | Direction | Needed for |
| --- | --- | --- |
| Origin reachability | iPhone → box, HTTPS | install, open, register SW, `subscribe()`, **tapping a notification** |
| Push delivery | box → Apple (**outbound 443**), Apple → phone | send time only |

The server is always the HTTP *client* at send time and payloads are encrypted end to
end, so a residential-NAT box needs only outbound 443 — no port forwarding, no static IP,
no dynamic DNS.

**Secrets** live in a root-owned `0600` environment file: `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `BACKUP_AGE_RECIPIENT`
(public key only), `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY_ID`,
`BACKUP_S3_SECRET`, `RELIST_HASH_SALT`, and `VAPID_SUBJECT` (a `mailto:` or `https://`
URL, required in the JWT).

**`VACUUM INTO` cannot capture this file** — it copies a SQLite database and the secrets
live outside it. **The backup job must archive the environment file alongside the
snapshot**, or a restore silently omits the VAPID private key and destroys every
subscription. The `RELIST_HASH_SALT` has the same property: lose it and the relist guard
stops matching after a restore.

**Application-level authentication is deliberately absent.** The map fixed "single user,
no account system; auth exists only to keep the internet out", and a tailnet-only origin
does that. See *Out of Scope*.

### The masterset — *What is in the masterset* (`01m03xa78k`)

**A row is one variant, in one language.** Identity is **`(card_id, variant_id)`** —
never `variant_id` alone, which is a hash of the attribute set and is shared across
different cards.

| Axis | Splits a row? |
| --- | --- |
| Language | **Yes** — English `sv03-002` and Japanese `SV3-002` are two collectibles |
| Print variant | **Yes** — finish and stamp, below |
| Grading | **No** — lives on the copy |
| Per-object defect | **No** — not modelled anywhere |

**The print-variant axis is FOUR independent attributes, not one.** The first draft named
it four different ways and collapsed them into one enum; a live inspection of TCGdex's
`variants_detailed` shows the upstream shape is genuinely multi-axis:

| Field | Role | Observed values |
| --- | --- | --- |
| `finish` (upstream `type`) | print finish | `normal`, `holo`, `reverse` |
| `subtype` | print run | `unlimited`, `shadowless`, `shadowless-red-cheek`, `1999-2000-copyright`, `missing-expansion-symbol` |
| `stamp` | **array** of stamps | `1st-edition`, `set-logo`, `bulbasaur`, `chris-fulop`, `ross-cawthorn` |
| `foil` | foil pattern | `cracked-ice`, `energy`, `pokeball`, `masterball` |
| `size` | card size | `standard` |

Three things this settles that the first draft got wrong:

- **`1st-edition` is a `stamp`; `shadowless` and `unlimited` are `subtype`s.** They are
  different fields and cannot share one enum.
- **`stamp` is an array** — a variant may carry several at once, so it is stored as a
  sorted, canonicalised list and matched as a set, never as a scalar.
- **`foil` exists and is a real collecting distinction** (`cracked-ice` versus `pokeball`
  holo patterns). It was absent from every earlier draft.

`shadowless-red-cheek` is a genuine Base Set distinction the glossary did not anticipate.
All axes are independently filterable in the binder.

**Ignore the flat `variants` object.** TCGdex returns a legacy
`{firstEdition, holo, normal, reverse, wPromo}` object alongside `variants_detailed`, and
the two **disagree**: `base1-58` reports `normal: true` in the flat object while
`variants_detailed` enumerates six distinct printings. Only `variants_detailed` is
authoritative.

**Membership** is TCGdex `dexId ∈ {43, 44, 45, 182}` **unioned with** a name-contains
sweep for the four species. Both halves are needed: `dexId` alone misses records where
the field was unset; the name sweep alone pulls in false hits.

**Excluded:** TCG Pocket digital-only cards (set-ID prefixes `A#`, `B#`, `P-A` — filter
before counting anything), non-TCG physical items (Topps, Bandai Carddass, Amada, vending
prints, stickers, jumbo), sealed product, and cards that merely picture the line.

**The error line:** a **print-run distinction** affected a whole batch as it left the
press and earns a variant row. A **per-object defect** — miscut, ink error, colour shift,
crimp, off-centre cut — happened to one physical card and is **not modelled anywhere**:
no variant row, no field on a copy, nothing to count, filter or sort on. It may appear as
prose in a note. Defects are not data, but they can be remarks.

### Data invariants

**These are the constraints that must hold. The schema is the builder's to write.**
Where a rule below is violated the application is wrong, whatever the DDL looks like.

#### Identity

- **A card is identified by `(language, set_id, local_id)`.** Language is *part of
  identity*, not a column beside it. TCGdex serves the same western set IDs across
  en/fr/de/it/es/pt, so a key of `{setId}-{localId}` alone would silently overwrite five
  languages on the sixth ingest pass. Whether that is a composite key or a synthesised
  string is a build choice; **that language participates is not.**
- **A variant is identified by `(card identity, variant_id)`.** Never `variant_id` alone:
  in the real corpus one `variant_id` is shared by **90 different cards**. `variant_id` is
  also not always hash-shaped — the literal string `"generated"` occurs — so treat it as an
  opaque token.
- **Hand-added cards and variants get identities in a reserved namespace** that upstream can
  never mint. A Korean printing has no upstream card to inherit from, and a future TCGdex
  addition of that language must not collide with the hand-made row.
- **Any identity that appears in a URL path must survive path encoding**, and must not
  collide with the reserved-namespace marker.

#### The variant model

Five independent axes, from TCGdex `variants_detailed`: **`finish`** (normal/holo/reverse),
**`subtype`** (unlimited, shadowless, shadowless-red-cheek, 1999-2000-copyright,
missing-expansion-symbol), **`stamps`** (a **list** — 1st-edition, set-logo, bulbasaur,
chris-fulop, ross-cawthorn), **`foil`** (cracked-ice, energy, pokeball, masterball), and
**`size`**.

- `1st-edition` is a **stamp**; `shadowless` is a **subtype**. Different fields.
- **`stamps` is a list**, canonicalised and order-independent. A variant may carry several.
- **`finish`, `subtype`, `stamps` and `foil` are filterable**; `size` is stored, not filtered.
- **Ignore the legacy flat `variants` object.** It disagrees with `variants_detailed` —
  `base1-58` reports one printing there and six in the detailed form.

#### What must never be stored

- **No eBay seller username, in any table, in readable form** — per `01m04nwvnj`. Observed
  listings are stored as a **field whitelist** applied at the eBay client boundary; the
  seller object never reaches disk. The only permitted derivative is a salted one-way hash
  used solely as a relist dedupe key, never displayed.
- **No per-object defect field.** Not an enum, not a boolean, not a sortable column. Defects
  may appear only as prose in a copy's free-text note.
- **No learned artefact derived from eBay content** — no embedding, no trained ranker, no
  synthetic data set. eBay's prohibition is broader than fine-tuning and is not limited to
  personal information.

#### Retention

- **Everything eBay-derived expires at 90 days** — the whole listing record, not merely a
  payload column, since the whitelist *is* eBay content. The relist hash expires with it.
- **the seen-set never expires.** It holds an opaque item identifier and a timestamp,
  nothing of eBay's, and it is what stops a relist re-notifying at day 91.
- **The owner's data never expires**: copies, photographs, hand-added rows, aliases,
  exclusions, confirmations, priorities, notification history.
- **A snapshot must never contain eBay content already past its live retention** — expire
  before snapshotting, or the backup window silently doubles the payload's life.

#### The confirm queue

A listing's queue membership is **explicit state**, not inferred from a confidence score.
The states that must be distinguishable:

```
unattempted        matcher never scored it
auto_matched       resolved above threshold, never queued
queued             awaiting the owner
resolved           owner confirmed or picked a variant
not_a_match        owner rejected it — never re-queues, never re-asks
```

`not_a_match` and `unattempted` must not share a representation, or the queue either
re-asks forever or cannot be emptied.

#### What must survive a corpus re-import

Hand-added cards and variants; the exclusion list; aliases; confirmations; priorities;
copies and their photographs. **A re-import must never delete, renumber or orphan any of
them.** A variant that vanishes upstream is flagged and kept, never deleted.

#### What must survive an export round-trip

The export is the artifact designed to outlive the application, so it must carry
**everything the owner authored, including hand-added *cards*** — not just hand-added
variants, which would otherwise restore pointing at cards that cannot exist. Export rows
join on identity, never on display strings.

**Owner photographs are deliberately excluded** and therefore have only snapshot-level
durability. Recorded as chosen, with its consequence stated: the five-year artifact does
not carry the scans.

#### Client-authored rows

Rows the client can create — copies, photographs, hand-added rows, aliases — carry
**client-generated identifiers**, so an outbox replay is idempotent. Replaying the same
create twice yields one row.

### Contract requirements

The client needs the capabilities below. **Route shapes are the builder's choice**; these
are the constraints on them.

- **The binder is one cacheable document** containing every variant, ownership state and
  the completion inputs. It is what makes offline browsing and client-side filtering work,
  so it must be a single request, must be cacheable, and must not be paginated.
- **A listing detail route must resolve on a cold load**, because it is the notification tap
  target and the service worker may have no warm state.
- **An import route must exist**, or the export's re-importability is untestable and the
  stated guarantee is false.
- **Corpus sync and the backfill are long-running jobs, not requests.** Each needs a way to
  start, a way to observe progress, and a completion marker that survives a restart — so a
  reboot mid-backfill neither restarts it from scratch nor leaves the forward scanner armed
  against a half-swept market.
- **Health reporting is server-side state only** — last scan per marketplace, last verified
  backup, corpus last synced. **The outbox pending count is client state** and is surfaced
  by the client; the server cannot know it.
- **Every mutation the outbox may replay needs an endpoint**, including alias creation and
  priority changes.

### Conventions

**Time.** All stored instants are **UTC epoch milliseconds**. Calendar dates that are not
instants — `acquired_at`, `rate_date`, `disposed_at` — are **ISO `YYYY-MM-DD` strings**.
A single `timezone` setting holds an IANA name, set at commissioning; digest times and
cron schedules are interpreted in it, and elapsed-time displays are rendered in it.

**Money.** `*_minor` INTEGER in the currency's minor units, always paired with an ISO 4217
`currency` TEXT. Never a float, never a bare number. `price_home_minor` is paired with
`home_currency`, and `rate_date` records when the conversion was taken. If
`price_home_minor` is set, `home_currency` and `rate_date` must be too.

**Grade.** INTEGER in tenths (`PSA 8.5` → `85`), so half grades and the listing-side
parsed grade compare exactly. `grade` requires `grader`.

**Identifiers.** Rows the client can create — copies, photos, hand-added rows, aliases —
use **client-generated UUIDs**, so an outbox replay is idempotent.

**Hashing.** The relist seller hash is **HMAC-SHA-256 keyed by `RELIST_HASH_SALT`**, so
fixtures are portable and the value is stable across a restore. Named because two builders
would otherwise pick different functions and no test fixture would transfer.

### Configuration

Every tunable is persisted server-side and editable on a **settings screen**, which is a v1
surface. Values below are **starting points to be tuned against real data**,
not rulings.

| Key | Default | Notes |
| --- | --- | --- |
| `timezone` | set at commissioning | IANA name |
| `scan_interval_minutes` | 10 | |
| `scan_cursor_overlap_minutes` | 5 | re-scan window guarding clock skew and boundary relists |
| `scan_keywords` | the four species names | one call per (keyword, marketplace) |
| `scan_marketplaces` | US, GB every cycle; DE, AU every 4th | |
| `match_confidence_threshold` | 0.85 | 0–1; `>=` auto-matches, `<` queues |
| `priority_instant_level` | 3 | priority is 0–3; 3 pushes instantly |
| `digest_times` | 08:00, 19:00 | in `timezone` |
| `staleness_red_minutes` | 60 | banner turns red past this since last success |
| `gap_recovery_minutes` | 30 | a gap worth one recovery push |
| `backup_debounce_minutes` | 10 | real minutes-scale, per `01m04b901s` |
| `relist_guard_days` | 30 | |
| `relist_title_similarity` | 0.90 | normalised similarity above which titles count as the same |
| `relist_price_tolerance` | 0.10 | ±10% |
| `push_ttl_seconds` | 86400 | must be positive or Apple returns `BadTtl` |
| `category_ids` | `{US: 183454}` | per marketplace; GB/DE/AU resolved via the Taxonomy API |
| `ingest_languages` | derived on sync | every language TCGdex carries for the line |
| `daily_call_budget` | 4000 | leaves headroom under the 5,000/day quota |
| `backfill_horizon_days` | 3650 | how far back the initial sweep reaches |

**Steady-state budget, from these defaults:** 144 cycles/day × (2 marketplaces every cycle
+ 2 every fourth) = 360 marketplace-cycles × 4 keywords × 2 requests (plain + aspect
sibling) = **2,880 calls/day** before paging, against 5,000. Roughly 42% headroom, and
paging eats into it — which is why the budget key exists and why per-item enrichment is out
of scope.

**Schedules are OS-level cron entries registered at boot, so changing a schedule setting
requires re-registration.** A settings screen that edits `scan_interval_minutes` or
`digest_times` must trigger that re-registration, or the stored value and the running job
silently disagree.

### Copies — *What does the app record about a copy you own?* (`01m03xa7ty`)

One row per physical card, pointing at exactly one variant.

| Field | Required | Notes |
| --- | --- | --- |
| `variant_id` + `card_id` | **yes** | exactly one variant |
| `condition` | no | `NM` / `LP` / `MP` / `HP` / `DMG` — omitted for graded slabs |
| `grader` | no | PSA / BGS / CGC / SGC / ACE |
| `grade` | no | integer tenths; requires `grader` |
| `cert_no` | no | free text, ≤30 chars; uniquely identifies this physical slab |
| `price_minor` + `currency` | no | never a bare number |
| `price_home_minor` + `home_currency` + `rate_date` | no | captured at purchase |
| `acquired_at` | no | ISO date |
| `source_type` | no | `ebay` / `shop` / `trade` / `gift` / `auction` / `other` |
| `source_note` | no | free text, typed by the owner |
| `note` | no | free-form prose |
| `status` | **yes** | `owned` / `disposed` |
| `disposed_at` | no | required when status is `disposed` |
| `disposal_kind` | no | sold / traded / lost |

Home currency is **AUD**. The rate is **entered by hand; there is no FX API**.

**The condition ladder is the TCGplayer/Cardmarket one, and it is NOT eBay's** — per
*Condition ladder is retained, but the eBay-vocabulary claim is withdrawn*
(`01m04k28t8`), which supersedes that claim in `01m03xa7ty`. eBay's Card Condition
vocabulary has four values (Near mint or better / Excellent / Very good / Poor) and no
rung for a damaged card. The ladder is kept because it is what the hobby uses, not
because it maps onto anything.

**Card condition cannot be read from a search result at all.** For trading cards
`conditionId` encodes only **graded (`2750`)** versus **ungraded (`4000`)**; the real
condition lives in `conditionDescriptors`, which is on the Browse `Item` schema and
**absent from `ItemSummary`**. Obtaining it costs one `getItem` call per listing — the
per-item enrichment ruled out of scope. Three consequences, all binding:

- **Listings carry graded/ungraded only.** The raw-only and graded-only hunting filters
  still work, because that binary *is* on `ItemSummary`.
- **Notifications must not include a listing's condition.**
- **Never map `conditionId` to a condition for trading cards.** `4000` displays as "Very
  Good" and tokenises as `USED_VERY_GOOD` but means *ungraded*; a naive mapping reads
  every raw card on eBay as "Very Good".

**Never hard-code eBay condition descriptor IDs.** eBay does not publish them statically
and directs integrators to `getItemConditionPolicies` per category per marketplace. The
certification-number descriptor is confirmed as a concept — optional, free text, ≤30
characters, graded cards only, with Grader and Grade required alongside — but the ID
`27503` cited in `01m03xa7ty` could not be verified in any primary source.

**Every ownership query filters on `status = 'owned'`.** This is the known cost of
retaining disposed rows and it is easy to forget exactly once.

**`seller.username` is never persisted in readable form.** Persisting eBay user data
removes the option to opt out of account-deletion notifications, which would force a
public HTTPS endpoint and kill tailnet-only hosting. The only permitted use of seller
identity is the salted hash in the relist guard: never displayed, never reversible,
expiring with the listing.

**Priority** is a field on the **variant**. There is no want-list — anything unowned is
implicitly wanted.

### Completion

**The numerator** is the count of variants with at least one copy at `status = 'owned'`.

**The denominator** is every variant **except** those flagged `missing_upstream` that the
owner does not own — per *missing_upstream variants leave the completion denominator
unless owned* (`01m04jea06`). An upstream deletion therefore cannot cap completion below
100%, while a card the owner physically holds never vanishes from the total.

The denominator is **not constant**. Invalidate any cached figure on corpus sync and on
copy creation or disposal.

**How completion is presented numerically is still open** and is not decided here.

### Corpus ingest — *How does the card corpus get in* (`01m03xaamk`)

**Every language TCGdex carries for the line is ingested** — per `01m04nwwsh`. Measured
live, that is en, fr, de, ja, es, it, pt, zh-tw, th and id; Korean and Simplified Chinese
are populated languages carrying **zero** Oddish-line records, which is why manual entry
exists. The language list is **derived on each sync**, not hard-coded, so a language gaining
its first record is picked up without a code change.

**Consequence to expect rather than fix: completion can go down after a sync**, because the
denominator grows when upstream adds a language or a variant. That is correct for a
masterset; the variant-count warning makes it visible rather than mysterious.

Two phases against TCGdex with **filtering done locally**, so a boundary revision costs a
re-filter rather than a fresh crawl:

```
1  per language, brief form
   filter LOCALLY:  dexId ∈ {43,44,45,182}
                    UNION name-contains {oddish, gloom, vileplume, bellossom}
                    MINUS TCG Pocket prefixes (A#, B#, P-A)
                    MINUS the exclusions table
2  per surviving card, detail form   (~475 fetches, politely paced)
   only detail carries variants_detailed
```

**Refresh is manual.** The app shows the last-synced date and does not check upstream.
Accepted consequence: **the corpus can drift silently**, and a newly released Gloom
arrives at the matcher as unmatched until a sync happens.

**Re-import safety — all mandatory:**

- Upsert key `(card_id, variant_id)`.
- **Never touch rows with `provenance = 'manual'`**, and never touch the exclusions table.
- A variant that vanishes upstream is flagged `missing_upstream` and **kept**.
- **Canonicalise `stamp` values on the way in.** Both `1st-edition` (18 occurrences) and
  `1st edition` (16) are live upstream in comparable numbers; missing this silently drops
  half the 1st Edition corpus — the filter still returns results, just the wrong ones.
  Canonicalise, then sort, then store as an array.
- Record `provenance` and `last_synced_at` per row.
- **Filter TCG Pocket sets by ID prefix, not exact match.** 15 of 218 sets are digital-only
  and there is **no flag distinguishing them** — and suffixed IDs like `A2b`, `B1a` and
  `A3b` mean an exact-match list would miss them.
- **Image URLs are case-sensitive in every path segment** — language, series, set and
  quality alike. `/EN/...`, `/SV/...` and `/LOW.png` all 404.
- **`datas.json` is a 6.4 MB single blob keyed by `localId` within a set nesting**
  (`language → series → set → localId → hash`), **not** by full card ID. The sync must
  reconstruct IDs from the nesting, and it has no conditional-fetch story of its own.

**Manual entry is clone-and-edit**, minting a fresh `manual:{uuid}` identity rather than
inheriting the source's. A blank form remains available.

**The gap it fills is measured, not assumed.** TCGdex carries Korean (95 sets, 239 cards)
and Simplified Chinese (57 sets, 877 cards) as populated languages, yet returns **zero
Oddish-line records in either** — confirmed by `dexId` query and independently by
native-script name search (`뚜벅쵸` → 0, `走路草` → 0), with a Traditional Chinese control
returning 6 to prove the technique sound. Traditional Chinese **does** carry the line (19
records) and arrives through normal ingest.

### Image storage — *Images are stored as BLOBs in SQLite* (`01m04b901s`)

All images are BLOBs. There is no image directory. Corpus images are `high.webp` (~59 KB
each, ~21 MB for the line), synced incrementally against TCGdex's per-card image hash
manifest.

**Owner photographs are resized and recompressed to webp at ~1600px long edge on
upload** — part of the decision, not an optimisation: a raw iPhone photo is 3–5 MB.
Recompression also strips EXIF, removing GPS coordinates from photos taken at home.
**Resizing happens server-side on receipt**, so the outbox never parks multi-megabyte
blobs in IndexedDB.

Expected database size ≈ **125 MB**. `VACUUM INTO` is therefore ~1 second, not ~1
millisecond, which is why the write-triggered backup needs a real debounce.

### eBay scanning — *Which eBay API surfaces newly-listed cards* (`01m03x9xfd`)

**The Browse API's item-summary search**, with **OAuth client credentials** — a two-hour
token, no refresh token, no user consent, which is the best possible answer for an
unattended box.

**A one-time backfill runs first**, per *The scanner backfills existing inventory once at
commissioning* (`01m04mt0sv`). The forward cursor can only ever see listings created after
it starts, so without a backfill the app launches blind to the entire existing market —
~25,000 active Gloom listings in the US category alone.

**Deep paging is capped at 10,000 items, which is less than the inventory**, so the backfill
cannot simply page to exhaustion. It sweeps **backwards in `itemStartDate` windows**,
narrowing any window whose result count approaches the cap, until it reaches a configured
horizon. This is the same slicing the forward scanner uses after an outage.

**The backfill is a job, not a request.** It needs a start trigger, observable progress, and
a **persisted completion marker per marketplace** — so a reboot mid-sweep resumes rather than
restarting, and the forward scanner is not armed against a half-swept market. Until a
marketplace's backfill is marked complete, its forward cursor does not run.

**It may exceed a day's quota and must be allowed to span days.** A full sweep across four
keywords and four marketplaces plus the aspect sibling is plausibly more than 5,000 calls.
The backfill therefore obeys a **daily call budget**, checks remaining budget before each
page, and resumes the next day. **Every eBay job handles 429 with backoff**; none assumes
quota is free.

**The backfill does not notify.** It seeds the seen-set so the first forward cycles
re-notify nothing, and the owner browses the backfilled feed directly.

Per cycle, per (keyword, marketplace):

- **`itemStartDate` as a cursor**, seeded from that marketplace's `last_scanned_at` minus
  `scan_cursor_overlap_minutes`. **This filter keys off `itemOriginDate`**, as does
  `sort=newlyListed` — both documented, so no hedging is needed.
- **`buyingOptions`: either omit the filter entirely, or pass `{FIXED_PRICE|AUCTION}`.**
  The hazard is real but was described backwards in earlier drafts: an auction that has
  received a bid disappears **when you filter on `FIXED_PRICE`**, not as a default eBay
  imposes on an unfiltered query. **If this filter is used it must be against a leaf
  category ID** — 183454 is a leaf, so this holds, but against a top-level ID the filter
  silently returns nothing.
- sort by newly listed, category 183454 for US;
- **an aspect-filtered sibling request** unioned on `itemId`;
- **an `itemId` dedupe set regardless.**

**`itemOriginDate` is retained across a relist**, so a relisted item never re-enters a
newest-first window. The relist guard therefore has a narrower job than first described —
it catches a seller *ending* a listing and creating a genuinely new one, which produces a
new `itemId` and a new `itemOriginDate` and is visible. It is not dead code.

**Do not copy eBay's own `itemStartDate` examples verbatim** — the partial-range examples
in their filter reference say `itemEndDate` where they mean `itemStartDate`.

**Paging:** follow `next` until exhausted or a per-cycle cap is hit. A catch-up window
after an outage can exceed one page, and deep paging is capped at 10,000 items — so if a
window would exceed the cap, **narrow it and advance in slices** rather than skipping.

**Failure semantics:** `last_scanned_at` advances **only on a successful, fully-paged
scan** for that marketplace. On failure, increment `consecutive_failures`, leave the
cursor, and retry next cycle. "Last successful scan" for the staleness banner is the
**oldest** `last_success_at` across enabled marketplaces — the banner should reflect the
worst-served marketplace, not the best.

**Three eBay terms with teeth:**

- **Six-hour display freshness**, quoted: *"Displayed item listing information may not be
  more than six (6) hours older than information displayed on the eBay Site"* — **and it
  carries a disclosure obligation**: *"you will disclose in your Application how much older
  your displayed item listing is."* Enforced concretely: a listing older than six hours is
  shown **without its price**, carrying its "seen at" stamp and an outbound link, and the
  UI states the age explicitly rather than merely timestamping it. Nothing re-fetches a
  listing, so "current listings" on the variant sheet means *observed within the window*.
  A separate **24-hour** bound applies to non-listing eBay content.
- **Intermediate copies only** — *"All intermediate copies must be deleted when they are no
  longer required for the purpose for which they were created"* — the 90-day retention.
- **No training on eBay content, and the ban is broad.** Quoted: *"Use eBay Content,
  including without limitation any Personal Information, to train algorithms, conduct
  machine learning, **develop synthetic data sets**, train large learning models, and/or
  train artificial intelligence systems."* It is **not** limited to personal information
  and **not** limited to fine-tuning. A locally-trained embedding or a learned ranker over
  listing titles is squarely prohibited. **The deterministic, rules-based matcher is
  therefore required, not preferred**, and the owner-authored alias table is what makes
  improvement possible without learning from eBay content.

### Matching — *How does a listing resolve to a card* (`01m03xa9gz`) and *card-grain matching* (`01m04je9e7`)

The corpus is **small and closed** — every card name, set name and number is a known local
string — so matching is a lookup problem, not a guessing one.

```
1  CHEAP FILTER      category + name regex + proxy/custom-art exclusion
2  PARSE TITLE       name -> set -> number -> subtype/stamp -> finish -> language
3  SCORE + GRADE     confidence, and the grain the title actually supports
4  RECORD            payload + match + confidence + matcher version
```

**The matcher's return shape is a resolution, not a variant:**

```
{ grain: 'variant' | 'card' | 'none',
  card_id?, variant_id?, candidates?,      // variant_id ONLY when grain is 'variant'
  language, confidence,
  is_lot, lot_names?,
  filter_verdict, filter_reason?,
  parsed_grader?, parsed_grade? }
```

**Card-grain matching is the ordinary case.** `Gloom Jungle 44/64` names a card and leaves
four variants live. Resolving to the card and recording the candidates lets the push rule
still answer the only question it needs:

| Owner holds | Needed? | Action |
| --- | --- | --- |
| none of the card's variants | **yes, certainly** | qualifies, no disambiguation |
| all of the card's variants | **no, certainly** | suppressed, no disambiguation |
| some of them | unknown | confirm queue |

**A card-grain match never writes ownership state.** Nothing is auto-matched to a variant
on a guess, so the precision bias is intact.

**Precision over recall.** A wrong auto-match is silent, persistent and may never be
discovered; a queued listing is visible and self-correcting. **Language falling through to
the English default reduces confidence**, since a defaulted language resolves to a
different card and that is exactly the silent error the bias forbids.

**Corrections become aliases, never per-listing overrides**, so a relist never re-asks.

**An alias may resolve to a variant, not only a card** — per `01m04nww7n`, which amends the
card-grain ruling. Without this the queue never drains for partly-owned cards: the alias
would teach only the card, which card-grain matching had already resolved, so the next
listing would ask the same question again. Since that is the ordinary state of a masterset
in progress, it was the dominant path.

**The carve-out, stated precisely:** the *matcher* still never guesses a variant. An owner
confirming in the queue is not a guess, and that resolution is recorded and generalises.

| Source of a variant resolution | May write ownership state |
| --- | --- |
| Matcher inference from a title | **No** |
| Owner confirming in the queue | **Yes** |

Aliases remain owner-authored at either grain, so eBay's training prohibition is untouched.

**Lots are flagged and never resolved.** **Proxies and custom art are filtered and
logged, never silently dropped.** **Grade is parsed onto the listing and plays no part in
variant selection.**

**Observed listings are stored as a field whitelist, never a raw payload** — per
`01m04nwvnj`. A raw Browse summary contains `seller.username`, and storing it would be the
largest readable copy of eBay user data in the design, forfeiting the opt-out that keeps
hosting tailnet-only. The whitelist keeps everything the matcher reads — title, price and
currency, buying option, graded/ungraded, item URL, location country, origin date, result-set
aspects — and the seller object never reaches disk.

**Matcher re-runs are unaffected**: the matcher only ever reads the title and metadata, so
a rolling 90-day evaluation window against real listings survives intact, which is the whole
reason `matcher_version` is recorded. At 90 days the **entire listing record** expires, not
merely a payload column, since the whitelist is itself eBay content. the seen-set survives
independently and holds nothing of eBay's.

### Notifications — *What earns a push* (`01m03xaa33`), superseded on the trigger by *The price ceiling is dropped* (`01m04je8wa`)

**Transport is Declarative Web Push** (iOS 18.4+), with a classic service-worker handler
for iOS 16.4–18.3. **A subscription record carries which transport it supports**, captured
by the client at subscribe time and sent with the subscription; the server sends the
matching payload shape and never both. Absent that flag, assume the classic path — it works
everywhere, where a declarative payload to an older client simply fails.

**A listing pushes when all hold:** it matched with sufficient confidence; the variant —
or the card, at card grain — is **not owned**; and it is not a lot, proxy or custom art.
Then **priority at or above `priority_instant_level` pushes instantly; everything else
lands in the next digest. Instant pushes are also listed in that digest**, so one lost to
the platform's single-message queue resurfaces within ~12 hours.

**There is no price gate.** An absolute ceiling cannot tell a deal from a rip-off without
market comparison, which is out of scope, and one number cannot be meaningful across a
line spanning $2 to $400.

**No quiet hours** — a sniped auction is worse than a 3am buzz.

**Dedupe:** a the seen-set hit never re-notifies; and a ~30-day relist guard on hashed
seller + title similarity + price tolerance suppresses re-notification under a new
`itemId`.

**Content must be self-sufficient.** A tap cannot resolve off-tailnet — the `navigate`
target is same-origin and the origin is tailnet-only — so the notification itself must
carry enough to make the go/no-go call: card, set, language, finish, price with currency,
graded/ungraded, and format.

```
INSTANT   title  Gloom – Jungle JA holo
          body   ¥4,200 – ungraded – auction 3d

DIGEST    title  7 cards you need
          body   Gloom ×3, Vileplume ×2, Bellossom ×2
```

**Condition is not available** — only graded/ungraded, per the copies section. Any
template implying a condition grade is wrong.

**A digest carries no prices.** It may summarise up to ~12 hours after observation, and the
six-hour display rule binds on *display* — a notification is display. An instant push is
sent within a scan cycle of observation, so it may carry a price; a digest may not. It
names cards and counts, and the app carries the prices.

Front-load identity; the Dynamic Island shows only the title and the first few words.
Target ≤~35 characters of title, ≤~100 of body — engineering targets, not platform rules.

**Platform constraints, verified against WebKit source, MDN and Apple's documentation:**

- **No images. No action buttons** — there is no `actions` key in WebKit's notification
  payload parser at all.
- **`tag` does not coalesce** on iOS; **`icon` is ignored** in favour of the manifest icon.
- Payload ≤4096 bytes encrypted (~3993 plaintext per RFC 8291 §4). Budget ~3.5 KB.
- **A positive TTL is mandatory.**
- **Do not read properties back off a `Notification` instance on iOS** — several,
  including `title` and `tag`, are not readable.
- **APNs stores one notification per bundle ID**, and the survivor is "in most cases" but
  **not guaranteed** to be the latest. This is why a digest summarises rather than queues.

**The silent-push rule is load-bearing.** The service worker must call
`showNotification()` **unconditionally**, from the encrypted payload, inside
`waitUntil()` — **never after a fetch to the origin**. Each push independently arms a
30-second timer; failures accumulate on a counter that **never decays and is never
credited by success**; the third revokes **every subscription for the origin**. The only
route back to zero is a full unsubscribe and re-subscribe, which costs a user tap.
Declarative Web Push is **exempt** — WebKit skips the silent-push queue for declarative
messages — which is the strongest reliability reason to prefer it.

**Subscriptions die undetectably.** `pushsubscriptionchange` is not implemented on iOS;
absence of a 410 is not evidence of life. The server is the source of truth for *what
subscriptions exist*; it cannot know which are live. Ship a permanent, gesture-gated
**re-enable notifications** button — on iOS, `subscribe()` needs a tap even when
permission is already granted.

**Onboarding.** Home Screen installation is required. iOS 26 lets the user turn "Open as
Web App" off, producing a bookmark with no Push API — detect at runtime via standalone
display mode **and** Push API presence. **A soft-ask before the system prompt is
mandatory**: denial is effectively permanent and there is one chance.

**The badge is a lagging indicator.** It counts qualifying listings the owner has not yet
seen, and refreshes only when a notification is shown or the app is opened.

**"Seen" has one definition: the listing has been rendered in the feed with the app in the
foreground.** The count is **server-derived** — the server knows which listings qualified
and, from a client acknowledgement on app open, how far the owner has read. The client
acknowledges; the server counts. A badge computed independently on each side would drift.

**Scanner failure detection** is deliberately not push-based: an in-app staleness banner
on every open, red past `staleness_red_minutes`; one push on gap recovery; the badge as a
passive secondary.

### The client — *What are the PWA's screens* (`01m04bb8bb`) and *Offline writes* (`01m04b91r3`)

Five rulings survive from three rejected prototypes, and **nothing else from them carries
forward**:

- **The binder view is the app** — a visual grid where owned and needed are obvious.
- **The Gap is a filter, not a screen.**
- **Interaction opens a bottom sheet**, keeping the binder as context.
- **No aggregate density map.**
- **Dense, precise, typographic** — not ornamental.

**Still explicitly not decided:** how completion is presented numerically, the sheet's
layout, and the shape of the feed, confirm queue and lots surfaces. **Do not infer them
from the prototypes.**

**Surfaces:** binder; variant sheet; listing feed; confirm queue (confirm / pick-other /
not-a-match, plus variant disambiguation for card-grain matches); lots view; collection
entry with clone-and-edit; a listing detail route that resolves on cold load; settings;
and health surfaces (last scan, last backup verified, corpus last synced, outbox pending).

**The binder's default order is set release date descending, then card number**, with
language and species as filters rather than groupings. It needs **virtualisation** — ~765
cells. **Filters are multi-select within an axis (OR) and conjunctive across axes (AND)**,
serialised into typed URL search parameters.

**Offline.** The variant list, ownership state and completion inputs are served as **one
cacheable request** — ~765 rows, a few hundred KB — and **filtering happens client-side**.
With the image cache warmed, the binder browses and filters with no connection. This is
not a local database and not a sync engine; it is one cached JSON document.

**Writes queue in an outbox in IndexedDB and replay in order on reconnect.** TanStack
Query supplies offline mutation persistence. **Replay is idempotent because
client-generated UUIDs are the primary keys** — a create whose response was lost replays
into the same row rather than a duplicate. Outbox-eligible mutations are copy
create/update/dispose, priority changes, match confirmations and alias creation. **Photo
uploads are not outbox-eligible** — they are multi-megabyte and are held until
reconnection with an explicit pending state. One user, one device, so last-write-wins is
sufficient.

### Backup and restore — *How is the collection backed up* (`01m042kp8g`)

**Everything lives in one SQLite file**, images included, and `VACUUM INTO` is the
mechanism — `bun:sqlite` has no incremental backup API, only whole-database
serialisation into memory.

**Cadence:** daily via `Bun.cron`, plus a snapshot debounced by
`backup_debounce_minutes` after any collection write.

**Retention: 90 days for snapshots.** Note the arithmetic honestly: a payload ingested at
t=0 is purged live at t=90 but survives in a snapshot taken at t=89 until t=179. To keep
the intermediate-copies posture actually true rather than nominally true, **the backup job
purges expired payloads before snapshotting**, so no snapshot ever contains a payload
already past its live retention.

**Destination: encrypted, to cloud object storage and a local copy.**

**Encryption and dedup cannot both be had naively.** `age` encrypts each file under a fresh
ephemeral key, so two encryptions of a 125 MB database dedupe to nothing. **Resolution: use
`restic` against both destinations**, which chunks and dedups plaintext and manages its own
crypto.

**Stated plainly, because an earlier draft claimed otherwise: an automated backup needs its
credentials on the box, so the box can read its own backups.** The write-only property that
a public-key-only recipient would give is **not achievable** alongside automated
deduplication — one of the three had to go, and dedup is what makes the debounced cadence
affordable. The repository password lives in the same root-owned `0600` environment file as
the other secrets, and a copy is kept **off-box in a password manager** so a dead machine
does not take the only copy with it. That off-box copy is disaster recovery, not access
control.

Mitigations that remain available and are worth taking: use a repository password used
nowhere else, and enable append-only or object-lock semantics at the remote where the
provider supports it, so a compromised box cannot rewrite backup history even though it can
read it.

**The environment file is archived alongside the database snapshot**, since `VACUUM INTO`
cannot capture it and a restore without the VAPID private key destroys every subscription.

**Export — CSV and JSON, generated with every backup, kept indefinitely.** Contents: one
row per copy, plus manual variants, aliases, exclusions, match confirmations and
priorities. **Owner photographs are not in the export** — a deliberate choice: they remain
protected by the snapshot system in normal operation, and the export is text-only. The
consequence, recorded plainly: **the artifact designed to outlive the application does not
carry the scans.**

**Export rows join on identity**, not on human-readable columns, so re-import against a
freshly ingested corpus is exact. **Hand-added *cards* are exported too, not just hand-added
variants** — a Korean printing mints its own card record, and exporting only the variant
would restore it pointing at a card that cannot exist.

**The export is kept indefinitely and therefore does not live inside the 90-day-retention
snapshot repository.** It goes to a separate location with no expiry. It contains only the
owner's data — no eBay content — so indefinite retention carries no licence tension.

**Verification after every backup:** open the snapshot read-only; integrity check; compare
row counts against live for copies, variants, aliases and confirmations; confirm image
blob counts and bytes; record the timestamp and counts; surface beside the staleness
banner. **Additionally, verify the remote:** confirm the upload landed and that the
repository passes its own integrity check, since the artifact that must survive fire is
the remote one and a local-only check would not notice a disk that filled three weeks ago.

## Testing Decisions

Tests exercise **external behaviour** — what a function returns, what an endpoint
responds, what lands in the database. Nothing asserts on internal call sequences. This is
a greenfield repository, so these seams are the prior art; later work should use them
rather than adding new ones.

**Vitest is the runner**, executed **under Bun** (`bun --bun vitest`) so seam 4 can import
`bun:sqlite`. `bun test` was rejected for a mocked-clock state leak across files — and the
scanner's cursor logic is exactly what needs a mocked clock. **If that leak is
reproducible under Vitest-on-Bun too, the cursor tests must drive time through an injected
clock rather than a global mock.**

**1. The matcher — pure, and the highest-value seam.**
`(title, listing metadata, corpus snapshot, alias table) → resolution` returning the full
shape above. Fixture corpus, fixture titles: English catalog, vintage free-form, Japanese
kana and kanji, graded slabs, trainer-owned and mechanic variants, lots, proxies.

Cases that encode rulings rather than mechanics: `1st-edition` and `1st edition`
resolving identically; a `variant_id` colliding across cards resolving to the right
`(card_id, variant_id)`; language falling through title → country → English **and
lowering confidence**; **a card-grain result carrying candidates and no `variant_id`**;
a lot producing no variant link; a proxy filtered **and logged with a reason**; grade
parsed but not influencing selection; an alias making a previously queued title parse.

**2. Ingest and normalisation.** `(TCGdex records) → rows`. Union membership (dexId-only
hit, name-only hit, exclusion-list false positive), TCG Pocket exclusion **by prefix,
including suffixed IDs like `A2b` and `B1a`**, `stamp` canonicalisation across both
upstream spellings, **multi-stamp variants surviving as a sorted array**,
`(card_id, variant_id)` keying, **a `variant_id` of the literal string `"generated"` being
handled**, **the legacy flat `variants` object being ignored in favour of
`variants_detailed`**, and **manual identity minting** — a Korean clone getting a
`manual:` identity that cannot collide with its source or with a future upstream addition.

A regression test worth its own name: **two different cards sharing one `variant_id` must
produce two rows.** In the real corpus one `variant_id` is shared by ninety cards.

Re-import safety is tested **as behaviour against a real database**: a manual row survives
an import that does not mention it; the exclusions table survives; a vanished row is
flagged not deleted; a copy pointing at either still resolves.

**3. The notification policy — pure.**
`(match, collection state, config, seen set, notification history) → instant | digest |
nothing`. Each trigger condition independently and combined; **card-grain needed-ness**
(owns none → qualifies; owns all → suppressed; owns some → queue, never pushes); both
dedupe layers; **an instant also appearing in the next digest**; unmatched never pushing.
Payload construction is tested for size and for a same-origin in-scope `navigate` target.

**4. The HTTP API — Hono's handler against a real in-memory SQLite with migrations
applied.** **Do not mock the database.** Creating a copy; confirming a queued match and
observing the alias taught; adding a manual variant; disposing a copy and observing
completion change; **a `missing_upstream` variant leaving the denominator, and re-entering
it when a copy is added**; the filtered binder document; **replaying the same
client-generated UUID twice and getting one row**.

**The eBay client is faked at the HTTP boundary** with recorded fixtures — exercising
cursor arithmetic, the aspect sibling union, paging, and **per-marketplace cursor
independence** (a US-only cycle must not advance DE/AU). Failure semantics are tested: a
failed scan leaves the cursor and increments failures.

**The backfill has its own tests**: it pages to exhaustion; it seeds the seen-set for every
item encountered; **it sends no notification**; and the forward cycle immediately after it
re-notifies nothing it already recorded. Also tested: an item whose `itemOriginDate`
predates the cursor window is picked up by the backfill and **not** by the forward scan,
which is the exact gap the backfill exists to close.

**Retention jobs get their own tests**: the 90-day payload purge leaves the seen-set and
the match intact; the relist guard expires at its window; **a snapshot taken after the
purge contains no expired payload**.

**Backup and restore end to end** against a real temporary database: `VACUUM INTO`, run
the verification steps, assert counts; then **a restic round-trip** — back up, restore to
a scratch location, and assert the database opens and matches. Then the export
round-trip: generate, rebuild an empty schema, re-import, assert the collection is
reconstructed including manual variants and exclusions. **The export's re-importability is
a stated requirement, so it needs a test that fails if it regresses.**

**Also covered, because each is a stated guarantee:** EXIF stripping on photo upload
(assert no GPS in the stored blob); the six-hour rule (a listing observed >6h ago renders
without a price); that no code path writes a readable seller username; and that
`conditionId` is never mapped to a card condition — a fixture listing with `4000` must
surface as *ungraded*, never as "Very Good".

### What cannot be tested automatically

**iOS Web Push cannot be exercised in CI.** It needs a physical iPhone, a real HTTPS
origin and Home Screen installation. Worse, **the most dangerous defect — a worker that
fails to show a notification and burns a silent-push strike — is suppressed by design
whenever Web Inspector is attached.**

**Recorded honestly: there is no server-side detection for it.** The echo log observes the
send side only; the failure happens on-device and produces no server-visible signal. The
partial mitigations available are: choosing Declarative Web Push, which is *exempt* from
the penalty entirely and is the real answer; a **client-side heartbeat** that records, on
each app open, the notifications the client believes it displayed, so a divergence from
the server's sent-log is at least visible after the fact; and the commissioning checklist.
None of these detects the failure as it happens.

**Commissioning checklist**, run once on the real device:

1. Tailscale Serve up, cert issued
2. iPhone loads the site over HTTPS
3. Add to Home Screen with **"Open as Web App" confirmed ON**
4. Standalone display mode **and** Push API both present at runtime
5. Permission granted from a user gesture
6. `subscribe()` succeeds, endpoint stored server-side
7. Test push received
8. **Tailscale OFF on the phone, push sent, banner confirmed to arrive**
9. **Backfill run to completion**, the seen-set seeded, cursors set to now, forward scan
   armed

Step 8 is not optional: the outbound-only claim underpinning the hosting decision is
well-reasoned inference, **not a confirmed fact**. Step 9 must come last, so the backfill
does not race a forward cycle.

## Out of Scope

**Market price comparison** — ruled out and archived as `01m03xaxxs`. Needs a second paid
data source, a price history store and a currency model. Its absence is also *why* the
price ceiling was dropped: without a benchmark, an absolute number cannot identify a deal.

**Marketplaces beyond eBay** — Yahoo Japan Auctions, Mercari JP. Japanese cards reach the
US marketplace anyway; a single US search returns 4,227 Japanese-language listings. Revisit
once real coverage is measurable.

**`EBAY_JP` as a scanned marketplace.** Earlier drafts claimed it was absent from the Buy
API marketplace list. **That is false** — `EBAY_JP` is in the Browse `MarketplaceIdEnum`,
and eBay annotates marketplaces that no longer function (`EBAY_IN` carries such a note)
while Japan carries none. The practical conclusion is retained but the reasoning is
corrected: **eBay Japan closed as a consumer marketplace in 2004 and operates as a
cross-border export business**, so it is not expected to carry domestic Japanese
single-card stock. v1 scans US, GB, DE and AU. **Do not cite the enum as the reason.**

**Application-level authentication.** The tailnet is the perimeter. **Never ruled on:
whether any individual surface deserves a second factor.** Left open deliberately; it
blocks nothing and adding a gate later touches no schema.

**Per-object defects** — no row, no field, no filter, no sort. Prose in a note only.

**Non-TCG physical items and sealed product.**

**Per-item eBay enrichment** — one call per listing from the same 5,000/day pool.
Unaffordable at four-digit volume; viable later as targeted enrichment for high-priority
variants.

**LLM classification of titles — withdrawn entirely, not merely deferred.** Earlier drafts
kept it as a candidate fallback for the low-confidence tail. eBay's prohibited-uses clause
is broader than that framing assumed: it bans developing **synthetic data sets** and
training **large learning models** on eBay Content, without limiting itself to personal
information or to fine-tuning. Any path where observed listing text trains, tunes or seeds
a model is out. The deterministic matcher plus the owner-authored alias table is the design,
and it is **required** rather than chosen.

**An external watchdog** — the only thing surviving total server death, but another moving
part. The staleness banner is the v1 answer.

**Automatic corpus refresh** — declined in favour of manual control, with silent drift
accepted.

**An FX API** — rates entered by hand. With the price ceiling gone, nothing in the push
path needs conversion at all.

**Owner photographs in the export** — chosen deliberately; see Backup.

**A local-first client** — the cached binder document is not a step toward it. The upgrade
path stays additive.

## Further Notes

### Deliberately left to the build

These are real, they are named, and they are **not** reasons to delay. Each resolves faster
against running code and real data than against more discussion.

- **Confidence scoring.** The bias is decided (precision over recall) and the threshold has
  a starting value. The *function* — what signals contribute and how they weigh — is for the
  builder, tuned against the first week of real listings.
- **Digest membership and size bounds.** Whether a digest lists every qualifying card or
  truncates with a count, and at what size, needs a real digest to look at.
- **Confirm-queue and feed layout.** Explicitly undecided since the prototypes were
  rejected; deciding it on paper would repeat that mistake.
- **Where the corpus-sync and backfill progress surfaces live**, and how completion is
  presented numerically.
- **Retry, backoff and rate-limit specifics** beyond "handle 429 with backoff and respect
  the daily budget".

**Correct these as evidence arrives.** A ruling recorded here that turns out wrong under
real data is superseded with a new decision, exactly as five earlier rulings were during
this review.

### Unresolved, and named rather than papered over

**Completion has no oracle.** Nothing verifies the masterset contains what it should. A
membership regression that silently drops rows makes the denominator smaller and the
percentage *higher*, with every test still green. The number "765" has no independent
source. **Mitigation to build: record the variant count at each corpus sync and surface a
warning when it drops**, which converts a silent regression into a visible one without
needing an external oracle.

**Silent-push failure has no live detection.** See Testing Decisions.

### Facts to verify at build time

1. Real new-listings-per-day — currently an order-of-magnitude estimate. **Design for four
   digits.**
2. GB, DE and AU category IDs — only the US ID (183454) is confirmed. Resolve via the
   Taxonomy API; do not assume.
3. The Tailscale push test — checklist step 8.
4. **eBay condition descriptor IDs must be read at runtime** from
   `getItemConditionPolicies`, per category per marketplace — never hard-coded. The
   certification-number descriptor is confirmed as a concept but its ID is not.
5. The OAuth token's exact lifetime — treated as ~2 hours, unverified. Re-mint on 401
   rather than on a hard-coded expiry.
6. Whether the `buyingOptions` filter is needed at all, which depends on whether an
   unfiltered search returns bid-on auctions. Settle with one live call once a keyset
   exists.

**Everything else in this document that touches eBay or TCGdex has now been verified
against primary sources** — the decommissioning date, the 5,000/day quota, aspect
availability, the marketplace enum, deep-paging limits, keyset gating, Marketplace
Insights' restrictions, all three licence clauses, and every TCGdex claim including live
API calls confirming zero Korean and Simplified Chinese records for this line.

### Accepted risks

**Tailscale issue 19147** — an unresolved report that an iPhone cannot establish a secure
connection to Serve HTTPS endpoints. One report, not general breakage. If it bites, switch
ingress and reinstall the PWA. Load the site on the iPhone over HTTPS once before the
first Add to Home Screen.

**Card image licensing.** TCGdex's `LICENSE` is MIT, confirmed verbatim. **But TCGdex
nowhere publishes an image carve-out**, and nowhere attributes the images to TPCi /
Nintendo / Creatures / GAME FREAK — earlier drafts asserted a documented carve-out that
does not exist. The defensible statement is narrower: **the MIT grant covers "the Software
and associated documentation files" in that repository, and the card images are not in
that repository** — they are served from a separate host. So the grant does not reach them
by its own terms, and the underlying artwork is plainly somebody's copyright.

The conclusion is unchanged — hold images locally for a single-user private tracker, do
not redistribute them — but it is an inference from the licence's scope, **not something
TCGdex documents**. Accepted, not resolved.

**Origin permanence is a minor annoyance, not a constraint.** Four things bind to the
origin and die together if it changes, but the PWA is a thin client over server-side
SQLite: changing origin costs re-adding the icon, re-granting permission and one tap, and
**touches no collection data**. **Do not re-inflate this risk.**

### Cross-cutting constraints

Each sits inside one decision but can be broken from anywhere.

- **Never persist eBay seller usernames readably.** Only the salted relist hash.
- **Every ownership query filters `status = 'owned'`.**
- **The service worker never fetches the origin before `showNotification()`.**
- **Never key on `variant_id` alone.**
- **Never `drizzle-kit push` against the real database.**
- **Never delete a corpus row on import**; never touch a manual row or the exclusions.
- **Never display eBay listing data as current past six hours.**
- **Never let a card-grain match write ownership state.**
- **Never advance a marketplace cursor on a failed scan.**
- **Never map `conditionId` to a card condition.** For trading cards it means
  graded/ungraded, and `4000` reads as "Very Good" while meaning *ungraded*.
- **Never hard-code eBay condition descriptor IDs.**

### Glossary

Inlined so this document stands alone; the living source is *domain glossary*
(`01m041423p`).

**Oddish line** — Oddish, Gloom, Vileplume, Bellossom. Operationally, TCGdex
`dexId ∈ {43,44,45,182}` unioned with a name-contains sweep. Cameo art is out.

**Masterset** — every distinct variant in the line **physically printed** as a **Pokémon
TCG** card. Excludes digital-only, sealed product, and non-TCG items.

**Variant** — the unit of collecting, one row, one language. Identity `(card_id,
variant_id)`. Carries **`finish`, `subtype`, `stamps[]`, `foil` and `size`** — five
independent axes, of which `stamps` is a list.

**Card** — one language-specific printed card record. English `sv03-002` and Japanese
`SV3-002` are two cards. Images attach here, not to variants.

**Print-run distinction vs per-object defect** — a whole batch left the press that way
(variant row) versus one physical card (not modelled).

**Copy** — one physical card the owner holds, pointing at one variant. Condition, grading
and purchase details live here.

**Provenance** — `tcgdex` | `manual`. Where a *variant row* came from.

**Acquisition source** — `ebay` | `shop` | `trade` | `gift` | `auction` | `other`. Where a
*copy* came from. **Distinct from provenance**; the two were briefly both called "source"
and a single word covering both would become two implementations.

**Priority** — an optional 0–3 ranking on an unowned variant. The dial the notification
policy needs. There is no want-list.

**Listing** — one eBay item observed by the scanner, which may or may not resolve.

**Match grain** — `variant` | `card` | `none`. How precisely a listing resolved.

**Lot** — a listing offering several cards. Flagged, surfaced, **never resolved**.

**Alias** — a hand-curated mapping from a string seen in the wild to a card. Owner-authored,
which is what keeps it clear of eBay's training prohibition.

**Confirm queue** — listings the matcher would not place confidently. Precision-biased by
design; queue depth is a health signal.

**Digest** — a batched summary, twice daily. Summarises rather than queues, because APNs
stores only one undelivered message.

**Match confidence and matcher version** — recorded per resolved listing; the version makes
improvement measurable within the 90-day retention window.

**Outbox** — offline writes held in IndexedDB and replayed in order. No phone database, no
sync engine.
