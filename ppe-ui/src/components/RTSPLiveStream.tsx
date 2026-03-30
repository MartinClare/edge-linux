import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { AnalysisMode, GeminiAnalysisResult, AlertAnalysisResult } from '../types/detection.types';
import { API_BASE_URL } from '../config/api';
import GeminiPpeNarrative from './GeminiPpeNarrative';
import WebRTCStream from './WebRTCStream';

interface Detection {
  id: number;
  class_id: number;
  class_name: string;
  confidence: number;
  bbox: number[];
}

interface RTSPLiveStreamProps {
  cameraId?: string;
  cameraName?: string;
  rtspUrl?: string;         // kept for backward compat; not used for display
  browserUrl?: string;      // MJPEG HTTP URL for direct browser playback
  fpsLimit?: number;
  geminiInterval?: number;
  autoStart?: boolean;
  autoStartDelay?: number;
  compact?: boolean;
  allowAnalysis?: boolean;
  analysisMode: AnalysisMode;
  onFrameUpdate?: (frameData: string, detections: Detection[]) => void;
  onGeminiResult?: (result: GeminiAnalysisResult | null) => void;
  onAlertResult?: (result: AlertAnalysisResult | null) => void;
}

interface CameraConfigItem {
  id: string;
  name: string;
  url: string;
  browserUrl?: string;
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
  _go2rtc?: {
    available: boolean;
    port: number;
    apiBase: string;
  };
}

/**
 * Displays near-live snapshots from the edge-cloud service
 * (GET /api/snapshot/:cameraId) and overlays Deep Vision analysis results
 * polled from /api/deepvision/latest.  The edge-cloud captures RTSP
 * frames via ffmpeg in the background -- no Python backend is involved.
 */
