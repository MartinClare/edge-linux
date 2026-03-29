"""
Intelligent Alarm Observer Service
Monitors Deep Vision analysis results and manages alarms based on configuration.
"""

import json
import time
import logging
import threading
import subprocess
import platform
import os
import hmac
import hashlib
import base64
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import requests

from .cmp_webhook import build_edge_report_json_body, build_keepalive_json_body

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class RiskLevel(Enum):
    """Risk level enumeration"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlarmState(Enum):
    """Alarm state enumeration"""
    IDLE = "idle"
    MONITORING = "monitoring"
    TRIGGERED = "triggered"
    ESCALATED = "escalated"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


@dataclass
class RiskAssessment:
    """Risk assessment result"""
    risk_level: RiskLevel
    score: float
    confidence: float
    source: str
    timestamp: datetime
    details: Dict[str, Any] = field(default_factory=dict)
    is_false_alarm: bool = False
    false_alarm_reason: Optional[str] = None


@dataclass
class AlarmEvent:
    """Alarm event record"""
    id: str
    camera_id: str
    risk_assessment: RiskAssessment
    state: AlarmState
    triggered_at: datetime
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    actions_taken: List[str] = field(default_factory=list)
    escalation_level: int = 0


class AlarmObserver:
    """
    Intelligent alarm observer that monitors Deep Vision analysis results
    and triggers appropriate alarms based on configuration.
    """
    
    def __init__(self, config_path: str = "alarm.config.json", central_server_config: Optional[Dict] = None):
        """Initialize alarm observer with configuration"""
        self.config_path = config_path
        self.config = self._load_config()
        self.central_server_config = central_server_config or {}
        self.alarm_history: List[AlarmEvent] = []
        self.active_alarms: Dict[str, AlarmEvent] = {}
        self.detection_buffer: Dict[str, List[Dict]] = {}  # Camera ID -> detection history
        self.last_alarm_time: Dict[str, datetime] = {}  # Camera ID -> last alarm time
        self._monitor_thread: Optional[threading.Thread] = None
        self._running = False
        
        logger.info(f"Alarm Observer initialized with config: {config_path}")
        logger.info(f"Alarm system enabled: {self.config.get('alarmSystem', {}).get('enabled', False)}")

    def set_central_server_config(self, cfg: Optional[Dict]) -> None:
        """Replace CMP (centralServer) webhook settings from app.config.json — no process restart required."""
        if isinstance(cfg, dict):
            self.central_server_config = dict(cfg)

    def refresh_central_server_from_app_config_json(self) -> None:
        """Reload centralServer from repo-root app.config.json (authoritative path, same as FastAPI)."""
        root = Path(__file__).resolve().parent.parent.parent / "app.config.json"
        try:
            if not root.exists():
                return
            with open(root, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data.get("centralServer"), dict):
                self.set_central_server_config(data["centralServer"])
        except Exception as e:
            logger.warning("refresh_central_server_from_app_config_json: %s", e)

    def _load_config(self) -> Dict:
        """Load configuration from JSON file"""
        try:
            config_file = Path(self.config_path)
            if not config_file.exists():
                logger.warning(f"Config file not found: {self.config_path}, using defaults")
                return self._get_default_config()
            
            with open(config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
                logger.info("Alarm configuration loaded successfully")
                return config
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
            return self._get_default_config()
    
    def _get_default_config(self) -> Dict:
        """Get default configuration"""
        return {
            "alarmSystem": {"enabled": True},
            "riskLevels": {
                "low": {"threshold": 0.3, "autoAction": "none"},
                "medium": {"threshold": 0.6, "autoAction": "log"},
                "high": {"threshold": 0.8, "autoAction": "alarm"},
                "critical": {"threshold": 0.95, "autoAction": "emergency"}
            },
            "falseAlarmDetection": {
                "enabled": True,
                "rules": [],
                "cooldownPeriod": 30
            },
            "alarmTriggers": {
                "local": {"enabled": True, "type": "sound"},
                "visual": {"enabled": True},
                "desktop": {"enabled": True}
            },
            "notificationChannels": {},
            "escalationPolicy": {"enabled": False, "levels": []},
            "logging": {"enabled": True, "level": "info"}
        }
    
    def assess_risk(self, analysis_result: Dict, camera_id: str) -> RiskAssessment:
        """
        Assess risk level from Deep Vision analysis result.
        
        Args:
            analysis_result: Gemini analysis result containing risk information
            camera_id: Camera identifier
            
        Returns:
            RiskAssessment object with risk level and details
        """
        try:
            # Extract risk information from analysis result
            overall_risk = analysis_result.get('overallRiskLevel', 'Low').lower()
            people_count = analysis_result.get('peopleCount', 0)
            missing_ppe = analysis_result.get('missingHardhats', 0) + analysis_result.get('missingVests', 0)
            
            # Calculate risk score (0.0 to 1.0)
            risk_score = self._calculate_risk_score(
                overall_risk, 
                people_count, 
                missing_ppe,
                analysis_result
            )
            
            # Determine risk level based on score
            risk_level = self._determine_risk_level(risk_score)
            
            # Check for false alarm
            is_false_alarm, reason = self._check_false_alarm(
                risk_score, 
                camera_id, 
                analysis_result
            )
            
            assessment = RiskAssessment(
                risk_level=risk_level,
                score=risk_score,
                confidence=analysis_result.get('confidence', 0.8),
                source=camera_id,
                timestamp=datetime.now(),
                details={
                    'overall_risk': overall_risk,
                    'people_count': people_count,
                    'missing_ppe': missing_ppe,
                    'missing_hardhats': analysis_result.get('missingHardhats', 0),
                    'missing_vests': analysis_result.get('missingVests', 0),
                    'construction_safety': analysis_result.get('constructionSafety', {}),
                    'fire_safety': analysis_result.get('fireSafety', {}),
                    'property_security': analysis_result.get('propertySecurity', {})
                },
                is_false_alarm=is_false_alarm,
                false_alarm_reason=reason
            )
            
            logger.info(f"Risk assessment for {camera_id}: {risk_level.value} (score: {risk_score:.2f}), false alarm: {is_false_alarm}")
            return assessment
            
        except Exception as e:
            logger.error(f"Error assessing risk: {e}")
            return RiskAssessment(
                risk_level=RiskLevel.LOW,
                score=0.0,
                confidence=0.0,
                source=camera_id,
                timestamp=datetime.now(),
                is_false_alarm=True,
                false_alarm_reason=f"Assessment error: {str(e)}"
            )
    
    def _calculate_risk_score(self, overall_risk: str, people_count: int, 
                             missing_ppe: int, details: Dict) -> float:
        """Calculate numerical risk score from analysis"""
        base_score = {
            'low': 0.2,
            'medium': 0.5,
            'high': 0.8,
            'critical': 0.95
        }.get(overall_risk.lower(), 0.2)
        
        # Adjust based on people and PPE violations
        if people_count > 0:
            ppe_violation_ratio = missing_ppe / max(people_count, 1)
            base_score = min(1.0, base_score + (ppe_violation_ratio * 0.2))
        
        # Check for specific hazards
        construction_issues = details.get('constructionSafety', {}).get('issues', [])
        fire_issues = details.get('fireSafety', {}).get('issues', [])
        security_issues = details.get('propertySecurity', {}).get('issues', [])
        
        total_issues = len(construction_issues) + len(fire_issues) + len(security_issues)
        if total_issues > 0:
            base_score = min(1.0, base_score + (total_issues * 0.05))
        
        return round(base_score, 2)
    
    def _determine_risk_level(self, score: float) -> RiskLevel:
        """Determine risk level from score"""
        risk_levels = self.config.get('riskLevels', {})
        
        if score >= risk_levels.get('critical', {}).get('threshold', 0.95):
            return RiskLevel.CRITICAL
        elif score >= risk_levels.get('high', {}).get('threshold', 0.8):
            return RiskLevel.HIGH
        elif score >= risk_levels.get('medium', {}).get('threshold', 0.6):
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.LOW
    
    def _check_false_alarm(self, risk_score: float, camera_id: str, 
                          analysis_result: Dict) -> tuple[bool, Optional[str]]:
        """
        Check if the detection is a false alarm based on configured rules.
        
        Returns:
            Tuple of (is_false_alarm, reason)
        """
        false_alarm_config = self.config.get('falseAlarmDetection', {})
        
        if not false_alarm_config.get('enabled', False):
            return False, None
        
        rules = false_alarm_config.get('rules', [])
        
        # Check cooldown period
        cooldown = false_alarm_config.get('cooldownPeriod', 30)
        if camera_id in self.last_alarm_time:
            time_since_last = (datetime.now() - self.last_alarm_time[camera_id]).total_seconds()
            if time_since_last < cooldown:
                return True, f"Cooldown period active ({time_since_last:.1f}s < {cooldown}s)"
        
        # Check each rule
        for rule in rules:
            if not rule.get('enabled', False):
                continue
            
            rule_name = rule.get('name', '')
            params = rule.get('parameters', {})
            
            if rule_name == 'transient_object':
                # Check if detection duration is too short
                min_duration = params.get('minDuration', 3)
                # This would need frame timing info - simplified check
                pass
            
            elif rule_name == 'single_frame_detection':
                # Check if detection appears in multiple frames
                min_frames = params.get('minFrames', 2)
                window_size = params.get('windowSize', 5)
                
                # Add to detection buffer
                if camera_id not in self.detection_buffer:
                    self.detection_buffer[camera_id] = []
                
                self.detection_buffer[camera_id].append({
                    'timestamp': datetime.now().isoformat(),
                    'risk_score': risk_score
                })
                
                # Keep only recent detections
                self.detection_buffer[camera_id] = self.detection_buffer[camera_id][-window_size:]
                
                # Check if we have enough frames
                if len(self.detection_buffer[camera_id]) < min_frames:
                    return True, f"Insufficient frames ({len(self.detection_buffer[camera_id])} < {min_frames})"
            
            elif rule_name == 'confidence_threshold':
                # Check detection confidence
                min_confidence = params.get('minConfidence', 0.7)
                confidence = analysis_result.get('confidence', 1.0)
                if confidence < min_confidence:
                    return True, f"Low confidence ({confidence:.2f} < {min_confidence})"
        
        return False, None
    
    def trigger_alarm(self, assessment: RiskAssessment, camera_id: str) -> AlarmEvent:
        """
        Trigger alarm based on risk assessment.
        
        Args:
            assessment: Risk assessment result
            camera_id: Camera identifier
            
        Returns:
            AlarmEvent record
        """
        alarm_id = f"{camera_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        alarm_event = AlarmEvent(
            id=alarm_id,
            camera_id=camera_id,
            risk_assessment=assessment,
            state=AlarmState.TRIGGERED,
            triggered_at=datetime.now(),
            actions_taken=[]
        )
        
        # Get action based on risk level
        risk_config = self.config.get('riskLevels', {}).get(assessment.risk_level.value, {})
        action = risk_config.get('autoAction', 'none')
        
        logger.warning(f"🚨 ALARM TRIGGERED: {alarm_id}")
        logger.warning(f"   Camera: {camera_id}")
        logger.warning(f"   Risk Level: {assessment.risk_level.value.upper()}")
        logger.warning(f"   Score: {assessment.score:.2f}")
        logger.warning(f"   Action: {action}")
        
        # Execute alarm actions
        if action != 'none':
            self._execute_alarm_actions(alarm_event, action)
        
        # Store alarm
        self.active_alarms[alarm_id] = alarm_event
        self.alarm_history.append(alarm_event)
        self.last_alarm_time[camera_id] = datetime.now()
        
        # Log to file
        self._log_alarm(alarm_event)
        
        return alarm_event
    
    def _execute_alarm_actions(self, alarm_event: AlarmEvent, action: str):
        """Execute alarm actions based on action type"""
        triggers = self.config.get('alarmTriggers', {})
        
        # Local alarm (sound)
        if triggers.get('local', {}).get('enabled', False) and action in ['alarm', 'emergency']:
            self._trigger_local_alarm(alarm_event)
            alarm_event.actions_taken.append('local_alarm')
        
        # Visual alarm
        if triggers.get('visual', {}).get('enabled', False):
            self._trigger_visual_alarm(alarm_event)
            alarm_event.actions_taken.append('visual_alarm')
        
        # Desktop notification
        if triggers.get('desktop', {}).get('enabled', False):
            self._trigger_desktop_notification(alarm_event)
            alarm_event.actions_taken.append('desktop_notification')
        
        # External notifications
        channels = self.config.get('notificationChannels', {})
        
        if channels.get('webhook', {}).get('enabled', False):
            self._send_webhook_notification(alarm_event)
            alarm_event.actions_taken.append('webhook_notification')
        
        if channels.get('email', {}).get('enabled', False):
            self._send_email_notification(alarm_event)
            alarm_event.actions_taken.append('email_notification')
        
        if channels.get('slack', {}).get('enabled', False):
            self._send_slack_notification(alarm_event)
            alarm_event.actions_taken.append('slack_notification')
    
    def _trigger_local_alarm(self, alarm_event: AlarmEvent):
        """Trigger local sound alarm"""
        try:
            local_config = self.config.get('alarmTriggers', {}).get('local', {})
            
            if platform.system() == 'Windows':
                # Windows: Use PowerShell to play sound
                duration = local_config.get('duration', 5)
                repeat = local_config.get('repeat', 3)
                
                # Beep sound
                for i in range(repeat):
                    subprocess.run(
                        ['powershell', '-command', f'[console]::Beep(1000, {duration * 1000})'],
                        check=False
                    )
                    if i < repeat - 1:
                        time.sleep(local_config.get('interval', 2))
            
            logger.info(f"🔊 Local alarm triggered for {alarm_event.id}")
            
        except Exception as e:
            logger.error(f"Failed to trigger local alarm: {e}")
    
    def _trigger_visual_alarm(self, alarm_event: AlarmEvent):
        """Trigger visual alarm (would integrate with frontend)"""
        logger.info(f"💡 Visual alarm triggered for {alarm_event.id}")
        # This would typically send a WebSocket message to the frontend
        # to flash the screen or show an overlay
    
    def _trigger_desktop_notification(self, alarm_event: AlarmEvent):
        """Trigger desktop notification"""
        try:
            if platform.system() == 'Windows':
                # Windows toast notification
                title = self.config.get('alarmTriggers', {}).get('desktop', {}).get('title', '⚠️ Safety Alert')
                message = (
                    f"Risk Level: {alarm_event.risk_assessment.risk_level.value.upper()}\n"
                    f"Camera: {alarm_event.camera_id}\n"
                    f"Score: {alarm_event.risk_assessment.score:.2f}"
                )
                
                # Use PowerShell to show notification
                ps_script = f'''
                [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
                [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
                
                $template = @"
                <toast>
                    <visual>
                        <binding template="ToastText02">
                            <text id="1">{title}</text>
                            <text id="2">{message}</text>
                        </binding>
                    </visual>
                </toast>
"@
                
                $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
                $xml.LoadXml($template)
                $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
                [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Safety Alert").Show($toast)
                '''
                
                subprocess.run(['powershell', '-command', ps_script], check=False)
                logger.info(f"🖥️ Desktop notification sent for {alarm_event.id}")
                
        except Exception as e:
            logger.error(f"Failed to send desktop notification: {e}")
    
    def _send_webhook_notification(self, alarm_event: AlarmEvent):
        """Send webhook notification"""
        try:
            webhook_config = self.config.get('notificationChannels', {}).get('webhook', {})
            url = webhook_config.get('url', '')
            
            if not url:
                return
            
            payload = {
                'alarm_id': alarm_event.id,
                'camera_id': alarm_event.camera_id,
                'risk_level': alarm_event.risk_assessment.risk_level.value,
                'risk_score': alarm_event.risk_assessment.score,
                'timestamp': alarm_event.triggered_at.isoformat(),
                'details': alarm_event.risk_assessment.details
            }
            
            headers = webhook_config.get('headers', {})
            retry_attempts = webhook_config.get('retryAttempts', 3)
            
            for attempt in range(retry_attempts):
                try:
                    response = requests.post(
                        url,
                        json=payload,
                        headers=headers,
                        timeout=10
                    )
                    if response.ok:
                        logger.info(f"✅ Webhook notification sent for {alarm_event.id}")
                        return
                except Exception as e:
                    logger.warning(f"Webhook attempt {attempt + 1} failed: {e}")
                    time.sleep(webhook_config.get('retryDelay', 5))
            
            logger.error(f"Failed to send webhook notification after {retry_attempts} attempts")
            
        except Exception as e:
            logger.error(f"Error sending webhook notification: {e}")
    
    def _send_to_central_server(
        self,
        camera_id: str,
        camera_name: str,
        analysis_result: Dict,
        image_jpeg: Optional[bytes] = None,
    ) -> None:
        """Send every analysis result to the central monitoring platform webhook (runs in background).

        If image_jpeg bytes are provided the request is sent as multipart/form-data with
        the JSON payload in the 'payload' field and the image in the 'image' field, so the
        CMP can store and display the frame that triggered the analysis.
        Without image bytes the request falls back to plain application/json.
        """
        cfg = self.central_server_config
        if not cfg.get("enabled") or not cfg.get("url") or not cfg.get("apiKey"):
            return
        url = cfg.get("url", "").rstrip("/")
        api_key = cfg.get("apiKey", "")
        retry_attempts = int(cfg.get("retryAttempts", 3))
        retry_delay = int(cfg.get("retryDelay", 5))

        payload = build_edge_report_json_body(
            camera_id,
            camera_name or camera_id,
            analysis_result,
            include_image=image_jpeg is not None,
        )

        def _b64url(data: bytes) -> str:
            return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

        def _load_jwt_secret() -> str:
            secret = os.getenv("JWT_SECRET", "").strip()
            if secret:
                return secret
            # Fallback: read cloud/.env when service env is minimal
            try:
                root = Path(__file__).resolve().parent.parent.parent
                env_path = root / "cloud" / ".env"
                if env_path.exists():
                    for line in env_path.read_text(encoding="utf-8").splitlines():
                        if line.startswith("JWT_SECRET="):
                            val = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if val:
                                return val
            except Exception as exc:
                logger.warning(f"Unable to read JWT_SECRET from .env: {exc}")
            return ""

        def _generate_jwt(secret: str) -> str:
            now = int(time.time())
            header = {"typ": "JWT", "alg": "HS256"}
            claims = {"sub": "edge-device", "iat": now, "exp": now + 3600}
            header_b64 = _b64url(json.dumps(header, separators=(",", ":"), ensure_ascii=True).encode("utf-8"))
            claims_b64 = _b64url(json.dumps(claims, separators=(",", ":"), ensure_ascii=True).encode("utf-8"))
            signing_input = f"{header_b64}.{claims_b64}".encode("ascii")
            signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
            sig_b64 = _b64url(signature)
            return f"{header_b64}.{claims_b64}.{sig_b64}"

        def _do_send() -> None:
            jwt_secret = _load_jwt_secret()
            auth_token = _generate_jwt(jwt_secret) if jwt_secret else ""
            for attempt in range(retry_attempts):
                try:
                    base_headers = {"X-API-Key": api_key}
                    if auth_token:
                        base_headers["Authorization"] = f"Bearer {auth_token}"

                    if image_jpeg:
                        # multipart: 'payload' field carries JSON; 'image' field carries JPEG bytes
                        files = {
                            "payload": (None, json.dumps(payload), "application/json"),
                            "image": ("frame.jpg", image_jpeg, "image/jpeg"),
                        }
                        resp = requests.post(url, files=files, headers=base_headers, timeout=30)
                    else:
                        base_headers["Content-Type"] = "application/json"
                        resp = requests.post(url, json=payload, headers=base_headers, timeout=30)

                    if resp.ok:
                        logger.info(f"Central server report sent for {camera_id} (image={'yes' if image_jpeg else 'no'})")
                        return
                    logger.warning(f"Central server returned {resp.status_code} (attempt {attempt + 1}/{retry_attempts}): {resp.text[:200]}")
                except Exception as e:
                    logger.warning(f"Central server attempt {attempt + 1}/{retry_attempts} failed: {e}")
                if attempt < retry_attempts - 1:
                    time.sleep(retry_delay)
            logger.error(f"Failed to send to central server after {retry_attempts} attempts")

        thread = threading.Thread(target=_do_send, daemon=True)
        thread.start()
    
    def _send_email_notification(self, alarm_event: AlarmEvent):
        """Send email notification (placeholder)"""
        logger.info(f"📧 Email notification would be sent for {alarm_event.id}")
        # Implementation would use smtplib to send emails
    
    def _send_slack_notification(self, alarm_event: AlarmEvent):
        """Send Slack notification"""
        try:
            slack_config = self.config.get('notificationChannels', {}).get('slack', {})
            webhook_url = slack_config.get('webhookUrl', '')
            
            if not webhook_url:
                return
            
            risk_emoji = {
                RiskLevel.LOW: "🟢",
                RiskLevel.MEDIUM: "🟡",
                RiskLevel.HIGH: "🔴",
                RiskLevel.CRITICAL: "🚨"
            }.get(alarm_event.risk_assessment.risk_level, "⚠️")
            
            payload = {
                "channel": slack_config.get('channel', '#safety-alerts'),
                "username": slack_config.get('username', 'Safety Bot'),
                "icon_emoji": slack_config.get('iconEmoji', ':warning:'),
                "attachments": [{
                    "color": "danger" if alarm_event.risk_assessment.risk_level in [RiskLevel.HIGH, RiskLevel.CRITICAL] else "warning",
                    "title": f"{risk_emoji} Safety Alert - {alarm_event.risk_assessment.risk_level.value.upper()} Risk",
                    "fields": [
                        {"title": "Camera", "value": alarm_event.camera_id, "short": True},
                        {"title": "Risk Score", "value": f"{alarm_event.risk_assessment.score:.2f}", "short": True},
                        {"title": "Time", "value": alarm_event.triggered_at.strftime('%Y-%m-%d %H:%M:%S'), "short": True},
                        {"title": "Alarm ID", "value": alarm_event.id, "short": True}
                    ],
                    "footer": "Safety Monitoring System",
                    "ts": int(alarm_event.triggered_at.timestamp())
                }]
            }
            
            response = requests.post(webhook_url, json=payload, timeout=10)
            if response.ok:
                logger.info(f"💬 Slack notification sent for {alarm_event.id}")
            
        except Exception as e:
            logger.error(f"Failed to send Slack notification: {e}")
    
    def _log_alarm(self, alarm_event: AlarmEvent):
        """Log alarm to file"""
        try:
            log_config = self.config.get('logging', {})
            if not log_config.get('enabled', True):
                return
            
            log_file = Path(log_config.get('file', 'logs/alarm-history.log'))
            log_file.parent.mkdir(parents=True, exist_ok=True)
            
            log_entry = {
                'timestamp': alarm_event.triggered_at.isoformat(),
                'alarm_id': alarm_event.id,
                'camera_id': alarm_event.camera_id,
                'risk_level': alarm_event.risk_assessment.risk_level.value,
                'risk_score': alarm_event.risk_assessment.score,
                'state': alarm_event.state.value,
                'actions': alarm_event.actions_taken,
                'details': alarm_event.risk_assessment.details
            }
            
            with open(log_file, 'a', encoding='utf-8') as f:
                f.write(json.dumps(log_entry) + '\n')
            
        except Exception as e:
            logger.error(f"Failed to log alarm: {e}")
    
    def acknowledge_alarm(self, alarm_id: str) -> bool:
        """Acknowledge an active alarm"""
        if alarm_id in self.active_alarms:
            alarm = self.active_alarms[alarm_id]
            alarm.state = AlarmState.ACKNOWLEDGED
            alarm.acknowledged_at = datetime.now()
            logger.info(f"Alarm {alarm_id} acknowledged")
            return True
        return False
    
    def resolve_alarm(self, alarm_id: str) -> bool:
        """Resolve an active alarm"""
        if alarm_id in self.active_alarms:
            alarm = self.active_alarms[alarm_id]
            alarm.state = AlarmState.RESOLVED
            alarm.resolved_at = datetime.now()
            del self.active_alarms[alarm_id]
            logger.info(f"Alarm {alarm_id} resolved")
            return True
        return False
    
    def send_keepalive(self, camera_id: str, camera_name: str) -> None:
        """Send a keepalive / heartbeat ping to CMP for a single camera.

        CMP updates Camera.lastReportAt on every keepalive so the Edge Devices list
        continues to show the camera as 'online' (within the 5-minute online window)
        even during quiet periods when no new analysis is produced.
        """
        cfg = self.central_server_config
        if not cfg.get("enabled") or not cfg.get("url") or not cfg.get("apiKey"):
            return

        payload = build_keepalive_json_body(camera_id, camera_name)
        url = cfg.get("url", "").rstrip("/")
        api_key = cfg.get("apiKey", "")

        def _do_keepalive() -> None:
            try:
                resp = requests.post(
                    url,
                    json=payload,
                    headers={"X-API-Key": api_key, "Content-Type": "application/json"},
                    timeout=15,
                )
                if resp.ok:
                    logger.debug(f"Keepalive sent for {camera_id}")
                else:
                    logger.warning(f"Keepalive {camera_id} got {resp.status_code}")
            except Exception as exc:
                logger.warning(f"Keepalive {camera_id} failed: {exc}")

        threading.Thread(target=_do_keepalive, daemon=True).start()

    def process_analysis_result(
        self,
        analysis_result: Dict,
        camera_id: str,
        camera_name: Optional[str] = None,
        image_jpeg: Optional[bytes] = None,
    ) -> Optional[AlarmEvent]:
        """
        Process a Deep Vision analysis result and trigger alarm if necessary.

        Args:
            analysis_result: Gemini analysis result
            camera_id: Camera identifier
            camera_name: Optional display name for the camera (used when sending to central server)
            image_jpeg: Optional JPEG bytes of the frame that was analysed; forwarded to CMP if provided.

        Returns:
            AlarmEvent if alarm was triggered, None otherwise
        """
        self._send_to_central_server(camera_id, camera_name or camera_id, analysis_result, image_jpeg=image_jpeg)

        if not self.config.get('alarmSystem', {}).get('enabled', False):
            return None
        
        # First, check custom conditions
        custom_alarm = self._check_custom_conditions(analysis_result, camera_id)
        if custom_alarm:
            return custom_alarm
        
        # Then assess risk normally
        assessment = self.assess_risk(analysis_result, camera_id)
        
        # Check if it's a false alarm
        if assessment.is_false_alarm:
            logger.info(f"False alarm detected for {camera_id}: {assessment.false_alarm_reason}")
            return None
        
        # Check if alarm should be triggered
        risk_config = self.config.get('riskLevels', {}).get(assessment.risk_level.value, {})
        action = risk_config.get('autoAction', 'none')
        
        if action in ['alarm', 'emergency']:
            return self.trigger_alarm(assessment, camera_id)
        elif action == 'log':
            logger.info(f"Risk detected for {camera_id}: {assessment.risk_level.value} (score: {assessment.score:.2f})")
        
        return None
    
    def _check_custom_conditions(self, analysis_result: Dict, camera_id: str) -> Optional[AlarmEvent]:
        """
        Check custom alarm conditions from configuration.
        
        Args:
            analysis_result: Analysis result with detections
            camera_id: Camera identifier
            
        Returns:
            AlarmEvent if a custom condition was triggered, None otherwise
        """
        custom_conditions = self.config.get('customConditions', {})
        
        if not custom_conditions.get('enabled', False):
            return None
        
        conditions = custom_conditions.get('conditions', [])
        detections = analysis_result.get('detections', [])
        
        for condition in conditions:
            if not condition.get('enabled', False):
                continue
            
            condition_id = condition.get('id', '')
            trigger = condition.get('trigger', {})
            trigger_type = trigger.get('type', 'detection')
            
            # Check cooldown for this condition
            if not self._check_condition_cooldown(condition_id, camera_id, condition):
                continue
            
            triggered = False
            details = {}
            
            if trigger_type == 'detection':
                triggered, details = self._check_detection_condition(trigger, detections, camera_id)
            elif trigger_type == 'count':
                triggered, details = self._check_count_condition(trigger, detections, camera_id)
            elif trigger_type == 'keyword':
                triggered, details = self._check_keyword_condition(trigger, analysis_result, camera_id)
            elif trigger_type == 'proximity':
                triggered, details = self._check_proximity_condition(trigger, detections, camera_id)
            elif trigger_type == 'zone':
                triggered, details = self._check_zone_condition(trigger, detections, camera_id)
            
            if triggered:
                return self._create_custom_alarm(condition, camera_id, details)
        
        return None
    
    def _check_condition_cooldown(self, condition_id: str, camera_id: str, condition: Dict) -> bool:
        """Check if condition is in cooldown period"""
        cooldown_key = f"{condition_id}_{camera_id}"
        cooldown = condition.get('cooldown', 30)
        
        if cooldown_key in self.last_alarm_time:
            time_since_last = (datetime.now() - self.last_alarm_time[cooldown_key]).total_seconds()
            if time_since_last < cooldown:
                return False
        
        return True
    
    def _check_detection_condition(self, trigger: Dict, detections: List[Dict], camera_id: str) -> tuple[bool, Dict]:
        """Check if specific detection class is present"""
        target_class = trigger.get('class', '')
        min_confidence = trigger.get('minConfidence', 0.5)
        min_count = trigger.get('minCount', 1)
        
        matching_detections = [
            d for d in detections
            if d.get('class_name') == target_class and d.get('confidence', 0) >= min_confidence
        ]
        
        if len(matching_detections) >= min_count:
            return True, {
                'condition_type': 'detection',
                'class': target_class,
                'count': len(matching_detections),
                'detections': matching_detections[:5]  # Limit to 5 for logging
            }
        
        return False, {}
    
    def _check_count_condition(self, trigger: Dict, detections: List[Dict], camera_id: str) -> tuple[bool, Dict]:
        """Check if count of detections exceeds threshold"""
        target_classes = trigger.get('classes', [])
        min_confidence = trigger.get('minConfidence', 0.5)
        min_count = trigger.get('minCount', 1)
        max_count = trigger.get('maxCount')
        
        matching_detections = [
            d for d in detections
            if d.get('class_name') in target_classes and d.get('confidence', 0) >= min_confidence
        ]
        
        count = len(matching_detections)
        
        if count >= min_count:
            if max_count is None or count <= max_count:
                return True, {
                    'condition_type': 'count',
                    'classes': target_classes,
                    'count': count,
                    'min_count': min_count
                }
        
        return False, {}
    
    def _check_keyword_condition(self, trigger: Dict, analysis_result: Dict, camera_id: str) -> tuple[bool, Dict]:
        """Check if keywords appear in analysis text"""
        keywords = trigger.get('keywords', [])
        min_confidence = trigger.get('minConfidence', 0.7)
        
        # Search in various text fields
        text_fields = [
            analysis_result.get('summary', ''),
            analysis_result.get('description', ''),
            str(analysis_result.get('constructionSafety', {})),
            str(analysis_result.get('fireSafety', {})),
            str(analysis_result.get('propertySecurity', {}))
        ]
        
        combined_text = ' '.join(text_fields).lower()
        
        for keyword in keywords:
            if keyword.lower() in combined_text:
                return True, {
                    'condition_type': 'keyword',
                    'keyword': keyword,
                    'matched': True
                }
        
        return False, {}
    
    def _check_proximity_condition(self, trigger: Dict, detections: List[Dict], camera_id: str) -> tuple[bool, Dict]:
        """Check if objects of different classes are in proximity"""
        classes = trigger.get('classes', [])
        proximity_threshold = trigger.get('proximityThreshold', 100)
        min_confidence = trigger.get('minConfidence', 0.5)
        
        # Get detections for each class
        class_detections = {}
        for det in detections:
            class_name = det.get('class_name')
            if class_name in classes and det.get('confidence', 0) >= min_confidence:
                if class_name not in class_detections:
                    class_detections[class_name] = []
                class_detections[class_name].append(det)
        
        # Check proximity between different classes
        class_list = list(class_detections.keys())
        for i, class1 in enumerate(class_list):
            for class2 in class_list[i+1:]:
                for det1 in class_detections[class1]:
                    for det2 in class_detections[class2]:
                        # Calculate center points
                        bbox1 = det1.get('bbox', [0, 0, 0, 0])
                        bbox2 = det2.get('bbox', [0, 0, 0, 0])
                        
                        center1 = ((bbox1[0] + bbox1[2]) / 2, (bbox1[1] + bbox1[3]) / 2)
                        center2 = ((bbox2[0] + bbox2[2]) / 2, (bbox2[1] + bbox2[3]) / 2)
                        
                        # Calculate distance
                        distance = ((center1[0] - center2[0])**2 + (center1[1] - center2[1])**2)**0.5
                        
                        if distance < proximity_threshold:
                            return True, {
                                'condition_type': 'proximity',
                                'classes': [class1, class2],
                                'distance': distance,
                                'threshold': proximity_threshold
                            }
        
        return False, {}
    
    def _check_zone_condition(self, trigger: Dict, detections: List[Dict], camera_id: str) -> tuple[bool, Dict]:
        """Check if objects enter defined zones"""
        target_class = trigger.get('class', 'Person')
        zones = trigger.get('zones', [])
        min_confidence = trigger.get('minConfidence', 0.5)
        
        for det in detections:
            if det.get('class_name') != target_class:
                continue
            if det.get('confidence', 0) < min_confidence:
                continue
            
            bbox = det.get('bbox', [0, 0, 0, 0])
            center = ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)
            
            for zone in zones:
                zone_coords = zone.get('coordinates', [])
                if self._point_in_polygon(center, zone_coords):
                    return True, {
                        'condition_type': 'zone',
                        'zone_name': zone.get('name', 'Unknown Zone'),
                        'class': target_class
                    }
        
        return False, {}
    
    def _point_in_polygon(self, point: tuple, polygon: List[List[float]]) -> bool:
        """Check if a point is inside a polygon using ray casting"""
        if len(polygon) < 3:
            return False
        
        x, y = point
        n = len(polygon)
        inside = False
        
        p1x, p1y = polygon[0]
        for i in range(1, n + 1):
            p2x, p2y = polygon[i % n]
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or x <= xinters:
                            inside = not inside
            p1x, p1y = p2x, p2y
        
        return inside
    
    def _create_custom_alarm(self, condition: Dict, camera_id: str, details: Dict) -> AlarmEvent:
        """Create an alarm from a custom condition"""
        condition_id = condition.get('id', '')
        severity = condition.get('severity', 'medium')
        message_template = condition.get('message', 'Custom condition triggered')
        
        # Format message
        message = message_template.format(
            camera_id=camera_id,
            count=details.get('count', 0),
            details=str(details)
        )
        
        # Create risk assessment
        risk_level = {
            'low': RiskLevel.LOW,
            'medium': RiskLevel.MEDIUM,
            'high': RiskLevel.HIGH,
            'critical': RiskLevel.CRITICAL
        }.get(severity, RiskLevel.MEDIUM)
        
        assessment = RiskAssessment(
            risk_level=risk_level,
            score={'low': 0.3, 'medium': 0.6, 'high': 0.8, 'critical': 0.95}.get(severity, 0.5),
            confidence=0.9,
            source=camera_id,
            timestamp=datetime.now(),
            details={
                'custom_condition': condition_id,
                'condition_name': condition.get('name', ''),
                'message': message,
                **details
            }
        )
        
        # Create alarm event
        alarm_id = f"{condition_id}_{camera_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        alarm_event = AlarmEvent(
            id=alarm_id,
            camera_id=camera_id,
            risk_assessment=assessment,
            state=AlarmState.TRIGGERED,
            triggered_at=datetime.now(),
            actions_taken=[]
        )
        
        # Execute actions
        actions = condition.get('actions', {})
        if actions.get('log', True):
            logger.warning(f"🚨 CUSTOM ALARM: {condition.get('name', condition_id)}")
            logger.warning(f"   Camera: {camera_id}")
            logger.warning(f"   Severity: {severity.upper()}")
            logger.warning(f"   Message: {message}")
        
        if actions.get('alarm', False):
            self._trigger_local_alarm(alarm_event)
            alarm_event.actions_taken.append('local_alarm')
        
        if actions.get('notification', False):
            channels = actions.get('channels', [])
            if 'desktop' in channels:
                self._trigger_desktop_notification(alarm_event)
                alarm_event.actions_taken.append('desktop_notification')
            if 'webhook' in channels:
                self._send_webhook_notification(alarm_event)
                alarm_event.actions_taken.append('webhook_notification')
            if 'email' in channels:
                self._send_email_notification(alarm_event)
                alarm_event.actions_taken.append('email_notification')
            if 'slack' in channels:
                self._send_slack_notification(alarm_event)
                alarm_event.actions_taken.append('slack_notification')
        
        # Store alarm
        cooldown_key = f"{condition_id}_{camera_id}"
        self.active_alarms[alarm_id] = alarm_event
        self.alarm_history.append(alarm_event)
        self.last_alarm_time[cooldown_key] = datetime.now()
        
        # Log to file
        self._log_alarm(alarm_event)
        
        return alarm_event
    
    def get_active_alarms(self) -> List[AlarmEvent]:
        """Get all active alarms"""
        return list(self.active_alarms.values())
    
    def get_alarm_history(self, limit: int = 100) -> List[AlarmEvent]:
        """Get alarm history"""
        return self.alarm_history[-limit:]
    
    def start_monitoring(self):
        """Start background monitoring thread"""
        if self._monitor_thread and self._monitor_thread.is_alive():
            logger.warning("Monitoring already running")
            return
        
        self._running = True
        self._monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._monitor_thread.start()
        logger.info("Alarm monitoring started")
    
    def stop_monitoring(self):
        """Stop background monitoring thread"""
        self._running = False
        if self._monitor_thread:
            self._monitor_thread.join(timeout=5)
        logger.info("Alarm monitoring stopped")
    
    def _monitor_loop(self):
        """Background monitoring loop for escalation"""
        while self._running:
            try:
                # Check for escalation
                self._check_escalation()
                
                # Clean up old detection buffers
                self._cleanup_buffers()
                
                time.sleep(10)  # Check every 10 seconds
                
            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
    
    def _check_escalation(self):
        """Check if any alarms need escalation"""
        escalation_config = self.config.get('escalationPolicy', {})
        
        if not escalation_config.get('enabled', False):
            return
        
        levels = escalation_config.get('levels', [])
        now = datetime.now()
        
        for alarm_id, alarm in list(self.active_alarms.items()):
            if alarm.state != AlarmState.TRIGGERED:
                continue
            
            time_elapsed = (now - alarm.triggered_at).total_seconds()
            
            for level_config in levels:
                level = level_config.get('level', 1)
                after_seconds = level_config.get('after', 60)
                action = level_config.get('action', '')
                
                if time_elapsed >= after_seconds and alarm.escalation_level < level:
                    logger.warning(f"⚠️ Escalating alarm {alarm_id} to level {level}")
                    alarm.escalation_level = level
                    alarm.actions_taken.append(f'escalation_level_{level}')
                    
                    # Execute escalation action
                    if action == 'repeat_alarm':
                        self._trigger_local_alarm(alarm)
                    elif action == 'escalate_notification':
                        # Send to additional recipients
                        pass
                    elif action == 'emergency_protocol':
                        # Trigger emergency protocol
                        logger.critical(f"🚨 EMERGENCY PROTOCOL for {alarm_id}")
    
    def _cleanup_buffers(self):
        """Clean up old detection buffers"""
        cutoff = datetime.now() - timedelta(minutes=5)
        
        for camera_id in list(self.detection_buffer.keys()):
            # Remove old detections
            self.detection_buffer[camera_id] = [
                d for d in self.detection_buffer[camera_id]
                if datetime.fromisoformat(d['timestamp']) > cutoff
            ]


# Singleton instance
_alarm_observer: Optional[AlarmObserver] = None


def get_alarm_observer(config_path: str = "alarm.config.json", central_server_config: Optional[Dict] = None) -> AlarmObserver:
    """Get or create alarm observer singleton"""
    global _alarm_observer
    if _alarm_observer is None:
        _alarm_observer = AlarmObserver(config_path, central_server_config)
    return _alarm_observer
