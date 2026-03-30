"""FastAPI application with YOLOv8 detection endpoints."""

import subprocess
import tempfile
import time
import base64
import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Optional
import cv2
import numpy as np
import requests
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Form, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, FileResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from .config import MODEL_PATH, DEVICE, FRAME_SAMPLE_EVERY, API_TITLE, API_VERSION, VIDEO_FOLDER
from .models import ImageDetections, VideoDetections, FrameDetections, Detection, RTSPStreamRequest
from .yolo_service import load_model, detect_image, detect_frame, get_actual_device
from .video_utils import open_video_capture, iterate_frames, get_video_properties
from .realtime_stream import stream_rtsp_realtime
from .alarm_routes import router as alarm_router
from .alarm_observer import get_alarm_observer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title=API_TITLE, version=API_VERSION)

# Add CORS middleware to allow frontend requests from any LAN host.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Custom middleware to ensure CORS headers are always present
class CORSHeaderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        # Ensure CORS headers are always present
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Expose-Headers"] = "*"
        return response

app.add_middleware(CORSHeaderMiddleware)

# Include alarm routes
app.include_router(alarm_router)

_deepvision_task: Optional[asyncio.Task] = None
_heartbeat_task: Optional[asyncio.Task] = None
_deepvision_camera_index: int = 0
_latest_deepvision_results: dict[str, dict] = {}
_DEEPVISION_CACHE_FILE = Path(__file__).resolve().parent.parent / "deepvision_cache.json"


