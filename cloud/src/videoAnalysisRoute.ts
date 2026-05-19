/**
 * Video Analysis API Route
 * 
 * POST /api/analyze-video
 * Processes video with continuous YOLO detection and interval-based Gemini verification
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import FormData from 'form-data';
import axios from 'axios';
import { type SupportedLanguage } from './visionClient.js';
import { analyzeVideoFrameBuffer } from './analyzeCore.js';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from './constants.js';

const router = Router();

// Allow larger files for videos (50MB)
const VIDEO_MAX_SIZE = 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    const videoMimeTypes = ['video/mp4', 'video/avi', 'video/mov', 'video/quicktime', 'video/x-msvideo'];
    if (!videoMimeTypes.includes(file.mimetype)) {
      cb(new Error('Invalid file type. Please upload MP4, AVI, or MOV video files.'));
      return;
    }
    cb(null, true);
  },
});

const YOLO_API_URL = process.env.YOLO_API_URL || 'http://localhost:8000';

/**
 * POST /api/analyze-video
 *
 * YOLO on Python backend; vision LLM frames use local Qwen3-VL inspector.
 */
router.post('/analyze-video', (req: Request, res: Response) => {
  upload.single('video')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: `Video is too large. Maximum size is 50 MB.`,
        });
      }
      return res.status(400).json({
        success: false,
        error: err.message || 'Failed to process uploaded file.',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No video file provided.',
      });
    }

    const { buffer, mimetype, originalname } = req.file;
    const language = (req.body?.language as SupportedLanguage) || 'zh-TW';
    const sampleEvery = parseInt(req.body?.sampleEvery) || 5; // Frame sampling for YOLO
    const geminiInterval = parseInt(req.body?.geminiInterval) || 10; // Seconds between Gemini checks

    try {
      console.log('🎥 Step 1: Processing video with YOLOv8...');
      
      // Step 1: Send video to YOLO backend for frame-by-frame detection
      // Use form-data package with axios for proper multipart/form-data handling
      const formData = new FormData();
      formData.append('file', buffer, {
        filename: originalname,
        contentType: mimetype,
      });
      formData.append('sample_every', sampleEvery.toString());

      console.log(`📤 Sending video to YOLO API: ${YOLO_API_URL}/detect/video-frames`);
      console.log(`   Video size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   Filename: ${originalname}`);
      
      let yoloResult;
      try {
        // Use axios which handles form-data streams better than fetch
        const yoloResponse = await axios.post(
          `${YOLO_API_URL}/detect/video-frames`,
          formData,
          {
            headers: {
              ...formData.getHeaders(),
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 300000, // 5 minutes timeout
          }
        );
        
        yoloResult = yoloResponse.data;
      } catch (axiosError) {
        console.error('❌ Failed to connect to YOLO API:', axiosError);
        if (axios.isAxiosError(axiosError)) {
          if (axiosError.code === 'ECONNREFUSED' || axiosError.message.includes('Network Error')) {
            throw new Error(`Cannot connect to YOLO API at ${YOLO_API_URL}. Please ensure the Python backend is running on port 8000.`);
          }
          if (axiosError.response) {
            const errorText = axiosError.response.data?.detail || JSON.stringify(axiosError.response.data);
            console.error('❌ YOLO API error response:', errorText);
            throw new Error(`YOLO API error: ${axiosError.response.status} - ${errorText}`);
          }
          throw new Error(`Network error: ${axiosError.message}`);
        }
        throw axiosError;
      }
      console.log(`✅ YOLO processed ${yoloResult.total_frames_sampled} frames`);

      // Step 2: Calculate which frames should be analyzed based on interval
      const fps = yoloResult.video_fps || 30;
      const frameInterval = Math.round(geminiInterval * fps / sampleEvery);
      
      // Calculate which frames should be analyzed based on interval
      const framesToAnalyze = yoloResult.frames.filter((_: any, index: number) => {
        return index % frameInterval === 0 || index === yoloResult.frames.length - 1;
      });

      console.log(`🤖 Step 2: Analyzing ${framesToAnalyze.length} frames with local vision in parallel (every ${geminiInterval}s)...`);

      // Step 3: Analyze required frames in parallel
      const geminiPromises = framesToAnalyze.map(async (frame: any, index: number) => {
        try {
          console.log(`   Analyzing frame ${frame.frame_index} (${index + 1}/${framesToAnalyze.length})...`);
          const analysis = await analyzeVideoFrameBuffer(
            frame.frame_data,
            language,
            frame.frame_index,
            frame.timestamp_sec || 0,
            frame.detections
          );
          return {
            frame_number: frame.frame_index,
            timestamp: frame.timestamp_sec || 0,
            analysis,
          };
        } catch (error) {
          console.error(`   Failed to analyze frame ${frame.frame_index}:`, error);
          return {
            frame_number: frame.frame_index,
            timestamp: frame.timestamp_sec || 0,
            analysis: null,
            error: error instanceof Error ? error.message : 'Analysis failed',
          };
        }
      });

      // Wait for all Gemini analyses to complete
      const geminiAnalyses = await Promise.all(geminiPromises);
      console.log(`✅ All Gemini analyses complete: ${geminiAnalyses.length} frames analyzed`);

      // Calculate stats
      const allDetections = yoloResult.frames.flatMap((f: any) => f.detections);
      const initialStats = {
        totalFrames: yoloResult.total_frames,
        sampledFrames: yoloResult.total_frames_sampled,
        analyzedFrames: geminiAnalyses.length,
        duration: (yoloResult.total_frames / (yoloResult.video_fps || 30)),
        fps: yoloResult.video_fps,
        totalDetections: allDetections.length,
        uniqueClasses: Array.from(new Set(allDetections.map((d: any) => d.class_name))),
        violations: allDetections.filter((d: any) => d.class_name.includes('NO-')).length,
      };

      // Return YOLO results with all Gemini analyses (all done upfront)
      res.json({
        success: true,
        data: {
          filename: originalname,
          stats: initialStats,
          yoloFrames: yoloResult.frames,
          geminiAnalyses: geminiAnalyses,
        },
      });
    } catch (error) {
      console.error('❌ Video analysis error:', error);
      
      let errorMessage = 'Video analysis failed';
      if (error instanceof Error) {
        errorMessage = error.message;
        // Provide more helpful error messages
        if (error.message.includes('ECONNREFUSED') || error.message.includes('Failed to connect')) {
          errorMessage = 'Cannot connect to YOLO API. Please ensure the Python backend is running on port 8000.';
        } else if (error.message.includes('YOLO API error')) {
          errorMessage = `YOLO API error: ${error.message}`;
        }
      }
      
      return res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  });
});

export default router;
