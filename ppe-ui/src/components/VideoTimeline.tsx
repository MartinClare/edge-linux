import React, { useState } from 'react';
import type { FrameDetection, GeminiFrameAnalysis } from '../types/detection.types';

interface VideoTimelineProps {
  yoloFrames: FrameDetection[];
  geminiAnalyses: GeminiFrameAnalysis[];
  duration: number;
  onFrameSelect: (frame: FrameDetection) => void;
}

const VideoTimeline: React.FC<VideoTimelineProps> = ({
  yoloFrames,
  geminiAnalyses,
  duration,
  onFrameSelect,
}) => {
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);

  const handleFrameClick = (frame: FrameDetection) => {
    setSelectedFrame(frame.frame_index);
    onFrameSelect(frame);
  };

  const getFrameColor = (frame: FrameDetection): string => {
    const violations = frame.detections.filter(d => d.class_name.includes('NO-')).length;
    if (violations > 0) return '#e94560'; // Red for violations
    if (frame.detections.length > 0) return '#4caf50'; // Green for detections
    return '#888'; // Gray for no detections
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="video-timeline">
      <h4>Detection Timeline</h4>
      
      <div className="timeline-legend">
        <span><span className="legend-color" style={{ background: '#4caf50' }}></span> Detections</span>
        <span><span className="legend-color" style={{ background: '#e94560' }}></span> Violations</span>
        <span><span className="legend-color" style={{ background: '#667eea' }}></span> AI Verified</span>
      </div>

      <div className="timeline-container">
        <div className="timeline-track">
          {yoloFrames.map((frame, index) => {
            const isGeminiFrame = geminiAnalyses.some(g => g.frame_number === frame.frame_index);
            const isSelected = selectedFrame === frame.frame_index;
            
            return (
              <div
                key={frame.frame_index}
                className={`timeline-marker ${isSelected ? 'selected' : ''}`}
                style={{
                  left: `${((frame.timestamp_sec || 0) / duration) * 100}%`,
                  background: getFrameColor(frame),
                  border: isGeminiFrame ? '3px solid #667eea' : 'none',
                }}
                onClick={() => handleFrameClick(frame)}
                title={`Frame ${frame.frame_index} - ${formatTime(frame.timestamp_sec || 0)} - ${frame.detections.length} detections`}
              />
            );
          })}
        </div>
        
        <div className="timeline-labels">
          <span>0:00</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {selectedFrame !== null && (
        <div className="frame-details">
          {(() => {
            const frame = yoloFrames.find(f => f.frame_index === selectedFrame);
            const geminiAnalysis = geminiAnalyses.find(g => g.frame_number === selectedFrame);
            
            if (!frame) return null;
            
            return (
              <div>
                <h5>Frame {frame.frame_index} - {formatTime(frame.timestamp_sec || 0)}</h5>
                <p><strong>Detections:</strong> {frame.detections.length}</p>
                <ul className="detection-list">
                  {frame.detections.map((det, i) => (
                    <li key={i} className={det.class_name.includes('NO-') ? 'violation' : ''}>
                      {det.class_name} ({(det.confidence * 100).toFixed(1)}%)
                    </li>
                  ))}
                </ul>
                
                {geminiAnalysis && geminiAnalysis.analysis && (
                  <div className="gemini-frame-analysis">
                    <h5>🤖 AI Verification</h5>
                    <p className={`risk-${geminiAnalysis.analysis.overallRiskLevel.toLowerCase()}`}>
                      Risk: {geminiAnalysis.analysis.overallRiskLevel}
                    </p>
                    <p>{geminiAnalysis.analysis.overallDescription}</p>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default VideoTimeline;