def _load_deepvision_cache() -> dict[str, dict]:
    """Load persisted Deep Vision results so restarts don't lose data."""
    try:
        if _DEEPVISION_CACHE_FILE.exists():
            with open(_DEEPVISION_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                logger.info(f"Restored {len(data)} Deep Vision results from cache")
                return data
    except Exception as exc:
        logger.warning(f"Could not load Deep Vision cache: {exc}")
    return {}


def _save_deepvision_cache():
    """Persist latest Deep Vision results to disk."""
    try:
        with open(_DEEPVISION_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_latest_deepvision_results, f)
    except Exception as exc:
        logger.debug(f"Could not save Deep Vision cache: {exc}")


def _root_app_config_path() -> Path:
    # Single source of truth for runtime config.
    return Path(__file__).resolve().parent.parent.parent / "app.config.json"


def _load_runtime_config() -> dict:
    cfg_path = _root_app_config_path()
    if not cfg_path.exists():
        return {}
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        logger.warning(f"Failed to load app.config.json: {exc}")
        return {}


def _merge_config_section(existing: object, incoming: object) -> object:
    """Shallow-merge dict sections so PPE-UI saves preserve unknown fields."""
    if isinstance(existing, dict) and isinstance(incoming, dict):
        merged = dict(existing)
        merged.update(incoming)
        return merged
    return incoming


def _merge_rtsp_cameras(existing_cameras: object, incoming_cameras: object) -> list:
    """Preserve extra per-camera fields while applying PPE-UI camera edits."""
    existing_by_id: dict[str, dict] = {}
    if isinstance(existing_cameras, list):
        for item in existing_cameras:
            if isinstance(item, dict):
                camera_id = item.get("id")
                if isinstance(camera_id, str) and camera_id:
                    existing_by_id[camera_id] = item

    merged_cameras: list[dict] = []
    if not isinstance(incoming_cameras, list):
        return merged_cameras

    for item in incoming_cameras:
        if not isinstance(item, dict):
            continue
        camera_id = item.get("id")
        if isinstance(camera_id, str) and camera_id and camera_id in existing_by_id:
            merged = dict(existing_by_id[camera_id])
            merged.update(item)
            merged_cameras.append(merged)
        else:
            merged_cameras.append(item)

    return merged_cameras


def _sanitise_config_for_frontend(config: object) -> object:
    """Redact backend-only secrets before returning config to PPE-UI."""
    if not isinstance(config, dict):
        return config
    safe = json.loads(json.dumps(config))
    central = safe.get("centralServer")
    if isinstance(central, dict):
        central.pop("apiKey", None)
        central.pop("vercelBypassToken", None)
    return safe


def _capture_jpeg_from_rtsp(rtsp_url: str) -> Optional[bytes]:
    from .realtime_stream import _cv2_lock
    from .video_utils import flush_video_buffer
    cap = None
    try:
        with _cv2_lock:
            cap = open_video_capture(rtsp_url)
            # Flush buffered frames so we capture the current live frame,
            # not a stale keyframe the camera had queued on connection.
            flush_video_buffer(cap, max_frames=5)
            ret, frame = cap.read()
        if not ret or frame is None:
            return None
        ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            return None
        return encoded.tobytes()
    except Exception as exc:
        logger.debug(f"Deep Vision frame capture failed for {rtsp_url}: {exc}")
        return None
    finally:
        try:
            if cap is not None:
                cap.release()
        except Exception:
            pass


def _analyze_with_cloud(frame_jpeg: bytes) -> Optional[dict]:
    # Gemini/OpenRouter traffic can optionally use Mullvad VPN path.
    if not _ensure_vpn_ready_for_gemini():
        logger.warning("Skipping Gemini call: VPN is not ready")
        return None
    analyze_url = (os.getenv("EDGE_CLOUD_ANALYZE_URL") or "").strip() or "http://127.0.0.1:3001/api/analyze-image"
    try:
        resp = requests.post(
            analyze_url,
            files={"image": ("frame.jpg", frame_jpeg, "image/jpeg")},
            data={"language": "en"},
            timeout=45,
        )
        if not resp.ok:
            logger.warning(f"Deep Vision cloud call failed: HTTP {resp.status_code}")
            return None
        body = resp.json()
        if not body.get("success"):
            logger.warning(f"Deep Vision cloud returned error: {body.get('error')}")
            return None
        return body.get("data")
    except Exception as exc:
        logger.warning(f"Deep Vision cloud call error: {exc}")
        return None


def _ensure_vpn_ready_for_gemini() -> bool:
    """
    Ensure VPN path is ready before Gemini calls when VPN is enabled.

    Behavior:
    - If app config has vpn.enabled=false, do not block cloud calls.
    - If env GEMINI_REQUIRE_VPN is set to 0/false/no/off, do not block cloud calls.
    - Otherwise keep the existing wg-mullvad readiness flow.
    """
    cfg = _load_runtime_config()
    vpn_enabled = bool((cfg.get("vpn") or {}).get("enabled", True))
    require_vpn_env = (os.getenv("GEMINI_REQUIRE_VPN", "") or "").strip().lower()
    require_vpn = vpn_enabled and require_vpn_env not in {"0", "false", "no", "off"}

    if not require_vpn:
        return True

    try:
        state = subprocess.run(
            ["systemctl", "is-active", "wg-mullvad"],
            timeout=5,
            capture_output=True,
            text=True,
            check=False,
        )
        if (state.stdout or "").strip() == "active":
            # Refresh split routes (OpenRouter-only via mullvad).
            policy_script = "/usr/local/bin/wg-mullvad-policy.sh"
            if Path(policy_script).exists():
                subprocess.run(
                    [policy_script, "up"],
                    timeout=10,
                    capture_output=True,
                    check=False,
                )
                subprocess.run(
                    ["sudo", "-n", policy_script, "up"],
                    timeout=10,
                    capture_output=True,
                    check=False,
                )
            return True

        # Auto-start VPN when Gemini path is used.
        subprocess.run(
            ["systemctl", "start", "wg-mullvad"],
            timeout=20,
            capture_output=True,
            check=False,
        )
        subprocess.run(
            ["sudo", "-n", "systemctl", "start", "wg-mullvad"],
            timeout=20,
            capture_output=True,
            check=False,
        )
        verify = subprocess.run(
            ["systemctl", "is-active", "wg-mullvad"],
            timeout=5,
            capture_output=True,
            text=True,
            check=False,
        )
        is_active = (verify.stdout or "").strip() == "active"
        if is_active:
            policy_script = "/usr/local/bin/wg-mullvad-policy.sh"
            if Path(policy_script).exists():
                subprocess.run(
                    [policy_script, "up"],
                    timeout=10,
                    capture_output=True,
                    check=False,
                )
                subprocess.run(
                    ["sudo", "-n", policy_script, "up"],
                    timeout=10,
                    capture_output=True,
                    check=False,
                )
        return is_active
    except Exception as exc:
        logger.warning("Failed to ensure VPN before Gemini: %s", exc)
        return False


def _build_alarm_payload(camera_id: str, camera_name: str, result: dict) -> dict:
    """
    Build the payload forwarded to CMP and the local alarm observer.
    Passes ALL fields returned by Gemini so CMP has the full picture and can
    make its own display / severity decisions.  The `detections` array contains
    per-person bounding-box labels (no_hardhat, no_vest, fire_smoke, etc.).
    """
    payload: dict = {
        "camera_id": camera_id,
        "camera_name": camera_name,
        "overallDescription": result.get("overallDescription"),
        "overallRiskLevel": result.get("overallRiskLevel", "Low"),
        "peopleCount": result.get("peopleCount", 0) or 0,
        "missingHardhats": result.get("missingHardhats", 0) or 0,
        "missingVests": result.get("missingVests", 0) or 0,
        "constructionSafety": result.get("constructionSafety") or {},
        "fireSafety": result.get("fireSafety") or {},
        "propertySecurity": result.get("propertySecurity") or {},
    }
    # Include Gemini bounding-box detections when present so CMP can draw overlays
    # or use them in its own classification logic.
    if result.get("detections") is not None:
        payload["detections"] = result["detections"]
    return payload


async def _heartbeat_loop():
    """Send a keepalive ping to CMP for every enabled camera every 30 seconds.

    CMP online threshold: 10 minutes  (lib/camera-status.ts → ONLINE_THRESHOLD_MS)
    Heartbeat interval:   30 seconds  (this constant)
    Ratio:                20×  — up to 19 consecutive missed pings before offline

    Keep HEARTBEAT_INTERVAL_SECONDS well below the CMP threshold.
    If you change one value, update the other to preserve the ≥ 10× ratio.
    """
    HEARTBEAT_INTERVAL = 30  # seconds — CMP threshold is 10 min → ratio 20×
    logger.info("Heartbeat loop started (30 s interval → CMP keepalive, threshold 10 min)")
    while True:
        try:
            cfg = _load_runtime_config()
            if isinstance(cfg.get("centralServer"), dict):
                get_alarm_observer().set_central_server_config(cfg["centralServer"])

            rtsp_cfg = cfg.get("rtsp", {}) if isinstance(cfg, dict) else {}
            cameras = rtsp_cfg.get("cameras", [])
            enabled_cameras = [c for c in cameras if isinstance(c, dict) and c.get("enabled") and c.get("url")]

            if enabled_cameras:
                observer = get_alarm_observer()
                for cam in enabled_cameras:
                    camera_id = cam.get("id", cam.get("name", "unknown"))
                    camera_name = cam.get("name", camera_id)
                    camera_stream_url = cam.get("url", "")
                    observer.send_keepalive(camera_id, camera_name, camera_stream_url)

        except asyncio.CancelledError:
            logger.info("Heartbeat loop stopped")
            raise
        except Exception as exc:
            logger.warning(f"Heartbeat loop error: {exc}")

        await asyncio.sleep(HEARTBEAT_INTERVAL)


async def _deepvision_background_loop():
    global _deepvision_camera_index, _latest_deepvision_results
    _latest_deepvision_results = _load_deepvision_cache()
    logger.info(
        "Deep Vision background loop started (runs without PPE-UI; posts to CMP from this service when centralServer.enabled)"
    )
    while True:
        try:
            cfg = _load_runtime_config()
            # CMP / centralServer: always follow disk so headless operation picks up edits without opening the UI.
            if isinstance(cfg.get("centralServer"), dict):
                get_alarm_observer().set_central_server_config(cfg["centralServer"])
            ui_cfg = cfg.get("ui", {}) if isinstance(cfg, dict) else {}
            rtsp_cfg = cfg.get("rtsp", {}) if isinstance(cfg, dict) else {}
            deepvision_enabled = ui_cfg.get("deepVisionEnabled", True)
            interval = int(rtsp_cfg.get("geminiInterval", 5) or 5)
            interval = max(1, interval)

            if not deepvision_enabled:
                await asyncio.sleep(interval)
                continue

            cameras = rtsp_cfg.get("cameras", [])
            enabled_cameras = [c for c in cameras if isinstance(c, dict) and c.get("enabled") and c.get("url")]
            if not enabled_cameras:
                await asyncio.sleep(interval)
                continue

            camera = enabled_cameras[_deepvision_camera_index % len(enabled_cameras)]
            _deepvision_camera_index += 1
            camera_id = camera.get("id", f"camera{_deepvision_camera_index}")
            camera_name = camera.get("name", camera_id)
            rtsp_url = camera.get("url", "")

            frame_jpeg = await asyncio.to_thread(_capture_jpeg_from_rtsp, rtsp_url)
            if not frame_jpeg:
                await asyncio.sleep(1)
                continue

            analysis_result = await asyncio.to_thread(_analyze_with_cloud, frame_jpeg)
            if analysis_result:
                payload = _build_alarm_payload(camera_id, camera_name, analysis_result)
                _latest_deepvision_results[camera_id] = {
                    "camera_id": camera_id,
                    "camera_name": camera_name,
                    "updated_at": time.time(),
                    "analysis": {
                        "overallDescription": payload.get("overallDescription", ""),
                        "overallRiskLevel": payload.get("overallRiskLevel", "Low"),
                        "peopleCount": payload.get("peopleCount", 0),
                        "missingHardhats": payload.get("missingHardhats", 0),
                        "missingVests": payload.get("missingVests", 0),
                        "constructionSafety": payload.get("constructionSafety") or {"summary": "", "issues": [], "recommendations": []},
                        "fireSafety": payload.get("fireSafety") or {"summary": "", "issues": [], "recommendations": []},
                        "propertySecurity": payload.get("propertySecurity") or {"summary": "", "issues": [], "recommendations": []},
                    },
                }
                _save_deepvision_cache()
                observer = get_alarm_observer()
                await asyncio.to_thread(
                    observer.process_analysis_result,
                    payload,
                    camera_id,
                    camera_name,
                    frame_jpeg,  # forward JPEG to CMP so images appear in Edge Devices / Incidents
                    rtsp_url,
                )

            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.info("Deep Vision background loop stopped")
            raise
        except Exception as exc:
            logger.error(f"Deep Vision background loop error: {exc}", exc_info=True)
            await asyncio.sleep(2)

# Load model at startup
@app.on_event("startup")
async def startup_event():
    load_model()
    try:
        # Start configured network services every backend startup.
        _ensure_network_services_on_startup()
        central_server_cfg = {}
        # CMP webhook: centralServer.{enabled,url,apiKey} → posts JSON built by app/cmp_webhook.py
        # (aligned with CCTVCMP-linux/lib/validations/webhook.ts + CCTVCMP-linux/app/api/webhook/edge-report/route.ts).
        # Local CMP from this repo: npm run dev in CCTVCMP-linux → http://localhost:3002/api/webhook/edge-report
        try:
            cfg_path = _root_app_config_path()
            if cfg_path.exists():
                with open(cfg_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    if isinstance(cfg.get("centralServer"), dict):
                        central_server_cfg = cfg["centralServer"]
        except Exception as cfg_exc:
            logger.warning(f"Could not load centralServer config: {cfg_exc}")

        observer = get_alarm_observer(central_server_config=central_server_cfg)
        observer.start_monitoring()
        logger.info("Alarm observer started successfully")
        logger.info(
            "Headless safety pipeline: RTSP Deep Vision + CMP webhook run inside this API process; "
            "PPE-UI is optional (viewing/settings only). Ensure edge-cloud is up for Gemini (port 3001) "
            "unless EDGE_CLOUD_ANALYZE_URL points elsewhere."
        )
        global _deepvision_task, _heartbeat_task
        if _deepvision_task is None or _deepvision_task.done():
            _deepvision_task = asyncio.create_task(_deepvision_background_loop())
        if _heartbeat_task is None or _heartbeat_task.done():
            _heartbeat_task = asyncio.create_task(_heartbeat_loop())
        # Ensure edge-cloud is running regardless of VPN state
        _ensure_edge_cloud_running()
    except Exception as exc:
        logger.error(f"Failed to start alarm observer: {exc}", exc_info=True)



@app.on_event("shutdown")
async def shutdown_event():
    global _deepvision_task, _heartbeat_task
    for task in (_deepvision_task, _heartbeat_task):
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "name": API_TITLE,
        "version": API_VERSION,
        "model": MODEL_PATH,
        "device": get_actual_device(),
        "device_requested": DEVICE,
        "endpoints": {
            "image": "POST /detect/image",
            "video": "POST /detect/video",
            "video-frames": "POST /detect/video-frames",
            "extract-frame": "POST /extract-frame",
            "webcam": "GET /detect/stream/webcam",
            "rtsp": "GET /detect/stream/rtsp",
            "videos-list": "GET /videos/list",
            "video-file": "POST /detect/video-file",
            "alarms": {
                "process-analysis": "POST /alarms/process-analysis",
                "active": "GET /alarms/active",
                "history": "GET /alarms/history",
                "acknowledge": "POST /alarms/acknowledge",
                "resolve": "POST /alarms/resolve/{alarm_id}",
                "test": "POST /alarms/test",
                "status": "GET /alarms/status"
            }
        }
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "model_loaded": True}


@app.get("/api/deepvision/latest")
async def get_deepvision_latest():
    """
    Return latest backend Deep Vision results per camera.
    This is the ground-truth pipeline used for CMP forwarding.
    """
    results = sorted(
        list(_latest_deepvision_results.values()),
        key=lambda item: item.get("updated_at", 0),
        reverse=True,
    )
    return {"results": results}


@app.post("/detect/image", response_model=ImageDetections)
async def detect_image_endpoint(file: UploadFile = File(...)):
    """
    Detect objects in an uploaded image.
    
    Accepts: jpg, png, jpeg
    Returns: ImageDetections with bounding boxes and class predictions
    """
    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        logger.warning(f"Invalid image file type: {file.content_type} from {file.filename}")
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {file.content_type}. Expected image file."
        )
    
    try:
        logger.info(f"Processing image: {file.filename}, type: {file.content_type}")
        # Read file bytes
        file_bytes = await file.read()
        
        # Decode image using OpenCV
        nparr = np.frombuffer(file_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(
                status_code=400,
                detail="Failed to decode image. Please ensure the file is a valid image."
            )
        
        # Get image dimensions
        height, width = img.shape[:2]
        
        # Run detection
        start_time = time.time()
        detections = detect_image(img)
        inference_ms = (time.time() - start_time) * 1000
        
        # Build response
        result = ImageDetections(
            image_width=width,
            image_height=height,
            model_name=MODEL_PATH,
            device=get_actual_device(),
            inference_ms=inference_ms,
            detections=detections
        )
        
        logger.info(f"Image detection completed: {len(detections)} objects found in {inference_ms:.2f}ms")
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing image {file.filename}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error processing image: {str(e)}"
        )


