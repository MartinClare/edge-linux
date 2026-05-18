"""
Local vision LLM server: one active local model at a time.

Default backend is embedded vLLM for Gemma model IDs, while the existing
Transformers path remains available via LOCAL_VISION_BACKEND=transformers.

Models (set paths via env, defaults under /home/interlv/models):
  - qwen2-5-vl-7b   (Qwen2.5-VL)
  - qwen3-vl-8b     (Qwen3-VL-8B-Instruct)
  - gemma-4-e4b     (Gemma-4-E4B-IT, multimodal)
  - gemma-3n-e4b    (Gemma-3n-E4B-IT, multimodal)
  - gemma-3n-e2b    (Gemma-3n-E2B-IT, multimodal)

Run:
  cd python && python -m uvicorn app.local_vision_server:app --host 0.0.0.0 --port 8001
"""

from __future__ import annotations

import base64
import gc
import io
import logging
import os
import threading
import uuid
from typing import Any, Optional

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from PIL import Image
from qwen_vl_utils import process_vision_info
from transformers import (
    AutoModelForCausalLM,
    AutoModelForImageTextToText,
    AutoProcessor,
    Qwen2_5_VLForConditionalGeneration,
    Qwen3VLForConditionalGeneration,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# ── paths per model_id ───────────────────────────────────────────────────
REPO_DEFAULT = "/home/interlv/models"
PATH_QWEN25 = os.getenv("QWEN25_VL_PATH", f"{REPO_DEFAULT}/Qwen2.5-VL-7B-Instruct")
PATH_QWEN3_8B = os.getenv("QWEN3_VL_8B_PATH", f"{REPO_DEFAULT}/Qwen3-VL-8B-Instruct")
PATH_GEMMA4 = os.getenv("GEMMA4_E4B_PATH", f"{REPO_DEFAULT}/gemma-4-E4B-it")
PATH_GEMMA3N_E4B = os.getenv("GEMMA3N_E4B_PATH", f"{REPO_DEFAULT}/gemma-3n-E4B-it")
PATH_GEMMA3N_E2B = os.getenv("GEMMA3N_E2B_PATH", f"{REPO_DEFAULT}/gemma-3n-E2B-it")

DEFAULT_MODEL_ID = os.getenv("DEFAULT_MODEL_ID", "gemma-4-e4b")
LOCAL_VISION_BACKEND = os.getenv("LOCAL_VISION_BACKEND", "vllm").lower()
VLLM_MAX_MODEL_LEN = int(os.getenv("VLLM_MAX_MODEL_LEN", "8192"))
VLLM_GPU_MEMORY_UTILIZATION = float(os.getenv("VLLM_GPU_MEMORY_UTILIZATION", "0.90"))
VLLM_TENSOR_PARALLEL_SIZE = int(os.getenv("VLLM_TENSOR_PARALLEL_SIZE", "1"))
VLLM_MAX_NUM_SEQS = int(os.getenv("VLLM_MAX_NUM_SEQS", "4"))
VLLM_MAX_SOFT_TOKENS = int(os.getenv("VLLM_MAX_SOFT_TOKENS", "280"))
VLLM_VISION_SOFT_TOKENS = int(os.getenv("VLLM_VISION_SOFT_TOKENS", "1120"))

INSPECTOR_MODEL_KIND = os.getenv("INSPECTOR_MODEL_KIND", "auto").lower()
VISUAL_TOKENS = int(os.getenv("VISUAL_TOKENS", "512"))
MIN_PIXELS = int(os.getenv("MIN_PIXELS", str(256 * 28 * 28)))
MAX_PIXELS = int(os.getenv("MAX_PIXELS", str(VISUAL_TOKENS * 28 * 28)))
ALERT_USE_ROLE = os.getenv("ALERT_USE_ROLE", "inspector")
MAX_NEW_TOKENS_INSPECT = int(os.getenv("MAX_NEW_TOKENS_INSPECT", "512"))
MAX_NEW_TOKENS_EVAL = int(os.getenv("MAX_NEW_TOKENS_EVAL", "1024"))
MAX_NEW_TOKENS_ALERT = int(os.getenv("MAX_NEW_TOKENS_ALERT", "768"))

MODEL_PATHS: dict[str, str] = {
    "qwen2-5-vl-7b": PATH_QWEN25,
    "qwen3-vl-8b": PATH_QWEN3_8B,
    "gemma-4-e4b": PATH_GEMMA4,
    "gemma-3n-e4b": PATH_GEMMA3N_E4B,
    "gemma-3n-e2b": PATH_GEMMA3N_E2B,
}

_serve_lock = threading.Lock()
_model_load_lock = threading.Lock()

_active_model_id: str = ""
_qwen_model: Optional[Any] = None
_qwen_processor: Optional[Any] = None
_qwen_kind: str = ""  # qwen2_5_vl | qwen3_vl
_gemma_model: Optional[Any] = None
_gemma_processor: Optional[Any] = None
_gemma_loader: str = ""
_vllm_engine: Optional[Any] = None
_vllm_processor: Optional[Any] = None
_vllm_loader: str = ""
_load_error: str = ""


def _qwen_subkind_for_path(path: str) -> str:
    if INSPECTOR_MODEL_KIND in {"qwen2_5_vl", "qwen3_vl"}:
        return INSPECTOR_MODEL_KIND
    pl = path.lower()
    if "qwen2.5" in pl or "qwen2_5" in pl:
        return "qwen2_5_vl"
    return "qwen3_vl"


def _unload_all() -> None:
    global _qwen_model, _qwen_processor, _qwen_kind
    global _gemma_model, _gemma_processor, _gemma_loader
    global _vllm_engine, _vllm_processor, _vllm_loader
    global _load_error, _active_model_id
    _active_model_id = ""
    _qwen_model = None
    _qwen_processor = None
    _qwen_kind = ""
    _gemma_model = None
    _gemma_processor = None
    _gemma_loader = ""
    if _vllm_engine is not None and hasattr(_vllm_engine, "shutdown"):
        try:
            _vllm_engine.shutdown()
        except Exception:  # noqa: BLE001
            logger.exception("vLLM engine shutdown failed")
    _vllm_engine = None
    _vllm_processor = None
    _vllm_loader = ""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    _load_error = ""


def _load_qwen_at_path(path: str) -> None:
    global _qwen_model, _qwen_processor, _qwen_kind, _load_error
    sub = _qwen_subkind_for_path(path)
    logger.info("Loading %s from %s", sub, path)
    if sub == "qwen2_5_vl":
        _qwen_processor = AutoProcessor.from_pretrained(
            path, min_pixels=MIN_PIXELS, max_pixels=MAX_PIXELS
        )
        _qwen_model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            path,
            torch_dtype=torch.bfloat16,
            device_map="auto",
            attn_implementation="sdpa",
        )
    else:
        _qwen_model = Qwen3VLForConditionalGeneration.from_pretrained(
            path, dtype=torch.bfloat16, device_map="auto"
        )
        _qwen_processor = AutoProcessor.from_pretrained(path)
    _qwen_kind = sub
    logger.info("Loaded Qwen (%s) from %s", sub, path)


