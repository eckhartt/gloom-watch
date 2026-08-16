---
name: ork-interview
description: Interview a human in rounds until you reach shared understanding — grill a plan, decision or idea, sharpen the domain language it is phrased in, and record the resolution on the ork graph. Use when the user asks to be grilled or to stress-test their thinking, when resolving a HITL decision ticket, or when domain terminology needs pinning down.
---

# ork-interview

Interview the human until you reach a **shared understanding**, then record it
where the next session will find it. Two disciplines run as one loop: **grilling**
— working the design tree in rounds of questions — and **domain modeling** —
sharpening the words the answers are phrased in, as they are spoken.

The point is not to gather requirements and go build. It is to leave nothing
being decided by a guess: yours, silently, later.

## Two ways in

- **A ticket.** A `decision` node marked `hitl=yes` — usually `ticket=grilling` —
  under a map. The resolution belongs in its body. See `ork-wayfinder` for how
  maps and tickets work; this skill is how one of them gets resolved.
- **Standalone.** "Grill me about X", no map, no ticket. The loop below is
  identical; only the recording differs.

## The frontier of questions

Map the problem as a **design tree**: every decision branches into the decisions
that hang off it. The **frontier** is every question whose prerequisites are
already settled — what you can ask *now* without guessing at answers you have
not heard yet.

This is a map's frontier one scale down: there, tickets across sessions; here,
questions inside one conversation. Same rule governs both — nothing is takeable
until what it depends on has settled. When the tree outgrows the conversation,
the graph is where it goes on living.

## Rounds

Ask the whole frontier in one round, then stop and wait for the answers.

- **Number and title every question.** A titled question can be answered out of
  order and referred back to; an unlabelled wall of prose cannot.
- **Give your recommended answer, first.** Always have one, and say why in a
  line. An interview with no recommendations is an interrogation: it hands the
  work back to the human, who came to you precisely to not do it.
- **Hold the dependents.** A question whose answer depends on another question
  still open *in this round* belongs to a later round. Asking it now forces the
  human to answer two things at once and gets you a muddle.

```
Q1 — <short title>
<the question, and the live options as you see them>
Recommended: <your answer, and the reason in one line>

Q2 — <short title>
...
```

If your harness has a structured question tool, use it for these — choosing
among live options is what it is for — and put the recommended option first in
the list; the block above is the fallback shape. It is for round questions
only: never put a summary, a resolution, or an ACK inside it.

Each round's answers reshape the tree: settled decisions push the frontier
outward and unblock what depended on them. Recompute the frontier and ask the
next round. Answers that contradict an earlier one are not a nuisance — say so
plainly and re-ask the question they invalidated.

## Never ask what you can look up

**Facts are your job. Decisions are theirs.** Anything answerable from the
filesystem, the repo, the graph or the docs goes to a sub-agent — and it goes
*mid-round*, not as a reason to delay the round.

Do not block on it. A running investigation is an unsettled prerequisite, so
only the questions downstream of it wait; ask the rest of the frontier now and
fold the findings in when they land.

A substantial answer gets its own `research` node so the next session can
read it too; a one-line fact just goes in the round.

The graph is a lookup too: `ork search <query>`, `ork show <ref> --body`,
`ork backlinks <ref>`. A question a resolved ticket already answers is not a
question — it is homework you skipped.

## When a branch outgrows the session

Some branch will be too big to settle here. Do not force it into this
conversation, and do not let it die in scrollback.

- **Under a map**, graduate it into its own ticket:
  ```sh
  ork create decision "<the question, sharply phrased>" --parent <map> --body-stdin
  ork meta <new> ticket=grilling hitl=yes
  ork edge add <new> blocks <whatever it now blocks>
  ```
  Wire the `blocks` edges in a second pass, once the new tickets have ids.
- **Standalone**, with nowhere to put a ticket: name the branch in the
  resolution summary as an open question, in enough detail that it can be asked
  again cold. An unresolved branch that is *written down* is a finding; one that
  is only remembered is a leak.

## Done is an ACK, not an empty frontier

The interview is over when all three hold:

1. The frontier is empty — every branch visited or explicitly graduated.
2. Nothing is silently assumed. Anything you filled in yourself is stated as
   yours, out loud, and confirmed.
3. **The human has explicitly ACKed a resolution summary.** Write the summary —
   what was decided, what it rules out, what graduated, what is still open — **as
   prose in the conversation**, then ask for confirmation in plain text:
   "confirm, or tell me what to change." Do not wrap the summary in a structured
   question tool — it is text to read, not a choice among options, and a picker
   holding a wall of decisions is unreadable exactly when reading matters most.

**Take no action on the decision before that ACK.** Not a commit, not a file, not
a status change. Silence is not agreement, "sounds good" to some other question
is not an ACK of the summary, and anything short of clear agreement is not an
ACK either.

## Recording it — the ticket case

Claim the ticket before the first question, so a concurrent session does not
work it too:

```sh
ork meta <ticket> claimed=<your name>
ork status <ticket> deciding
```

**The claim is the `claimed` meta key, alone.** That key is what a concurrent
session tests before taking a ticket; the status beside it is how a human
reading the map sees that somebody is on it. Setting the status without the key
claims nothing.

