---
id: 01M04JEA06JPZZG3KD4GEPDDY3
type: decision
title: missing_upstream variants leave the completion denominator unless owned
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
---
## Resolution

**A variant flagged `missing_upstream` is excluded from the completion denominator —
unless the owner holds a copy of it, in which case it counts in both the numerator and
the denominator.**

This fills a gap left by *How does the card corpus get in, stay current, and hold
images?* (`01m03xaamk`), which ruled that a variant vanishing upstream is flagged and
kept, never deleted, but never said what that does to completion.

## Why

**Completion is the emotional core of a masterset tracker, and it must be reachable.**

If flagged-missing rows stayed in the denominator, a single upstream deletion — a
TCGdex correction, a retracted record, a data-entry fix — would **permanently cap
completion below 100% with no action the owner could take.** That is exactly the
"permanently incompletable" failure the TCG Pocket exclusion in `01m03xa78k` exists to
prevent, arriving by a different route.

**But a card the owner physically holds must never vanish from their total.** If it is
in the binder, it is in the collection, whatever upstream now says. Excluding an owned
row would make the collection larger than the masterset it belongs to — an absurdity,
and one the owner would notice as a number that went down after a sync.

The two clauses together give the only behaviour that is stable under upstream
mistakes in both directions.

## Behaviour

| Flagged `missing_upstream` | Owner holds a copy | In denominator | In numerator |
| --- | --- | --- | --- |
| no | no | yes | no |
| no | yes | yes | yes |
| **yes** | **no** | **no** | **no** |
| **yes** | **yes** | **yes** | **yes** |

Flagged rows remain **visible under a filter** in both cases, so nothing disappears from
the binder silently — only from the arithmetic.

## Consequences

- The denominator is **not** a constant. It moves when upstream removes a record and
  when the owner acquires a flagged card. Any cached or precomputed completion figure
  must be invalidated on corpus sync and on copy creation.
- **This interacts with the missing completion oracle.** Nothing currently verifies
  that the masterset contains what it should, so a membership regression that silently
  drops rows makes the denominator smaller and the percentage *higher*. That gap is
  recorded against the spec and is not resolved here.

## Alternatives weighed and rejected

- **Always counted** — treats upstream removals as suspect and keeps the target stable,
  which is honest to the domain: a card that was printed stays printed. Rejected
  because one bad upstream delete leaves the owner permanently at 99% with no recourse.
- **Always excluded** — simplest rule, no special case. Rejected because owning a copy
  of an excluded row makes the collection larger than its own masterset.