@app.post("/detect/video", response_model=VideoDetections)
async def detect_video_endpoint(
    file: UploadFile = File(...),
    sample_every: int = Query(default=FRAME_SAMPLE_EVERY, ge=1, le=100, description="Sample every Nth frame (max 100)")
):
    """
    Detect objects in an uploaded video file.
    
    Accepts: mp4, avi, mov, etc.
    Returns: VideoDetections with frame-by-frame detection results
    """
    # Validate file type
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {file.content_type}. Expected video file."
        )
    
    # Save uploaded file to temporary location
    temp_file = None
    try:
        # Create temporary file
        suffix = Path(file.filename).suffix if file.filename else ".mp4"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_file = tmp.name
            content = await file.read()
            tmp.write(content)
        
        # Open video capture
        cap = open_video_capture(temp_file)
        
        # Get video properties
        width, height, fps, total_frames = get_video_properties(cap)
        
        # Process frames
        frame_detections_list = []
        total_frames_sampled = 0
        
        for frame_index, timestamp_sec, frame in iterate_frames(cap, sample_every=sample_every):
            # Run detection on frame
            detections = detect_frame(frame)
            
            frame_detection = FrameDetections(
                frame_index=frame_index,
                timestamp_sec=timestamp_sec,
                detections=detections
            )
            frame_detections_list.append(frame_detection)
            total_frames_sampled += 1
        
        # Build response
        result = VideoDetections(
            video_fps=fps,
            frame_width=width,
            frame_height=height,
            total_frames=total_frames,
            total_frames_sampled=total_frames_sampled,
            frames=frame_detections_list
        )
        
        return result
        
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error processing video: {str(e)}"
        )
    finally:
        # Clean up temporary file
        if temp_file and Path(temp_file).exists():
            Path(temp_file).unlink()


