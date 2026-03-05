import axios from 'axios';
import type { GeminiFrameAnalysis } from '../types/detection.types';

const GEMINI_API_URL = process.env.REACT_APP_GEMINI_API_URL || 'http://localhost:3001';

export const analyzeFrame = async (
  frameData: string,
  frameNumber: number,
  timestamp: number,
  yoloDetections: any[],
  language: 'en' | 'zh-TW' = 'en'
): Promise<GeminiFrameAnalysis> => {
  try {
    const response = await axios.post<{ success: boolean; data?: GeminiFrameAnalysis; error?: string }>(
      `${GEMINI_API_URL}/api/analyze-frame`,
      {
        frameData,
        frameNumber,
        timestamp,
        yoloDetections,
        language,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000, // 30 seconds timeout
      }
    );

    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Frame analysis failed');
    }

    return response.data.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED' || error.message.includes('Network Error')) {
        throw new Error(`Cannot connect to API server at ${GEMINI_API_URL}. Please ensure the Node.js backend is running on port 3001.`);
      }
      if (error.response) {
        throw new Error(error.response.data?.error || `API error: ${error.response.status} ${error.response.statusText}`);
      }
      throw new Error(`Network error: ${error.message}`);
    }
    throw error;
  }
};
