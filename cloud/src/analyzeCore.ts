/**
 * Core image analysis: routes to local models (Qwen2.5 / Qwen3-VL-8B / Gemma),
 * local Qwen3-VL via vLLM (`local_qwen3_vllm`), or OpenRouter.
 */

import {
  callLocalVision,
  getAlertAnalysisPrompt,
  getEvaluatorPrompt,
  getSafetyAnalysisPrompt,
  type SupportedLanguage,
} from './visionClient.js';
import { callOpenRouterVision } from './openRouterVisionClient.js';
import { callLocalVllmVision } from './localVllmVisionClient.js';
import { withVisionConcurrency } from './visionConcurrency.js';
import {
  getVisionConfig,
  type VisionActiveModel,
  localModelIdFromActive,
  inspectorModelLabel,
} from './visionModels.js';
import type { EvaluatorConfidence, LocalAnalysisMetadata, SafetyAnalysisResult } from './types.js';

type YoloContextDetection = {
  class_name: string;
  confidence?: number;
  bbox?: number[];
};

type YoloGateContext = {
  decision: string;
  reason: string;
  detectionCount?: number;
  interestingCount?: number;
  yoloLatencyMs?: number;
  sceneChangeScore?: number;
};

type AnalyzeRequestOptions = {
  visionModel?: VisionActiveModel;
  yoloDetections?: YoloContextDetection[];
  yoloGate?: YoloGateContext;
};

const TWO_STAGE = process.env.LOCAL_VISION_TWO_STAGE === '1';
const EVALUATOR_ON_FAILURE_NO_REPORT = process.env.LOCAL_EVALUATOR_FAIL_NO_REPORT !== '0';

function buildVisionForRequest(override?: VisionActiveModel) {
  const v = getVisionConfig();
  if (override) return { ...v, activeModel: override };
  return v;
}

function buildYoloContextBlock(
  yoloDetections?: YoloContextDetection[],
  yoloGate?: YoloGateContext,
): string {
  if (!yoloGate && (!yoloDetections || yoloDetections.length === 0)) return '';
  const detections = (yoloDetections || [])
    .slice(0, 20)
    .map((d) => {
      const conf = typeof d.confidence === 'number' ? ` ${(d.confidence * 100).toFixed(0)}%` : '';
      const bbox = Array.isArray(d.bbox) ? ` bbox=[${d.bbox.map((n) => Math.round(n)).join(',')}]` : '';
      return `- ${d.class_name}${conf}${bbox}`;
    })
    .join('\n');
  return `\n\n**YOLO Pre-Screen Context:**\n- Gate decision: ${yoloGate?.decision || 'analyzed'}\n- Gate reason: ${yoloGate?.reason || 'YOLO context supplied'}\n- Detection count: ${yoloGate?.detectionCount ?? yoloDetections?.length ?? 0}\n${typeof yoloGate?.sceneChangeScore === 'number' ? `- Scene change score: ${yoloGate.sceneChangeScore.toFixed(3)}\n` : ''}${detections ? `- YOLO detections:\n${detections}\n` : '- YOLO detections: none above threshold\n'}\nUse YOLO detections as hints only; verify visually before reporting PPE violations or hazards.`;
}

function attachYoloMeta(
  meta: LocalAnalysisMetadata,
  yoloGate?: YoloGateContext,
): LocalAnalysisMetadata {
  return yoloGate ? { ...meta, yoloGate } : meta;
}

/**
 * Run one vision call (local or OpenRouter) based on `vision` config.
 */
