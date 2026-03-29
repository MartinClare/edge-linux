import React, { useState, useRef, useEffect } from 'react';
import { listVideos, type VideoFile } from '../services/videoFolderApi';
import { YOLO_API_URL } from '../config/api';

interface VideoUploadProps {
  onVideoSelect: (file: File | null, filePath?: string) => void;
  onAnalyze: (sampleEvery: number, geminiInterval: number, filePath?: string) => void;
  isAnalyzing: boolean;
}

const VideoUpload: React.FC<VideoUploadProps> = ({
  onVideoSelect,
  onAnalyze,
  isAnalyzing,
}) => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [sampleEvery] = useState(5);
  const [geminiInterval, setGeminiInterval] = useState(10);
  const [availableVideos, setAvailableVideos] = useState<VideoFile[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [useFolder, setUseFolder] = useState(true); // Default to folder mode
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Load available videos from folder
  useEffect(() => {
    if (useFolder) {
      loadVideos();
    }
  }, [useFolder]);

  const loadVideos = async () => {
    setLoadingVideos(true);
    try {
      const response = await listVideos();
      if (response.videos) {
        setAvailableVideos(response.videos);
      }
    } catch (error) {
      console.error('Failed to load videos:', error);
      // If folder doesn't exist or error, fall back to upload mode
      setUseFolder(false);
    } finally {
      setLoadingVideos(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('video/')) {
      alert('Please select a video file');
      return;
    }

    // Create video URL
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setVideoFile(file);
    setSelectedFilePath(null);
    onVideoSelect(file);
  };

  const handleVideoSelect = (video: VideoFile) => {
    setSelectedFilePath(video.path);
    setVideoFile(null);
    // Create HTTP URL to serve video from Python backend
    const videoHttpUrl = `${YOLO_API_URL}/videos/${encodeURIComponent(video.filename)}`;
    setVideoUrl(videoHttpUrl);
    onVideoSelect(null, video.path);
  };

  const handleAnalyze = () => {
    if (!videoFile && !selectedFilePath) return;
    onAnalyze(sampleEvery, geminiInterval, selectedFilePath || undefined);
  };

  return (
    <div className="video-upload">
      <div className="video-source-toggle">
        <button
          className={useFolder ? 'active' : ''}
          onClick={() => setUseFolder(true)}
          disabled={isAnalyzing}
        >
          📁 From Folder
        </button>
        <button
          className={!useFolder ? 'active' : ''}
          onClick={() => setUseFolder(false)}
          disabled={isAnalyzing}
        >
          📤 Upload File
        </button>
      </div>

      {useFolder ? (
        <div className="video-list-container">
          <div className="video-list-header">
            <h4>Available Videos:</h4>
            <button
              className="refresh-button"
              onClick={loadVideos}
              disabled={loadingVideos || isAnalyzing}
              title="Refresh video list"
            >
              {loadingVideos ? '⏳ Refreshing...' : '🔄 Refresh'}
            </button>
          </div>
          {loadingVideos ? (
            <p>Loading videos...</p>
          ) : availableVideos.length > 0 ? (
            <div className="video-list">
              {availableVideos.map((video) => (
                <div
                  key={video.path}
                  className={`video-item ${selectedFilePath === video.path ? 'selected' : ''}`}
                  onClick={() => handleVideoSelect(video)}
                >
                  <span className="video-name">🎥 {video.filename}</span>
                  <span className="video-size">{video.size_mb} MB</span>
                </div>
              ))}
            </div>
          ) : (
            <p>No videos found in folder. Switch to upload mode or add videos to the folder.</p>
          )}
        </div>
      ) : (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          
          <button
            className="select-file-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isAnalyzing}
          >
            🎥 Select Video File
          </button>
        </>
      )}

      {(videoUrl || selectedFilePath) && (
        <div className="video-preview-container">
          {videoUrl && (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="video-preview"
            />
          )}
          {selectedFilePath && !videoUrl && (
            <div className="video-info">
              <p>📹 {selectedFilePath.split(/[/\\]/).pop()}</p>
              <p className="video-note">Video will be processed from server folder (no upload needed)</p>
            </div>
          )}

          <div className="video-config">
            <div className="config-group">
              <label>
                Deep Vision Verification Interval (seconds):
                <input
                  type="number"
                  min="5"
                  max="60"
                  value={geminiInterval}
                  onChange={(e) => setGeminiInterval(Number(e.target.value))}
                  disabled={isAnalyzing}
                />
              </label>
              <span className="config-help">How often to verify with AI analysis</span>
            </div>
          </div>

          <button
            className="analyze-btn"
            onClick={handleAnalyze}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? '⏳ Analyzing Video...' : '🔍 Analyze Video'}
          </button>
        </div>
      )}
    </div>
  );
};

export default VideoUpload;