def _load_gemma_at_path(path: str, model_id: str) -> None:
    global _gemma_model, _gemma_processor, _gemma_loader, _load_error
    attn_impl = "eager" if model_id.startswith("gemma-3n-") else "sdpa"
    logger.info("Loading Gemma multimodal model %s from %s", model_id, path)
    try:
        _gemma_model = AutoModelForImageTextToText.from_pretrained(
            path,
            dtype=torch.bfloat16,
            device_map="auto",
            attn_implementation=attn_impl,
        )
        _gemma_loader = "image-text-to-text"
    except Exception as e:  # noqa: BLE001
        # Gemma 4 docs also show AutoModelForCausalLM for multimodal generation.
        logger.warning("Gemma ImageTextToText load failed; trying CausalLM: %s", e)
        _gemma_model = AutoModelForCausalLM.from_pretrained(
            path,
            dtype=torch.bfloat16,
            device_map="auto",
            attn_implementation=attn_impl,
        )
        _gemma_loader = "causal-lm"
    _gemma_processor = AutoProcessor.from_pretrained(path, padding_side="left")
    logger.info("Loaded Gemma from %s using %s", path, _gemma_loader)


def _load_vllm_gemma_at_path(path: str, model_id: str) -> None:
    global _vllm_engine, _vllm_processor, _vllm_loader
    logger.info("Loading Gemma vLLM model %s from %s", model_id, path)
    try:
        from vllm.engine.arg_utils import AsyncEngineArgs  # type: ignore
        from vllm.engine.async_llm_engine import AsyncLLMEngine  # type: ignore
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(
            "vLLM is not installed; install vllm or set LOCAL_VISION_BACKEND=transformers"
        ) from e

    _vllm_processor = AutoProcessor.from_pretrained(path, padding_side="left")
    engine_args = AsyncEngineArgs(
        model=path,
        trust_remote_code=True,
        max_model_len=VLLM_MAX_MODEL_LEN,
        gpu_memory_utilization=VLLM_GPU_MEMORY_UTILIZATION,
        tensor_parallel_size=VLLM_TENSOR_PARALLEL_SIZE,
        max_num_seqs=VLLM_MAX_NUM_SEQS,
        limit_mm_per_prompt={"image": 1, "video": 0},
        hf_overrides={
            "vision_config": {"default_output_length": VLLM_VISION_SOFT_TOKENS},
            "vision_soft_tokens_per_image": VLLM_VISION_SOFT_TOKENS,
        },
        mm_processor_kwargs={"max_soft_tokens": VLLM_MAX_SOFT_TOKENS},
    )
    _vllm_engine = AsyncLLMEngine.from_engine_args(engine_args)
    _vllm_loader = "vllm"
    logger.info("Loaded Gemma via embedded vLLM from %s", path)


