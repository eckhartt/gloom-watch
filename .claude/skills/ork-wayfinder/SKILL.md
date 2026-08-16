---
name: ork-wayfinder
description: Plan an effort too big for one agent session as a map of decision tickets on the ork graph, then resolve them one at a time until the way to the destination is clear. Use when the user asks to chart a wayfinder map, work through one, or plan something too large to hold in one session.
---

# ork-wayfinder

A loose idea has arrived — too big for one session, and wrapped in fog: the way
from here to the **destination** is not visible yet. Wayfinding is about finding
that way, not charging at the destination. This skill charts the way as a **map**
on the ork context graph, then works its **decision tickets** — questions whose
resolution is a decision, not slices of a build to execute — one at a time until
the route is clear.

The destination varies per effort, and naming it is the first act of charting:
it might be a spec to hand off, a decision to lock before planning starts, or a
change made in place. Naming it fixes the scope, so it is settled first.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the
map is done when nothing is left to decide before someone goes and builds. The
pull to just do the work is usually the signal you have reached the edge of the
map and it is time to hand off. An effort can override this in its **Notes** —
carrying execution into the map itself — but absent that, produce decisions, not
deliverables.

## Refer by name

Every node has a title and a short id. In everything a human reads — narration,
map prose, commit messages — name the node and give its short id: "Choose the
store (`01kz9v2q3r`)". Never a bare ULID. A wall of ids is illegible; titles read
at a glance. `ork` accepts the short id, a unique id prefix, or a slug fragment
wherever a ref is wanted, so the readable form is also the usable one.

## What the map is made of

| wayfinder | ork |
| --- | --- |
| the map | a `group` node |
| a ticket | a `decision` node, child of the map |
| the question | the ticket's body, while it is open |
| the resolution | the same body, rewritten before the ticket is closed |
| blocking | a `blocks` edge — `A blocks B` means A must close before B is takeable |
| the frontier | `ork frontier <map>` |
| a claim | the `claimed` meta key |
| the fog | prose in the map body, under "Not yet specified" |
| out of scope | a `moot` ticket, archived, plus a line in the map body |

Ticket status is the whole lifecycle:

- `proposed` — **open**. The question is asked and nobody has taken it.
- `deciding` — **being worked**. A session is resolving it right now.
- `ruled` — **resolved**, and frozen: the body is the answer, permanently.
- `moot` — **ruled out** — decided against, or past the destination. Frozen exactly
  like a resolution, because a dead question must not be quietly edited into a
  live one.

`archived` is **not** one of these. It is a separate flag — `ork archive <ticket>`
sets it and `ork restore <ticket>` clears it — that hides a ticket from listings
while leaving its status exactly as it was. Ruling a ticket out of scope is both
acts: the status is the verdict, the flag is the housekeeping.

## The map body

The whole effort at low resolution, loaded once per session. Start from the
shipped template:

```sh
ork prompt wayfinder-map.md
```

Its sections are **Destination**, **Notes**, **Not yet specified** and **Out of
scope**. There is deliberately **no "Decisions so far" index**: the listing of
the map's resolved children is the index, and each resolved ticket's frozen body
is the detail.

```sh
ork ls <map> --status ruled     # the index — every decision made, in order
ork ls <map>                   # every live ticket under the map
```

Never restate a resolution in the map body. Two copies of an answer is one copy
too many, and the one you forget to update is the one the next session reads.

## Tickets

A ticket's body is **the question**, sized to one session — nothing else. The
answer is not in the body while the ticket is open; it *replaces* the body when
the ticket is resolved.

```sh
ork create decision "Which store backs the queue?" --parent <map> --body-stdin
```

Every ticket carries a flavor in meta, and is either **HITL** — worked *with* a
human who speaks for themselves — or **AFK**, driven by the agent alone. A HITL
ticket only resolves through that live exchange; an agent that answers the
human's side of it has broken the ticket, not resolved it.

- `ticket=research` (AFK) — a fact outside this working directory that a
  decision waits on: docs, a third-party API, prior art. Resolve it with a
  subagent, then park the findings on their own `research` node parented to
  the ticket, and put the answer the decision needs in the ticket body.
  Research is the one flavor exempt from one-ticket-per-session: fire them in
  parallel.
