"use client";

/**
 * BoundingBoxCanvas — renders an evidence image with coloured bounding-box
 * overlays for every detection returned by the edge's Gemini analysis.
 *
 * Gemini bbox format: [y_min, x_min, y_max, x_max] normalised 0–1000.
 * The canvas is sized to the displayed image and redrawn on window resize.
 *
 * Colour scheme mirrors the PPE-UI MonitoringDashboard:
 *  • Red   — PPE violations, fallen person, safety hazard
 *  • Orange — fire/smoke, machinery proximity
 *  • Amber  — height risk, smoking
 *  • Green  — person with full PPE compliance
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type Detection = {
  label: string;
  /** [y_min, x_min, y_max, x_max] normalised 0–1000 */
  bbox: [number, number, number, number];
  description?: string;
};

const BOX_COLORS: Record<string, string> = {
  person_ok:          "#22c55e",
  no_hardhat:         "#ef4444",
  no_vest:            "#f97316",
  no_hardhat_no_vest: "#dc2626",
  fire_smoke:         "#f97316",
  smoking:            "#eab308",
  machine_proximity:  "#f97316",
  working_at_height:  "#eab308",
  person_fallen:      "#dc2626",
  safety_hazard:      "#ef4444",
};

const LABEL_TEXT: Record<string, string> = {
  person_ok:          "✓ PPE OK",
  no_hardhat:         "⛑ No Hardhat",
  no_vest:            "🦺 No Vest",
  no_hardhat_no_vest: "⚠ No PPE",
  fire_smoke:         "🔥 Fire/Smoke",
  smoking:            "🚬 Smoking",
  machine_proximity:  "⚙ Machinery",
  working_at_height:  "⬆ Height Risk",
  person_fallen:      "🚨 FALLEN",
  safety_hazard:      "⚠ Hazard",
};

function drawBoxes(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  detections: Detection[]
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Match canvas pixel size to the displayed image dimensions
  const W = img.offsetWidth;
  const H = img.offsetHeight;
  canvas.width = W;
  canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  if (!W || !H) return;

  for (const det of detections) {
    const [yMin, xMin, yMax, xMax] = det.bbox;

    // Convert 0-1000 normalised coords to displayed pixel coords
    const x1 = (xMin / 1000) * W;
    const y1 = (yMin / 1000) * H;
    const x2 = (xMax / 1000) * W;
    const y2 = (yMax / 1000) * H;
    const bw = x2 - x1;
    const bh = y2 - y1;

    const color = BOX_COLORS[det.label] ?? "#a855f7";
    const label = LABEL_TEXT[det.label] ?? det.label;

    // Bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x1, y1, bw, bh);

    // Semi-transparent fill to highlight the region
    ctx.fillStyle = color + "1A"; // 10% opacity
    ctx.fillRect(x1, y1, bw, bh);

    // Label background
    ctx.font = "bold 12px system-ui, sans-serif";
    const textW = ctx.measureText(label).width;
    const labelH = 18;
    const pad = 5;
    const labelY = y1 > labelH + 2 ? y1 - labelH : y1 + 2;

    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(x1, labelY, textW + pad * 2, labelH);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x1, labelY, textW + pad * 2, labelH);

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x1 + pad, labelY + labelH / 2);

    // Optional description tooltip below the box
    if (det.description) {
      ctx.font = "11px system-ui, sans-serif";
      const descW = ctx.measureText(det.description).width;
      const descY = y2 + 2;
      if (descY + 16 < H) {
        ctx.fillStyle = "rgba(0,0,0,0.60)";
        ctx.fillRect(x1, descY, Math.min(descW + pad * 2, W - x1), 15);
        ctx.fillStyle = "#e5e7eb";
        ctx.textBaseline = "middle";
        ctx.fillText(
          det.description.length > 60 ? det.description.slice(0, 57) + "…" : det.description,
          x1 + pad,
          descY + 7.5
        );
      }
    }
  }
}

type Props = {
  imageUrl: string;
  detections: Detection[];
  /** Extra CSS classes for the outer wrapper */
  className?: string;
};

export function BoundingBoxCanvas({ imageUrl, detections, className = "" }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  const redraw = useCallback(() => {
    if (!canvasRef.current || !imgRef.current || !imgLoaded) return;
    drawBoxes(canvasRef.current, imgRef.current, detections);
  }, [detections, imgLoaded]);

  // Redraw whenever detections or image change
  useEffect(() => {
    redraw();
  }, [redraw]);

  // Redraw on window resize (image display size changes)
  useEffect(() => {
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [redraw]);

  return (
    <div className={`relative inline-block w-full ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Evidence"
        className="block w-full rounded border object-contain"
        onLoad={() => setImgLoaded(true)}
      />
      {/* Canvas sits directly on top of the image, pointer-events:none so the
          image can still be clicked/opened */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ top: 0, left: 0 }}
      />
      {/* Legend */}
      {detections.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {Array.from(new Set(detections.map((d) => d.label))).map((label) => (
            <span
              key={label}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: (BOX_COLORS[label] ?? "#a855f7") + "cc" }}
            >
              {LABEL_TEXT[label] ?? label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
