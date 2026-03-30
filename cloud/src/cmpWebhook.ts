/**
 * CMP Webhook Sender
 *
 * Builds payloads and POSTs them to the Central Monitoring Platform (CMP)
 * webhook endpoint.  Mirrors the logic previously in Python's
 * cmp_webhook.py + alarm_observer.py so the full edge pipeline runs in
 * Node.js.
 *
 * Payload shapes are aligned with:
 *   CCTVCMP-linux/lib/validations/webhook.ts  → edgeReportSchema
 *   CCTVCMP-linux/app/api/webhook/edge-report/route.ts
 */

import type { SafetyAnalysisResult } from './types.js';

// ── Types ────────────────────────────────────────────────────────────

export interface CentralServerConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  vercelBypassToken?: string;
}

interface SafetyCategory {
  summary: string;
  issues: string[];
  recommendations: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function utcIsoTimestamp(): string {
  return new Date().toISOString().replace('+00:00', 'Z');
}

function coerceCategory(raw: unknown): SafetyCategory {
  if (!raw || typeof raw !== 'object') return { summary: '', issues: [], recommendations: [] };
  const r = raw as Record<string, unknown>;
  return {
    summary: typeof r.summary === 'string' ? r.summary : '',
    issues: Array.isArray(r.issues) ? r.issues.filter((x): x is string => typeof x === 'string') : [],
    recommendations: Array.isArray(r.recommendations) ? r.recommendations.filter((x): x is string => typeof x === 'string') : [],
  };
}

// ── Payload Builders ─────────────────────────────────────────────────

export function buildKeepalivePayload(
  cameraId: string,
  cameraName: string,
  streamUrl?: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    edgeCameraId: cameraId,
    cameraName: cameraName || cameraId,
    timestamp: utcIsoTimestamp(),
    messageType: 'keepalive',
    keepalive: true,
  };
  if (streamUrl) payload.streamUrl = streamUrl;
  return payload;
}

export function buildAnalysisReportPayload(
  cameraId: string,
  cameraName: string,
  analysis: SafetyAnalysisResult,
  streamUrl?: string,
  includeImage = false,
): Record<string, unknown> {
  const analysisObj: Record<string, unknown> = {
    overallDescription: analysis.overallDescription || '',
    overallRiskLevel: analysis.overallRiskLevel || 'Low',
    constructionSafety: coerceCategory(analysis.constructionSafety),
    fireSafety: coerceCategory(analysis.fireSafety),
    propertySecurity: coerceCategory(analysis.propertySecurity),
    peopleCount: analysis.peopleCount,
    missingHardhats: analysis.missingHardhats,
    missingVests: analysis.missingVests,
  };
  if (Array.isArray(analysis.detections)) {
    analysisObj.detections = analysis.detections;
  }

  const payload: Record<string, unknown> = {
    edgeCameraId: cameraId,
    cameraName: cameraName || cameraId,
    timestamp: utcIsoTimestamp(),
    eventImageIncluded: includeImage,
    analysis: analysisObj,
  };
  if (streamUrl) payload.streamUrl = streamUrl;
  return payload;
}

// ── HTTP Sender ──────────────────────────────────────────────────────

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;

/**
 * POST a payload to the CMP webhook, optionally including a JPEG image
 * as multipart/form-data.
 *
 * Runs fire-and-forget in the background (returns a Promise but callers
 * typically don't await it on the hot path).
 */
export async function sendToCMP(
  config: CentralServerConfig,
  payload: Record<string, unknown>,
  imageBuffer?: Buffer | null,
): Promise<void> {
  if (!config.enabled || !config.url || !config.apiKey) return;

  const url = config.url.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'X-API-Key': config.apiKey };
  if (config.vercelBypassToken?.trim()) {
    headers['x-vercel-protection-bypass'] = config.vercelBypassToken.trim();
  }

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      let resp: Response;

      if (imageBuffer && imageBuffer.length > 0) {
        const formData = new FormData();
        // Use plain string for 'payload' -- Node.js Blob in FormData does not
        // serialize correctly with the built-in fetch, causing "Missing field" errors.
        formData.append('payload', JSON.stringify(payload));
        formData.append('image', new Blob([new Uint8Array(imageBuffer)], { type: 'image/jpeg' }), 'frame.jpg');
        resp = await fetch(url, {
          method: 'POST',
          headers,
          body: formData,
          signal: AbortSignal.timeout(30_000),
        });
      } else {
        resp = await fetch(url, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15_000),
        });
      }

      if (resp.ok) {
        const tag = (payload.messageType === 'keepalive') ? 'keepalive' : 'report';
        const img = imageBuffer ? 'yes' : 'no';
        console.log(`[cmpWebhook] ${tag} sent for ${payload.edgeCameraId} (image=${img})`);
        return;
      }
      const text = await resp.text().catch(() => '');
      console.warn(`[cmpWebhook] CMP returned ${resp.status} (attempt ${attempt + 1}/${RETRY_ATTEMPTS}): ${text.slice(0, 200)}`);
    } catch (err) {
      console.warn(`[cmpWebhook] attempt ${attempt + 1}/${RETRY_ATTEMPTS} failed:`, (err as Error).message);
    }
    if (attempt < RETRY_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  console.error(`[cmpWebhook] Failed to send to CMP after ${RETRY_ATTEMPTS} attempts`);
}