export async function runVision(
  role: 'inspector' | 'evaluator' | 'alert',
  imageDataUrl: string,
  prompt: string,
  sizeKB: number,
  vision: ReturnType<typeof getVisionConfig>,
): Promise<string> {
  if (vision.activeModel === 'openrouter') {
    const m = imageDataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
    if (!m) {
      throw new Error('Invalid image data URL (expected data:<mime>;base64,...)');
    }
    return callOpenRouterVision(
      m[1],
      m[2].replace(/\s/g, ''),
      prompt,
      {
        model: vision.openrouterModel,
        fallbackModel: vision.openrouterModelFallback,
        maxTokens: vision.maxNewTokens,
        apiKey: process.env.OPENROUTER_API_KEY || '',
      },
    );
  }
  if (vision.activeModel === 'local_qwen3_vllm') {
    const m = imageDataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
    if (!m) {
      throw new Error('Invalid image data URL (expected data:<mime>;base64,...)');
    }
    return callLocalVllmVision(m[1], m[2].replace(/\s/g, ''), prompt, {
      baseUrl: vision.localVllmApiUrl,
      model: vision.localVllmModel,
      maxTokens: vision.maxNewTokens,
      timeoutMs: vision.localVllmTimeoutMs,
    });
  }
  const modelId = localModelIdFromActive(vision.activeModel);
  if (!modelId) {
    throw new Error('Invalid active vision model (expected local model id)');
  }
  return callLocalVision(role, imageDataUrl, prompt, sizeKB, {
    modelId,
    maxNewTokens: vision.maxNewTokens,
  });
}

/**
 * Parse the LLM response text into a SafetyAnalysisResult.
 * Handles optional markdown code fences.
 */
export function parseGeminiResponse(responseText: string): SafetyAnalysisResult {
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  const parsed = JSON.parse(cleaned) as SafetyAnalysisResult;
  if (!parsed.overallDescription || !parsed.overallRiskLevel) {
    throw new Error('Invalid response structure');
  }

  for (const cat of ['constructionSafety', 'fireSafety', 'propertySecurity'] as const) {
    if (!parsed[cat]) {
      parsed[cat] = { summary: 'Analysis not available for this category.', issues: [], recommendations: [] };
    }
    parsed[cat].issues = parsed[cat].issues || [];
    parsed[cat].recommendations = parsed[cat].recommendations || [];
  }
  return parsed;
}

interface EvaluatorOutput {
  shouldReport: boolean;
  confidence?: EvaluatorConfidence;
  rationale?: string;
  finalAnalysis: SafetyAnalysisResult;
}

function parseEvaluatorResponse(responseText: string): EvaluatorOutput {
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  const parsed = JSON.parse(cleaned) as {
    shouldReport: boolean;
    confidence?: EvaluatorConfidence;
    rationale?: string;
    finalAnalysis: SafetyAnalysisResult;
  };
  if (typeof parsed.shouldReport !== 'boolean' || !parsed.finalAnalysis) {
    throw new Error('Invalid evaluator response structure');
  }
  return {
    shouldReport: parsed.shouldReport,
    confidence: parsed.confidence,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
    finalAnalysis: parseGeminiResponse(JSON.stringify(parsed.finalAnalysis)),
  };
}

/**
 * Analyse a JPEG buffer: inspector only, or inspector + evaluator.
 */
export async function analyzeImageBuffer(
  jpegBuffer: Buffer,
  language: SupportedLanguage = 'en',
  requestOptions?: AnalyzeRequestOptions,
): Promise<SafetyAnalysisResult> {
  return withVisionConcurrency(() =>
    analyzeImageBufferUnlimited(jpegBuffer, language, requestOptions),
  );
}

