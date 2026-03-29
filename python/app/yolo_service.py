"""YOLOv8 inference service with graceful fallback when unavailable."""

import logging
from typing import List, Optional

import numpy as np

from .config import DEVICE, MODEL_PATH
from .models import Detection

logger = logging.getLogger(__name__)

_model = None
_actual_device: str = "cpu"
_model_loaded: bool = False


def get_actual_device() -> str:
    """Return the effective inference device used by YOLO."""
    return _actual_device


def _resolve_torch_device(requested_device: str) -> str:
    """Resolve the requested torch device to a safe, available value."""
    try:
        import torch
    except Exception:
        return "cpu"

    req = (requested_device or "").strip().lower()
    if req.startswith("cuda"):
        return requested_device if torch.cuda.is_available() else "cpu"
    if req == "mps":
        mps_backend = getattr(torch.backends, "mps", None)
        is_available = bool(mps_backend and mps_backend.is_available())
        return "mps" if is_available else "cpu"
    return requested_device or "cpu"


def load_model():
    """
    Load YOLO model if possible.

    On systems where ultralytics/torch is not available, this falls back to a
    non-fatal stub behavior (empty detections) so the API can still run.
    """
    global _model, _actual_device, _model_loaded

    try:
        from ultralytics import YOLO
    except Exception as exc:
        _model = None
        _actual_device = "cpu"
        _model_loaded = False
        logger.warning(
            "YOLO model NOT loaded: ultralytics import failed (%s). "
            "Detection endpoints will return empty results.",
            exc,
        )
        return None

    try:
        _model = YOLO(MODEL_PATH)
        _actual_device = _resolve_torch_device(DEVICE)
        _model_loaded = True
        logger.info(
            "YOLO model loaded successfully (model=%s, requested_device=%s, actual_device=%s)",
            MODEL_PATH,
            DEVICE,
            _actual_device,
        )
        return _model
    except Exception as exc:
        _model = None
        _actual_device = "cpu"
        _model_loaded = False
        logger.warning(
            "YOLO model NOT loaded (model=%s, requested_device=%s): %s. "
            "Detection endpoints will return empty results.",
            MODEL_PATH,
            DEVICE,
            exc,
        )
        return None


def _to_detection_list(results) -> List[Detection]:
    """Convert Ultralytics result objects to API response detections."""
    out: List[Detection] = []
    if not results:
        return out

    first = results[0]
    boxes = getattr(first, "boxes", None)
    names = getattr(first, "names", {}) or {}

    if boxes is None:
        return out

    xyxy = boxes.xyxy.tolist() if hasattr(boxes, "xyxy") else []
    cls_ids = boxes.cls.tolist() if hasattr(boxes, "cls") else []
    confs = boxes.conf.tolist() if hasattr(boxes, "conf") else []

    for idx, bbox in enumerate(xyxy):
        class_id = int(cls_ids[idx]) if idx < len(cls_ids) else -1
        confidence = float(confs[idx]) if idx < len(confs) else 0.0
        class_name = str(names.get(class_id, class_id))
        out.append(
            Detection(
                id=idx + 1,
                class_id=class_id,
                class_name=class_name,
                confidence=confidence,
                bbox=[float(v) for v in bbox],
            )
        )
    return out


def _predict(frame: np.ndarray) -> List[Detection]:
    if _model is None or not _model_loaded:
        return []

    try:
        results = _model.predict(frame, device=_actual_device, verbose=False)
        return _to_detection_list(results)
    except Exception as exc:
        logger.error("YOLO inference failed: %s", exc, exc_info=True)
        return []


def detect_image(img: np.ndarray) -> List[Detection]:
    """Run detection on an image and return normalized output objects."""
    return _predict(img)


def detect_frame(frame: np.ndarray) -> List[Detection]:
    """Run detection on a video frame and return normalized output objects."""
    return _predict(frame)
