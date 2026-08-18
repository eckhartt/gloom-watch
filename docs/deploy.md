# Deploying Gloom Watch

How to take this repository from a clone on the always-on Linux box to a Home Screen web app on
the iPhone.

Four things in the walking-skeleton ticket can only be done here and were **not** verified on
the development machine: Tailscale Serve, `systemd`, the OS-level `Bun.cron` registration, and
the Add-to-Home-Screen demo. Everything else — the server, the database, the migration, the
client build, the service worker and the tests — is verified and passing before you start.

The same is true of push, more sharply. Encryption, VAPID signing, the payload shapes, the echo
log and the worker's handler shape are all proved by `bun run verify` on any machine. **What
cannot be proved anywhere but here is that a real iPhone displays the notification** — steps 10
and 11 below, and read the warning in step 10 before you touch the phone.

## Before you begin

- A Linux box that is always on, joined to your tailnet. Not a Mac: a sleeping machine misses
  scan windows silently.
- `sudo`.
- The iPhone on the same tailnet.

## 1. Install the pinned runtime

Bun is pinned to **1.3.14 exactly**. `bun install` runs a `preinstall` check that fails if the
running Bun is any other version, so install it system-wide — the systemd unit sets
`ProtectHome=true` and cannot see a Bun under a home directory.

```sh
curl -fsSL https://bun.sh/install | SUDO=1 BUN_INSTALL=/usr/local bash -s "bun-v1.3.14"
/usr/local/bin/bun --version   # must print 1.3.14
```

## 2. Lay out the application

```sh
sudo useradd --system --home-dir /opt/gloom-watch --shell /usr/sbin/nologin gloom
sudo git clone <this repo> /opt/gloom-watch
sudo chown -R gloom:gloom /opt/gloom-watch
sudo -u gloom mkdir -p /opt/gloom-watch/data /opt/gloom-watch/backups
```

## 3. Install dependencies and build

`bun ci` is `bun install --frozen-lockfile`: it installs the exact versions in `bun.lock` and
fails if `package.json` has drifted.

```sh
cd /opt/gloom-watch
sudo -u gloom /usr/local/bin/bun ci
sudo -u gloom /usr/local/bin/bun run build
```

## 4. Write the environment file

```sh
sudo install -D -o root -g gloom -m 0640 /opt/gloom-watch/.env.example \
  /etc/gloom-watch/gloom-watch.env
sudo nano /etc/gloom-watch/gloom-watch.env
```

Set `GLOOM_WATCH_TIMEZONE` to the box's IANA timezone name. It is applied on **first boot
only**; afterwards the database is authoritative and the variable is ignored.

Set `GLOOM_WATCH_ORIGIN` to the **public** HTTPS origin including the scheme —
`https://cards.example`. A notification's tap target is built from it, by a process
that may have no HTTP request to read a `Host` header from. The phone lives on this
origin, not on the Tailscale Serve name.

Set `GLOOM_WATCH_SHARED_SECRET` to a long random string. The unlock form at `/unlock`
is the gate; `/api` is 401 without the cookie.

**The mode is `0640` with group `gloom`, not `0600` root-only.** systemd still reads it as root
before dropping privileges, so the service account gains nothing it did not have. But the
scheduled jobs are `Bun.cron` crontab entries running as `gloom` *outside* systemd, and they
inherit nothing from `EnvironmentFile` — so they have to open this file themselves. Root-only
0600 makes that impossible, and the way it fails is the dangerous one: `VAPID_PRIVATE_KEY`
simply absent, in production, in the one process that needed it. Group-read by the account that
already runs the application is the smallest change that lets both halves work.

If the file already exists at 0600 from an earlier commissioning:

```sh
sudo chgrp gloom /etc/gloom-watch/gloom-watch.env
sudo chmod 0640 /etc/gloom-watch/gloom-watch.env
sudo -u gloom head -c0 /etc/gloom-watch/gloom-watch.env && echo "gloom can read it"
```

The backup keys belong to a later ticket and may stay empty. The VAPID keys are next. eBay
credentials are required for the forward scanner — see step 7a.

## 4a. Generate the VAPID keypair — once, ever

```sh
cd /opt/gloom-watch
sudo -u gloom /usr/local/bin/bun run vapid:generate \
  --out /tmp/vapid.env --subject "mailto:you@example.org"
```

It prints the **public** key and writes both halves to `/tmp/vapid.env` at mode 0600. Copy all
three lines into `/etc/gloom-watch/gloom-watch.env`, then remove the temporary file:

