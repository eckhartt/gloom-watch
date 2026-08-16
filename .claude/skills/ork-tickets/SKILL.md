---
name: ork-tickets
description: Break an ACKed spec into tracer-bullet build tickets on the ork graph — vertical slices in their own build group, sequenced by blocking edges, published only once the owner approves the breakdown. Use when a spec is done and it is time to produce the queue agents build from.
---

# ork-tickets

A spec has been reviewed and ACKed. This skill turns it into the **work queue**:
**build tickets** — `feature` nodes, each a tracer bullet through every layer —
in a new **build group**, sequenced by `blocks` edges, and published only after
the owner has approved the breakdown.

## The spec must be ACKed first

Before anything else:

```sh
ork show <spec> --body
```

- **`filed`** — ACKed. Go.
- **`draft`**, or anything else — still a draft: it has not survived the
  adversarial review or the owner's ACK. **Stop and say so**; `ork-spec` is
  what finishes it. Tickets cut from an unagreed spec are a queue of
  agreed-looking mistakes, and by the time anyone notices, agents have claimed
  them.

## What a build ticket is

| tickets | ork |
| --- | --- |
| the build group | a `group` node, sibling of the map |
| a build ticket | a `feature` node, child of the build group |
| its flavor | `ticket=build` meta |
| what it builds from | an `implements` edge to the spec |
| blocking | a `blocks` edge — `A blocks B` means A must close before B is takeable |
| ready for an agent | `ork frontier <build group>` |
| a claim | the `claimed` meta key |

A build ticket is a **`feature`, not a `decision`**. The planning tickets under a
map each ask a question and freeze the answer; these do work. Nothing here
freezes, and nothing here gets answered — it gets built, and the acceptance
criteria are what say it is finished.

## Refer by name

Name every node and give its short id in anything a human reads — "Stream the
executor's output (`01kz9v2q3r`)". Never a bare ULID: a wall of ids is
illegible, and `ork` takes the short id anywhere a ref is wanted.

## Read the spec whole first

```sh
ork show <spec> --body                  # the whole thing, not the excerpt
ork ls <map> --status ruled             # the decisions behind it, for the why
ork search "domain glossary" --type doc
```

Then explore the codebase, if you have not already. Ticket titles and bodies use
the glossary's vocabulary, and respect the decisions the spec names.

Look for **prefactoring** while you are in there: "make the change easy, then
make the easy change." A prefactoring ticket comes first and blocks the tickets
it makes easy.

## Tracer bullets

- Each slice cuts a **narrow but complete** path through every layer — schema,
  API, UI, tests. Vertical, never a horizontal slice of one layer.
- A finished slice is **demoable or verifiable on its own**.
- Each slice fits **one fresh context window**. The session that builds it starts
  cold, holding the ticket body and the spec and nothing else.
- Prefactoring first.

The horizontal ticket is the failure mode: "add all the database tables" is
never demoable, its acceptance criteria all reduce to "the code exists", and
nothing is proved until the last ticket in the row lands.

## Wide refactors: expand, migrate, contract

A **wide refactor** is one mechanical change — rename a column, retype a shared
symbol — whose blast radius fans across the whole codebase, so a single edit
breaks thousands of call sites at once and no vertical slice can land green.
Do not force it into a tracer bullet. Sequence it instead:

1. **Expand** — add the new form beside the old, so nothing breaks. One ticket.
2. **Migrate** — move the call sites over in batches sized by blast radius (per
   package, per directory), **each batch its own ticket**, each blocked by the
   expand. CI stays green batch to batch because the old form still exists.
3. **Contract** — delete the old form once no caller remains, in a ticket
   blocked by every migrate batch.

When even the batches cannot stay green alone, keep the sequence but let them
share an integration branch and all block a final integrate-and-verify ticket.
Green is promised there and only there — say so in the tickets, so a session
does not spend its budget chasing a red suite that was expected.

## Quiz the owner (mandatory)

**Create nothing until the owner approves the breakdown.** Present it as a
numbered prose list, blockers first, each entry giving:

- **Title** — short and descriptive.
- **Blocked by** — the numbers of the tickets that gate it, or "nothing".
- **What it delivers** — the end-to-end behavior this ticket makes work.

Then ask, in plain text:

- Does the granularity feel right — too coarse, too fine?
- Are the blocking edges right: does each ticket depend only on what genuinely
  gates it?
- Should any tickets be merged, or split further?

