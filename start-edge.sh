#!/usr/bin/env bash
# Start (or restart) the edge cloud analyser via systemd user service.
systemctl --user restart edge-cloud.service
echo "[edge] $(systemctl --user is-active edge-cloud.service) — logs: journalctl --user -u edge-cloud -f"
