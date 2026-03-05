import React, { useRef, useEffect } from 'react';
import type { Detection } from '../types/detection.types';

const getColorForClass = (className: string): string => {
  if (className.includes('NO-')) return '#FF0000'; // Red for violations
  if (className === 'Person') return '#FFFF00'; // Yellow for persons
  if (className === 'machinery' || className === 'vehicle') return '#FFA500'; // Orange for machinery/vehicles
  return '#00FF00'; // Green for PPE items
};

interface MonitoringDashboardProps {
  imageUrl: string | null;
  detections: Detection[];
  stats?: {
    totalDetections: number;
    ppeCompliant: number;
    violations: number;
    personCount: number;
    hardhatCount?: number;
    vestCount?: number;
    missingHardhats?: number;
    missingVests?: number;
  };
}

const MonitoringDashboard: React.FC<MonitoringDashboardProps> = ({
  imageUrl,
  detections,
  stats,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter detections with confidence > 50%
  const filteredDetections = detections.filter(det => det.confidence > 0.5);

  useEffect(() => {
    if (!imageUrl || !canvasRef.current || !imageRef.current || !containerRef.current) return;

    const img = imageRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;

    const updateCanvas = () => {
      if (!canvas || !img || !container) return;

      // Get displayed image dimensions
      const displayedWidth = img.offsetWidth || img.width;
      const displayedHeight = img.offsetHeight || img.height;

      // Set canvas size to match displayed image
      canvas.width = displayedWidth;
      canvas.height = displayedHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Calculate scale factors
      const scaleX = displayedWidth / img.naturalWidth;
      const scaleY = displayedHeight / img.naturalHeight;

      // Draw bounding boxes (only for detections with confidence > 50%)
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

    // Draw when image loads
    if (img.complete) {
      updateCanvas();
    } else {
      img.onload = updateCanvas;
    }

    // Redraw on window resize
    window.addEventListener('resize', updateCanvas);
    return () => window.removeEventListener('resize', updateCanvas);
  }, [imageUrl, filteredDetections]);

  return (
    <div className="monitoring-dashboard">
      <div className="canvas-container" ref={containerRef}>
        {imageUrl && (
          <div className="image-wrapper">
            <img
              ref={imageRef}
              src={imageUrl}
              alt="Source"
              className="source-image"
              onLoad={() => {
                // Trigger redraw when image loads
                if (canvasRef.current && imageRef.current) {
                  const event = new Event('resize');
                  window.dispatchEvent(event);
                }
              }}
            />
            <canvas ref={canvasRef} className="detection-canvas" />
          </div>
        )}
        {!imageUrl && (
          <div className="placeholder">
            <p>📷 No image loaded</p>
            <p>Upload an image or connect to a stream to start monitoring</p>
          </div>
        )}
      </div>

      {stats && (
        <div className="stats-panel">
          <div className="stat-card">
            <h4>Persons Detected</h4>
            <p className="stat-value">{stats.personCount}</p>
          </div>
          <div className="stat-card">
            <h4>Missing Hardhats</h4>
            <p className="stat-value danger">{stats.missingHardhats !== undefined ? stats.missingHardhats : (stats.personCount > 0 && stats.hardhatCount !== undefined ? Math.max(0, stats.personCount - stats.hardhatCount) : 0)}</p>
          </div>
          <div className="stat-card">
            <h4>Missing Safety Vests</h4>
            <p className="stat-value danger">{stats.missingVests !== undefined ? stats.missingVests : (stats.personCount > 0 && stats.vestCount !== undefined ? Math.max(0, stats.personCount - stats.vestCount) : 0)}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitoringDashboard;
