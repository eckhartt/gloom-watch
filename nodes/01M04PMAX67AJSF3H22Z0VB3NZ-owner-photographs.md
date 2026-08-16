---
id: 01M04PMAX67AJSF3H22Z0VB3NZ
type: feature
title: Owner photographs
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
meta:
  ticket: build
---
## What to build

Your own photographs of your own cards — for most pre-2021 Japanese variants, the only image
that will ever exist.

Photographs are **resized and recompressed server-side on receipt** to webp at roughly
1600px on the long edge. That is what makes storing them in the database viable, and it
**strips EXIF**, removing GPS coordinates from photographs taken at home.

Processing server-side is deliberate: it keeps multi-megabyte originals out of the client's
offline queue.

## Acceptance criteria

- [ ] Attach one or more photographs to a copy
- [ ] Resize and recompression happen server-side on receipt
- [ ] Stored as webp BLOBs at roughly 1600px long edge, around 200 KB each
- [ ] **EXIF is stripped — a test asserts no GPS data survives in the stored blob**
- [ ] Photographs appear on the variant sheet alongside the corpus image
- [ ] A photograph can be deleted
- [ ] **Demo: photograph a card with the phone and see it on its variant**
