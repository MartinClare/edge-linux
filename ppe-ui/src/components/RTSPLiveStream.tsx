import React, { useState, useRef, useEffect, useCallback } from 'react';
import { analyzeImageGemini, analyzeImageAlerts } from '../services/geminiApi';
import type { AnalysisMode, GeminiAnalysisResult, AlertAnalysisResult, GeminiDetection } from '../types/detection.types';
import { YOLO_API_URL } from '../config/api';

/** WebSocket must hit the FastAPI backend (same origin as YOLO), not the static UI host (e.g. :3000). */
function yoloRtspStreamWebSocketUrl(): string {
  const base = YOLO_API_URL.replace(/\/$/, '');
  const wsBase = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${wsBase}/ws/rtsp/stream`;
}

interface Detection {
  id: number;
  class_id: number;
  class_name: string;
  confidence: number;
  bbox: number[]; // [x1, y1, x2, y2]
}

interface RTSPLiveStreamProps {
  // Camera-specific props (for multi-camera support)
  cameraId?: string;
  cameraName?: string;
  rtspUrl?: string;
  fpsLimit?: number;
  geminiInterval?: number;
  autoStart?: boolean;
  autoStartDelay?: number; // Delay in ms before auto-starting (for staggered multi-camera start)
  compact?: boolean; // Compact view for multi-camera grid
  allowAnalysis?: boolean; // Whether this camera is allowed to send frames for Deep Vision analysis
  
  // Standard props
  analysisMode: AnalysisMode;
  onFrameUpdate?: (frameData: string, detections: Detection[]) => void;
  onGeminiResult?: (result: GeminiAnalysisResult | null) => void;
  onAlertResult?: (result: AlertAnalysisResult | null) => void;
}

interface CameraConfigItem {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

interface AppConfig {
  rtsp: {
    defaultUrl?: string;
    cameras?: CameraConfigItem[];
    fpsLimit: number;
    geminiInterval: number;
    autoStart: boolean;
  };
}

const RTSPLiveStream: React.FC<RTSPLiveStreamProps> = ({ 
  cameraId = 'default',
  cameraName = 'Camera',
  rtspUrl: propRtspUrl,
  fpsLimit: propFpsLimit,
  geminiInterval: propGeminiInterval,
  autoStart: propAutoStart,
  autoStartDelay = 0, // Default to 0 if not provided
  compact = false,
  allowAnalysis = true, // Default to true for backward compatibility (single camera mode)
  analysisMode, 
  onFrameUpdate, 
  onGeminiResult, 
  onAlertResult 
}) => {
  // Use props if provided (multi-camera mode), otherwise load from config (single camera mode)
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [rtspUrl, setRtspUrl] = useState(propRtspUrl || '');
  const [fpsLimit, setFpsLimit] = useState(propFpsLimit || 15);
  const [geminiInterval, setGeminiInterval] = useState(propGeminiInterval || 5);
  // Default false = do not auto-start; live stream is still startable via button
  const [autoStart, setAutoStart] = useState(propAutoStart ?? false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [fps, setFps] = useState(0);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [allDetections, setAllDetections] = useState<Detection[]>([]);
  const [lastGeminiTime, setLastGeminiTime] = useState(0);
  const [geminiAnalyzing, setGeminiAnalyzing] = useState(false);
  const [latestGeminiResult, setLatestGeminiResult] = useState<GeminiAnalysisResult | null>(null);
  const [latestAlertResult, setLatestAlertResult] = useState<AlertAnalysisResult | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fpsCounterRef = useRef({ count: 0, lastTime: Date.now() });
  const geminiDetectionsRef = useRef<GeminiDetection[]>([]);
  const geminiAbortControllerRef = useRef<AbortController | null>(null);
  const currentAnalysisModeRef = useRef<AnalysisMode>(analysisMode);
  const allowGeminiRequestsRef = useRef<boolean>(analysisMode !== 'yolo');
  const isAnalyzingRef = useRef<boolean>(false);
  const allowAnalysisRef = useRef<boolean>(allowAnalysis);
  const geminiAnalyzingRef = useRef<boolean>(false);
  const lastGeminiTimeRef = useRef<number>(0);
  const geminiIntervalRef = useRef<number>(geminiInterval);
  const latestFrameIndexRef = useRef<number>(0);
  const mountIdRef = useRef<string>(Math.random().toString(36).substr(2, 9));
  const autoStartTriggeredRef = useRef<boolean>(false);
  const [userStoppedStream, setUserStoppedStream] = useState(false);
  const handleConnectRef = useRef<() => void>(() => {});
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const manualDisconnectRef = useRef<boolean>(false);

  // Sync mode refs IMMEDIATELY during render so WebSocket handlers always
  // see the latest value — useEffect fires too late (after paint) and
  // WS messages arriving in between could slip through.
  currentAnalysisModeRef.current = analysisMode;
  allowGeminiRequestsRef.current = analysisMode !== 'yolo';

  // Track component lifecycle
  useEffect(() => {
    console.log(`[RTSP-${cameraId}] 🟢 Component MOUNTED (${mountIdRef.current})`);
    return () => {
      console.log(`[RTSP-${cameraId}] 🔴 Component UNMOUNTING (${mountIdRef.current})`);
      autoStartTriggeredRef.current = false; // Reset so remount can auto-start again
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [cameraId]);

  const scheduleReconnect = useCallback((reason: string) => {
    if (!autoStart || manualDisconnectRef.current) return;
    if (reconnectTimerRef.current) return;

    reconnectAttemptsRef.current += 1;
    const delayMs = Math.min(10000, 1500 * reconnectAttemptsRef.current);
    console.warn(
      `[RTSP-${cameraId}] Scheduling reconnect #${reconnectAttemptsRef.current} in ${delayMs}ms (${reason})`
    );

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (!manualDisconnectRef.current && !wsRef.current) {
        handleConnectRef.current();
      }
    }, delayMs);
  }, [autoStart, cameraId]);

  // Debug: Log when results change
  useEffect(() => {
    console.log(`[RTSP-${cameraId}] 🎯 latestGeminiResult updated:`, latestGeminiResult ? 'HAS RESULT' : 'NULL');
    if (latestGeminiResult) {
      console.log(`[RTSP-${cameraId}] Result details:`, {
        risk: latestGeminiResult.overallRiskLevel,
        people: latestGeminiResult.peopleCount,
        missingHats: latestGeminiResult.missingHardhats,
        missingVests: latestGeminiResult.missingVests
      });
    }
  }, [latestGeminiResult, cameraId]);

  // Debug: Log props
  useEffect(() => {
    console.log(`[RTSP-${cameraId}] Props: analysisMode=${analysisMode}, allowAnalysis=${allowAnalysis}`);
  }, [analysisMode, allowAnalysis, cameraId]);

  // Keep refs synced so ws.onmessage reads latest values (avoids stale closure bugs)
  useEffect(() => {
    allowAnalysisRef.current = allowAnalysis;
  }, [allowAnalysis]);

  useEffect(() => {
    geminiAnalyzingRef.current = geminiAnalyzing;
  }, [geminiAnalyzing]);

  useEffect(() => {
    lastGeminiTimeRef.current = lastGeminiTime;
  }, [lastGeminiTime]);

  useEffect(() => {
    geminiIntervalRef.current = geminiInterval;
  }, [geminiInterval]);

  const handleConnect = () => {
    setUserStoppedStream(false);
    if (!rtspUrl) {
      alert('Please enter an RTSP URL');
      return;
    }

    manualDisconnectRef.current = false;
    setStreamError(null);
    console.log(`[RTSP-${cameraId}] Starting connection...`);

    // Reset stats and Gemini state
    setAllDetections([]);
    setFrameCount(0);
    setDetections([]);
    setFps(0);
    setLastGeminiTime(0);
    lastGeminiTimeRef.current = 0;
    setGeminiAnalyzing(false);
    geminiAnalyzingRef.current = false;
    latestFrameIndexRef.current = 0; // Reset frame index tracker
    setLatestGeminiResult(null);
    setLatestAlertResult(null);
    
    // Clear any ongoing Gemini request
    if (geminiAbortControllerRef.current) {
      geminiAbortControllerRef.current.abort();
      geminiAbortControllerRef.current = null;
    }
    
    // Notify parent to clear results
    if (onGeminiResult) onGeminiResult(null);
    if (onAlertResult) onAlertResult(null);

    const ws = new WebSocket(yoloRtspStreamWebSocketUrl());
    
    ws.onopen = () => {
      console.log(`[RTSP-${cameraId}] WebSocket connected (${mountIdRef.current})`);
      reconnectAttemptsRef.current = 0;
      setUserStoppedStream(false);
      ws.send(JSON.stringify({ rtsp_url: rtspUrl, fps_limit: fpsLimit }));
      setIsStreaming(true);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'stream_info') {
        console.log(`[RTSP-${cameraId}] Stream info:`, data);
      } else if (data.type === 'frame') {
        // Draw frame on canvas
        drawFrame(data.frame_data, data.detections, data.frame_index);
        setFrameCount(data.frame_index);
        setDetections(data.detections);
        
        // Update parent component with frame data for main monitoring dashboard
        if (onFrameUpdate) {
          onFrameUpdate(data.frame_data, data.detections);
        }
        
        // Accumulate all detections for statistics
        setAllDetections(prev => [...prev, ...data.detections]);
        
        // Deep Vision (Gemini) analysis at intervals
        // CRITICAL: Check the block flag AND allowAnalysis prop FIRST before ANY processing
        if (!allowGeminiRequestsRef.current || !allowAnalysisRef.current) {
          // OpenRouter requests are BLOCKED (we're in YOLO mode OR another camera is analyzing)
          // Do NOTHING - skip all Gemini logic entirely
          if (data.frame_index % 50 === 0) {
            console.log(`[RTSP-${cameraId}] Frame ${data.frame_index}: Analysis blocked - allowGeminiRequestsRef=${allowGeminiRequestsRef.current}, allowAnalysis=${allowAnalysisRef.current}`);
          }
        } else {
          // OpenRouter requests are ALLOWED (we're in Deep Vision mode AND this camera's turn)
          const currentTime = Date.now() / 1000;
          const timeSinceLastGemini = currentTime - lastGeminiTimeRef.current;
          
          // Log every 50 frames to avoid spam
          if (data.frame_index % 50 === 0) {
            console.log(`[RTSP-${cameraId}] Frame ${data.frame_index}: Analysis check - timeSince=${timeSinceLastGemini.toFixed(1)}s, interval=${geminiIntervalRef.current}s, analyzing=${geminiAnalyzingRef.current}`);
          }
          
          const shouldRunGemini = !geminiAnalyzingRef.current
            && !isAnalyzingRef.current
            && timeSinceLastGemini >= geminiIntervalRef.current
            && allowAnalysisRef.current
            && currentAnalysisModeRef.current !== 'yolo';
          
          if (shouldRunGemini) {
            const currentMode = currentAnalysisModeRef.current;
            const timestamp = new Date().toISOString();
            console.log(`[RTSP-${cameraId}] 🚀 [${timestamp}] Triggering OpenRouter API request #${Math.floor(currentTime)}`);
            console.log(`  ├─ Camera: ${cameraId}`);
            console.log(`  ├─ Mode: ${currentMode}`);
            console.log(`  ├─ Allowed to analyze: ✅ YES`);
            console.log(`  ├─ Last request time: ${lastGeminiTimeRef.current.toFixed(2)}s`);
            console.log(`  ├─ Current time: ${currentTime.toFixed(2)}s`);
            console.log(`  ├─ Time since last: ${timeSinceLastGemini.toFixed(2)}s`);
            console.log(`  ├─ Interval setting: ${geminiIntervalRef.current}s`);
            console.log(`  └─ Should trigger: ${timeSinceLastGemini >= geminiIntervalRef.current ? '✅ YES' : '❌ NO'}`);
            
            // Set BOTH flags immediately to prevent overlaps
            setGeminiAnalyzing(true);
            geminiAnalyzingRef.current = true;
            isAnalyzingRef.current = true;
            setLastGeminiTime(currentTime);
            lastGeminiTimeRef.current = currentTime;
          
            // Create abort controller for this request
            const abortController = new AbortController();
            geminiAbortControllerRef.current = abortController;
          
            // Convert base64 to File for Gemini API
            fetch(`data:image/jpeg;base64,${data.frame_data}`)
              .then(res => res.blob())
              .then(blob => {
                // CRITICAL: Double-check the block flag AND allowAnalysis before making API call
                if (!allowGeminiRequestsRef.current || !allowAnalysisRef.current) {
                  console.log(`[RTSP-${cameraId}] ⚠️ OpenRouter requests are now BLOCKED or not allowed, aborting API call`);
                  setGeminiAnalyzing(false);
                  geminiAnalyzingRef.current = false;
                  isAnalyzingRef.current = false;
                  return;
                }
                
                // Check if aborted
                if (abortController.signal.aborted) {
                  console.log('[RTSP] ⚠️ Gemini request aborted before API call');
                  setGeminiAnalyzing(false);
                  geminiAnalyzingRef.current = false;
                  isAnalyzingRef.current = false;
                  return;
                }
              
                const file = new File([blob], `frame_${data.frame_index}.jpg`, { type: 'image/jpeg' });
              
                if (currentAnalysisModeRef.current === 'gemini' && onGeminiResult) {
                  const startTime = Date.now();
                  return analyzeImageGemini(file, 'en').then(result => {
                    // CRITICAL: Check block flag after API call completes
                    if (!allowGeminiRequestsRef.current || abortController.signal.aborted) {
                      console.log('[RTSP] ⚠️ OpenRouter requests blocked during API call, discarding result');
                      setGeminiAnalyzing(false);
                      geminiAnalyzingRef.current = false;
                      isAnalyzingRef.current = false;
                      return;
                    }
                    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                    const completeTime = new Date().toISOString();
                    console.log(`[RTSP-${cameraId}] ✅ [${completeTime}] Gemini analysis complete (took ${duration}s)`);
                    console.log(`[RTSP-${cameraId}] Result:`, result);
                    geminiDetectionsRef.current = result.detections || [];
                    setLatestGeminiResult(result);
                    if (onGeminiResult) onGeminiResult(result);
                    setGeminiAnalyzing(false);
                    geminiAnalyzingRef.current = false;
                    isAnalyzingRef.current = false;
                  });
                } else if (currentAnalysisModeRef.current === 'alerts' && onAlertResult) {
                  const startTime = Date.now();
                  return analyzeImageAlerts(file, 'en').then(result => {
                    // CRITICAL: Check block flag after API call completes
                    if (!allowGeminiRequestsRef.current || abortController.signal.aborted) {
                      console.log('[RTSP] ⚠️ OpenRouter requests blocked during API call, discarding result');
                      setGeminiAnalyzing(false);
                      geminiAnalyzingRef.current = false;
                      isAnalyzingRef.current = false;
                      return;
                    }
                    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                    const completeTime = new Date().toISOString();
                    console.log(`[RTSP] ✅ [${completeTime}] Alert analysis complete (took ${duration}s)`);
                    geminiDetectionsRef.current = result.detections || [];
                    setLatestAlertResult(result);
                    onAlertResult(result);
                    setGeminiAnalyzing(false);
                    geminiAnalyzingRef.current = false;
                    isAnalyzingRef.current = false;
                  });
                }
              })
              .catch(err => {
                if (!abortController.signal.aborted) {
                  console.error('[RTSP] ❌ Gemini analysis error:', err);
                }
                setGeminiAnalyzing(false);
                geminiAnalyzingRef.current = false;
                isAnalyzingRef.current = false;
              });
            }
        } // End of allowed requests check
        
        // Update FPS counter
        fpsCounterRef.current.count++;
        const now = Date.now();
        if (now - fpsCounterRef.current.lastTime >= 1000) {
          setFps(fpsCounterRef.current.count);
          fpsCounterRef.current.count = 0;
          fpsCounterRef.current.lastTime = now;
        }
      } else if (data.type === 'error') {
        console.error('Stream error:', data.message);
        setStreamError(data.message || 'Stream failed');
        setIsStreaming(false);
        scheduleReconnect(`stream error: ${data.message}`);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setStreamError(
        `Cannot reach live stream at ${yoloRtspStreamWebSocketUrl()}. ` +
          'Ensure the edge API (port 8000) is running and matches YOLO_API_URL.'
      );
      setIsStreaming(false);
      scheduleReconnect('websocket error');
    };

    ws.onclose = () => {
      console.log(`[RTSP-${cameraId}] WebSocket closed (${mountIdRef.current})`);
      setIsStreaming(false);
      wsRef.current = null;
      scheduleReconnect('socket closed');
    };

    wsRef.current = ws;
  };

  // Keep ref updated so delayed auto-start calls latest handleConnect
  handleConnectRef.current = handleConnect;

  const handleDisconnect = () => {
    console.log(`[RTSP-${cameraId}] Disconnecting stream (${mountIdRef.current}) and stopping OpenRouter requests`);
    manualDisconnectRef.current = true;
    setUserStoppedStream(true);
    reconnectAttemptsRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ command: 'stop' }));
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Abort any ongoing Gemini request
    if (geminiAbortControllerRef.current) {
      geminiAbortControllerRef.current.abort();
      geminiAbortControllerRef.current = null;
    }
    
    setIsStreaming(false);
    setGeminiAnalyzing(false);
    geminiAnalyzingRef.current = false;
    setLastGeminiTime(0);
    lastGeminiTimeRef.current = 0;
    latestFrameIndexRef.current = 0;
    geminiDetectionsRef.current = [];
    setLatestGeminiResult(null);
    setLatestAlertResult(null);
    
    // Notify parent to clear results
    if (onGeminiResult) onGeminiResult(null);
    if (onAlertResult) onAlertResult(null);
  };

  // Queue for pending frames to ensure sequential rendering
  const pendingFramesRef = useRef<{frameData: string, detections: Detection[], frameIndex: number}[]>([]);
  const isRenderingRef = useRef(false);

  const processFrameQueue = () => {
    if (isRenderingRef.current || pendingFramesRef.current.length === 0) {
      return;
    }

    isRenderingRef.current = true;
    
    // Sort by frame index to ensure correct order
    pendingFramesRef.current.sort((a, b) => a.frameIndex - b.frameIndex);
    
    // Get the latest frame (highest index)
    const latest = pendingFramesRef.current[pendingFramesRef.current.length - 1];
    
    // Clear queue - we only render the latest frame
    pendingFramesRef.current = [];
    
    renderFrame(latest.frameData, latest.detections, latest.frameIndex);
  };

  const renderFrame = (frameDataB64: string, detections: Detection[], frameIndex: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      isRenderingRef.current = false;
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      isRenderingRef.current = false;
      return;
    }

    // Check if we're still connected
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      isRenderingRef.current = false;
      return;
    }

    const img = new Image();
    
    img.onload = () => {
      // Check connection again after async load
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        isRenderingRef.current = false;
        return;
      }

      // Only set canvas size if it changed (prevents flickering)
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
      }

      // Clear and draw in single operation to minimize flicker
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      // Draw YOLO bounding boxes (currently empty on RK3576 — stub)
      detections.forEach((det) => {
        if (det.confidence < 0.5) return;

        const [x1, y1, x2, y2] = det.bbox;
        const width = x2 - x1;
        const height = y2 - y1;

        const isViolation = det.class_name.includes('NO-');
        ctx.strokeStyle = isViolation ? '#ff4444' : '#00ff00';
        ctx.lineWidth = 3;
        ctx.strokeRect(x1, y1, width, height);

        const label = `${det.class_name} ${(det.confidence * 100).toFixed(1)}%`;
        ctx.font = 'bold 16px Arial';
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = isViolation ? '#ff4444' : '#00ff00';
        ctx.fillRect(x1, y1 - 25, textWidth + 10, 25);
        ctx.fillStyle = '#000';
        ctx.fillText(label, x1 + 5, y1 - 7);
      });

      // Draw Gemini bounding boxes (persisted from last analysis)
      const geminiDets = geminiDetectionsRef.current;
      if (geminiDets && geminiDets.length > 0) {
        const W = canvas.width;
        const H = canvas.height;

        const COLORS: Record<string, { stroke: string; fill: string; text: string }> = {
          // PPE status
          person_ok:          { stroke: '#00e676', fill: 'rgba(0,230,118,0.12)',   text: '✓ PPE OK' },
          no_hardhat:         { stroke: '#ff9800', fill: 'rgba(255,152,0,0.15)',   text: '⚠ No Hardhat' },
          no_vest:            { stroke: '#ff9800', fill: 'rgba(255,152,0,0.15)',   text: '⚠ No Vest' },
          no_hardhat_no_vest: { stroke: '#f44336', fill: 'rgba(244,67,54,0.18)',   text: '✗ No PPE' },
          // Critical hazards
          fire_smoke:         { stroke: '#ff1744', fill: 'rgba(255,23,68,0.20)',   text: '🔥 Fire/Smoke' },
          smoking:            { stroke: '#ff6d00', fill: 'rgba(255,109,0,0.18)',   text: '🚬 Smoking' },
          machine_proximity:  { stroke: '#d500f9', fill: 'rgba(213,0,249,0.18)',   text: '⚙ Machine Danger' },
          working_at_height:  { stroke: '#ffea00', fill: 'rgba(255,234,0,0.15)',   text: '⬆ Height Risk' },
          person_fallen:      { stroke: '#ff1744', fill: 'rgba(255,23,68,0.22)',   text: '🆘 Person Fallen' },
          safety_hazard:      { stroke: '#ff6d00', fill: 'rgba(255,109,0,0.18)',   text: '⚠ Hazard' },
        };

        geminiDets.forEach((det) => {
          const [yMin, xMin, yMax, xMax] = det.bbox;
          const x = (xMin / 1000) * W;
          const y = (yMin / 1000) * H;
          const w = ((xMax - xMin) / 1000) * W;
          const h = ((yMax - yMin) / 1000) * H;

          const c = COLORS[det.label] || COLORS['person_ok'];

          // Semi-transparent fill
          ctx.fillStyle = c.fill;
          ctx.fillRect(x, y, w, h);

          // Border — dashed + thicker for critical hazards
          const isHazardBox = ['fire_smoke','smoking','machine_proximity','person_fallen'].includes(det.label);
          ctx.strokeStyle = c.stroke;
          ctx.lineWidth = isHazardBox ? 3.5 : 2.5;
          if (isHazardBox) {
            ctx.setLineDash([8, 4]);
          } else {
            ctx.setLineDash([]);
          }
          ctx.strokeRect(x, y, w, h);
          ctx.setLineDash([]);

          // Label badge — append description for hazard detections
          const isHazard = ['fire_smoke','smoking','machine_proximity','working_at_height','person_fallen','safety_hazard'].includes(det.label);
          const labelText = isHazard && det.description
            ? `${c.text}: ${det.description.substring(0, 40)}`
            : c.text;
          ctx.font = `bold ${isHazard ? 12 : 13}px Arial`;
          const textW = ctx.measureText(labelText).width;
          const badgeH = isHazard ? 18 : 20;
          const badgeY = y > badgeH ? y - badgeH : y + h;
          ctx.fillStyle = c.stroke;
          ctx.fillRect(x, badgeY, textW + 10, badgeH);
          ctx.fillStyle = '#000';
          ctx.fillText(labelText, x + 5, badgeY + badgeH - 4);
        });
      }

      ctx.restore();
      isRenderingRef.current = false;
      
      // Process any queued frames
      setTimeout(() => processFrameQueue(), 0);
    };
    
    img.onerror = () => {
      console.error(`[RTSP-${cameraId}] Failed to load frame ${frameIndex} image`);
      isRenderingRef.current = false;
      setTimeout(() => processFrameQueue(), 0);
    };
    
    img.src = `data:image/jpeg;base64,${frameDataB64}`;
  };

  const drawFrame = (frameDataB64: string, detections: Detection[], frameIndex: number) => {
    // Add to queue instead of rendering immediately
    pendingFramesRef.current.push({
      frameData: frameDataB64,
      detections: detections,
      frameIndex: frameIndex
    });
    
    // Limit queue size to prevent memory buildup
    if (pendingFramesRef.current.length > 3) {
      pendingFramesRef.current = pendingFramesRef.current.slice(-3);
    }
    
    processFrameQueue();
  };

  // Handle side effects when analysis mode changes (refs are already synced during render above)
  useEffect(() => {
    const isYolo = analysisMode === 'yolo';
    console.log('[RTSP] Analysis mode changed to:', analysisMode, '| OpenRouter requests:', isYolo ? '🛑 BLOCKED' : '✅ ALLOWED');
    
    if (isYolo) {
      console.log('[RTSP] 🛑 Switched to YOLO mode, stopping OpenRouter requests');
      
      if (geminiAbortControllerRef.current) {
        geminiAbortControllerRef.current.abort();
        geminiAbortControllerRef.current = null;
      }
      
      setGeminiAnalyzing(false);
      geminiAnalyzingRef.current = false;
      isAnalyzingRef.current = false;
      setLatestGeminiResult(null);
      setLatestAlertResult(null);
      setLastGeminiTime(0);
      lastGeminiTimeRef.current = 0;
      
      if (onGeminiResult) onGeminiResult(null);
      if (onAlertResult) onAlertResult(null);
    } else if (analysisMode === 'gemini' || analysisMode === 'alerts') {
      console.log('[RTSP] 🚀 Entered Deep Vision mode, OpenRouter requests will start');
      setLastGeminiTime(0);
      lastGeminiTimeRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log(`[RTSP-${cameraId}] Component unmounting, cleaning up...`);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (geminiAbortControllerRef.current) {
        geminiAbortControllerRef.current.abort();
        geminiAbortControllerRef.current = null;
      }
    };
  }, [cameraId]);

  // Keep RTSP URL in sync when parent passes a new URL (e.g. grid key / settings edit)
  useEffect(() => {
    if (propRtspUrl) setRtspUrl(propRtspUrl);
  }, [propRtspUrl]);

  // Load configuration from app.config.json (only if props not provided)
  useEffect(() => {
    // If props are provided (multi-camera mode), skip config loading
    if (propRtspUrl) {
      console.log(`[RTSP-${cameraId}] Using provided configuration`);
      setConfig({ rtsp: { defaultUrl: propRtspUrl, fpsLimit: propFpsLimit || 15, geminiInterval: propGeminiInterval || 5, autoStart: propAutoStart ?? false } });
      return; // Skip config file loading
    }

    // Single camera mode: load from config file
    fetch(`${YOLO_API_URL}/api/config`)
      .then(res => res.json())
      .then((data: AppConfig) => {
        console.log(`[RTSP-${cameraId}] Loaded configuration:`, data.rtsp);
        setConfig(data);
        // Support both defaultUrl and cameras array (use first enabled camera if cameras)
        const url = data.rtsp.defaultUrl ?? data.rtsp.cameras?.find(c => c.enabled)?.url ?? data.rtsp.cameras?.[0]?.url ?? '';
        setRtspUrl(url);
        setFpsLimit(data.rtsp.fpsLimit);
        setGeminiInterval(data.rtsp.geminiInterval);
        setAutoStart(data.rtsp.autoStart);
      })
      .catch(err => {
        console.error(`[RTSP-${cameraId}] Failed to load configuration:`, err);
        // Set defaults if config load fails
        setRtspUrl('rtsp://admin:123456@192.168.1.3:554/Streaming/Channels/1');
        setFpsLimit(15);
        setGeminiInterval(5);
        setAutoStart(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, propRtspUrl, propFpsLimit, propGeminiInterval, propAutoStart]);

  // Auto-start with staggered delay (avoids all cameras connecting at once → flicker)
  useEffect(() => {
    if (!autoStart || !rtspUrl || !config || autoStartTriggeredRef.current) return;

    const delayMs = 1500 + autoStartDelay; // Base delay so DOM/canvas is ready; stagger per camera
    console.log(`[RTSP-${cameraId}] Auto-start enabled, connecting in ${delayMs}ms`);

    autoStartTriggeredRef.current = true;
    const t = setTimeout(() => {
      handleConnectRef.current?.();
    }, delayMs);

    return () => clearTimeout(t);
  }, [autoStart, autoStartDelay, cameraId, config, rtspUrl]);

  return (
    <div className="rtsp-live-stream">
      {!compact && <h4>🔴 RTSP Live Stream with Real-Time Detection</h4>}

      {!isStreaming && (
        <>
          {!compact && (
          <div style={{ 
            padding: '1rem', 
            background: 'rgba(255, 255, 255, 0.05)', 
            borderRadius: '8px',
            marginBottom: '1rem',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <h4 style={{ marginTop: 0, color: '#00d9ff' }}>📋 Stream Configuration</h4>
            <div style={{ fontSize: '0.9rem', lineHeight: '1.8' }}>
              <div><strong>FPS Limit:</strong> {fpsLimit} fps</div>
              <div><strong>Deep Vision Interval:</strong> {geminiInterval} seconds</div>
              <div><strong>Auto-start:</strong> {config?.rtsp.autoStart ? '✅ Enabled' : '❌ Disabled'}</div>
            </div>
            <small style={{ 
              display: 'block', 
              marginTop: '0.75rem', 
              color: 'rgba(255, 255, 255, 0.6)',
              fontStyle: 'italic'
            }}>
              💡 To change settings, edit <code>app.config.json</code>
            </small>
          </div>
          )}

          {compact && autoStart && !streamError && (
            <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.65)', marginBottom: '0.5rem' }}>
              Connecting live stream…
            </div>
          )}

          {streamError && (
            <div style={{
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              background: 'rgba(244, 67, 54, 0.15)',
              border: '1px solid rgba(244, 67, 54, 0.4)',
              borderRadius: '8px',
              color: '#ff8a80',
              fontSize: compact ? '0.8rem' : '0.9rem',
            }}>
              <strong>Stream error:</strong> {streamError}
              <div style={{ marginTop: '0.35rem', fontSize: '0.85rem', opacity: 0.9 }}>
                Check the RTSP URL (port, path, credentials) and that the camera is reachable. Use Settings → Scan network to discover working URLs.
              </div>
            </div>
          )}

          {(!compact || !autoStart || streamError || userStoppedStream) && (
          <button
            className="connect-btn"
            onClick={handleConnect}
            disabled={isStreaming || !rtspUrl || !config}
          >
            {!config ? '⏳ Loading Configuration...' : '📡 Start Live Stream'}
          </button>
          )}
        </>
      )}

      {isStreaming && (
        <>
          <div className="stream-stats" style={compact ? { fontSize: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' } : undefined}>
            <span>📊 Frame: {frameCount}</span>
            <span>⚡ FPS: {fps}</span>
            <span>🎯 Detections: {detections.length}</span>
          </div>

          <button
            className="disconnect-btn"
            onClick={handleDisconnect}
            style={{ background: '#ff4444', marginBottom: compact ? '0.5rem' : '1rem', fontSize: compact ? '0.8rem' : undefined, padding: compact ? '0.35rem 0.65rem' : undefined }}
          >
            ⏹ Stop Stream
          </button>
        </>
      )}

      {/* Canvas always in DOM so ref is set before auto-start; visibility controlled by container */}
      <div
        className="video-container"
        style={{
          position: 'relative',
          display: isStreaming ? 'inline-block' : 'none',
          maxWidth: compact ? '100%' : '800px',
          width: '100%',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: 'auto',
            border: compact ? '1px solid rgba(0, 217, 255, 0.3)' : '2px solid #00d9ff',
            borderRadius: compact ? '4px' : '8px',
          }}
        />
      </div>

      {isStreaming && (
        <>
          <div className="detections-summary" style={{ marginTop: '1rem' }}>
            <h4>Current Frame Detections ({detections.length}):</h4>
            {detections.filter(d => d.confidence > 0.5).map((det, i) => (
              <div key={i} style={{ 
                padding: '0.5rem', 
                margin: '0.25rem 0',
                background: det.class_name.includes('NO-') ? '#442222' : '#224422',
                borderRadius: '4px'
              }}>
                <strong>{det.class_name}</strong> - {(det.confidence * 100).toFixed(1)}%
              </div>
            ))}
          </div>
          
          {(analysisMode === 'gemini' || analysisMode === 'alerts') && (
            <>
              {/* Status Indicator */}
              <div style={{ 
                marginTop: '1rem', 
                padding: '0.5rem 0.75rem', 
                background: allowAnalysis ? 'rgba(156, 39, 176, 0.15)' : 'rgba(156, 39, 176, 0.05)', 
                borderRadius: '4px', 
                border: allowAnalysis ? '2px solid rgba(156, 39, 176, 0.5)' : '1px solid rgba(156, 39, 176, 0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <span style={{ fontSize: '1.2rem' }}>{allowAnalysis ? '🔍' : '⏳'}</span>
                <span style={{ 
                  color: allowAnalysis ? '#bb86fc' : 'rgba(187, 134, 252, 0.5)', 
                  fontWeight: 500,
                  fontSize: '0.9rem'
                }}>
                  {geminiAnalyzing ? '🚀 Analyzing...' : 
                   allowAnalysis ? `🟢 Active - Next in ${geminiInterval}s` : 
                   '⏸ Waiting...'}
                </span>
              </div>

              {/* Inline Results Display - Full Dashboard */}
              {analysisMode === 'gemini' && latestGeminiResult && (() => {
                console.log(`[RTSP-${cameraId}] Rendering Gemini result:`, latestGeminiResult);
                return (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '1rem',
                  background: 'linear-gradient(135deg, rgba(106, 27, 154, 0.15) 0%, rgba(156, 39, 176, 0.15) 100%)',
                  border: '2px solid rgba(156, 39, 176, 0.4)',
                  borderRadius: '8px',
                  fontSize: '0.85rem'
                }}>
                  {/* Header */}
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.25rem'
                    }}>
                      <span style={{ fontSize: '1.5rem' }}>🤖</span>
                      <strong style={{ color: '#e1bee7', fontSize: '1rem' }}>Deep Vision AI Analysis</strong>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
                      Comprehensive AI-powered safety assessment
                    </div>
                  </div>

                  {/* Risk Level */}
                  <div style={{
                    padding: '0.75rem',
                    background: latestGeminiResult.overallRiskLevel === 'High' ? 'rgba(233, 69, 96, 0.2)' :
                                latestGeminiResult.overallRiskLevel === 'Medium' ? 'rgba(255, 152, 0, 0.2)' :
                                'rgba(76, 175, 80, 0.2)',
                    borderRadius: '6px',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <span style={{ fontSize: '1.2rem' }}>
                      {latestGeminiResult.overallRiskLevel === 'High' ? '🔴' :
                       latestGeminiResult.overallRiskLevel === 'Medium' ? '🟡' : '🟢'}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'rgba(255,255,255,0.8)' }}>
                        Risk Level: <span style={{
                          color: latestGeminiResult.overallRiskLevel === 'High' ? '#e94560' :
                                 latestGeminiResult.overallRiskLevel === 'Medium' ? '#ff9800' : '#4caf50'
                        }}>{latestGeminiResult.overallRiskLevel}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginTop: '0.25rem' }}>
                        {latestGeminiResult.overallDescription}
                      </div>
                    </div>
                  </div>

                  {/* People & PPE Status */}
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ 
                      fontWeight: 600, 
                      fontSize: '0.85rem', 
                      marginBottom: '0.5rem',
                      color: '#e1bee7'
                    }}>
                      👥 People & PPE Status
                    </div>
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(3, 1fr)', 
                      gap: '0.5rem'
                    }}>
                      <div style={{ 
                        padding: '0.75rem', 
                        background: 'rgba(0, 217, 255, 0.1)',
                        border: '1px solid rgba(0, 217, 255, 0.3)',
                        borderRadius: '6px',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#00d9ff', marginBottom: '0.25rem' }}>
                          {latestGeminiResult.peopleCount || 0}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)' }}>Persons Detected</div>
                      </div>
                      <div style={{ 
                        padding: '0.75rem', 
                        background: (latestGeminiResult.missingHardhats ?? 0) > 0 ? 'rgba(233, 69, 96, 0.1)' : 'rgba(76, 175, 80, 0.1)',
                        border: `1px solid ${(latestGeminiResult.missingHardhats ?? 0) > 0 ? 'rgba(233, 69, 96, 0.3)' : 'rgba(76, 175, 80, 0.3)'}`,
                        borderRadius: '6px',
                        textAlign: 'center'
                      }}>
                        <div style={{ 
                          fontSize: '1.5rem', 
                          fontWeight: 'bold', 
                          color: (latestGeminiResult.missingHardhats ?? 0) > 0 ? '#e94560' : '#4caf50',
                          marginBottom: '0.25rem'
                        }}>
                          {latestGeminiResult.missingHardhats ?? 0}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)' }}>Missing Hardhats</div>
                      </div>
                      <div style={{ 
                        padding: '0.75rem', 
                        background: (latestGeminiResult.missingVests ?? 0) > 0 ? 'rgba(233, 69, 96, 0.1)' : 'rgba(76, 175, 80, 0.1)',
                        border: `1px solid ${(latestGeminiResult.missingVests ?? 0) > 0 ? 'rgba(233, 69, 96, 0.3)' : 'rgba(76, 175, 80, 0.3)'}`,
                        borderRadius: '6px',
                        textAlign: 'center'
                      }}>
                        <div style={{ 
                          fontSize: '1.5rem', 
                          fontWeight: 'bold', 
                          color: (latestGeminiResult.missingVests ?? 0) > 0 ? '#e94560' : '#4caf50',
                          marginBottom: '0.25rem'
                        }}>
                          {latestGeminiResult.missingVests ?? 0}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)' }}>Missing Safety Vests</div>
                      </div>
                    </div>
                  </div>

                  {/* Construction Safety */}
                  {latestGeminiResult.constructionSafety && (
                    <div style={{
                      marginBottom: '0.75rem',
                      padding: '0.75rem',
                      background: 'rgba(0, 0, 0, 0.3)',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 152, 0, 0.3)'
                    }}>
                      <div style={{ 
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        marginBottom: '0.5rem',
                        fontWeight: 600,
                        color: '#ffa726'
                      }}>
                        <span>🏗️</span>
                        <span style={{ fontSize: '0.85rem' }}>Construction Safety</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)', marginBottom: '0.5rem' }}>
                        {latestGeminiResult.constructionSafety.summary}
                      </div>
                      {latestGeminiResult.constructionSafety.issues && latestGeminiResult.constructionSafety.issues.length > 0 && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ 
                            fontSize: '0.75rem', 
                            fontWeight: 600, 
                            color: '#e94560',
                            marginBottom: '0.25rem'
                          }}>
                            ⚠️ Issues:
                          </div>
                          <ul style={{ 
                            margin: '0', 
                            paddingLeft: '1.2rem', 
                            fontSize: '0.7rem',
                            color: 'rgba(255,255,255,0.7)'
                          }}>
                            {latestGeminiResult.constructionSafety.issues.map((issue, i) => (
                              <li key={i} style={{ marginBottom: '0.2rem' }}>{issue}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Fire Safety */}
                  {latestGeminiResult.fireSafety && (
                    <div style={{
                      marginBottom: '0.75rem',
                      padding: '0.75rem',
                      background: 'rgba(0, 0, 0, 0.3)',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 87, 34, 0.3)'
                    }}>
                      <div style={{ 
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        marginBottom: '0.5rem',
                        fontWeight: 600,
                        color: '#ff7043'
                      }}>
                        <span>🔥</span>
                        <span style={{ fontSize: '0.85rem' }}>Fire Safety</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)', marginBottom: '0.5rem' }}>
                        {latestGeminiResult.fireSafety.summary}
                      </div>
                      {latestGeminiResult.fireSafety.issues && latestGeminiResult.fireSafety.issues.length > 0 && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ 
                            fontSize: '0.75rem', 
                            fontWeight: 600, 
                            color: '#e94560',
                            marginBottom: '0.25rem'
                          }}>
                            ⚠️ Issues:
                          </div>
                          <ul style={{ 
                            margin: '0', 
                            paddingLeft: '1.2rem', 
                            fontSize: '0.7rem',
                            color: 'rgba(255,255,255,0.7)'
                          }}>
                            {latestGeminiResult.fireSafety.issues.map((issue, i) => (
                              <li key={i} style={{ marginBottom: '0.2rem' }}>{issue}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Property Security */}
                  {latestGeminiResult.propertySecurity && (
                    <div style={{
                      padding: '0.75rem',
                      background: 'rgba(0, 0, 0, 0.3)',
                      borderRadius: '6px',
                      border: '1px solid rgba(33, 150, 243, 0.3)'
                    }}>
                      <div style={{ 
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        marginBottom: '0.5rem',
                        fontWeight: 600,
                        color: '#42a5f5'
                      }}>
                        <span>🔒</span>
                        <span style={{ fontSize: '0.85rem' }}>Property Security</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)', marginBottom: '0.5rem' }}>
                        {latestGeminiResult.propertySecurity.summary}
                      </div>
                      {latestGeminiResult.propertySecurity.issues && latestGeminiResult.propertySecurity.issues.length > 0 && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <div style={{ 
                            fontSize: '0.75rem', 
                            fontWeight: 600, 
                            color: '#e94560',
                            marginBottom: '0.25rem'
                          }}>
                            ⚠️ Issues:
                          </div>
                          <ul style={{ 
                            margin: '0', 
                            paddingLeft: '1.2rem', 
                            fontSize: '0.7rem',
                            color: 'rgba(255,255,255,0.7)'
                          }}>
                            {latestGeminiResult.propertySecurity.issues.map((issue, i) => (
                              <li key={i} style={{ marginBottom: '0.2rem' }}>{issue}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })()}
              
              {analysisMode === 'alerts' && latestAlertResult && (
                <div style={{
                  marginTop: '0.75rem',
                  padding: '0.75rem',
                  background: 'rgba(156, 39, 176, 0.1)',
                  border: '1px solid rgba(156, 39, 176, 0.3)',
                  borderRadius: '6px',
                  fontSize: '0.85rem'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    marginBottom: '0.5rem'
                  }}>
                    <strong style={{ color: '#bb86fc' }}>🚨 Alerts</strong>
                    <span style={{ 
                      padding: '0.2rem 0.5rem',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: latestAlertResult.alertCount > 0 ? 'rgba(233, 69, 96, 0.2)' : 'rgba(76, 175, 80, 0.2)',
                      color: latestAlertResult.alertCount > 0 ? '#e94560' : '#4caf50'
                    }}>
                      {latestAlertResult.alertCount} Alert{latestAlertResult.alertCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {latestAlertResult.alerts && latestAlertResult.alerts.length > 0 && (
                    <div style={{ fontSize: '0.75rem' }}>
                      {latestAlertResult.alerts.slice(0, 3).map((alert, i) => (
                        <div key={i} style={{ 
                          marginTop: '0.3rem',
                          padding: '0.3rem 0.5rem',
                          background: 'rgba(233, 69, 96, 0.1)',
                          borderRadius: '4px',
                          borderLeft: '3px solid #e94560'
                        }}>
                          {alert.message}
                        </div>
                      ))}
                      {latestAlertResult.alerts.length > 3 && (
                        <div style={{ 
                          marginTop: '0.3rem',
                          fontSize: '0.7rem',
                          color: 'rgba(255,255,255,0.5)',
                          fontStyle: 'italic'
                        }}>
                          +{latestAlertResult.alerts.length - 3} more alert{latestAlertResult.alerts.length - 3 !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      <div className="rtsp-help">
        <p>Real-time features:</p>
        <ul>
          <li>✅ Live video display</li>
          <li>✅ Real-time object detection (runs on each frame)</li>
          <li>✅ Bounding boxes drawn on video</li>
          <li>✅ FPS counter</li>
          {analysisMode === 'gemini' && <li>✅ Deep Vision AI analysis every {geminiInterval}s</li>}
        </ul>
      </div>
    </div>
  );
};

export default RTSPLiveStream;
