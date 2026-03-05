import axios from 'axios';
import type { VideoAnalysisResult, FrameDetection, GeminiFrameAnalysis } from '../types/detection.types';

const GEMINI_API_URL = process.env.REACT_APP_GEMINI_API_URL || 'http://localhost:3001';

export interface VideoFile {
  filename: string;
  path: string;
  size: number;
  size_mb: number;
}

export interface VideoListResponse {
  videos: VideoFile[];
  folder: string;
  count: number;
  error?: string;
}

export interface StreamingProgress {
  progress: number;
  message: string;
}

export interface StreamingCallbacks {
  onProgress?: (progress: StreamingProgress) => void;
  onYoloFrames?: (frames: FrameDetection[], stats: any) => void;
  onGeminiAnalysis?: (analysis: GeminiFrameAnalysis) => void;
  onComplete?: (result: VideoAnalysisResult) => void;
  onError?: (error: string) => void;
}

/**
 * List available videos from the server's video folder
 */
export const listVideos = async (): Promise<VideoListResponse> => {
  try {
    const response = await axios.get<VideoListResponse>(`${GEMINI_API_URL}/api/videos/list`);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.error || 'Failed to list videos');
    }
    throw new Error('Failed to list videos');
  }
};

/**
 * Analyze video from file path (no upload needed) with streaming results
 */
export const analyzeVideoFile = async (
  filePath: string,
  sampleEvery: number = 5,
  geminiInterval: number = 10,
  language: 'en' | 'zh-TW' = 'en',
  callbacks: StreamingCallbacks = {}
): Promise<VideoAnalysisResult> => {
  return new Promise((resolve, reject) => {
    fetch(`${GEMINI_API_URL}/api/analyze-video-file-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filePath,
        sampleEvery,
        geminiInterval,
        language,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body is not readable');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let yoloFrames: FrameDetection[] = [];
        let geminiAnalyses: GeminiFrameAnalysis[] = [];
        let stats: any = null;
        let filename = '';

        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const message of lines) {
            if (!message.trim()) continue;

            const lines = message.split('\n');
            let eventType = 'message';
            let data = '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.substring(7).trim();
              } else if (line.startsWith('data: ')) {
                data = line.substring(6).trim();
              }
            }

            if (!data) continue;

            try {
              const parsed = JSON.parse(data);

              switch (eventType) {
                case 'status':
                case 'progress':
                  callbacks.onProgress?.({
                    progress: parsed.progress || 0,
                    message: parsed.message || '',
                  });
                  break;

                case 'yolo-frames':
                  yoloFrames = parsed.frames || [];
                  stats = parsed.stats;
                  callbacks.onYoloFrames?.(yoloFrames, stats);
                  break;

                case 'gemini-analysis':
                  const analysis: GeminiFrameAnalysis = {
                    frame_number: parsed.frame_number,
                    timestamp: parsed.timestamp,
                    analysis: parsed.analysis,
                    error: parsed.error,
                  };
                  geminiAnalyses.push(analysis);
                  callbacks.onGeminiAnalysis?.(analysis);
                  break;

                case 'complete':
                  filename = parsed.filename || '';
                  stats = parsed.stats;
                  yoloFrames = parsed.yoloFrames || [];
                  geminiAnalyses = parsed.geminiAnalyses || [];

                  const result: VideoAnalysisResult = {
                    filename,
                    stats,
                    yoloFrames,
                    geminiAnalyses,
                  };

                  callbacks.onComplete?.(result);
                  resolve(result);
                  return;

                case 'error':
                  const errorMsg = parsed.error || 'Unknown error';
                  callbacks.onError?.(errorMsg);
                  reject(new Error(errorMsg));
                  return;
              }
            } catch (error) {
              console.error('Error parsing SSE message:', error, data);
            }
          }
        }

        reject(new Error('Stream ended without completion'));
      })
      .catch((error) => {
        callbacks.onError?.(error.message || 'Streaming error');
        reject(error);
      });
  });
};
