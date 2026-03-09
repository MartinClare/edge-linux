import React, { useState, useEffect } from 'react';

interface CameraConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

interface AppSettings {
  cameraUrls: Record<string, string>;
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
  vpn: {
    enabled: boolean;
    interface: string;
    provider: string;
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
  configVpnInterface: string;
  configVpnProvider: string;
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
  configVpnInterface,
  configVpnProvider,
  onClose,
  onSave
}) => {
  const [cameraUrls, setCameraUrls] = useState<Record<string, string>>({});
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
  const [vpnInterface, setVpnInterface] = useState(configVpnInterface);
  const [vpnProvider, setVpnProvider] = useState(configVpnProvider);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    // app.config.json is the source of truth; no localStorage overrides.
  }, []);

  const handleCameraUrlChange = (cameraId: string, url: string) => {
    setCameraUrls(prev => ({ ...prev, [cameraId]: url }));
    setHasChanges(true);
  };

  const handleCameraNameChange = (cameraId: string, name: string) => {
    setCameraNames(prev => ({ ...prev, [cameraId]: name }));
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

  const handleSave = () => {
    const settings: AppSettings = {
      cameraUrls,
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
      vpn: {
        enabled: vpnEnabled,
        interface: vpnInterface.trim() || 'mullvad',
        provider: vpnProvider.trim() || 'mullvad',
      },
    };

    // Sync to app.config.json via Python backend
    const baseUrl = process.env.REACT_APP_YOLO_API_URL || 'http://localhost:8000';
    const rtspPayload = {
      rtsp: {
        cameras: cameras.map((c) => ({
          id: c.id,
          name: cameraNames[c.id] ?? c.name,
          url: cameraUrls[c.id] ?? c.url,
          enabled: cameraEnabled[c.id] !== undefined ? cameraEnabled[c.id] : c.enabled,
        })),
        fpsLimit,
        geminiInterval,
        autoStart,
      },
      ui: {
        deepVisionEnabled: settings.deepVisionEnabled,
        defaultAnalysisMode: settings.deepVisionEnabled ? 'gemini' : 'yolo',
      },
      centralServer: settings.centralServer,
      vpn: settings.vpn,
    };
    fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rtspPayload),
    }).then((res) => {
      if (res.ok) {
        console.log('[Settings] Config synced to app.config.json');
      } else {
        console.warn('[Settings] Failed to sync config to app.config.json:', res.status);
      }
    }).catch((err) => {
      console.warn('[Settings] Could not reach backend to sync app.config.json:', err);
    });

    onSave(settings);
    onClose();
  };

  const handleReset = () => {
    if (window.confirm('Reset all settings to defaults from config file?')) {
      setCameraUrls({});
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
      setVpnInterface(configVpnInterface);
      setVpnProvider(configVpnProvider);
      setHasChanges(true);
    }
  };

  const getEffectiveUrl = (camera: CameraConfig) => {
    return cameraUrls[camera.id] || camera.url;
  };

  const getEffectiveEnabled = (camera: CameraConfig) => {
    // If user has explicitly set enabled state, use that; otherwise use config default
    return cameraEnabled[camera.id] !== undefined ? cameraEnabled[camera.id] : camera.enabled;
  };

  const isUrlEdited = (cameraId: string) => {
    return !!cameraUrls[cameraId];
  };

  const isNameEdited = (cameraId: string) => {
    return !!cameraNames[cameraId];
  };

  const getEffectiveName = (camera: CameraConfig) => {
    return cameraNames[camera.id] || camera.name;
  };

  const isEnabledEdited = (camera: CameraConfig) => {
    return cameraEnabled[camera.id] !== undefined && cameraEnabled[camera.id] !== camera.enabled;
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
                <input
                  type="text"
                  value={cmpUrl}
                  onChange={(e) => {
                    setCmpUrl(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="http://192.168.1.170:3002/api/webhook/edge-report"
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
                <input
                  type="text"
                  value={cmpApiKey}
                  onChange={(e) => {
                    setCmpApiKey(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="CMP API key"
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

              {/* VPN Settings */}
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
                  Enable VPN
                </label>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem' }}>
                  VPN Provider
                </label>
                <input
                  type="text"
                  value={vpnProvider}
                  onChange={(e) => {
                    setVpnProvider(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="mullvad"
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
                  VPN Interface Name
                </label>
                <input
                  type="text"
                  value={vpnInterface}
                  onChange={(e) => {
                    setVpnInterface(e.target.value);
                    setHasChanges(true);
                  }}
                  placeholder="mullvad"
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
            </div>
          </div>

          {/* Camera URLs */}
          <div>
            <h3 style={{ color: '#00d9ff', fontSize: '1.1rem', marginBottom: '1rem' }}>
              📹 Camera RTSP URLs
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {cameras.map((camera) => {
                const effectiveUrl = getEffectiveUrl(camera);
                const effectiveName = getEffectiveName(camera);
                const effectiveEnabled = getEffectiveEnabled(camera);
                const urlEdited = isUrlEdited(camera.id);
                const nameEdited = isNameEdited(camera.id);
                const enabledEdited = isEnabledEdited(camera);

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
                      {(urlEdited || nameEdited) && (
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
                      RTSP URL
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
                        ↻ Reset URL to Default
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
