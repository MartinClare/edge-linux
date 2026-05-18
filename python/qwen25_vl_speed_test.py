#!/usr/bin/env python3
"""Benchmark Qwen2.5-VL on a local image.

The visual token budget is controlled with --visual-tokens. Lower values are
faster; higher values preserve more image detail.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
import torch
from qwen_vl_utils import process_vision_info
from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration


DEFAULT_MODEL = "/home/interlv/models/Qwen2.5-VL-7B-Instruct"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark Qwen2.5-VL image inference.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Local path or HF model id.")
    parser.add_argument("--image", required=True, help="Image path.")
    parser.add_argument("--prompt", default="Analyze this construction site image for safety and PPE. Be concise.")
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--max-tokens", type=int, default=64)
    parser.add_argument("--visual-tokens", type=int, default=512)
    parser.add_argument("--warmup-tokens", type=int, default=32)
    return parser.parse_args()


def format_time(seconds: float) -> str:
    if seconds < 1:
        return f"{seconds * 1000:.1f} ms"
    return f"{seconds:.2f} s"


def build_inputs(processor: AutoProcessor, image_path: str, prompt: str):
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": str(Path(image_path).expanduser().resolve())},
                {"type": "text", "text": prompt},
            ],
        }
    ]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, video_inputs = process_vision_info(messages)
    return processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    )


def run_once(model, processor, inputs, max_tokens: int) -> tuple[str, float]:
    device = model.device
    inputs = inputs.to(device)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    start = time.perf_counter()
    with torch.no_grad():
        generated_ids = model.generate(**inputs, max_new_tokens=max_tokens)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    elapsed = time.perf_counter() - start

    generated_ids = [
        out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
    ]
    output = processor.batch_decode(
        generated_ids,
        skip_special_tokens=True,
        clean_up_tokenization_spaces=False,
    )[0]
    return output.strip(), elapsed


def main() -> None:
    args = parse_args()
    min_pixels = 256 * 28 * 28
    max_pixels = args.visual_tokens * 28 * 28

    print("=" * 60)
    print("Qwen2.5-VL Speed Benchmark")
    print("=" * 60)
    print(f"Model: {args.model}")
    print(f"Image: {args.image}")
    print(f"Visual token budget: {args.visual_tokens}")
    print(f"Max output tokens: {args.max_tokens}")
    print(f"CUDA: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"Device: {torch.cuda.get_device_name(0)}")
    print("-" * 60)

    load_start = time.perf_counter()
    processor = AutoProcessor.from_pretrained(
        args.model,
        min_pixels=min_pixels,
        max_pixels=max_pixels,
    )
    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        args.model,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        attn_implementation="sdpa",
    )
    load_time = time.perf_counter() - load_start
    print(f"Load time: {format_time(load_time)}")

    inputs = build_inputs(processor, args.image, args.prompt)
    image_tokens = int((inputs.input_ids == processor.tokenizer.convert_tokens_to_ids("<|image_pad|>")).sum())
    print(f"Image tokens in prompt: {image_tokens}")

    print("\n[1/2] Warm-up run...")
    run_once(model, processor, inputs, args.warmup_tokens)
    print("    Warm-up complete")

    print(f"\n[2/2] Benchmark ({args.iterations} iterations)...")
    times: list[float] = []
    outputs: list[str] = []
    for idx in range(args.iterations):
        output, elapsed = run_once(model, processor, inputs, args.max_tokens)
        times.append(elapsed)
        outputs.append(output)
        print(f"    Run {idx + 1}/{args.iterations}: {format_time(elapsed)}")

    times_arr = np.array(times)
    avg_time = float(np.mean(times_arr))
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"Load time:            {format_time(load_time)}")
    print(f"Average latency:      {format_time(avg_time)}")
    print(f"Min latency:          {format_time(float(np.min(times_arr)))}")
    print(f"Max latency:          {format_time(float(np.max(times_arr)))}")
    print(f"Std Dev:              {float(np.std(times_arr)):.3f} s")
    print(f"Estimated throughput: ~{args.max_tokens / avg_time:.1f} tokens/sec")
    print("=" * 60)

    print("\nAnalysis output (last run):")
    print("-" * 40)
    print(outputs[-1])
    print("-" * 40)


if __name__ == "__main__":
    main()
