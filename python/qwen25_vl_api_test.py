#!/usr/bin/env python3
"""Benchmark the persistent Qwen2.5-VL server."""

from __future__ import annotations

import argparse
import base64
import time
from pathlib import Path

import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Test persistent Qwen2.5-VL API.")
    parser.add_argument("--url", default="http://127.0.0.1:8002/generate")
    parser.add_argument("--image", required=True)
    parser.add_argument("--prompt", default="Analyze this construction site image for safety and PPE. Be concise but complete.")
    parser.add_argument("--max-tokens", type=int, default=160)
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=300)
    return parser.parse_args()


def encode_image(path: str) -> tuple[str, str]:
    image_path = Path(path).expanduser().resolve()
    suffix = image_path.suffix.lower()
    mime = "image/png" if suffix == ".png" else "image/jpeg"
    return base64.b64encode(image_path.read_bytes()).decode("ascii"), mime


def main() -> None:
    args = parse_args()
    image_b64, image_mime = encode_image(args.image)
    payload = {
        "prompt": args.prompt,
        "image_base64": image_b64,
        "image_mime": image_mime,
        "max_new_tokens": args.max_tokens,
    }

    print("=" * 60)
    print("Persistent Qwen2.5-VL API Test")
    print("=" * 60)
    print(f"URL: {args.url}")
    print(f"Image: {args.image}")
    print(f"Max output tokens: {args.max_tokens}")
    print("-" * 60)

    times: list[float] = []
    outputs: list[str] = []
    image_tokens = 0
    for idx in range(args.iterations):
        start = time.perf_counter()
        response = requests.post(args.url, json=payload, timeout=args.timeout)
        total_elapsed = time.perf_counter() - start
        response.raise_for_status()
        body = response.json()
        model_elapsed = float(body["elapsed_seconds"])
        times.append(model_elapsed)
        outputs.append(body["text"])
        image_tokens = int(body["image_tokens"])
        print(
            f"Run {idx + 1}/{args.iterations}: "
            f"model={model_elapsed:.2f}s total={total_elapsed:.2f}s"
        )

    avg = sum(times) / len(times)
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"Image tokens:          {image_tokens}")
    print(f"Average model latency: {avg:.2f}s")
    print(f"Min / max latency:     {min(times):.2f}s / {max(times):.2f}s")
    print(f"Estimated throughput:  ~{args.max_tokens / avg:.1f} tokens/sec")
    print("=" * 60)

    print("\nAnalysis output (last run):")
    print("-" * 40)
    print(outputs[-1])
    print("-" * 40)


if __name__ == "__main__":
    main()
