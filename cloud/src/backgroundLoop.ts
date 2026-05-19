/**
 * Background Analysis & Heartbeat Loops
 *
 * Replaces Python's _deepvision_background_loop and _heartbeat_loop.
 *
 * - Analysis loop: rotates through enabled cameras, captures an RTSP
 *   frame via ffmpeg, analyses with local Qwen+Gemma (inspector+evaluator), caches the
 *   result, and forwards it (with the image) to the CMP webhook.
 *
 * - Heartbeat loop: every 30 s sends a keepalive + snapshot to CMP so
 *   cameras stay marked "online" in the Edge Devices list.
 *
 * Both loops reload app.config.json every iteration so they pick up
 * edits from the PPE-UI Settings panel without a restart.
 */

import { Router, type Request, type Response } from 'express';
import { captureFrameFromRTSP, captureSingleFrameFromRTSP, getLatestFrame, getLastKnownFrame, getCaptureStatus, stopAllCaptures } from './rtspCapture.js';
import { analyzeImageBuffer } from './analyzeCore.js';
import { startGo2RTC, stopGo2RTC, updateGo2RTCStreams } from './go2rtcManager.js';
import {
  buildKeepalivePayload,
  buildAnalysisReportPayload,
  sendToCMP,
  type CentralServerConfig,
} from './cmpWebhook.js';
import { loadConfig } from './configRoute.js';
import { getVisionConfig } from './visionModels.js';
import { detectImageWithYolo, type YoloDetection } from './yoloClient.js';
import type { SafetyAnalysisResult } from './types.js';

type GateDecision = 'analyzed' | 'skipped_no_interest' | 'periodic' | 'scene_change' | 'yolo_error_fallback' | 'disabled';

interface YoloGateMeta {
  decision: GateDecision;
  reason: string;
  detectionCount?: number;
  interestingCount?: number;
  yoloLatencyMs?: number;
  sceneChangeScore?: number;
}

interface PendingAnalysis {
  frame: Buffer;
  yoloDetections?: YoloDetection[];
  yoloGate?: YoloGateMeta;
}

function tryStartPendingAnalyses(cfg: Record<string, unknown>): void {
  const cameras = getEnabledCameras(cfg);
  const maxConcurrent = getVisionConfig().maxConcurrentLocalVllm;
  for (const cam of cameras) {
    if (activeAnalysisCount >= maxConcurrent) return;
    if (!pendingFrames.has(cam.id) || analysisInFlight.has(cam.id)) continue;
    const pending = pendingFrames.get(cam.id)!;
    pendingFrames.delete(cam.id);
    analysisInFlight.add(cam.id);
    activeAnalysisCount++;
    void (async () => {
      try {
        const result = await analyzeImageBuffer(pending.frame, 'zh-TW', {
          yoloDetections: pending.yoloDetections,
          yoloGate: pending.yoloGate,
        });
        latestResults.set(cam.id, buildCachedResult(cam.id, cam.name, result));
        lastVlmAnalysisAt.set(cam.id, Date.now());

        const central = getCentralConfig(cfg);
        const now = Date.now();
        const canSend = shouldSendAnalysisToCmp(cam.id, result, now);
        if (result.localMeta?.shouldReport === false) {
          console.log(
            `[backgroundLoop] CMP report suppressed (evaluator: shouldReport=false) camera=${cam.id}`,
          );
        } else if (canSend) {
          const payload = buildAnalysisReportPayload(
            cam.id,
            cam.name,
            result,
            cam.url,
            true,
            true,
          );
          lastAnalysisReportSentAt.set(cam.id, now);
          lastAnalysisReportFingerprint.set(cam.id, analysisFingerprint(result));
          sendToCMP(central, payload, pending.frame).catch(() => {});
        } else {
          console.log(
            `[backgroundLoop] CMP analysis POST skipped (policy/throttle) camera=${cam.id} fp=${analysisFingerprint(result)}`,
          );
        }
      } catch (err) {
        console.error('[backgroundLoop] pending analysis error:', (err as Error).message);
      } finally {
        analysisInFlight.delete(cam.id);
        activeAnalysisCount = Math.max(0, activeAnalysisCount - 1);
        tryStartPendingAnalyses(loadConfig());
      }
    })();
  }
}

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
    localMeta?: unknown;
  };
}

