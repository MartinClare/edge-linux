/**
 * Image Analysis API Route
 * 
 * POST /api/analyze-image
 * Accepts multipart/form-data with an 'image' field
 * Returns structured safety analysis JSON
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { 
  OPENROUTER_API_KEY, 
  OPENROUTER_API_URL, 
  MODEL_NAME,
  FALLBACK_MODEL_NAME,
  getSafetyAnalysisPrompt,
  type SupportedLanguage
} from './openRouterClient.js';
import { 
  MAX_FILE_SIZE_BYTES, 
  MAX_FILE_SIZE_MB, 
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS 
} from './constants.js';
import type { SafetyAnalysisResult, AnalysisResponse } from './types.js';

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
    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype as typeof ALLOWED_MIME_TYPES[number])) {
      cb(new Error(`Invalid file type. Please upload ${ALLOWED_EXTENSIONS} images only.`));
      return;
    }
    cb(null, true);
  },
});

/**
 * Parse Gemini response text into SafetyAnalysisResult
 * Handles potential code fences and JSON parsing errors
 */
function parseGeminiResponse(responseText: string): SafetyAnalysisResult {
  // Remove markdown code fences if present
  let cleanedText = responseText.trim();
  
  // Remove ```json or ``` at the start
  if (cleanedText.startsWith('```json')) {
    cleanedText = cleanedText.slice(7);
  } else if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.slice(3);
  }
  
  // Remove ``` at the end
  if (cleanedText.endsWith('```')) {
    cleanedText = cleanedText.slice(0, -3);
  }
  
  cleanedText = cleanedText.trim();
  
  try {
    const parsed = JSON.parse(cleanedText) as SafetyAnalysisResult;
    
    // Validate required fields exist
    if (!parsed.overallDescription || !parsed.overallRiskLevel) {
      throw new Error('Invalid response structure');
    }
    
    // Ensure arrays exist for all categories
    const categories = ['constructionSafety', 'fireSafety', 'propertySecurity'] as const;
    for (const category of categories) {
      if (!parsed[category]) {
        parsed[category] = {
          summary: 'Analysis not available for this category.',
          issues: [],
          recommendations: [],
        };
      }
      parsed[category].issues = parsed[category].issues || [];
      parsed[category].recommendations = parsed[category].recommendations || [];
    }
    
    return parsed;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to parse Gemini response:', errorMessage);
    console.error('Raw response (first 500 chars):', responseText.substring(0, 500));
    throw new Error(`Failed to parse AI analysis response: ${errorMessage}. Response preview: ${responseText.substring(0, 100)}...`);
  }
}

/**
 * POST /api/analyze-image
 * 
 * Accepts an image file and returns safety analysis
 */
