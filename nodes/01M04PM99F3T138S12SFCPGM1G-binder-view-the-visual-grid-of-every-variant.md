---
id: 01M04PM99F3T138S12SFCPGM1G
type: feature
title: Binder view — the visual grid of every variant
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
---
## What to build

The binder — the app's primary surface. A visual grid of every variant where the collection
and its holes are readable at a glance.

Served as **one cacheable document** containing every variant plus ownership state. Not
paginated: this single request is what makes offline browsing and client-side filtering
possible later.

Tapping a card opens a **bottom sheet**, not a new page — the binder stays as context.

Default order is set release date descending, then card number. **No aggregate density map
above the grid.** Style is dense, precise and typographic.

## Acceptance criteria

- [ ] One request returns the whole binder document; it is cacheable and unpaginated
- [ ] Grid is virtualised and scrolls smoothly over ~765 cells on the phone
- [ ] Card images served from BLOBs, cached `CacheFirst` by the service worker
- [ ] Owned and needed are distinguishable at a glance without reading text
- [ ] Tapping a card opens a bottom sheet showing the corpus image and the variant's axes
- [ ] The sheet does not navigate away; dismissing it returns to the same scroll position
- [ ] No aggregate summary rendered above the grid
- [ ] **Demo: browse the entire masterset on the phone**