- `ticket=prototype` (HITL) — build something cheap and concrete to react to
  when "how should it look" or "how should it behave" is the real question.
- `ticket=grilling` (HITL) — conversation. The default case. Resolve it with the
  `ork-interview` skill, which runs the questions in rounds and writes the
  resolution back here.
- `ticket=task` (HITL or AFK) — manual work that must happen before a decision
  can be made: provisioning access, moving data so its shape can be seen. The
  one flavor that *does* rather than decides, and it earns its place only by
  unblocking a decision.

```sh
ork meta <ticket> ticket=grilling hitl=yes
```

Mark every HITL ticket `hitl=yes` when you create it. It is the flag that tells
a later session it may not resolve this one alone.

## Blocking and the frontier

Wire blocking in a **second pass**, after the tickets exist — nodes need ids
before they can reference each other.

```sh
ork edge add <blocker> blocks <blocked>
```

```sh
ork frontier <map>              # takeable now: proposed, unblocked, unclaimed, unarchived
ork frontier <map> --blocked    # what is waiting, and on what
ork frontier <map> --tree       # widen past direct children
```

A ticket leaves the frontier the moment it is claimed, blocked, or resolved. A
blocker stops blocking once it is settled either way — `ruled` or `moot` — or
once it is archived. Resolving a ticket and ruling one out of scope both open
the way past it.

## Fog of war

The map is *deliberately* incomplete: do not chart what you cannot yet see.
Beyond the live tickets lies the fog — decisions you can tell are coming but
cannot pin down, because they hang on questions still open. The map body's **Not
yet specified** section is where that dim view is written, as prose. It is not
tickets, and it is not nodes.

**Fog or ticket?** The test is whether you can state the question *now* — not
whether you can answer it now.

- **Ticket** when the question is already sharp, even if it is blocked.
- **Fog** when you cannot yet phrase it that sharply. Do not pre-slice fog into
  ticket-sized pieces: one patch may graduate into several tickets, or none.

Resolving a ticket clears the fog ahead of it. Graduate whatever is now
specifiable into fresh tickets and delete that patch from **Not yet specified**,
so it lives in exactly one place.

## Out of scope

Fog only ever gathers *toward* the destination, so work beyond the destination
is not fog — it is out of scope, and it never graduates. When a ticket turns out
to sit past the destination, do not resolve it. Say why, rule it out, then put
it away:

```sh
ork meta <ticket> scope=out reason="past the destination — separate effort"
ork status <ticket> moot
ork archive <ticket>
```

**Both acts, in that order.** `moot` is the verdict — it is what the graph
answers with forever after when asked what became of this ticket — and
archiving is what takes it out of the way. Archiving alone would hide the
ticket while saying nothing about why, and a later reader could not tell a
ruling from a tidy-up. The scope note goes on first because a `decision` freezes
the moment its status is settled, and after that the flag is the only thing
left that may be written.

Then leave one line in the map body's **Out of scope** section: the gist, why it
is out, and the ticket's title and short id. Ruling out of scope is a scoping
act, not a step on the route, which is why it does not belong in the index of
decisions.

Rule a ticket out **while it is still open**. Once it is settled — `ruled` as
much as `moot` — it is frozen, and a frozen ticket will not take the scope
note. For a resolved one that is the right answer, because a resolved ticket
was on the route.

## Chart the map

The user arrives with a loose idea.

1. **Name the destination.** Interview the user until you can state in one or
   two lines what reaching the end of this map looks like.
2. **Map the frontier**, breadth-first: fan out across the whole space rather
   than deep on any one thread, surfacing the open decisions and the first steps
   takeable now. **If this surfaces no fog** — the way is already clear and the
   whole journey fits one session — say so and stop. There is nothing to chart.
3. **Create the map** from the template, with Destination and Notes filled in
   and the fog sketched into "Not yet specified":
   ```sh
   ork prompt wayfinder-map.md > /tmp/map.md   # then edit it
   ork create group "<destination in a phrase>" --body-file /tmp/map.md
   ```
4. **Create the tickets you can specify now** as children of the map, each body
   the question and each with its flavor meta.
5. **Wire the `blocks` edges in a second pass.** Wiring is what sorts the
   tickets into the frontier and the blocked.
