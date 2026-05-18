#!/usr/bin/env python3
"""Persistent local Qwen2.5-VL server.

Keeps the model loaded so repeated image requests do not pay model load time.
"""

from __future__ import annotations

import base64
import io
import os
import threading
import time
from typing import Any

import torch
from fastapi import FastAPI
from pydantic import BaseModel
from PIL import Image
from qwen_vl_utils import process_vision_info
from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration


MODEL_PATH = os.getenv("MODEL_PATH", "/models/Qwen2.5-VL-7B-Instruct")
VISUAL_TOKENS = int(os.getenv("VISUAL_TOKENS", "512"))
MIN_PIXELS = int(os.getenv("MIN_PIXELS", str(256 * 28 * 28)))
MAX_PIXELS = int(os.getenv("MAX_PIXELS", str(VISUAL_TOKENS * 28 * 28)))

app = FastAPI(title="Qwen2.5-VL Server", version="1.0.0")
_serve_lock = threading.Lock()
_model: Any = None
_processor: Any = None
_load_seconds: float | None = None


class GenerateRequest(BaseModel):
    prompt: str
    image_base64: str
    image_mime: str = "image/jpeg"
    max_new_tokens: int = 160


class GenerateResponse(BaseModel):
    text: str
    elapsed_seconds: float
    image_tokens: int
    model_path: str


def _load_model() -> None:
    global _model, _processor, _load_seconds
    if _model is not None and _processor is not None:
        return

    start = time.perf_counter()
    _processor = AutoProcessor.from_pretrained(
        MODEL_PATH,
        min_pixels=MIN_PIXELS,
        max_pixels=MAX_PIXELS,
    )
    _model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        attn_implementation="sdpa",
    )
    _load_seconds = time.perf_counter() - start


def _image_from_b64(image_b64: str) -> Image.Image:
    raw = base64.b64decode(image_b64, validate=True)
    return Image.open(io.BytesIO(raw)).convert("RGB")


@app.on_event("startup")
def startup() -> None:
    _load_model()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": _model is not None,
        "cuda": torch.cuda.is_available(),
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "model_path": MODEL_PATH,
        "visual_tokens": VISUAL_TOKENS,
        "load_seconds": _load_seconds,
    }


@app.post("/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest) -> GenerateResponse:
    _load_model()
    assert _model is not None and _processor is not None

    image = _image_from_b64(req.image_base64)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": req.prompt},
            ],
        }
    ]

    text = _processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, video_inputs = process_vision_info(messages)
    inputs = _processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    ).to(_model.device)
    image_token_id = _processor.tokenizer.convert_tokens_to_ids("<|image_pad|>")
    image_tokens = int((inputs.input_ids == image_token_id).sum())

    with _serve_lock:
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        start = time.perf_counter()
        with torch.no_grad():
            generated_ids = _model.generate(**inputs, max_new_tokens=req.max_new_tokens)
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        elapsed = time.perf_counter() - start

    generated_ids = [
        out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
    ]
    output = _processor.batch_decode(
        generated_ids,
        skip_special_tokens=True,
        clean_up_tokenization_spaces=False,
    )[0].strip()
    return GenerateResponse(
        text=output,
        elapsed_seconds=elapsed,
        image_tokens=image_tokens,
        model_path=MODEL_PATH,
    )