@app.post("/detect/video-frames", response_model=VideoDetections)
async def detect_video_frames_endpoint(
    file: UploadFile = File(...),
    sample_every: int = Form(default=FRAME_SAMPLE_EVERY, ge=1),
    max_frames: Optional[int] = Form(default=None, ge=1)
):
    """
    Process video and return frame-by-frame detections with base64 encoded frames.
    Designed for frontend video player with synchronized detections.
    """
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {file.content_type}. Expected video file."
        )
    
    temp_file = None
    try:
        suffix = Path(file.filename).suffix if file.filename else ".mp4"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_file = tmp.name
            content = await file.read()
            tmp.write(content)
        
        cap = open_video_capture(temp_file)
        width, height, fps, total_frames = get_video_properties(cap)
        
        frame_detections_list = []
        total_frames_sampled = 0
        
        for frame_index, timestamp_sec, frame in iterate_frames(cap, sample_every=sample_every):
            if max_frames and total_frames_sampled >= max_frames:
                break
            
            # Run detection on frame
            detections = detect_frame(frame)
            
            # Encode frame to base64 (for thumbnail/verification)
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            
            frame_detection = FrameDetections(
                frame_index=frame_index,
                timestamp_sec=timestamp_sec,
                detections=detections,
                frame_data=frame_base64
            )
            frame_detections_list.append(frame_detection)
            total_frames_sampled += 1
        
        cap.release()
        
        result = VideoDetections(
            video_fps=fps,
            frame_width=width,
            frame_height=height,
            total_frames=total_frames,
            total_frames_sampled=total_frames_sampled,
            frames=frame_detections_list
        )
        
        return result
        
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error processing video: {str(e)}"
        )
    finally:
        if temp_file and Path(temp_file).exists():
            Path(temp_file).unlink()


@app.post("/extract-frame")
async def extract_frame_endpoint(
    file: UploadFile = File(...),
    frame_number: int = Form(..., ge=0)
):
    """
    Extract a specific frame from video for Gemini analysis.
    Returns base64 encoded JPEG image.
    """
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {file.content_type}. Expected video file."
        )
    
    temp_file = None
    try:
        suffix = Path(file.filename).suffix if file.filename else ".mp4"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_file = tmp.name
            content = await file.read()
            tmp.write(content)
        
        cap = open_video_capture(temp_file)
        
        # Seek to frame
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        
        if not ret:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to extract frame {frame_number}"
            )
        
        # Encode to JPEG
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
        frame_base64 = base64.b64encode(buffer).decode('utf-8')
        
        cap.release()
        
        return JSONResponse({
            "frame_number": frame_number,
            "image_data": f"data:image/jpeg;base64,{frame_base64}"
        })
        
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error extracting frame: {str(e)}"
        )
    finally:
        if temp_file and Path(temp_file).exists():
            Path(temp_file).unlink()


