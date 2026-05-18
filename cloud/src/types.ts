/**
 * Type definitions for the safety analysis API
 */

/**
 * Risk level enumeration
 */
export type RiskLevel = 'Low' | 'Medium' | 'High';

/**
 * Safety category analysis result
 */
export interface SafetyCategory {
  summary: string;
  issues: string[];
  recommendations: string[];
}

/**
 * Bounding box detection entry returned by Gemini.
 * bbox is [y_min, x_min, y_max, x_max] normalized 0–1000.
 *
 * PPE labels:     person_ok | no_hardhat | no_vest | no_hardhat_no_vest
 * Hazard labels:  fire_smoke | smoking | machine_proximity | working_at_height | person_fallen | safety_hazard
 */
export interface GeminiDetection {
  label:
    | 'person_ok'
    | 'no_hardhat'
    | 'no_vest'
    | 'no_hardhat_no_vest'
    | 'fire_smoke'
    | 'smoking'
    | 'machine_proximity'
    | 'working_at_height'
    | 'person_fallen'
    | 'safety_hazard';
  bbox: [number, number, number, number];
  description?: string;
}

/** Local inspector + Gemma evaluator metadata (no OpenRouter). */
export type EvaluatorConfidence = 'Low' | 'Medium' | 'High';

export interface LocalAnalysisMetadata {
  shouldReport: boolean;
  evaluatorRationale?: string;
  confidence?: EvaluatorConfidence;
  inspectorModel?: string;
  evaluatorModel?: string;
  yoloGate?: {
    decision: string;
    reason: string;
    detectionCount?: number;
    interestingCount?: number;
    yoloLatencyMs?: number;
    sceneChangeScore?: number;
  };
}

/**
 * Complete safety analysis response (same JSON shape; optional local two-stage fields).
 */
export interface SafetyAnalysisResult {
  overallDescription: string;
  overallRiskLevel: RiskLevel;
  constructionSafety: SafetyCategory;
  fireSafety: SafetyCategory;
  propertySecurity: SafetyCategory;
  peopleCount?: number;
  missingHardhats?: number;
  missingVests?: number;
  detections?: GeminiDetection[];
  localMeta?: LocalAnalysisMetadata;
}

/**
 * API success response
 */
export interface AnalysisSuccessResponse {
  success: true;
  data: SafetyAnalysisResult;
}

/**
 * API error response
 */
export interface AnalysisErrorResponse {
  success: false;
  error: string;
}

/**
 * Combined API response type
 */
export type AnalysisResponse = AnalysisSuccessResponse | AnalysisErrorResponse;

/**
 * Alert item for streamlined safety alerts
 */
export interface SafetyAlert {
  category: 'construction' | 'fire' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

/**
 * Streamlined alert-only analysis result
 */
export interface AlertAnalysisResult {
  overallRiskLevel: RiskLevel;
  alertCount: number;
  alerts: SafetyAlert[];
  peopleCount?: number;
  missingHardhats?: number;
  missingVests?: number;
  detections?: GeminiDetection[];
}

/**
 * API success response for alerts
 */
export interface AlertSuccessResponse {
  success: true;
  data: AlertAnalysisResult;
}

/**
 * API error response for alerts
 */
export interface AlertErrorResponse {
  success: false;
  error: string;
}

/**
 * Combined API response type for alerts
 */
export type AlertResponse = AlertSuccessResponse | AlertErrorResponse;
