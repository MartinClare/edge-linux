/**
 * Single Frame Analysis API Route
 * POST /api/analyze-frame — local inspector (Qwen3-VL) with YOLO context
 */

import { Router, Request, Response } from 'express';
import { analyzeVideoFrameBuffer } from './analyzeCore.js';
import { type SupportedLanguage } from './visionClient.js';

const router = Router();

router.post('/analyze-frame', async (req: Request, res: Response) => {
  try {
    const { frameData, frameNumber, timestamp, yoloDetections, language } = req.body;

    if (!frameData) {
      return res.status(400).json({ success: false, error: 'Frame data is required' });
    }

    if (frameNumber === undefined || timestamp === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Frame number and timestamp are required',
      });
    }

    const lang = (language as SupportedLanguage) || 'en';
    const detections = yoloDetections || [];

    console.log(`🤖 Analyzing frame ${frameNumber} at ${Number(timestamp).toFixed(2)}s...`);

    const analysis = await analyzeVideoFrameBuffer(
      frameData,
      lang,
      frameNumber,
      Number(timestamp),
      detections,
    );

    return res.json({
      success: true,
      data: {
        frame_number: frameNumber,
        timestamp,
        analysis,
      },
    });
  } catch (error) {
    console.error('❌ Frame analysis error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Frame analysis failed';
    return res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