Iterate until they approve. This is a list to read, not a choice among options,
so do not wrap it in a structured question tool. **Publish on explicit approval
only** — silence is not approval, and neither is a reply about something else.

Publishing early is not a small thing to undo: the moment these nodes exist,
they are claimable, and pulling back a breakdown nobody agreed to means ruling
tickets `dropped` and archiving them while an agent may already be building
one.

## Publish

The tickets go in a **new build group, sibling of the map** — never under the
map. The map is a closed planning artifact: build tickets under it muddy what
its `done` means, and every listing from then on interleaves planning
with build.

```sh
ork show <map> --json                       # read its parent
ork create group "<effort> — build" --parent <the map's parent>
ork edge add <spec> relates <build group>
```

If the map is a root, drop `--parent` — the build group is a root too.

Then the tickets, **in dependency order, blockers first**, so every ticket
exists before anything needs to reference it:

```sh
ork create feature "<title>" --parent <build group> \
  --meta ticket=build --edge implements:<spec> --body-file /tmp/ticket.md
```

Set `ticket=build` on every one. It is what makes a build ticket legible as one
— on the canvas, and in any listing that mixes it with planning work.

Every ticket carries an `implements` edge to the spec. That edge is the answer to
"which document was this built from", and `ork backlinks <spec>` is how a later
session finds the whole build from the spec alone.

### The ticket body

```markdown
## What to build

The end-to-end behavior this ticket makes work, from the user's perspective —
not a layer-by-layer implementation list.

## Acceptance criteria

- [ ] Something observable, that a session can check off
- [ ] ...
```

**No "Blocked by" section.** The `blocks` edges are the record, and
`ork frontier <build group> --blocked` reads them; a second copy in prose is the
one that goes stale. Leave out file paths and code snippets for the same reason
— they go stale faster than the ticket does. The exception is the spec's: a
snippet that encodes a decision more precisely than prose can, trimmed to the
decision-rich part.

## Wire the blocking in a second pass

Nodes need ids before they can reference each other, so blocking is wired after
every ticket exists:

```sh
ork edge add <blocker> blocks <blocked>
```

```sh
ork frontier <build group>              # takeable now
ork frontier <build group> --blocked    # what is waiting, and on what
```

## Ready for an agent is the frontier

There is **no `ready-for-agent` label** here, and no status convention beyond
the names a `feature` declares. A ticket is ready when it is `todo`, unblocked,
unclaimed and unarchived — which is exactly what `ork frontier <build group>`
computes, every time it is asked. Do not add a meta key that duplicates it: a
stored copy of a derived state is wrong the moment a blocker closes, and it is
wrong silently.

## Working a ticket

Claim it before any work, so concurrent sessions skip it:

```sh
ork meta <ticket> claimed=<your name>
ork status <ticket> active
```

**The `claimed` key is the claim.** The frontier tests that key alone, so the
ticket is yours the moment it is set — the status beside it is what tells a
human reading the listing that somebody is on it.

**One slice per session.** A session that builds three has planned the second
and third against a spec it stopped re-reading after the first, and a tracer
bullet nobody demoed is just a horizontal slice with better paperwork. Release
what you do not finish — `ork meta <ticket> claimed=` with an empty value, and
status back to `todo`.

Finish by checking off every acceptance criterion in the body:

```sh
ork body <ticket> --stdin              # criteria checked off, notes for the reviewer
ork bind <ticket> --pr 142 --branch feat/x
ork status <ticket> done
```

Then the close-out: `ork prompt close.md` prints the shape. Fill it as a
markdown document — what moved with pointers, decisions with their why, open
questions sharp enough to act on cold — and pipe it to
`ork session close --node <ticket> --stdin`. It is written for the next session,
not as a recap of yours.

## The ork facts this workflow assumes

- A ref is a full ULID, a unique id prefix, or a slug fragment. Every command
  takes `--json`; failures exit 1.
- `ork meta <ref> <key>=` with an empty value deletes the key. That is how a
  claim is released, and clearing the key is the whole of releasing it.
- `ork body <ref> --stdin` **replaces** the body. Read it first.
- Bodies render as markdown in the app's panel. Write documents — headings,
  lists, blank lines — never terminal-compressed one-liners.
- Derived states are never stored: `blocked` comes from incoming `blocks`
  edges and the frontier is computed from status, blockers, claims and the
  archived flag.
- There is no delete. `ork archive <ref>` is the only removal, and
  `ork restore <ref>` reverses it.
