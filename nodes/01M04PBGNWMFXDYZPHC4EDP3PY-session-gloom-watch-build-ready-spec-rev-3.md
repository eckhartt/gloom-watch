---
id: 01M04PBGNWMFXDYZPHC4EDP3PY
type: session
title: "session: Gloom Watch — build-ready spec (rev 3)"
status: closed
parent: 01M04P3SX9KAV082W044TGV9GD
---
## What changed

**The spec exists and is filed:** *Gloom Watch — build-ready spec (rev 3)* (`01m04p3sx9`),
ACKed by the owner. It supersedes rev 2 (`01m04mx3de`); rev 1 (`01m04f83a5`) is archived.

**Rev 3 specifies invariants, not DDL.** That is the session's main methodological lesson.
Rev 1 was criticised for having no artifacts, so rev 2 shipped a full schema and endpoint
list — and two review rounds then found most of their defects *in the artifacts the author
invented*, not in the decisions the map made. Rev 3 states what identity is composed of,
what states exist, what may never be stored, and what must survive a re-import, and leaves
DDL and routes to the builder.

**Nine decisions frozen**, four superseding earlier rulings:

| Node | Ruling |
| --- | --- |
| `01m04je8az` | Runtime is **Bun 1.3.14 stable** — supersedes `01m03xa8cw` |
| `01m04je8wa` | **Price ceiling dropped** from the push rule — supersedes `01m03xaa33` |
| `01m04je9e7` | **Card-grain matching** — superseded in one respect by `01m04nww7n` |
| `01m04jea06` | `missing_upstream` leaves the completion denominator unless owned |
| `01m04k28t8` | Condition ladder kept; **eBay-vocabulary claim withdrawn** — supersedes `01m03xa7ty` |
| `01m04mt0sv` | **Scanner backfills existing inventory once** at commissioning |
| `01m04nwvnj` | Listings stored as a **field whitelist**, never a raw payload |
| `01m04nww7n` | **Aliases may resolve to a variant**, not only a card |
| `01m04nwwsh` | **Every language TCGdex carries** for the line is in the masterset |

**Review parked** at `01m04hm3vs`, linked from every spec revision.

## Decisions made, and why

**Bun 1.4 was never published.** `npm view bun dist-tags` returns
`{ latest: '1.3.14', canary: '1.3.13-canary.20260425.1' }` — the canary channel is *behind*
stable and no 1.4 exists in any channel. `01m03xa8cw` specified "Bun 1.4 canary, pinned to
an exact build", which has no referent, and the evidence that overruled the Node
recommendation (a Rust rewrite, a Prisma OOM benchmark) could not be reached in any primary
source. **This was an error in research this map produced.** 1.3.14 contains `Bun.cron`
OS-level jobs (shipped 1.3.11) and everything else the design needs, so the correction
*removes* an accepted risk.

**The price ceiling could not do its job.** Without market comparison — out of scope — an
absolute number cannot distinguish a bargain from a rip-off, and one number cannot be
meaningful across a line spanning $2 to $400. Removing it also dissolved a contradiction the
map never resolved: one ceiling compared against four marketplace currencies with no FX API.
Priority is now the sole instant trigger; everything else digests.

**eBay's condition vocabulary is not what the map recorded.** It is Near mint or better /
Excellent / Very good / Poor — four values. `NM/LP/MP/HP/DMG` is the TCGplayer ladder; the
two were conflated. Worse, **card condition is not in search results at all** — it lives in
`conditionDescriptors` on the single-item endpoint, so obtaining it costs a call per
listing. The "no translation layer" justification was void either way, and the ladder is
retained on its own merit.

**The scanner would have launched blind.** `itemStartDate` keys off `itemOriginDate`, which
is **retained across relists**, so a forward cursor only ever sees listings created after it
starts. ~25,000 active Gloom listings would never have been scanned. Hence the backfill.

**Raw payloads would have broken the hosting model.** A Browse summary contains
`seller.username`; storing it for 90 days is persisting eBay user data readably, which
forfeits the account-deletion opt-out and forces a public HTTPS endpoint. The field
whitelist keeps everything the matcher reads and drops the seller object at the boundary.

**Aliases had to carry a variant.** Both reviewers independently found that a card-grain
alias teaches nothing for partly-owned cards — the queue's dominant case — so the queue
never drained. The carve-out is precise: the *matcher* still never guesses a variant; an
owner confirming in the queue is not a guess.

## Open questions

- **Confidence scoring function** — bias and threshold decided, the function is not. Tune
  against the first week of real listings.
- **Digest membership and size bounds** — needs a real digest to look at.
- **Confirm-queue, feed and lots layout** — explicitly undecided since the prototypes were
  rejected. Do not decide on paper.
- **Silent-push failure has no live detection.** Declarative Web Push's exemption is the
  real answer; a client-side heartbeat only makes divergence visible after the fact.
- **Completion has no oracle.** A membership regression makes the percentage *higher* with
  every test green. Mitigation specified: warn when the variant count drops after a sync.
- **Facts to verify at build time:** real listings-per-day; GB/DE/AU category IDs;
  commissioning step 8 (Tailscale off, push arrives); eBay condition descriptor IDs must be
  read from `getItemConditionPolicies`, never hard-coded; OAuth token lifetime.
- **Phone→server auth** remains deliberately unruled — the tailnet is the perimeter, and
  whether any surface deserves a second factor was never decided. Blocks nothing.

## Lessons worth carrying

1. **Verify generated artifacts before presenting them.** Prototypes were sent unviewed
   earlier in this map; grepping CSS is not verification.
2. **Research claims need primary sources.** Three frozen decisions rested on assertions
   that did not survive contact with npm, eBay's own docs and WebKit source.
3. **A spec that invents artifacts gets reviewed on its inventions.** Specify invariants.
4. **Reviewers can be confidently wrong.** Both claimed `Bun.cron` was in-process only; they
   had read one of its two call forms. Adjudicate, do not simply absorb.

## Links

- Spec: `01m04p3sx9` (filed)
- Review: `01m04hm3vs`
- Map: `01m03x4d6h`
- Next: `ork-tickets` against the filed spec
