---
id: 01M03XA7TY3EEWANSAG7KZSS3Y
type: decision
title: What does the app record about a copy you own?
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XAA33X9BVPKF8BP747MZV
    type: blocks
meta:
  ticket: grilling
  hitl: yes
  claimed: interview-session
---
## The question

What does the app record about a copy the owner holds?

The cards table is the masterset. This is the other half: the owner's actual
collection, and the only data in the system that cannot be re-derived from an
external source if the database is lost.

## What to decide

- **Quantity vs rows.** Is "3 copies of Base Set Gloom" one row with a count, or
  three rows? Counts are simpler; rows are required the moment two copies differ
  in condition, grade or purchase price. Pick one and state what it costs.
- **Condition.** Which scale — the eBay/TCGplayer ladder (NM/LP/MP/HP/DMG), a
  numeric scale, or free text. Whether it is required or optional.
- **Grading.** Grader (PSA/BGS/CGC/SGC/ACE), numeric grade, subgrades,
  certification number. Whether a graded copy is a different *kind* of record or
  the same record with grading fields populated.
- **Acquisition.** Purchase price, currency, date, source/seller, and whether
  any of it is required. Note that multi-currency shows up immediately with
  Japanese cards.
- **Provenance and notes.** Free-text notes, and whether the owner wants their
  own photos of the actual copy stored alongside the source's stock image.
- **Wanted vs owned.** Is there a want-list, a priority flag, or is "not in the
  collection" sufficient? This feeds directly into what the notification policy
  can filter on.
- **History.** Whether a sold or traded-away copy is deleted or retained with a
  disposal date. Deleting is simpler; retaining is the only way to answer "did I
  used to have this".

## Why it matters

The have-it/need-it signal on eBay listings reads from this table, and the
notification policy may want to filter on it ("only tell me about cards I do not
own"). Both need to know exactly what "own" means here.

## How to resolve

Grill it out with the owner. Keep asking what they would actually type in when a
card arrives in the post — a field nobody fills in is a field that should not
exist.

Resolve into a field-by-field specification of the copies table, with each
field marked required or optional, and the quantity-vs-rows call stated with its
reasoning.
