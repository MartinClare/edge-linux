// YOLOv8 Detection Types
export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Detection {
  id: number;
  class_id: number;
  class_name: string;
  confidence: number;
  bbox: number[]; // [x1, y1, x2, y2]
}

export interface ImageDetectionResult {
  image_width: number;
  image_height: number;
  model_name: string;
  device: string;
  inference_ms: number;
  detections: Detection[];
}

export interface FrameDetection {
  frame_index: number;
  timestamp_sec: number | null;
  detections: Detection[];
  frame_data?: string; // Base64 encoded frame image
}

export interface VideoDetectionResult {
  video_fps: number | null;
  frame_width: number;
  frame_height: number;
  total_frames: number;
  total_frames_sampled: number;
  frames: FrameDetection[];
}

// Video Analysis Types
export interface VideoAnalysisStats {
  totalFrames: number;
  sampledFrames: number;
  analyzedFrames: number;
  duration: number;
  fps: number | null;
  totalDetections: number;
  uniqueClasses: string[];
  violations: number;
  maxPersonCount?: number;
  maxMissingHardhats?: number;
  maxMissingVests?: number;
}

export interface GeminiFrameAnalysis {
  frame_number: number;
  timestamp: number;
  analysis: GeminiAnalysisResult | null;
  error?: string;
}

export interface VideoAnalysisResult {
  filename: string;
  stats: VideoAnalysisStats;
  yoloFrames: FrameDetection[];
  geminiAnalyses: GeminiFrameAnalysis[];
  geminiInterval?: number; // Interval in seconds for Deep Vision verification
  framesToAnalyze?: Array<{ frame_index: number; timestamp: number }>; // Frames that should be analyzed
}

export interface VideoAnalysisResponse {
  success: boolean;
  data?: VideoAnalysisResult;
  error?: string;
}

// Gemini Analysis Types
export interface SafetyCategory {
  summary: string;
  issues: string[];
  recommendations: string[];
}

export interface GeminiAnalysisResult {
  overallDescription: string;
  overallRiskLevel: 'Low' | 'Medium' | 'High';
  constructionSafety: SafetyCategory;
  fireSafety: SafetyCategory;
  propertySecurity: SafetyCategory;
  peopleCount?: number;
  missingHardhats?: number;
  missingVests?: number;
}

export interface AlertItem {
  category: 'construction' | 'fire' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

export interface AlertAnalysisResult {
  overallRiskLevel: 'Low' | 'Medium' | 'High';
  alertCount: number;
  alerts: AlertItem[];
  peopleCount?: number;
  missingHardhats?: number;
  missingVests?: number;
}

// Input Source Types
export type InputSource = 'image' | 'video' | 'webcam' | 'rtsp';
export type AnalysisMode = 'yolo' | 'gemini' | 'alerts';

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
