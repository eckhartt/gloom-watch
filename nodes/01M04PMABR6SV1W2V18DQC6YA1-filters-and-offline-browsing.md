---
id: 01M04PMABR6SV1W2V18DQC6YA1
type: feature
title: Filters and offline browsing
status: done
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
bindings:
  branch: feat/filters-offline
meta:
  ticket: build
  claimed: filters-agent
---
## What to build

Narrowing the binder, and doing it with no connection.

Filters over every variant axis plus set, language, owned/needed and priority. **The Gap is
a filter, not a screen** — "what I still need" is one of these, never its own page.

Filter state lives in **typed URL search parameters**, so a filtered view survives reload and
can be returned to.

Filtering happens **client-side** over the cached binder document, which is what makes the
whole thing work offline. Plus a user-initiated bulk image warm for before a card fair.

## Acceptance criteria

- [x] Filters over finish, subtype, stamps, foil, set, language, owned/needed and priority
- [x] Multi-select within an axis behaves as OR; across axes as AND
- [x] Filter state serialises to typed URL search params and survives a reload
- [x] Filtering runs client-side against the cached document — no request per filter change
- [x] With the tailnet unreachable, the binder still renders and **filters still work**
- [x] Bulk image warm is explicit and user-initiated, never automatic, with visible progress
- [ ] **Demo: put the phone in aeroplane mode and filter the binder to what you still need** — awaiting the owner's handset

---

## Commissioning record

Deployed to `htpc` at `b7e617a`. **No migration** — this ticket is client-only, and `server/`,
`shared/`, `drizzle/`, `client/sw.ts` and `client/sw/caching.ts` were confirmed byte-identical to
the previous commit at review.

| check | result |
| --- | --- |
| migrations applied | **5** — unchanged, as expected |
| corpus | 817 variants — unchanged |
| `GET /api/binder` ETag, plain | `"2fa0e078c7ef4659e053a5981adadcfa"` |
| same with `?page=2&set=base2&state=needed` | **identical**, 817 entries both ways |
| `/`, `/?state=needed`, `/?finish=holo&finish=reverse&language=ja`, `/?priority=7&state=needed`, `/status` | all `200`, the 850-byte shell |
| completion | `0 / 817` |

The ETag is the right comparison for the parameterless assertion — the document carries
`generatedAt`, so hashing the whole body can never match across two requests. The ETag hashes
entries only.

Curl proves the server ignores the query string; it cannot prove the **client** router handles a
malformed one, since that is the defect below and it lives in the browser. That half rests on the
suite and on the agent's browser run.

## The defect found by looking, not by testing

**`?priority=7&state=needed` replaced the whole binder with the router's error page**
(`r.some is not a function`). Every unit test passed, because they fed `parseBinderSearch`'s
output straight back in — which is not the path the app takes.

TanStack Router validates **per matched route** and merges each route's result **over its
parent's**. The root route has no `validateSearch`, so the raw parsed query rides through
underneath: a parameter the index route's validator *rejected* is still present in what the
component reads. `?priority=7&state=needed` arrives as `{ priority: 7, state: ["needed"] }` and
the predicate called `.some` on `7`.

It only crashes when **at least one** axis validates — otherwise the filter short-circuits and
never runs the predicate. That is why `?finish={"a":1}` looked fine and this did not.

Fixed by normalising at the point of use rather than trusting the validator, with the parameter
typed `Record<string, unknown>` to say so. The whole malformed-URL suite now goes through a
helper reproducing the router's real merge.

**Carry this forward: anything reading `useSearch` in this app must treat its input as untrusted**
for as long as the root route has no validator. The cheapest permanent fix is a `validateSearch`
on the root.

## Offline turns on one option

```ts
networkMode: "offlineFirst"   // client/collection.ts, binderQueryOptions()
```

TanStack Query's default mode **does not call the query function at all** once it believes there
is no connection — and a phone in aeroplane mode fires exactly that event. The request would
never be made, the service worker's `NetworkFirst` route would never be asked, and a binder
already sitting in the phone's Cache Storage would stay behind a spinner forever.

