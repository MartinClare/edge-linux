/**
 * Image Analysis API Route
 *
 * POST /api/analyze-image
 * Local vision only (Qwen3-VL + Gemma 4 when two-stage is enabled).
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { analyzeImageBuffer } from './analyzeCore.js';
import { type SupportedLanguage } from './visionClient.js';
import { type VisionActiveModel } from './visionModels.js';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
} from './constants.js';
import type { AnalysisResponse } from './types.js';

function isVisionActiveModel(s: string | undefined): s is VisionActiveModel {
  if (!s) return false;
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

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
      cb(new Error(`Invalid file type. Please upload ${ALLOWED_EXTENSIONS} images only.`));
      return;
    }
    cb(null, true);
  },
});

router.post('/analyze-image', (req: Request, res: Response) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            error: `Image is too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`,
          } satisfies AnalysisResponse);
        }
      }
      return res.status(400).json({
        success: false,
        error: err.message || 'Failed to process uploaded file.',
      } satisfies AnalysisResponse);
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided. Please upload an image.',
      } satisfies AnalysisResponse);
    }

    const { buffer, mimetype, originalname, size } = req.file;
    console.log(
      `Processing image: ${originalname}, size: ${(size / 1024).toFixed(2)} KB, type: ${mimetype}`,
    );
    const language = (req.body?.language as SupportedLanguage) || 'zh-TW';
    const rawVm = req.body?.visionModel as string | undefined;
    const visionModel = isVisionActiveModel(rawVm) ? rawVm : undefined;

    if (!ALLOWED_MIME_TYPES.includes(mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
      return res.status(400).json({
        success: false,
        error: `Invalid file type (${mimetype}). Please upload ${ALLOWED_EXTENSIONS} images only.`,
      } satisfies AnalysisResponse);
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Image is too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Maximum size is ${MAX_FILE_SIZE_MB} MB.`,
      } satisfies AnalysisResponse);
    }

    try {
      const analysisResult = await analyzeImageBuffer(buffer, language, { visionModel });
      return res.json({ success: true, data: analysisResult } satisfies AnalysisResponse);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unexpected error occurred during analysis.';
      console.error('Local vision analysis error:', error);
      return res.status(500).json({
        success: false,
        error: `Analysis failed: ${errorMessage}. For local Gemma/Transformers ensure FastAPI port 8001 is up; for local_qwen3_vllm ensure LOCAL_VLLM_API_URL (default 8002); for OpenRouter set OPENROUTER_API_KEY.`,
      } satisfies AnalysisResponse);
    }
  });
});

export default router;
