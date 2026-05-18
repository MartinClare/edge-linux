#!/usr/bin/env python3
"""
Rough throughput check for local vLLM vs Transformers vision backends.

Requires: requests, PIL (optional for dummy jpeg)

Usage:
  export VLLM_URL=http://127.0.0.1:8002
  export VLLM_MODEL=Qwen3-VL-8B-Instruct
  python python/tmp/benchmark_vllm_throughput.py

  # Compare FastAPI server (OpenAI-shaped payload won\'t apply — use vLLM URL only)
"""

from __future__ import annotations

import argparse
import base64
import io
import os
import time
import concurrent.futures
from typing import Any

try:
    import requests
except ImportError:
    raise SystemExit("pip install requests")

try:
    from PIL import Image
except ImportError:
    raise SystemExit("pip install pillow  # needed to build a test JPEG")


def _minimal_jpeg_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (256, 256), color=(80, 120, 60)).save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def chat_completion(url: str, model: str, prompt: str, b64: str, mime: str = "image/jpeg") -> tuple[int, float]:
    payload: dict[str, Any] = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 128,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            }
        ],
    }
    t0 = time.perf_counter()
    r = requests.post(f"{url.rstrip('/')}/v1/chat/completions", json=payload, timeout=600)
    dt = time.perf_counter() - t0
    return r.status_code, dt


def main() -> None:
    ap = argparse.ArgumentParser(description="vLLM throughput probe")
    ap.add_argument("--url", default=os.environ.get("VLLM_URL", "http://127.0.0.1:8002"))
    ap.add_argument("--model", default=os.environ.get("VLLM_MODEL", "Qwen3-VL-8B-Instruct"))
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--rounds", type=int, default=2)
    args = ap.parse_args()

    jpeg = _minimal_jpeg_bytes()
    b64 = base64.b64encode(jpeg).decode("ascii")
    prompt = 'Reply with JSON only: {"overallDescription":"ok","overallRiskLevel":"Low"}'

    # Startup / first request
    print(f"URL={args.url} model={args.model}")
    code, dt = chat_completion(args.url, args.model, prompt, b64)
    print(f"first_request status={code} seconds={dt:.2f}")
    if code != 200:
        raise SystemExit("non-200 from vLLM; fix URL/model or server logs")

    # Warm single
    code, dt = chat_completion(args.url, args.model, prompt, b64)
    print(f"warm_single status={code} seconds={dt:.2f}")

    # Concurrent
    for round_i in range(args.rounds):
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
            futs = [
                ex.submit(chat_completion, args.url, args.model, prompt, b64) for _ in range(args.workers)
            ]
            times = []
            for f in concurrent.futures.as_completed(futs):
                c, t = f.result()
                times.append(t)
                if c != 200:
                    print(f"error status={c}")
        print(
            f"concurrent_round={round_i + 1} workers={args.workers} "
            f"wall_max={max(times):.2f}s mean={sum(times)/len(times):.2f}s"
        )


if __name__ == "__main__":
    main()
