import type { VideoAnalysisResult, FrameDetection, GeminiFrameAnalysis } from '../types/detection.types';

const GEMINI_API_URL = process.env.REACT_APP_GEMINI_API_URL || 'http://localhost:3001';

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
 * Analyze video with streaming upload and real-time results
 */
export const analyzeVideoStreaming = async (
  file: File,
  sampleEvery: number = 5,
  geminiInterval: number = 10,
  language: 'en' | 'zh-TW' = 'en',
  callbacks: StreamingCallbacks = {}
): Promise<VideoAnalysisResult> => {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('video', file);
    formData.append('sampleEvery', sampleEvery.toString());
    formData.append('geminiInterval', geminiInterval.toString());
    formData.append('language', language);

    // Use fetch for streaming support
    fetch(`${GEMINI_API_URL}/api/analyze-video-stream`, {
      method: 'POST',
      body: formData,
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
          
          // Process complete SSE messages
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep incomplete message in buffer

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
                  callbacks.onProgress?.({
                    progress: parsed.progress || 0,
                    message: parsed.message || '',
                  });
                  break;

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

        // If we reach here without a complete event, something went wrong
        reject(new Error('Stream ended without completion'));
      })
      .catch((error) => {
        callbacks.onError?.(error.message || 'Streaming error');
        reject(error);
      });
  });
};