**Verified independently at review** by deleting the option: the suite fails with *"the query was
paused and never ran"*.

The binder also now distinguishes a paused query from a slow one, saying "No connection, and no
cached copy of the masterset on this device yet" rather than "Reading…" indefinitely.

## The combination rule, written so it says itself

```ts
return FILTER_AXES.every((axis) => {           // AND across axes
  const selected = filters[axis];
  if (selected.length === 0) return true;      // an unselected axis narrows nothing
  const carried = carriedValues(entry, axis);
  return selected.some((value) => carried.includes(value));   // OR within the axis
});
```

`carriedValues` lifts every axis to a **list** of what the entry carries, which makes `stamps` —
genuinely a list, since a variant may carry `1st-edition` *and* `set-logo` — the same membership
test as the four scalars rather than a special case a reader must remember. An axis upstream
never set contributes an empty list, so a variant with no `foil` is not a variant with the foil
you asked for.

**`size` is deliberately absent**, pinned by a test asserting it is not in `FILTER_AXES`, that a
`?size=` URL is ignored, and that two variants differing only in size are never separated —
because it sits beside the other four print axes in the schema, on the wire and in the sheet, so
its absence had to read as a ruling rather than an oversight.

`set` filters on `setId`, not the `(language, set_id)` pair the corpus keys sets on: `base2` is
Jungle in six languages and language is its own axis, so filtering by the pair would make every
set selection a hidden language selection.

## The URL

Typed search params, one key per axis, each a list, **empty axes omitted** (the stringifier drops
`undefined` and keeps `[]`, so a total shape would write `?state=%5B%5D&priority=%5B%5D&…` on an
unfiltered binder). Values deduplicated and sorted, so the same selection always writes the same
URL.

The **open/closed split** is deliberate. `state` and `priority` are closed scales and are
validated — `?priority=7` is dropped, because it is not a thing this app has ever been able to
mean. The other six are open, because the corpus canonicaliser *keeps* axis values it could not
place and sets and languages come and go — so `?set=gone-in-2019` is **kept**: stale, not
malformed, matching nothing while still saying what was asked for. That keeps a three-month-old
bookmark honest instead of silently becoming an unfiltered binder.

`replace: true` on filter changes: a chip is not navigation, and on a Home Screen web app the
edge swipe is the only back gesture there is.

## The bulk image warm

On `/status` beside the corpus sync, because it is the same kind of thing — a long job the owner
starts on purpose and watches. The binder stays free of chrome.

- **Once per card, not per entry.** Images attach to the card, so four printings share one
  picture: **382 requests rather than 817**. The 115 cards with no image upstream are skipped
  rather than fetched and 404'd.
- **Cheap when warm.** A cached image costs one `cache.match` and no request. A second run in the
  agent's browser check made **0** requests and reported *"none newly fetched"*.
- **One cache, by its exported name** — `CORPUS_IMAGE_CACHE` from `client/sw/caching.ts`, storing
  under the URLs `isCorpusImagePath` matches. Asserted by test, because a warm that stored 26 MiB
  under any other spelling of the percent-encoded `card_key` works perfectly on the tailnet and
  shows a blank binder at the fair.
- **Never automatic**, held by two tests: the warm module is imported by exactly one file, and
  that file contains **no `useEffect` at all**.
- Progress reads `120 / 240 — 8.1 KB fetched` beside a Stop button, then
  `382 of 382 image(s) cached — none newly fetched`. Totals first, delta last — the lesson the
  corpus panel already learned.

## How the claims were proved

Each was verified by deliberately breaking the code and observing the failures:

| break | tests that failed |
| --- | --- |
| OR within an axis → AND | 2 |
| AND across axes → OR | 10 |
| `stamps` read as a scalar | 2 |
| `validateSearch` made to throw | 20 |
| `filtersFromSearch` trusting the validator | 3 |
| `networkMode` back to the default | 1 — *the query was paused and never ran* |