def ensure_model(model_id: str) -> None:
    global _active_model_id, _load_error
    if model_id not in MODEL_PATHS:
        raise ValueError(f"Unknown model_id: {model_id}")
    path = MODEL_PATHS[model_id]
    if not os.path.isdir(path):
        raise FileNotFoundError(
            f"Model directory not found: {path} (set env for {model_id})"
        )
    with _model_load_lock:
        if _active_model_id == model_id and _model_loaded_for(model_id):
            return
        _unload_all()
        _load_error = ""
        try:
            if model_id in ("qwen2-5-vl-7b", "qwen3-vl-8b"):
                _load_qwen_at_path(path)
            elif model_id.startswith("gemma-") and LOCAL_VISION_BACKEND == "vllm":
                _load_vllm_gemma_at_path(path, model_id)
            elif model_id.startswith("gemma-"):
                _load_gemma_at_path(path, model_id)
            _active_model_id = model_id
        except Exception as e:  # noqa: BLE001
            _load_error = f"Model load failed: {e}"
            logger.exception("%s", _load_error)
            raise


def _model_loaded_for(model_id: str) -> bool:
    if model_id in ("qwen2-5-vl-7b", "qwen3-vl-8b"):
        return _qwen_model is not None
    if model_id.startswith("gemma-") and LOCAL_VISION_BACKEND == "vllm":
        return _vllm_engine is not None
    if model_id.startswith("gemma-"):
        return _gemma_model is not None
    return False


def _resolve_request_model_id(requested: Optional[str]) -> str:
    mid = (requested or DEFAULT_MODEL_ID or "gemma-4-e4b").strip()
    if mid not in MODEL_PATHS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown model_id {mid!r}. Valid: {list(MODEL_PATHS)}",
        )
    return mid


# ── generate ────────────────────────────────────────────────────────────

def _pil_from_b64(image_mime: str, image_b64: str) -> Image.Image:
    raw = base64.b64decode(image_b64, validate=True)
    im = Image.open(io.BytesIO(raw))
    return im.convert("RGB")


def _data_url_from_payload(image_mime: str, image_b64: str) -> str:
    return f"data:{image_mime};base64,{image_b64}"


