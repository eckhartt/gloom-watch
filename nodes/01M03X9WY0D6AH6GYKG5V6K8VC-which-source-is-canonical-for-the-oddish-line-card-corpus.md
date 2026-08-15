---
id: 01M03X9WY0D6AH6GYKG5V6K8VC
type: decision
title: Which source is canonical for the Oddish-line card corpus?
status: proposed
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA78KZN54BHSM6G9ZBPTV
    type: blocks
  - to: 01M03XA9GZ6ZRV3CBTF2F460EN
    type: blocks
  - to: 01M03XAAMK96EN2TFBHEYGABXQ
    type: blocks
meta:
  ticket: research
  hitl: no
---
## The question

Which data source supplies the canonical card corpus for the Oddish line, and
what does it actually give us?

Every other decision on this map is downstream of this one. The variant
granularity we can model is bounded by the granularity the source publishes; the
matching strategy depends on what identifiers exist; the ingest strategy depends
on whether the source is a bulk download or a rate-limited API.

## What to find out

Survey at minimum **Scrydex**, **TCGdex**, the **Pokémon TCG API**
(pokemontcg.io), and whatever **PokeWallet** turns out to be built on. Look for
others if these fall short.

For each, answer concretely:

- **Coverage.** Does it have every set an Oddish-line card appeared in, back to
  Base Set and the WOTC era, including promos, and including sets that were
  never printed in English?
- **Languages.** Which languages are represented, and are they modelled as
  separate card records, as translations attached to one record, or not at all?
  Japanese coverage specifically — it is where most of this masterset lives.
- **Variant granularity.** Does it distinguish 1st Edition from Shadowless from
  Unlimited? Holo from reverse holo from non-holo? If it does not, what would we
  have to synthesize ourselves?
- **Identifiers.** What stable IDs exist per card and per variant, and do they
  survive the source re-issuing its data?
- **Images.** Resolution available, hotlink terms, whether bulk download is
  permitted, and roughly how large the Oddish-line image set would be on disk.
- **Access and cost.** Free vs paid, tiers, auth, rate limits, and whether a
  bulk/full dump exists or everything must come through paginated queries.
- **Licensing.** What the terms actually permit for a self-hosted personal
  tracker that stores a local copy. Quote the relevant clause.
- **Freshness.** How quickly new sets appear after release, and whether there is
  a changelog or updated-since query to sync against.

## What resolving this looks like

A recommendation naming one source as canonical, with a second named as the
fallback or supplement if no single source covers the masterset. State plainly
what the chosen source **cannot** do, because those gaps become work elsewhere
on this map.

Park the full survey on a `research` node parented to this ticket. Put only the
recommendation and the gaps in this body.
