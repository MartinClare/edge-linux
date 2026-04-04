/**
 * Background Analysis & Heartbeat Loops
 *
 * Replaces Python's _deepvision_background_loop and _heartbeat_loop.
 *
 * - Analysis loop: rotates through enabled cameras, captures an RTSP
 *   frame via ffmpeg, analyses it with the OpenRouter LLM, caches the
 *   result, and forwards it (with the image) to the CMP webhook.
 *
 * - Heartbeat loop: every 30 s sends a keepalive + snapshot to CMP so
 *   cameras stay marked "online" in the Edge Devices list.
 *
 * Both loops reload app.config.json every iteration so they pick up
 * edits from the PPE-UI Settings panel without a restart.
 */

import { Router, type Request, type Response } from 'express';
import { captureFrameFromRTSP, getLatestFrame, getLastKnownFrame, getCaptureStatus, stopAllCaptures } from './rtspCapture.js';
import { analyzeImageBuffer } from './analyzeCore.js';
import { startGo2RTC, stopGo2RTC, updateGo2RTCStreams } from './go2rtcManager.js';
import {
  buildKeepalivePayload,
  buildAnalysisReportPayload,
  sendToCMP,
  type CentralServerConfig,
} from './cmpWebhook.js';
import { loadConfig } from './configRoute.js';
import type { SafetyAnalysisResult } from './types.js';

// ── Types ────────────────────────────────────────────────────────────

interface CameraConfig {
  id: string;
  name: string;
  url: string;            // RTSP URL (for background capture)
  browserUrl?: string;    // MJPEG URL (for PPE-UI direct display)
  enabled: boolean;
}

interface CachedResult {
  camera_id: string;
  camera_name: string;
  updated_at: number;     // epoch seconds
  analysis: {
    overallDescription: string;
    overallRiskLevel: string;
    peopleCount: number;
    missingHardhats: number;
    missingVests: number;
    constructionSafety: object;
    fireSafety: object;
    propertySecurity: object;
    detections?: unknown[];
  };
}

// ── State ────────────────────────────────────────────────────────────

const latestResults = new Map<string, CachedResult>();
let analysisIndex = 0;
let analysisTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

// ── Helpers ──────────────────────────────────────────────────────────

function getEnabledCameras(cfg: Record<string, unknown>): CameraConfig[] {
  const rtsp = cfg.rtsp as Record<string, unknown> | undefined;
  if (!rtsp) return [];
  const cameras = rtsp.cameras as unknown[];
  if (!Array.isArray(cameras)) return [];
  return cameras.filter((c): c is CameraConfig => {
    if (!c || typeof c !== 'object') return false;
    const cam = c as Record<string, unknown>;
    return !!cam.enabled && typeof cam.url === 'string' && !!cam.url;
  }) as CameraConfig[];
}

function getCentralConfig(cfg: Record<string, unknown>): CentralServerConfig {
  const cs = cfg.centralServer as Record<string, unknown> | undefined;
  return {
    enabled: !!cs?.enabled,
    url: (cs?.url as string) || '',
    apiKey: (cs?.apiKey as string) || '',
    vercelBypassToken: (cs?.vercelBypassToken as string) || '',
  };
}

function buildCachedResult(
  cameraId: string,
  cameraName: string,
  analysis: SafetyAnalysisResult,
): CachedResult {
  return {
    camera_id: cameraId,
    camera_name: cameraName,
    updated_at: Date.now() / 1000,
    analysis: {
      overallDescription: analysis.overallDescription || '',
      overallRiskLevel: analysis.overallRiskLevel || 'Low',
      peopleCount: analysis.peopleCount ?? 0,
      missingHardhats: analysis.missingHardhats ?? 0,
      missingVests: analysis.missingVests ?? 0,
      constructionSafety: analysis.constructionSafety || { summary: '', issues: [], recommendations: [] },
      fireSafety: analysis.fireSafety || { summary: '', issues: [], recommendations: [] },
      propertySecurity: analysis.propertySecurity || { summary: '', issues: [], recommendations: [] },
      detections: analysis.detections,
    },
  };
}