def _generate_qwen(
    prompt: str, image_mime: str, image_b64: str, max_new_tokens: int
) -> str:
    assert _qwen_model is not None and _qwen_processor is not None
    pil = _pil_from_b64(image_mime, image_b64)
    content: list[dict[str, Any]] = [
        {"type": "image", "image": pil},
        {"type": "text", "text": prompt},
    ]
    messages = [{"role": "user", "content": content}]
    if _qwen_kind == "qwen2_5_vl":
        text = _qwen_processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        image_inputs, video_inputs = process_vision_info(messages)
        inputs = _qwen_processor(
            text=[text],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        )
    else:
        inputs = _qwen_processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        )
    inputs = inputs.to(_qwen_model.device)
    generated = _qwen_model.generate(**inputs, max_new_tokens=max_new_tokens)
    generated = [
        out_ids[len(in_ids) :]
        for in_ids, out_ids in zip(inputs.input_ids, generated)
    ]
    text = _qwen_processor.batch_decode(
        generated, skip_special_tokens=True, clean_up_tokenization_spaces=False
    )
    return text[0].strip() if text else ""


def _generate_gemma(prompt: str, data_url: str, max_new_tokens: int) -> str:
    assert _gemma_model is not None and _gemma_processor is not None
    content: list[dict[str, Any]] = [
        {"type": "image", "url": data_url},
        {"type": "text", "text": prompt},
    ]
    messages = [{"role": "user", "content": content}]
    inputs = _gemma_processor.apply_chat_template(
        messages,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
        add_generation_prompt=True,
    ).to(_gemma_model.device)
    input_len = inputs["input_ids"].shape[-1]
    out = _gemma_model.generate(**inputs, max_new_tokens=max_new_tokens)
    return _gemma_processor.decode(
        out[0][input_len:], skip_special_tokens=True
    ).strip()


async def _generate_vllm_gemma(
    prompt: str, image_mime: str, image_b64: str, max_new_tokens: int
) -> str:
    assert _vllm_engine is not None and _vllm_processor is not None
    try:
        from vllm import SamplingParams  # type: ignore
    except Exception as e:  # noqa: BLE001
        raise RuntimeError("vLLM is not installed") from e

    pil = _pil_from_b64(image_mime, image_b64)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image"},
                {"type": "text", "text": prompt},
            ],
        }
    ]
    prompt_text = _vllm_processor.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    sampling_params = SamplingParams(
        temperature=0.2,
        max_tokens=max_new_tokens,
    )
    final_output = None
    request_id = f"vision-{uuid.uuid4().hex}"
    async for output in _vllm_engine.generate(
        {
            "prompt": prompt_text,
            "multi_modal_data": {"image": pil},
            "mm_processor_kwargs": {"max_soft_tokens": VLLM_MAX_SOFT_TOKENS},
        },
        sampling_params,
        request_id=request_id,
    ):
        final_output = output
    if final_output is None or not final_output.outputs:
        return ""
    return final_output.outputs[0].text.strip()


def _forward_transformers(
    model_id: str,
    role: str,
    prompt: str,
    image_mime: str,
    image_b64: str,
    max_new_tokens: int,
) -> tuple[str, str]:
    """Single active backend: all roles use Gemma for Gemma IDs, else Qwen."""
    ensure_model(model_id)
    durl = _data_url_from_payload(image_mime, image_b64)
    pth = MODEL_PATHS[model_id]
    if model_id.startswith("gemma-"):
        t = _generate_gemma(prompt, durl, max_new_tokens)
        return t, pth
    # Qwen2.5 / Qwen3 — inspector, evaluator, and alert all use the same VLM
    t = _generate_qwen(prompt, image_mime, image_b64, max_new_tokens)
    return t, pth


async def _forward(
    model_id: str,
    role: str,
    prompt: str,
    image_mime: str,
    image_b64: str,
    max_new_tokens: int,
) -> tuple[str, str]:
    ensure_model(model_id)
    pth = MODEL_PATHS[model_id]
    if model_id.startswith("gemma-") and LOCAL_VISION_BACKEND == "vllm":
        t = await _generate_vllm_gemma(prompt, image_mime, image_b64, max_new_tokens)
        return t, pth
    # Preserve serialized Transformers behavior for Qwen and fallback mode.
    with _serve_lock:
        return _forward_transformers(
            model_id, role, prompt, image_mime, image_b64, max_new_tokens
        )


