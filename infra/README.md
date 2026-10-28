# SkyTalk — Infrastructure Setup

Replace every occurrence of `DOMAIN` with your actual subdomain (e.g. `skytalk.example.com`) and `TURN_SECRET` / other secrets with real values before running any of these steps.

---

## Port map

| Port | Protocol | Service |
|------|----------|---------|
| 80 | TCP | nginx (HTTP → HTTPS redirect + certbot ACME) |
| 443 | TCP | nginx (HTTPS, WSS) |
| 3001 | TCP (internal) | Fastify backend |
| 9000 | TCP (internal) | PeerJS signaling server |
| 3478 | TCP + UDP | coturn STUN/TURN |
| 5349 | TCP + UDP | coturn STUN/TURN over TLS |
| 49152–65535 | UDP | coturn relay media |

---

## First-time setup

### 1. System packages

```bash
apt update
apt install -y nginx coturn certbot python3-certbot-nginx
```

### 2. Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

Verify Node version: `node --version` (must be 22+).
If the path differs from `/usr/bin/node`, update `systemd/skytalk-server.service` `ExecStart` accordingly.

Install pnpm:

```bash
npm install -g pnpm
```

### 3. System user and directories

```bash
useradd --system --no-create-home --shell /usr/sbin/nologin skytalk
mkdir -p /opt/skytalk/server /opt/skytalk/peerserver
mkdir -p /var/www/skytalk
mkdir -p /var/lib/skytalk
mkdir -p /var/log/skytalk
mkdir -p /var/log/turnserver
mkdir -p /var/run/turnserver
chown -R skytalk:skytalk /opt/skytalk /var/www/skytalk /var/lib/skytalk /var/log/skytalk
chown -R turnserver:turnserver /var/log/turnserver /var/run/turnserver
```

### 4. PeerJS signaling server

```bash
mkdir -p /opt/skytalk/peerserver
cd /opt/skytalk/peerserver
npm install peer
chown -R skytalk:skytalk /opt/skytalk/peerserver
```

### 5. Environment file

Create `/etc/skytalk/skytalk.env` (mode 640, owner root:skytalk):

```bash
mkdir -p /etc/skytalk
cat > /etc/skytalk/skytalk.env <<'EOF'
NODE_ENV=production
PORT=3001
DB_PATH=/var/lib/skytalk/skytalk.db
SKYTALK_TUTOR_PASSWORD=<strong-password>
SKYTALK_JWT_SECRET=<32-byte-hex>
SKYTALK_TURN_SECRET=<same-value-as-turnserver.conf-static-auth-secret>
EOF
chmod 640 /etc/skytalk/skytalk.env
chown root:skytalk /etc/skytalk/skytalk.env
```

Generate secrets:

```bash
openssl rand -hex 32   # use output for SKYTALK_JWT_SECRET
openssl rand -hex 32   # use output for SKYTALK_TURN_SECRET (also put in turnserver.conf)
```

### 6. nginx

```bash
cp infra/nginx/skytalk.conf /etc/nginx/sites-available/skytalk
# Edit the file: replace DOMAIN with your actual subdomain
ln -s /etc/nginx/sites-available/skytalk /etc/nginx/sites-enabled/skytalk
nginx -t
systemctl reload nginx
```

### 7. TLS certificate (Let's Encrypt)

```bash
certbot --nginx -d skytalk.DOMAIN
```

certbot will edit the nginx config to fill in the certificate paths. Reload nginx after:

```bash
systemctl reload nginx
```

### 8. coturn

Requires the Let's Encrypt cert (step with certbot) and `/etc/skytalk/skytalk.env` with `SKYTALK_TURN_SECRET`.
From your local machine (repo root):

```bash
scp infra/coturn/turnserver.conf infra/coturn/install-coturn.sh root@your-vps-ip:/root/coturn/
ssh root@your-vps-ip "bash /root/coturn/install-coturn.sh skytalk.website"
```

The script installs coturn, fills in the domain, public IP and TURN secret, and adds a certbot
deploy hook that copies the cert to `/etc/coturn/certs/` (coturn runs as `turnserver` and
cannot read `/etc/letsencrypt/live`). Re-running it is safe.

Verify coturn is listening:

```bash
ss -tulpn | grep 3478
```

### 9. systemd units

```bash
cp infra/systemd/skytalk-server.service    /etc/systemd/system/
cp infra/systemd/skytalk-peerserver.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now skytalk-server skytalk-peerserver
```

### 10. Initial deploy

Run from your local machine (repo root):

```bash
# Set your VPS user@host
export SKYTALK_DEPLOY_HOST=root@your-vps-ip
./infra/deploy.sh
```

### 11. Health check

```bash
curl https://skytalk.DOMAIN/api/health
# Expected: {"status":"ok","uptime_seconds":N}
```

---

## Ongoing deploys

```bash
./infra/deploy.sh [--web-only] [--deps-installed] [user@host]
```

