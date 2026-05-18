#!/usr/bin/env python3
"""Speed benchmark for Qwen3-VL model.

Measures:
- Model load time
- First inference latency (cold start)
- Warm inference latency (average of multiple runs)
- Tokens per second (approximate)

Usage:
  source ../.venv/bin/activate
  python qwen_speed_test.py --iterations 5 --max-tokens 256
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import torch
from transformers import AutoProcessor, Qwen3VLForConditionalGeneration


DEFAULT_MODEL = "/home/interlv/models/Qwen3-VL-32B-Instruct"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark Qwen3-VL inference speed.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Model path or HF repo id.")
    parser.add_argument("--prompt", default="Describe this scene in detail.", help="Test prompt.")
    parser.add_argument("--image", help="Optional image path for vision testing.")
    parser.add_argument("--max-tokens", type=int, default=256, help="Max new tokens per generation.")
    parser.add_argument("--iterations", type=int, default=5, help="Number of warm-up iterations.")
    parser.add_argument("--warmup", type=int, default=2, help="Warm-up runs before measurement.")
    return parser.parse_args()


def format_time(seconds: float) -> str:
    """Format time in seconds to human-readable string."""
    if seconds < 1:
        return f"{seconds * 1000:.1f} ms"
    else:
        return f"{seconds:.2f} s"


def run_inference(model, processor, prompt: str, image_path: str | None, max_tokens: int) -> tuple[str, float, int]:
    """Run single inference and return (output_text, elapsed_seconds, token_count)."""
    content: list[dict[str, object]] = [{"type": "text", "text": prompt}]
    if image_path:
        content.insert(0, {"type": "image", "image": str(Path(image_path).expanduser().resolve())})

    messages = [{"role": "user", "content": content}]
    inputs = processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    )
    inputs = inputs.to(model.device)

    start = time.perf_counter()
    with torch.no_grad():
        generated_ids = model.generate(**inputs, max_new_tokens=max_tokens)
    elapsed = time.perf_counter() - start

    # Calculate output tokens
    output_tokens = len(generated_ids[0]) - len(inputs.input_ids[0])

    generated_ids_trimmed = [
        out_ids[len(in_ids) :] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
    ]
    output_text = processor.batch_decode(
        generated_ids_trimmed,
        skip_special_tokens=True,
        clean_up_tokenization_spaces=False,
    )[0]

    return output_text, elapsed, output_tokens


def main() -> None:
    args = parse_args()
    model_id = args.model

    print("=" * 60)
    print("Qwen3-VL Speed Benchmark")
    print("=" * 60)
    print(f"Model: {model_id}")
    print(f"Device: CUDA available = {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"CUDA device: {torch.cuda.get_device_name(0)}")
        print(f"CUDA memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    print("-" * 60)

    # Load model
    print("\n[1/4] Loading model...")
    load_start = time.perf_counter()
    model = Qwen3VLForConditionalGeneration.from_pretrained(
        model_id,
        dtype=torch.bfloat16,
        device_map="auto",
    )
    processor = AutoProcessor.from_pretrained(model_id)
    load_time = time.perf_counter() - load_start
    print(f"    Load time: {format_time(load_time)}")

    # Warm-up runs
    print(f"\n[2/4] Warm-up runs ({args.warmup} iterations)...")
    for i in range(args.warmup):
        _ = run_inference(model, processor, args.prompt, args.image, min(64, args.max_tokens))
        print(f"    Warm-up {i+1}/{args.warmup} complete")

    # Cold start measurement (first real inference)
    print("\n[3/4] Cold start inference...")
    output, cold_time, cold_tokens = run_inference(model, processor, args.prompt, args.image, args.max_tokens)
    print(f"    Cold start: {format_time(cold_time)}")
    print(f"    Tokens generated: {cold_tokens}")
    if cold_time > 0:
        print(f"    Tokens/sec: {cold_tokens / cold_time:.2f}")

    # Warm inferences
    print(f"\n[4/4] Warm inference ({args.iterations} iterations)...")
    times = []
    tokens_list = []
    outputs = []

    for i in range(args.iterations):
        output, elapsed, tokens = run_inference(model, processor, args.prompt, args.image, args.max_tokens)
        times.append(elapsed)
        tokens_list.append(tokens)
        outputs.append(output)
        print(f"    Run {i+1}/{args.iterations}: {format_time(elapsed)} ({tokens} tokens, {tokens/elapsed:.2f} tok/s)")

    # Summary
    avg_time = sum(times) / len(times)
    min_time = min(times)
    max_time = max(times)
    total_tokens = sum(tokens_list)
    avg_tokens = total_tokens / len(tokens_list)
    avg_tok_per_sec = avg_tokens / avg_time if avg_time > 0 else 0

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Model load time:      {format_time(load_time)}")
    print(f"Cold start latency:   {format_time(cold_time)}")
    print(f"Warm inference stats ({args.iterations} runs):")
    print(f"  - Average time:     {format_time(avg_time)}")
    print(f"  - Min time:         {format_time(min_time)}")
    print(f"  - Max time:         {format_time(max_time)}")
    print(f"  - Avg tokens/run:   {avg_tokens:.1f}")
    print(f"  - Throughput:       {avg_tok_per_sec:.2f} tokens/sec")
    print("=" * 60)

    # Show sample output
    print("\nSample output (last run):")
    print("-" * 40)
    print(outputs[-1][:500] + "..." if len(outputs[-1]) > 500 else outputs[-1])
    print("-" * 40)


if __name__ == "__main__":
    main()
