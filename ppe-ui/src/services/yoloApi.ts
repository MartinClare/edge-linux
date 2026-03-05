import axios from 'axios';
import type { ImageDetectionResult, VideoDetectionResult } from '../types/detection.types';
import { API_ENDPOINTS, API_CONFIG } from '../config/api';

export const detectImageYOLO = async (file: File): Promise<ImageDetectionResult> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await axios.post<ImageDetectionResult>(
    API_ENDPOINTS.yolo.detectImage,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: API_CONFIG.timeout.default,
    }
  );

  return response.data;
};

export const detectVideoYOLO = async (
  file: File,
  sampleEvery: number = 5
): Promise<VideoDetectionResult> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await axios.post<VideoDetectionResult>(
    `${API_ENDPOINTS.yolo.detectVideo}?sample_every=${sampleEvery}`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: API_CONFIG.timeout.video,
    }
  );

  return response.data;
};

export const detectWebcamYOLO = async (
  camIndex: number = 0,
  maxFrames: number = 100,
  sampleEvery: number = 1
): Promise<VideoDetectionResult> => {
  const response = await axios.get<VideoDetectionResult>(
    API_ENDPOINTS.yolo.detectWebcam,
    {
      params: { cam_index: camIndex, max_frames: maxFrames, sample_every: sampleEvery },
      timeout: API_CONFIG.timeout.stream,
    }
  );

  return response.data;
};

export const detectRTSPYOLO = async (
  rtspUrl: string,
  maxFrames: number = 100,
  sampleEvery: number = 1
): Promise<VideoDetectionResult> => {
  // Use POST so the RTSP URL (with :, @, etc.) is not mangled in query params
  const response = await axios.post<VideoDetectionResult>(
    API_ENDPOINTS.yolo.detectRTSP,
    { url: rtspUrl, max_frames: maxFrames, sample_every: sampleEvery },
    { timeout: API_CONFIG.timeout.video }
  );

  return response.data;
};
