---
name: ork-spec
description: Synthesize a finished wayfinder map into one build-ready spec document on the ork graph, put it through a mandatory adversarial review, and freeze it at the owner's ACK. Use when a map's decisions are all resolved and it is time to write the spec, or when a spec needs reviewing or revising.
---

# ork-spec

A map's decisions are resolved and the way to the destination is clear. What is
left is to write it down as **one document somebody can build from**. This skill
synthesizes that map into a **spec** — a `doc` node, child of the map — and
does not let it reach `filed` until a fresh adversarial reader has attacked it
and the owner has ACKed what survived.

## Synthesis, not an interview

Every decision this spec contains was already made, and is already frozen on the
map. Do not re-open them. Do not ask the user to re-confirm them. Do not ask
anything you could answer by reading the graph and the code — the one question
this skill asks the user is the ACK at the end.

If a decision turns out never to have been made, that is a **gap in the map**,
not a thing to settle here in prose nobody ruled on. Name it, and go resolve it
as a ticket with `ork-wayfinder` first.

## What the spec is made of

| spec | ork |
| --- | --- |
| the spec | a `doc` node, child of the map |
| the draft | status `draft` |
| the ACKed spec | status `filed` — a finished record, never edited again |
| what it synthesizes | the map's resolved `decision` children |
| what it rules out | the map body's out-of-scope, plus the tickets ruled out |
| a revision | a new `doc`, a `supersedes` edge, and the old one archived |
| what it feeds | the build tickets `ork-tickets` cuts from it, once it is `filed` |

## Refer by name

Every node has a title and a short id. In everything a human reads — the spec's
own prose, narration, commit messages — name the node and give its short id:
"Choose the store (`01kz9v2q3r`)". Never a bare ULID.

**This is how the spec links its decisions, and the only way it links them.** Do
not wire an edge from the spec to every decision it draws on. Forty edges out of
one node is unreadable on the canvas and tells a reader nothing the sentence
next to the id already told them.

## Read the whole map first

The spec is only as good as what you loaded. Read every resolved ticket body
whole — the frozen body *is* the decision, and its rejected alternatives are
often the thing that stops an implementer relitigating it.

```sh
ork show <map> --body              # Destination, Notes, Out of scope
ork ls <map> --status ruled        # the index of decisions, in order
ork show <ref> --body              # every one of them
ork ls <map> --archived            # what was ruled out of scope, and why
ork search "domain glossary" --type doc
```

Then check the map is actually finished:

```sh
ork frontier <map>                 # must be empty
ork ls <map> --category todo
ork ls <map> --category active
```

**Do not synthesize around an open decision.** Anything still in the `todo` or
`active` category is a hole the spec would have to paper over with a guess.
Report which tickets are open, by title and short id, and stop.

Use the glossary's vocabulary throughout the spec. A spec that renames the
domain's own terms makes every reader translate.

## The shape

```markdown
## Problem Statement

The problem being solved, from the user's perspective.

## Solution

The solution, from the user's perspective.

## User Stories

A long, numbered list, each one "As an <actor>, I want <feature>, so that
<benefit>". Cover every aspect of the feature — this list is where a reader
checks whether the spec forgot their case.

## Implementation Decisions

What was decided and what it commits to: the modules built or modified and
their interfaces, architectural rulings, schema changes, API contracts,
specific interactions. Name each decision by title and short id, so a reader
who wants the alternatives can go read the frozen ticket.

## Testing Decisions

The seams the feature will be tested at, what makes a good test here (external
behavior, never implementation details), which modules get tested, and the
prior art in this codebase to follow.

## Out of Scope

What this spec deliberately does not cover, and why.

## Further Notes

Anything else a builder needs and nothing above it holds.
```

**No file paths, no code snippets.** They go stale faster than the spec does.
The exception is a snippet that encodes a decision more precisely than prose can
— a state machine, a schema, a type shape — inlined in the decision it belongs
to, trimmed to the decision-rich part. Not a working demo.

**Write it self-contained.** The reader is an agent holding this document and
nothing else: no conversation, no map. Every term it leans on is defined in it
or in the glossary, and every claim it makes stands without a link.

## Testing seams

Identify the seams **as you synthesize**, and record them in Testing Decisions.
Prefer seams that already exist; use the highest one that works. The fewer seams
across the codebase the better — one is the ideal.

Do not stop to confirm the seams with the user. That check belongs to the
reviewer and the ACK, both of which are coming, and a confirmation round here
would turn synthesis back into an interview.

## Draft it

```sh
ork create doc "<what it specifies> — spec" --parent <map> --status draft \
  --body-file /tmp/spec.md
```

`draft` means drafted, not agreed. The spec is not something to build from
until it is `filed`, and it does not get there without the two gates below.

