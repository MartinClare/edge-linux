/**
 * Edge vision model registry: default `local_gemma4_e4b` via FastAPI on port 8001.
 * The FastAPI server can use embedded vLLM or Transformers internally.
 */

import { loadConfig } from './configRoute.js';

export type VisionActiveModel =
  | 'local_qwen2_5_vl_7b'
  | 'local_qwen3_vl_8b'
  /** Qwen3-VL via local vLLM OpenAI server (separate port, e.g. 8002). */
  | 'local_qwen3_vllm'
  | 'local_gemma4_e4b'
  | 'local_gemma3n_e4b'
  | 'local_gemma3n_e2b'
  | 'openrouter';

/** Python `/v1/vision/generate` `model_id` (when using local server). */
export const LOCAL_MODEL_IDS = {
  QWEN25: 'qwen2-5-vl-7b',
  QWEN3: 'qwen3-vl-8b',
  GEMMA4: 'gemma-4-e4b',
  GEMMA3N_E4B: 'gemma-3n-e4b',
  GEMMA3N_E2B: 'gemma-3n-e2b',
} as const;

export const VISION_MODEL_LABELS: Record<VisionActiveModel, string> = {
  local_qwen2_5_vl_7b: 'Qwen2.5-VL-7B-Instruct (local)',
  local_qwen3_vl_8b: 'Qwen3-VL-8B-Instruct (local)',
  local_qwen3_vllm: 'Qwen3-VL (local vLLM)',
  local_gemma4_e4b: 'Gemma-4-E4B-IT (local FastAPI vLLM)',
  local_gemma3n_e4b: 'Gemma-3n-E4B-IT (local)',
  local_gemma3n_e2b: 'Gemma-3n-E2B-IT (local)',
  openrouter: 'OpenRouter (online)',
};

const DEFAULTS = {
  activeModel: 'local_gemma4_e4b' as VisionActiveModel,
  openrouterModel:
    process.env.EDGE_OPENROUTER_MODEL || 'qwen/qwen3-vl-32b-instruct',
  openrouterModelFallback:
    (process.env.EDGE_OPENROUTER_FALLBACK_MODEL || '').trim(),
  /** Base URL for vLLM OpenAI API (no path). */
  localVllmApiUrl: process.env.LOCAL_VLLM_API_URL || 'http://127.0.0.1:8002',
  /** Must match vLLM --served-model-name. No implicit fallback model. */
  localVllmModel: (process.env.LOCAL_VLLM_MODEL || '').trim(),
  localVllmTimeoutMs: Math.max(
    5_000,
    parseInt(process.env.LOCAL_VLLM_TIMEOUT_MS || '600000', 10) || 600_000,
  ),
  /** Concurrent vision jobs when using a vLLM-backed local model. */
  maxConcurrentLocalVllm: Math.max(
    1,
    parseInt(process.env.LOCAL_VLLM_MAX_CONCURRENT || '2', 10) || 2,
  ),
  yoloGate: {
    enabled: true,
    mode: 'person_or_change_or_interval',
    minConfidence: 0.35,
    alwaysAnalyzeEverySec: 300,
    sceneChangeEnabled: true,
    sceneChangeThreshold: 0.08,
    fallbackOnYoloError: 'periodic' as 'periodic' | 'analyze' | 'skip',
    classesOfInterest: [
      'person',
      'worker',
      'no_hardhat',
      'no-hardhat',
      'no_helmet',
      'no-helmet',
      'no_vest',
      'no-vest',
      'no_hardhat_no_vest',
      'hardhat',
      'helmet',
      'vest',
      'crane',
      'excavator',
      'truck',
      'forklift',
      'machinery',
    ],
  },
  maxNewTokens: 1536,
  cmpReporting: {
    /** Seconds between keepalive+snapshot heartbeats to CMP. */
    heartbeatIntervalSec: 300,
    /** If true, only post analysis to CMP when risk is Medium/High or there are detections. */
    onlyReportElevated: true,
    /** Minimum seconds between per-camera analysis report POSTs to CMP. */
    minAnalysisReportIntervalSec: 60,
  },
};

