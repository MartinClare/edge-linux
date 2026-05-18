#!/usr/bin/env python3
"""
Send images one-by-one to the edge cloud POST /api/analyze-image with different visionModel values.

Requires: pip install requests

Examples:

  # Compare three backends on two JPEGs (sequential requests)
  python python/tmp/compare_vision_models.py \\
    python/tmp/construction-site-crane.jpg python/tmp/random-test-image.jpg \\
    --models local_gemma4_e4b local_qwen2_5_vl_7b local_qwen3_vl_8b

  # All defaults: common local + openrouter models
  python python/tmp/compare_vision_models.py python/tmp/*.jpg

  # Single model override
  python python/tmp/compare_vision_models.py image.png --models local_gemma4_e4b

Environment:
  CLOUD_API_URL   Base URL for Node cloud (default http://127.0.0.1:3001)

Notes:
  - visionModel overrides app.config.json activeModel for each request.
  - Ensure FastAPI on 8001 is up for local_gemma4_e4b / Qwen / Gemma model ids.
  - local_gemma4_e4b uses embedded vLLM when FastAPI has LOCAL_VISION_BACKEND=vllm.
  - local_qwen3_vllm still needs the optional direct vLLM OpenAI server on 8002.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    print("pip install requests", file=sys.stderr)
    raise SystemExit(1)

DEFAULT_MODELS = [
    "local_gemma4_e4b",
    "local_qwen2_5_vl_7b",
    "local_qwen3_vl_8b",
    "local_gemma3n_e4b",
    "local_gemma3n_e2b",
    "openrouter",
]

MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def mime_for(path: Path) -> str:
    return MIME.get(path.suffix.lower(), "application/octet-stream")


def collect_paths(patterns: list[str]) -> list[Path]:
    out: list[Path] = []
    for p in patterns:
        path = Path(p).expanduser()
        if path.is_dir():
            for ext in (".jpg", ".jpeg", ".png", ".webp"):
                out.extend(sorted(path.glob(f"*{ext}")))
        elif "*" in p or "?" in p:
            parent = Path(p).parent or Path(".")
            out.extend(sorted(parent.glob(Path(p).name)))
        else:
            out.append(path)
    seen: set[str] = set()
    uniq: list[Path] = []
    for p in out:
        rp = str(p.resolve())
        if rp not in seen and p.is_file():
            seen.add(rp)
            uniq.append(p)
    return uniq


def analyze_one(
    base: str,
    image_path: Path,
    vision_model: str,
    language: str,
    timeout: float,
) -> tuple[dict[str, Any] | None, float, str | None]:
    url = base.rstrip("/") + "/api/analyze-image"
    mime = mime_for(image_path)
    if mime == "application/octet-stream":
        return None, 0.0, f"unsupported extension {image_path.suffix}"

    t0 = time.perf_counter()
    try:
        with image_path.open("rb") as f:
            files = {"image": (image_path.name, f, mime)}
            data = {"language": language, "visionModel": vision_model}
            r = requests.post(url, files=files, data=data, timeout=timeout)
    except requests.RequestException as e:
        return None, time.perf_counter() - t0, str(e)

    dt = time.perf_counter() - t0
    try:
        body = r.json()
    except json.JSONDecodeError:
        return None, dt, r.text[:500]

    if not body.get("success"):
        err = body.get("error") or body
        return None, dt, str(err)

    return body.get("data"), dt, None


def main() -> None:
    ap = argparse.ArgumentParser(description="Batch-test /api/analyze-image with multiple vision models")
    ap.add_argument(
        "images",
        nargs="+",
        help="Image files or directories (jpeg/png/webp)",
    )
    ap.add_argument(
        "--base-url",
        default=os.environ.get("CLOUD_API_URL", "http://127.0.0.1:3001"),
        help="Cloud API base URL",
    )
    ap.add_argument(
        "--models",
        nargs="+",
        default=DEFAULT_MODELS,
        help="Vision model ids per request (override activeModel)",
    )
    ap.add_argument("--language", default="en")
    ap.add_argument("--timeout", type=float, default=600.0)
    ap.add_argument("--json-out", type=Path, help="Write full results JSON to this file")
    ap.add_argument(
        "--images-first",
        action="store_true",
        help="Outer loop images then models (default: outer models, inner images)",
    )
    args = ap.parse_args()

    paths = collect_paths(args.images)
    if not paths:
        print("No image files found.", file=sys.stderr)
        raise SystemExit(2)

    rows: list[dict[str, Any]] = []

    def run_cell(img: Path, model: str) -> None:
        data, dt, err = analyze_one(args.base_url, img, model, args.language, args.timeout)
        row = {
            "image": str(img),
            "visionModel": model,
            "seconds": round(dt, 3),
            "error": err,
            "overallRiskLevel": (data or {}).get("overallRiskLevel"),
            "overallDescription": ((data or {}).get("overallDescription") or "")[:240],
        }
        rows.append(row)
        status = row["overallRiskLevel"] or ("ERR" if err else "?")
        desc = (row["overallDescription"] or "").replace("\n", " ")
        print(f"[{status:4}] {model:22} {dt:7.2}s  {img.name}")
        if err:
            print(f"         error: {err[:200]}")
        elif desc:
            print(f"         {desc}...")

    if args.images_first:
        for img in paths:
            for model in args.models:
                run_cell(img, model)
    else:
        for model in args.models:
            print(f"\n--- model={model} ---")
            for img in paths:
                run_cell(img, model)

    if args.json_out:
        args.json_out.write_text(json.dumps(rows, indent=2), encoding="utf-8")
        print(f"\nWrote {args.json_out}")

    errs = sum(1 for r in rows if r["error"])
    print(f"\nDone: {len(rows)} requests, {errs} errors.")


if __name__ == "__main__":
    main()
