#!/usr/bin/env python3
"""
Nightly cleanup for edge-linux CMP.

Deletes EdgeReport records (and their image files) that are:
  - Older than RETENTION_DAYS (default 30)
  - NOT linked to any Incident

Run via cron:
  0 2 * * * /usr/bin/python3 /home/iris/Documents/development/edge-linux/scripts/cleanup.py >> /var/log/edge-cleanup.log 2>&1
"""

import os
import subprocess
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [cleanup] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S"
)
log = logging.getLogger(__name__)

REPO_ROOT   = Path(__file__).resolve().parent.parent
CMP_DIR     = REPO_ROOT / "CCTVCMP-linux"
IMAGE_DIR   = Path(os.getenv("IMAGE_STORAGE_PATH", str(REPO_ROOT / "data" / "images")))
RETENTION_DAYS = int(os.getenv("CLEANUP_RETENTION_DAYS", "30"))


def run_node(script: str) -> dict:
    """Run a Node.js snippet inside the CMP directory and return parsed JSON."""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=str(CMP_DIR),
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Node script failed: {result.stderr.strip()}")
    return json.loads(result.stdout.strip())


def main():
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    log.info(f"Cleanup start — removing non-incident reports before {cutoff.date()} ({RETENTION_DAYS}-day retention)")

    # ── Step 1: Find report IDs to delete ────────────────────────────────────
    find_script = f"""
const {{ PrismaClient }} = require('@prisma/client');
const p = new PrismaClient();
const cutoff = new Date('{cutoff.isoformat()}');
p.edgeReport.findMany({{
  where: {{
    receivedAt: {{ lt: cutoff }},
    incidents: {{ none: {{}} }},
  }},
  select: {{ id: true, eventImageMimeType: true }},
}}).then(rows => {{
  console.log(JSON.stringify(rows));
}}).finally(() => p.$disconnect());
"""
    rows = run_node(find_script)
    log.info(f"Found {len(rows)} non-incident reports older than {RETENTION_DAYS} days")

    if not rows:
        log.info("Nothing to clean up.")
        return

    ids = [r["id"] for r in rows]

    # ── Step 2: Delete image files from disk ─────────────────────────────────
    deleted_files = 0
    for r in rows:
        mime = r.get("eventImageMimeType") or "image/jpeg"
        ext  = "png" if mime == "image/png" else "jpg"
        path = IMAGE_DIR / f"{r['id']}.{ext}"
        if path.exists():
            path.unlink()
            deleted_files += 1

    log.info(f"Deleted {deleted_files} image files from disk")

    # ── Step 3: Delete DB records in batches of 500 ──────────────────────────
    batch_size = 500
    total_deleted = 0
    for i in range(0, len(ids), batch_size):
        batch = ids[i:i + batch_size]
        ids_json = json.dumps(batch)
        delete_script = f"""
const {{ PrismaClient }} = require('@prisma/client');
const p = new PrismaClient();
p.edgeReport.deleteMany({{
  where: {{ id: {{ in: {ids_json} }} }}
}}).then(r => {{
  console.log(JSON.stringify({{ count: r.count }}));
}}).finally(() => p.$disconnect());
"""
        result = run_node(delete_script)
        total_deleted += result.get("count", 0)
        log.info(f"  Batch {i // batch_size + 1}: deleted {result.get('count', 0)} records")

    log.info(f"Cleanup complete — removed {total_deleted} DB records, {deleted_files} image files")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log.error(f"Cleanup failed: {e}")
        sys.exit(1)