@app.get("/detect/stream/webcam", response_model=VideoDetections)
async def detect_webcam_stream(
    cam_index: int = Query(default=0, ge=0, description="Webcam index (0, 1, 2, ...)"),
    max_frames: int = Query(default=100, ge=1, description="Maximum number of frames to process"),
    sample_every: int = Query(default=1, ge=1, description="Sample every Nth frame")
):
    """
    Detect objects from a webcam stream.
    
    Returns: VideoDetections with frame-by-frame detection results
    """
    try:
        # Open webcam
        cap = open_video_capture(cam_index)
        
        # Get video properties
        width, height, fps, _ = get_video_properties(cap)
        
        # Process frames
        frame_detections_list = []
        total_frames_sampled = 0
        
        for frame_index, timestamp_sec, frame in iterate_frames(
            cap, 
            sample_every=sample_every, 
            max_frames=max_frames
        ):
            # Run detection on frame
            detections = detect_frame(frame)
            
            frame_detection = FrameDetections(
                frame_index=frame_index,
                timestamp_sec=timestamp_sec,
                detections=detections
            )
            frame_detections_list.append(frame_detection)
            total_frames_sampled += 1
        
        if total_frames_sampled == 0:
            raise HTTPException(
                status_code=400,
                detail=f"No frames read from webcam {cam_index}. Check if the camera is connected and accessible."
            )
        
        # Build response
        result = VideoDetections(
            video_fps=fps,
            frame_width=width,
            frame_height=height,
            total_frames=total_frames_sampled,  # For webcam, total = sampled
            total_frames_sampled=total_frames_sampled,
            frames=frame_detections_list
        )
        
        return result
        
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error processing webcam stream: {str(e)}"
        )


def _process_rtsp_stream(url: str, max_frames: int, sample_every: int) -> VideoDetections:
    """Process RTSP stream and return detection results. Raises HTTPException on error."""
    print(f"[RTSP] Attempting to open: {url}")
    print(f"[RTSP] Parameters: max_frames={max_frames}, sample_every={sample_every}")
    
    try:
        cap = open_video_capture(url)
        print(f"[RTSP] Successfully opened video capture")
    except ValueError as e:
        print(f"[RTSP] Failed to open: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    
    width, height, fps, _ = get_video_properties(cap)
    print(f"[RTSP] Video properties: {width}x{height} @ {fps} fps")
    
    frame_detections_list = []
    total_frames_sampled = 0

    for frame_index, timestamp_sec, frame in iterate_frames(
        cap, sample_every=sample_every, max_frames=max_frames
    ):
        detections = detect_frame(frame)
        frame_detections_list.append(FrameDetections(
            frame_index=frame_index,
            timestamp_sec=timestamp_sec,
            detections=detections
        ))
        total_frames_sampled += 1
        if total_frames_sampled % 10 == 0:
            print(f"[RTSP] Processed {total_frames_sampled} frames...")

    print(f"[RTSP] Finished: {total_frames_sampled} frames processed")

    if total_frames_sampled == 0:
        raise HTTPException(
            status_code=400,
            detail=f"No frames read from RTSP stream: {url}. Check the URL, credentials, and network."
        )

    return VideoDetections(
        video_fps=fps,
        frame_width=width,
        frame_height=height,
        total_frames=total_frames_sampled,
        total_frames_sampled=total_frames_sampled,
        frames=frame_detections_list
    )


@app.get("/detect/stream/rtsp", response_model=VideoDetections)
async def detect_rtsp_stream_get(
    url: str = Query(..., description="RTSP stream URL (e.g., rtsp://user:pass@ip:port/stream)"),
    max_frames: int = Query(default=100, ge=1, description="Maximum number of frames to process"),
    sample_every: int = Query(default=1, ge=1, description="Sample every Nth frame")
):
    """Detect objects from an RTSP stream (GET). Use POST to avoid URL encoding issues."""
    try:
        return _process_rtsp_stream(url, max_frames, sample_every)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing RTSP stream: {str(e)}")


@app.post("/detect/stream/rtsp", response_model=VideoDetections)
async def detect_rtsp_stream_post(body: RTSPStreamRequest):
    """
    Detect objects from an RTSP stream (POST).
    Sending the URL in the request body avoids query-string encoding issues.
    """
    try:
        return _process_rtsp_stream(body.url, body.max_frames, body.sample_every)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing RTSP stream: {str(e)}")


@app.get("/videos/list")
async def list_videos():
    """
    List all available video files in the configured video folder.
    
    Returns: List of video files with metadata
    """
    try:
        video_path = Path(VIDEO_FOLDER)
        
        # If relative path, make it relative to the python directory
        if not video_path.is_absolute():
            python_dir = Path(__file__).parent.parent
            video_path = python_dir / video_path
        
        if not video_path.exists():
            return JSONResponse({
                "videos": [],
                "folder": str(video_path),
                "error": "Video folder does not exist"
            })
        
        # Supported video extensions
        video_extensions = {'.mp4', '.avi', '.mov', '.webm', '.mkv', '.flv', '.wmv', '.m4v'}
        
        videos = []
        for file_path in video_path.iterdir():
            if file_path.is_file() and file_path.suffix.lower() in video_extensions:
                # Get file size
                file_size = file_path.stat().st_size
                
                videos.append({
                    "filename": file_path.name,
                    "path": str(file_path),
                    "size": file_size,
                    "size_mb": round(file_size / (1024 * 1024), 2),
                })
        
        # Sort by filename
        videos.sort(key=lambda x: x["filename"])
        
        return JSONResponse({
            "videos": videos,
            "folder": str(video_path),
            "count": len(videos)
        })
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error listing videos: {str(e)}"
        )