// ── Analysis Loop ────────────────────────────────────────────────────

/**
 * Returns the analysis interval in milliseconds based on the day/night schedule.
 * Falls back to `geminiInterval` when the schedule is disabled or misconfigured.
 */
function getEffectiveInterval(cfg: Record<string, unknown>): number {
  const rtsp = cfg.rtsp as Record<string, unknown> | undefined;
  const defaultMs = Math.max(1, Number(rtsp?.geminiInterval) || 5) * 1000;

  const schedule = rtsp?.schedule as Record<string, unknown> | undefined;
  if (!schedule?.enabled) return defaultMs;

  const parseHHMM = (t: unknown): number => {
    const parts = String(t ?? '').split(':');
    return (parseInt(parts[0] ?? '0', 10) || 0) * 60 + (parseInt(parts[1] ?? '0', 10) || 0);
  };

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dayStartMin = parseHHMM(schedule.dayStart ?? '07:00');
  const dayEndMin   = parseHHMM(schedule.dayEnd   ?? '19:00');

  const isDay = nowMin >= dayStartMin && nowMin < dayEndMin;
  const intervalSec = isDay
    ? Math.max(1, Number(schedule.dayInterval)   || 60)
    : Math.max(1, Number(schedule.nightInterval) || 600);

  return intervalSec * 1000;
}

async function analysisIteration(): Promise<void> {
  try {
    const cfg = loadConfig();
    const ui = cfg.ui as Record<string, unknown> | undefined;
    const deepVisionEnabled = ui?.deepVisionEnabled !== false;
    const interval = getEffectiveInterval(cfg);

    if (!deepVisionEnabled) {
      scheduleAnalysis(interval);
      return;
    }

    const cameras = getEnabledCameras(cfg);
    if (cameras.length === 0) {
      scheduleAnalysis(interval);
      return;
    }

    const camera = cameras[analysisIndex % cameras.length];
    analysisIndex++;

    const frameJpeg = await captureFrameFromRTSP(camera.url);
    if (!frameJpeg) {
      scheduleAnalysis(1_000);
      return;
    }

    const result = await analyzeImageBuffer(frameJpeg);
    if (result) {
      latestResults.set(camera.id, buildCachedResult(camera.id, camera.name, result));

      const central = getCentralConfig(cfg);
      // Frame was just captured successfully → stream is healthy
      const payload = buildAnalysisReportPayload(
        camera.id,
        camera.name,
        result,
        camera.url,
        true,
        true,
      );
      sendToCMP(central, payload, frameJpeg).catch(() => {});
    }

    scheduleAnalysis(interval);
  } catch (err) {
    console.error('[backgroundLoop] analysis iteration error:', (err as Error).message);
    scheduleAnalysis(2_000);
  }
}

function scheduleAnalysis(delayMs: number): void {
  if (!running) return;
  analysisTimer = setTimeout(() => { analysisIteration(); }, delayMs);
}

// ── Heartbeat Loop ───────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;

async function heartbeatIteration(): Promise<void> {
  try {
    const cfg = loadConfig();
    const cameras = getEnabledCameras(cfg);
    const central = getCentralConfig(cfg);

    for (const cam of cameras) {
      const snapshot = await captureFrameFromRTSP(cam.url);
      const payload = buildKeepalivePayload(cam.id, cam.name, cam.url);
      sendToCMP(central, payload, snapshot).catch(() => {});
    }
  } catch (err) {
    console.error('[backgroundLoop] heartbeat error:', (err as Error).message);
  }
  scheduleHeartbeat();
}

function scheduleHeartbeat(): void {
  if (!running) return;
  heartbeatTimer = setTimeout(() => { heartbeatIteration(); }, HEARTBEAT_INTERVAL_MS);
}

// ── Camera Warm-up ──────────────────────────────────────────────────
// Ensures persistent ffmpeg processes are started for all enabled cameras
// so that GET /api/snapshot/:cameraId always has a fresh frame.