# ── FastAPI ─────────────────────────────────────────────────────────────
app = FastAPI(title="Local vision LLM", version="1.0.0")


class VisionRequest(BaseModel):
    role: str = Field(description="inspector | evaluator | alert")
    prompt: str
    image_mime: str = "image/jpeg"
    image_base64: str
    max_new_tokens: int | None = None
    model_id: str | None = None


class VisionResponse(BaseModel):
    text: str
    role: str
    model_path: str
    model_id: str | None = None


@app.get("/health")
def health() -> JSONResponse:
    qok = _qwen_model is not None
    gok = _gemma_model is not None
    vok = _vllm_engine is not None
    return JSONResponse(
        {
            "ok": _load_error == "" or qok or gok or vok,
            "error": _load_error or None,
            "cuda": bool(torch.cuda.is_available()),
            "device": (
                torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
            ),
            "backend": LOCAL_VISION_BACKEND,
            "active_model_id": _active_model_id or None,
            "default_model_id": DEFAULT_MODEL_ID,
            "qwen_vlm_loaded": qok,
            "qwen_vlm_kind": _qwen_kind or None,
            "gemma_loaded": gok,
            "gemma_loader": _gemma_loader or None,
            "vllm_loaded": vok,
            "vllm_loader": _vllm_loader or None,
            "paths": {k: v for k, v in MODEL_PATHS.items()},
            "visual_tokens": VISUAL_TOKENS,
            "vllm": {
                "max_model_len": VLLM_MAX_MODEL_LEN,
                "gpu_memory_utilization": VLLM_GPU_MEMORY_UTILIZATION,
                "tensor_parallel_size": VLLM_TENSOR_PARALLEL_SIZE,
                "max_num_seqs": VLLM_MAX_NUM_SEQS,
                "max_soft_tokens": VLLM_MAX_SOFT_TOKENS,
                "vision_soft_tokens": VLLM_VISION_SOFT_TOKENS,
            },
        }
    )


@app.get("/v1/vision/models")
def list_models() -> JSONResponse:
    out = []
    for mid, pth in MODEL_PATHS.items():
        exists = os.path.isdir(pth)
        out.append(
            {
                "model_id": mid,
                "path": pth,
                "exists": exists,
                "active": _active_model_id == mid,
            }
        )
    return JSONResponse(
        {
            "backend": LOCAL_VISION_BACKEND,
            "default_model_id": DEFAULT_MODEL_ID,
            "models": out,
        }
    )


@app.post("/v1/vision/generate", response_model=VisionResponse)
async def generate(req: VisionRequest) -> VisionResponse:
    r = (req.role or "inspector").lower()
    mid = _resolve_request_model_id(req.model_id)
    try:
        if r == "inspector":
            m = req.max_new_tokens or MAX_NEW_TOKENS_INSPECT
            t, p = await _forward(
                mid, "inspector", req.prompt, req.image_mime, req.image_base64, m
            )
        elif r == "evaluator":
            m = req.max_new_tokens or MAX_NEW_TOKENS_EVAL
            t, p = await _forward(
                mid, "evaluator", req.prompt, req.image_mime, req.image_base64, m
            )
        elif r == "alert":
            m = req.max_new_tokens or MAX_NEW_TOKENS_ALERT
            t, p = await _forward(
                mid,
                "alert",
                req.prompt,
                req.image_mime,
                req.image_base64,
                m,
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unknown role: {req.role}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return VisionResponse(text=t, role=r, model_path=p, model_id=mid)


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "local-vision-llm",
        "docs": "/docs",
        "health": "/health",
        "models": "GET /v1/vision/models",
        "generate": "POST /v1/vision/generate",
    }


@app.on_event("startup")
def warmup() -> None:
    def _run() -> None:
        if os.getenv("PRECLOAD_DEFAULT", "1") != "1":
            return
        try:
            ensure_model(DEFAULT_MODEL_ID)
        except Exception:  # noqa: BLE001
            logger.exception("Model preload failed (server still up)")

    threading.Thread(target=_run, daemon=True).start()