router.post('/analyze-image', (req: Request, res: Response) => {
  upload.single('image')(req, res, async (err) => {
    // Handle multer errors
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          const response: AnalysisResponse = {
            success: false,
            error: `Image is too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`,
          };
          return res.status(400).json(response);
        }
      }
      const response: AnalysisResponse = {
        success: false,
        error: err.message || 'Failed to process uploaded file.',
      };
      return res.status(400).json(response);
    }

    // Validate file exists
    if (!req.file) {
      console.warn('No image file provided in request');
      const response: AnalysisResponse = {
        success: false,
        error: 'No image file provided. Please upload an image.',
      };
      return res.status(400).json(response);
    }

    const { buffer, mimetype, originalname, size } = req.file;
    console.log(`Processing image: ${originalname}, size: ${(size / 1024).toFixed(2)} KB, type: ${mimetype}`);
    
    // Get language from request body (defaults to 'en')
    const language = (req.body?.language as SupportedLanguage) || 'en';

    // Double-check MIME type on backend
    if (!ALLOWED_MIME_TYPES.includes(mimetype as typeof ALLOWED_MIME_TYPES[number])) {
      console.warn(`Invalid file type rejected: ${mimetype} for file ${originalname}`);
      const response: AnalysisResponse = {
        success: false,
        error: `Invalid file type (${mimetype}). Please upload ${ALLOWED_EXTENSIONS} images only.`,
      };
      return res.status(400).json(response);
    }

    // Double-check file size on backend
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      console.warn(`File too large rejected: ${(buffer.length / 1024 / 1024).toFixed(1)} MB for file ${originalname}`);
      const response: AnalysisResponse = {
        success: false,
        error: `Image is too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Maximum size is ${MAX_FILE_SIZE_MB} MB.`,
      };
      return res.status(400).json(response);
    }

    /** Call OpenRouter with a specific model; returns the raw response text or throws. */
    const callOpenRouter = async (model: string, imageDataUrl: string, prompt: string): Promise<string> => {
      const startTime = Date.now();
      const ts = new Date().toISOString();
      console.log(`[${ts}] 🚀 Sending OpenRouter request (model: ${model}, size: ${(buffer.length / 1024).toFixed(1)} KB)`);
      const resp = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3001',
          'X-Title': 'Axon Vision Safety Demo',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageDataUrl } }] }],
        }),
      });
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      if (!resp.ok) {
        const ct = resp.headers.get('content-type') || '';
        const errMsg = ct.includes('application/json')
          ? ((await resp.json() as { error?: { message?: string } }).error?.message || `API error: ${resp.status}`)
          : `API error: ${resp.status}`;
        console.error(`[${ts}] ❌ OpenRouter failed (${resp.status}, took ${duration}s): ${errMsg}`);
        throw Object.assign(new Error(errMsg), { status: resp.status });
      }
      const result = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
      console.log(`[${ts}] ✅ OpenRouter success (model: ${model}, took ${duration}s)`);
      const text = result.choices?.[0]?.message?.content;
      if (!text) throw new Error('Empty response from OpenRouter');
      return text;
    };

    try {
      // Convert buffer to base64
      const imageBase64 = buffer.toString('base64');
      const imageDataUrl = `data:${mimetype};base64,${imageBase64}`;

      // Get the language-specific prompt
      const analysisPrompt = getSafetyAnalysisPrompt(language);

      // Attempt primary model; fall back automatically on region bans (403)
      let responseText: string;
      try {
        responseText = await callOpenRouter(MODEL_NAME, imageDataUrl, analysisPrompt);
      } catch (primaryErr: unknown) {
        const status = (primaryErr as { status?: number }).status;
        const msg = (primaryErr as Error).message || '';
        const isBanned = status === 403 || msg.toLowerCase().includes('banned') || msg.toLowerCase().includes('not available in your region');
        if (isBanned) {
          console.warn(`Primary model (${MODEL_NAME}) is region-blocked. Retrying with fallback: ${FALLBACK_MODEL_NAME}`);
          responseText = await callOpenRouter(FALLBACK_MODEL_NAME, imageDataUrl, analysisPrompt);
        } else {
          throw primaryErr;
        }
      }

      // Parse the response
      const analysisResult = parseGeminiResponse(responseText);

      const response: AnalysisResponse = {
        success: true,
        data: analysisResult,
      };

      return res.json(response);
    } catch (error) {
      console.error('OpenRouter API error:', error);
      
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'An unexpected error occurred during analysis.';
      
      // Check for common API errors
      let userMessage = `Analysis failed: ${errorMessage}`;
      if (errorMessage.includes('API key')) {
        userMessage = 'API configuration error. Please check your OpenRouter API key.';
      } else if (errorMessage.includes('quota') || errorMessage.includes('429')) {
        userMessage = 'API quota exceeded. Please try again later.';
      } else if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        userMessage = 'Model not found. Please check the model name configuration.';
      }
      
      const response: AnalysisResponse = {
        success: false,
        error: userMessage,
      };

      return res.status(500).json(response);
    }
  });
});

export default router;