@app.post("/detect/video-file", response_model=VideoDetections)
async def detect_video_file_endpoint(
    file_path: str = Form(..., description="Path to video file (relative to video folder or absolute)"),
    sample_every: int = Form(default=FRAME_SAMPLE_EVERY, ge=1),
    max_frames: Optional[int] = Form(default=None, ge=1)
):
    """
    Process video from file path and return frame-by-frame detections with base64 encoded frames.
    Designed for frontend video player with synchronized detections.
    
    Supports streaming formats: MP4 (H.264), AVI, MOV, WebM
    """
    try:
        # Resolve file path
        video_file = Path(file_path)
        
        # If relative path, check if it's in the video folder
        if not video_file.is_absolute():
            video_folder = Path(VIDEO_FOLDER)
            if not video_folder.is_absolute():
                python_dir = Path(__file__).parent.parent
                video_folder = python_dir / video_folder
            
            video_file = video_folder / video_file.name
        
        # Security: Ensure file is within video folder
        video_folder = Path(VIDEO_FOLDER)
        if not video_folder.is_absolute():
            python_dir = Path(__file__).parent.parent
            video_folder = python_dir / video_folder
        
        try:
            video_file = video_file.resolve()
            video_folder = video_folder.resolve()
            
            # Check if file is within video folder (security)
            if not str(video_file).startswith(str(video_folder)):
                raise HTTPException(
                    status_code=403,
                    detail="Access denied: Video file must be in the configured video folder"
                )
        except (ValueError, OSError):
            raise HTTPException(
                status_code=400,
                detail="Invalid file path"
            )
        
        if not video_file.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Video file not found: {video_file}"
            )
        
        # Open video directly from file path (no upload needed!)
        cap = open_video_capture(str(video_file))
        width, height, fps, total_frames = get_video_properties(cap)
        
        frame_detections_list = []
        total_frames_sampled = 0
        
        for frame_index, timestamp_sec, frame in iterate_frames(cap, sample_every=sample_every):
            if max_frames and total_frames_sampled >= max_frames:
                break
            
            # Run detection on frame
            detections = detect_frame(frame)
            
            # Encode frame to base64 (for thumbnail/verification)
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            
            frame_detection = FrameDetections(
                frame_index=frame_index,
                timestamp_sec=timestamp_sec,
                detections=detections,
                frame_data=frame_base64
            )
            frame_detections_list.append(frame_detection)
            total_frames_sampled += 1
        
        cap.release()
        
        result = VideoDetections(
            video_fps=fps,
            frame_width=width,
            frame_height=height,
            total_frames=total_frames,
            total_frames_sampled=total_frames_sampled,
            frames=frame_detections_list
        )
        
        return result
        
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error processing video file: {str(e)}"
        )


# --- app.config.json sync (for ppe-ui Settings) ---
def _app_config_paths():
    """Root config is authoritative; others are synced mirrors."""
    root = Path(__file__).resolve().parent.parent.parent
    return (
        _root_app_config_path(),
        root / "python" / "app.config.json",
        root / "ppe-ui" / "public" / "app.config.json",
        root / "ppe-ui" / "build" / "app.config.json",
    )


def _apply_vpn(enabled: bool) -> None:
    """Apply VPN on/off in real time (systemctl start/stop wg-mullvad)."""
    try:
        if enabled:
            subprocess.run(
                ["sudo", "-n", "systemctl", "start", "wg-mullvad"],
                timeout=30,
                capture_output=True,
                check=False,
            )
        else:
            subprocess.run(
                ["sudo", "-n", "systemctl", "stop", "wg-mullvad"],
                timeout=15,
                capture_output=True,
                check=False,
            )
        # Ensure edge-cloud is always running regardless of VPN state
        _ensure_edge_cloud_running()
    except Exception as e:
        logger.warning("VPN apply failed: %s", e)


def _ensure_edge_cloud_running() -> None:
    """Ensure edge-cloud.service is running (start if stopped)."""
    try:
        subprocess.run(
            ["sudo", "-n", "systemctl", "start", "edge-cloud"],
            timeout=15,
            capture_output=True,
            check=False,
        )
    except Exception as e:
        logger.warning("edge-cloud start failed: %s", e)


def _ensure_service_started(unit: str) -> None:
    """Best-effort start for a systemd unit (plain + sudo fallback)."""
    try:
        subprocess.run(
            ["systemctl", "start", unit],
            timeout=20,
            capture_output=True,
            check=False,
        )
        subprocess.run(
            ["sudo", "-n", "systemctl", "start", unit],
            timeout=20,
            capture_output=True,
            check=False,
        )
    except Exception as e:
        logger.warning("service start failed (%s): %s", unit, e)


def _ensure_network_services_on_startup() -> None:
    """
    Ensure configured network services are started every backend startup.

    - VPN: start wg-mullvad when config says vpn.enabled=true
    - Tailscale: start tailscaled when config says tailscale.enabled=true
    """
    cfg = _load_runtime_config()
    vpn_enabled = bool((cfg.get("vpn") or {}).get("enabled", True))
    tailscale_enabled = bool((cfg.get("tailscale") or {}).get("enabled", False))

    if vpn_enabled:
        _ensure_service_started("wg-mullvad")
    if tailscale_enabled:
        _ensure_service_started("tailscaled")


