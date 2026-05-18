/**
 * Alert Analysis API Route
 * 
 * POST /api/analyze-alerts
 * Accepts multipart/form-data with an 'image' field
 * Returns simplified alert-only JSON
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { type SupportedLanguage } from './visionClient.js';
import { analyzeAlertBuffer } from './analyzeCore.js';
import { 
  MAX_FILE_SIZE_BYTES, 
  MAX_FILE_SIZE_MB, 
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS 
} from './constants.js';
import type { AlertAnalysisResult, AlertResponse } from './types.js';

const router = Router();

/**
 * Configure multer for memory storage with file validation
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype as typeof ALLOWED_MIME_TYPES[number])) {
      cb(new Error(`Invalid file type. Please upload ${ALLOWED_EXTENSIONS} images only.`));
      return;
    }
    cb(null, true);
  },
});

/**
 * Parse Gemini alert response
 */
function parseAlertResponse(responseText: string): AlertAnalysisResult {
  let cleanedText = responseText.trim();
  
  // Remove markdown code fences
  if (cleanedText.startsWith('```json')) {
    cleanedText = cleanedText.slice(7);
  } else if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.slice(3);
  }
  
  if (cleanedText.endsWith('```')) {
    cleanedText = cleanedText.slice(0, -3);
  }
  
  cleanedText = cleanedText.trim();
  
  try {
    const parsed = JSON.parse(cleanedText) as AlertAnalysisResult;
    
    // Validate structure
    if (!parsed.overallRiskLevel) {
      throw new Error('Invalid alert response structure');
    }
    
    // Ensure alerts array exists
    parsed.alerts = parsed.alerts || [];
    parsed.alertCount = parsed.alerts.length;
    
    return parsed;
  } catch (error) {
    console.error('Failed to parse alert response:', error);
    console.error('Raw response:', responseText);
    throw new Error('Failed to parse AI alert response. Please try again.');
  }
}

/**
 * POST /api/analyze-alerts
 * 
 * Accepts an image file and returns alert-only analysis
 */
router.post('/analyze-alerts', (req: Request, res: Response) => {
  upload.single('image')(req, res, async (err) => {
    // Handle multer errors
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          const response: AlertResponse = {
            success: false,
            error: `Image is too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`,
          };
          return res.status(400).json(response);
        }
      }
      const response: AlertResponse = {
        success: false,
        error: err.message || 'Failed to process uploaded file.',
      };
      return res.status(400).json(response);
    }

    // Validate file exists
    if (!req.file) {
      const response: AlertResponse = {
        success: false,
        error: 'No image file provided. Please upload an image.',
      };
      return res.status(400).json(response);
    }

    const { buffer, mimetype } = req.file;
    const language = (req.body?.language as SupportedLanguage) || 'en';

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(mimetype as typeof ALLOWED_MIME_TYPES[number])) {
      const response: AlertResponse = {
        success: false,
        error: `Invalid file type (${mimetype}). Please upload ${ALLOWED_EXTENSIONS} images only.`,
      };
      return res.status(400).json(response);
    }

    // Validate file size
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      const response: AlertResponse = {
        success: false,
        error: `Image is too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Maximum size is ${MAX_FILE_SIZE_MB} MB.`,
      };
      return res.status(400).json(response);
    }

    try {
      const requestTimestamp = new Date().toISOString();
      console.log(
        `[${requestTimestamp}] Local vision ALERTS (language: ${language}, size: ${(buffer.length / 1024).toFixed(1)} KB)`,
      );
      const responseText = await analyzeAlertBuffer(buffer, language);
      if (!responseText) throw new Error('Empty response from local vision');
      const alertResult = parseAlertResponse(responseText);

      const response: AlertResponse = {
        success: true,
        data: alertResult,
      };

      return res.json(response);
    } catch (error) {
      console.error('Alert API error:', error);
      
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'An unexpected error occurred during alert analysis.';
      
      const userMessage = `Alert analysis failed: ${errorMessage}. Ensure the local vision server is running.`;
      
      const response: AlertResponse = {
        success: false,
        error: userMessage,
      };

      return res.status(500).json(response);
    }
  });
});

export default router;
