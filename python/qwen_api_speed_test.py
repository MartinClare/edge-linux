#!/usr/bin/env python3
"""Fast speed benchmark using the already-running local vision server.

This uses the Qwen3-VL-32B model that's already loaded at http://127.0.0.1:8001.
Much faster than loading the 32B model from scratch.

Usage:
  python qwen_api_speed_test.py --iterations 10
"""

from __future__ import annotations

import argparse
import base64
import io
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image


API_URL = "http://127.0.0.1:8001/v1/vision/generate"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark Qwen via local vision API.")
    parser.add_argument("--role", default="inspector", help="API role: inspector, evaluator, or alert.")
    parser.add_argument("--prompt", default="Describe this scene in detail.", help="Test prompt.")
    parser.add_argument("--image", help="Optional image path.")
    parser.add_argument("--iterations", type=int, default=10, help="Number of test runs.")
    parser.add_argument("--max-tokens", type=int, default=64, help="Max tokens to generate.")
    parser.add_argument("--timeout", type=int, default=900, help="HTTP timeout in seconds.")
    parser.add_argument(
        "--model-id",
        default="qwen2-5-vl-7b",
        help=(
            "local_vision_server model_id: qwen2-5-vl-7b, qwen3-vl-8b, "
            "gemma-4-e4b, gemma-3n-e4b, gemma-3n-e2b"
        ),
    )
    return parser.parse_args()


def create_test_image() -> tuple[str, str]:
    """Create a simple test image and return as base64."""
    img = Image.new('RGB', (640, 480), color='blue')
    # Draw some shapes to make it interesting
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img)
    draw.rectangle([100, 100, 300, 300], fill='red', outline='white', width=3)
    draw.ellipse([400, 200, 550, 350], fill='green', outline='white', width=3)

    buffer = io.BytesIO()
    img.save(buffer, format='JPEG')
    img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    return img_base64, "image/jpeg"


def load_image(image_path: str) -> tuple[str, str]:
    """Load image from path and convert to base64."""
    img = Image.open(Path(image_path).expanduser().resolve())
    # Convert to RGB if necessary
    if img.mode != 'RGB':
        img = img.convert('RGB')
    # Resize if too large
    max_size = (1024, 1024)
    if img.width > max_size[0] or img.height > max_size[1]:
        img.thumbnail(max_size, Image.Resampling.LANCZOS)

    buffer = io.BytesIO()
    img.save(buffer, format='JPEG', quality=85)
    img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    return img_base64, "image/jpeg"


def run_inference(
    role: str,
    prompt: str,
    image_base64: str | None,
    image_mime: str,
    max_tokens: int,
    timeout: int,
    model_id: str,
) -> tuple[str, float]:
    """Call the vision API and return (text, elapsed_seconds)."""
    payload: dict = {
        "role": role,
        "prompt": prompt,
        "max_new_tokens": max_tokens,
        "model_id": model_id,
    }
    if image_base64:
        payload["image_mime"] = image_mime
        payload["image_base64"] = image_base64

    start = time.perf_counter()
    response = requests.post(API_URL, json=payload, timeout=timeout)
    elapsed = time.perf_counter() - start

    response.raise_for_status()
    result = response.json()
    return result.get("text", ""), elapsed


def format_time(seconds: float) -> str:
    """Format time in seconds to human-readable string."""
    if seconds < 1:
        return f"{seconds * 1000:.1f} ms"
    else:
        return f"{seconds:.2f} s"


def main() -> None:
    args = parse_args()

    print("=" * 60)
    print("Local Vision API Speed Benchmark")
    print("=" * 60)
    print(f"API URL: {API_URL}")
    print(f"model_id: {args.model_id}")
    print(f"Role: {args.role}")

    # Check health
    try:
        health = requests.get("http://127.0.0.1:8001/health", timeout=5).json()
        print(f"Device: {health.get('device', 'Unknown')}")
        print(f"CUDA: {health.get('cuda', False)}")
    except Exception as e:
        print(f"Warning: Could not check health: {e}")
    print("-" * 60)

    # Prepare image
    print("\nPreparing test image...")
    if args.image:
        img_base64, img_mime = load_image(args.image)
        print(f"    Loaded: {args.image}")
    else:
        img_base64, img_mime = create_test_image()
        print("    Using generated test image")

    # Warm-up
    print("\n[1/2] Warm-up run...")
    try:
        _, _ = run_inference(
            args.role,
            args.prompt,
            img_base64,
            img_mime,
            min(64, args.max_tokens),
            args.timeout,
            args.model_id,
        )
        print("    Warm-up complete")
    except Exception as e:
        print(f"    Warm-up failed: {e}")
        return

    # Benchmark runs
    print(f"\n[2/2] Benchmark ({args.iterations} iterations)...")
    times = []
    outputs = []

    for i in range(args.iterations):
        try:
            output, elapsed = run_inference(
                args.role,
                args.prompt,
                img_base64,
                img_mime,
                args.max_tokens,
                args.timeout,
                args.model_id,
            )
            times.append(elapsed)
            outputs.append(output)
            print(f"    Run {i+1}/{args.iterations}: {format_time(elapsed)}")
        except Exception as e:
            print(f"    Run {i+1}/{args.iterations}: FAILED - {e}")

    if not times:
        print("\nNo successful runs!")
        return

    # Summary
    times_arr = np.array(times)
    avg_time = float(np.mean(times_arr))
    min_time = float(np.min(times_arr))
    max_time = float(np.max(times_arr))
    std_time = float(np.std(times_arr))
    p50 = float(np.percentile(times_arr, 50))
    p95 = float(np.percentile(times_arr, 95))
    p99 = float(np.percentile(times_arr, 99))

    # Estimate tokens per second (approximate based on max_tokens)
    avg_tok_per_sec = args.max_tokens / avg_time if avg_time > 0 else 0

    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"Iterations:           {len(times)}")
    print(f"Max tokens per run:   {args.max_tokens}")
    print("")
    print(f"Latency (seconds):")
    print(f"  - Average:          {format_time(avg_time)}")
    print(f"  - Min:              {format_time(min_time)}")
    print(f"  - Max:              {format_time(max_time)}")
    print(f"  - Std Dev:          {std_time:.3f} s")
    print(f"  - Median (p50):     {format_time(p50)}")
    print(f"  - p95:              {format_time(p95)}")
    print(f"  - p99:              {format_time(p99)}")
    print("")
    print(f"Throughput (estimated):")
    print(f"  - ~{avg_tok_per_sec:.1f} tokens/sec")
    print("")
    print(f"Throughput (requests):")
    print(f"  - ~{1/avg_time:.2f} requests/sec")
    print("=" * 60)

    # Show sample output
    print("\nSample output (last run):")
    print("-" * 40)
    sample = outputs[-1] if outputs else ""
    print(sample[:500] + "..." if len(sample) > 500 else sample)
    print("-" * 40)


if __name__ == "__main__":
    main()
