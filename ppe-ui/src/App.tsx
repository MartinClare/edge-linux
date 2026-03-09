import React, { useState, useEffect } from 'react';
import LoginPage from './components/LoginPage';
import InputPanel from './components/InputPanel';
import ImageUpload from './components/ImageUpload';
import VideoUpload from './components/VideoUpload';
import RTSPStream from './components/RTSPStream';
import MultiCameraGrid from './components/MultiCameraGrid';
import MonitoringDashboard from './components/MonitoringDashboard';
import VideoResultsDashboard from './components/VideoResultsDashboard';
import VideoPlayer from './components/VideoPlayer';
import AlarmObserverPanel from './components/AlarmObserverPanel';
import { detectImageYOLO, detectRTSPYOLO } from './services/yoloApi';
import { analyzeImageGemini, analyzeImageAlerts } from './services/geminiApi';
import { analyzeVideo } from './services/videoApi';
import { analyzeVideoStreaming } from './services/videoStreamingApi';
import type {
  InputSource,
  AnalysisMode,
  Detection,
  ImageDetectionResult,
  GeminiAnalysisResult,
  AlertAnalysisResult,
  VideoAnalysisResult,
  FrameDetection,
} from './types/detection.types';
import './App.css';

function App() {
  interface AppConfig {
    ui?: {
      defaultInputSource?: InputSource;
      defaultAnalysisMode?: AnalysisMode;
      deepVisionEnabled?: boolean;
    };
  }

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    () => sessionStorage.getItem('vd2_auth') === 'true'
  );

  const [inputSource, setInputSource] = useState<InputSource>('rtsp'); // Default to RTSP from config
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('yolo');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [yoloResult, setYoloResult] = useState<ImageDetectionResult | null>(null);
  const [geminiResult, setGeminiResult] = useState<GeminiAnalysisResult | null>(null);
  const [alertResult, setAlertResult] = useState<AlertAnalysisResult | null>(null);
  const [videoResult, setVideoResult] = useState<VideoAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yoloFps, setYoloFps] = useState<number>(15); // Default 15fps for real-time YOLO analysis
  const [currentAnalysisCameraId, setCurrentAnalysisCameraId] = useState<string | null>(null); // Track which camera sent the result
  const [currentAnalysisCameraName, setCurrentAnalysisCameraName] = useState<string | null>(null);

  // Load configuration and set defaults
  useEffect(() => {
    fetch('/app.config.json')
      .then(res => res.json())
      .then((config: AppConfig) => {
        console.log('[App] Loaded configuration:', config);
        if (config.ui?.defaultInputSource) {
          setInputSource(config.ui.defaultInputSource);
        }
        if (config.ui?.deepVisionEnabled === false) {
          setAnalysisMode('yolo');
        } else if (config.ui?.defaultAnalysisMode) {
          setAnalysisMode(config.ui.defaultAnalysisMode);
        } else {
          // Default behavior: Deep Vision ON unless explicitly disabled in app.config.json
          setAnalysisMode('gemini');
        }
      })
      .catch(err => {
        console.error('[App] Failed to load configuration:', err);
      });
  }, []);

  // Clear Gemini/Alert results when switching to YOLO mode for RTSP
  useEffect(() => {
    if (analysisMode === 'yolo' && inputSource === 'rtsp') {
      console.log('[App] Switched to YOLO mode, clearing Deep Vision results');
      setGeminiResult(null);
      setAlertResult(null);
    }
  }, [analysisMode, inputSource]);

  const handleImageSelect = (file: File) => {
    setSelectedFile(file);
    setImageUrl(URL.createObjectURL(file));
    setDetections([]);
    setYoloResult(null);
    setGeminiResult(null);
    setAlertResult(null);
    setVideoResult(null);
    setError(null);
  };

  const handleVideoSelect = (file: File | null, filePath?: string) => {
    setSelectedFile(file);
    if (file) {
      setVideoUrl(URL.createObjectURL(file));
    } else if (filePath) {
      // For folder videos, create HTTP URL to serve from Python backend
      const filename = filePath.split(/[/\\]/).pop() || filePath;
      const YOLO_API_URL = process.env.REACT_APP_YOLO_API_URL || 'http://localhost:8000';
      setVideoUrl(`${YOLO_API_URL}/videos/${encodeURIComponent(filename)}`);
    }
    // Clear all video-related results when selecting a new video
    setVideoResult(null);
    setError(null);
    setProgress(0);
    setProgressMessage('');
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      if (analysisMode === 'yolo') {
        const result = await detectImageYOLO(selectedFile);
        setYoloResult(result);
        setDetections(result.detections);
        setGeminiResult(null);
        setAlertResult(null);
      } else if (analysisMode === 'gemini') {
        const result = await analyzeImageGemini(selectedFile);
        setGeminiResult(result);
        setDetections([]);
        setYoloResult(null);
        setAlertResult(null);
      } else if (analysisMode === 'alerts') {
        const result = await analyzeImageAlerts(selectedFile);
        setAlertResult(result);
        setDetections([]);
        setYoloResult(null);
        setGeminiResult(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      console.error('Analysis error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleVideoAnalyze = async (sampleEvery: number, geminiInterval: number, filePath?: string) => {
    if (!selectedFile && !filePath) return;
    setIsAnalyzing(true);
    setError(null);
    setProgress(0);
    setProgressMessage('Starting streaming analysis...');

    try {
      // Use appropriate API based on whether we have a file or file path
      let result: VideoAnalysisResult;
      
      if (filePath) {
        // Use folder-based API (no upload needed)
        const { analyzeVideoFile } = await import('./services/videoFolderApi');
        result = await analyzeVideoFile(
          filePath,
          sampleEvery,
          geminiInterval,
          'en',
          {
            onProgress: ({ progress, message }) => {
              setProgress(progress);
              setProgressMessage(message);
            },
            onYoloFrames: (frames, stats) => {
              if (!videoResult) {
                setVideoResult({
                  filename: filePath.split(/[/\\]/).pop() || filePath,
                  stats: {
                    totalFrames: stats.totalFrames || 0,
                    sampledFrames: stats.sampledFrames || frames.length,
                    analyzedFrames: 0,
                    duration: stats.duration || 0,
                    fps: stats.fps,
                    totalDetections: 0,
                    uniqueClasses: [],
                    violations: 0,
                  },
                  yoloFrames: frames,
                  geminiAnalyses: [],
                });
              } else {
                setVideoResult(prev => prev ? {
                  ...prev,
                  yoloFrames: frames,
                  stats: {
                    ...prev.stats,
                    totalFrames: stats.totalFrames || prev.stats.totalFrames,
                    sampledFrames: stats.sampledFrames || frames.length,
                    fps: stats.fps || prev.stats.fps,
                    duration: stats.duration || prev.stats.duration,
                  },
                } : null);
              }
            },
            onGeminiAnalysis: (analysis) => {
              setVideoResult(prev => prev ? {
                ...prev,
                geminiAnalyses: [...prev.geminiAnalyses, analysis],
                stats: {
                  ...prev.stats,
                  analyzedFrames: prev.geminiAnalyses.length + 1,
                },
              } : null);
            },
            onComplete: (result) => {
              setVideoResult(result);
              setProgress(100);
              setProgressMessage('Analysis complete!');
              setIsAnalyzing(false);
            },
            onError: (errorMsg) => {
              setError(errorMsg);
              setProgress(0);
              setProgressMessage('');
              setIsAnalyzing(false);
            },
          }
        );
      } else if (selectedFile) {
        // Use file upload API
        const { analyzeVideoStreaming } = await import('./services/videoStreamingApi');
        result = await analyzeVideoStreaming(
          selectedFile,
          sampleEvery,
          geminiInterval,
          'en',
          {
            onProgress: ({ progress, message }) => {
              setProgress(progress);
              setProgressMessage(message);
            },
            onYoloFrames: (frames, stats) => {
              if (!videoResult) {
                setVideoResult({
                  filename: selectedFile.name,
                  stats: {
                    totalFrames: stats.totalFrames || 0,
                    sampledFrames: stats.sampledFrames || frames.length,
                    analyzedFrames: 0,
                    duration: stats.duration || 0,
                    fps: stats.fps,
                    totalDetections: 0,
                    uniqueClasses: [],
                    violations: 0,
                  },
                  yoloFrames: frames,
                  geminiAnalyses: [],
                });
              } else {
                setVideoResult(prev => prev ? {
                  ...prev,
                  yoloFrames: frames,
                  stats: {
                    ...prev.stats,
                    totalFrames: stats.totalFrames || prev.stats.totalFrames,
                    sampledFrames: stats.sampledFrames || frames.length,
                    fps: stats.fps || prev.stats.fps,
                    duration: stats.duration || prev.stats.duration,
                  },
                } : null);
              }
            },
            onGeminiAnalysis: (analysis) => {
              setVideoResult(prev => prev ? {
                ...prev,
                geminiAnalyses: [...prev.geminiAnalyses, analysis],
                stats: {
                  ...prev.stats,
                  analyzedFrames: prev.geminiAnalyses.length + 1,
                },
              } : null);
            },
            onComplete: (result) => {
              setVideoResult(result);
              setProgress(100);
              setProgressMessage('Analysis complete!');
              setIsAnalyzing(false);
            },
            onError: (errorMsg) => {
              setError(errorMsg);
              setProgress(0);
              setProgressMessage('');
              setIsAnalyzing(false);
            },
          }
        );
      } else {
        throw new Error('No video file or path provided');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Video analysis failed';
      setError(errorMessage);
      setProgress(0);
      setProgressMessage('');
      setIsAnalyzing(false);
    }
  };

  const handleFrameSelect = (frame: FrameDetection) => {
    // Display selected frame in monitoring dashboard
    if (frame.frame_data) {
      const frameDataUrl = `data:image/jpeg;base64,${frame.frame_data}`;
      setImageUrl(frameDataUrl);
      setDetections(frame.detections);
    }
  };

  const handleRTSPConnect = async (url: string, maxFrames: number, sampleEvery: number) => {
    setIsAnalyzing(true);
    setError(null);
    setProgress(0);
    setProgressMessage('Connecting to RTSP stream...');
    setVideoResult(null);

    try {
      console.log('RTSP connection:', { url, maxFrames, sampleEvery });
      
      // Call YOLO API for RTSP stream detection
      setProgressMessage('Processing RTSP stream frames...');
      const yoloResult = await detectRTSPYOLO(url, maxFrames, sampleEvery);
      
      console.log('YOLO RTSP detection complete:', yoloResult);
      
      // Convert YOLO result to frame detections
      const yoloFrames: FrameDetection[] = yoloResult.frames.map(frame => ({
        frame_index: frame.frame_index,
        timestamp_sec: frame.timestamp_sec || 0,
        detections: frame.detections,
        frame_data: frame.frame_data,
        gemini_analysis: undefined,
      }));

      // Calculate statistics
      const allDetections = yoloFrames.flatMap(f => f.detections);
      const uniqueClasses = Array.from(new Set(allDetections.map(d => d.class_name)));

      // Initialize video result with YOLO data
      const initialResult: VideoAnalysisResult = {
        filename: `RTSP Stream (${url})`,
        stats: {
          totalFrames: yoloResult.total_frames,
          sampledFrames: yoloResult.total_frames_sampled,
          analyzedFrames: 0,
          duration: 0,
          fps: yoloResult.video_fps,
          totalDetections: allDetections.length,
          uniqueClasses: uniqueClasses,
          violations: 0,
        },
        yoloFrames: yoloFrames,
        geminiAnalyses: [],
      };

      setVideoResult(initialResult);
      setProgress(100);
      setProgressMessage('RTSP stream analysis complete!');
      setIsAnalyzing(false);
      
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
      const errorMessage =
        axiosErr.response?.data?.detail ||
        (err instanceof Error ? err.message : String(err) || 'RTSP connection failed');
      setError(errorMessage);
      setProgress(0);
      setProgressMessage('');
      setIsAnalyzing(false);
      console.error('RTSP error:', err);
    }
  };

  // Filter detections with confidence > 50% and exclude masks and NO-Hardhat
  const filteredDetections = detections.filter(det => 
    det.confidence > 0.5 && 
    !det.class_name.toLowerCase().includes('mask') &&
    det.class_name !== 'NO-Hardhat'
  );

  // Count specific items
  const personCount = filteredDetections.filter(d => d.class_name === 'Person').length;
  const hardhatCount = filteredDetections.filter(d => d.class_name === 'Hardhat').length;
  const vestCount = filteredDetections.filter(d => d.class_name === 'Safety Vest').length;
  
  // Calculate violations: if hardhats < people, count missing hardhats as violations
  // Only count "NO-Safety Vest" violations (exclude NO-Hardhat and mask violations)
  const missingHardhats = personCount > 0 && hardhatCount < personCount ? personCount - hardhatCount : 0;
  const missingVests = personCount > 0 && vestCount < personCount ? personCount - vestCount : 0;
  const explicitViolations = filteredDetections.filter(d => 
    d.class_name === 'NO-Safety Vest' && !d.class_name.toLowerCase().includes('mask')
  ).length;
  const totalViolations = missingHardhats + missingVests + explicitViolations;

  // In Deep Vision (gemini) or Alerts Only mode, use Gemini's counts instead of YOLO counts
  const useGeminiCounts = analysisMode === 'gemini' && geminiResult;
  const useAlertCounts = analysisMode === 'alerts' && alertResult;
  
  // Get counts from appropriate source
  const finalPersonCount = (useAlertCounts && alertResult?.peopleCount !== undefined)
      ? alertResult.peopleCount
      : (useGeminiCounts && geminiResult?.peopleCount !== undefined) 
        ? geminiResult.peopleCount 
        : personCount;
      
  const finalMissingHardhats = (useAlertCounts && alertResult?.missingHardhats !== undefined)
      ? alertResult.missingHardhats
      : (useGeminiCounts && geminiResult?.missingHardhats !== undefined)
        ? geminiResult.missingHardhats
        : missingHardhats;
      
  const finalMissingVests = (useAlertCounts && alertResult?.missingVests !== undefined)
      ? alertResult.missingVests
      : (useGeminiCounts && geminiResult?.missingVests !== undefined)
        ? geminiResult.missingVests
        : missingVests;

  const stats = {
    totalDetections: filteredDetections.length,
    ppeCompliant: hardhatCount + vestCount, // Total PPE items detected
    violations: totalViolations,
    personCount: finalPersonCount,
    hardhatCount: hardhatCount,
    vestCount: vestCount,
    missingHardhats: finalMissingHardhats,
    missingVests: finalMissingVests,
  };

  if (!isAuthenticated) {
    return <LoginPage onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="App">
      <div className="container">
        <aside className="sidebar">
          <InputPanel
            onSourceChange={setInputSource}
            onModeChange={setAnalysisMode}
            currentSource={inputSource}
            currentMode={analysisMode}
          />

          <div className="input-content">
            {inputSource === 'image' && (
              <ImageUpload
                onImageSelect={handleImageSelect}
                onAnalyze={handleAnalyze}
                isAnalyzing={isAnalyzing}
              />
            )}

            {inputSource === 'rtsp' && (
              <div style={{
                padding: '1rem',
                background: 'rgba(0, 217, 255, 0.08)',
                borderRadius: '8px',
                border: '1px solid rgba(0, 217, 255, 0.2)',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '0.95rem'
              }}>
                <p style={{ margin: 0 }}>📡 RTSP Stream</p>
                <p style={{ margin: '0.5rem 0 0 0', opacity: 0.85 }}>
                  Live stream and view options are on the <strong>main screen</strong> →
                </p>
              </div>
            )}

            {inputSource === 'video' && (
              <VideoUpload
                onVideoSelect={handleVideoSelect}
                onAnalyze={handleVideoAnalyze}
                isAnalyzing={isAnalyzing}
              />
            )}

            {inputSource === 'webcam' && (
              <div className="coming-soon">
                <p>📹 Webcam support coming soon!</p>
              </div>
            )}
          </div>

          {(isAnalyzing && (inputSource === 'video' || inputSource === 'rtsp')) && (
            <div className="progress-container">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="progress-message">{progressMessage}</p>
            </div>
          )}

          {error && (
            <div className="error-message">
              <p>❌ {error}</p>
            </div>
          )}

          {/* Alarm Observer Panel - Shows active alarms and system status */}
          <AlarmObserverPanel />
        </aside>

        <main className="main-content">
          {inputSource === 'video' && videoUrl ? (
            <VideoPlayer
              videoUrl={videoUrl}
              result={videoResult || {
                filename: selectedFile?.name || 'video',
                stats: {
                  totalFrames: 0,
                  sampledFrames: 0,
                  analyzedFrames: 0,
                  duration: 0,
                  fps: null,
                  totalDetections: 0,
                  uniqueClasses: [],
                  violations: 0,
                },
                yoloFrames: [],
                geminiAnalyses: [],
              }}
              onFrameSelect={handleFrameSelect}
              yoloFps={yoloFps}
              enableRealTimeYolo={true}
            />
          ) : inputSource === 'rtsp' && videoResult ? (
            <div className="rtsp-results">
              <div className="rtsp-success-banner">
                ✓ Connected — {videoResult.stats.sampledFrames} frames analyzed from RTSP stream
              </div>
              <VideoResultsDashboard
                result={videoResult}
                onFrameSelect={handleFrameSelect}
              />
            </div>
          ) : (
            <>
              {/* Monitoring dashboard only for image/video upload modes; hidden for RTSP so main frame is the stream */}
              {inputSource !== 'rtsp' && (
                <MonitoringDashboard
                  imageUrl={imageUrl}
                  detections={filteredDetections}
                  stats={stats}
                />
              )}

              {/* Deep Vision Summary for RTSP — shown at TOP, above camera grid */}
              {inputSource === 'rtsp' && analysisMode === 'gemini' && geminiResult && (
                <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.8rem', background: 'rgba(156,39,176,0.12)', borderRadius: '8px 8px 0 0', border: '1px solid rgba(156,39,176,0.3)', borderBottom: 'none' }}>
                  <span style={{ fontSize: '1rem' }}>🧠</span>
                  <span style={{ fontSize: '0.85rem', color: '#bb86fc', fontWeight: 600 }}>Deep Vision Summary</span>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginLeft: '0.25rem' }}>— latest result across all cameras</span>
                </div>
              )}
              {inputSource === 'rtsp' && analysisMode === 'gemini' && geminiResult && (
                <div style={{
                  marginTop: '2rem',
                  padding: '2rem',
                  background: 'linear-gradient(135deg, rgba(106, 27, 154, 0.15) 0%, rgba(156, 39, 176, 0.15) 100%)',
                  border: '2px solid #9c27b0',
                  borderRadius: '16px',
                  boxShadow: '0 8px 32px rgba(156, 39, 176, 0.3)'
                }}>
                  {/* Camera Source Header */}
                  {currentAnalysisCameraId && (
                    <div style={{
                      marginBottom: '1.5rem',
                      padding: '0.75rem 1rem',
                      background: 'rgba(156, 39, 176, 0.2)',
                      border: '1px solid rgba(156, 39, 176, 0.4)',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem'
                    }}>
                      <span style={{ fontSize: '1.5rem' }}>📹</span>
                      <div>
                        <div style={{ 
                          fontSize: '1.1rem', 
                          fontWeight: 600,
                          color: '#e1bee7'
                        }}>
                          Analysis from the camera of {currentAnalysisCameraName || currentAnalysisCameraId}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '1rem', 
                    marginBottom: '1.5rem',
                    paddingBottom: '1rem',
                    borderBottom: '2px solid rgba(187, 134, 252, 0.3)'
                  }}>
                    <span style={{ fontSize: '3rem' }}>🧠</span>
                    <div>
                      <h2 style={{ margin: 0, color: '#bb86fc', fontSize: '1.8rem' }}>Deep Vision AI Analysis</h2>
                      <p style={{ margin: '0.25rem 0 0 0', color: 'rgba(255,255,255,0.7)', fontSize: '0.95rem' }}>
                        Comprehensive AI-powered safety assessment
                      </p>
                    </div>
                  </div>
                  
                  {/* Risk Level */}
                  <div style={{
                    padding: '1.5rem',
                    background: 'rgba(0,0,0,0.4)',
                    borderRadius: '12px',
                    marginBottom: '1.5rem',
                    borderLeft: '6px solid #bb86fc'
                  }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 'bold', marginBottom: '0.75rem' }}>
                      🎯 Risk Level: <span style={{ 
                        color: geminiResult.overallRiskLevel === 'High' ? '#f44336' : 
                               geminiResult.overallRiskLevel === 'Medium' ? '#ff9800' : '#4caf50'
                      }}>
                        {geminiResult.overallRiskLevel}
                      </span>
                    </div>
                    <p style={{ margin: 0, color: 'rgba(255,255,255,0.95)', fontSize: '1.05rem', lineHeight: '1.6' }}>
                      {geminiResult.overallDescription}
                    </p>
                  </div>

                  {/* PPE Status Cards */}
                  {(geminiResult.peopleCount !== undefined || 
                    geminiResult.missingHardhats !== undefined || 
                    geminiResult.missingVests !== undefined) && (
                    <div style={{ marginBottom: '2rem' }}>
                      <h3 style={{ color: '#bb86fc', fontSize: '1.3rem', marginBottom: '1rem' }}>👥 People & PPE Status</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.5rem' }}>
                        <div style={{ 
                          padding: '1.5rem', 
                          background: 'rgba(0,0,0,0.4)', 
                          borderRadius: '12px',
                          textAlign: 'center',
                          border: '2px solid rgba(187,134,252,0.4)',
                          boxShadow: '0 4px 12px rgba(187,134,252,0.2)'
                        }}>
                          <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#bb86fc', marginBottom: '0.5rem' }}>
                            {geminiResult.peopleCount || 0}
                          </div>
                          <div style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>Persons Detected</div>
                        </div>
                        <div style={{ 
                          padding: '1.5rem', 
                          background: 'rgba(0,0,0,0.4)', 
                          borderRadius: '12px',
                          textAlign: 'center',
                          border: '2px solid rgba(244,67,54,0.4)',
                          boxShadow: '0 4px 12px rgba(244,67,54,0.2)'
                        }}>
                          <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#f44336', marginBottom: '0.5rem' }}>
                            {geminiResult.missingHardhats || 0}
                          </div>
                          <div style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>Missing Hardhats</div>
                        </div>
                        <div style={{ 
                          padding: '1.5rem', 
                          background: 'rgba(0,0,0,0.4)', 
                          borderRadius: '12px',
                          textAlign: 'center',
                          border: '2px solid rgba(244,67,54,0.4)',
                          boxShadow: '0 4px 12px rgba(244,67,54,0.2)'
                        }}>
                          <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#f44336', marginBottom: '0.5rem' }}>
                            {geminiResult.missingVests || 0}
                          </div>
                          <div style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>Missing Safety Vests</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Safety Categories Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                    {/* Construction Safety */}
                    <div style={{ 
                      padding: '1.5rem', 
                      background: 'rgba(0,0,0,0.4)', 
                      borderRadius: '12px',
                      border: '1px solid rgba(187,134,252,0.3)'
                    }}>
                      <h4 style={{ color: '#bb86fc', marginTop: 0, fontSize: '1.2rem' }}>🏗️ Construction Safety</h4>
                      <p style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.9)', lineHeight: '1.5' }}>
                        {geminiResult.constructionSafety.summary}
                      </p>
                      {geminiResult.constructionSafety.issues.length > 0 && (
                        <div style={{ marginTop: '1rem' }}>
                          <strong style={{ color: '#f44336', fontSize: '1rem' }}>⚠️ Issues:</strong>
                          <ul style={{ margin: '0.75rem 0', paddingLeft: '1.5rem' }}>
                            {geminiResult.constructionSafety.issues.map((issue, i) => (
                              <li key={i} style={{ color: 'rgba(255,255,255,0.95)', marginBottom: '0.5rem', lineHeight: '1.5' }}>
                                {issue}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {geminiResult.constructionSafety.recommendations.length > 0 && (
                        <div style={{ marginTop: '1rem' }}>
                          <strong style={{ color: '#4caf50', fontSize: '1rem' }}>✅ Recommendations:</strong>
                          <ul style={{ margin: '0.75rem 0', paddingLeft: '1.5rem' }}>
                            {geminiResult.constructionSafety.recommendations.map((rec, i) => (
                              <li key={i} style={{ color: 'rgba(255,255,255,0.95)', marginBottom: '0.5rem', lineHeight: '1.5' }}>
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* Fire Safety */}
                    <div style={{ 
                      padding: '1.5rem', 
                      background: 'rgba(0,0,0,0.4)', 
                      borderRadius: '12px',
                      border: '1px solid rgba(187,134,252,0.3)'
                    }}>
                      <h4 style={{ color: '#bb86fc', marginTop: 0, fontSize: '1.2rem' }}>🔥 Fire Safety</h4>
                      <p style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.9)', lineHeight: '1.5' }}>
                        {geminiResult.fireSafety.summary}
                      </p>
                      {geminiResult.fireSafety.issues.length > 0 && (
                        <div style={{ marginTop: '1rem' }}>
                          <strong style={{ color: '#f44336', fontSize: '1rem' }}>⚠️ Issues:</strong>
                          <ul style={{ margin: '0.75rem 0', paddingLeft: '1.5rem' }}>
                            {geminiResult.fireSafety.issues.map((issue, i) => (
                              <li key={i} style={{ color: 'rgba(255,255,255,0.95)', marginBottom: '0.5rem', lineHeight: '1.5' }}>
                                {issue}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* Property Security */}
                    <div style={{ 
                      padding: '1.5rem', 
                      background: 'rgba(0,0,0,0.4)', 
                      borderRadius: '12px',
                      border: '1px solid rgba(187,134,252,0.3)'
                    }}>
                      <h4 style={{ color: '#bb86fc', marginTop: 0, fontSize: '1.2rem' }}>🔐 Property Security</h4>
                      <p style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.9)', lineHeight: '1.5' }}>
                        {geminiResult.propertySecurity.summary}
                      </p>
                      {geminiResult.propertySecurity.issues.length > 0 && (
                        <div style={{ marginTop: '1rem' }}>
                          <strong style={{ color: '#f44336', fontSize: '1rem' }}>⚠️ Issues:</strong>
                          <ul style={{ margin: '0.75rem 0', paddingLeft: '1.5rem' }}>
                            {geminiResult.propertySecurity.issues.map((issue, i) => (
                              <li key={i} style={{ color: 'rgba(255,255,255,0.95)', marginBottom: '0.5rem', lineHeight: '1.5' }}>
                                {issue}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* RTSP: live stream grid — below the Deep Vision summary */}
              {inputSource === 'rtsp' && (
                <div style={{ marginTop: '1.5rem' }}>
                  <MultiCameraGrid
                    analysisMode={analysisMode}
                    onGeminiResult={(cameraId: string, cameraName: string, result: GeminiAnalysisResult | null) => {
                      console.log(`[App] Gemini result from camera: ${cameraName} (${cameraId})`, result);
                      setGeminiResult(result);
                      setCurrentAnalysisCameraId(cameraId);
                      setCurrentAnalysisCameraName(cameraName);
                      if (result) {
                        fetch('http://localhost:8000/alarms/process-analysis', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            camera_id: cameraId,
                            camera_name: cameraName,
                            overallDescription: result.overallDescription,
                            overallRiskLevel: result.overallRiskLevel,
                            peopleCount: result.peopleCount ?? 0,
                            missingHardhats: result.missingHardhats ?? 0,
                            missingVests: result.missingVests ?? 0,
                            constructionSafety: result.constructionSafety,
                            fireSafety: result.fireSafety,
                            propertySecurity: result.propertySecurity,
                          }),
                        }).catch(err => console.warn('[App] Failed to forward Gemini result to alarm observer:', err));
                      }
                    }}
                    onAlertResult={(cameraId: string, cameraName: string, result: AlertAnalysisResult | null) => {
                      console.log(`[App] Alert result from camera: ${cameraName} (${cameraId})`, result);
                      setAlertResult(result);
                      setCurrentAnalysisCameraId(cameraId);
                      setCurrentAnalysisCameraName(cameraName);
                    }}
                  />
                </div>
              )}
            </>
          )}

          {yoloResult && analysisMode === 'yolo' && (
            <div className="yolo-results">
              <h3>🎯 Realtime Detection Results</h3>
              <div className="detection-info">
                <div className="info-row">
                  <span className="info-label">Model:</span>
                  <span className="info-value">{yoloResult.model_name}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Device:</span>
                  <span className="info-value">{yoloResult.device}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Inference Time:</span>
                  <span className="info-value">{yoloResult.inference_ms.toFixed(2)} ms</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Image Size:</span>
                  <span className="info-value">{yoloResult.image_width} × {yoloResult.image_height}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Total Detections:</span>
                  <span className="info-value">{yoloResult.detections.length}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Detections (&gt;50%, filtered):</span>
                  <span className="info-value">{yoloResult.detections.filter(d => d.confidence > 0.5 && !d.class_name.toLowerCase().includes('mask') && d.class_name !== 'NO-Hardhat').length}</span>
                </div>
              </div>

              {(() => {
                const filteredYoloDetections = yoloResult.detections.filter(det => 
                  det.confidence > 0.5 && 
                  !det.class_name.toLowerCase().includes('mask') &&
                  det.class_name !== 'NO-Hardhat'
                );
                return filteredYoloDetections.length > 0 ? (
                  <div className="detections-list">
                    <h4>Detected Objects (&gt;50% confidence)</h4>
                    <div className="detections-table">
                      <div className="table-header">
                        <span>Class</span>
                        <span>Confidence</span>
                        <span>Bounding Box</span>
                      </div>
                      {filteredYoloDetections.map((det, i) => (
                        <div key={i} className="table-row">
                          <span className="class-name">{det.class_name}</span>
                          <span className="confidence">{(det.confidence * 100).toFixed(1)}%</span>
                          <span className="bbox">
                            [{det.bbox[0].toFixed(0)}, {det.bbox[1].toFixed(0)}, {det.bbox[2].toFixed(0)}, {det.bbox[3].toFixed(0)}]
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="no-detections">
                    <p>No objects detected with confidence &gt;50%.</p>
                    <p className="detection-note">Total detections: {yoloResult.detections.length} (showing only &gt;50% confidence)</p>
                  </div>
                );
              })()}
            </div>
          )}

          {geminiResult && inputSource === 'image' && analysisMode === 'gemini' && (
            <div className="gemini-results">
              <h3>🤖 AI Safety Analysis</h3>
              <div className="risk-level">
                Risk Level: <span className={`risk-${geminiResult.overallRiskLevel.toLowerCase()}`}>
                  {geminiResult.overallRiskLevel}
                </span>
              </div>
              <p>{geminiResult.overallDescription}</p>
              
              {(geminiResult.peopleCount !== undefined || geminiResult.missingHardhats !== undefined || geminiResult.missingVests !== undefined) && (
                <div className="ppe-counts">
                  <h4>👥 People & PPE Status</h4>
                  <div className="stats-panel">
                    <div className="stat-card">
                      <h4>Persons Detected</h4>
                      <p className="stat-value">{geminiResult.peopleCount || 0}</p>
                    </div>
                    <div className="stat-card">
                      <h4>Missing Hardhats</h4>
                      <p className="stat-value danger">{geminiResult.missingHardhats || 0}</p>
                    </div>
                    <div className="stat-card">
                      <h4>Missing Safety Vests</h4>
                      <p className="stat-value danger">{geminiResult.missingVests || 0}</p>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="safety-categories">
                <div className="category">
                  <h4>🏗️ Construction Safety</h4>
                  <p>{geminiResult.constructionSafety.summary}</p>
                  {geminiResult.constructionSafety.issues.length > 0 && (
                    <ul>
                      {geminiResult.constructionSafety.issues.map((issue, i) => (
                        <li key={i}>❌ {issue}</li>
                      ))}
                    </ul>
                  )}
                  {geminiResult.constructionSafety.recommendations.length > 0 && (
                    <ul>
                      {geminiResult.constructionSafety.recommendations.map((rec, i) => (
                        <li key={i}>✅ {rec}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="category">
                  <h4>🔥 Fire Safety</h4>
                  <p>{geminiResult.fireSafety.summary}</p>
                  {geminiResult.fireSafety.issues.length > 0 && (
                    <ul>
                      {geminiResult.fireSafety.issues.map((issue, i) => (
                        <li key={i}>❌ {issue}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="category">
                  <h4>🔐 Property Security</h4>
                  <p>{geminiResult.propertySecurity.summary}</p>
                  {geminiResult.propertySecurity.issues.length > 0 && (
                    <ul>
                      {geminiResult.propertySecurity.issues.map((issue, i) => (
                        <li key={i}>❌ {issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {alertResult && inputSource === 'image' && analysisMode === 'alerts' && (
            <div className="alert-results">
              <h3>🚨 Safety Alerts</h3>
              <div className="risk-level">
                Overall Risk: <span className={`risk-${alertResult.overallRiskLevel.toLowerCase()}`}>
                  {alertResult.overallRiskLevel}
                </span>
              </div>
              <p>Alert Count: {alertResult.alertCount}</p>
              
              {(alertResult.peopleCount !== undefined || alertResult.missingHardhats !== undefined || alertResult.missingVests !== undefined) && (
                <div className="ppe-counts">
                  <h4>👥 People & PPE Status</h4>
                  <div className="stats-panel">
                    <div className="stat-card">
                      <h4>Persons Detected</h4>
                      <p className="stat-value">{alertResult.peopleCount || 0}</p>
                    </div>
                    <div className="stat-card">
                      <h4>Missing Hardhats</h4>
                      <p className="stat-value danger">{alertResult.missingHardhats || 0}</p>
                    </div>
                    <div className="stat-card">
                      <h4>Missing Safety Vests</h4>
                      <p className="stat-value danger">{alertResult.missingVests || 0}</p>
                    </div>
                  </div>
                </div>
              )}
              
              {alertResult.alerts.length > 0 && (
                <div className="alerts-list">
                  {alertResult.alerts.map((alert, i) => (
                    <div key={i} className={`alert-item severity-${alert.severity}`}>
                      <span className="alert-category">[{alert.category}]</span>
                      <span className="alert-severity">[{alert.severity}]</span>
                      <p>{alert.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
