import React, { useState, useEffect, useCallback } from 'react';
import RTSPLiveStream from './RTSPLiveStream';
import SettingsModal from './SettingsModal';
import type { AnalysisMode, GeminiAnalysisResult, AlertAnalysisResult } from '../types/detection.types';
import { YOLO_API_URL } from '../config/api';

interface CameraConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  tailscaleUrl?: string;
  useTailscale?: boolean;
}

interface CentralServerConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
}

interface VpnConfig {
  enabled: boolean;
}

interface AppConfig {
  ui?: {
    defaultAnalysisMode?: AnalysisMode;
    deepVisionEnabled?: boolean;
  };
  rtsp: {
    cameras: CameraConfig[];
    fpsLimit: number;
    geminiInterval: number;
    autoStart: boolean;
  };
  centralServer?: CentralServerConfig;
  vpn?: VpnConfig;
  tailscale?: { enabled: boolean; mode?: 'inbound' | 'outbound' };
}

interface MultiCameraGridProps {
  analysisMode: AnalysisMode;
  onGeminiResult?: (cameraId: string, cameraName: string, result: GeminiAnalysisResult | null) => void;
  onAlertResult?: (cameraId: string, cameraName: string, result: AlertAnalysisResult | null) => void;
}

interface BackendDeepVisionResult {
  camera_id: string;
  camera_name?: string;
  updated_at: number;
  analysis: GeminiAnalysisResult;
}

