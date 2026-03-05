import React, { useState, useEffect } from 'react';
import type { InputSource, AnalysisMode } from '../types/detection.types';

interface InputPanelProps {
  onSourceChange: (source: InputSource) => void;
  onModeChange: (mode: AnalysisMode) => void;
  currentSource: InputSource;
  currentMode: AnalysisMode;
}

interface AppConfig {
  ui: {
    features: {
      enableImageUpload: boolean;
      enableVideoUpload: boolean;
      enableWebcam: boolean;
      enableRTSP: boolean;
    };
  };
  debug: {
    enabled: boolean;
    showAllFeatures: boolean;
  };
}

const InputPanel: React.FC<InputPanelProps> = ({
  onSourceChange,
  onModeChange,
  currentSource,
  currentMode,
}) => {
  const [config, setConfig] = useState<AppConfig | null>(null);

  // Load configuration from root directory
  useEffect(() => {
    fetch('/app.config.json')
      .then(res => res.json())
      .then(data => {
        setConfig(data);
        console.log('[Config] Loaded app configuration:', data);
      })
      .catch(err => {
        console.error('[Config] Failed to load app.config.json:', err);
        // Default config if file not found
        setConfig({
          ui: {
            features: {
              enableImageUpload: false,
              enableVideoUpload: false,
              enableWebcam: false,
              enableRTSP: true
            }
          },
          debug: {
            enabled: false,
            showAllFeatures: false
          }
        });
      });
  }, []);

  if (!config) {
    return <div className="input-panel">Loading configuration...</div>;
  }

  const { features } = config.ui;
  const { debug } = config;
  const showAll = debug.enabled && debug.showAllFeatures;

  return (
    <div className="input-panel">
      <h3>Input Source</h3>
      <div className="button-group">
        {(features.enableImageUpload || showAll) && (
          <button
            className={currentSource === 'image' ? 'active' : ''}
            onClick={() => onSourceChange('image')}
          >
            📷 Image Upload
          </button>
        )}
        {(features.enableVideoUpload || showAll) && (
          <button
            className={currentSource === 'video' ? 'active' : ''}
            onClick={() => onSourceChange('video')}
          >
            🎥 Video Upload
          </button>
        )}
        {(features.enableWebcam || showAll) && (
          <button
            className={currentSource === 'webcam' ? 'active' : ''}
            onClick={() => onSourceChange('webcam')}
          >
            📹 Webcam
          </button>
        )}
        {(features.enableRTSP || showAll) && (
          <button
            className={currentSource === 'rtsp' ? 'active' : ''}
            onClick={() => onSourceChange('rtsp')}
          >
            📡 RTSP Stream
          </button>
        )}
      </div>

      {currentSource !== 'video' && (
        <>
          <h3>Analysis Mode</h3>
          <div className="button-group">
            <button
              className={currentMode === 'yolo' ? 'active' : ''}
              onClick={() => onModeChange('yolo')}
            >
              🎯 Realtime Detection
            </button>
            <button
              className={currentMode === 'gemini' ? 'active' : ''}
              onClick={() => onModeChange('gemini')}
            >
              🤖 Deep Vision
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default InputPanel;
