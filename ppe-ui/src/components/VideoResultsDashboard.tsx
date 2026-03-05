import React from 'react';
import VideoTimeline from './VideoTimeline';
import type { VideoAnalysisResult, FrameDetection } from '../types/detection.types';

interface VideoResultsDashboardProps {
  result: VideoAnalysisResult;
  onFrameSelect: (frame: FrameDetection) => void;
}

const VideoResultsDashboard: React.FC<VideoResultsDashboardProps> = ({
  result,
  onFrameSelect,
}) => {
  const { stats, yoloFrames, geminiAnalyses } = result;

  return (
    <div className="video-results-dashboard">
      <h3>📊 Video Analysis Results</h3>

      <div className="video-stats-grid">
        <div className="stat-card">
          <h4>Duration</h4>
          <p className="stat-value">{stats.duration.toFixed(1)}s</p>
        </div>
        <div className="stat-card">
          <h4>Total Frames</h4>
          <p className="stat-value">{stats.totalFrames}</p>
        </div>
        <div className="stat-card">
          <h4>Analyzed Frames</h4>
          <p className="stat-value">{stats.sampledFrames}</p>
        </div>
        <div className="stat-card">
          <h4>AI Verifications</h4>
          <p className="stat-value">{stats.analyzedFrames}</p>
        </div>
        <div className="stat-card">
          <h4>Total Detections</h4>
          <p className="stat-value">{stats.totalDetections}</p>
        </div>
        <div className="stat-card">
          <h4>Violations</h4>
          <p className="stat-value danger">{stats.violations}</p>
        </div>
      </div>

      <div className="detected-classes">
        <h4>Detected Objects</h4>
        <div className="class-tags">
          {stats.uniqueClasses.map((className, i) => (
            <span
              key={i}
              className={`class-tag ${className.includes('NO-') ? 'violation-tag' : ''}`}
            >
              {className}
            </span>
          ))}
        </div>
      </div>

      <VideoTimeline
        yoloFrames={yoloFrames}
        geminiAnalyses={geminiAnalyses}
        duration={stats.duration}
        onFrameSelect={onFrameSelect}
      />

      <div className="gemini-insights">
        <h4>🤖 AI Safety Insights</h4>
        {geminiAnalyses.map((analysis, i) => (
          <div key={i} className="insight-card">
            <div className="insight-header">
              <span className="insight-time">
                {Math.floor(analysis.timestamp / 60)}:{Math.floor(analysis.timestamp % 60).toString().padStart(2, '0')}
              </span>
              {analysis.analysis && (
                <span className={`risk-badge risk-${analysis.analysis.overallRiskLevel.toLowerCase()}`}>
                  {analysis.analysis.overallRiskLevel}
                </span>
              )}
            </div>
            {analysis.analysis ? (
              <>
                <p>{analysis.analysis.overallDescription}</p>
                {analysis.analysis.constructionSafety.issues.length > 0 && (
                  <div className="issues-list">
                    <strong>Issues:</strong>
                    <ul>
                      {analysis.analysis.constructionSafety.issues.map((issue, j) => (
                        <li key={j}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="error-text">Analysis failed: {analysis.error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default VideoResultsDashboard;
