#!/usr/bin/env bash
# Start all services (edge cloud + CMP) with persistent logging.
# Logs are written to logs/edge-cloud.log and logs/cmp.log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Starting Axon Vision services ==="
bash "$SCRIPT_DIR/start-edge.sh"
bash "$SCRIPT_DIR/start-cmp.sh"
echo ""
echo "Services started. Logs:"
echo "  Edge cloud : $SCRIPT_DIR/logs/edge-cloud.log"
echo "  CMP        : $SCRIPT_DIR/logs/cmp.log"
echo ""
echo "To check status:"
echo "  tail -f $SCRIPT_DIR/logs/edge-cloud.log"
echo "  tail -f $SCRIPT_DIR/logs/cmp.log"