async function analyzeImageBufferUnlimited(
  jpegBuffer: Buffer,
  language: SupportedLanguage = 'en',
  requestOptions?: AnalyzeRequestOptions,
): Promise<SafetyAnalysisResult> {
  const vision = buildVisionForRequest(requestOptions?.visionModel);
  const imageDataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
  const sizeKB = jpegBuffer.length / 1024;
  const inspectorPrompt =
    getSafetyAnalysisPrompt(language) +
    buildYoloContextBlock(requestOptions?.yoloDetections, requestOptions?.yoloGate);
  const inspectorText = await runVision('inspector', imageDataUrl, inspectorPrompt, sizeKB, vision);
  const inspectorResult = parseGeminiResponse(inspectorText);
  const inspectorName = inspectorModelLabel(vision.activeModel);

  if (!TWO_STAGE) {
    const meta: LocalAnalysisMetadata = attachYoloMeta({
      shouldReport: true,
      inspectorModel: inspectorName,
      evaluatorRationale: 'Two-stage disabled (LOCAL_VISION_TWO_STAGE=0).',
    }, requestOptions?.yoloGate);
    return { ...inspectorResult, localMeta: meta };
  }

  const inspectorJson = JSON.stringify(
    { ...inspectorResult, localMeta: undefined },
    null,
    0,
  );
  const evalPrompt = getEvaluatorPrompt(language, inspectorJson);
  let evalOut: EvaluatorOutput;
  try {
    const evalText = await runVision('evaluator', imageDataUrl, evalPrompt, sizeKB, vision);
    evalOut = parseEvaluatorResponse(evalText);
  } catch (e) {
    if (EVALUATOR_ON_FAILURE_NO_REPORT) {
      const err = e instanceof Error ? e.message : 'Evaluator failed';
      const meta: LocalAnalysisMetadata = attachYoloMeta({
        shouldReport: false,
        confidence: 'Low',
        inspectorModel: inspectorName,
        evaluatorModel: inspectorName,
        evaluatorRationale: `Evaluator error — no report per policy. (${err})`,
      }, requestOptions?.yoloGate);
      return {
        ...inspectorResult,
        localMeta: meta,
      };
    }
    const meta: LocalAnalysisMetadata = attachYoloMeta({
      shouldReport: true,
      inspectorModel: inspectorName,
      evaluatorRationale: `Evaluator failed; falling back to inspector. (${e instanceof Error ? e.message : String(e)})`,
    }, requestOptions?.yoloGate);
    return { ...inspectorResult, localMeta: meta };
  }

  const finalResult = { ...evalOut.finalAnalysis, localMeta: undefined };
  const meta: LocalAnalysisMetadata = attachYoloMeta({
    shouldReport: evalOut.shouldReport,
    confidence: evalOut.confidence,
    inspectorModel: inspectorName,
    evaluatorModel: inspectorName,
    evaluatorRationale: evalOut.rationale,
  }, requestOptions?.yoloGate);
  return { ...finalResult, localMeta: meta };
}

/**
 * Alert-only path (simplified JSON) using local "alert" role.
 */
export async function analyzeAlertBuffer(
  jpegBuffer: Buffer,
  language: SupportedLanguage = 'en',
  requestOptions?: { visionModel?: VisionActiveModel },
): Promise<string> {
  return withVisionConcurrency(async () => {
    const vision = buildVisionForRequest(requestOptions?.visionModel);
    const imageDataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
    const sizeKB = jpegBuffer.length / 1024;
    return runVision('alert', imageDataUrl, getAlertAnalysisPrompt(language), sizeKB, vision);
  });
}

/**
 * Video frame: inspector with optional YOLO context in prompt.
 */
export async function analyzeFrameWithLocalVision(
  imageDataUrl: string,
  language: SupportedLanguage,
  enhancedPrompt: string,
  sizeKB: number,
  requestOptions?: { visionModel?: VisionActiveModel },
): Promise<string> {
  return withVisionConcurrency(async () => {
    const vision = buildVisionForRequest(requestOptions?.visionModel);
    return runVision('inspector', imageDataUrl, enhancedPrompt, sizeKB, vision);
  });
}

/**
 * YOLO-augmented single frame for video UIs (inspector only; no evaluator to save time).
 */
export async function analyzeVideoFrameBuffer(
  frameJpegBase64: string,
  language: SupportedLanguage,
  frameNumber: number,
  timestamp: number,
  yoloDetections: { class_name: string }[],
  requestOptions?: { visionModel?: VisionActiveModel },
): Promise<SafetyAnalysisResult> {
  return withVisionConcurrency(async () => {
    const vision = buildVisionForRequest(requestOptions?.visionModel);
    const analysisPrompt = getSafetyAnalysisPrompt(language);
    const detectionSummary = yoloDetections.map((d) => d.class_name).join(', ');
    const enhancedPrompt = `${analysisPrompt}

**Frame Context:**
- Frame: ${frameNumber}
- Time: ${timestamp.toFixed(2)}s
- YOLO Detected: ${detectionSummary}

Provide safety analysis for this specific moment.`;
    const imageDataUrl = `data:image/jpeg;base64,${frameJpegBase64}`;
    const sizeKB = (frameJpegBase64.length * 3) / 4 / 1024;
    const text = await runVision('inspector', imageDataUrl, enhancedPrompt, sizeKB, vision);
    return parseGeminiResponse(text);
  });
}
