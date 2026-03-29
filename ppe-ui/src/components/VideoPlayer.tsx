import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { VideoAnalysisResult, FrameDetection, GeminiFrameAnalysis } from '../types/detection.types';
import { detectImageYOLO } from '../services/yoloApi';
import GeminiPpeNarrative from './GeminiPpeNarrative';

const getColorForClass = (className: string): string => {
  if (className.includes('NO-')) return '#FF0000'; // Red for violations
  if (className === 'Person') return '#FFFF00'; // Yellow for persons
  if (className === 'machinery' || className === 'vehicle') return '#FFA500'; // Orange for machinery/vehicles
  return '#00FF00'; // Green for PPE items
};

interface VideoPlayerProps {
  videoUrl: string;
  result: VideoAnalysisResult;
  onFrameSelect?: (frame: FrameDetection) => void;
  yoloFps?: number; // Frames per second to extract and analyze (default: 15)
  enableRealTimeYolo?: boolean; // Enable real-time YOLO analysis from playing video (default: true)
}

/**
 * VideoPlayer Component
 * 
 * IMPORTANT: This component ONLY displays pre-analyzed results.
 * It does NOT make any API calls to Gemini or YOLO.
 * All analysis is done once when the user clicks "Analyze Video",
 * and the results are passed via the `result` prop.
 * 
 * During video looping, this component simply looks up the pre-analyzed
 * results from the `geminiAnalyses` and `yoloFrames` arrays.
 */
