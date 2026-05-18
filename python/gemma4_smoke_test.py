#!/usr/bin/env python3
"""Minimal local smoke test for Gemma 4.

Examples:
  python gemma4_smoke_test.py --prompt "Describe your capabilities."
  python gemma4_smoke_test.py --image /path/to/frame.jpg --prompt "Describe safety risks."
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from transformers import AutoModelForImageTextToText, AutoProcessor


DEFAULT_MODEL = "/home/interlv/models/gemma-4-31B-it"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a local Gemma 4 smoke test.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="HF repo id or local model path.")
    parser.add_argument("--prompt", default="Briefly introduce yourself.", help="Text prompt.")
    parser.add_argument("--image", help="Optional image path for vision-language testing.")
    parser.add_argument("--max-new-tokens", type=int, default=256)
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    model = AutoModelForImageTextToText.from_pretrained(
        args.model,
        dtype=torch.bfloat16,
        device_map="auto",
        attn_implementation="sdpa",
    )
    processor = AutoProcessor.from_pretrained(args.model, padding_side="left")

    content: list[dict[str, object]] = [{"type": "text", "text": args.prompt}]
    if args.image:
        image_path = Path(args.image).expanduser().resolve()
        content.insert(0, {"type": "image", "url": str(image_path)})

    messages = [{"role": "user", "content": content}]
    inputs = processor.apply_chat_template(
        messages,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
        add_generation_prompt=True,
    ).to(model.device)
    input_len = inputs["input_ids"].shape[-1]

    output = model.generate(
        **inputs,
        max_new_tokens=args.max_new_tokens,
    )
    print(processor.decode(output[0][input_len:], skip_special_tokens=True))


if __name__ == "__main__":
    main()
