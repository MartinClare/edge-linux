import React, { useState, useEffect, useCallback } from 'react';
import { YOLO_API_URL } from '../config/api';

interface CameraConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  tailscaleUrl?: string;
  useTailscale?: boolean;
}

interface AppSettings {
  cameraUrls: Record<string, string>;
  cameraTailscaleUrls: Record<string, string>;
  cameraUseTailscale: Record<string, boolean>;
  cameraNames: Record<string, string>;
  cameraEnabled: Record<string, boolean>;
  fpsLimit: number;
  geminiInterval: number;
  autoStart: boolean;
  deepVisionEnabled: boolean;
  centralServer: {
    enabled: boolean;
    url: string;
    apiKey: string;
  };
  vpn: { enabled: boolean };
  tailscale: {
    enabled: boolean;
    mode: 'inbound' | 'outbound';
  };
}

interface SettingsModalProps {
  cameras: CameraConfig[];
  configFpsLimit: number;
  configGeminiInterval: number;
  configAutoStart: boolean;
  configDeepVisionEnabled: boolean;
  configCmpEnabled: boolean;
  configCmpUrl: string;
  configCmpApiKey: string;
  configVpnEnabled: boolean;
  configTailscaleEnabled: boolean;
  configTailscaleMode: 'inbound' | 'outbound';
  onClose: () => void;
  onSave: (settings: AppSettings) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  cameras,
  configFpsLimit,
  configGeminiInterval,
  configAutoStart,
  configDeepVisionEnabled,
  configCmpEnabled,
  configCmpUrl,
  configCmpApiKey,
  configVpnEnabled,
  configTailscaleEnabled,
  configTailscaleMode,
  onClose,
  onSave
}) => {
  const [cameraUrls, setCameraUrls] = useState<Record<string, string>>({});
  const [cameraTailscaleUrls, setCameraTailscaleUrls] = useState<Record<string, string>>({});
  const [cameraUseTailscale, setCameraUseTailscale] = useState<Record<string, boolean>>({});
  const [cameraNames, setCameraNames] = useState<Record<string, string>>({});
  const [cameraEnabled, setCameraEnabled] = useState<Record<string, boolean>>({});
  const [fpsLimit, setFpsLimit] = useState(configFpsLimit);
  const [geminiInterval, setGeminiInterval] = useState(configGeminiInterval);
  const [autoStart, setAutoStart] = useState(configAutoStart);
  const [deepVisionEnabled, setDeepVisionEnabled] = useState(configDeepVisionEnabled);
  const [cmpEnabled, setCmpEnabled] = useState(configCmpEnabled);
  const [cmpUrl, setCmpUrl] = useState(configCmpUrl);
  const [cmpApiKey, setCmpApiKey] = useState(configCmpApiKey);
  const [vpnEnabled, setVpnEnabled] = useState(configVpnEnabled);
  const [tailscaleEnabled, setTailscaleEnabled] = useState(configTailscaleEnabled);
  const [tailscaleMode, setTailscaleMode] = useState<'inbound' | 'outbound'>(configTailscaleMode);
  const [hasChanges, setHasChanges] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<Record<string, { label: string; status: string }> | null>(null);
  const [serviceStatusLoading, setServiceStatusLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<Array<{ ip: string; port: number; path: string; url: string; resolution?: string; fps?: number }> | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNetworkPrefix, setScanNetworkPrefix] = useState('192.168.10');
  const [scanUsername, setScanUsername] = useState('admin');
  const [scanPassword, setScanPassword] = useState('123456');

  const fetchServiceStatus = useCallback(async () => {
    setServiceStatusLoading(true);
    try {
      const res = await fetch(`${YOLO_API_URL}/api/services/status`);
      if (res.ok) {
        const data = await res.json();
        setServiceStatus(data);
      } else {
        setServiceStatus(null);
      }
    } catch {
      setServiceStatus(null);
    } finally {
      setServiceStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServiceStatus();
  }, [fetchServiceStatus]);

  const handleCameraUrlChange = (cameraId: string, url: string) => {
    setCameraUrls(prev => ({ ...prev, [cameraId]: url }));
    setHasChanges(true);
  };

  const handleCameraNameChange = (cameraId: string, name: string) => {
    setCameraNames(prev => ({ ...prev, [cameraId]: name }));
    setHasChanges(true);
  };

  const handleCameraTailscaleUrlChange = (cameraId: string, url: string) => {
    setCameraTailscaleUrls(prev => ({ ...prev, [cameraId]: url }));
    setHasChanges(true);
  };

  const handleCameraUseTailscaleToggle = (cameraId: string, useTailscale: boolean) => {
    setCameraUseTailscale(prev => ({ ...prev, [cameraId]: useTailscale }));
    setHasChanges(true);
  };

  const resetCameraName = (cameraId: string) => {
    setCameraNames(prev => {
      const updated = { ...prev };
      delete updated[cameraId];
      return updated;
    });
    setHasChanges(true);
  };

  const handleCameraEnabledToggle = (cameraId: string, enabled: boolean) => {
    setCameraEnabled(prev => ({ ...prev, [cameraId]: enabled }));
    setHasChanges(true);
  };

  const resetCameraUrl = (cameraId: string) => {
    setCameraUrls(prev => {
      const updated = { ...prev };
      delete updated[cameraId];
      return updated;
    });
    setHasChanges(true);
  };

  const resetCameraTailscaleUrl = (cameraId: string) => {
    setCameraTailscaleUrls(prev => {
      const updated = { ...prev };
      delete updated[cameraId];
      return updated;
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    const settings: AppSettings = {
      cameraUrls,
      cameraTailscaleUrls,
      cameraUseTailscale,
      cameraNames,
      cameraEnabled,
      fpsLimit,
      geminiInterval,
      autoStart,
      deepVisionEnabled,
      centralServer: {
        enabled: cmpEnabled,
        url: cmpUrl.trim(),
        apiKey: cmpApiKey.trim(),
      },
      vpn: { enabled: vpnEnabled },
      tailscale: {
        enabled: tailscaleEnabled,
        mode: tailscaleMode,
      },
    };

    // Sync to root app.config.json via Python backend first.
    const baseUrl = YOLO_API_URL;
    const rtspPayload = {
      rtsp: {
        cameras: cameras.map((c) => ({
          id: c.id,
          name: cameraNames[c.id] ?? c.name,
          url: cameraUrls[c.id] ?? c.url,
          enabled: cameraEnabled[c.id] !== undefined ? cameraEnabled[c.id] : c.enabled,
          tailscaleUrl: cameraTailscaleUrls[c.id] ?? c.tailscaleUrl ?? '',
          useTailscale: cameraUseTailscale[c.id] !== undefined ? cameraUseTailscale[c.id] : !!c.useTailscale,
        })),
        fpsLimit,
        geminiInterval,
        autoStart,
      },
      ui: {
        deepVisionEnabled: settings.deepVisionEnabled,
        defaultAnalysisMode: 'gemini',
      },
      centralServer: settings.centralServer,
      vpn: settings.vpn,
      tailscale: settings.tailscale,
    };
    try {
      const res = await fetch(`${baseUrl}/api/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rtspPayload),
      });
      if (!res.ok) {
        console.warn('[Settings] Failed to sync config to app.config.json:', res.status);
        alert(`Save failed (${res.status}). Configuration was not written to app.config.json.`);
        return;
      }
      console.log('[Settings] Config synced to app.config.json');
      fetchServiceStatus();

      // Only update local UI and close after backend confirms persistence.
      onSave(settings);
      onClose();
    } catch (err) {
      console.warn('[Settings] Could not reach backend to sync app.config.json:', err);
      alert('Save failed: backend unreachable. Configuration was not written.');
    }
  };

  const handleReset = () => {
    if (window.confirm('Reset all settings to defaults from config file?')) {
      setCameraUrls({});
      setCameraTailscaleUrls({});
      setCameraUseTailscale({});
      setCameraNames({});
      setCameraEnabled({});
      setFpsLimit(configFpsLimit);
      setGeminiInterval(configGeminiInterval);
      setAutoStart(configAutoStart);
      setDeepVisionEnabled(configDeepVisionEnabled);
      setCmpEnabled(configCmpEnabled);
      setCmpUrl(configCmpUrl);
      setCmpApiKey(configCmpApiKey);
      setVpnEnabled(configVpnEnabled);
      setTailscaleEnabled(configTailscaleEnabled);
      setTailscaleMode(configTailscaleMode);
      setHasChanges(true);
    }
  };

  const getEffectiveUrl = (camera: CameraConfig) => {
    return cameraUrls[camera.id] || camera.url;
  };

  const getEffectiveTailscaleUrl = (camera: CameraConfig) => {
    return cameraTailscaleUrls[camera.id] ?? camera.tailscaleUrl ?? '';
  };

  const getEffectiveUseTailscale = (camera: CameraConfig) => {
    return cameraUseTailscale[camera.id] !== undefined ? cameraUseTailscale[camera.id] : !!camera.useTailscale;
  };

  const getEffectiveEnabled = (camera: CameraConfig) => {
    // If user has explicitly set enabled state, use that; otherwise use config default
    return cameraEnabled[camera.id] !== undefined ? cameraEnabled[camera.id] : camera.enabled;
  };

  const isUrlEdited = (cameraId: string) => {
    return !!cameraUrls[cameraId];
  };

  const isTailscaleUrlEdited = (cameraId: string) => {
    return cameraTailscaleUrls[cameraId] !== undefined;
  };

  const isNameEdited = (cameraId: string) => {
    return !!cameraNames[cameraId];
  };

  const getEffectiveName = (camera: CameraConfig) => {
    return cameraNames[camera.id] || camera.name;
  };

  const handleScanCameras = async () => {
    setScanLoading(true);
    setScanError(null);
    setScanResult(null);
    try {
      const params = new URLSearchParams({
        network_prefix: scanNetworkPrefix,
        username: scanUsername,
        password: scanPassword,
      });
      const res = await fetch(`${YOLO_API_URL}/api/scan-cameras?${params}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setScanError(data?.detail || `Scan failed (${res.status})`);
        return;
      }
      if (data.success && Array.isArray(data.cameras)) {
        setScanResult(data.cameras);
      } else {
        setScanResult([]);
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setScanLoading(false);
    }
  };

  const applyScannedUrlToCamera = (cameraId: string, url: string) => {
    handleCameraUrlChange(cameraId, url);
  };

  const isEnabledEdited = (camera: CameraConfig) => {
    return cameraEnabled[camera.id] !== undefined && cameraEnabled[camera.id] !== camera.enabled;
  };

  const isUseTailscaleEdited = (camera: CameraConfig) => {
    return cameraUseTailscale[camera.id] !== undefined && cameraUseTailscale[camera.id] !== !!camera.useTailscale;
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '2rem'
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        border: '2px solid #00d9ff',
        borderRadius: '12px',
        maxWidth: '800px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0, 217, 255, 0.3)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem',
          borderBottom: '2px solid rgba(0, 217, 255, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.5rem' }}>⚙️</span>
            <h2 style={{ margin: 0, color: '#00d9ff', fontSize: '1.5rem' }}>Settings</h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff',
              fontSize: '1.2rem',
              width: '32px',
              height: '32px',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.5rem'
        }}>
          {/* Service status */}
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid rgba(0, 217, 255, 0.2)' }}>
            <h3 style={{ color: '#00d9ff', fontSize: '1.1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              📡 Service status
              {!serviceStatusLoading && serviceStatus && (
                <button
                  type="button"
                  onClick={fetchServiceStatus}
                  style={{
                    marginLeft: 'auto',
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.5rem',
                    background: 'rgba(0, 217, 255, 0.2)',
                    border: '1px solid rgba(0, 217, 255, 0.4)',
                    color: '#00d9ff',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Refresh
                </button>
              )}
            </h3>
            {serviceStatusLoading && (
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>Loading…</div>
            )}
            {!serviceStatusLoading && serviceStatus && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {Object.entries(serviceStatus).map(([unit, { label, status }]) => {
                  const isActive = status === 'active';
                  const isFailed = status === 'failed';
                  return (
                    <div key={unit} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                      <span style={{ color: 'rgba(255,255,255,0.9)' }}>{label}</span>
                      <span style={{
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        fontWeight: 500,
                        background: isActive ? 'rgba(76, 175, 80, 0.25)' : isFailed ? 'rgba(244, 67, 54, 0.25)' : 'rgba(255, 152, 0, 0.2)',
                        color: isActive ? '#81c784' : isFailed ? '#e57373' : '#ffb74d'
                      }}>
                        {status === 'active' ? 'Running' : status === 'failed' ? 'Failed' : status === 'inactive' ? 'Stopped' : status}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {!serviceStatusLoading && !serviceStatus && (
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>Unable to load service status</div>
            )}
          </div>

          {/* Global Settings */}
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ color: '#00d9ff', fontSize: '1.1rem', marginBottom: '1rem' }}>
              🌐 Global Settings
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* FPS Limit */}
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem' }}>
                  FPS Limit
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={fpsLimit}
                  onChange={(e) => {
                    setFpsLimit(Number(e.target.value));
                    setHasChanges(true);
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: '1px solid rgba(0, 217, 255, 0.3)',
                    background: 'rgba(0, 0, 0, 0.3)',
                    color: '#fff',
                    fontSize: '0.9rem'
                  }}
                />
                <small style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem' }}>
                  Frames per second (1-30)
                </small>
              </div>

              {/* Gemini Interval */}
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem' }}>
                  Deep Vision Interval (seconds)
                </label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={geminiInterval}
                  onChange={(e) => {
                    setGeminiInterval(Number(e.target.value));
                    setHasChanges(true);
                  }}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: '1px solid rgba(0, 217, 255, 0.3)',
                    background: 'rgba(0, 0, 0, 0.3)',
                    color: '#fff',
                    fontSize: '0.9rem'
                  }}
                />
                <small style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem' }}>
                  How often to run AI analysis (1-60 seconds)
                </small>
              </div>

              {/* Auto Start */}
              <div>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: '0.9rem'
                }}>
                  <input
                    type="checkbox"
                    checked={autoStart}
                    onChange={(e) => {
                      setAutoStart(e.target.checked);
                      setHasChanges(true);
                    }}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  Auto-start streams on page load
                </label>
                <small style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', marginLeft: '1.5rem', display: 'block', marginTop: '0.25rem' }}>
                  Automatically connect to enabled cameras
                </small>
              </div>

              <div style={{ paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: '0.9rem'
                }}>
                  <input
                    type="checkbox"
                    checked={deepVisionEnabled}
                    onChange={(e) => {
                      setDeepVisionEnabled(e.target.checked);
                      setHasChanges(true);
                    }}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  Deep Vision mode enabled by default
                </label>
                <small style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', marginLeft: '1.5rem', display: 'block', marginTop: '0.25rem' }}>
                  If disabled, default mode falls back to Realtime Detection (YOLO)
                </small>
              </div>

              {/* CMP Settings */}
              <div style={{ paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: '0.9rem'
                }}>
                  <input
                    type="checkbox"
                    checked={cmpEnabled}
                    onChange={(e) => {
                      setCmpEnabled(e.target.checked);
                      setHasChanges(true);
                    }}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  Enable CMP reporting
                </label>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem' }}>
                  CMP Webhook URL
                </label>
                <small style={{ display: 'block', marginBottom: '0.35rem', color: 'rgba(255,255,255,0.55)', fontSize: '0.75rem' }}>
                  Path must be <code style={{ color: '#00d9ff' }}>/api/webhook/edge-report</code>. Local CMP copy in this repo, <code style={{ color: '#00d9ff' }}>CCTVCMP-linux</code> (port 3002):{' '}
                  <code style={{ color: '#00d9ff' }}>http://localhost:3002/api/webhook/edge-report</code>
                  {' · '}Production: <code style={{ color: '#00d9ff' }}>https://cctvcmp.vercel.app/api/webhook/edge-report</code>
                </small>
                <input
                  type="text"
                  value={cmpUrl}
                  onChange={(e) => {
                    setCmpUrl(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="http://localhost:3002/api/webhook/edge-report"
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: '1px solid rgba(0, 217, 255, 0.3)',
                    background: 'rgba(0, 0, 0, 0.3)',
                    color: '#fff',
                    fontSize: '0.9rem'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem' }}>
                  CMP API Key
                </label>
                <small style={{ display: 'block', marginBottom: '0.35rem', color: 'rgba(255,255,255,0.55)', fontSize: '0.75rem' }}>
                  Sent as header <code style={{ color: '#00d9ff' }}>X-API-Key</code>. Must match CMP env <code style={{ color: '#00d9ff' }}>EDGE_API_KEY</code>.
                </small>
                <input
                  type="text"
                  value={cmpApiKey}
                  onChange={(e) => {
                    setCmpApiKey(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="Same value as EDGE_API_KEY on the CMP server"
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: '1px solid rgba(0, 217, 255, 0.3)',
                    background: 'rgba(0, 0, 0, 0.3)',
                    color: '#fff',
                    fontSize: '0.9rem'
                  }}
                />
              </div>

              {/* VPN (Mullvad) */}
              <div style={{ paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: '0.9rem'
                }}>
                  <input
                    type="checkbox"
                    checked={vpnEnabled}
                    onChange={(e) => {
                      setVpnEnabled(e.target.checked);
                      setHasChanges(true);
                    }}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  Enable VPN (Mullvad)
                </label>
              </div>

              {/* Tailscale */}
              <div style={{ paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  color: 'rgba(255,255,255,0.9)',
                  fontSize: '0.9rem'
                }}>
                  <input
                    type="checkbox"
                    checked={tailscaleEnabled}
                    onChange={(e) => {
                      setTailscaleEnabled(e.target.checked);
                      setHasChanges(true);
                    }}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  Enable Tailscale (remote access)
                </label>
                <div style={{ marginTop: '0.5rem', marginLeft: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.35rem', color: 'rgba(255,255,255,0.75)', fontSize: '0.82rem' }}>
                    Tailscale mode
                  </label>
                  <select
                    value={tailscaleMode}
                    onChange={(e) => {
                      setTailscaleMode(e.target.value as 'inbound' | 'outbound');
                      setHasChanges(true);
                    }}
                    style={{
                      width: '100%',
                      maxWidth: '420px',
                      padding: '0.45rem',
                      borderRadius: '4px',
                      border: '1px solid rgba(0, 217, 255, 0.3)',
                      background: 'rgba(0, 0, 0, 0.3)',
                      color: '#fff',
                      fontSize: '0.9rem'
                    }}
                  >
                    <option value="inbound">Inbound access (admin can access edge over Tailscale)</option>
                    <option value="outbound">Outbound only (edge uses Tailscale for remote cameras)</option>
                  </select>
                  <small style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem', display: 'block', marginTop: '0.3rem' }}>
                    Both modes keep Tailscale open; use this to match your camera connectivity scenario.
                  </small>
                </div>
              </div>
            </div>
          </div>

          {/* Scan network for cameras */}
          <div>
            <h3 style={{ color: '#00d9ff', fontSize: '1.1rem', marginBottom: '0.75rem' }}>
              🔍 Scan network for cameras
            </h3>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Discover RTSP cameras on your network (scan may take 1–2 minutes).
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
              <input
                type="text"
                value={scanNetworkPrefix}
                onChange={(e) => setScanNetworkPrefix(e.target.value)}
                placeholder="192.168.10"
                style={{
                  width: '120px',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid rgba(0, 217, 255, 0.3)',
                  background: 'rgba(0, 0, 0, 0.4)',
                  color: '#fff',
                  fontSize: '0.9rem',
                }}
                title="Network prefix (e.g. 192.168.10)"
              />
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>.0/24</span>
              <input
                type="text"
                value={scanUsername}
                onChange={(e) => setScanUsername(e.target.value)}
                placeholder="Username"
                style={{
                  width: '90px',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid rgba(0, 217, 255, 0.3)',
                  background: 'rgba(0, 0, 0, 0.4)',
                  color: '#fff',
                  fontSize: '0.9rem',
                }}
              />
              <input
                type="password"
                value={scanPassword}
                onChange={(e) => setScanPassword(e.target.value)}
                placeholder="Password"
                style={{
                  width: '90px',
                  padding: '0.5rem',
                  borderRadius: '4px',
                  border: '1px solid rgba(0, 217, 255, 0.3)',
                  background: 'rgba(0, 0, 0, 0.4)',
                  color: '#fff',
                  fontSize: '0.9rem',
                }}
              />
              <button
                type="button"
                onClick={handleScanCameras}
                disabled={scanLoading}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  border: '1px solid #00d9ff',
                  background: scanLoading ? 'rgba(0, 217, 255, 0.2)' : 'rgba(0, 217, 255, 0.15)',
                  color: '#00d9ff',
                  fontWeight: 600,
                  cursor: scanLoading ? 'wait' : 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {scanLoading ? '⏳ Scanning…' : '📡 Scan'}
              </button>
            </div>
            {scanError && (
              <div style={{ padding: '0.75rem', background: 'rgba(244, 67, 54, 0.15)', border: '1px solid rgba(244, 67, 54, 0.4)', borderRadius: '6px', color: '#f44336', marginBottom: '1rem', fontSize: '0.9rem' }}>
                {scanError}
              </div>
            )}
            {scanResult !== null && (
              <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(0, 0, 0, 0.25)', borderRadius: '8px', border: '1px solid rgba(0, 217, 255, 0.2)' }}>
                <div style={{ fontWeight: 600, color: '#00d9ff', marginBottom: '0.75rem' }}>
                  Found {scanResult.length} camera(s)
                </div>
                {scanResult.length === 0 ? (
                  <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>No RTSP cameras found. Check network prefix and credentials.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {scanResult.map((cam, idx) => (
                      <div
                        key={`${cam.ip}-${cam.port}-${idx}`}
                        style={{
                          padding: '0.75rem',
                          background: 'rgba(0, 0, 0, 0.3)',
                          borderRadius: '6px',
                          border: '1px solid rgba(0, 217, 255, 0.15)',
                          fontSize: '0.85rem',
                        }}
                      >
                        <div style={{ color: 'rgba(255,255,255,0.9)', marginBottom: '0.35rem' }}>
                          {cam.ip}:{cam.port}{cam.path}
                          {cam.resolution && (
                            <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: '0.5rem' }}>
                              — {cam.resolution}
                              {cam.fps != null && ` @ ${cam.fps} fps`}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <code style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', color: '#00d9ff', fontSize: '0.8rem' }}>
                            {cam.url}
                          </code>
                          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem' }}>Apply to:</span>
                          <select
                            style={{
                              padding: '0.25rem 0.5rem',
                              borderRadius: '4px',
                              border: '1px solid rgba(0, 217, 255, 0.3)',
                              background: 'rgba(0, 0, 0, 0.5)',
                              color: '#fff',
                              fontSize: '0.8rem',
                            }}
                            id={`scan-apply-${idx}`}
                          >
                            {cameras.map((c) => (
                              <option key={c.id} value={c.id}>{getEffectiveName(c)} ({c.id})</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              const sel = document.getElementById(`scan-apply-${idx}`) as HTMLSelectElement;
                              if (sel) applyScannedUrlToCamera(sel.value, cam.url);
                            }}
                            style={{
                              padding: '0.25rem 0.6rem',
                              borderRadius: '4px',
                              border: '1px solid #4caf50',
                              background: 'rgba(76, 175, 80, 0.2)',
                              color: '#4caf50',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                            }}
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Camera URLs */}
          <div>
            <h3 style={{ color: '#00d9ff', fontSize: '1.1rem', marginBottom: '1rem' }}>
              📹 Camera RTSP URLs
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {cameras.map((camera) => {
                const effectiveUrl = getEffectiveUrl(camera);
                const effectiveTailscaleUrl = getEffectiveTailscaleUrl(camera);
                const effectiveUseTailscale = getEffectiveUseTailscale(camera);
                const effectiveName = getEffectiveName(camera);
                const effectiveEnabled = getEffectiveEnabled(camera);
                const urlEdited = isUrlEdited(camera.id);
                const tailscaleUrlEdited = isTailscaleUrlEdited(camera.id);
                const nameEdited = isNameEdited(camera.id);
                const enabledEdited = isEnabledEdited(camera);
                const useTailscaleEdited = isUseTailscaleEdited(camera);

                return (
                  <div
                    key={camera.id}
                    style={{
                      padding: '1rem',
                      background: effectiveEnabled ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.15)',
                      borderRadius: '6px',
                      border: effectiveEnabled ? '1px solid rgba(0, 217, 255, 0.2)' : '1px solid rgba(255, 152, 0, 0.2)',
                      opacity: effectiveEnabled ? 1 : 0.7
                    }}
                  >
                    {/* Header: name + enable toggle + modified badges */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                      <strong style={{ color: '#00d9ff', fontSize: '0.95rem' }}>
                        {effectiveName}
                        <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 400, fontSize: '0.8rem', marginLeft: '0.4rem' }}>
                          ({camera.id})
                        </span>
                      </strong>

                      {/* Enable/Disable Toggle */}
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        cursor: 'pointer',
                        padding: '0.25rem 0.6rem',
                        background: effectiveEnabled ? 'rgba(76, 175, 80, 0.2)' : 'rgba(255, 152, 0, 0.2)',
                        border: effectiveEnabled ? '1px solid rgba(76, 175, 80, 0.4)' : '1px solid rgba(255, 152, 0, 0.4)',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        color: effectiveEnabled ? '#4caf50' : '#ff9800',
                        fontWeight: 500
                      }}>
                        <input
                          type="checkbox"
                          checked={effectiveEnabled}
                          onChange={(e) => handleCameraEnabledToggle(camera.id, e.target.checked)}
                          style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                        />
                        {effectiveEnabled ? '✓ Enabled' : '✕ Disabled'}
                      </label>

                      {enabledEdited && (
                        <span style={{ fontSize: '0.75rem', background: 'rgba(76, 175, 80, 0.2)', color: '#4caf50', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>
                          ✏️ Modified
                        </span>
                      )}
                      {(urlEdited || tailscaleUrlEdited || nameEdited || useTailscaleEdited) && (
                        <span style={{ fontSize: '0.75rem', background: 'rgba(76, 175, 80, 0.2)', color: '#4caf50', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>
                          ✏️ Edited
                        </span>
                      )}
                    </div>

                    {/* Camera Name */}
                    <label style={{ display: 'block', marginBottom: '0.3rem', color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>
                      Camera Name
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={effectiveName}
                        onChange={(e) => handleCameraNameChange(camera.id, e.target.value)}
                        placeholder={camera.name}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          borderRadius: '4px',
                          border: `1px solid ${nameEdited ? 'rgba(0, 217, 255, 0.6)' : 'rgba(0, 217, 255, 0.3)'}`,
                          background: 'rgba(0, 0, 0, 0.4)',
                          color: nameEdited ? '#00d9ff' : '#fff',
                          fontSize: '0.9rem',
                          fontWeight: nameEdited ? 600 : 400
                        }}
                      />
                      {nameEdited && (
                        <button
                          onClick={() => resetCameraName(camera.id)}
                          title="Reset to default name"
                          style={{
                            padding: '0.4rem 0.6rem',
                            borderRadius: '4px',
                            border: '1px solid #ff9800',
                            background: 'rgba(255, 152, 0, 0.1)',
                            color: '#ff9800',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          ↻ Reset
                        </button>
                      )}
                    </div>

                    {/* RTSP URL */}
                    <label style={{ display: 'block', marginBottom: '0.3rem', color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>
                      Direct RTSP URL (LAN/eth2)
                    </label>
                    <input
                      type="text"
                      value={effectiveUrl}
                      onChange={(e) => handleCameraUrlChange(camera.id, e.target.value)}
                      placeholder="rtsp://user:pass@192.168.1.x:554/..."
                      disabled={!effectiveEnabled}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        borderRadius: '4px',
                        border: '1px solid rgba(0, 217, 255, 0.3)',
                        background: effectiveEnabled ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.2)',
                        color: urlEdited ? '#4caf50' : '#fff',
                        fontSize: '0.85rem',
                        fontFamily: 'monospace',
                        marginBottom: '0.5rem',
                        opacity: effectiveEnabled ? 1 : 0.5,
                        cursor: effectiveEnabled ? 'text' : 'not-allowed',
                        boxSizing: 'border-box'
                      }}
                    />

                    {urlEdited && effectiveEnabled && (
                      <button
                        onClick={() => resetCameraUrl(camera.id)}
                        style={{
                          padding: '0.3rem 0.6rem',
                          borderRadius: '4px',
                          border: '1px solid #ff9800',
                          background: 'rgba(255, 152, 0, 0.1)',
                          color: '#ff9800',
                          cursor: 'pointer',
                          fontSize: '0.8rem'
                        }}
                      >
                        ↻ Reset Direct URL
                      </button>
                    )}

                    <div style={{ marginTop: '0.8rem' }}>
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        cursor: 'pointer',
                        color: 'rgba(255,255,255,0.9)',
                        fontSize: '0.85rem',
                        marginBottom: '0.4rem'
                      }}>
                        <input
                          type="checkbox"
                          checked={effectiveUseTailscale}
                          onChange={(e) => handleCameraUseTailscaleToggle(camera.id, e.target.checked)}
                          disabled={!effectiveEnabled}
                          style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                        />
                        Use Tailscale path for this camera
                      </label>

                      <label style={{ display: 'block', marginBottom: '0.3rem', color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>
                        Tailscale RTSP URL (remote)
                      </label>
                      <input
                        type="text"
                        value={effectiveTailscaleUrl}
                        onChange={(e) => handleCameraTailscaleUrlChange(camera.id, e.target.value)}
                        placeholder="rtsp://user:pass@100.x.y.z:554/..."
                        disabled={!effectiveEnabled}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          borderRadius: '4px',
                          border: '1px solid rgba(0, 217, 255, 0.3)',
                          background: effectiveEnabled ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.2)',
                          color: tailscaleUrlEdited ? '#4caf50' : '#fff',
                          fontSize: '0.85rem',
                          fontFamily: 'monospace',
                          marginBottom: '0.5rem',
                          opacity: effectiveEnabled ? 1 : 0.5,
                          cursor: effectiveEnabled ? 'text' : 'not-allowed',
                          boxSizing: 'border-box'
                        }}
                      />
                      {tailscaleUrlEdited && effectiveEnabled && (
                        <button
                          onClick={() => resetCameraTailscaleUrl(camera.id)}
                          style={{
                            padding: '0.3rem 0.6rem',
                            borderRadius: '4px',
                            border: '1px solid #ff9800',
                            background: 'rgba(255, 152, 0, 0.1)',
                            color: '#ff9800',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            marginBottom: '0.3rem'
                          }}
                        >
                          ↻ Reset Tailscale URL
                        </button>
                      )}
                      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>
                        When enabled, stream uses Tailscale URL; otherwise it uses Direct URL.
                      </div>
                    </div>
                    {useTailscaleEdited && (
                      <button
                        onClick={() => handleCameraUseTailscaleToggle(camera.id, !!camera.useTailscale)}
                        style={{
                          marginTop: '0.45rem',
                          padding: '0.3rem 0.6rem',
                          borderRadius: '4px',
                          border: '1px solid #ff9800',
                          background: 'rgba(255, 152, 0, 0.1)',
                          color: '#ff9800',
                          cursor: 'pointer',
                          fontSize: '0.8rem'
                        }}
                      >
                        ↻ Reset Route Toggle
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '1.5rem',
          borderTop: '2px solid rgba(0, 217, 255, 0.3)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem'
        }}>
          <button
            onClick={handleReset}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: '6px',
              border: '1px solid #ff5252',
              background: 'rgba(255, 82, 82, 0.1)',
              color: '#ff5252',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: 500
            }}
          >
            🔄 Reset All
          </button>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              onClick={onClose}
              style={{
                padding: '0.6rem 1.2rem',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.3)',
                background: 'transparent',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              Cancel
            </button>

            <button
              onClick={handleSave}
              style={{
                padding: '0.6rem 1.5rem',
                borderRadius: '6px',
                border: '1px solid #00d9ff',
                background: hasChanges ? '#00d9ff' : 'rgba(0, 217, 255, 0.3)',
                color: hasChanges ? '#000' : '#fff',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: 600
              }}
            >
              💾 Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
