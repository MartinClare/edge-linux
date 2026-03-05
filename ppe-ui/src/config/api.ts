/**
 * API Configuration
 * Centralized configuration for all API endpoints
 */

export const YOLO_API_URL = process.env.REACT_APP_YOLO_API_URL || 'http://localhost:8000';
export const GEMINI_API_URL = process.env.REACT_APP_GEMINI_API_URL || 'http://localhost:3001';

/**
 * API Endpoints
 */
export const API_ENDPOINTS = {
  // YOLO Detection Endpoints
  yolo: {
    detectImage: `${YOLO_API_URL}/detect/image`,
    detectVideo: `${YOLO_API_URL}/detect/video`,
    detectWebcam: `${YOLO_API_URL}/detect/stream/webcam`,
    detectRTSP: `${YOLO_API_URL}/detect/stream/rtsp`,
    videosList: `${YOLO_API_URL}/videos/list`,
    health: `${YOLO_API_URL}/health`,
  },
  
  // Gemini Analysis Endpoints
  gemini: {
    analyzeImage: `${GEMINI_API_URL}/api/analyze-image`,
    analyzeAlerts: `${GEMINI_API_URL}/api/analyze-alerts`,
    analyzeVideo: `${GEMINI_API_URL}/api/analyze-video`,
    analyzeVideoStream: `${GEMINI_API_URL}/api/analyze-video-stream`,
    analyzeFrame: `${GEMINI_API_URL}/api/analyze-frame`,
    health: `${GEMINI_API_URL}/api/health`,
  },
};

/**
 * API Configuration Constants
 */
export const API_CONFIG = {
  timeout: {
    default: 30000,      // 30 seconds
    video: 120000,       // 2 minutes for video processing
    stream: 300000,      // 5 minutes for streaming
  },
  
  retry: {
    maxAttempts: 3,
    delay: 1000,         // 1 second
  },
  
  upload: {
    maxFileSize: 100 * 1024 * 1024,  // 100 MB
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/jpg'],
    allowedVideoTypes: ['video/mp4', 'video/avi', 'video/mov'],
  },
};

/**
 * Check if API is available
 */
export const checkAPIHealth = async (apiUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${apiUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (error) {
    console.error(`API health check failed for ${apiUrl}:`, error);
    return false;
  }
};