interface GateStatus {
  camera_id: string;
  camera_name: string;
  updated_at: number;
  decision: GateDecision;
  reason: string;
  skipped_count: number;
  yolo_detection_count: number;
  yolo_interesting_count: number;
  yolo_latency_ms?: number;
  scene_change_score?: number;
  last_vlm_analysis_age_sec?: number;
}

// ── State ────────────────────────────────────────────────────────────

const latestResults = new Map<string, CachedResult>();
/** Last time we sent an analysis report to CMP (for min-interval throttling). */
const lastAnalysisReportSentAt = new Map<string, number>();
/** Last report fingerprint sent to CMP, used to avoid duplicate clean reports. */
const lastAnalysisReportFingerprint = new Map<string, string>();
let analysisIndex = 0;
/** Latest captured JPEG per camera (replaced each capture — latest wins). */
const pendingFrames = new Map<string, PendingAnalysis>();
/** Camera IDs with an analysis in flight (avoid duplicate submits). */
const analysisInFlight = new Set<string>();
const lastVlmAnalysisAt = new Map<string, number>();
const lastGateFrame = new Map<string, Buffer>();
const gateStatuses = new Map<string, GateStatus>();
const gateSkippedCounts = new Map<string, number>();
let analysisTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let heartbeatIndex = 0;
let activeAnalysisCount = 0;

// Stability mode: leave larger gaps so the local vision server can answer
// health checks and avoid being permanently saturated by analysis traffic.
const ANALYSIS_PRODUCER_DELAY_MS = 20_000;

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
      localMeta: analysis.localMeta,
    },
  };
}

function analysisFingerprint(r: SafetyAnalysisResult): string {
  const d = r.detections?.length ?? 0;
  return `${r.overallRiskLevel}|${d}|${r.peopleCount ?? 0}`;
}

function normalizeClassName(name: string): string {
  return name.toLowerCase().replace(/[\s-]+/g, '_');
}

function isClassOfInterest(name: string, classesOfInterest: string[]): boolean {
  const n = normalizeClassName(name);
  return classesOfInterest.some((c) => {
    const target = normalizeClassName(c);
    return n === target || n.includes(target) || target.includes(n);
  });
}

function frameDifferenceScore(prev: Buffer | undefined, next: Buffer): number {
  if (!prev || prev.length === 0 || next.length === 0) return 1;
  const n = Math.min(prev.length, next.length);
  const samples = Math.min(2048, n);
  const stride = Math.max(1, Math.floor(n / samples));
  let total = 0;
  let count = 0;
  for (let i = 0; i < n; i += stride) {
    total += Math.abs(prev[i] - next[i]) / 255;
    count++;
  }
  return count > 0 ? total / count : 1;
}

function updateGateStatus(
  camera: CameraConfig,
  meta: YoloGateMeta,
): void {
  const now = Date.now();
  const skipped = gateSkippedCounts.get(camera.id) ?? 0;
  const last = lastVlmAnalysisAt.get(camera.id);
  gateStatuses.set(camera.id, {
    camera_id: camera.id,
    camera_name: camera.name,
    updated_at: now / 1000,
    decision: meta.decision,
    reason: meta.reason,
    skipped_count: skipped,
    yolo_detection_count: meta.detectionCount ?? 0,
    yolo_interesting_count: meta.interestingCount ?? 0,
    yolo_latency_ms: meta.yoloLatencyMs,
    scene_change_score: meta.sceneChangeScore,
    last_vlm_analysis_age_sec: last ? (now - last) / 1000 : undefined,
  });
}

