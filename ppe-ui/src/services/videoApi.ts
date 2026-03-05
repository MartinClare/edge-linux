import axios from 'axios';
import type { VideoAnalysisResult } from '../types/detection.types';

const GEMINI_API_URL = process.env.REACT_APP_GEMINI_API_URL || 'http://localhost:3001';

export const analyzeVideo = async (
  file: File,
  sampleEvery: number = 5,
  geminiInterval: number = 10,
  language: 'en' | 'zh-TW' = 'en',
  onProgress?: (progress: number, message: string) => void
): Promise<VideoAnalysisResult> => {
  const formData = new FormData();
  formData.append('video', file);
  formData.append('sampleEvery', sampleEvery.toString());
  formData.append('geminiInterval', geminiInterval.toString());
  formData.append('language', language);

  if (onProgress) {
    onProgress(10, 'Uploading video...');
  }

  try {
    const response = await axios.post<{ success: boolean; data?: VideoAnalysisResult; error?: string }>(
      `${GEMINI_API_URL}/api/analyze-video`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000, // 5 minutes timeout for video processing
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(percentCompleted * 0.3, 'Uploading video...');
          }
        },
      }
    );

    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.error || 'Video analysis failed');
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
