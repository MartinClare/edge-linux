#!/usr/bin/env bash
# Start the edge cloud analyzer (port 3001) with persistent logging.
# Log file: logs/edge-cloud.log  (appended on each start)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/edge-cloud.log"
PID_FILE="$SCRIPT_DIR/logs/edge-cloud.pid"

# Kill any existing instance
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[edge] Stopping existing process (pid=$OLD_PID)"
    kill "$OLD_PID"
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

echo "" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

cd "$SCRIPT_DIR/cloud"
nohup node dist/index.js >> "$LOG_FILE" 2>&1 &
EDGE_PID=$!
echo "$EDGE_PID" > "$PID_FILE"
echo "[edge] Started (pid=$EDGE_PID) — logs: $LOG_FILE"