async function shouldAnalyzeFrame(
  camera: CameraConfig,
  frameJpeg: Buffer,
): Promise<{ analyze: boolean; yoloDetections?: YoloDetection[]; meta: YoloGateMeta }> {
  const cfg = getVisionConfig().yoloGate;
  const now = Date.now();
  const lastAnalyzed = lastVlmAnalysisAt.get(camera.id) ?? 0;
  const periodicDue =
    cfg.alwaysAnalyzeEverySec > 0 &&
    (!lastAnalyzed || now - lastAnalyzed >= cfg.alwaysAnalyzeEverySec * 1000);
  const sceneChangeScore = frameDifferenceScore(lastGateFrame.get(camera.id), frameJpeg);
  lastGateFrame.set(camera.id, frameJpeg);
  const sceneChanged = cfg.sceneChangeEnabled && sceneChangeScore >= cfg.sceneChangeThreshold;

  if (!cfg.enabled) {
    return {
      analyze: true,
      meta: {
        decision: 'disabled',
        reason: 'YOLO gate disabled; analyzing frame',
        sceneChangeScore,
      },
    };
  }

  try {
    const yolo = await detectImageWithYolo(frameJpeg);
    const filtered = yolo.detections.filter((d) => d.confidence >= cfg.minConfidence);
    const interesting = filtered.filter((d) => isClassOfInterest(d.class_name, cfg.classesOfInterest));
    const yoloLatencyMs = yolo.inference_ms;
    if (interesting.length > 0) {
      return {
        analyze: true,
        yoloDetections: filtered,
        meta: {
          decision: 'analyzed',
          reason: `YOLO found classes of interest: ${Array.from(new Set(interesting.map((d) => d.class_name))).join(', ')}`,
          detectionCount: filtered.length,
          interestingCount: interesting.length,
          yoloLatencyMs,
          sceneChangeScore,
        },
      };
    }
    if (sceneChanged) {
      return {
        analyze: true,
        yoloDetections: filtered,
        meta: {
          decision: 'scene_change',
          reason: `Scene change score ${sceneChangeScore.toFixed(3)} >= ${cfg.sceneChangeThreshold}`,
          detectionCount: filtered.length,
          interestingCount: 0,
          yoloLatencyMs,
          sceneChangeScore,
        },
      };
    }
    if (periodicDue) {
      return {
        analyze: true,
        yoloDetections: filtered,
        meta: {
          decision: 'periodic',
          reason: `Periodic analysis due after ${cfg.alwaysAnalyzeEverySec}s`,
          detectionCount: filtered.length,
          interestingCount: 0,
          yoloLatencyMs,
          sceneChangeScore,
        },
      };
    }
    return {
      analyze: false,
      yoloDetections: filtered,
      meta: {
        decision: 'skipped_no_interest',
        reason: 'No YOLO classes of interest, no significant scene change, and periodic analysis not due',
        detectionCount: filtered.length,
        interestingCount: 0,
        yoloLatencyMs,
        sceneChangeScore,
      },
    };
  } catch (err) {
    const reason = `YOLO unavailable: ${err instanceof Error ? err.message : String(err)}`;
    const shouldFallback =
      cfg.fallbackOnYoloError === 'analyze' ||
      (cfg.fallbackOnYoloError === 'periodic' && periodicDue);
    return {
      analyze: shouldFallback,
      meta: {
        decision: shouldFallback ? 'yolo_error_fallback' : 'skipped_no_interest',
        reason: shouldFallback ? `${reason}; fallback analysis allowed` : `${reason}; fallback skipped`,
        sceneChangeScore,
      },
    };
  }
}

/**
 * Whether to POST this analysis to CMP, given cost controls in vision.cmpReporting.
 */
