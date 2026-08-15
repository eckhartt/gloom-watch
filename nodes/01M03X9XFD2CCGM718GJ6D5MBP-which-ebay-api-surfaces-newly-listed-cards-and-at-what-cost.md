---
id: 01M03X9XFD2CCGM718GJ6D5MBP
type: decision
title: Which eBay API surfaces newly-listed cards, and at what cost?
status: deciding
parent: 01M03X4D6HQESBXXDYYRVBVRDR
edges:
  - to: 01M03XA9GZ6ZRV3CBTF2F460EN
    type: blocks
  - to: 01M03XAA33X9BVPKF8BP747MZV
    type: blocks
meta:
  ticket: research
  hitl: no
  claimed: wayfinder-charting
---
## The question

Which eBay API can tell us about newly-listed Oddish-line cards, and what are
its real constraints?

The product loop is "a new listing appeared, tell my phone". That is only as
good as eBay's ability to answer "what is new since I last asked".

## What to find out

- **Which API.** The Finding API is long deprecated. Establish what the current
  supported path is for keyword search over active listings — Browse API, or
  something newer — and whether it is available to a personal developer account.
- **New-listing discovery.** Can results be sorted or filtered by listing start
  time? Is there a "since" parameter, or must we poll a sorted feed and diff
  against what we have already seen? This determines whether the scanner is a
  cursor or a differ.
- **Auth model.** Application-level OAuth token vs user token. Token lifetime,
  refresh flow, and whether an unattended server on a home network can hold
  credentials without a browser round-trip every few hours.
- **Rate limits and quotas.** Calls per day on the free tier, what happens at
  the ceiling, and what polling interval that implies. Note whether the quota is
  per-API or shared.
- **Query surface.** Can we express "Pokémon card, name contains Gloom" well
  enough to be useful, or do we get a flood of Gloom-the-word noise? What
  structured fields come back — category, item aspects, condition, seller,
  price, currency, listing type (auction vs BIN), end time?
- **Item aspects.** Does eBay return structured card metadata (set, card number,
  grade, language) for cards, or is the title the only signal? This directly
  sets the difficulty of the listing-to-card matching problem.
- **Sold comps.** Whether historical sold prices are reachable at all
  (Marketplace Insights API and its access restrictions) — recorded for the
  record even though price benchmarking is out of scope for v1.
- **Terms of use.** What eBay's developer agreement says about polling
  frequency, storing listing data locally, and personal non-commercial use.

## What resolving this looks like

A named API with a concrete polling design sketch: endpoint, auth, interval that
fits the quota, and how "new since last scan" is determined. State the noise
problem honestly — if a keyword search returns mostly junk, say so, because the
matching ticket has to absorb it.

Park the detail on a `research` node parented to this ticket.
