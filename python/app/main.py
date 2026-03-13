"""FastAPI application with YOLOv8 detection endpoints."""

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

# Configure CORS origins from environment variable or use defaults
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://localhost:3001"
).split(",")

# Add CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
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
_deepvision_camera_index: int = 0
_latest_deepvision_results: dict[str, dict] = {}


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


def _capture_jpeg_from_rtsp(rtsp_url: str) -> Optional[bytes]:
    cap = None
    try:
        cap = open_video_capture(rtsp_url)
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
    try:
        resp = requests.post(
            "http://127.0.0.1:3001/api/analyze-image",
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


def _build_alarm_payload(camera_id: str, camera_name: str, result: dict) -> dict:
    """
    Keep backend CMP payload 1:1 with previous PPE-UI forwarding shape.
    """
    return {
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


async def _deepvision_background_loop():
    global _deepvision_camera_index
    logger.info("Deep Vision background loop started")
    while True:
        try:
            cfg = _load_runtime_config()
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
                observer = get_alarm_observer()
                await asyncio.to_thread(observer.process_analysis_result, payload, camera_id, camera_name)

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
    load_model()  # logs a warning and returns None on RK3576 (stub)
    try:
        central_server_cfg = {}
        # Load central server webhook settings from app.config.json for alarm observer forwarding.
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
        global _deepvision_task
        if _deepvision_task is None or _deepvision_task.done():
            _deepvision_task = asyncio.create_task(_deepvision_background_loop())
    except Exception as exc:
        logger.error(f"Failed to start alarm observer: {exc}", exc_info=True)



@app.on_event("shutdown")
async def shutdown_event():
    global _deepvision_task
    if _deepvision_task and not _deepvision_task.done():
        _deepvision_task.cancel()
        try:
            await _deepvision_task
        except asyncio.CancelledError:
            pass


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "name": API_TITLE,
        "version": API_VERSION,
        "model": MODEL_PATH,
        "device": "rk3576",
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


@app.get("/api/config")
async def get_app_config():
    """Return the authoritative root app.config.json."""
    try:
        path_root = _root_app_config_path()
        if not path_root.exists():
            raise HTTPException(status_code=404, detail="app.config.json not found")
        with open(path_root, "r", encoding="utf-8") as f:
            return json.load(f)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to read app.config.json: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/config")
async def update_app_config(request: Request):
    """
    Update app.config.json from ppe-ui Settings.
        Body supports:
        {
          "rtsp": { "cameras": [...], "fpsLimit", "geminiInterval", "autoStart" },
          "centralServer": { "enabled", "url", "apiKey" },
          "vpn": { "enabled", "interface", "provider" },
          "network": { ... }
        }
    Merges into existing config and writes to all config copies.
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
            config["rtsp"]["cameras"] = rtsp["cameras"]
            if "fpsLimit" in rtsp:
                config["rtsp"]["fpsLimit"] = rtsp["fpsLimit"]
            if "geminiInterval" in rtsp:
                config["rtsp"]["geminiInterval"] = rtsp["geminiInterval"]
            if "autoStart" in rtsp:
                config["rtsp"]["autoStart"] = rtsp["autoStart"]

        if "centralServer" in body:
            config["centralServer"] = body["centralServer"]
        if "vpn" in body:
            config["vpn"] = body["vpn"]
        if "network" in body:
            config["network"] = body["network"]
        if "ui" in body:
            if not isinstance(config.get("ui"), dict):
                config["ui"] = {}
            if isinstance(body["ui"], dict):
                config["ui"].update(body["ui"])
            else:
                config["ui"] = body["ui"]

        if rtsp is None and "centralServer" not in body and "vpn" not in body and "network" not in body and "ui" not in body:
            raise HTTPException(
                status_code=400,
                detail="Request must include at least one of: rtsp, centralServer, vpn, network, ui",
            )

        out = json.dumps(config, indent=2, ensure_ascii=False)
        for p in _app_config_paths():
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(out)
        logger.info("app.config.json updated from ppe-ui Settings")
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