function shouldSendAnalysisToCmp(
  cameraId: string,
  result: SafetyAnalysisResult,
  nowMs: number,
): boolean {
  if (result.localMeta?.shouldReport === false) {
    return false;
  }
  const { cmpReporting } = getVisionConfig();
  const { onlyReportElevated, minAnalysisReportIntervalSec } = cmpReporting;
  const fp = analysisFingerprint(result);
  const changedSinceLastReport = lastAnalysisReportFingerprint.get(cameraId) !== fp;
  if (onlyReportElevated) {
    const risk = (result.overallRiskLevel || 'Low') as string;
    const elevated = risk === 'Medium' || risk === 'High';
    const hasDet = (result.detections?.length ?? 0) > 0;
    if (!elevated && !hasDet && !changedSinceLastReport) {
      return false;
    }
  }
  if (minAnalysisReportIntervalSec > 0) {
    const last = lastAnalysisReportSentAt.get(cameraId) ?? 0;
    if (nowMs - last < minAnalysisReportIntervalSec * 1000) {
      return false;
    }
  }
  return true;
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
    if (!deepVisionEnabled) {
      scheduleAnalysis(getEffectiveInterval(cfg));
      return;
    }

    const cameras = getEnabledCameras(cfg);
    if (cameras.length === 0) {
      scheduleAnalysis(getEffectiveInterval(cfg));
      return;
    }

    const camera = cameras[analysisIndex % cameras.length];
    analysisIndex++;

    const frameJpeg = await captureSingleFrameFromRTSP(camera.url);
    if (!frameJpeg) {
      scheduleAnalysis(1_000);
      return;
    }

    const gate = await shouldAnalyzeFrame(camera, frameJpeg);
    updateGateStatus(camera, gate.meta);
    if (gate.analyze) {
      pendingFrames.set(camera.id, {
        frame: frameJpeg,
        yoloDetections: gate.yoloDetections,
        yoloGate: gate.meta,
      });
      tryStartPendingAnalyses(cfg);
    } else {
      gateSkippedCounts.set(camera.id, (gateSkippedCounts.get(camera.id) ?? 0) + 1);
      updateGateStatus(camera, gate.meta);
      console.log(
        `[backgroundLoop] YOLO gate skipped camera=${camera.id} reason=${gate.meta.reason}`,
      );
    }

    scheduleAnalysis(ANALYSIS_PRODUCER_DELAY_MS);
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

/** Minimum 2s between keepalives to avoid runaway on bad config. */
const HEARTBEAT_MIN_MS = 2_000;

async function heartbeatIteration(): Promise<void> {
  try {
    const cfg = loadConfig();
    const cameras = getEnabledCameras(cfg);
    const central = getCentralConfig(cfg);

    if (cameras.length === 0) {
      scheduleHeartbeat();
      return;
    }

    const cam = cameras[heartbeatIndex % cameras.length];
    heartbeatIndex++;

    // Send a lightweight fresh frame to CMP without keeping persistent
    // ffmpeg workers alive for all cameras.
    const snapshot = await captureSingleFrameFromRTSP(cam.url);
    const payload = buildKeepalivePayload(cam.id, cam.name, cam.url);
    sendToCMP(central, payload, snapshot).catch(() => {});
  } catch (err) {
    console.error('[backgroundLoop] heartbeat error:', (err as Error).message);
  }
  scheduleHeartbeat();
}

function scheduleHeartbeat(): void {
  if (!running) return;
  const cfg = loadConfig();
  const cameraCount = Math.max(1, getEnabledCameras(cfg).length);
  const fullCycleMs = Math.max(
    HEARTBEAT_MIN_MS,
    getVisionConfig().cmpReporting.heartbeatIntervalSec * 1000,
  );
  const perCameraMs = Math.max(HEARTBEAT_MIN_MS, Math.floor(fullCycleMs / cameraCount));
  heartbeatTimer = setTimeout(() => { heartbeatIteration(); }, perCameraMs);
}

// ── Stream Config Refresh ───────────────────────────────────────────
// Keep go2rtc stream definitions in sync with app.config.json. Snapshot
// ffmpeg captures are started lazily by GET /api/snapshot/:cameraId so the
// browser only pays for cameras visible on the current UI page.

const WARMUP_INTERVAL_MS = 10_000;

async function warmupIteration(): Promise<void> {
  try {
    const cfg = loadConfig();
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
  const yoloGate = Array.from(gateStatuses.values())
    .sort((a, b) => b.updated_at - a.updated_at);
  res.json({ results, yoloGate });
});

router.get('/deepvision/gate', (_req: Request, res: Response) => {
  const yoloGate = Array.from(gateStatuses.values())
    .sort((a, b) => b.updated_at - a.updated_at);
  res.json({ yoloGate });
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
    // The stale watchdog or ffmpeg's own RTSP timeout will trigger a restart shortly.
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
