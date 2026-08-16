# Deploying Gloom Watch

How to take this repository from a clone on the always-on Linux box to a Home Screen web app on
the iPhone.

Four things in the walking-skeleton ticket can only be done here and were **not** verified on
the development machine: Tailscale Serve, `systemd`, the OS-level `Bun.cron` registration, and
the Add-to-Home-Screen demo. Everything else — the server, the database, the migration, the
client build, the service worker and the tests — is verified and passing before you start.

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
sudo install -D -o root -g root -m 0600 /opt/gloom-watch/.env.example \
  /etc/gloom-watch/gloom-watch.env
sudo nano /etc/gloom-watch/gloom-watch.env
```

Set `GLOOM_WATCH_TIMEZONE` to the box's IANA timezone name. It is applied on **first boot
only**; afterwards the database is authoritative and the variable is ignored.

The remaining keys belong to later tickets and may stay empty. The file is root-owned and mode
0600 — systemd reads it as root before dropping to the `gloom` account, so the service user
never needs to read it.

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
with `systemctl show gloom-watch -p Restart -p RestartSec`, then `sudo systemctl kill -s KILL
gloom-watch` and watch it come back.

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

Wait ten minutes, then check that `lastHeartbeatAt` has stopped being `null`:

```sh
curl -s http://127.0.0.1:3000/api/health
```

**Verifies:** *A `Bun.cron` OS-level job is registered and survives a reboot, proving the
three-argument form works on this box.* Reboot and confirm the crontab entry is still there and
the heartbeat resumes.

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

**Verifies:** *Tailscale Serve fronts the app with a valid certificate.*

Known risk: Tailscale issue 19147 reports an iPhone failing to establish a secure connection to
a Serve HTTPS endpoint. One report, not general breakage. **Load the site on the iPhone over
HTTPS once before the first Add to Home Screen** — if it bites, switch ingress and reinstall the
PWA rather than discovering it after the icon is placed.

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
