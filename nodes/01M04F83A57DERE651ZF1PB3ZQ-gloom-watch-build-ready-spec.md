---
id: 01M04F83A57DERE651ZF1PB3ZQ
type: doc
title: Gloom Watch — build-ready spec
status: draft
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M04HM3VSFAHKSSBFFAJ18K66
    type: relates
---
## Problem Statement

The owner collects a **masterset** of the **Oddish line** — every physically
printed Pokémon Trading Card Game **variant** of Oddish, Gloom, Vileplume and
Bellossom, across every set, language and print variant. That is roughly **765
variants**, of which a large fraction are Japanese-only prints, WOTC-era
promos, trainer-owned cards (`Erika's Gloom`, `Dark Gloom`) and mechanic
variants (`Gloom δ`).

Two problems make this collection hard to run:

**Nobody knows what is held.** Existing trackers model a card, not a variant.
They mark Base Set Gloom "collected" when any printing is owned, so "I have the
Unlimited, I still need the 1st Edition" cannot be expressed. At this grain the
collection is a spreadsheet at best, and a spreadsheet has no images, no
completion figure that means anything, and no way to answer the only question
that matters standing in a card shop: *do I already have this one?*

**Nobody knows when a needed card appears.** eBay carries ~25,000 active Gloom
listings in the US card category alone, with an estimated **1,000–3,000 new
Oddish-line listings per day** across marketplaces. Manually watching for the
specific missing variant — a Japanese Jungle holo, a 1st Edition Erika's Gloom —
is not a thing a person can do. The cards that matter most are exactly the ones
buried deepest in that volume.

## Solution

**Gloom Watch** is a self-hosted, single-user Progressive Web App, installed to
the Home Screen of the owner's iPhone, backed by one SQLite database on an
always-on Linux box reachable only over the owner's Tailscale tailnet.

It does three things.