```sh
sudo nano /etc/gloom-watch/gloom-watch.env   # paste VAPID_PUBLIC_KEY / _PRIVATE_KEY / _SUBJECT
sudo shred -u /tmp/vapid.env
sudo systemctl restart gloom-watch           # only if the service is already running
```

**Generate it once and do not rotate it.** Every `PushSubscription` the phone takes is created
against a specific application server key. Rotating means the next send comes back
`400 VapidPkHashMismatch`, every subscription for the origin is dead, and recovery costs a tap
on the device. The generator refuses to overwrite an existing keypair for that reason; `--force`
exists but the cost above is what it buys.

**The private key never leaves that file.** Not into a log, a ticket, a commit or a chat
message. `GET /api/push/config` serves the public half only.

**`VACUUM INTO` cannot capture this file** — it copies a SQLite database and the keys live
outside it. The backup job must archive `/etc/gloom-watch/gloom-watch.env` alongside the
snapshot, or a restore silently omits `VAPID_PRIVATE_KEY` and destroys every subscription.

## 5. Apply migrations

The server applies migrations at boot and so does the cron job, both idempotently. Run it once
by hand first so a failure is visible rather than buried in a restart loop.

```sh
cd /opt/gloom-watch
sudo -u gloom env $(grep -v '^#' /etc/gloom-watch/gloom-watch.env | xargs) \
  /usr/local/bin/bun run db:migrate
```

Migrations are only ever **generated**, never pushed. Never run `drizzle-kit push` against this
database.

## 6. Start the HTTP server under systemd

```sh
sudo cp /opt/gloom-watch/deploy/gloom-watch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gloom-watch
systemctl status gloom-watch
curl -s http://127.0.0.1:3000/api/health
```

`Restart=always` with `RestartSec=10` is in the unit and is required.

**Verifies:** *HTTP server runs under systemd with `Restart=always`, `RestartSec=10`.* Confirm
with `systemctl show gloom-watch -p Restart -p RestartUSec`, then `sudo systemctl kill -s KILL
gloom-watch` and watch it come back.

Note the property name: the unit declares `RestartSec=10`, but systemd normalises it and
reports it as `RestartUSec=10s`. Asking for `-p RestartSec` prints nothing at all, which reads
exactly like a missing directive and is not one.

## 7. Register the OS-level cron job

`Bun.cron(path, schedule, title)` writes a real crontab entry that runs the module in its own
process. It is not systemd's; it survives reboots on its own. Registration is idempotent —
re-registering a title overwrites it in place.

```sh
cd /opt/gloom-watch
sudo -u gloom /usr/local/bin/bun run cron:register
crontab -u gloom -l          # the entry should be listed
```

The job path registered is absolute, and the server resolves `data/`, `drizzle/` and
`dist/client` against the repository root rather than the working directory — so the cron
process and the systemd service open the same database whatever cron sets its cwd to. A cron
environment is minimal; do not rely on it carrying anything from the environment file.

This now registers two titles: `gloom-watch-heartbeat` and `gloom-watch-scan`. Both run every
ten minutes, each in its own process with its own SQLite connection. The scanner no-ops
quietly if `EBAY_CLIENT_ID` is unset, so registration is safe before the keyset exists.

Wait ten minutes, then check that `lastHeartbeatAt` has stopped being `null`:

```sh
curl -s http://127.0.0.1:3000/api/health
```

**Verifies:** *A `Bun.cron` OS-level job is registered and survives a reboot, proving the
three-argument form works on this box.* Reboot and confirm the crontab entry is still there and
the heartbeat resumes.

## 7a. eBay production keyset and the public callback

The scanner cannot finish a real cycle without a production application keyset. Sandbox
listings are not the live market.

The keyset is unlocked by **subscribing** to marketplace account-deletion notifications
(*The origin is a public hostname; we subscribe…*, `01m0a72t2k`). Opt-out is no longer the
path.

1. Point a public hostname at this box and terminate TLS. Reverse-proxy to
   `127.0.0.1:3000`. Set `GLOOM_WATCH_ORIGIN` to that origin and
   `GLOOM_WATCH_SHARED_SECRET` to a long random string.
2. Generate a 32–80 character verification token. Put it in
   `EBAY_NOTIFICATION_VERIFICATION_TOKEN`.
3. In the eBay developer portal, subscribe. The endpoint URL is
   `$GLOOM_WATCH_ORIGIN/api/ebay/marketplace-account-deletion` — **exactly**, no trailing
   slash, same scheme and host. Paste the same verification token.
4. eBay GETs that URL with `challenge_code`. The app answers
   `{ "challengeResponse": "<sha256 hex>" }`. When that succeeds the production keyset
   enables.