const MultiCameraGrid: React.FC<MultiCameraGridProps> = ({
  analysisMode,
  onGeminiResult,
  onAlertResult
}) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [enabledCameras, setEnabledCameras] = useState<CameraConfig[]>([]);
  const [cameraUrls, setCameraUrls] = useState<Record<string, string>>({}); // Track edited URLs
  const [cameraTailscaleUrls, setCameraTailscaleUrls] = useState<Record<string, string>>({}); // Track edited tailscale URLs
  const [cameraUseTailscale, setCameraUseTailscale] = useState<Record<string, boolean>>({}); // Track per-camera route selection
  const [cameraNames, setCameraNames] = useState<Record<string, string>>({}); // Track edited names
  const [cameraEnabled, setCameraEnabled] = useState<Record<string, boolean>>({}); // Track enabled states
  const [fpsLimit, setFpsLimit] = useState<number>(15);
  const [geminiInterval, setGeminiInterval] = useState<number>(5);
  const [autoStart, setAutoStart] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState(false);
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);
  const [configRetryToken, setConfigRetryToken] = useState(0);

  // Global Deep Vision rotation: which camera is allowed to analyze next
  const [currentAnalysisCameraId, setCurrentAnalysisCameraId] = useState<string | null>(null);
  const [lastAnalysisTime, setLastAnalysisTime] = useState<number>(0);
  
  // Store latest results per camera
  const [cameraResults, setCameraResults] = useState<Record<string, { 
    gemini: GeminiAnalysisResult | null; 
    alert: AlertAnalysisResult | null;
  }>>({});

  // Debug: Log when cameraResults changes
  useEffect(() => {
    console.log('[MultiCamera] 📊 cameraResults state updated:', cameraResults);
  }, [cameraResults]);

  // Rotate to next enabled camera for Deep Vision analysis
  useEffect(() => {
    if (analysisMode !== 'gemini' && analysisMode !== 'alerts') {
      // Not in Deep Vision mode, clear rotation
      setCurrentAnalysisCameraId(null);
      setLastAnalysisTime(0);
      return;
    }

    // Get list of enabled cameras
    const actuallyEnabledCameras = enabledCameras.filter(cam => isEffectivelyEnabled(cam));
    
    if (actuallyEnabledCameras.length === 0) {
      console.log('[MultiCamera] No enabled cameras for Deep Vision rotation');
      return;
    }

    // Set up rotation interval
    const rotationInterval = setInterval(() => {
      const currentTime = Date.now() / 1000;
      
      // Check if enough time has passed since last analysis
      if (currentTime - lastAnalysisTime < geminiInterval) {
        return; // Not time yet
      }

      // Find current camera index
      const currentIndex = actuallyEnabledCameras.findIndex(cam => cam.id === currentAnalysisCameraId);
      
      // Rotate to next camera (or start with first if null or not found)
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % actuallyEnabledCameras.length;
      const nextCamera = actuallyEnabledCameras[nextIndex];
      
      console.log(`[MultiCamera] 🔄 Rotating Deep Vision: ${currentAnalysisCameraId || 'none'} → ${nextCamera.id}`);
      setCurrentAnalysisCameraId(nextCamera.id);
      setLastAnalysisTime(currentTime);
    }, 1000); // Check every second

    return () => clearInterval(rotationInterval);
  }, [analysisMode, enabledCameras, cameraEnabled, currentAnalysisCameraId, lastAnalysisTime, geminiInterval]);

  const handleGeminiResult = useCallback((cameraId: string, result: GeminiAnalysisResult | null) => {
    // Find camera name to pass along with result
    const camera = enabledCameras.find(c => c.id === cameraId);
    const cameraName = cameraNames[cameraId] || camera?.name || cameraId;
    console.log(`[MultiCamera] 🎯 Gemini result from ${cameraName} (${cameraId}):`, result ? 'HAS RESULT' : 'NULL');
    
    // Store result for this camera
    setCameraResults(prev => {
      const updated = {
        ...prev,
        [cameraId]: { gemini: result, alert: prev[cameraId]?.alert || null }
      };
      console.log(`[MultiCamera] 💾 Updated cameraResults for ${cameraId}:`, updated[cameraId]);
      return updated;
    });
    
    // Also notify parent
    onGeminiResult?.(cameraId, cameraName, result);
  }, [onGeminiResult, enabledCameras, cameraNames]);

  const handleAlertResult = useCallback((cameraId: string, result: AlertAnalysisResult | null) => {
    // Find camera name to pass along with result
    const camera = enabledCameras.find(c => c.id === cameraId);
    const cameraName = cameraNames[cameraId] || camera?.name || cameraId;
    console.log(`[MultiCamera] 🚨 Alert result from ${cameraName} (${cameraId}):`, result ? 'HAS RESULT' : 'NULL');
    
    // Store result for this camera
    setCameraResults(prev => {
      const updated = {
        ...prev,
        [cameraId]: { gemini: prev[cameraId]?.gemini || null, alert: result }
      };
      console.log(`[MultiCamera] 💾 Updated cameraResults for ${cameraId}:`, updated[cameraId]);
      return updated;
    });
    
    // Also notify parent
    onAlertResult?.(cameraId, cameraName, result);
  }, [onAlertResult, enabledCameras, cameraNames]);

  useEffect(() => {
    let cancelled = false;
    setConfigLoadError(null);
    fetch(`${YOLO_API_URL}/api/config`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`Backend returned ${res.status} — is the edge API running at ${YOLO_API_URL}?`);
        }
        return res.json();
      })
      .then((data: AppConfig) => {
        if (cancelled) return;
        console.log('[MultiCamera] Loaded configuration:', data.rtsp);
        setConfig(data);
        const allCameras = data.rtsp.cameras;
        setEnabledCameras(allCameras);
        console.log(`[MultiCamera] ${allCameras.length} camera(s) configured`);
        setFpsLimit(data.rtsp.fpsLimit);
        setGeminiInterval(data.rtsp.geminiInterval);
        setAutoStart(data.rtsp.autoStart);
      })
      .catch(err => {
        console.error('[MultiCamera] Failed to load configuration:', err);
        if (!cancelled) {
          setConfigLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [configRetryToken]);

  useEffect(() => {
    let mounted = true;

    const refreshBackendResults = async () => {
      try {
        const res = await fetch(`${YOLO_API_URL}/api/deepvision/latest`);
        if (!res.ok) return;
        const data = await res.json();
        const results: BackendDeepVisionResult[] = Array.isArray(data?.results) ? data.results : [];
        if (!mounted || results.length === 0) return;

        setCameraResults(prev => {
          const next = { ...prev };
          for (const item of results) {
            if (!item?.camera_id || !item?.analysis) continue;
            next[item.camera_id] = {
              gemini: item.analysis,
              alert: prev[item.camera_id]?.alert || null,
            };
          }
          return next;
        });

        const latest = results[0];
        const latestCamera = enabledCameras.find(c => c.id === latest.camera_id);
        const latestCameraName = latest.camera_name || latestCamera?.name || latest.camera_id;
        onGeminiResult?.(latest.camera_id, latestCameraName, latest.analysis);
      } catch {
        // Display-only poller; fail silently to avoid noisy UI.
      }
    };

    refreshBackendResults();
    const timer = setInterval(refreshBackendResults, 3000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [onGeminiResult, enabledCameras]);

  // Save URL edit to localStorage
  const handleSettingsSave = (settings: { 
    cameraUrls: Record<string, string>;
    cameraTailscaleUrls: Record<string, string>;
    cameraUseTailscale: Record<string, boolean>;
    cameraNames: Record<string, string>;
    cameraEnabled: Record<string, boolean>;
    fpsLimit: number; 
    geminiInterval: number; 
    autoStart: boolean;
    deepVisionEnabled: boolean;
    centralServer: CentralServerConfig;
    vpn: VpnConfig;
    tailscale: { enabled: boolean; mode: 'inbound' | 'outbound' };
  }) => {
    setCameraUrls(settings.cameraUrls);
    setCameraTailscaleUrls(settings.cameraTailscaleUrls);
    setCameraUseTailscale(settings.cameraUseTailscale);
    setCameraNames(settings.cameraNames);
    setCameraEnabled(settings.cameraEnabled);
    setFpsLimit(settings.fpsLimit);
    setGeminiInterval(settings.geminiInterval);
    setAutoStart(settings.autoStart);
    setConfig(prev => prev ? {
      ...prev,
      ui: {
        ...(prev.ui || {}),
        deepVisionEnabled: settings.deepVisionEnabled,
        defaultAnalysisMode: settings.deepVisionEnabled ? 'gemini' : 'yolo',
      },
      centralServer: settings.centralServer,
      vpn: settings.vpn,
      tailscale: settings.tailscale,
    } : prev);
    console.log('[MultiCamera] Settings saved:', settings);
    // Force remount of streams by updating config
    window.location.reload();
  };

  // Get effective URL (user edit or config default)
  const getEffectiveUrl = (camera: CameraConfig) => {
    return cameraUrls[camera.id] || camera.url;
  };

  // Get effective Tailscale URL (user edit or config default)
  const getEffectiveTailscaleUrl = (camera: CameraConfig) => {
    return cameraTailscaleUrls[camera.id] ?? camera.tailscaleUrl ?? '';
  };

  // Determine whether to use Tailscale path for this camera
  const isUsingTailscalePath = (camera: CameraConfig) => {
    return cameraUseTailscale[camera.id] !== undefined ? cameraUseTailscale[camera.id] : !!camera.useTailscale;
  };

  const getEffectiveStreamUrl = (camera: CameraConfig) => {
    if (isUsingTailscalePath(camera)) {
      const tsUrl = getEffectiveTailscaleUrl(camera).trim();
      if (tsUrl) {
        return tsUrl;
      }
    }
    return getEffectiveUrl(camera);
  };

  // Get effective name (user edit or config default)
  const getEffectiveName = (camera: CameraConfig) => {
    return cameraNames[camera.id] || camera.name;
  };

  // Get effective enabled state (user override or config default)
  const isEffectivelyEnabled = (camera: CameraConfig) => {
    return cameraEnabled[camera.id] !== undefined ? cameraEnabled[camera.id] : camera.enabled;
  };

  const configCameras = config?.rtsp?.cameras ?? [];

  const renderStream = (camera: CameraConfig, index: number, singleView: boolean) => {
    const effectiveUrl = getEffectiveStreamUrl(camera);
    const effectiveEnabled = isEffectivelyEnabled(camera);
    const cameraResult = cameraResults[camera.id];
    const geminiResult = cameraResult?.gemini;
    const alertResult = cameraResult?.alert;
    
    console.log(`[MultiCamera] 🎨 Rendering ${camera.id}:`, { 
      hasCameraResult: !!cameraResult, 
      hasGeminiResult: !!geminiResult, 
      hasAlertResult: !!alertResult,
      analysisMode,
      willShowResults: (analysisMode === 'gemini' || analysisMode === 'alerts') && (geminiResult || alertResult),
      geminiResultData: geminiResult ? {
        risk: geminiResult.overallRiskLevel,
        people: geminiResult.peopleCount,
        description: geminiResult.overallDescription?.substring(0, 50)
      } : null
    });
    
    // Only render stream if camera is enabled
    if (!effectiveEnabled) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '300px',
          padding: '2rem',
          background: 'rgba(255, 152, 0, 0.05)',
          border: '2px dashed rgba(255, 152, 0, 0.3)',
          borderRadius: '8px',
          color: 'rgba(255, 152, 0, 0.8)'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📹</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Camera Disabled</div>
          <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)' }}>
            Enable in Settings to start streaming
          </div>
        </div>
      );
    }

    return (
      <div style={{ position: 'relative' }}>
        {/* Active Analysis Indicator */}
        {currentAnalysisCameraId === camera.id && (analysisMode === 'gemini' || analysisMode === 'alerts') && (
          <div style={{
            position: 'absolute',
            top: '-10px',
            left: '-10px',
            right: '-10px',
            bottom: '-10px',
            border: '3px solid #9c27b0',
            borderRadius: '12px',
            boxShadow: '0 0 20px rgba(156, 39, 176, 0.6)',
            animation: 'pulse 2s infinite',
            pointerEvents: 'none',
            zIndex: 1
          }} />
        )}
        
        {/* Active Analysis Badge */}
        {currentAnalysisCameraId === camera.id && (analysisMode === 'gemini' || analysisMode === 'alerts') && (
          <div style={{
            position: 'absolute',
            top: '0.5rem',
            right: '0.5rem',
            padding: '0.4rem 0.8rem',
            background: 'linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%)',
            border: '2px solid #e1bee7',
            borderRadius: '20px',
            fontSize: '0.85rem',
            fontWeight: 600,
            color: '#fff',
            boxShadow: '0 4px 12px rgba(156, 39, 176, 0.5)',
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}>
            <span style={{ fontSize: '1rem' }}>🔍</span>
            <span>Analyzing Now</span>
          </div>
        )}
        
        <RTSPLiveStream
          key={`${camera.id}-stream-${effectiveUrl}-${fpsLimit}-${geminiInterval}-${autoStart}`}
          cameraId={camera.id}
          cameraName={getEffectiveName(camera)}
          rtspUrl={effectiveUrl}
          fpsLimit={fpsLimit}
          geminiInterval={geminiInterval}
          autoStart={autoStart}
          autoStartDelay={index * 500}
          analysisMode={analysisMode}
          allowAnalysis={false}
          compact={!singleView && enabledCameras.length > 1}
          onGeminiResult={(result) => handleGeminiResult(camera.id, result)}
          onAlertResult={(result) => handleAlertResult(camera.id, result)}
        />
        
        {/* Full Detailed Results Display */}
        {(() => {
          const shouldShow = (analysisMode === 'gemini' || analysisMode === 'alerts') && (geminiResult || alertResult);
          console.log(`[MultiCamera] 📋 Results display for ${camera.id}:`, { shouldShow, analysisMode, hasGemini: !!geminiResult, hasAlert: !!alertResult });
          return shouldShow ? (
          <div style={{
            marginTop: '0.75rem',
            padding: '1rem',
            background: 'linear-gradient(135deg, rgba(106, 27, 154, 0.15) 0%, rgba(156, 39, 176, 0.15) 100%)',
            border: '2px solid rgba(156, 39, 176, 0.4)',
            borderRadius: '8px',
            fontSize: '0.85rem'
          }}>
            {geminiResult && (
              <>
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
                  background: geminiResult.overallRiskLevel === 'High' ? 'rgba(233, 69, 96, 0.2)' :
                              geminiResult.overallRiskLevel === 'Medium' ? 'rgba(255, 152, 0, 0.2)' :
                              'rgba(76, 175, 80, 0.2)',
                  borderRadius: '6px',
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <span style={{ fontSize: '1.2rem' }}>
                    {geminiResult.overallRiskLevel === 'High' ? '🔴' :
                     geminiResult.overallRiskLevel === 'Medium' ? '🟡' : '🟢'}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'rgba(255,255,255,0.8)' }}>
                      Risk Level: <span style={{
                        color: geminiResult.overallRiskLevel === 'High' ? '#e94560' :
                               geminiResult.overallRiskLevel === 'Medium' ? '#ff9800' : '#4caf50'
                      }}>{geminiResult.overallRiskLevel}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginTop: '0.25rem' }}>
                      {geminiResult.overallDescription}
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
                        {geminiResult.peopleCount || 0}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)' }}>Persons Detected</div>
                    </div>
                    <div style={{ 
                      padding: '0.75rem', 
                      background: (geminiResult.missingHardhats ?? 0) > 0 ? 'rgba(233, 69, 96, 0.1)' : 'rgba(76, 175, 80, 0.1)',
                      border: `1px solid ${(geminiResult.missingHardhats ?? 0) > 0 ? 'rgba(233, 69, 96, 0.3)' : 'rgba(76, 175, 80, 0.3)'}`,
                      borderRadius: '6px',
                      textAlign: 'center'
                    }}>
                      <div style={{ 
                        fontSize: '1.5rem', 
                        fontWeight: 'bold', 
                        color: (geminiResult.missingHardhats ?? 0) > 0 ? '#e94560' : '#4caf50',
                        marginBottom: '0.25rem'
                      }}>
                        {geminiResult.missingHardhats ?? 0}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)' }}>Missing Hardhats</div>
                    </div>
                    <div style={{ 
                      padding: '0.75rem', 
                      background: (geminiResult.missingVests ?? 0) > 0 ? 'rgba(233, 69, 96, 0.1)' : 'rgba(76, 175, 80, 0.1)',
                      border: `1px solid ${(geminiResult.missingVests ?? 0) > 0 ? 'rgba(233, 69, 96, 0.3)' : 'rgba(76, 175, 80, 0.3)'}`,
                      borderRadius: '6px',
                      textAlign: 'center'
                    }}>
                      <div style={{ 
                        fontSize: '1.5rem', 
                        fontWeight: 'bold', 
                        color: (geminiResult.missingVests ?? 0) > 0 ? '#e94560' : '#4caf50',
                        marginBottom: '0.25rem'
                      }}>
                        {geminiResult.missingVests ?? 0}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)' }}>Missing Safety Vests</div>
                    </div>
                  </div>
                </div>

                {/* Construction Safety */}
                {geminiResult.constructionSafety && (
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
                      {geminiResult.constructionSafety.summary}
                    </div>
                    {geminiResult.constructionSafety.issues && geminiResult.constructionSafety.issues.length > 0 && (
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
                          {geminiResult.constructionSafety.issues.map((issue, i) => (
                            <li key={i} style={{ marginBottom: '0.2rem' }}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Fire Safety */}
                {geminiResult.fireSafety && (
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
                      {geminiResult.fireSafety.summary}
                    </div>
                    {geminiResult.fireSafety.issues && geminiResult.fireSafety.issues.length > 0 && (
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
                          {geminiResult.fireSafety.issues.map((issue, i) => (
                            <li key={i} style={{ marginBottom: '0.2rem' }}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Property Security */}
                {geminiResult.propertySecurity && (
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
                      {geminiResult.propertySecurity.summary}
                    </div>
                    {geminiResult.propertySecurity.issues && geminiResult.propertySecurity.issues.length > 0 && (
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
                          {geminiResult.propertySecurity.issues.map((issue, i) => (
                            <li key={i} style={{ marginBottom: '0.2rem' }}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            
            {alertResult && (
              <>
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
                    background: alertResult.alertCount > 0 ? 'rgba(233, 69, 96, 0.2)' : 'rgba(76, 175, 80, 0.2)',
                    color: alertResult.alertCount > 0 ? '#e94560' : '#4caf50'
                  }}>
                    {alertResult.alertCount} Alert{alertResult.alertCount !== 1 ? 's' : ''}
                  </span>
                </div>
                {alertResult.alerts && alertResult.alerts.length > 0 && (
                  <div style={{ fontSize: '0.75rem' }}>
                    {alertResult.alerts.slice(0, 2).map((alert, i) => (
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
                    {alertResult.alerts.length > 2 && (
                      <div style={{ 
                        marginTop: '0.3rem',
                        fontSize: '0.7rem',
                        color: 'rgba(255,255,255,0.5)',
                        fontStyle: 'italic'
                      }}>
                        +{alertResult.alerts.length - 2} more alert{alertResult.alerts.length - 2 !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          ) : null;
        })()}
      </div>
    );
  };

  // Single return with conditional rendering — no early returns, so hooks always run in same order
  return (
    <>
      {!config && !configLoadError && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#00d9ff' }}>
          ⏳ Loading camera configuration...
        </div>
      )}

      {configLoadError && (
        <div style={{
          padding: '1.5rem',
          margin: '1rem',
          textAlign: 'center',
          background: 'rgba(244, 67, 54, 0.12)',
          border: '1px solid rgba(244, 67, 54, 0.45)',
          borderRadius: '8px',
          color: '#ffab91',
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Could not load camera configuration</div>
          <div style={{ fontSize: '0.9rem', marginBottom: '1rem', opacity: 0.95 }}>{configLoadError}</div>
          <button
            type="button"
            onClick={() => setConfigRetryToken(t => t + 1)}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid rgba(0, 217, 255, 0.5)',
              background: 'rgba(0, 217, 255, 0.15)',
              color: '#00d9ff',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {config && configCameras.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#ff9900' }}>
          <h3>⚠️ No Cameras Configured</h3>
          <p>Add cameras in <code>app.config.json</code> under <code>rtsp.cameras</code></p>
        </div>
      )}

      {config && configCameras.length > 0 && (
        <div style={{ width: '100%' }}>
          {/* View: Multi-camera only; single camera views removed */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            marginBottom: '1rem',
            padding: '0.75rem',
            background: 'rgba(0, 217, 255, 0.08)',
            borderRadius: '8px',
            border: '1px solid rgba(0, 217, 255, 0.25)',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ color: 'rgba(255,255,255,0.8)', marginRight: '0.5rem' }}>View:</span>
              <span style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '1px solid rgba(0, 217, 255, 0.25)',
                background: 'rgba(0, 217, 255, 0.25)',
                color: '#00d9ff',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}>
                <span>📺 All Cameras</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#4caf50',
                    boxShadow: '0 0 6px #4caf50'
                  }} />
                  <span>{enabledCameras.filter(c => isEffectivelyEnabled(c)).length} active</span>
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#e94560',
                    boxShadow: '0 0 6px #e94560'
                  }} />
                  <span>{enabledCameras.filter(c => !isEffectivelyEnabled(c)).length} inactive</span>
                </span>
              </span>
            </div>

            {/* Settings button */}
            <button
              onClick={() => setShowSettings(true)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: '1px solid #00d9ff',
                background: 'rgba(0, 217, 255, 0.1)',
                color: '#00d9ff',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                whiteSpace: 'nowrap'
              }}
            >
              ⚙️ Settings
            </button>
          </div>

          {/* Multi-camera view: vertical stack with each camera in a row */}
          {(
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '1rem',
              width: '100%'
            }}>
              {enabledCameras.map((camera, index) => (
                <div
                  key={camera.id}
                  style={{
                    border: '2px solid rgba(0, 217, 255, 0.3)',
                    borderRadius: '8px',
                    padding: '1rem',
                    background: 'rgba(0, 0, 0, 0.3)',
                    minHeight: '300px',
                    width: '100%'
                  }}
                >
                  <h4 style={{ marginTop: 0, marginBottom: '0.75rem', color: '#00d9ff', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    📹 {getEffectiveName(camera)}
                    {!isEffectivelyEnabled(camera) && (
                      <span style={{ 
                        fontSize: '0.8rem', 
                        color: '#ff9900',
                        background: 'rgba(255, 153, 0, 0.1)',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        border: '1px solid rgba(255, 153, 0, 0.3)'
                      }}>
                        ⚠️ Disabled
                      </span>
                    )}
                  </h4>
                  {isEffectivelyEnabled(camera) ? (
                    renderStream(camera, index, false)
                  ) : (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: '250px',
                      color: 'rgba(255,255,255,0.5)',
                      fontSize: '1rem',
                      border: '2px dashed rgba(255, 153, 0, 0.3)',
                      borderRadius: '8px',
                      background: 'rgba(255, 153, 0, 0.05)'
                    }}>
                      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📹</div>
                      <div style={{ marginBottom: '0.5rem', fontWeight: 'bold' }}>Camera Disabled</div>
                      <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.4)' }}>
                        Enable in <strong style={{ color: '#00d9ff' }}>⚙️ Settings</strong>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.3)', marginTop: '0.5rem' }}>
                        ID: {camera.id}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && config && (
        <SettingsModal
          cameras={enabledCameras}
          configFpsLimit={config.rtsp.fpsLimit}
          configGeminiInterval={config.rtsp.geminiInterval}
          configAutoStart={config.rtsp.autoStart}
          configDeepVisionEnabled={config.ui?.deepVisionEnabled !== false}
          configCmpEnabled={config.centralServer?.enabled ?? false}
          configCmpUrl={config.centralServer?.url ?? ''}
          configCmpApiKey={config.centralServer?.apiKey ?? ''}
          configVpnEnabled={config.vpn?.enabled ?? true}
          configTailscaleEnabled={config.tailscale?.enabled ?? true}
          configTailscaleMode={config.tailscale?.mode ?? 'inbound'}
          onClose={() => setShowSettings(false)}
          onSave={handleSettingsSave}
        />
      )}
    </>
  );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(MultiCameraGrid);
