#!/usr/bin/env bash
set -euo pipefail

REPO="/home/iris/Documents/development/edge-linux"
SYSTEMD_DIR="/etc/systemd/system"

echo "[1/4] Building local artifacts..."
(cd "$REPO/cloud" && npm install && npm run build)
(cd "$REPO/ppe-ui" && npm install && npx react-scripts build)

echo "[2/4] Installing local service units..."
sudo install -m 644 "$REPO/deploy/edge-cloud-local.service" "$SYSTEMD_DIR/edge-cloud-local.service"
sudo install -m 644 "$REPO/deploy/edge-ui-local.service" "$SYSTEMD_DIR/edge-ui-local.service"
sudo install -m 644 "$REPO/deploy/edge-linux-local.target" "$SYSTEMD_DIR/edge-linux-local.target"

echo "[3/4] Installing sudoers rule for VPN/Tailscale management..."
sudo install -m 440 "$REPO/deploy/sudoers-edge-python-vpn" /etc/sudoers.d/edge-python-vpn
sudo visudo -cf /etc/sudoers.d/edge-python-vpn

echo "[4/4] Reloading systemd and enabling services..."
sudo systemctl daemon-reload
sudo systemctl enable edge-cloud-local edge-ui-local edge-linux-local.target

# Stop the old Python service if it exists
sudo systemctl disable edge-python-local 2>/dev/null || true
sudo systemctl stop edge-python-local 2>/dev/null || true

sudo systemctl restart edge-cloud-local edge-ui-local
sudo systemctl start edge-linux-local.target

echo ""
echo "Done. Check status with:"
echo "  systemctl status edge-cloud-local --no-pager"
echo "  systemctl status edge-ui-local --no-pager"
echo "  systemctl status edge-linux-local.target --no-pager"