Browser at 390×844 against a 640-variant scratch corpus, expectations computed independently from
`/api/binder` first: holo 200 → **+reverse 360, widened** → **+Japanese ~17, narrowed**.
Virtualisation held at 36 cells in the DOM out of 640, and out of 568 under a filter.

Offline, with the network genuinely cut: a **cold reload** of a filtered URL rendered from cache,
**23 of 23** visible images painted, three axes then selected through the sheet with **0 network
requests**.

## Performance

A full filter pass over 817 entries is **0.045 ms** — about a 350th of a frame — and 0.09 ms at
twice the live corpus. Linear, as expected. No worker, no index structure, and no measurement
that would justify one. An unfiltered binder returns the input array *identity* rather than a
copy, so the virtualiser is not handed a new array on every unrelated render.

A filter change scrolls to the top and calls `virtualizer.measure()`, keyed on the serialised
selection so it does **not** fire when the variant sheet opens — dismissing the sheet must still
return to the same offset, which is a criterion of the binder ticket.

## Open, and worth challenging

- **No result count anywhere.** An aggregate above the grid is forbidden and a needed-count is
  completion wearing a different hat, whose presentation the spec leaves open. The cost is no
  numeric feedback beyond the grid changing. *"142 of 817"* is a decision somebody should make on
  purpose.
- **`navigator.onLine` stayed `true` under the browser's offline emulation**, so the browser run
  never exercised the paused-query path `offlineFirst` defends against. That defence rests on a
  unit test driving `onlineManager.setOnline(false)`. **On a real iPhone in aeroplane mode the
  event does fire, and that is the case the option exists for** — which makes the handset demo
  the only real proof.
- **`replace: true`** means the back gesture cannot step through filter states; `clear` is the
  undo.
- **No "unset priority" option** — the model has four rungs and `null`, and a fifth pseudo-rung
  would be inventing vocabulary. So there is no way to filter for "ranked by nothing".
- **`tsconfig.client.json`'s exclude was narrowed** from `client/sw/**` to `client/sw.ts` and
  `client/sw/push-handler.ts`, so the page can import the image cache's name. `caching.ts` is pure
  strings and regexes and needs neither the DOM nor the WebWorker lib. The one configuration
  change in the diff.
- **The warm always `cache.put`s after a successful fetch**, occasionally redundant when a worker
  is controlling the page — but without it the warm would silently store nothing when none is.
  Consequence, named: entries the page writes directly are not registered with the
  `ExpirationPlugin`'s index, so they are not counted toward `maxEntries` or aged out at a year.
  Harmless for content-addressed immutable bytes, but real.
- **Cache Storage under iOS eviction**, the warm over a real tailnet, and whether four columns
  plus one more ~44px strip of filter chrome is right in the owner's hand — all still need the
  device.

## What the next ticket inherits

- **`client/binder/filters.ts` is the whole filter vocabulary in one module.** A new axis is one
  entry in `FILTER_AXES`, one case in `carriedValues`, one title, and — if closed — one entry in
  `CLOSED_VOCABULARIES`. The codec, the toggle, the sheet and the predicate all follow.
- **Anything reading `useSearch` must treat its input as untrusted.** See the defect above.
- **The outbox (`01m04pms9d`)** gets an unchanged sheet, an unchanged mutation surface, and a
  binder query already in `offlineFirst`. Note that `networkMode` on **mutations** is a separate
  setting and still the default — the outbox ticket must decide it deliberately.
- **Hand-added variants (`01m04pmbep`)** become filterable with no code change: the six open axes
  read their options off the document.
- **Photographs (`01m04pmax6`)**: `warmCorpusImages` takes a list of URLs and an injected cache,
  so warming owner photographs is a second target list rather than a second implementation. It
  would want its own cache name.
- **A mistaken disposal still cannot be undone through the API** — inherited unchanged from the
  copies ticket, still awaiting a decision.
