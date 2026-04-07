#!/usr/bin/env bash
# Start (or restart) the CMP Next.js server via systemd user service.
systemctl --user restart cmp.service
echo "[cmp] $(systemctl --user is-active cmp.service) — logs: journalctl --user -u cmp -f"
