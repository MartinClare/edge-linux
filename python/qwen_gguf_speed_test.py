#!/usr/bin/env python3
"""Benchmark Qwen3-VL GGUF locally with llama-cpp-python.

This expects the official Qwen3-VL Instruct GGUF files:
  - Qwen3VL-32B-Instruct-Q8_0.gguf
  - mmproj-Qwen3VL-32B-Instruct-Q8_0.gguf
"""

from __future__ import annotations

import argparse
import base64
import time
from pathlib import Path

import numpy as np
from llama_cpp import Llama
from llama_cpp.llama_chat_format import Qwen25VLChatHandler


DEFAULT_MODEL = "/home/interlv/models/Qwen3-VL-32B-Instruct-GGUF/Qwen3VL-32B-Instruct-Q8_0.gguf"
DEFAULT_MMPROJ = "/home/interlv/models/Qwen3-VL-32B-Instruct-GGUF/mmproj-Qwen3VL-32B-Instruct-Q8_0.gguf"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark Qwen3-VL GGUF image inference.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Path to LLM GGUF file.")
    parser.add_argument("--mmproj", default=DEFAULT_MMPROJ, help="Path to vision mmproj GGUF file.")
    parser.add_argument("--image", required=True, help="Image path.")
    parser.add_argument("--prompt", default="Describe the image clearly and briefly.")
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--max-tokens", type=int, default=64)
    parser.add_argument("--ctx", type=int, default=4096)
    parser.add_argument("--gpu-layers", type=int, default=-1, help="Layers to offload to GPU; -1 means all.")
    return parser.parse_args()


def format_time(seconds: float) -> str:
    if seconds < 1:
        return f"{seconds * 1000:.1f} ms"
    return f"{seconds:.2f} s"


def image_data_url(path: str) -> str:
    image_path = Path(path).expanduser().resolve()
    raw = image_path.read_bytes()
    suffix = image_path.suffix.lower()
    mime = "image/png" if suffix == ".png" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def run_once(llm: Llama, image_url: str, prompt: str, max_tokens: int) -> tuple[str, float]:
    start = time.perf_counter()
    response = llm.create_chat_completion(
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_url}},
                    {"type": "text", "text": prompt},
                ],
            }
        ],
        max_tokens=max_tokens,
        temperature=0.1,
    )
    elapsed = time.perf_counter() - start
    text = response["choices"][0]["message"]["content"]
    return text, elapsed


def main() -> None:
    args = parse_args()
    model_path = Path(args.model)
    mmproj_path = Path(args.mmproj)
    if not model_path.exists():
        raise SystemExit(f"Model file not found: {model_path}")
    if not mmproj_path.exists():
        raise SystemExit(f"mmproj file not found: {mmproj_path}")

    print("=" * 60)
    print("Qwen3-VL GGUF Speed Benchmark")
    print("=" * 60)
    print(f"Model: {model_path}")
    print(f"mmproj: {mmproj_path}")
    print(f"Image: {args.image}")
    print(f"Max tokens: {args.max_tokens}")
    print("-" * 60)

    image_url = image_data_url(args.image)
    chat_handler = Qwen25VLChatHandler(clip_model_path=str(mmproj_path), verbose=False)

    load_start = time.perf_counter()
    llm = Llama(
        model_path=str(model_path),
        chat_handler=chat_handler,
        n_ctx=args.ctx,
        n_gpu_layers=args.gpu_layers,
        flash_attn=True,
        verbose=False,
    )
    load_time = time.perf_counter() - load_start
    print(f"Load time: {format_time(load_time)}")

    print("\n[1/2] Warm-up run...")
    run_once(llm, image_url, args.prompt, min(32, args.max_tokens))
    print("    Warm-up complete")

    print(f"\n[2/2] Benchmark ({args.iterations} iterations)...")
    times: list[float] = []
    outputs: list[str] = []
    for idx in range(args.iterations):
        output, elapsed = run_once(llm, image_url, args.prompt, args.max_tokens)
        times.append(elapsed)
        outputs.append(output)
        print(f"    Run {idx + 1}/{args.iterations}: {format_time(elapsed)}")

    times_arr = np.array(times)
    avg_time = float(np.mean(times_arr))
    min_time = float(np.min(times_arr))
    max_time = float(np.max(times_arr))
    std_time = float(np.std(times_arr))

    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"Load time:            {format_time(load_time)}")
    print(f"Iterations:           {len(times)}")
    print(f"Average latency:      {format_time(avg_time)}")
    print(f"Min latency:          {format_time(min_time)}")
    print(f"Max latency:          {format_time(max_time)}")
    print(f"Std Dev:              {std_time:.3f} s")
    print(f"Estimated throughput: ~{args.max_tokens / avg_time:.1f} tokens/sec")
    print("=" * 60)

    print("\nSample output (last run):")
    print("-" * 40)
    print(outputs[-1][:500] + "..." if len(outputs[-1]) > 500 else outputs[-1])
    print("-" * 40)


if __name__ == "__main__":
    main()
