---
id: 01M051CQFJSQ420QWJSCF1XWD5
type: session
title: "session: Corpus ingest — pull the masterset from TCGdex"
status: closed
parent: 01M04PM8Q4KPP697RV6CBK7XQQ
---
## What changed

**Two tickets closed, both commissioned on real hardware.**

- **Corpus ingest (`01m04pm8q4`)** — 12/12. The masterset is in the live database: 497 cards,
  817 variants, 11 languages, 382 images (26.32 MiB). Re-synced from the iPhone Home Screen app,
  fetching zero image bytes.
- **Push transport (`01m04pmr5q`)** — 10/10. A test push reached the owner's iPhone and the tap
  opened the app at the tailnet origin.

`main` is at `bf24a43`. **196 tests across 17 files.** The box runs 3 migrations, a 42 MB
database, and `/etc/gloom-watch/gloom-watch.env` at `root:gloom 0640`.

## Decisions made

**The outbound-only claim is now fact, not inference.** Commissioning checklist step 8 was run:
Tailscale off on the phone, push sent, banner arrived. The spec carried this as *"well-reasoned
inference from protocol behaviour, not a confirmed fact"* and noted that unlike every other open
question, getting it wrong would change the design. Tailnet-only hosting stands — no port
forward, no public endpoint, and the authentication question stays closed.

**The iPhone reports `declarative` transport**, so it is exempt from the three-strike silent-push
penalty. The classic handler is the fallback, not the live path. This also settles the transport
probe, which had never run on a real iOS 18.4+ device.

**The environment file is `root:gloom 0640`, departing from the spec's `root:root 0600`.** The
spec asks for two things that cannot both hold — root-only file, and scheduled jobs loading it
explicitly because cron does not inherit systemd's `EnvironmentFile`. Those jobs run as `gloom`.
`0640` is the smallest change satisfying both; systemd still reads it as root before dropping
privileges, so the only new reader is the same account running the same application.

**Passwordless sudo was granted for `nicholas` on `htpc`** (`/etc/sudoers.d/nicholas-nopasswd`)
so deployment could be driven live rather than through blind scripts. The account was already in
the `docker` group, which is root-equivalent, so this removed a prompt rather than granting a
capability. Reverse with `sudo rm /etc/sudoers.d/nicholas-nopasswd`.

## Two bugs commissioning found

**The environment file was loaded one layer too deep.** Running the push sender with a
cron-shaped environment (`env -i`) refused: `GLOOM_WATCH_ORIGIN` was absent, so the tap target
resolved to loopback. The loader was correct and general but called only from `loadVapidConfig`,
which runs *after* configuration is read — so a scheduled job got its VAPID secrets and nothing
else, and the secrets were the half everyone was watching. Fixed in `f42d66d`:
`loadDeploymentConfig` wraps the pure `loadConfig` for processes systemd did not start.

**The sync summary reported a delta among totals.** `0 image(s)` after a no-op re-sync was read
as the corpus having lost its images. Fixed in `bf24a43` to `382 image(s) — none newly fetched`,
with five tests. Found by the owner reading the screen, not by a test.

## Open questions

**The eBay developer account is under manual review, and it is now the only thing gating half
the build.** `eBay client and forward scanner` (`01m04pmc04`) is takeable but cannot finish
without a production keyset, and the keyset needs the owner to **opt out** of marketplace
account-deletion notifications — subscribing would require a publicly reachable HTTPS endpoint
and kill tailnet-only hosting.

**Binder view (`01m04pm99f`) is the next slice and needs set release dates, which are not
stored.** The card payload's `set` object carries no date; obtaining it means a per-set fetch
across roughly 46 sets × 11 languages. Whoever takes it decides whether to extend the corpus
pipeline or fetch separately.

**The box is at 98% disk**, 11 GB free, 307 GB of it unrelated media under an *arr stack. Not
blocking — the database is 42 MB — but `VACUUM INTO` needs room for a full second copy, so it
wants resolving before the backup ticket.

**The VAPID private key now exists in two places**: `/etc/gloom-watch/gloom-watch.env` on the box
and `.env` in the `gloom-watch-push` worktree. Removing that worktree is safe now. Rotating the
key is no longer free — a subscription exists, and rotation returns `400 VapidPkHashMismatch`
and invalidates it.

**`unknownAxisValues` has never fired against real data**, and `variantCountDropped` has never
been true. Both are the only warnings their respective failure modes will give.

## Links

- Repository: https://github.com/eckhartt/gloom-watch — `main` at `bf24a43`
- Origin: https://htpc.tail594f35.ts.net — 817 variants live
- Frontier: `01m04pm99f` Binder view, `01m04pmc04` eBay client and forward scanner