def _apply_tailscale(enabled: bool, mode: str = "inbound") -> None:
    """Apply Tailscale on/off and operating mode in real time from PPE-UI."""
    try:
        if enabled:
            # Ensure daemon is running before bringing tunnel up.
            subprocess.run(
                ["sudo", "-n", "systemctl", "start", "tailscaled"],
                timeout=15,
                capture_output=True,
                check=False,
            )
            tailscale_up_cmd = [
                "sudo",
                "-n",
                "tailscale",
                "up",
                "--accept-dns=false",
                "--netfilter-mode=off",
                "--shields-up=false",
                "--ssh=true",
            ]
            subprocess.run(
                tailscale_up_cmd,
                timeout=30,
                capture_output=True,
                check=False,
            )
        else:
            subprocess.run(
                ["sudo", "-n", "tailscale", "down"],
                timeout=15,
                capture_output=True,
                check=False,
            )
            # Fully stop daemon so UI status reflects "off".
            subprocess.run(
                ["sudo", "-n", "systemctl", "stop", "tailscaled"],
                timeout=15,
                capture_output=True,
                check=False,
            )
    except Exception as e:
        logger.warning("Tailscale apply failed: %s", e)


# Services we report status for in the PPE-UI Settings modal.
# Support both the older install names (`edge-python`, `edge-ui`, `edge-cloud`)
# and the current local-workspace names (`edge-python-local`, etc.).
#
# The UI should show the service as Running when ANY matching unit is active.
_CONFIG_SERVICES = [
    (["edge-python-local", "edge-python"], "Python backend"),
    (["edge-ui-local", "edge-ui"], "PPE UI"),
    (["edge-cloud-local", "edge-cloud"], "Cloud Vision API"),
    (["wg-mullvad"], "VPN (Mullvad)"),
    (["tailscaled"], "Tailscale"),
]


def _get_service_status(units: list[str]) -> str:
    """Return merged systemd state across one or more candidate units.

    Precedence:
      active > failed > activating > reloading > inactive > unknown

    This lets the PPE-UI show a correct status even when the local workspace
    uses `*-local` unit names but older installs use the legacy names.
    """
    states: list[str] = []
    for unit in units:
        try:
            r = subprocess.run(
                ["systemctl", "is-active", unit],
                timeout=5,
                capture_output=True,
                text=True,
                check=False,
            )
            states.append((r.stdout or "").strip() or "inactive")
        except Exception:
            states.append("unknown")

    for preferred in ["active", "failed", "activating", "reloading", "inactive"]:
        if preferred in states:
            return preferred
    return states[0] if states else "unknown"


@app.get("/api/services/status")
async def get_services_status():
    """Return status of all config-related systemd services for the PPE-UI."""
    result = {}
    for units, label in _CONFIG_SERVICES:
        key = units[0]
        result[key] = {
            "label": label,
            "status": _get_service_status(units),
        }
    return result


@app.get("/api/config")
async def get_app_config():
    """Return the authoritative root app.config.json."""
    try:
        path_root = _root_app_config_path()
        if not path_root.exists():
            raise HTTPException(status_code=404, detail="app.config.json not found")
        with open(path_root, "r", encoding="utf-8") as f:
            return _sanitise_config_for_frontend(json.load(f))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to read app.config.json: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.options("/api/config")
async def options_app_config():
    """Handle CORS preflight for config updates."""
    response = JSONResponse(
        content={},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Expose-Headers": "*",
            "Access-Control-Max-Age": "3600",
        }
    )
    return response


@app.put("/api/config")
async def update_app_config(request: Request):
    """
    Update app.config.json from ppe-ui Settings.
        Body supports:
        {
          "rtsp": { "cameras": [...], "fpsLimit", "geminiInterval", "autoStart" },
          "centralServer": { "enabled", "url", "apiKey" },
          "vpn": { "enabled" },
          "tailscale": { "enabled": true|false, "mode": "inbound"|"outbound" },
          "network": { ... }
        }
    Merges into existing config and writes to root + mirrors. Applies Tailscale on/off when tailscale is present.
    """
    try:
        body = await request.json()
        path_root, *_ = _app_config_paths()
        config = {}
        if path_root.exists():
            with open(path_root, "r", encoding="utf-8") as f:
                config = json.load(f)

        rtsp = body.get("rtsp")
        if rtsp is not None:
            if "cameras" not in rtsp:
                raise HTTPException(status_code=400, detail="rtsp.cameras is required when rtsp is provided")
            if "rtsp" not in config:
                config["rtsp"] = {}
            config["rtsp"]["cameras"] = _merge_rtsp_cameras(config["rtsp"].get("cameras", []), rtsp["cameras"])
            if "fpsLimit" in rtsp:
                config["rtsp"]["fpsLimit"] = rtsp["fpsLimit"]
            if "geminiInterval" in rtsp:
                config["rtsp"]["geminiInterval"] = rtsp["geminiInterval"]
            if "autoStart" in rtsp:
                config["rtsp"]["autoStart"] = rtsp["autoStart"]

        if "centralServer" in body:
            config["centralServer"] = _merge_config_section(config.get("centralServer"), body["centralServer"])
        if "vpn" in body:
            config["vpn"] = _merge_config_section(config.get("vpn"), body.get("vpn") or {})
            if isinstance(config["vpn"], dict):
                config["vpn"]["enabled"] = bool(config["vpn"].get("enabled", True))
        if "tailscale" in body:
            config["tailscale"] = _merge_config_section(config.get("tailscale"), body["tailscale"])
        if "network" in body:
            config["network"] = _merge_config_section(config.get("network"), body["network"])
        if "ui" in body:
            if not isinstance(config.get("ui"), dict):
                config["ui"] = {}
            if isinstance(body["ui"], dict):
                config["ui"].update(body["ui"])
            else:
                config["ui"] = body["ui"]

        if rtsp is None and "centralServer" not in body and "vpn" not in body and "tailscale" not in body and "network" not in body and "ui" not in body:
            raise HTTPException(
                status_code=400,
                detail="Request must include at least one of: rtsp, centralServer, vpn, tailscale, network, ui",
            )

        out = json.dumps(config, indent=2, ensure_ascii=False)
        path_root, *mirror_paths = _app_config_paths()

        # Always write root app.config.json first (authoritative source of truth).
        path_root.parent.mkdir(parents=True, exist_ok=True)
        with open(path_root, "w", encoding="utf-8") as f:
            f.write(out)

        # Mirrors are best-effort and should not block root truth updates.
        for p in mirror_paths:
            try:
                p.parent.mkdir(parents=True, exist_ok=True)
                with open(p, "w", encoding="utf-8") as f:
                    f.write(out)
            except Exception as mirror_exc:
                logger.warning("Mirror config sync failed for %s: %s", p, mirror_exc)

        logger.info("Root app.config.json updated from ppe-ui Settings")

        try:
            get_alarm_observer().refresh_central_server_from_app_config_json()
        except Exception as obs_exc:
            logger.warning("Could not refresh observer CMP config after save: %s", obs_exc)

        # Apply VPN on/off in real time if present
        if "vpn" in body:
            _apply_vpn(config.get("vpn", {}).get("enabled", True))
        # Apply Tailscale on/off/mode if present
        if "tailscale" in body:
            _apply_tailscale(
                config.get("tailscale", {}).get("enabled", True),
                config.get("tailscale", {}).get("mode", "inbound"),
            )

        return {"success": True, "message": "Config saved to app.config.json"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update app.config.json: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.options("/videos/{filename:path}")
async def serve_video_options(filename: str):
    """Handle CORS preflight requests for video serving."""
    response = JSONResponse(
        content={},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS, HEAD",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Expose-Headers": "*",
            "Access-Control-Max-Age": "3600",
        }
    )
    # Ensure headers are set
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS, HEAD"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Expose-Headers"] = "*"
    return response


