"""
Alarm API Routes
FastAPI routes for alarm management and monitoring.
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging

from .alarm_observer import get_alarm_observer, AlarmState, RiskLevel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alarms", tags=["alarms"])


class AnalysisResultInput(BaseModel):
    """Input model for analysis result"""
    camera_id: str
    camera_name: Optional[str] = None
    overallDescription: Optional[str] = None
    overallRiskLevel: str
    peopleCount: int = 0
    missingHardhats: int = 0
    missingVests: int = 0
    confidence: float = 0.8
    constructionSafety: Optional[Dict[str, Any]] = None
    fireSafety: Optional[Dict[str, Any]] = None
    propertySecurity: Optional[Dict[str, Any]] = None


class AlarmAcknowledgeRequest(BaseModel):
    """Request model for acknowledging alarm"""
    alarm_id: str
    acknowledged_by: Optional[str] = None


class AlarmResponse(BaseModel):
    """Response model for alarm"""
    alarm_id: str
    camera_id: str
    risk_level: str
    risk_score: float
    state: str
    triggered_at: str
    acknowledged_at: Optional[str] = None
    resolved_at: Optional[str] = None
    actions_taken: List[str]
    escalation_level: int


@router.post("/process-analysis")
async def process_analysis_result(analysis: AnalysisResultInput):
    """
    Optional hook: process a Deep Vision–shaped payload and forward to CMP / alarms.

    The primary pipeline runs headless in the edge-python process (`_deepvision_background_loop`
    in main.py): it captures RTSP frames, calls edge-cloud Gemini, and calls
    `AlarmObserver.process_analysis_result` without any browser. Use this route only for
    external integrations or tests — not required for normal CMP reporting.
    """
    try:
        observer = get_alarm_observer()
        
        # Convert to dict format expected by observer
        analysis_dict = analysis.dict()
        
        # Process the analysis result
        alarm_event = observer.process_analysis_result(
            analysis_dict,
            analysis.camera_id,
            analysis.camera_name,
        )
        
        if alarm_event:
            return {
                "status": "alarm_triggered",
                "alarm_id": alarm_event.id,
                "risk_level": alarm_event.risk_assessment.risk_level.value,
                "risk_score": alarm_event.risk_assessment.score,
                "message": f"Alarm triggered for {analysis.camera_id}"
            }
        else:
            return {
                "status": "no_alarm",
                "message": "Analysis processed, no alarm triggered"
            }
            
    except Exception as e:
        logger.error(f"Error processing analysis: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/active", response_model=List[AlarmResponse])
async def get_active_alarms():
    """Get all currently active alarms"""
    try:
        observer = get_alarm_observer()
        alarms = observer.get_active_alarms()
        
        return [
            AlarmResponse(
                alarm_id=alarm.id,
                camera_id=alarm.camera_id,
                risk_level=alarm.risk_assessment.risk_level.value,
                risk_score=alarm.risk_assessment.score,
                state=alarm.state.value,
                triggered_at=alarm.triggered_at.isoformat(),
                acknowledged_at=alarm.acknowledged_at.isoformat() if alarm.acknowledged_at else None,
                resolved_at=alarm.resolved_at.isoformat() if alarm.resolved_at else None,
                actions_taken=alarm.actions_taken,
                escalation_level=alarm.escalation_level
            )
            for alarm in alarms
        ]
        
    except Exception as e:
        logger.error(f"Error getting active alarms: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
async def get_alarm_history(limit: int = Query(default=100, ge=1, le=1000)):
    """Get alarm history from memory and log file"""
    try:
        observer = get_alarm_observer()
        alarms = observer.get_alarm_history(limit=limit)
        
        # Also read from log file if available
        log_alarms = []
        try:
            import json
            from pathlib import Path
            log_file = Path("logs/alarm-history.log")
            if log_file.exists():
                with open(log_file, 'r', encoding='utf-8') as f:
                    lines = f.readlines()[-limit:]  # Get last N lines
                    for line in lines:
                        try:
                            log_entry = json.loads(line.strip())
                            log_alarms.append(log_entry)
                        except:
                            pass
        except Exception as e:
            logger.warning(f"Could not read log file: {e}")
        
        # Combine and deduplicate
        all_alarms = []
        seen_ids = set()
        
        # Add from memory first
        for alarm in alarms:
            if alarm.id not in seen_ids:
                seen_ids.add(alarm.id)
                all_alarms.append({
                    "timestamp": alarm.triggered_at.isoformat(),
                    "alarm_id": alarm.id,
                    "camera_id": alarm.camera_id,
                    "risk_level": alarm.risk_assessment.risk_level.value,
                    "risk_score": alarm.risk_assessment.score,
                    "state": alarm.state.value,
                    "actions_taken": alarm.actions_taken,
                    "details": alarm.risk_assessment.details
                })
        
        # Add from log file
        for log_alarm in log_alarms:
            if log_alarm.get('alarm_id') not in seen_ids:
                seen_ids.add(log_alarm.get('alarm_id'))
                all_alarms.append(log_alarm)
        
        # Sort by timestamp (newest first)
        all_alarms.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        
        return all_alarms[:limit]
        
    except Exception as e:
        logger.error(f"Error getting alarm history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/acknowledge")
async def acknowledge_alarm(request: AlarmAcknowledgeRequest):
    """Acknowledge an active alarm"""
    try:
        observer = get_alarm_observer()
        success = observer.acknowledge_alarm(request.alarm_id)
        
        if success:
            return {
                "status": "acknowledged",
                "alarm_id": request.alarm_id,
                "acknowledged_by": request.acknowledged_by,
                "acknowledged_at": datetime.now().isoformat()
            }
        else:
            raise HTTPException(
                status_code=404, 
                detail=f"Alarm {request.alarm_id} not found or not active"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error acknowledging alarm: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/resolve/{alarm_id}")
async def resolve_alarm(alarm_id: str):
    """Resolve an active alarm"""
    try:
        observer = get_alarm_observer()
        success = observer.resolve_alarm(alarm_id)
        
        if success:
            return {
                "status": "resolved",
                "alarm_id": alarm_id,
                "resolved_at": datetime.now().isoformat()
            }
        else:
            raise HTTPException(
                status_code=404, 
                detail=f"Alarm {alarm_id} not found or not active"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error resolving alarm: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/test")
async def test_alarm(camera_id: str = "test_camera"):
    """Test the alarm system with a simulated high-risk event"""
    try:
        observer = get_alarm_observer()
        
        # Create a test analysis result
        test_analysis = {
            "overallRiskLevel": "High",
            "peopleCount": 5,
            "missingHardhats": 3,
            "missingVests": 2,
            "confidence": 0.95,
            "constructionSafety": {
                "issues": ["Missing PPE", "Unsafe scaffolding"],
                "recommendations": ["Provide hard hats", "Inspect scaffolding"]
            },
            "fireSafety": {
                "issues": [],
                "recommendations": []
            },
            "propertySecurity": {
                "issues": [],
                "recommendations": []
            }
        }
        
        alarm_event = observer.process_analysis_result(test_analysis, camera_id)
        
        if alarm_event:
            return {
                "status": "test_alarm_triggered",
                "alarm_id": alarm_event.id,
                "risk_level": alarm_event.risk_assessment.risk_level.value,
                "risk_score": alarm_event.risk_assessment.score,
                "message": f"Test alarm triggered for {camera_id}"
            }
        else:
            return {
                "status": "test_alarm_suppressed",
                "message": "Test alarm was suppressed (possibly false alarm detection)"
            }
            
    except Exception as e:
        logger.error(f"Error testing alarm: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def get_alarm_system_status():
    """Get alarm system status"""
    try:
        observer = get_alarm_observer()
        
        return {
            "enabled": observer.config.get('alarmSystem', {}).get('enabled', False),
            "active_alarms": len(observer.active_alarms),
            "total_history": len(observer.alarm_history),
            "monitoring_active": observer._running,
            "config_loaded": observer.config is not None
        }
        
    except Exception as e:
        logger.error(f"Error getting alarm status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start-monitoring")
async def start_monitoring():
    """Start the alarm monitoring system"""
    try:
        observer = get_alarm_observer()
        observer.start_monitoring()
        
        return {
            "status": "monitoring_started",
            "message": "Alarm monitoring system started"
        }
        
    except Exception as e:
        logger.error(f"Error starting monitoring: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop-monitoring")
async def stop_monitoring():
    """Stop the alarm monitoring system"""
    try:
        observer = get_alarm_observer()
        observer.stop_monitoring()
        
        return {
            "status": "monitoring_stopped",
            "message": "Alarm monitoring system stopped"
        }
        
    except Exception as e:
        logger.error(f"Error stopping monitoring: {e}")
        raise HTTPException(status_code=500, detail=str(e))