export type VisionConfig = {
  activeModel: VisionActiveModel;
  openrouterModel: string;
  openrouterModelFallback: string;
  localVllmApiUrl: string;
  localVllmModel: string;
  localVllmTimeoutMs: number;
  maxConcurrentLocalVllm: number;
  yoloGate: {
    enabled: boolean;
    mode: string;
    minConfidence: number;
    alwaysAnalyzeEverySec: number;
    sceneChangeEnabled: boolean;
    sceneChangeThreshold: number;
    fallbackOnYoloError: 'periodic' | 'analyze' | 'skip';
    classesOfInterest: string[];
  };
  maxNewTokens: number;
  cmpReporting: {
    heartbeatIntervalSec: number;
    onlyReportElevated: boolean;
    minAnalysisReportIntervalSec: number;
  };
};

function isVisionActiveModel(s: string): s is VisionActiveModel {
  return (
    s === 'local_qwen2_5_vl_7b' ||
    s === 'local_qwen3_vl_8b' ||
    s === 'local_qwen3_vllm' ||
    s === 'local_gemma4_e4b' ||
    s === 'local_gemma3n_e4b' ||
    s === 'local_gemma3n_e2b' ||
    s === 'openrouter'
  );
}

/**
 * Return resolved vision config from app.config.json merged with env defaults.
 */
export function getVisionConfig(): VisionConfig {
  const root = loadConfig() as {
    vision?: Record<string, unknown>;
  };
  const v = root.vision;
  if (!v || typeof v !== 'object') {
    return { ...DEFAULTS, cmpReporting: { ...DEFAULTS.cmpReporting } };
  }
  const cr = v.cmpReporting as Record<string, unknown> | undefined;
  const yg = v.yoloGate as Record<string, unknown> | undefined;
  const am = v.activeModel;
  const fallbackOnYoloError =
    yg?.fallbackOnYoloError === 'analyze' || yg?.fallbackOnYoloError === 'skip'
      ? yg.fallbackOnYoloError
      : DEFAULTS.yoloGate.fallbackOnYoloError;
  const activeModel: VisionActiveModel =
    typeof am === 'string' && isVisionActiveModel(am)
      ? am
      : DEFAULTS.activeModel;
  const localVllmModel =
    typeof v.localVllmModel === 'string' && v.localVllmModel.trim()
      ? v.localVllmModel.trim()
      : DEFAULTS.localVllmModel;
  if (activeModel === 'local_qwen3_vllm' && !localVllmModel) {
    throw new Error(
      'Vision config error: `vision.localVllmModel` is required when `vision.activeModel` is `local_qwen3_vllm`.',
    );
  }
  return {
    activeModel,
    openrouterModel:
      typeof v.openrouterModel === 'string' && v.openrouterModel.trim()
        ? v.openrouterModel.trim()
        : DEFAULTS.openrouterModel,
    openrouterModelFallback:
      typeof v.openrouterModelFallback === 'string' && v.openrouterModelFallback.trim()
        ? v.openrouterModelFallback.trim()
        : DEFAULTS.openrouterModelFallback,
    localVllmApiUrl:
      typeof v.localVllmApiUrl === 'string' && v.localVllmApiUrl.trim()
        ? v.localVllmApiUrl.trim().replace(/\/$/, '')
        : DEFAULTS.localVllmApiUrl,
    localVllmModel,
    localVllmTimeoutMs: Math.max(
      5_000,
      parseInt(String(v.localVllmTimeoutMs ?? DEFAULTS.localVllmTimeoutMs), 10) ||
        DEFAULTS.localVllmTimeoutMs,
    ),
    maxConcurrentLocalVllm: Math.max(
      1,
      Math.min(
        32,
        parseInt(String(v.maxConcurrentLocalVllm ?? DEFAULTS.maxConcurrentLocalVllm), 10) ||
          DEFAULTS.maxConcurrentLocalVllm,
      ),
    ),
    yoloGate: {
      enabled: yg?.enabled !== false,
      mode: typeof yg?.mode === 'string' && yg.mode.trim()
        ? yg.mode.trim()
        : DEFAULTS.yoloGate.mode,
      minConfidence: Math.max(
        0,
        Math.min(
          1,
          Number(yg?.minConfidence ?? DEFAULTS.yoloGate.minConfidence) ||
            DEFAULTS.yoloGate.minConfidence,
        ),
      ),
      alwaysAnalyzeEverySec: Math.max(
        0,
        parseInt(
          String(yg?.alwaysAnalyzeEverySec ?? DEFAULTS.yoloGate.alwaysAnalyzeEverySec),
          10,
        ) || DEFAULTS.yoloGate.alwaysAnalyzeEverySec,
      ),
      sceneChangeEnabled: yg?.sceneChangeEnabled !== false,
      sceneChangeThreshold: Math.max(
        0,
        Math.min(
          1,
          Number(yg?.sceneChangeThreshold ?? DEFAULTS.yoloGate.sceneChangeThreshold) ||
            DEFAULTS.yoloGate.sceneChangeThreshold,
        ),
      ),
      fallbackOnYoloError,
      classesOfInterest: Array.isArray(yg?.classesOfInterest)
        ? yg.classesOfInterest
            .filter((c): c is string => typeof c === 'string' && !!c.trim())
            .map((c) => c.trim())
        : [...DEFAULTS.yoloGate.classesOfInterest],
    },
    maxNewTokens: Math.max(
      64,
      Math.min(4096, parseInt(String(v.maxNewTokens ?? ''), 10) || DEFAULTS.maxNewTokens),
    ),
    cmpReporting: {
      heartbeatIntervalSec: Math.max(
        30,
        parseInt(String(cr?.heartbeatIntervalSec ?? DEFAULTS.cmpReporting.heartbeatIntervalSec), 10) ||
          DEFAULTS.cmpReporting.heartbeatIntervalSec,
      ),
      onlyReportElevated: cr?.onlyReportElevated !== false,
      minAnalysisReportIntervalSec: Math.max(
        0,
        parseInt(
          String(
            cr?.minAnalysisReportIntervalSec ??
              DEFAULTS.cmpReporting.minAnalysisReportIntervalSec,
          ),
          10,
        ) || DEFAULTS.cmpReporting.minAnalysisReportIntervalSec,
      ),
    },
  };
}

