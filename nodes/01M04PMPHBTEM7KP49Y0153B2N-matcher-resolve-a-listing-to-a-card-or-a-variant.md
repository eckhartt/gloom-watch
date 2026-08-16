---
id: 01M04PMPHBTEM7KP49Y0153B2N
type: feature
title: Matcher — resolve a listing to a card or a variant
status: todo
parent: 01M04PFVGGXDDF82HM2NY6J000
edges:
  - to: 01M04P3SX9KAV082W044TGV9GD
    type: implements
  - to: 01M04PMQ2J370TWBEH3SWF1KB9
    type: blocks
meta:
  ticket: build
---
## What to build

Turning a listing title into a card, or a variant, or an honest "I do not know".

The corpus is **small and closed** — every card name, set name and number is a known local
string — so this is a lookup problem, not a guessing one. No learned model of any kind:
eBay's terms bar training algorithms, machine learning, synthetic data sets and large
learning models on their content, and that is broader than fine-tuning.

**The matcher returns a resolution, not a variant.** Grain is explicit:

```
grain: 'variant' | 'card' | 'none'
variant set ONLY at variant grain; candidates carried at card grain
plus language, confidence, lot flag and names, filter verdict and reason, parsed grade
```

**Card grain is the ordinary case.** `Gloom Jungle 44/64` names a card and leaves four
variants live. Resolving to the card and recording candidates is honest; guessing a variant
is the silent error the precision bias exists to prevent.

Language resolves title marker → listing location country → English default, and **a
defaulted language lowers confidence**, because it resolves to a different card.

## Acceptance criteria

- [ ] Returns the full resolution shape; variant is set only at variant grain
- [ ] `1st-edition` and `1st edition` in a title resolve identically
- [ ] A `variant_id` colliding across cards resolves to the correct card
- [ ] Language falls through marker → country → English, **and the default lowers confidence**
- [ ] Card-grain results carry their candidate set and **never write ownership state**
- [ ] Lots detected by multiple names or lot/bundle/bulk/collection keywords, flagged with no variant link
- [ ] Proxies and custom art filtered via the Altered/Custom Art aspect and title keywords, **logged with a reason, never silently dropped**
- [ ] Grade parsed onto the listing and playing **no part** in variant selection
- [ ] Confidence recorded with a matcher version on every resolution
- [ ] Pure and deterministic: same inputs, same output, no network, no clock
- [ ] Fixture suite covers English catalog, vintage free-form, kana and kanji, graded slabs, trainer-owned and mechanic variants
- [ ] **Demo: real listings in the feed show what they resolved to and at what grain**
