/**
 * Core image analysis logic extracted from analyzeRoute.ts so it can be
 * called both by the HTTP endpoint (POST /api/analyze-image) and by the
 * background analysis loop without going through HTTP.
 */

import {
  OPENROUTER_API_KEY,
  OPENROUTER_API_URL,
  MODEL_NAME,
  getSafetyAnalysisPrompt,
  type SupportedLanguage,
} from './openRouterClient.js';
import type { SafetyAnalysisResult } from './types.js';

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

/**
 * Call OpenRouter with a given model and image.
 * Returns the raw response text; throws on error with `.status` attached.
 */
async function callOpenRouter(
  model: string,
  imageDataUrl: string,
  prompt: string,
  sizeKB: number,
): Promise<string> {
  const start = Date.now();
  const ts = new Date().toISOString();
  console.log(`[${ts}] Sending OpenRouter request (model: ${model}, size: ${sizeKB.toFixed(1)} KB)`);

  const resp = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3001',
      'X-Title': 'Axon Vision Safety Demo',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  const duration = ((Date.now() - start) / 1000).toFixed(2);
  if (!resp.ok) {
    const ct = resp.headers.get('content-type') || '';
    const errMsg = ct.includes('application/json')
      ? ((await resp.json() as { error?: { message?: string } }).error?.message || `API error: ${resp.status}`)
      : `API error: ${resp.status}`;
    console.error(`[${ts}] OpenRouter failed (${resp.status}, took ${duration}s): ${errMsg}`);
    throw Object.assign(new Error(errMsg), { status: resp.status });
  }

  const result = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  console.log(`[${ts}] OpenRouter success (model: ${model}, took ${duration}s)`);
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from OpenRouter');
  return text;
}

/**
 * Analyse a JPEG buffer and return a structured SafetyAnalysisResult.
 * Throws on any failure — callers must handle errors explicitly.
 */
export async function analyzeImageBuffer(
  jpegBuffer: Buffer,
  language: SupportedLanguage = 'en',
): Promise<SafetyAnalysisResult> {
  const imageDataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
  const sizeKB = jpegBuffer.length / 1024;
  const prompt = getSafetyAnalysisPrompt(language);

  const responseText = await callOpenRouter(MODEL_NAME, imageDataUrl, prompt, sizeKB);
  return parseGeminiResponse(responseText);
}