## The adversarial review (mandatory)

Hand the draft to a **fresh subagent that has none of your context** and brief it
to attack the document, not to admire it:

- **Gaps** — every place an implementer would have to stop and ask, or guess.
  Two competent implementers building from this must not ship different things.
- **Contradictions** — two sections that cannot both be true.
- **Untestable claims** — anything asserted that no test could catch failing.
  **An untestable claim is a blocker**, not a nitpick: it is a promise with no
  mechanism behind it.

More than one reader is better, each with its own lens: an
implementation-readiness walk that builds the thing mentally and records every
stop-or-guess, an ambiguity and contradiction hunt, and a cross-check of every
external claim the spec makes against the real source. Ask each for a verdict,
ranked findings, and — just as usefully — what checked out, so the next round
does not re-litigate it.

**You cannot review your own draft.** An agent that wrote the spec has already
silently resolved every ambiguity in it; that resolution lives in its head and
not in the document, which is the exact defect the review is looking for. Fresh
context is the whole mechanism.

Park the review as its own `doc` node under the map, so the next reader can
see what was attacked and what held:

```sh
ork create doc "Adversarial reader review — <spec title>" --parent <map> --status filed --body-stdin
ork edge add <spec> relates <review>
```

**Every blocker is resolved before the ACK** — fixed in the spec, or explicitly
ruled out of scope with the reason written into Out of Scope. None is left
"noted". A blocker acknowledged and not answered is the same document with a
disclaimer.

## The ACK

The owner ACKs the spec, and only the owner. The reviewer runs AFK and its
verdict is not an ACK; neither is silence, nor "sounds good" to some other
question.

Write the summary **as prose in the conversation** — what the spec says, what
the review found, how each blocker was resolved, what it rules out of scope —
then ask for confirmation in plain text: "confirm, or tell me what to change."
Do not wrap it in a structured question tool: it is text to read, not a choice
among options.

**Take no action before that ACK.** Do not set the spec `filed`, and do not start
breaking it into work — tickets exist to decompose an *agreed* spec, and a build
queue cut from an unagreed one is a queue of agreed-looking mistakes.

Once ACKed:

```sh
ork body <spec>                # read it back whole
ork status <spec> filed         # this is the handoff, not a bookkeeping step
```

## Revisions are new documents

Changed your mind after the spec is `filed`? **Never edit it in place.** A
`doc` is not frozen by the store the way a `decision` is — `ork body` will
happily rewrite an ACKed spec, and nothing will stop you. The rule is discipline,
and it is load-bearing: agents may already be building from that text, and a
silent edit changes the contract under them mid-flight. "What did the builders
read?" must always have an answer.

```sh
ork create doc "<title> (rev 2)" --parent <map> --status draft \
  --edge supersedes:<old spec> --body-file /tmp/spec-rev2.md
# review it and get it ACKed exactly like the first one, then:
ork status <new> filed
ork archive <old spec>
```

The old spec stays readable (`ork show <ref> --body`, archived nodes need
`--all` in listings) as the record of what was believed, and when.

## When the map has a ticket for this

Often the map's last ticket is "assemble the spec". Claim it before you start,
so a concurrent session does not do it too:

```sh
ork meta <ticket> claimed=<your name>   # the key is the claim
ork status <ticket> deciding
```

Its resolution — written into the body **before** `ork status <ticket> ruled`,
which freezes it irreversibly — is a short pointer: the spec exists, here is its
title and short id, here is what the review found. Not a second copy of the
spec. Two copies of a document is one copy too many, and the one you forget to
update is the one the next session reads.

## Then hand it off

An ACKed spec is the input to `ork-tickets`, which breaks it into the build
tickets agents work from. Do not start decomposing here — that skill has its own
approval gate, and it is a different session's job.

## Closing the session

`ork prompt close.md` prints the close-out shape. Fill it as a markdown document
— what moved with pointers, decisions with their why, open questions sharp
enough to act on cold — and pipe it to `ork session close --node <spec> --stdin`.

## The ork facts this workflow assumes

- A ref is a full ULID, a unique id prefix, or a slug fragment. Every command
  takes `--json`; failures exit 1.
- `ork body <ref> --stdin` **replaces** the body. Read it first.
- Bodies render as markdown in the app's panel. Write documents — headings,
  lists, blank lines — never terminal-compressed one-liners. The record is the
  product here more than anywhere else: the spec *is* the deliverable.
- `ork meta <ref> <key>=` with an empty value deletes the key. That is how a
  claim is released, and clearing the key is the whole of releasing it.
- There is no delete. `ork archive <ref>` is the only removal, and
  `ork restore <ref>` reverses it.