**It holds the masterset.** The card corpus is pulled from TCGdex, filtered to
the Oddish line, and stored locally at variant grain — one row per print variant
per language. Gaps TCGdex cannot fill (Korean, Simplified Chinese, "The Best of
XY") are added by hand and count toward completion exactly like imported rows.
Card images live in the database as BLOBs.

**It tracks copies.** Each physical card the owner holds is one row pointing at
one variant, carrying condition or grade, cert number, what was paid in the
currency it was paid in, where it came from, free-text notes, and the owner's own
photographs. The primary screen is a **binder view**: a visual grid of every
variant where owned and needed are obvious at a glance.

**It hunts.** A scanner polls eBay's Browse API every ten minutes, resolves each
listing against the local corpus, and pushes an iOS notification when a variant
the owner does not own appears. High-priority variants push instantly; everything
else lands in two digests a day.

## User Stories

### The masterset

1. As the owner, I want the app to hold every physically printed Oddish-line
   variant, so my completion figure is measured against a real target rather than
   a guess.
2. As the owner, I want digital-only TCG Pocket cards excluded, so the masterset
   is not permanently incompletable.
3. As the owner, I want to sync the corpus from TCGdex by pressing a button, so
   new sets appear when I choose rather than on a schedule I did not ask for.
4. As the owner, I want to see when the corpus was last synced, so I can tell
   whether a card missing from the binder is genuinely absent or merely unsynced.
5. As the owner, I want to add a variant by hand by cloning an existing one and
   changing a few fields, so Korean and Simplified Chinese prints — which TCGdex
   does not carry at all for this line — can be tracked without typing a whole
   card from scratch.
6. As the owner, I want my hand-added variants never to be deleted, renumbered or
   orphaned by a corpus re-import, so months of manual curation survive a sync.
7. As the owner, I want a variant that disappears from TCGdex to be flagged
   rather than deleted, so an upstream mistake cannot take my ownership record
   with it.
8. As the owner, I want card images held locally, so the binder renders without a
   round trip to a third party that may change its URLs or vanish.

### The binder

9. As the owner, I want a visual grid of every variant as the app's primary
   screen, so seeing the collection and seeing its holes is the default act.
10. As the owner, I want owned and needed variants visually distinguishable at a
    glance in a dense grid, so I can read the state of the collection without
    reading text.
11. As the owner, I want "what I still need" to be a filter over that grid rather
    than a separate page, so I never lose the visual context of the binder.
12. As the owner, I want to filter the binder by set, language, finish, print
    variant, owned/needed and priority, so I can narrow ~765 variants to the
    handful I care about right now.
13. As the owner, I want my filter state in the URL, so a filtered view survives
    a reload and can be returned to.
14. As the owner, I want tapping a card to open a bottom sheet rather than
    navigating away, so the binder stays as persistent context.
15. As the owner, I want the sheet to show the corpus image, my own photographs,
    the copies I hold and any current listings, so one tap answers everything
    about that variant.

### Copies

16. As the owner, I want each physical card recorded as its own row, so a PSA 9
    and a raw copy of the same variant are not collapsed into a count.
17. As the owner, I want to record condition using the same vocabulary eBay uses,
    so a listing's condition maps onto mine with no translation.
18. As the owner, I want to record grader, grade and certification number, so I
    can recognise my own slab if it ever resurfaces on the market.
19. As the owner, I want to record what I paid in the currency I paid it in,
    together with a home-currency value captured at purchase time, so the
    historical exchange rate is not lost forever.
20. As the owner, I want to record where a copy came from as a coarse category
    plus my own free text, so provenance is captured without the app storing eBay
    user data.
21. As the owner, I want a free-text note per copy, so I can remark on an
    off-centre cut without the app modelling defects as data.
22. As the owner, I want to attach my own photographs to a copy, because for most
    pre-2021 Japanese variants my scan is the only image that will ever exist.
23. As the owner, I want a sold or traded copy to keep its row marked disposed,
    so my purchase history and upgrade trail survive.
24. As the owner, I want completion to count only copies I currently own, so
    disposed cards do not inflate the figure.
25. As the owner, I want to set a priority on a variant I do not own, so the
    notification policy has a dial and the cards I most want can interrupt me.

### The hunt

26. As the owner, I want the server to scan eBay for new Oddish-line listings
    every ten minutes without my involvement, so I do not have to watch.
27. As the owner, I want each listing resolved to a specific variant in a
    specific language, so have-it/need-it is accurate at the grain I collect at.
28. As the owner, I want listings the matcher cannot place confidently held in a
    confirm queue rather than guessed at, because a wrong auto-match is silent
    and corrupts my collection state.
29. As the owner, I want confirming a queued listing to teach the parser a
    reusable alias, so the same question is never asked twice.
30. As the owner, I want bundle listings flagged as lots and shown in their own
    filtered view, never resolved to a variant, so a fifty-card lot does not
    claim to be a specific card.
31. As the owner, I want proxies and custom art filtered out, and the filtered
    ones logged, so fakes do not pollute the feed and I can still see what the
    filter caught by mistake.
32. As the owner, I want a listing's grade parsed and stored on the listing, so I
    can filter for raw-only or graded-only when hunting.
33. As the owner, I want every listing to link out to eBay with a "seen at"
    timestamp, so I act on the live page rather than on stale cached data.

### Notifications

34. As the owner, I want to install the app to my Home Screen and enable
    notifications through a soft-ask before the real system prompt, because iOS
    gives exactly one chance and a denial is effectively permanent.
35. As the owner, I want a permanent "re-enable notifications" button, because
    iOS silently invalidates push subscriptions and gives the page no event when
    it does.
36. As the owner, I want an instant push when a high-priority variant I do not
    own is listed, so I can act before an auction ends.
37. As the owner, I want everything else batched into two digests a day at times
    I configure, so the feed does not train me to switch notifications off.
38. As the owner, I want a digest to summarise rather than queue, because iOS
    stores only one undelivered push and a burst would otherwise arrive as a
    single survivor.
39. As the owner, I want tapping a notification to land on that listing inside
    the app, so the notification is actionable rather than merely informative.
40. As the owner, I want a relisted item not to notify me again, so an unsold
    card renewed weekly does not buzz forever.
41. As the owner, I want an app badge counting unseen qualifying listings, so a
    dismissed notification still leaves a trace.

### Health and durability

42. As the owner, I want the last successful scan time shown every time I open
    the app, turning red past a threshold, because silence is ambiguous and a
    dead scanner cannot send its own funeral notice.
43. As the owner, I want one push when the scanner recovers from a gap, so I know
    a quiet period was an outage rather than an empty market.
44. As the owner, I want to mark a card owned while offline and have it replay
    when I reconnect, so a dead spot does not cost me the catalogue entry.
45. As the owner, I want the pending offline-write count surfaced, so I know
    whether anything is still unsent.
46. As the owner, I want the whole database backed up daily and again shortly
    after I edit my collection, because collection edits are the one thing that
    cannot be rebuilt.
47. As the owner, I want backups encrypted with a key the server cannot read, so
    a compromised box cannot open its own backup history.
48. As the owner, I want every backup verified and the result surfaced in the
    app, because an untested backup is a belief.
49. As the owner, I want a CSV and JSON export archived with every backup and
    kept indefinitely, so my collection outlives the ninety-day snapshot window
    and this application.
50. As the owner, I want that export to be re-importable, because an export that
    cannot be loaded back is documentation, not a backup.
51. As the owner, I want to warm the image cache on demand before a card fair or
    a flight, so the binder browses fully offline when I choose.

## Implementation Decisions

Every decision below is frozen on the map. Where the alternatives matter, the
named ticket holds them.

### Stack — *Lock the stack: runtime, storage, frontend, PWA build* (`01m03xa8cw`)

| Layer | Choice |
| --- | --- |
| Runtime | **Bun 1.4 canary**, pinned to an exact build |
| HTTP | **Hono**, via `hono/bun` |
| Storage | **`bun:sqlite`** — WAL, `busy_timeout = 5000`, **one connection**, **no FTS5** |
| ORM / migrations | **Drizzle**, `generate` only |
| Scheduler | **`Bun.cron`** OS-level jobs |
| Frontend | **React + Vite + TanStack Router + TanStack Query** |
| PWA build | **`vite-plugin-pwa`**, `injectManifest` mode |
| Push | **`web-push`** |
| Tests | **Vitest** |
| Lint | TypeScript `strict` + Biome |
| Repo | Single package — `client/`, `server/`, `shared/` |

This deliberately overrules the earlier research recommendation of Node 24 LTS
in *What is the current Bun + SQLite + PWA toolchain?* (`01m03x9ykk`); that node
remains an accurate record of what was known at the time, and this one is the
decision.

**Guardrails that are not style preferences:**

- `drizzle-kit generate`, **never `drizzle-kit push`** outside a throwaway
  database. `strict: true`, so drizzle-kit refuses destructive migrations.
- **Read every generated SQL migration before committing it.** SQLite's 12-step
  table rebuild is where data silently vanishes.
- **Commit the Drizzle meta snapshots.** They are the diff baseline; losing them
  corrupts future generation.
- `drizzle-kit` needs a `bun --bun` prefix, or it looks for `better-sqlite3` and
  fails.
- **One SQLite connection.** `bun:sqlite` is synchronous and JavaScript is
  single-threaded, so writes serialise for free.
- **No further Bun-specific APIs beyond `bun:sqlite` and `Bun.cron`.** Keeping
  the retreat to Node cheap is the entire reason Hono was chosen over Elysia.
- **No FTS5.** At ~765 variants a `LIKE` scan is microseconds, and dropping FTS5
  removes the only reason macOS's older system SQLite mattered.
- If the schema ever wants JSON, use the **text** functions. `jsonb` is
  unavailable on macOS's system SQLite.

The service worker must be authored by hand (`injectManifest`), because Workbox's
generated worker cannot host the custom `push` handler Web Push requires. Ship it
with `registerType: 'autoUpdate'`, `clientsClaim`, `skipWaiting`, a periodic
`registration.update()` on `visibilitychange`, and **`Cache-Control: no-cache` on
the service worker script itself** — otherwise a cached worker pins the phone to
old code permanently.

### Deployment — *Where does the server run, and how does the phone reach it?* (`01m03xa8ys`)

An always-on **Linux** box (NAS, mini PC, Pi or repurposed laptop), served at
`<host>.<tailnet>.ts.net` via **Tailscale Serve** — never Funnel. Tailnet-only;
the phone keeps Tailscale connected. Linux over macOS because a Mac sleeps and a
sleeping machine misses scan windows silently.

**Supervision splits in two, and they fail independently:**

- **Scanner** — a `Bun.cron` OS-level job. Survives process restarts *and*
  reboots with no supervisor.
- **HTTP server** — a long-lived process under `systemd Restart=always`,
  `RestartSec=10`.

A dead web server does not stop notifications arriving, because push delivery
never touches this box's inbound path.

**Two reachability requirements, which must not be conflated:**

| | Direction | Needed for |
| --- | --- | --- |
| Origin reachability | iPhone → box, HTTPS | install, open, register the service worker, `subscribe()`, and **tapping a notification** |
| Push delivery | box → Apple (**outbound 443**), Apple → phone | send time only |

The server is always the HTTP *client* at send time and the payload is encrypted
end to end, so a residential-NAT home server needs only outbound 443. No port
forwarding, no static IP, no dynamic DNS.

**Secrets** live in a root-owned `0600` environment file, read at startup, and
are included in the (encrypted) backup: VAPID public key, VAPID private key, eBay
client ID, eBay client secret.

**Application-level authentication is deliberately absent in v1.** The map fixed
"single user, no account system; auth exists only to keep the internet out", and
a tailnet-only origin keeps the internet out. Nothing is exposed publicly. This
is a derived consequence of decisions already made, not a new ruling — see *Out
of Scope*.

### The masterset — *What is in the masterset, and what counts as one card row?* (`01m03xa78k`)

**A row is one variant, in one language.** Identity is **`(card_id, variantId)`**
— never `variantId` alone, which is a hash of the variant attribute set and is
shared across different cards.

| Axis | Splits a row? |
| --- | --- |
| Language | **Yes** — English `sv03-002` and Japanese `SV3-002` are two collectibles with genuinely different set names, numbers and rarities |
| Print variant | **Yes** — holo, reverse, normal, `1st-edition`, `shadowless`, `unlimited`, `1999-2000-copyright`, `missing-expansion-symbol`, prerelease `set-logo`, World Championship deck stamps |
| Grading | **No** — lives on the copy |
| Per-object defect | **No** — not modelled anywhere |

**Membership** is TCGdex `dexId ∈ {43, 44, 45, 182}` **unioned with** a
name-contains sweep for Oddish / Gloom / Vileplume / Bellossom. The union is the
decision: `dexId` alone provably misses records where the field was left unset,
and the name sweep alone pulls in false hits requiring a small manual exclusion
list. Both halves are needed.

**Excluded:** TCG Pocket digital-only cards (set-ID prefixes `A#`, `B#`, `P-A` —
filter these before counting anything), non-TCG physical items (Topps, Bandai
Carddass, Amada, vending prints, stickers, jumbo), sealed product, and cards that
merely picture the line without carrying the name.

**The error line:** a **print-run distinction** affected a whole batch as it left
the press and earns a variant row. A **per-object defect** — miscut, ink error,
colour shift, crimp, off-centre cut — happened to one physical card and is **not
modelled anywhere**: no variant row, no field on a copy, nothing to count,
filter or sort on. It may appear as prose in a copy's free-text note. Defects are
not data, but they can be remarks.

### Copies — *What does the app record about a copy you own?* (`01m03xa7ty`)

One row per physical card, pointing at exactly one variant.

| Field | Required | Notes |
| --- | --- | --- |
| `variant_id` | **yes** | `(card_id, variantId)` — exactly one |
| `condition` | no | `NM` / `LP` / `MP` / `HP` / `DMG` — omitted for graded slabs |
| `grader` | no | PSA / BGS / CGC / SGC / ACE |
| `grade` | no | numeric |
| `cert_no` | no | uniquely identifies this physical slab |
| `price` | no | amount actually paid |
| `currency` | **with price** | never a bare number |
| `price_home` | no | converted value at time of purchase |
| `home_currency` | no | **AUD** |
| `rate_date` | no | date the conversion was taken |
| `acquired_at` | no | date it arrived |
| `source_type` | no | `ebay` / `shop` / `trade` / `gift` / `auction` / `other` |
| `source_note` | no | free text, typed by the owner |
| `note` | no | free-form prose about this specific card |
| `photos` | no | zero or more owner photographs |
| `status` | **yes** | `owned` / `disposed` |
| `disposed_at` | no | set when status becomes `disposed` |
| `disposal_kind` | no | sold / traded / lost |

The condition ladder is **exactly eBay's Card Condition vocabulary**, so a
listing's condition maps onto a copy's with no translation layer. The cert number
is worth transcribing because eBay exposes it as condition descriptor 27503,
making it possible to recognise the owner's own slab on the market.

Price is stored in the currency paid **plus a home-currency snapshot taken at
purchase**, because the historical exchange rate is unrecoverable later. **The
rate is entered by hand; there is no FX API in v1.**

**Every ownership query must filter on `status = 'owned'`.** This is the known
cost of retaining disposed rows, and it is easy to forget exactly once.

**`seller.username` from eBay is never persisted** in a copy record or anywhere
readable. This is a compliance decision, not a modelling preference: persisting
eBay user data removes the option to opt out of eBay's marketplace
account-deletion notifications, which would force a publicly reachable HTTPS
endpoint and kill tailnet-only hosting. Nobody may later "improve" the app by
storing seller names.

**Priority** is an optional field on the **variant**, not the copy. There is no
want-list — in a masterset, anything unowned is implicitly wanted.

### Corpus ingest — *How does the card corpus get in, stay current, and hold images?* (`01m03xaamk`)

Two phases against TCGdex, with **filtering done locally**:

```
1  per language, brief form: all cards for that language
   filter LOCALLY:
     dexId ∈ {43, 44, 45, 182}
     UNION name-contains {oddish, gloom, vileplume, bellossom}
     MINUS TCG Pocket set-ID prefixes (A#, B#, P-A)

2  per surviving card, detail form  (~475 fetches)
   only the detail response carries variants_detailed
```

Filtering locally is the decision: if the masterset boundary is ever revised,
re-scoping costs a re-filter of data already held rather than a fresh crawl.
There is no API key, no auth and no published rate limit, but the detail fetches
are politely paced regardless.

**Refresh is manual only.** Sync runs when the owner presses the button; the app
shows the last-synced date and does not check upstream. TCGdex has no
updated-since query, so this is accepted with a recorded consequence: **the
corpus can drift silently**, and a newly released Gloom will arrive at the
matcher as an unmatched listing until a sync happens.

**Re-import safety rules — all mandatory:**

- Upsert key `(card_id, variantId)`.
- **Import never touches rows with `provenance = 'manual'`.**
- A variant that vanishes upstream is flagged `missing_upstream` and **kept**,
  never deleted — a copy or a photograph may point at it.
- **Canonicalise `stamp` on the way in.** Both `1st-edition` and `1st edition`
  occur upstream at comparable frequency. Missing this silently drops half the
  1st Edition corpus: the filter still returns results, just the wrong ones.
- Record `provenance` and `last_synced_at` per row.
- Image URLs upstream are **case-sensitive**.

**Manual variant entry is clone-and-edit.** Most gaps are a Korean or Simplified
Chinese printing of a card that already exists in English or Japanese, so cloning
copies set, number and variant attributes and the owner changes language and
little else. A blank full-entry form remains available. **Manual rows count
toward completion** exactly like imported ones.

### Image storage — *Images are stored as BLOBs in SQLite* (`01m04b901s`)

**All images are BLOBs in SQLite. There is no image directory on the
filesystem.** This supersedes only the image-storage portion of `01m03xaamk`;
everything else in that ticket stands.

Corpus images are stored as `high.webp` (~59 KB each, ~21 MB for the line);
incremental sync uses TCGdex's per-card image hash manifest so only changed
images are refetched. **Owner photographs are resized and recompressed to webp at
~1600px long edge on upload** — this is part of the decision, not an
optimisation: a raw iPhone photo is 3–5 MB and three hundred of them would make
database storage untenable. Recompression also strips EXIF, removing GPS
coordinates from photos taken at home.

Not base64 — SQLite has a native BLOB type, and base64 would inflate storage 33%
and cost an encode/decode on every read.

Expected database size: ~21 MB corpus images + ~100 MB owner photos + ~5 MB
everything else ≈ **125 MB**.

Consequences that must be designed for: `VACUUM INTO` becomes a ~1-second
operation rather than ~1 millisecond, so the write-triggered backup needs a real
minutes-scale debounce; and images are served by the application rather than as
static files, which is immaterial at one user.

**Offline reading has three layers:** precache the app shell via
`injectManifest`; cache images `CacheFirst` at runtime as they are viewed; and
offer an explicit **user-initiated bulk warm** ("download all images", ~21 MB).
Precaching every image was rejected — a single failure fails the whole service
worker install.

### eBay scanning — *Which eBay API surfaces newly-listed cards, and at what cost?* (`01m03x9xfd`)

**The Browse API's item-summary search.** Finding and Shopping were decommissioned
in February 2025. Auth is **OAuth client credentials** — a two-hour token, no
refresh token, no browser round trip, no user consent — which is the best
possible answer for an unattended box: it holds only the client ID and secret and
re-mints on expiry.

One call per (keyword, marketplace) pair per cycle, using:

- the **`itemStartDate` filter as a cursor**, seeded from `last_scanned_at`
  persisted in SQLite with a safety overlap, so a restart computes what it missed
  rather than double-scanning or silently skipping;
- **an explicit `buyingOptions` filter including both fixed price and auction** —
  this is not optional, because by default the search returns only listings where
  fixed price is an option, and **every auction that has received a qualifying
  bid silently disappears**;
- `sort` by newly listed, and category 183454 (US CCG Individual Cards);
- an **`itemId` dedupe set regardless**, because the cursor's timestamp field and
  the newly-listed sort key are documented differently and relists muddy both.

**Cadence: ten minutes.** US and GB every cycle, DE and AU folded in every fourth
— roughly 2,100 calls against a **5,000 call/day quota**, leaving ~58% headroom
for enrichment and retries.

Run an **aspect-filtered sibling request** alongside the plain keyword query
(filtering on the Character aspect for the four species) and union the results on
`itemId`; aspect filters only match listings where the aspect was populated,
which is about 80% overall and worst exactly where this collection cares most.

**Search results carry no per-item aspects.** Structured card data lives only on
the single-item endpoint, one call per listing out of the same 5,000/day pool.
At 1,000–3,000 new listings a day that is unaffordable, so v1 matches on **title
text plus result-set aspect filters** and nothing else.

**Three eBay terms with teeth, all binding:**

- **Six-hour display freshness.** A ten-minute poll is fine; the clause bites on
  *display*. Every listing shown must link out to eBay and carry a "seen at"
  timestamp, and stale cached prices must not be presented as current.
- **Intermediate copies only.** Local storage is licensed as limited intermediate
  copies deleted when no longer required. This is what fixes the 90-day retention
  window below.
- **No training on eBay content.** Rule-based and lookup matching against a
  corpus we own is fine; fine-tuning a classifier on scraped eBay titles is a
  breach. The alias table sidesteps this entirely because it is owner-authored.

There is no personal-use exemption; the same terms apply to a hobby project.

### Matching — *How does an eBay listing resolve to a specific card?* (`01m03xa9gz`)

The framing that decides the approach: **the corpus is small and closed.** ~765
variants, every card name, set name and number a known local string. Matching is
a lookup problem, not a guessing one.

```
1  CHEAP FILTER
   category + Oddish-line name regex + proxy/custom-art exclusion
2  PARSE TITLE against the local corpus
   name -> set -> card number -> features -> finish -> language
3  SCORE CONFIDENCE
   >= threshold -> auto-match
   <  threshold -> confirm queue
4  RECORD
   raw payload + matched variant + confidence + matcher version
```

**Precision over recall, because the two errors are not symmetrical.** A wrong
auto-match is silent, persistent, corrupts have-it/need-it and may never be
discovered. A queued listing is visible, gets resolved once, and teaches
something. The auto-match bar sits high and the queue absorbs the rest. **The
confidence threshold is a tunable set empirically once real listings arrive** —
the bias is decided, the number is not. Accepted cost: the queue feels heavy
early.

**Corrections become aliases, not per-listing overrides.** Confirming
`クサイハナ ホロ ジャングル` stores the alias `クサイハナ` → Gloom (ja), and every
future listing containing that string parses unprompted. Per-listing overrides
were rejected because a relist re-asks the same question forever and the queue
never gets smarter. **The alias table is irreplaceable data with no upstream
source.**

**Language resolution, in order:** an explicit marker in the title (kana, kanji,
"japanese", "german", …); then the listing's location country, which is returned
free in every search result; then default to English. Routing all unmarked
listings to the queue would drown it.

**Lots are flagged, never resolved.** A title naming several cards, or carrying
"lot" / "bundle" / "x50" / "bulk" / "collection", is marked as a lot with the
names it mentions and **no variant link**. It is surfaced in its own filtered
view. Matching a lot to every card it names would flood the need-it view with one
listing repeated dozens of times.

**Proxies and custom art are filtered out** using eBay's own Altered/Custom Art
aspect plus title keywords (proxy, custom, fan art, repro, reproduction, orica,
not official, metal card, gold plated). **Filtered listings are logged, never
silently dropped** — an invisible filter is one whose mistakes are never learned.

**Grade is parsed but never influences the match.** A slab and a raw card are the
same printed variant. Grader and grade are stored on the *listing*, enabling
raw-only and graded-only filters when hunting.

**Raw listing payloads are retained 90 days**, stored with the resolved match,
the confidence, and **the matcher version**. The version is what makes
improvement measurable: a new matcher can be re-run over months of real listings
and compared against the old one's results. At 90 days the eBay payload is
deleted; the variant link, confirmations, aliases and notification history
survive. Nothing of the owner's is ever lost — only eBay's data expires.

### Notifications — *What earns a push notification, and what does it say?* (`01m03xaa33`), grounded in *What does iOS Web Push to an installed PWA actually require?* (`01m03x9y1f`)

**Transport is Declarative Web Push** (iOS 18.4+), with a classic service-worker
handler as the fallback for iOS 16.4–18.3. This is not an implementation detail;
it shapes the policy. It is **exempt from iOS's three-strike silent-push
penalty**, it supplies a `navigate` field that bypasses the long-broken
notification-click event, and it supplies `app_badge` with no JavaScript.

**A listing pushes when all four hold:** it matched a variant with sufficient
confidence; the variant is **not owned**; it is not a lot, proxy or custom art;
and the variant clears the **priority** bar or the price clears a **ceiling**.
The price ceiling is a tunable like the confidence threshold. Without the
owned-and-priority filter this is hundreds of pushes a day and notifications get
switched off within a week.

**Batching is hybrid:** a high-priority unowned variant pushes **instantly**;
everything else lands in **two digests a day** at configurable times, so a
listing waits at most ~12 hours. The digest is structural, not politeness:
**iOS stores exactly one undelivered push while the device is offline**, so five
instant pushes during a tunnel journey become one arrival and four silent losses,
while a digest survives intact.

**No quiet hours.** A high-priority card can push at 3am; auctions end at
inconvenient times and a sniped card is gone.

**Deduplication has two layers:** an `itemId` seen before never re-notifies; and
a **~30-day relist guard** on same-seller + near-identical title + similar price
suppresses re-notification under a new `itemId`. Seller identity for that guard
is a **salted one-way hash used solely as an opaque dedupe key** — never
displayed, never readable, expiring with the 90-day listing window. This is
narrower than what `01m03xa7ty` rejected: mechanical dedupe rather than knowing
who you bought from, so the eBay opt-out stands and hosting stays unconstrained.

**Content:**

```
INSTANT   title  Gloom – Jungle JA holo
          body   $42 AUD – NM – auction 3d

DIGEST    title  7 cards you need
          body   Gloom ×3, Vileplume ×2, Bellossom ×2 – from $8
```

Front-load the card identity, because the Dynamic Island shows only the title and
the first few words. Target ≤~35 characters of title and ≤~100 of body — these are
engineering targets, not platform rules.

**Platform constraints baked in, all confirmed against WebKit's shipping source:**

- **No images** in the notification.
- **No action buttons** — the action field is always empty, contradicting both
  the Declarative Web Push explainer and WWDC25 session 235.
- **`tag` does not coalesce on iOS** — N pushes with one tag give N tray entries.
- **`icon` is ignored**; iOS always shows the manifest icon, so the manifest icon
  does real work and deserves investment.
- Payload ceiling 4096 bytes encrypted (~3993 plaintext). Budget under ~3.5 KB.
- **A positive TTL is mandatory.**
- The `navigate` target must be **same-origin and inside the manifest scope**, so
  deep-linking straight to eBay is impossible. The tap lands on an in-app listing
  view carrying the card image and the outbound eBay link, and **that route must
  resolve on a cold load**.

**The silent-push rule is load-bearing and cannot be tested in development.** The
service worker must call `showNotification()` **unconditionally**, from the
encrypted payload, inside the event's `waitUntil()` — **never after a fetch to
the origin**. Three failures to show a notification within 30 seconds revoke
every push subscription for the origin, the counter has no reset path anywhere in
WebKit's source, and WebKit suspends enforcement whenever Web Inspector is
attached. A worker that fetches the origin first accumulates strikes every time
the tailnet is unreachable.

**Subscriptions die silently and cannot be detected client-side.** The
`pushsubscriptionchange` event is not implemented on iOS Safari; Apple's endpoint
has been reported returning 201 rather than 410 for dead subscriptions, so
**absence of a 410 is not evidence a subscription is alive**; and
`Notification.permission` cannot distinguish OS-level-off from never-asked. **The
server is the source of truth**, and the app ships a permanent, gesture-gated
**"re-enable notifications" button** — on iOS, subscribing requires a user tap
even when permission is already granted, so silent re-subscription is impossible.

**Onboarding is not polish.** Home Screen installation is required — Safari tabs
never get the Push API. iOS 26 added a failure mode where the user can turn "Open
as Web App" off, producing a plain bookmark with no Push API; detect this at
runtime by checking standalone display mode together with the presence of the
Push API. **A soft-ask before the real prompt is mandatory**: denial is
effectively permanent, with no reliable Settings-based recovery, and there is
exactly one chance.

**VAPID keys are self-generated and registered with nobody.** Rotation destroys
every existing subscription and costs a user tap to recover, so generate once,
back up, and do not rotate casually.

**The app badge counts unseen qualifying listings but is a lagging indicator.**
Silent push is impossible on iOS and the badge rides inside a notification
payload, so it refreshes only when a notification is shown or the app is opened.
Between a morning digest and a 3pm find, the badge is stale. This is recorded so
it is not discovered late.

**Scanner failure detection** is deliberately not push-based, because a dead
server cannot send its own funeral notice: an **in-app staleness banner** showing
the last successful scan time on every app open, turning red past a threshold; a
**single push on gap recovery** ("scanner was down 6h, catching up"); and the
badge as a passive secondary signal.

**Unmatched listings never push.** They wait in the confirm queue, because "might
be a card you need, unsure" converts a notification into homework. Named risk: a
rare Japanese card the parser cannot read is exactly the one worth knowing about,
and it will sit silently until the queue is opened.

### The client — *What are the PWA's screens, and how does the collection read?* (`01m04bb8bb`) and *Offline writes use an outbox queue* (`01m04b91r3`)

Three throwaway prototypes were built and **rejected as designs**. Five rulings
survive, and **nothing else from them carries forward**:

- **The binder view is the app** — a visual grid of every variant where owned and
  needed are obvious at a glance. Seeing the collection and its holes is the
  point, not a side view.
- **The Gap is a filter, not a screen** — "what I still need" is a filter over
  the binder view, never its own page. Same for any other slice.
- **Interaction opens a bottom sheet** — tapping a card opens a mobile sheet
  rather than navigating away, keeping the binder as persistent context.
- **No aggregate density map** — the whole-masterset "spread" above the grid is
  not wanted.
- **Visual style is dense, precise and typographic**, not ornamental.

**How completion is numerically presented, the layout of the sheet, and the shape
of the feed, confirm queue and lots surfaces are explicitly not decided.** They
are open to whoever builds this, and must **not** be inferred from the rejected
prototypes.

The surfaces the ruled decisions commit to, whatever their shape: the binder;
the variant sheet (corpus image, owner photographs, copies held, current
listings); the listing feed with have-it/need-it state; the confirm queue with
confirm / pick-other / not-a-match; the lots view; collection entry including
clone-and-edit for manual variants; a listing detail route that resolves on cold
load; and the health surfaces (last scan, last backup verified, corpus last
synced, outbox pending count).

The grid needs **virtualisation** — ~765 image cells — and will be network-bound
on first load until the image cache warms.

**Filter state lives in typed URL search parameters** (TanStack Router), so a
filtered view survives reload and is addressable.

**Offline writes queue in an outbox in IndexedDB and replay in order on
reconnect. There is no database on the phone and no sync engine.** TanStack Query
supplies offline mutation persistence, so this is a small build. The UI updates
optimistically and surfaces the pending count. **One user, one device, so
last-write-wins is sufficient and no merge logic is required.** The offline
window is narrow by construction — the origin is tailnet-only, so the realistic
case is a cached shell opening while the tunnel is briefly unreachable.

Collection *data* reads come from the HTTP cache, not from a local database.

### Backup and restore — *How is the collection backed up, exported and restored?* (`01m042kp8g`)

**Everything lives in one SQLite file, and one job backs it up** — including all
image BLOBs, corpus and owner photographs alike. Blanket coverage was chosen over
excluding the re-derivable ~21 MB of corpus images deliberately: if TCGdex
disappears or changes its URL scheme, the backup becomes the only copy.

**Mechanism: `VACUUM INTO`.** `bun:sqlite` has no incremental backup API — only
full serialisation, which materialises the whole database in memory. `VACUUM
INTO` is the correct online primitive for a live WAL database, is safe against
concurrent readers, and produces a defragmented copy.

**Cadence:** daily via `Bun.cron`, **plus a debounced snapshot after any
collection write** (adding a copy, confirming a match, adding a manual variant).
**The debounce must be a real minutes-scale window** — a snapshot is no longer
free once image blobs are inside the file. The write trigger exists because
collection edits are the one thing that cannot be rebuilt, and a daily-only
schedule can lose an afternoon of cataloguing.

**Retention: 90 days**, deliberately matching the listing retention window, so
eBay payloads never persist in a backup longer than they persist live.

**Destination: encrypted, to cloud object storage *and* a local copy.** Local for
fast routine restores; cloud to survive fire, theft and flood. Content-defined
deduplication keeps repeated ~125 MB snapshots cheap, since the overwhelming
majority of blobs are unchanged between them.

**Key custody:** an `age` keypair with **the private key held off the box** — a
password manager plus an offline copy. The server holds only the public key, so
it writes backups it cannot itself read. This is the correct property for an
append-only backup target and it avoids the classic failure where the only copy
of the decryption key dies with the machine. The backup contains the VAPID
private key and eBay credentials, so it is genuinely sensitive.

**Export — CSV and JSON, generated with every backup and kept indefinitely.** It
contains only the owner's data — no eBay payloads — so indefinite retention
carries no licence tension, and it is what makes a 90-day snapshot retention
safe. Contents: one row per copy (card, set, number, language, variant,
condition, grader, grade, cert, price, currency, acquired, source, status,
notes), plus manual variants, aliases, match confirmations and priorities.

**The export must be re-importable.** This is a requirement on the format, not a
nice property. Restoring from export must be a supported path: rebuild the
schema, re-ingest the corpus from TCGdex, re-download corpus images, and
reconstruct copies, manual variants, aliases, confirmations and priorities from
the export file. It is also the answer to "what if this app stops working in five
years" and the migration path to any other tracker.

**Verification after every backup**, because an untested backup is a belief:
open the snapshot read-only; run an integrity check; compare row counts against
live for copies, variants, aliases and confirmations; confirm image blob counts
and total blob bytes; record the verification timestamp and the counts. **Surface
the result in the app beside the scanner staleness banner** — "backup verified 6h
ago, 312 copies". This catches a truncated snapshot, a disk that filled up three
weeks ago, or a backup that is valid SQLite and missing data.

## Testing Decisions

Tests exercise **external behaviour** — what a function returns, what an endpoint
responds, what lands in the database. Nothing asserts on internal call sequences
or private structure. This is a greenfield repository, so there is no prior art
to follow; these seams are the prior art, and later work should use them rather
than adding new ones.

**Vitest is the runner, and this is a decision rather than a default.** `bun test`
is 2–3× faster but a live Bun 1.4 regression leaks mocked-clock state across test
files — and the scanner's cursor logic is exactly what gets tested with a mocked
clock. Vitest also reuses the Vite configuration, so client and server share one
toolchain.

### The four seams

**1. The matcher — a pure function, and the highest-value seam in the project.**

`(listing title, listing metadata, corpus snapshot, alias table) → candidate
variant + confidence`

It is pure, deterministic, and the single place where a defect silently corrupts
collection state. Test it with a fixture corpus and a fixture table of real
listing titles: English catalog titles, vintage free-form titles, Japanese titles
in kana and kanji, graded-slab titles, trainer-owned and mechanic variants, lot
titles, proxy titles. Assert **which variant comes out and at what confidence
band** — auto-match or queue — never how it got there.

The cases that must be covered because they encode rulings rather than
mechanics: `1st-edition` and `1st edition` resolving identically; a listing whose
`variantId` collides across cards resolving to the right `(card_id, variantId)`;
language falling through title marker → location country → English default; a lot
producing **no** variant link; a proxy being filtered **and logged**; a grade
being parsed onto the listing while playing no part in variant selection; and an
alias making a previously queued title parse unprompted.

**2. Corpus ingest and normalisation — a pure function over fetched records.**

`(TCGdex records) → variant rows`

Test the union membership rule (a `dexId` hit with no name match, a name hit with
no `dexId`, and a false positive the exclusion list must catch), TCG Pocket
exclusion by set-ID prefix, `stamp` canonicalisation, and `(card_id, variantId)`
keying.

Test **re-import safety as behaviour against a real database**: a manual row
survives an import that does not mention it; a row that vanishes upstream is
flagged rather than deleted; a copy pointing at either still resolves afterwards.
These are the failures that lose data, and they cannot be caught by a unit test
over pure functions alone.

**3. The notification policy — a pure function.**

`(matched listing, collection state, config) → instant | digest | nothing`

Test each of the four trigger conditions independently and in combination, both
dedupe layers (seen `itemId`; relist guard within the window on hashed seller +
similar title + similar price), the digest rollup, and that an unmatched listing
never pushes. Payload construction is tested for size — under ~3.5 KB — and for a
`navigate` target that is same-origin and inside the manifest scope.

**4. The HTTP API — Hono's request handler, against a real in-memory SQLite with
migrations applied.**

This is the highest seam that works, and it is where the client's contract is
verified. **Do not mock the database**: at this size a real SQLite database per
test is fast, and mocking it would test the mock. Test what a request does to
persisted state and what comes back — creating a copy, confirming a queued match
and observing the alias it taught, adding a manual variant, marking a copy
disposed and observing it drop out of completion, and the filtered binder query
returning the right variants.

**The eBay client is faked at the HTTP boundary** — recorded response fixtures,
not a mocked client object — so the cursor arithmetic, the `buyingOptions`
filter, the aspect-filtered sibling request and the `itemId` union are all
exercised against realistic payload shapes. Cursor behaviour across a restart and
across a gap is tested with a controlled clock.

**Backup and restore are tested end to end against a real temporary database**:
`VACUUM INTO` a snapshot, run the verification steps against it, and assert the
counts match. Then round-trip the export: generate CSV and JSON, rebuild an empty
schema, re-import, and assert the collection is reconstructed. **The export's
re-importability is a stated requirement, so it needs a test that would fail if
it regressed** — otherwise it is a promise with no mechanism behind it.

### What cannot be tested automatically, and what replaces it

iOS Web Push cannot be exercised in CI: it requires a physical iPhone, a real
HTTPS origin the phone can reach, and Home Screen installation. The Simulator has
no viable path. Worse, **the most dangerous defect in this project — a service
worker that fails to show a notification and burns a silent-push strike — is
suppressed by design whenever Web Inspector is attached.**

Two mechanisms replace the missing test:

- **A server-side push echo log** recording every push sent, its payload size and
  the endpoint's response, so delivery can be reasoned about without the phone.
- **A manual commissioning checklist**, run once on the real device before first
  use: Tailscale Serve up with a cert issued; the iPhone loads the site over
  HTTPS; Add to Home Screen with **"Open as Web App" confirmed ON**; standalone
  display mode and Push API both present at runtime; permission granted from a
  user gesture; `subscribe()` succeeds and the endpoint is stored server-side; a
  test push is received; and finally **Tailscale switched OFF on the phone, a
  push sent, and the banner confirmed to arrive**.

That last step is not optional. The outbound-only claim underpinning the entire
hosting decision is well-reasoned inference from protocol behaviour and
documented iOS split-tunnel behaviour, **not a confirmed fact** — no first-hand
report was found of an iOS Home Screen web app receiving a push while its origin
was unreachable. Getting it wrong changes the design.

## Out of Scope

**Market price comparison** — showing a listing's price against a
TCGplayer/Cardmarket benchmark or eBay sold comps. Dropped from v1 by the owner
when the map was scoped; ruled out and archived as *Price-vs-market benchmarking
on listings* (`01m03xaxxs`). It needs a second and probably paid data source, a
price history store, and a currency model, none of which the "is this new, do I
have it" loop requires. eBay's sold comps sit behind a Limited Release API that
holds only 90 days and requires written permission to derive average selling
prices. If it returns, it is a fresh effort with its own data-source decision.

**Marketplaces beyond eBay** — Yahoo Japan Auctions and Mercari JP. This looked
essential when the map was charted, because an Oddish-line masterset is full of
Japanese-only prints. The eBay research weakened it substantially: there is no
eBay Japan in the Buy APIs, but Japanese cards reach the US marketplace anyway,
with 4,227 Japanese-language listings in a single US search. **Revisit once the
scanner has run against real data and actual Japanese coverage is measurable
rather than assumed.**

**Application-level authentication.** The map fixed "single user, no account
system, no sharing; auth exists only to keep the internet out", and *Where does
the server run* (`01m03xa8ys`) ruled the origin tailnet-only via Tailscale Serve
rather than Funnel. The tailnet is therefore the perimeter and v1 ships with no
login. **What was never ruled on is whether any individual surface — the confirm
queue, manual variant entry, export — deserves a second factor regardless.** That
question is left open deliberately rather than answered here; it does not block
the build, and adding a gate later touches no schema.

**Per-object defects.** Miscuts, ink errors, colour shifts, crimps, off-centre
and square cuts are not modelled anywhere: no variant row, no field on a copy, no
filter, no sort. They may appear as prose in a copy's note. There is no upstream
source, ID or image for any of them, and two miscut Glooms are not the same
collectible as each other.

**Non-TCG physical items and sealed product** — Topps, Bandai Carddass, Amada,
vending-machine prints, stickers, jumbo cards. TCGdex carries none of them, so
each would be a hand-typed row with no image, no stable ID and nothing for the
matcher to recognise.

**Per-item eBay enrichment.** Structured aspects (set, number, print variant,
grade) exist only on eBay's single-item endpoint, at one call per listing from
the same 5,000/day pool as the searches. At 1,000–3,000 listings a day this is
unaffordable. **It remains viable as targeted enrichment for a small number of
high-priority variants**, and is a natural v2 addition once the loop works.

**LLM classification of listing titles.** Rejected as the front door — a call per
listing at that volume, nondeterministic across runs, hard to unit test, and eBay
forbids training on its content. **Retained as a candidate fallback for the
low-confidence tail** only; inference is permitted, fine-tuning on scraped titles
is not.

**An external watchdog.** The only thing that survives total server death, but
another moving part to run. The in-app staleness banner is the v1 answer, and the
watchdog is the obvious upgrade if silence ever bites.

**Automatic corpus refresh.** Declined in favour of manual control, with silent
drift accepted as the consequence. An upstream-change check against the
cards-database commit feed is cheap to add later.

**An FX API.** Home-currency conversion rates are entered by hand.

**A local-first client.** Rejected as a permanent obligation — a sync protocol to
build and version, migrations running in two places, and unverified iOS storage
quota behaviour. The upgrade path is additive: the outbox stays and a read-only
local mirror layers underneath it, so nothing here forecloses it.

## Further Notes

### Facts to verify at build time, not to design around

Each of these was flagged by research as unconfirmed. None blocks the build;
all four are cheap to settle once credentials and hardware exist, and each is
recorded here so it is settled rather than assumed.

1. **Whether the `itemStartDate` filter keys off the item creation date or the
   item origin date** is undocumented. Both are returned in every summary, so one
   test call resolves it. It matters for relist behaviour at the cursor boundary.
2. **Real new-listings-per-day is an order-of-magnitude estimate**, not a
   measurement — eBay exposes no "listed in last 24h" facet. One day of real
   polling settles it. **Design for four digits, not three.**
3. **The GB, DE and AU category IDs are unverified.** Only the US ID (183454) is
   confirmed. Resolve the others via eBay's Taxonomy API rather than assuming.
4. **The Tailscale push test** — commissioning checklist step 8. See *Testing
   Decisions*.

### Accepted risks, recorded so they are not rediscovered

**Bun 1.4 is a canary and is officially not recommended for production.** It was
chosen anyway on the evidence that the Rust rewrite specifically fixes the
long-lived-process memory growth that made the frozen 1.3.14 stable unsuitable —
Prisma measured a workload crossing 900 MiB and being OOM-killed on stable while
staying flat at ~118 MiB on the canary. Mitigations: pin an exact build rather
than floating on the canary channel; back up frequently; and keep the retreat to
Node cheap by adding no further Bun-specific APIs.

**Tailscale issue 19147** — an unresolved report that an iPhone cannot establish
a secure connection to Tailscale Serve HTTPS endpoints, open since March 2026
with no root cause and no workaround, while the same endpoints validate
server-side. One report, not a general breakage. **Accepted deliberately**; if it
bites, the response is to switch ingress (a named Cloudflare Tunnel on an owned
domain, or a reverse proxy with a DNS-01 certificate on the tailnet interface)
and reinstall the PWA. Worth loading the site on the iPhone over HTTPS once
before the first Add to Home Screen, since that is exactly where it surfaces.

**Card image licensing is a genuine grey area.** TCGdex's MIT licence covers the
*database*, not the images; card images are TPCi / Nintendo / Creatures / GAME
FREAK copyright and TCGdex has no authority to sublicense them. Their assets
documentation states no policy either way. For a single-user private tracker this
is the posture every collection app takes. Recorded as accepted, not resolved.

**Origin permanence is a minor annoyance, not a constraint.** Four things bind to
the origin and die together if it changes: the Home Screen icon, the service
worker registration, the notification permission, and the push subscription.
WebKit has no origin-migration mechanism. But this is a single-user app and the
PWA is a thin client over server-side SQLite — changing origin costs re-adding
the icon, re-granting permission and one tap to re-subscribe, and **touches no
collection data**. An earlier framing on this map treated it as near-catastrophic;
that calibration is correct for a multi-user product and wrong here. **Do not
re-inflate this risk.**

### Cross-cutting constraints that are easy to break by accident

These each sit inside one decision but bite from anywhere in the codebase.

- **Never persist eBay seller usernames in readable form.** The only permitted
  use is the salted hash in the relist guard: never displayed, never readable,
  expiring with the listing. Storing them plainly forfeits the eBay opt-out,
  forces a public HTTPS endpoint, and kills tailnet-only hosting.
- **Every ownership query filters on `status = 'owned'`.**
- **The service worker never fetches the origin before calling
  `showNotification()`.** Three failures revoke every subscription permanently
  and the counter has no reset path.
- **Never key anything on `variantId` alone.** It is a hash of the attribute set
  and is shared across different cards.
- **Never `drizzle-kit push` against the real database.**
- **Never delete a corpus row on import**, and never touch a manual one.
- **Never display eBay listing data as current when it is more than six hours
  old.** Link out and stamp the observation time.

### Glossary

The project's ubiquitous language is a living document, *domain glossary*
(`01m041423p`). It defines: Oddish line, Masterset, Variant, Card, the print-run
distinction versus per-object defect, Copy, Provenance, Acquisition source,
Priority, Listing, Lot, Alias, Confirm queue, Digest, Match confidence and
matcher version, and Outbox. **Use its vocabulary throughout.** In particular,
*provenance* (where a variant row came from: imported or manual) and *acquisition
source* (where the owner got a physical copy) are different concepts that were
briefly both called "source"; keeping them distinct in the code is the point of
the entry.
