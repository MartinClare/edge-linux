import React, { useState } from 'react';

interface RTSPStreamProps {
  onConnect: (url: string, maxFrames: number, sampleEvery: number) => void;
  isConnecting: boolean;
}

const RTSPStream: React.FC<RTSPStreamProps> = ({ onConnect, isConnecting }) => {
  const [rtspUrl, setRtspUrl] = useState('');
  const [maxFrames, setMaxFrames] = useState(100);
  const [sampleEvery, setSampleEvery] = useState(5);

  const handleConnect = () => {
    if (!rtspUrl) {
      alert('Please enter an RTSP URL');
      return;
    }
    onConnect(rtspUrl, maxFrames, sampleEvery);
  };

  return (
    <div className="rtsp-stream">
      <h4>RTSP Stream Configuration</h4>
      
      <div className="form-group">
        <label>RTSP URL:</label>
        <input
          type="text"
          placeholder="rtsp://admin:123456@192.168.1.3:554/Streaming/Channels/1"
          value={rtspUrl}
          onChange={(e) => setRtspUrl(e.target.value)}
          disabled={isConnecting}
          title={rtspUrl || 'Use full path, e.g. /Streaming/Channels/1'}
          style={{ minWidth: '320px', boxSizing: 'border-box' }}
        />
        <small style={{ color: '#888', display: 'block', marginTop: 4 }}>
          Use the full path (e.g. /Streaming/Channels/1). Connection times out after 15s if the URL is wrong.
        </small>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Max Frames:</label>
          <input
            type="number"
            value={maxFrames}
            onChange={(e) => setMaxFrames(Number(e.target.value))}
            min="1"
            max="1000"
            disabled={isConnecting}
          />
        </div>

        <div className="form-group">
          <label>Sample Every N Frames:</label>
          <input
            type="number"
            value={sampleEvery}
            onChange={(e) => setSampleEvery(Number(e.target.value))}
            min="1"
            max="30"
            disabled={isConnecting}
          />
        </div>
      </div>

      <button
        className="connect-btn"
        onClick={handleConnect}
        disabled={isConnecting || !rtspUrl}
      >
        {isConnecting ? '⏳ Connecting...' : '📡 Connect to Stream'}
      </button>

      <div className="rtsp-help">
        <p>Example RTSP URLs:</p>
        <code>rtsp://admin:password@192.168.1.100:554/stream1</code>
        <code>rtsp://camera.example.com:554/live/ch1</code>
      </div>
    </div>
  );
};

export default RTSPStream;