const RTSPLiveStream: React.FC<RTSPLiveStreamProps> = ({
  cameraId = 'default',
  cameraName = 'Camera',
  browserUrl: propBrowserUrl,
  fpsLimit: propFpsLimit,
  geminiInterval: propGeminiInterval,
  autoStart: propAutoStart,
  autoStartDelay = 0,
  compact = false,
  analysisMode,
  onGeminiResult,
  onAlertResult,
}) => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [go2rtcUrl, setGo2rtcUrl] = useState<string>('http://localhost:1984');
  const [go2rtcAvailable, setGo2rtcAvailable] = useState<boolean>(true);
  const [geminiInterval] = useState(propGeminiInterval || 5);
  const [autoStart, setAutoStart] = useState(propAutoStart ?? false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [latestGeminiResult, setLatestGeminiResult] = useState<GeminiAnalysisResult | null>(null);
  const [latestAlertResult] = useState<AlertAnalysisResult | null>(null);
  const [userStoppedStream, setUserStoppedStream] = useState(false);

  const autoStartTriggeredRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load config if props not provided (single-camera mode)
  useEffect(() => {
    if (propBrowserUrl !== undefined) {
      setConfig({
        rtsp: {
          fpsLimit: propFpsLimit || 15,
          geminiInterval: propGeminiInterval || 5,
          autoStart: propAutoStart ?? false,
        },
      });
      return;
    }

    fetch(`${API_BASE_URL}/api/config`)
      .then((r) => r.json())
      .then((data: AppConfig) => {
        setConfig(data);
        setAutoStart(data.rtsp.autoStart);
        if (data._go2rtc) {
          setGo2rtcAvailable(data._go2rtc.available);
          if (data._go2rtc.apiBase) setGo2rtcUrl(data._go2rtc.apiBase);
        }
      })
      .catch((err) => {
        console.error(`[RTSP-${cameraId}] Config load failed:`, err);
        setStreamError('Failed to load camera configuration from edge-cloud service.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, propBrowserUrl, propFpsLimit, propGeminiInterval, propAutoStart]);

  // Poll /api/deepvision/latest on mount -- the background loop runs independently
  // of the browser, so we always want the latest analysis visible.
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const pollMs = Math.max(3000, (geminiInterval || 5) * 1000);
    const poll = () => {
      fetch(`${API_BASE_URL}/api/deepvision/latest`)
        .then((r) => r.json())
        .then((data: { results: Array<{ camera_id: string; analysis: GeminiAnalysisResult; updated_at: number }> }) => {
          const mine = data.results?.find((r) => r.camera_id === cameraId);
          if (mine) {
            setLatestGeminiResult(mine.analysis);
            onGeminiResult?.(mine.analysis);
          }
        })
        .catch(() => {});
    };
    poll();
    pollTimerRef.current = setInterval(poll, pollMs);
    return stopPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, geminiInterval]);

  // Cleanup on unmount
  useEffect(() => () => { stopPolling(); }, [stopPolling]);

  const handleConnect = () => {
    setUserStoppedStream(false);
    setStreamError(null);
    setIsStreaming(true);
  };

  const handleDisconnect = () => {
    setUserStoppedStream(true);
    setIsStreaming(false);
  };

  // Auto-start stream on mount when configured
  useEffect(() => {
    if (!autoStart || !config || autoStartTriggeredRef.current) return;
    autoStartTriggeredRef.current = true;
    const t = setTimeout(() => handleConnect(), 1500 + autoStartDelay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, autoStartDelay, config]);

  const riskColor = (level: string) =>
    level === 'High' || level === 'Critical' ? '#e94560' :
    level === 'Medium' ? '#ff9800' : '#4caf50';

  const riskBg = (level: string) =>
    level === 'High' || level === 'Critical' ? 'rgba(233,69,96,0.2)' :
    level === 'Medium' ? 'rgba(255,152,0,0.2)' : 'rgba(76,175,80,0.2)';

  return (
    <div className="rtsp-live-stream">
      {!compact && <h4>Live Camera Stream</h4>}

      {/* ── Video panel ──────────────────────────────────────────── */}
      {isStreaming ? (
        <>
          <button
            className="disconnect-btn"
            onClick={handleDisconnect}
            style={{
              background: '#ff4444',
              marginBottom: compact ? '0.5rem' : '1rem',
              fontSize: compact ? '0.8rem' : undefined,
              padding: compact ? '0.35rem 0.65rem' : undefined,
            }}
          >
            Stop Stream
          </button>
          <div className="video-container" style={{ maxWidth: compact ? '100%' : '800px', width: '100%' }}>
            <WebRTCStream
              cameraId={cameraId}
              cameraName={cameraName}
              go2rtcUrl={go2rtcAvailable ? go2rtcUrl : undefined}
              snapshotFallbackUrl={`${API_BASE_URL}/api/snapshot/${cameraId}`}
              compact={compact}
              autoPlay
            />
          </div>
        </>
      ) : (
        <>
          {streamError && (
            <div style={{
              padding: '0.75rem 1rem', marginBottom: '1rem',
              background: 'rgba(244,67,54,0.15)', border: '1px solid rgba(244,67,54,0.4)',
              borderRadius: '8px', color: '#ff8a80', fontSize: compact ? '0.8rem' : '0.9rem',
            }}>
              <strong>Stream error:</strong> {streamError}
            </div>
          )}
          {(!compact || !autoStart || streamError || userStoppedStream) && (
            <button className="connect-btn" onClick={handleConnect} disabled={!config}>
              {!config ? 'Loading Configuration...' : 'Start Live Stream'}
            </button>
          )}
          {compact && autoStart && !streamError && (
            <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.65)', marginBottom: '0.5rem' }}>
              Connecting live stream...
            </div>
          )}
        </>
      )}

      {/* ── Deep Vision Analysis ─────────────────────────────────── */}
      {/* Always shown — background loop runs independently of the stream */}
      {(analysisMode === 'gemini' || analysisMode === 'alerts') && (
        <div style={{ marginTop: '0.75rem' }}>
          {analysisMode === 'gemini' && (
            latestGeminiResult ? (
              <div style={{
                padding: '1rem',
                background: 'linear-gradient(135deg, rgba(106,27,154,0.15) 0%, rgba(156,39,176,0.15) 100%)',
                border: '2px solid rgba(156,39,176,0.4)',
                borderRadius: '8px',
                fontSize: '0.85rem',
              }}>
                <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <strong style={{ color: '#e1bee7', fontSize: compact ? '0.85rem' : '1rem' }}>Deep Vision AI Analysis</strong>
                  <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.45)' }}>
                    updated by background service
                  </span>
                </div>

                <div style={{
                  padding: '0.75rem', borderRadius: '6px', marginBottom: '0.75rem',
                  background: riskBg(latestGeminiResult.overallRiskLevel),
                }}>
                  <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'rgba(255,255,255,0.8)' }}>
                    Risk Level:{' '}
                    <span style={{ color: riskColor(latestGeminiResult.overallRiskLevel) }}>
                      {latestGeminiResult.overallRiskLevel}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.65)', marginTop: '0.25rem' }}>
                    {latestGeminiResult.overallDescription}
                  </div>
                </div>

                <GeminiPpeNarrative
                  compact
                  missingHardhats={latestGeminiResult.missingHardhats}
                  missingVests={latestGeminiResult.missingVests}
                />

                {[
                  { key: 'constructionSafety' as const, label: 'Construction Safety', color: '#ffa726', borderColor: 'rgba(255,152,0,0.3)' },
                  { key: 'fireSafety' as const, label: 'Fire Safety', color: '#ff7043', borderColor: 'rgba(255,87,34,0.3)' },
                  { key: 'propertySecurity' as const, label: 'Property Security', color: '#42a5f5', borderColor: 'rgba(33,150,243,0.3)' },
                ].map(({ key, label, color, borderColor }) => {
                  const cat = latestGeminiResult[key];
                  if (!cat) return null;
                  return (
                    <div key={key} style={{
                      marginBottom: '0.5rem', padding: '0.65rem',
                      background: 'rgba(0,0,0,0.3)', borderRadius: '6px',
                      border: `1px solid ${borderColor}`,
                    }}>
                      <div style={{ fontWeight: 600, color, marginBottom: '0.35rem', fontSize: '0.82rem' }}>{label}</div>
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)' }}>{cat.summary}</div>
                      {cat.issues?.length > 0 && (
                        <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)' }}>
                          {cat.issues.map((issue: string, i: number) => (
                            <li key={i} style={{ marginBottom: '0.15rem' }}>{issue}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{
                padding: '0.75rem 1rem',
                background: 'rgba(156,39,176,0.08)',
                border: '1px solid rgba(156,39,176,0.25)',
                borderRadius: '8px',
                color: 'rgba(255,255,255,0.45)',
                fontSize: '0.8rem',
              }}>
                Waiting for Deep Vision analysis from background service...
              </div>
            )
          )}

          {analysisMode === 'alerts' && latestAlertResult && (
            <div style={{
              padding: '0.75rem',
              background: 'rgba(156,39,176,0.1)',
              border: '1px solid rgba(156,39,176,0.3)',
              borderRadius: '6px',
              fontSize: '0.85rem',
            }}>
              <strong style={{ color: '#bb86fc' }}>Alerts ({latestAlertResult.alertCount})</strong>
              {latestAlertResult.alerts?.slice(0, 5).map((alert: { message: string }, i: number) => (
                <div key={i} style={{
                  marginTop: '0.3rem', padding: '0.3rem 0.5rem',
                  background: 'rgba(233,69,96,0.1)', borderRadius: '4px',
                  borderLeft: '3px solid #e94560', fontSize: '0.75rem',
                }}>
                  {alert.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!compact && (
        <div className="rtsp-help">
          <p>Live stream features:</p>
          <ul>
            <li>WebRTC live stream via go2rtc — low latency, hardware decoded</li>
            <li>Falls back to 2 fps JPEG snapshots if WebRTC unavailable</li>
            <li>Deep Vision analysis runs in background every {geminiInterval}s (no stream needed)</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default RTSPLiveStream;
