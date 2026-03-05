import axios from 'axios';
import type { GeminiAnalysisResult, AlertAnalysisResult, ApiResponse } from '../types/detection.types';

const GEMINI_API_URL = process.env.REACT_APP_GEMINI_API_URL || 'http://localhost:3001';

export const analyzeImageGemini = async (
  file: File,
  language: 'en' | 'zh-TW' = 'en'
): Promise<GeminiAnalysisResult> => {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('language', language);

  const response = await axios.post<ApiResponse<GeminiAnalysisResult>>(
    `${GEMINI_API_URL}/api/analyze-image`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    }
  );

  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error || 'Gemini analysis failed');
  }

  return response.data.data;
};

export const analyzeImageAlerts = async (
  file: File,
  language: 'en' | 'zh-TW' = 'en'
): Promise<AlertAnalysisResult> => {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('language', language);

  const response = await axios.post<ApiResponse<AlertAnalysisResult>>(
    `${GEMINI_API_URL}/api/analyze-alerts`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    }
  );

  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.error || 'Alert analysis failed');
  }

  return response.data.data;
};
