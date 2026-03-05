import type { Detection } from '../types/detection.types';

export const drawBoundingBoxes = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  detections: Detection[]
) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Set canvas size to match image
  canvas.width = image.width;
  canvas.height = image.height;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw image
  ctx.drawImage(image, 0, 0);

  // Draw bounding boxes
  detections.forEach((det) => {
    const [x1, y1, x2, y2] = det.bbox;
    const width = x2 - x1;
    const height = y2 - y1;

    // Determine color based on class
    const color = getColorForClass(det.class_name);

    // Draw box
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, width, height);

    // Draw label background
    const label = `${det.class_name} ${(det.confidence * 100).toFixed(1)}%`;
    ctx.font = 'bold 16px Arial';
    const textWidth = ctx.measureText(label).width;
    const textHeight = 20;
    
    ctx.fillStyle = color;
    ctx.fillRect(x1, y1 - textHeight, textWidth + 10, textHeight);

    // Draw label text
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, x1 + 5, y1 - 5);
  });
};

export const getColorForClass = (className: string): string => {
  if (className.includes('NO-')) return '#FF0000'; // Red for violations
  if (className === 'Person') return '#FFFF00'; // Yellow for persons
  if (className === 'machinery' || className === 'vehicle') return '#FFA500'; // Orange for machinery/vehicles
  return '#00FF00'; // Green for PPE items
};
