#!/usr/bin/env bash
# Start the CMP Next.js server (port 3002) with persistent logging.
# Log file: logs/cmp.log  (appended on each start)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/cmp.log"
PID_FILE="$SCRIPT_DIR/logs/cmp.pid"

# Kill any existing instance
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[cmp] Stopping existing process (pid=$OLD_PID)"
    kill "$OLD_PID"
    sleep 2
  fi
  rm -f "$PID_FILE"
fi

# Also release the port in case the pid file is stale
fuser -k 3002/tcp 2>/dev/null || true
sleep 1

echo "" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

cd "$SCRIPT_DIR/CCTVCMP-linux"
nohup npm start >> "$LOG_FILE" 2>&1 &
CMP_PID=$!
echo "$CMP_PID" > "$PID_FILE"
echo "[cmp] Started (pid=$CMP_PID) — logs: $LOG_FILE"