const VideoPlayer: React.FC<VideoPlayerProps> = ({ 
  videoUrl, 
  result, 
  onFrameSelect,
  yoloFps = 15,
  enableRealTimeYolo = true
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameExtractionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentFrame, setCurrentFrame] = useState<FrameDetection | null>(null);
  const [currentGeminiAnalysis, setCurrentGeminiAnalysis] = useState<GeminiFrameAnalysis | null>(null);
  const [persistedGeminiAnalysis, setPersistedGeminiAnalysis] = useState<GeminiFrameAnalysis | null>(null);
  
  // Real-time YOLO frames extracted from playing video
  const [realTimeYoloFrames, setRealTimeYoloFrames] = useState<Map<number, FrameDetection>>(new Map());
  const [isAnalyzingFrame, setIsAnalyzingFrame] = useState(false);
  const lastExtractedTimeRef = useRef<number>(-1);
  const frameRequestIdRef = useRef<number | null>(null);

  // Extract pre-analyzed results (all analysis done upfront when video was uploaded)
  const { yoloFrames: preAnalyzedYoloFrames, geminiAnalyses, stats } = result;
  
  // Clear all state when video URL changes (new video selected)
  useEffect(() => {
    // Clear real-time YOLO frames
    setRealTimeYoloFrames(new Map());
    // Clear current frame
    setCurrentFrame(null);
    // Clear Gemini analyses
    setCurrentGeminiAnalysis(null);
    setPersistedGeminiAnalysis(null);
    // Reset extraction tracking
    lastExtractedTimeRef.current = -1;
    setIsAnalyzingFrame(false);
    // Clear canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    // Cancel any pending frame extraction
    if (frameRequestIdRef.current) {
      cancelAnimationFrame(frameRequestIdRef.current);
      frameRequestIdRef.current = null;
    }
  }, [videoUrl]);
  
  // Debug: Log Gemini analyses when they change
  useEffect(() => {
    console.log(`📦 Gemini analyses state updated:`, {
      count: geminiAnalyses.length,
      analyses: geminiAnalyses.map(g => ({
        timestamp: g.timestamp,
        hasAnalysis: !!g.analysis,
        riskLevel: g.analysis?.overallRiskLevel,
        error: g.error,
      })),
      currentTime: currentTime,
      persistedAnalysis: persistedGeminiAnalysis ? {
        timestamp: persistedGeminiAnalysis.timestamp,
        hasAnalysis: !!persistedGeminiAnalysis.analysis,
      } : null,
      currentAnalysis: currentGeminiAnalysis ? {
        timestamp: currentGeminiAnalysis.timestamp,
        hasAnalysis: !!currentGeminiAnalysis.analysis,
      } : null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geminiAnalyses.length, currentTime, persistedGeminiAnalysis, currentGeminiAnalysis]);

  // Extract frame from video and send to YOLO API
  const extractAndAnalyzeFrame = useCallback(async (timestamp: number): Promise<void> => {
    const video = videoRef.current;
    if (!video || isAnalyzingFrame) return;
    
    // Wait for video to be ready
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }
    
    // Skip if frame is too early (often black)
    if (timestamp < 0.5) {
      return;
    }
    
    const roundedTime = Math.round(timestamp * 10) / 10;
    
    // Skip if we already have this frame
    if (realTimeYoloFrames.has(roundedTime)) {
      return;
    }
    
    setIsAnalyzingFrame(true);
    
    try {
      // Create canvas for frame extraction
      if (!frameExtractionCanvasRef.current) {
        frameExtractionCanvasRef.current = document.createElement('canvas');
      }
      const extractCanvas = frameExtractionCanvasRef.current;
      extractCanvas.width = video.videoWidth;
      extractCanvas.height = video.videoHeight;
      
      const ctx = extractCanvas.getContext('2d');
      if (!ctx) {
        setIsAnalyzingFrame(false);
        return;
      }
      
      // Draw current video frame to canvas
      ctx.drawImage(video, 0, 0, extractCanvas.width, extractCanvas.height);
      
      // Check if frame is black
      const imageData = ctx.getImageData(0, 0, Math.min(100, extractCanvas.width), Math.min(100, extractCanvas.height));
      const pixels = imageData.data;
      let totalBrightness = 0;
      let sampleCount = 0;
      for (let i = 0; i < pixels.length; i += 16) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        totalBrightness += (r + g + b) / 3;
        sampleCount++;
      }
      const avgBrightness = totalBrightness / sampleCount;
      
      if (avgBrightness < 10) {
        setIsAnalyzingFrame(false);
        return;
      }
      
      // Convert canvas to blob
      extractCanvas.toBlob(async (blob) => {
        if (!blob) {
          setIsAnalyzingFrame(false);
          return;
        }
        
        try {
          // Convert blob to File
          const file = new File([blob], `frame-${roundedTime}.jpg`, { type: 'image/jpeg' });
          
          // Send to YOLO API
          const detectionResult = await detectImageYOLO(file);
          
          // Create FrameDetection object
          const frameDetection: FrameDetection = {
            frame_index: Math.round(timestamp * (stats.fps || 30)),
            timestamp_sec: timestamp,
            detections: detectionResult.detections,
          };
          
          // Store result
          setRealTimeYoloFrames(prev => {
            const newMap = new Map(prev);
            newMap.set(roundedTime, frameDetection);
            return newMap;
          });
        } catch (error) {
          console.error('Error analyzing frame:', error);
        } finally {
          setIsAnalyzingFrame(false);
        }
      }, 'image/jpeg', 0.9);
    } catch (error) {
      console.error('Error extracting frame:', error);
      setIsAnalyzingFrame(false);
    }
  }, [isAnalyzingFrame, realTimeYoloFrames, stats.fps]);

  // Real-time frame extraction loop
  useEffect(() => {
    if (!enableRealTimeYolo || !videoRef.current) return;
    
    const video = videoRef.current;
    const frameInterval = 1 / yoloFps; // Time between frames in seconds
    
    const extractFrameLoop = () => {
      if (!video || video.ended) {
        if (frameRequestIdRef.current) {
          cancelAnimationFrame(frameRequestIdRef.current);
          frameRequestIdRef.current = null;
        }
        return;
      }
      
      const currentTime = video.currentTime;
      const timeSinceLastExtraction = currentTime - lastExtractedTimeRef.current;
      
      // Extract frame if enough time has passed and video is playing
      if (!video.paused && timeSinceLastExtraction >= frameInterval) {
        extractAndAnalyzeFrame(currentTime);
        lastExtractedTimeRef.current = currentTime;
      }
      
      // Continue loop
      frameRequestIdRef.current = requestAnimationFrame(extractFrameLoop);
    };
    
    // Start loop when video can play
    const handleCanPlay = () => {
      if (frameRequestIdRef.current === null) {
        frameRequestIdRef.current = requestAnimationFrame(extractFrameLoop);
      }
    };
    
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('play', handleCanPlay);
    
    // Start immediately if video is already ready
    if (video.readyState >= 2) {
      handleCanPlay();
    }
    
    return () => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('play', handleCanPlay);
      if (frameRequestIdRef.current) {
        cancelAnimationFrame(frameRequestIdRef.current);
        frameRequestIdRef.current = null;
      }
    };
  }, [enableRealTimeYolo, yoloFps, extractAndAnalyzeFrame]);

  // Find the closest frame to current video time
  // Priority: real-time YOLO frames > pre-analyzed frames
  useEffect(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    let time = video.currentTime;
    
    // Handle video looping: if time exceeds video duration, wrap it
    const videoDuration = video.duration || stats.duration;
    if (videoDuration > 0 && time >= videoDuration) {
      time = time % videoDuration;
    }

    const getFrameTime = (frame: FrameDetection) => {
      if (frame.timestamp_sec !== null && frame.timestamp_sec !== undefined) {
        return frame.timestamp_sec;
      }
      // Fallback: calculate from frame index and fps
      return frame.frame_index / (stats.fps || 30);
    };
    
    // First, try to find real-time YOLO frame
    const roundedTime = Math.round(time * 10) / 10;
    let closestFrame: FrameDetection | null = null;
    
    if (realTimeYoloFrames.has(roundedTime)) {
      closestFrame = realTimeYoloFrames.get(roundedTime)!;
    } else {
      // Find closest real-time frame
      let closestTime = -1;
      let minDiff = Infinity;
      
      realTimeYoloFrames.forEach((frame, frameTime) => {
        const diff = Math.abs(frameTime - time);
        if (diff < minDiff) {
          minDiff = diff;
          closestTime = frameTime;
        }
      });
      
      if (closestTime >= 0 && minDiff < (1 / yoloFps)) {
        closestFrame = realTimeYoloFrames.get(closestTime)!;
      }
    }
    
    // Fallback to pre-analyzed frames if no real-time frame found
    if (!closestFrame && preAnalyzedYoloFrames.length > 0) {
      closestFrame = preAnalyzedYoloFrames[0];
      let minDiff = Math.abs(getFrameTime(closestFrame) - time);

      for (const frame of preAnalyzedYoloFrames) {
        const frameTime = getFrameTime(frame);
        const diff = Math.abs(frameTime - time);
        if (diff < minDiff) {
          minDiff = diff;
          closestFrame = frame;
        }
      }
    }

    if (closestFrame) {
      setCurrentFrame(closestFrame);
    }

    // Find corresponding pre-analyzed Gemini analysis (also handle looping)
    // NO API CALLS - just looking up results from the geminiAnalyses array
    if (geminiAnalyses.length > 0) {
      // Find the closest Gemini analysis
      let closestGemini: GeminiFrameAnalysis | null = null;
      let minGeminiDiff = Infinity;
      
      for (const g of geminiAnalyses) {
        const analysisTime = videoDuration > 0 ? (g.timestamp % videoDuration) : g.timestamp;
        const diff = Math.abs(analysisTime - time);
        if (diff < minGeminiDiff) {
          minGeminiDiff = diff;
          closestGemini = g;
        }
      }
      
      // Use a more lenient threshold (10 seconds) to find nearby analyses
      if (closestGemini !== null && minGeminiDiff < 10) {
        console.log(`📊 Found Gemini analysis for time ${time.toFixed(1)}s at ${closestGemini.timestamp.toFixed(1)}s (diff: ${minGeminiDiff.toFixed(2)}s)`);
        setCurrentGeminiAnalysis(closestGemini);
        if (closestGemini.analysis) {
          setPersistedGeminiAnalysis(closestGemini); // Keep the latest analysis visible
        }
      } else if (geminiAnalyses.length > 0) {
        const closestTimestamp = closestGemini !== null ? closestGemini.timestamp.toFixed(1) : 'N/A';
        console.log(`🔍 No close Gemini analysis found for time ${time.toFixed(1)}s. Closest: ${closestTimestamp}s (diff: ${minGeminiDiff.toFixed(2)}s). Total analyses: ${geminiAnalyses.length}`);
        
        // If we have analyses but none match, show the most recent one
        if (closestGemini !== null && !persistedGeminiAnalysis) {
          console.log(`📌 Showing closest available analysis (${closestGemini.timestamp.toFixed(1)}s) even though diff is ${minGeminiDiff.toFixed(2)}s`);
          setPersistedGeminiAnalysis(closestGemini);
        }
      }
    } else {
      console.log(`⚠️ No Gemini analyses available. Total: ${geminiAnalyses.length}`);
    }
    // Don't clear persistedGeminiAnalysis when no match - keep showing the last one
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, preAnalyzedYoloFrames, realTimeYoloFrames, geminiAnalyses, stats.fps, stats.duration, yoloFps]);

  // Draw bounding boxes on canvas - updates as video plays and loops
  useEffect(() => {
    if (!canvasRef.current || !videoRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const container = containerRef.current;

    const updateCanvas = () => {
      if (!canvas || !video || !container) return;

      // Wait for video to have dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        // Video not ready yet, try again after a short delay
        setTimeout(updateCanvas, 100);
        return;
      }

      // Get displayed video dimensions
      const displayedWidth = video.offsetWidth || video.videoWidth;
      const displayedHeight = video.offsetHeight || video.videoHeight;

      // Set canvas size to match displayed video
      canvas.width = displayedWidth;
      canvas.height = displayedHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // If no current frame, just clear and return
      if (!currentFrame) {
        return;
      }

      // Get detections for current frame (filter confidence > 50% and exclude masks/NO-Hardhat)
      const filteredDetections = currentFrame.detections.filter(
        (det) =>
          det.confidence > 0.5 &&
          !det.class_name.toLowerCase().includes('mask') &&
          det.class_name !== 'NO-Hardhat'
      );

      if (filteredDetections.length === 0) return;

      // Calculate scale factors based on video's natural dimensions
      const scaleX = displayedWidth / video.videoWidth;
      const scaleY = displayedHeight / video.videoHeight;

      // Draw bounding boxes
      filteredDetections.forEach((det) => {
        const [x1, y1, x2, y2] = det.bbox;

        // Scale coordinates to displayed size
        const scaledX1 = x1 * scaleX;
        const scaledY1 = y1 * scaleY;
        const scaledX2 = x2 * scaleX;
        const scaledY2 = y2 * scaleY;
        const width = scaledX2 - scaledX1;
        const height = scaledY2 - scaledY1;

        // Determine color based on class
        const color = getColorForClass(det.class_name);

        // Draw box
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(scaledX1, scaledY1, width, height);

        // Draw label background with better contrast
        const label = `${det.class_name} ${(det.confidence * 100).toFixed(1)}%`;
        ctx.font = 'bold 16px Arial';
        const textWidth = ctx.measureText(label).width;
        const textHeight = 22;
        const padding = 8;

        // Use semi-transparent dark background for better contrast
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(scaledX1, scaledY1 - textHeight, textWidth + padding * 2, textHeight);

        // Draw colored border on label background
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(scaledX1, scaledY1 - textHeight, textWidth + padding * 2, textHeight);

        // Draw label text in white for maximum contrast
        ctx.fillStyle = '#FFFFFF';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, scaledX1 + padding, scaledY1 - textHeight / 2);
      });
    };

    // Initial draw
    updateCanvas();

    // Redraw on window resize and video resize
    const handleResize = () => updateCanvas();
    const handleVideoResize = () => updateCanvas();
    
    window.addEventListener('resize', handleResize);
    video.addEventListener('loadedmetadata', handleVideoResize);
    video.addEventListener('resize', handleVideoResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      video.removeEventListener('loadedmetadata', handleVideoResize);
      video.removeEventListener('resize', handleVideoResize);
    };
  }, [currentFrame]);

  // Update current time as video plays
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handleSeeked = () => {
      setCurrentTime(video.currentTime);
    };

    const handleEnded = () => {
      // When video ends, reset to beginning (loop will handle it, but ensure state is updated)
      setCurrentTime(0);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('ended', handleEnded);
    
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('ended', handleEnded);
    };
  }, []);

  // Calculate stats for current frame
  // Priority: Use Deep Vision counts when available, fall back to YOLO counts
  const filteredDetections = currentFrame?.detections.filter(
    (det) =>
      det.confidence > 0.5 &&
      !det.class_name.toLowerCase().includes('mask') &&
      det.class_name !== 'NO-Hardhat'
  ) || [];

  // YOLO (Real Time Server) counts (fallback)
  const yoloPersonCount = filteredDetections.filter((d) => d.class_name === 'Person').length;
  const hardhatCount = filteredDetections.filter((d) => d.class_name === 'Hardhat').length;
  const vestCount = filteredDetections.filter((d) => d.class_name === 'Safety Vest').length;
  const yoloMissingHardhats = yoloPersonCount > 0 && hardhatCount < yoloPersonCount ? yoloPersonCount - hardhatCount : 0;
  const yoloMissingVests = yoloPersonCount > 0 && vestCount < yoloPersonCount ? yoloPersonCount - vestCount : 0;

  // Deep Vision (Gemini) counts (preferred when available)
  const geminiAnalysis = persistedGeminiAnalysis || currentGeminiAnalysis;
  const geminiMissingHardhats = geminiAnalysis?.analysis?.missingHardhats;
  const geminiMissingVests = geminiAnalysis?.analysis?.missingVests;

  const missingHardhats = Math.max(
    geminiMissingHardhats ?? yoloMissingHardhats,
    stats.maxMissingHardhats ?? 0
  );
  const missingVests = Math.max(
    geminiMissingVests ?? yoloMissingVests,
    stats.maxMissingVests ?? 0
  );

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Debug: Log video URL and state
  useEffect(() => {
    console.log('🎥 VideoPlayer - videoUrl:', videoUrl);
    console.log('🎥 VideoPlayer - videoRef.current:', videoRef.current);
    if (videoRef.current) {
      console.log('🎥 Video element state:', {
        src: videoRef.current.src,
        readyState: videoRef.current.readyState,
        networkState: videoRef.current.networkState,
        videoWidth: videoRef.current.videoWidth,
        videoHeight: videoRef.current.videoHeight,
        paused: videoRef.current.paused,
        currentTime: videoRef.current.currentTime,
        duration: videoRef.current.duration,
      });
    }
  }, [videoUrl]);

  return (
    <div className="video-player-container" ref={containerRef}>
      <div className="video-wrapper">
        <video
          ref={videoRef}
          src={videoUrl}
          crossOrigin="anonymous"
          controls
          loop
          autoPlay
          playsInline
          className="video-player"
          onLoadedMetadata={() => {
            console.log('✅ Video metadata loaded');
            if (videoRef.current) {
              console.log('📐 Video dimensions:', {
                videoWidth: videoRef.current.videoWidth,
                videoHeight: videoRef.current.videoHeight,
                offsetWidth: videoRef.current.offsetWidth,
                offsetHeight: videoRef.current.offsetHeight,
              });
            }
            // Trigger canvas update when video metadata loads
            if (canvasRef.current && videoRef.current) {
              const event = new Event('resize');
              window.dispatchEvent(event);
            }
          }}
          onCanPlay={() => {
            console.log('▶️ Video can play');
          }}
          onPlay={() => {
            console.log('▶️ Video started playing');
          }}
          onError={(e) => {
            console.error('❌ Video error:', e);
            const video = e.currentTarget;
            const error = video.error;
            console.error('❌ Video error details:', {
              error: error,
              errorCode: error?.code,
              errorMessage: error?.message,
              networkState: video.networkState,
              readyState: video.readyState,
              src: video.src,
              currentSrc: video.currentSrc,
            });
            
            // Error code meanings:
            // 1 = MEDIA_ERR_ABORTED - fetching aborted
            // 2 = MEDIA_ERR_NETWORK - network error
            // 3 = MEDIA_ERR_DECODE - decoding error
            // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED - format not supported
            if (error) {
              const errorMessages: { [key: number]: string } = {
                1: 'Video loading was aborted',
                2: 'Network error while loading video',
                3: 'Video decoding error (format may not be supported)',
                4: 'Video format not supported by browser',
              };
              console.error(`❌ ${errorMessages[error.code] || 'Unknown error'}`);
            }
          }}
          onLoadStart={() => {
            console.log('🔄 Video load started:', videoUrl);
          }}
          onProgress={() => {
            if (videoRef.current) {
              const buffered = videoRef.current.buffered;
              if (buffered.length > 0) {
                console.log(`📊 Video buffered: ${((buffered.end(0) / videoRef.current.duration) * 100).toFixed(1)}%`);
              }
            }
          }}
          onSeeked={() => {
            // Update when user seeks
            if (videoRef.current) {
              setCurrentTime(videoRef.current.currentTime);
            }
          }}
        />
        <canvas ref={canvasRef} className="video-overlay-canvas" />
        
        {/* Analysis Results Overlay at bottom */}
        <div className="video-analysis-overlay">
          <div className="overlay-stats">
            {!geminiAnalysis?.analysis && (
            <>
            <div className="overlay-stat-item">
              <span className="overlay-stat-label">Missing Hardhats:</span>
              <span className="overlay-stat-value danger">{missingHardhats}</span>
            </div>
            <div className="overlay-stat-item">
              <span className="overlay-stat-label">Missing Vests:</span>
              <span className="overlay-stat-value danger">{missingVests}</span>
            </div>
            </>
            )}
            <div className="overlay-stat-item">
              <span className="overlay-stat-label">Time:</span>
              <span className="overlay-stat-value">{formatTime(currentTime)}</span>
            </div>
          </div>
          
          {(() => {
            const displayAnalysis = persistedGeminiAnalysis || currentGeminiAnalysis;
            if (displayAnalysis && displayAnalysis.analysis) {
              return (
                <div className="overlay-gemini-analysis">
                  <div className="overlay-gemini-header">
                    <span className="overlay-gemini-time">
                      🤖 AI Analysis @ {formatTime(displayAnalysis.timestamp)}
                      {persistedGeminiAnalysis && !currentGeminiAnalysis && ' (Latest)'}
                    </span>
                    <span className={`overlay-risk-badge risk-${displayAnalysis.analysis.overallRiskLevel.toLowerCase()}`}>
                      {displayAnalysis.analysis.overallRiskLevel}
                    </span>
                  </div>
                  <p className="overlay-gemini-description">{displayAnalysis.analysis.overallDescription}</p>
                  <GeminiPpeNarrative
                    compact
                    missingHardhats={displayAnalysis.analysis.missingHardhats}
                    missingVests={displayAnalysis.analysis.missingVests}
                  />
                  {displayAnalysis.analysis.constructionSafety.issues.length > 0 && (
                    <div className="overlay-gemini-issues">
                      <strong>Issues:</strong>
                      <ul>
                        {displayAnalysis.analysis.constructionSafety.issues.slice(0, 3).map((issue: string, i: number) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            } else if (geminiAnalyses.length > 0) {
              return (
                <div className="overlay-gemini-analysis" style={{ opacity: 0.7, padding: '10px' }}>
                  <p>⏳ Waiting for Gemini analysis at current time...</p>
                  <p style={{ fontSize: '12px', marginTop: '5px' }}>
                    Available analyses: {geminiAnalyses.length} | Current time: {formatTime(currentTime)}
                  </p>
                  {displayAnalysis && !displayAnalysis.analysis && (
                    <p style={{ fontSize: '11px', marginTop: '5px', color: '#ff6b6b' }}>
                      ⚠️ Analysis at {formatTime(displayAnalysis.timestamp)} has no data (error: {displayAnalysis.error || 'unknown'})
                    </p>
                  )}
                </div>
              );
            }
            return null;
          })()}
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
