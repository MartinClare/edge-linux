"""
Central Monitoring Platform (CMP) — inbound webhook payload for POST /api/webhook/edge-report.

Keep this module aligned with the Zod schema in the bundled CMP app:
  CCTVCMP/lib/validations/webhook.ts  →  edgeReportSchema, analysisSchema, normalizeEdgeWebhookPayload

Server handler (auth + multipart rules):
  CCTVCMP/app/api/webhook/edge-report/route.ts

Edge sends JSON only (no multipart image):
  - Headers: Content-Type: application/json, X-API-Key: <centralServer.apiKey from app.config.json>
  - Body top-level: edgeCameraId, cameraName, timestamp, analysis
  - Optional CMP fields we omit (defaults apply): messageType=analysis, keepalive=false, eventImageIncluded=false

Human-readable reference: CCTVCMP/WEBHOOK_API.md
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Mapping, MutableMapping, Optional


def _empty_safety_category() -> Dict[str, Any]:
    return {"summary": "", "issues": [], "recommendations": []}


def _coerce_category(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, MutableMapping):
        return _empty_safety_category()
    issues = raw.get("issues") if isinstance(raw.get("issues"), list) else []
    recs = raw.get("recommendations") if isinstance(raw.get("recommendations"), list) else []
    summary = raw.get("summary", "")
    return {
        "summary": summary if isinstance(summary, str) else "",
        "issues": [x for x in issues if isinstance(x, str)],
        "recommendations": [x for x in recs if isinstance(x, str)],
    }


def utc_iso_timestamp_z() -> str:
    """ISO-8601 UTC with Z suffix (matches CMP examples)."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def build_edge_report_json_body(
    edge_camera_id: str,
    camera_name: str,
    analysis_result: Mapping[str, Any],
    *,
    timestamp_iso: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Build the JSON object POSTed to CMP. Field names match edgeReportSchema after normalization.

    analysis_result keys (from Gemini / edge): overallDescription, overallRiskLevel,
    constructionSafety, fireSafety, propertySecurity, peopleCount?, missingHardhats?, missingVests?
    """
    ts = timestamp_iso if timestamp_iso else utc_iso_timestamp_z()
    return {
        "edgeCameraId": edge_camera_id,
        "cameraName": camera_name or edge_camera_id,
        "timestamp": ts,
        "analysis": {
            "overallDescription": analysis_result.get("overallDescription") or "",
            "overallRiskLevel": analysis_result.get("overallRiskLevel") or "Low",
            "constructionSafety": _coerce_category(analysis_result.get("constructionSafety")),
            "fireSafety": _coerce_category(analysis_result.get("fireSafety")),
            "propertySecurity": _coerce_category(analysis_result.get("propertySecurity")),
            "peopleCount": analysis_result.get("peopleCount"),
            "missingHardhats": analysis_result.get("missingHardhats"),
            "missingVests": analysis_result.get("missingVests"),
        },
    }