5. Set `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `RELIST_HASH_SALT` in the environment
   file. `RELIST_HASH_SALT` is any long random string; generate once and keep it.

The cron job reads this file itself — it does not inherit systemd's `EnvironmentFile`.

After the first successful cycle, `/feed` shows listings with a "seen at" stamp and an outbound
link. Prices older than six hours are omitted and the age is disclosed.

A deletion notification HMACs the username and drops matching listing rows. The username
is never stored. Re-add the Home Screen icon on the **new** origin; the tailnet one is
dead.

A settings screen that later edits `scan_interval_minutes` or `digest_times` must re-run this
registration, or the stored value and the running job disagree silently.

## 8. Front the app with Tailscale Serve

**Serve, never Funnel.** Funnel publishes the app to the public internet and reopens an
authentication question that was deliberately closed — the tailnet is the perimeter and there
is no login screen.

```sh
sudo tailscale serve --bg 3000
tailscale serve status
```

That issues a certificate for `<host>.<tailnet>.ts.net` and proxies HTTPS to `127.0.0.1:3000`.

The first time Serve is used on a tailnet it prints `Serve is not enabled on your tailnet` with
a `login.tailscale.com` link. Visit it once to turn the feature on for the tailnet; it is a
one-time account setting, not a per-machine one.

Serve's configuration persists across reboots on its own — it is stored state rather than a
running command, so nothing needs to re-establish it at boot.

**Verifies:** *Tailscale Serve fronts the app with a valid certificate.*

Known risk: Tailscale issue 19147 reports an iPhone failing to establish a secure connection to
a Serve HTTPS endpoint. One report, not general breakage. **Load the site on the iPhone over
HTTPS once before the first Add to Home Screen** — if it bites, switch ingress and reinstall the
PWA rather than discovering it after the icon is placed.

**It did not reproduce at commissioning on 2026-08-16**: an iPhone 15 Pro loaded
`https://htpc.tail594f35.ts.net/` over Serve and installed to the Home Screen without incident.
That is one box and one handset, so the check above is still worth running on any new origin —
but the risk is no longer merely accepted on paper.

## 9. Install on the phone

1. Open `https://<host>.<tailnet>.ts.net/` in Safari on the iPhone.
2. Share → **Add to Home Screen**, with **"Open as Web App" confirmed ON**. iOS 26 lets that be
   turned off, which produces a bookmark with no Push API.
3. Open the icon. The screen shows the timezone, the install time, the cron heartbeat and the
   migration count — every one of them read out of SQLite by the server.
4. Check **Service worker scope** reads `https://<host>.<tailnet>.ts.net/`. The scope must be
   `/` and must never move: push subscriptions key to the scope, not merely to the origin.

**Verifies:** *the site loads on the iPhone over HTTPS*, and *Demo: add to Home Screen, open,
and see a value that came from SQLite*.

## 10. Enable notifications on the phone

**Read this section before you touch the phone.** iOS enforces a three-strike silent-push
penalty: every push arms a 30-second timer, and if the service worker has not called
`showNotification()` before it expires, that is a strike. The counter **never decays and is never
credited by a success**, and the **third strike revokes every push subscription for the
origin** — not the one subscription, all of them, permanently, until the owner taps re-enable.
WebKit **suppresses enforcement whenever a Web Inspector is attached**, so you cannot watch it
happen while debugging; you find out afterwards. Treat the three strikes as a budget you are
spending, not as retries.

Two things reduce that risk to close to nothing and both are already built. Devices on iOS 18.4+
receive **Declarative Web Push**, which dispatches no `push` event to the worker at all and is
**exempt** from the penalty. Older devices get the classic handler, whose shape — `showNotification()`
unconditional, from the payload, inside `waitUntil()`, with no request to the origin anywhere in
the module — is asserted by `tests/sw/push-handler.test.ts` on every `bun run verify`.

1. Open the app from its Home Screen icon. Scroll to **Notifications**.
2. The row **Installed as web app** must read `yes` and **Push API** must read `present`. If
   either does not, the icon is a bookmark rather than a web app: remove it and re-add it with
   **Open as Web App** on. There is nothing to fix in software.
