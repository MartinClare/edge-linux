/**
 * Streaming Video Analysis API Route
 * 
 * POST /api/analyze-video-stream
 * Processes video with streaming upload and real-time YOLO detection
 * Returns results via Server-Sent Events (SSE)
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import FormData from 'form-data';
import axios from 'axios';
import { type SupportedLanguage } from './visionClient.js';
import { analyzeVideoFrameBuffer } from './analyzeCore.js';

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
 * Send SSE event to client
 */
function sendSSE(res: Response, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST /api/analyze-video-stream
 * 
 * Process video with streaming upload and real-time YOLO detection
 * Returns results via Server-Sent Events (SSE)
 */
router.post('/analyze-video-stream', (req: Request, res: Response) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

  upload.single('video')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        sendSSE(res, 'error', { error: `Video is too large. Maximum size is 50 MB.` });
        return res.end();
      }
      sendSSE(res, 'error', { error: err.message || 'Failed to process uploaded file.' });
      return res.end();
    }

    if (!req.file) {
      sendSSE(res, 'error', { error: 'No video file provided.' });
      return res.end();
    }

    const { buffer, mimetype, originalname } = req.file;
    const language = (req.body?.language as SupportedLanguage) || 'en';
    const sampleEvery = parseInt(req.body?.sampleEvery) || 5;
    const geminiInterval = parseInt(req.body?.geminiInterval) || 10;

    try {
      sendSSE(res, 'status', { message: 'Upload received, processing with YOLO...', progress: 10 });

      // Send video to YOLO backend
      const formData = new FormData();
      formData.append('file', buffer, {
        filename: originalname,
        contentType: mimetype,
      });
      formData.append('sample_every', sampleEvery.toString());

      console.log(`📤 Streaming video to YOLO API: ${YOLO_API_URL}/detect/video-frames`);
      
      let yoloResult;
      try {
        const yoloResponse = await axios.post(
          `${YOLO_API_URL}/detect/video-frames`,
          formData,
          {
            headers: {
              ...formData.getHeaders(),
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 300000,
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const progress = 10 + Math.round((progressEvent.loaded / progressEvent.total) * 50);
                sendSSE(res, 'progress', { 
                  message: 'Uploading to YOLO...', 
                  progress 
                });
              }
            },
          }
        );
        
        yoloResult = yoloResponse.data;
      } catch (axiosError) {
        console.error('❌ Failed to connect to YOLO API:', axiosError);
        if (axios.isAxiosError(axiosError)) {
          if (axiosError.code === 'ECONNREFUSED' || axiosError.message.includes('Network Error')) {
            sendSSE(res, 'error', { 
              error: `Cannot connect to YOLO API at ${YOLO_API_URL}. Please ensure the Python backend is running on port 8000.` 
            });
            return res.end();
          }
          if (axiosError.response) {
            const errorText = axiosError.response.data?.detail || JSON.stringify(axiosError.response.data);
            sendSSE(res, 'error', { error: `YOLO API error: ${axiosError.response.status} - ${errorText}` });
            return res.end();
          }
          sendSSE(res, 'error', { error: `Network error: ${axiosError.message}` });
          return res.end();
        }
        sendSSE(res, 'error', { error: 'Unknown error occurred' });
        return res.end();
      }

      sendSSE(res, 'status', { 
        message: `YOLO processed ${yoloResult.total_frames_sampled} frames`, 
        progress: 60 
      });

      // Send YOLO frames as they're processed (streaming)
      sendSSE(res, 'yolo-frames', {
        frames: yoloResult.frames,
        stats: {
          totalFrames: yoloResult.total_frames,
          sampledFrames: yoloResult.total_frames_sampled,
          fps: yoloResult.video_fps,
          duration: (yoloResult.total_frames / (yoloResult.video_fps || 30)),
        },
      });

      // Calculate which frames should be analyzed with Gemini
      const fps = yoloResult.video_fps || 30;
      const frameInterval = Math.round(geminiInterval * fps / sampleEvery);
      
      const framesToAnalyze = yoloResult.frames.filter((_: any, index: number) => {
        return index % frameInterval === 0 || index === yoloResult.frames.length - 1;
      });

      sendSSE(res, 'status', { 
        message: `Analyzing ${framesToAnalyze.length} frames with Gemini...`, 
        progress: 70 
      });

      // Analyze frames with Gemini in parallel, but send results as they complete
      let completedCount = 0;
      const geminiPromises = framesToAnalyze.map(async (frame: any, index: number) => {
        try {
          const analysis = await analyzeVideoFrameBuffer(
            frame.frame_data,
            language,
            frame.frame_index,
            frame.timestamp_sec || 0,
            frame.detections
          );
          
          completedCount++;
          const progress = 70 + Math.round((completedCount / framesToAnalyze.length) * 25);
          
          // Send each Gemini analysis as it completes
          sendSSE(res, 'gemini-analysis', {
            frame_number: frame.frame_index,
            timestamp: frame.timestamp_sec || 0,
            analysis,
          });
          
          sendSSE(res, 'progress', { 
            message: `Gemini analysis: ${completedCount}/${framesToAnalyze.length}`, 
            progress 
          });
          
          return {
            frame_number: frame.frame_index,
            timestamp: frame.timestamp_sec || 0,
            analysis,
          };
        } catch (error) {
          console.error(`   Failed to analyze frame ${frame.frame_index}:`, error);
          completedCount++;
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

      // Calculate final stats
      const allDetections = yoloResult.frames.flatMap((f: any) => f.detections);
      const finalStats = {
        totalFrames: yoloResult.total_frames,
        sampledFrames: yoloResult.total_frames_sampled,
        analyzedFrames: geminiAnalyses.length,
        duration: (yoloResult.total_frames / (yoloResult.video_fps || 30)),
        fps: yoloResult.video_fps,
        totalDetections: allDetections.length,
        uniqueClasses: Array.from(new Set(allDetections.map((d: any) => d.class_name))),
        violations: allDetections.filter((d: any) => d.class_name.includes('NO-')).length,
      };

      // Send final complete result
      sendSSE(res, 'complete', {
        filename: originalname,
        stats: finalStats,
        yoloFrames: yoloResult.frames,
        geminiAnalyses: geminiAnalyses,
      });

      res.end();
    } catch (error) {
      console.error('❌ Video streaming analysis error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Video analysis failed';
      sendSSE(res, 'error', { error: errorMessage });
      res.end();
    }
  });
});

export default router;