Run from Git Bash on Windows or any Unix shell. One SSH session, so a password is asked once.

1. Builds the **committed** `HEAD` in a temporary git worktree — uncommitted changes never ship.
2. Packs server dist, web dist and `infra/remote-deploy.sh` into an archive and pipes it into `ssh`.
3. On the VPS, `remote-deploy.sh`:
   - backs up the current web and server builds to `/opt/skytalk/backup-<timestamp>` (keeps the newest 5);
   - copies the web build over `/var/www/skytalk` (old hashed assets stay, so open tabs keep working);
   - replaces `/opt/skytalk/server/dist`, restarts `skytalk-server` and checks `/api/health` —
     if the server doesn't come up, the previous server build is restored automatically;
   - writes the deployed commit to `/opt/skytalk/DEPLOYED_COMMIT`.

Options:

- `--web-only` — frontend only (landing, flashcards, UI); the server is not restarted, lessons are not interrupted.
- `--deps-installed` — server npm dependencies changed. `node_modules` are not shipped (pnpm's are
  platform-specific), so the deploy refuses to continue when `dependencies` in
  `packages/server/package.json` differ from the last deploy. Install them in
  `/opt/skytalk/server/node_modules` on the VPS first, then re-run with this flag.

Set `SKYTALK_DEPLOY_URL=https://skytalk.website` to also check health from outside after the deploy.

Rollback by hand: the script prints the exact `cp` commands for the backup it just made.

The PeerJS process is not restarted (it has no deployable code — restart manually only if the `peer` package version changes). nginx and coturn configs are not deployed by this script.

---

## Operations

### Service status

```bash
systemctl status skytalk-server
systemctl status skytalk-peerserver
systemctl status coturn
systemctl status nginx
```

### Live logs

```bash
journalctl -u skytalk-server -f
journalctl -u skytalk-peerserver -f
```

### coturn logs

```bash
tail -f /var/log/turnserver/turnserver.log
```

### SQLite location

```
/var/lib/skytalk/skytalk.db
```

### TURN relay usage

Search the coturn log for `relay` to see how often media is flowing through TURN (as opposed to direct P2P). High relay usage may indicate NAT traversal issues worth investigating.

### Certificate renewal

certbot renews automatically via its own systemd timer. To test renewal:

```bash
certbot renew --dry-run
```

If coturn uses the same certificate, add a deploy hook to restart coturn after renewal:

```bash
echo "systemctl restart coturn" > /etc/letsencrypt/renewal-hooks/deploy/restart-coturn.sh
chmod +x /etc/letsencrypt/renewal-hooks/deploy/restart-coturn.sh
```

---

## Monitoring and backups

### Metrics

A systemd timer writes a one-minute snapshot (`vmstat`, `free`, `ss -s`) to `/var/log/skytalk/metrics.log`.

```bash
# Install script and units
cp infra/skytalk-metrics.sh /opt/skytalk/skytalk-metrics.sh
chmod +x /opt/skytalk/skytalk-metrics.sh
cp infra/systemd/skytalk-metrics.service /etc/systemd/system/
cp infra/systemd/skytalk-metrics.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now skytalk-metrics.timer
```

Verify: `systemctl status skytalk-metrics.timer`

Logs rotate weekly, 8 weeks retained:

```bash
cp infra/logrotate/skytalk /etc/logrotate.d/skytalk
# Test: logrotate -d /etc/logrotate.d/skytalk
```

### Backups

A systemd timer runs daily at 02:00, archiving `/var/lib/skytalk/` to `/var/backups/skytalk-YYYY-MM-DD.tgz`. Archives older than 14 days are pruned automatically.

```bash
# Install script and units
cp infra/skytalk-backup.sh /opt/skytalk/skytalk-backup.sh
chmod +x /opt/skytalk/skytalk-backup.sh
cp infra/systemd/skytalk-backup.service /etc/systemd/system/
cp infra/systemd/skytalk-backup.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now skytalk-backup.timer
```

Run a manual backup to verify: `systemctl start skytalk-backup.service`

Check result: `journalctl -u skytalk-backup` and `ls -lh /var/backups/skytalk-*.tgz`

Weekly rsync to external storage (Hetzner Storage Box, Backblaze B2, etc.) is a future step — not scripted for MVP.

### UptimeRobot

Create a free monitor at [uptimerobot.com](https://uptimerobot.com):

| Field | Value |
|-------|-------|
| Monitor type | HTTP(S) |
| Friendly name | SkyTalk health |
| URL | `https://skytalk.DOMAIN/api/health` |
| Monitoring interval | 5 minutes |
| Alert contact | your email |

Expected response: HTTP 200, body contains `"status":"ok"`.

---

## Firewall (ufw)

```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 5349/udp
ufw allow 49152:65535/udp
ufw enable
```

Ports 3001 and 9000 must **not** be opened externally — they are nginx-proxied only.