/**
 * Map UI/config active model to local Python `model_id`.
 */
export function localModelIdFromActive(
  m: VisionActiveModel,
): typeof LOCAL_MODEL_IDS[keyof typeof LOCAL_MODEL_IDS] | null {
  if (m === 'local_qwen2_5_vl_7b') return LOCAL_MODEL_IDS.QWEN25;
  if (m === 'local_qwen3_vl_8b') return LOCAL_MODEL_IDS.QWEN3;
  if (m === 'local_qwen3_vllm') return null;
  if (m === 'local_gemma4_e4b') return LOCAL_MODEL_IDS.GEMMA4;
  if (m === 'local_gemma3n_e4b') return LOCAL_MODEL_IDS.GEMMA3N_E4B;
  if (m === 'local_gemma3n_e2b') return LOCAL_MODEL_IDS.GEMMA3N_E2B;
  return null;
}

/** Display name for localMeta (inspector) — human-readable. */
export function inspectorModelLabel(
  m: VisionActiveModel,
  paths?: { qwen25?: string; qwen3?: string; gemma4?: string; gemma3nE4b?: string; gemma3nE2b?: string },
): string {
  if (m === 'openrouter') {
    return getVisionConfig().openrouterModel;
  }
  if (m === 'local_qwen3_vllm') {
    return getVisionConfig().localVllmModel;
  }
  if (m === 'local_qwen2_5_vl_7b') return paths?.qwen25 || VISION_MODEL_LABELS.local_qwen2_5_vl_7b;
  if (m === 'local_qwen3_vl_8b') return paths?.qwen3 || VISION_MODEL_LABELS.local_qwen3_vl_8b;
  if (m === 'local_gemma4_e4b') return paths?.gemma4 || VISION_MODEL_LABELS.local_gemma4_e4b;
  if (m === 'local_gemma3n_e4b') return paths?.gemma3nE4b || VISION_MODEL_LABELS.local_gemma3n_e4b;
  if (m === 'local_gemma3n_e2b') return paths?.gemma3nE2b || VISION_MODEL_LABELS.local_gemma3n_e2b;
  return VISION_MODEL_LABELS.local_gemma4_e4b;
}

/**
 * Global concurrent vision jobs (local Transformers: 1; vLLM: configurable; OpenRouter: generous default).
 */
export function getVisionConcurrencyLimit(): number {
  const v = getVisionConfig();
  if (v.activeModel === 'openrouter') {
    const n = parseInt(process.env.OPENROUTER_MAX_CONCURRENT || '8', 10);
    return Number.isFinite(n) && n >= 1 ? Math.min(64, n) : 8;
  }
  if (
    v.activeModel === 'local_qwen3_vllm' ||
    v.activeModel === 'local_gemma4_e4b' ||
    v.activeModel === 'local_gemma3n_e4b' ||
    v.activeModel === 'local_gemma3n_e2b'
  ) {
    return Math.max(1, v.maxConcurrentLocalVllm);
  }
  return 1;
}
