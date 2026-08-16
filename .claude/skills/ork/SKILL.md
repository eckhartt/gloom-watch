---
name: ork
description: Read and update the ork context graph — the plan/spec/feature nodes for this repository — via the ork CLI. Use when you need task context, want to record findings or decisions, create or link nodes, or close out a work session.
---

# ork — context graph CLI

The repository's plan lives as markdown nodes on the `orchestrator` git
branch. The `ork` CLI is how sessions read context and record results.
Every command accepts `--json` for machine-readable output; errors exit 1
(JSON errors print `{"error":{"code","message"}}`).

Node refs: full ULID, unique ULID prefix, or a filename slug fragment.

## Taxonomy

Node types in this repository:

- `feature` — bindings: pr, branch; gets a git worktree; takeable work
- `bug` — bindings: pr, branch; gets a git worktree; takeable work
- `spike` — bindings: branch; gets a git worktree; takeable work
- `doc`
- `research` — read-only sessions
- `session` — app-generated; never create by hand
- `group`
- `decision` — frozen once `ruled` or `moot`; takeable work

Edge types: `relates` | `implements` | `supersedes` | `blocks`

Statuses are declared per type, and every name maps to one of four fixed
categories — `todo` | `active` | `done` | `dropped`. People read the name; every
cross-type question asks by category (`--category`), never by name:

- `feature`, `bug`, `spike`, `research`, `group`: `todo` | `active` | `done` | `dropped`
- `doc`: `planned` | `draft` | `living` | `filed` | `retired`
- `session`: `closed`
- `decision`: `proposed` | `deciding` | `ruled` | `moot`

`archived` is not a status. It is a separate flag — `ork archive <ref>` sets it,
`ork restore <ref>` clears it — that hides a node from listings without touching
what happened to it. What a node's status says it is stays true after it is put
away.

## Reading context

```sh
ork ls                     # roots of the graph
ork ls <ref> --tree        # subtree under a node
ork show <ref> --body      # one node with its markdown body
ork search <query>         # substring match over titles and bodies
ork backlinks <ref>        # every node whose edges point AT this one
ork frontier <ref>         # children takeable now: todo, unblocked, unclaimed, unarchived
ork prompt <name>          # a body/session template from the data branch
ork export                 # the whole graph as one JSON document
ork log <ref>              # git history of a node
```

## Recording work

```sh
ork create <type> "Title" --parent <ref> --body-stdin   # types: feature|bug|spike|doc|research|group|decision
ork body <ref> --stdin      # replace a node body (research findings go here)
ork status <ref> done       # feature: todo | active | done | dropped — per type
ork archive <ref>           # hide it without changing what happened to it
ork edge add <ref> <type> <target>   # relates|implements|supersedes|blocks
ork bind <ref> --pr 142 --branch feat/x
```

**Bodies are read in the app, not the terminal.** Every body you write — a
ticket, findings, a close-out — renders as markdown in a panel somebody reads
later. Write a document: headings, lists, blank lines between thoughts. A
terminal-compressed paragraph of run-on clauses is unreadable there, and the
record is the product.

Notes:
- `blocked` is derived from incoming `blocks` edges — never set it.
- Settled `decision` nodes are frozen — at a `done` status and at a
  `dropped` one alike. Record a change of mind as a new node with a
  `supersedes` edge to the old one.
- There is no delete. `ork archive <ref>` is the only removal, and
  `ork restore <ref>` reverses it.

## Planning something too big for one session

Do not try to hold it all at once. The `ork-wayfinder` skill charts an oversized
effort as a map of decision tickets on this graph and resolves them one at a
time, and `ork frontier <map>` is how a session finds what it may take. When the
next question is one only the user can answer, the `ork-interview` skill runs
that conversation in rounds and records what was decided.

Once the map's decisions are all resolved, `ork-spec` synthesizes them into one
build-ready spec document, and `ork-tickets` cuts that spec into the build
tickets agents work from.

## Closing a session (required)

Before you finish, write a close-out summary. Blank summaries are refused.

The summary is a markdown document written for the **next** session: decisions
with their why, what moved with pointers, open questions phrased sharply enough
to act on cold — not a recap of your activity. `ork prompt close.md` prints
the shape; fill every section:

```sh
ork session close --node <ref> --stdin <<'EOF'
## What changed
- ...
## Decisions made
- ...
## Open questions
- ...
## Links
- Commits: ...
EOF
```