`hitl=yes` means this ticket resolves **only** through live exchange. If the
human is not here — or leaves mid-interview — release it and stop:

```sh
ork meta <ticket> claimed=          # empty value deletes the key
ork status <ticket> proposed
```

An agent that answers the human's side of a HITL ticket has not resolved it, it
has broken it: the ticket now reads as settled, and the one thing it was for —
the human's actual opinion — never happened. Releasing an unfinished claim
costs nothing. Faking the other half costs the decision.

Once ACKed, write the resolution into the body **before** closing:

```sh
ork body <ticket> --stdin      # the question as finally understood, the answer,
                               # the alternatives weighed and why they lost
ork body <ticket>              # read it back
ork status <ticket> ruled       # freezes the body — irreversibly
```

**The order is the whole point.** A `decision` freezes the instant it reaches
`ruled`. Close first and you have frozen the question with no answer in it, and
no way to add one — the interview is spent and the record is empty. Write,
verify, then close.

The body is the minutes: someone who was not in the room should be able to read
it and know not just what was decided but what was rejected. Write it as a
markdown document — headings, lists, blank lines — it renders in the app's
panel, not a terminal. Then close the session record the same way:
`ork prompt close.md` prints the shape; fill it and pipe it to
`ork session close --node <ticket> --stdin`.

A resolved decision is frozen. Reopening it later means a new `decision`
carrying the new ruling and `ork edge add <new> supersedes <old>` — the old one
stays as the record of what was believed, and when.

## Recording it — no ticket, no map

The ACKed summary is still the artifact; the transcript is not. Offer to park it
as a record — written once, finished when it lands:

```sh
ork create doc "<what was decided, in a phrase>" --status filed --body-stdin
```

with the decisions, the rejected alternatives, and the branches left open. If
the user would rather not, say plainly that this interview now lives only in
this transcript — then let it go. It is their call, not yours.

## Sharpen the language as it is spoken

Domain modeling is not a phase after the interview. It runs *inside* the rounds:

- **Challenge terminology that contradicts the glossary** — immediately, not in
  a tidy-up pass. "The glossary defines *claim* as X, but you are using it as Y
  — which is it?" Accommodate nothing silently. A word that quietly means two
  things becomes two implementations, and the merge is somebody's week.
- **Refine fuzzy terms into precise ones.** When a term is vague or overloaded,
  propose the canonical one: "you said *account* — the Customer, or the login?"
  Then use the winner for the rest of the interview.
- **Stress-test boundaries with concrete scenarios.** Invent the awkward case
  and make them rule on it: "what happens when a claimed ticket's blocker
  reopens?" Models are wrong at their edges, and a specific scenario finds the
  edge without an argument about definitions.
- **Cross-reference the code.** When stated behavior and the implementation
  might disagree, send an investigator to check while the round continues. If
  they contradict each other, put the contradiction to the human — do not
  quietly pick the one you like. "The code archives the whole node; you just
  said a field can be archived on its own — which is right?"

## The glossary

The ubiquitous language lives in one living `doc` node. **Find it — never
hardcode an id:**

```sh
ork search "domain glossary" --type doc
ork ls --type doc   # if the search comes up empty
```

**Update it the moment a term resolves** — same session, same round, before the
next question:

```sh
ork body <glossary>                  # read it whole
ork body <glossary> --stdin          # write it back whole, with the new entry
```

A body write replaces the whole body, so read before you write. Do not batch
glossary updates to the end: the batch is what gets dropped when the session
runs long, and the term you did not write down is the one the next session
re-litigates.

Keep it a glossary. It says what words **mean** here — not how they are
implemented, not what is planned, not a scratch pad. It stays `living`: a
document that is current and editable forever, never a finished record.

**No glossary yet?** Do not create one preemptively. At the first term that
actually resolves, propose it:

```sh
ork create doc "domain glossary" --status living --body-stdin
```

## When a ruling deserves its own node

An interview produces many small rulings. Most of them belong in the ticket body
or the brief of the work they govern. A ruling earns its **own `decision` node**
only when all three hold:

1. **Reversal costs something real** — changing your mind later is not free.
2. **A future reader needs the context** — they will ask "why is it like this?"
3. **Genuine alternatives existed** — and one was chosen, for reasons.

Miss one and skip it. A graph full of ceremonial decisions is a graph nobody
reads, and the ruling that mattered is lost among them. Below the bar, the
ruling lives where the work is.

## The ork facts this loop assumes

- A ref is a full ULID, a unique id prefix, or a slug fragment. Every command
  takes `--json`; failures exit 1.
- Refer to nodes by title and short id in anything a human reads — "the glossary
  (`01kz9v2q3r`)" — never a bare ULID.
- `ork meta <ref> <key>=` with an empty value deletes the key. That is how a
  claim is released, and clearing the key is the whole of releasing it.
- `ork body <ref> --stdin` **replaces** the body. Read it first.
- Bodies render as markdown in the app's panel. Write documents — headings,
  lists, blank lines — never terminal-compressed one-liners.
- There is no delete. `ork archive <ref>` is the only removal, and
  `ork restore <ref>` reverses it.