3. **Check the Transport row against the handset's iOS version. This is a stop condition, not
   an observation.**

   | iOS version | Transport must read | If it does not |
   | --- | --- | --- |
   | 18.4 or later | `declarative` | **Stop and report it.** |
   | 16.4 – 18.3 | `classic` | Expected; carry on. |

   Both transports deliver a notification, so a wrong reading here breaks nothing you can see —
   which is exactly the problem. `declarative` is the transport that is **exempt** from the
   three-strike penalty. A handset on 18.4+ reading `classic` is running every push through the
   30-second timer for no reason, and nothing will ever tell you.

   The client decides this by probing `"navigate" in Notification.prototype`. MDN records that
   property as Safari 18.4, mirrored on Safari iOS, and absent from Chrome and Firefox; WebKit
   shipped Declarative Web Push on iOS and iPadOS 18.4 — same version, same platforms. The probe
   was checked against desktop Chrome, which correctly reports `classic`. **It has never run on
   an iPhone.** This row is that check.
4. Read the soft-ask, then tap **Enable notifications**. iOS raises its own prompt at that point
   and it can only be answered once — a denial needs Settings → Notifications → Gloom Watch to
   undo.
5. The **Subscription** row fills in with an identifier. That means the server has it.

Confirm from the box:

```sh
sudo -u gloom sqlite3 /opt/gloom-watch/data/gloom-watch.db \
  "select id, transport, substr(endpoint,1,40) from push_subscriptions where retired_at is null;"
```

**Verifies:** *Soft-ask precedes the system prompt*, *standalone display mode and Push API both
checked at runtime*, *subscription records its transport*, and *permanent, gesture-gated
re-enable button*.

## 11. Send the test push

```sh
cd /opt/gloom-watch
sudo -u gloom /usr/local/bin/bun run push:test --dry-run   # look first
sudo -u gloom /usr/local/bin/bun run push:test
```

`--dry-run` prints the payload, its byte size and the endpoint host without sending. Use it
first: it costs nothing and it shows you the `navigate` target before a real push is spent on
discovering it points at loopback.

A real run prints `status=201 accepted=true`. **That means the push service accepted the
message, and nothing more.** Whether the phone displayed it is not observable from the server —
look at the handset.

The row it wrote:

```sh
sudo -u gloom sqlite3 -header /opt/gloom-watch/data/gloom-watch.db \
  "select sent_at, kind, transport, payload_bytes, ttl_seconds, status_code, error
   from push_echo_log order by sent_at desc limit 5;"
```

**Verifies:** *server-side echo log records every push, its size and the endpoint response*, and
the demo — *the phone buzzes and the tap opens the app*.

### Prove the cron path finds the private key

The scheduled jobs run outside systemd and inherit none of its `EnvironmentFile`. Run the sender
with the VAPID variables scrubbed out of the environment, which is what cron actually hands over:

```sh
cd /opt/gloom-watch
sudo -u gloom env -u VAPID_PUBLIC_KEY -u VAPID_PRIVATE_KEY -u VAPID_SUBJECT \
  PATH=/usr/local/bin:/usr/bin:/bin \
  GLOOM_WATCH_ORIGIN=https://<host>.<tailnet>.ts.net \
  /usr/local/bin/bun run push:test
```

If it sends, `server/env-file.ts` read `/etc/gloom-watch/gloom-watch.env` itself and the group
permission from step 4 is right. If it reports *permission denied*, the file is still 0600
root-only; go back and fix the mode.

**Verifies:** *a scheduled job that sends a push loads the environment file explicitly*.

### Prove push reaches the phone off-tailnet

Commissioning checklist step 8, and it is not optional — the outbound-only claim underpinning
the whole hosting decision is well-reasoned inference, **not a confirmed fact**.

1. Turn **Tailscale off** on the iPhone.
2. Send a push from the box.
3. The banner should still arrive: push delivery is box → Apple → phone and the app's origin is
   not involved.
4. Tapping it will *not* open the app while Tailscale is off — the tap target is tailnet-only.
   That is expected, and it is why the notification's text has to carry enough to decide on.
5. Turn Tailscale back on and confirm a tap opens the app.

## Updating

```sh
cd /opt/gloom-watch
sudo -u gloom git pull
sudo -u gloom /usr/local/bin/bun ci
sudo -u gloom /usr/local/bin/bun run build
sudo systemctl restart gloom-watch
```

`sw.js` is served with `Cache-Control: no-cache` and the worker ships `skipWaiting` and
`clientsClaim`, so the phone picks up new code on its next visit. Do not put a caching proxy in
front of the worker script: a cached worker pins the phone to old code permanently and nothing
server-side can recover it.

**Do not move the service worker's scope.** It is `/` and a push subscription keys to the scope,
not merely to the origin — relocating the worker orphans every subscription taken under the old
one, silently.

**Do not regenerate the VAPID keypair as part of an update.** See step 4a.
