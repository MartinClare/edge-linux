#!/usr/bin/env bash
# Start (or restart) all Axon Vision services.
systemctl --user restart edge-cloud.service cmp.service
echo "=== Service Status ==="
systemctl --user status edge-cloud.service cmp.service --no-pager -l
echo ""
echo "Live logs:"
echo "  journalctl --user -u edge-cloud -f"
echo "  journalctl --user -u cmp -f"