6. **Fire the research tickets** — they are the exception to one per session.
7. **Stop.** Charting resolves nothing. Report the map's title and short id, the
   frontier, and what is still fog.

## Work through the map

The user arrives with a map. Without a named ticket, you pick the next one.

1. **Load the map body** — the low-resolution view. Not every ticket body.
2. **Choose a ticket**: the one the user named, else the first from
   `ork frontier <map>`. **Claim it before any work**, so concurrent sessions
   skip it:
   ```sh
   ork meta <ticket> claimed=<your name>
   ork status <ticket> deciding
   ```
   **The `claimed` key is the claim** — the frontier tests that key and nothing
   else, so the ticket is yours the moment it is set and stays yours until it
   is cleared. Moving the status is the courtesy half: it tells a human reading
   the map what is happening. Neither substitutes for the other.
3. **Check the flag.** `hitl=yes` means the human resolves it with you. If they
   are not here, release the claim (`ork meta <ticket> claimed=` — the empty
   value deletes the key), set the status back to `proposed`, and say so. Do not
   answer it for them.
4. **Resolve it.** Zoom as needed: `ork show <ref> --body` on any related or
   resolved ticket, `ork backlinks <ref>` for what points at it. Follow whatever
   the map's **Notes** section tells you to.
5. **Write the resolution into the ticket body, and only then close it:**
   ```sh
   ork body <ticket> --stdin      # the answer, and what it rules out
   ork status <ticket> ruled       # freezes the body — irreversibly
   ```
   **This order is not a style preference.** A `decision` freezes the instant it
   reaches `ruled`. Close first and the body is frozen as the question, with no
   way to ever write the answer into it — the resolution is bricked, and the
   only repair is a whole new ticket. Write, verify with `ork body <ticket>`,
   then close.
6. **Update the map.** Graduate the fog this answer made specifiable into new
   tickets (create, then wire `blocks` in a second pass) and clear those
   patches from "Not yet specified". If the answer put a ticket past the
   destination, rule it out of scope — `moot`, then archive — rather than
   resolving it. Do not append anything to a "Decisions so far" list — there is
   none, by design.
7. **Close the session.** `ork prompt close.md` prints the close-out shape;
   fill it as a markdown document — decisions with their why, what moved with
   pointers, open questions sharp enough to act on cold — and pipe it to
   `ork session close --node <ticket> --stdin`. The record is for the next
   session, not a recap of this one.

**Never resolve more than one ticket per session** — research tickets excepted.
Each resolution changes what the next question should be, and a session that
resolves three has answered the second and third against a map it stopped
reading after the first.

Changed your mind about a resolved ticket? You cannot edit it — it is frozen.
Create a new `decision` carrying the new answer and point it at the old one:
`ork edge add <new> supersedes <old>`. The old ticket stays as the record of what
was believed, and when.

## When the map is finished

The frontier is empty, every ticket is resolved or ruled out of scope, and
there is nothing left to decide before someone builds. **The way is clear — the
map is done.** What follows is a different job, with its own skill:

- **`ork-spec`** synthesizes the map's frozen decisions into one build-ready
  spec document, puts it through a mandatory adversarial review, and freezes it
  at the owner's ACK.
- Once that spec is ACKed, **`ork-tickets`** cuts it into the build tickets
  agents actually work from, in their own build group beside this map.

Do not start either one here. A session that charts, resolves and then keeps
going has stopped reading the map it is acting on.

## The ork facts this workflow assumes

- A ref is a full ULID, a unique id prefix, or a slug fragment. Every command
  takes `--json`; failures exit 1.
- `ork ls <ref>`, `ork show <ref> --body`, `ork search <query>`,
  `ork backlinks <ref>` read; `ork create`, `ork body`, `ork status`,
  `ork meta`, `ork edge add`, `ork archive`, `ork restore` write.
- `ork meta <ref> <key>=` with an empty value deletes the key. That is how a
  claim is released, and clearing the key is the whole of releasing it.
- **There is no delete.** `ork archive` is the only removal, `ork restore`
  reverses it, and archived nodes stay readable with `--all`.
- Bodies render as markdown in the app's panel. Write documents — headings,
  lists, blank lines — never terminal-compressed one-liners.
- Concurrent sessions may be working the same map. The claim is what keeps you
  off each other's tickets, so claim first and release what you do not finish.