@app.get("/videos/{filename:path}")
async def serve_video(filename: str):
    """
    Serve video files from the video folder via HTTP.
    This allows the browser to play videos from the server folder.
    """
    try:
        print(f"🎥 Video request: filename={filename}")
        video_path = Path(VIDEO_FOLDER)
        
        # If relative path, make it relative to the python directory
        if not video_path.is_absolute():
            python_dir = Path(__file__).parent.parent
            video_path = python_dir / video_path
        
        print(f"🎥 Video folder: {video_path}")
        
        # Security: Only serve files from the video folder
        video_file = video_path / filename
        print(f"🎥 Video file path: {video_file}")
        
        # Ensure file is within video folder (prevent directory traversal)
        try:
            video_file = video_file.resolve()
            video_path = video_path.resolve()
            
            if not str(video_file).startswith(str(video_path)):
                raise HTTPException(
                    status_code=403,
                    detail="Access denied"
                )
        except (ValueError, OSError):
            raise HTTPException(
                status_code=400,
                detail="Invalid file path"
            )
        
        if not video_file.exists() or not video_file.is_file():
            print(f"❌ Video file not found: {video_file}")
            raise HTTPException(
                status_code=404,
                detail=f"Video file not found: {filename}"
            )
        
        print(f"✅ Serving video: {video_file} (size: {video_file.stat().st_size} bytes)")
        
        # Determine content type based on extension
        content_type_map = {
            '.mp4': 'video/mp4',
            '.avi': 'video/x-msvideo',
            '.mov': 'video/quicktime',
            '.webm': 'video/webm',
            '.mkv': 'video/x-matroska',
            '.flv': 'video/x-flv',
            '.wmv': 'video/x-ms-wmv',
            '.m4v': 'video/x-m4v',
        }
        
        content_type = content_type_map.get(video_file.suffix.lower(), 'video/mp4')
        
        # Create FileResponse with CORS headers
        response = FileResponse(
            path=str(video_file),
            media_type=content_type,
            filename=filename,
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "public, max-age=3600",
            }
        )
        
        # Explicitly add CORS headers to the response
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS, HEAD"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Expose-Headers"] = "*"
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error serving video: {str(e)}"
        )


@app.websocket("/ws/rtsp/stream")
async def websocket_rtsp_stream(websocket: WebSocket):
    """
    WebSocket endpoint for real-time RTSP streaming with detection.
    
    Client should send: {"rtsp_url": "rtsp://...", "fps_limit": 15}
    Server sends: {"type": "frame", "frame_data": "base64...", "detections": [...]}
    """
    await websocket.accept()
    
    try:
        # Receive RTSP URL from client
        data = await websocket.receive_json()
        rtsp_url = data.get("rtsp_url")
        fps_limit = data.get("fps_limit", 15)
        
        if not rtsp_url:
            await websocket.send_json({"type": "error", "message": "rtsp_url is required"})
            await websocket.close()
            return
        
        # Start streaming
        await stream_rtsp_realtime(websocket, rtsp_url, fps_limit)
        
    except WebSocketDisconnect:
        print("[WS] Client disconnected")
    except Exception as e:
        print(f"[WS] Error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass
    finally:
        try:
            await websocket.close()
        except:
            pass


@app.post("/api/scan-cameras")
async def scan_cameras_endpoint(
    network_prefix: str = Query("192.168.1", description="Network prefix (e.g., 192.168.1)"),
    username: str = Query("admin", description="RTSP username"),
    password: str = Query("123456", description="RTSP password")
):
    """
    Scan network for IP cameras and return discovered cameras.
    
    This endpoint scans the specified network for cameras with open RTSP ports
    and tests various RTSP paths to find working cameras.
    
    Returns:
        List of discovered cameras with their connection details
    """
    try:
        from .camera_scanner import scan_cameras
        
        print(f"[API] Starting camera scan on {network_prefix}.0/24")
        cameras = await scan_cameras(network_prefix, username, password)
        
        return {
            "success": True,
            "count": len(cameras),
            "cameras": cameras,
            "message": f"Found {len(cameras)} camera(s)"
        }
        
    except Exception as e:
        print(f"[API] Camera scan error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Camera scan failed: {str(e)}"
        )

