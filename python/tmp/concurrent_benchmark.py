#!/usr/bin/env python3
"""
Concurrent benchmark: Send multiple requests simultaneously to test throughput.
Compares sequential vs concurrent latency for vLLM vs llama-cpp.
"""

import asyncio
import base64
import json
import time
from pathlib import Path
from typing import Optional

import aiohttp
import cv2

# Test configuration
RTSP_URL = "rtsp://admin:123456@192.168.10.2:554/Streaming/Channels/101"
CLOUD_API = "http://127.0.0.1:3001/api/analyze-image"
NUM_REQUESTS = 3  # Number of concurrent requests to send

# Vision models to test
VLLM_MODEL = "local_qwen3_vllm"  # Uses port 8002 (vLLM)
LLAMA_MODEL = "local_qwen3_vl_8b"  # Uses port 8001 (llama-cpp/Transformers)

PROMPT_ZH = """分析這張工地監控圖片，檢查:
1. 工人是否佩戴安全帽
2. 工人是否穿著反光背心
3. 是否有危險行為
4. 整體安全風險評級

請用繁體中文回答，格式為JSON。"""


async def capture_frame(rtsp_url: str) -> Optional[bytes]:
    """Capture a single frame from RTSP stream."""
    cap = cv2.VideoCapture(rtsp_url)
    for _ in range(5):  # Flush buffer
        cap.read()
    ok, frame = cap.read()
    cap.release()
    if not ok or frame is None:
        return None
    ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    return encoded.tobytes() if ok else None


async def analyze_image(
    session: aiohttp.ClientSession,
    image_bytes: bytes,
    vision_model: str,
    request_id: int,
) -> dict:
    """Send analyze request to cloud API."""
    data = aiohttp.FormData()
    data.add_field("image", image_bytes, filename="frame.jpg", content_type="image/jpeg")
    data.add_field("language", "zh-TW")
    data.add_field("visionModel", vision_model)

    start = time.perf_counter()
    try:
        async with session.post(CLOUD_API, data=data, timeout=600) as resp:
            body = await resp.json()
            elapsed = time.perf_counter() - start
            return {
                "request_id": request_id,
                "vision_model": vision_model,
                "status": "success" if body.get("success") else "failed",
                "elapsed_sec": round(elapsed, 2),
                "risk_level": (body.get("data") or {}).get("overallRiskLevel", "?"),
                "error": body.get("error") if not body.get("success") else None,
            }
    except Exception as e:
        elapsed = time.perf_counter() - start
        return {
            "request_id": request_id,
            "vision_model": vision_model,
            "status": "error",
            "elapsed_sec": round(elapsed, 2),
            "error": str(e)[:200],
        }


async def run_concurrent_test(vision_model: str, image_bytes: bytes) -> dict:
    """Send NUM_REQUESTS concurrently and measure total time."""
    print(f"\n{'='*60}")
    print(f"Testing: {vision_model}")
    print(f"Sending {NUM_REQUESTS} requests CONCURRENTLY...")
    print(f"{'='*60}")

    async with aiohttp.ClientSession() as session:
        start_total = time.perf_counter()

        # Send all requests simultaneously
        tasks = [
            analyze_image(session, image_bytes, vision_model, i)
            for i in range(NUM_REQUESTS)
        ]
        results = await asyncio.gather(*tasks)

        total_elapsed = time.perf_counter() - start_total

    # Print results
    print(f"\nResults (concurrent execution):")
    print(f"-" * 60)
    for r in results:
        status = "✓" if r["status"] == "success" else "✗"
        print(f"  Request {r['request_id']}: {status} {r['elapsed_sec']:.2f}s  Risk={r.get('risk_level', '?')}")
        if r.get("error"):
            print(f"    Error: {r['error'][:100]}")

    print(f"-" * 60)
    print(f"Total wall-clock time: {total_elapsed:.2f}s")

    # Calculate metrics
    individual_times = [r["elapsed_sec"] for r in results if r["status"] == "success"]
    avg_latency = sum(individual_times) / len(individual_times) if individual_times else 0
    throughput = NUM_REQUESTS / total_elapsed if total_elapsed > 0 else 0

    # Sequential equivalent (sum of individual times)
    sequential_time = sum(individual_times)
    speedup = sequential_time / total_elapsed if total_elapsed > 0 else 0

    print(f"Average latency: {avg_latency:.2f}s per request")
    print(f"Throughput: {throughput:.2f} req/sec")
    print(f"Sequential equivalent: {sequential_time:.2f}s")
    print(f"Parallel speedup: {speedup:.2f}x")

    return {
        "model": vision_model,
        "total_time": round(total_elapsed, 2),
        "avg_latency": round(avg_latency, 2),
        "throughput": round(throughput, 2),
        "speedup": round(speedup, 2),
        "results": results,
    }


async def main():
    print("=" * 60)
    print("Concurrent Vision Model Benchmark")
    print("=" * 60)
    print(f"Target: {NUM_REQUESTS} concurrent requests per model")
    print(f"API: {CLOUD_API}")

    # Capture test frame
    print(f"\nCapturing frame from {RTSP_URL}...")
    image_bytes = await capture_frame(RTSP_URL)
    if not image_bytes:
        print("Failed to capture frame!")
        return
    print(f"Frame captured: {len(image_bytes)} bytes")

    # Save for reference
    test_image_path = Path("/tmp/avision_test_frame.jpg")
    test_image_path.write_bytes(image_bytes)
    print(f"Saved to: {test_image_path}")

    # Test llama-cpp (sequential, expected 1x concurrency)
    llama_results = await run_concurrent_test(LLAMA_MODEL, image_bytes)

    # Test vLLM (concurrent, expected 2-4x speedup)
    vllm_results = await run_concurrent_test(VLLM_MODEL, image_bytes)

    # Summary comparison
    print("\n" + "=" * 60)
    print("COMPARISON SUMMARY")
    print("=" * 60)
    print(f"\n{'Model':<20} {'Total Time':<12} {'Throughput':<12} {'Speedup':<10}")
    print("-" * 60)
    print(f"{'llama-cpp (8001)':<20} {llama_results['total_time']:<12.2f} {llama_results['throughput']:<12.2f} {llama_results['speedup']:<10.2f}")
    print(f"{'vLLM (8002)':<20} {vllm_results['total_time']:<12.2f} {vllm_results['throughput']:<12.2f} {vllm_results['speedup']:<10.2f}")

    # Key finding
    print("\n" + "=" * 60)
    if vllm_results['speedup'] > llama_results['speedup'] * 1.5:
        print("✓ vLLM supports concurrent processing (higher throughput)")
    else:
        print("⚠ Both models similar throughput (bottleneck elsewhere)")

    if llama_results['speedup'] < 1.2:
        print("✓ llama-cpp is sequential (requests processed one-by-one)")

    # Save results
    output = {
        "test_config": {
            "num_requests": NUM_REQUESTS,
            "rtsp_url": RTSP_URL,
            "api": CLOUD_API,
        },
        "llama_cpp": llama_results,
        "vllm": vllm_results,
    }
    result_path = Path("/tmp/avision_concurrent_results.json")
    result_path.write_text(json.dumps(output, indent=2))
    print(f"\nFull results saved to: {result_path}")


if __name__ == "__main__":
    asyncio.run(main())