const WARMUP_INTERVAL_MS = 10_000;

async function warmupIteration(): Promise<void> {
  try {
    const cfg = loadConfig();
    const cameras = getEnabledCameras(cfg);
    // Keep persistent ffmpeg captures alive for snapshot endpoint
    for (const cam of cameras) {
      captureFrameFromRTSP(cam.url);
    }
    // Keep go2rtc streams in sync with config
    updateGo2RTCStreams(buildGo2RTCStreams(cfg));
  } catch (err) {
    console.error('[backgroundLoop] warmup error:', (err as Error).message);
  }
  scheduleSnapshot();
}

function scheduleSnapshot(): void {
  if (!running) return;
  snapshotTimer = setTimeout(() => { warmupIteration(); }, WARMUP_INTERVAL_MS);
}

// ── Lifecycle ────────────────────────────────────────────────────────

function buildGo2RTCStreams(cfg: Record<string, unknown>): Record<string, string> {
  const cameras = getEnabledCameras(cfg);
  return Object.fromEntries(cameras.map((c) => [c.id, c.url]));
}

export function startBackgroundLoops(): void {
  if (running) return;
  running = true;
  console.log('[backgroundLoop] Starting analysis loop + heartbeat loop + snapshot loop');

  const cfg = loadConfig();
  startGo2RTC(buildGo2RTCStreams(cfg));

  analysisIteration();
  heartbeatIteration();
  warmupIteration();
}

export async function stopBackgroundLoops(): Promise<void> {
  running = false;
  if (analysisTimer) { clearTimeout(analysisTimer); analysisTimer = null; }
  if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
  if (snapshotTimer) { clearTimeout(snapshotTimer); snapshotTimer = null; }
  await stopAllCaptures();
  stopGo2RTC();
  console.log('[backgroundLoop] Stopped');
}

// ── Express Route: GET /api/deepvision/latest ────────────────────────

const router = Router();

// A frame older than this is considered stale (stream has stopped delivering).
// The stale watchdog in rtspCapture.ts kills the ffmpeg process after 20 s of
// no frames, so in practice 'stale' is a very brief transient state.
const SNAPSHOT_STALE_MS = 30_000;

const SNAPSHOT_HEADERS = {
  'Content-Type': 'image/jpeg',
  'Cache-Control': 'no-store, max-age=0',
  'Pragma': 'no-cache',
} as const;

router.get('/deepvision/latest', (_req: Request, res: Response) => {
  const results = Array.from(latestResults.values())
    .sort((a, b) => b.updated_at - a.updated_at);
  res.json({ results });
});

router.get('/snapshot/:cameraId', (req: Request, res: Response) => {
  const cfg = loadConfig();
  const cameras = getEnabledCameras(cfg);
  const cam = cameras.find((c) => c.id === req.params.cameraId);
  if (!cam) { res.status(404).json({ error: 'Camera not found' }); return; }

  const status = getCaptureStatus(cam.url, SNAPSHOT_STALE_MS);

  if (status === 'live') {
    const jpeg = getLatestFrame(cam.url, SNAPSHOT_STALE_MS)!;
    res.set(SNAPSHOT_HEADERS);
    res.send(jpeg);
    return;
  }

  // Ensure ffmpeg is running in all non-live cases
  captureFrameFromRTSP(cam.url);

  // During connecting / stale / stopped: serve the last frame we have so the
  // UI keeps showing a (slightly stale) image rather than going blank.
  // The stale watchdog or ffmpeg's own -stimeout will trigger a restart shortly.
  const fallback =
    getLatestFrame(cam.url, Number.POSITIVE_INFINITY) ??
    getLastKnownFrame(cam.url);

  if (fallback) {
    res.set(SNAPSHOT_HEADERS);
    res.send(fallback);
    return;
  }

  // No frame has ever been received for this camera — keep polling.
  res.status(202).json({ status: 'connecting' });
});

export default router;
