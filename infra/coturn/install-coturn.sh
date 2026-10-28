#!/usr/bin/env bash
# Install and configure coturn for SkyTalk. Run as root on the VPS, idempotent.
# Usage: bash install-coturn.sh DOMAIN [EXTERNAL_IP]
# Expects turnserver.conf next to this script and SKYTALK_TURN_SECRET in /etc/skytalk/skytalk.env.
set -euo pipefail

DOMAIN="${1:?usage: install-coturn.sh DOMAIN [EXTERNAL_IP]}"
EXTERNAL_IP="${2:-$(curl -4fsS https://api.ipify.org)}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE=/etc/skytalk/skytalk.env
LE_DIR="/etc/letsencrypt/live/${DOMAIN}"
HOOK=/etc/letsencrypt/renewal-hooks/deploy/coturn-certs.sh

TURN_SECRET="$(sed -n 's/^SKYTALK_TURN_SECRET=//p' "$ENV_FILE" | tr -d '"'"'"'')"
if [[ -z "$TURN_SECRET" ]]; then
  echo "Error: SKYTALK_TURN_SECRET not found in $ENV_FILE" >&2
  exit 1
fi
[[ -d "$LE_DIR" ]] || { echo "Error: $LE_DIR not found" >&2; exit 1; }

echo "==> Installing coturn..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq coturn
# Older Debian/Ubuntu packages ship the daemon disabled
if [[ -f /etc/default/coturn ]]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
fi

echo "==> Installing cert deploy hook..."
mkdir -p "$(dirname "$HOOK")"
cat > "$HOOK" <<EOF
#!/bin/sh
# Copy the Let's Encrypt cert where coturn (user turnserver) can read it.
install -d -o turnserver -g turnserver -m 750 /etc/coturn/certs
install -o turnserver -g turnserver -m 644 ${LE_DIR}/fullchain.pem /etc/coturn/certs/fullchain.pem
install -o turnserver -g turnserver -m 600 ${LE_DIR}/privkey.pem /etc/coturn/certs/privkey.pem
systemctl restart coturn 2>/dev/null || true
EOF
chmod 755 "$HOOK"
"$HOOK"

echo "==> Writing /etc/turnserver.conf..."
sed -e "s|DOMAIN|${DOMAIN}|g" \
    -e "s|EXTERNAL_IP|${EXTERNAL_IP}|g" \
    -e "s|TURN_SECRET|${TURN_SECRET}|g" \
    "${SCRIPT_DIR}/turnserver.conf" > /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf
chmod 640 /etc/turnserver.conf

echo "==> Starting coturn..."
systemctl enable coturn >/dev/null
systemctl restart coturn
sleep 2
systemctl is-active coturn
ss -lntup | grep -E ':(3478|5349)\b' || { echo "Error: coturn is not listening" >&2; journalctl -u coturn -n 30 --no-pager; exit 1; }
echo "==> coturn OK (external-ip ${EXTERNAL_IP})"
