#!/usr/bin/env python3
"""Minimal local smoke test for Qwen3-VL.

Examples:
  python qwen3_vl_smoke_test.py --prompt "Describe your capabilities."
  python qwen3_vl_smoke_test.py --image /path/to/frame.jpg --prompt "Describe safety risks."
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from transformers import AutoProcessor, Qwen3VLForConditionalGeneration


DEFAULT_MODEL = "/home/interlv/models/Qwen3-VL-32B-Instruct"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a local Qwen3-VL smoke test.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="HF repo id or local model path.")
    parser.add_argument("--prompt", default="Briefly introduce yourself.", help="Text prompt.")
    parser.add_argument("--image", help="Optional image path for vision-language testing.")
    parser.add_argument("--max-new-tokens", type=int, default=256)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model_id = args.model

    model = Qwen3VLForConditionalGeneration.from_pretrained(
        model_id,
        dtype=torch.bfloat16,
        device_map="auto",
    )
    processor = AutoProcessor.from_pretrained(model_id)

    content: list[dict[str, object]] = [{"type": "text", "text": args.prompt}]
    if args.image:
        image_path = Path(args.image).expanduser().resolve()
        content.insert(0, {"type": "image", "image": str(image_path)})

    messages = [{"role": "user", "content": content}]
    inputs = processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    )
    inputs = inputs.to(model.device)

    generated_ids = model.generate(**inputs, max_new_tokens=args.max_new_tokens)
    generated_ids = [
        out_ids[len(in_ids) :] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
    ]
    output_text = processor.batch_decode(
        generated_ids,
        skip_special_tokens=True,
        clean_up_tokenization_spaces=False,
    )
    print(output_text[0])


if __name__ == "__main__":
    main()
