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
  person_ok:          "#06b6d4",
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
  person_ok:          "Worker",
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

const PERSON_LABELS = new Set([
  "person_ok",
  "no_hardhat",
  "no_vest",
  "no_hardhat_no_vest",
]);

const NON_VIOLATION_LABELS = new Set([
  "person_ok",
]);

function tightenBoxForDisplay(det: Detection, bbox: [number, number, number, number]): [number, number, number, number] {
  let [yMin, xMin, yMax, xMax] = bbox;

  // Gemini's person/PPE boxes are often slightly loose and include surrounding
  // context. Tighten them for display so the overlay sits more cleanly on the worker.
  if (PERSON_LABELS.has(det.label)) {
    const h = yMax - yMin;
    const w = xMax - xMin;
    xMin += w * 0.08;
    xMax -= w * 0.08;
    yMin += h * 0.12;
    yMax -= h * 0.04;
  }

  return [yMin, xMin, yMax, xMax];
}

function normalizeBBox(det: Detection): [number, number, number, number] {
  let [yMin, xMin, yMax, xMax] = det.bbox;

  // Auto-detect if the model returned 0–1 instead of 0–1000 and scale up.
  const maxVal = Math.max(yMin, xMin, yMax, xMax);
  const scale = maxVal <= 1.5 ? 1000 : 1;
  yMin *= scale; xMin *= scale; yMax *= scale; xMax *= scale;

  const clamp = (v: number) => Math.max(0, Math.min(1000, v));
  [yMin, xMin, yMax, xMax] = [clamp(yMin), clamp(xMin), clamp(yMax), clamp(xMax)];

  return tightenBoxForDisplay(det, [yMin, xMin, yMax, xMax]);
}

function shouldRenderDetection(det: Detection, bbox: [number, number, number, number]): boolean {
  if (NON_VIOLATION_LABELS.has(det.label)) return false;
  return true;
}

function drawBoxes(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  detections: Detection[]
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Match canvas pixel size to the displayed image element dimensions
  const W = img.offsetWidth;
  const H = img.offsetHeight;
  canvas.width = W;
  canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  if (!W || !H) return;

  // ── object-contain letterbox correction ───────────────────────────────────
  // When CSS object-fit:contain is used, the rendered image content may not
  // fill the full element — blank bars appear on the sides or top/bottom.
  // Bbox coords (0-1000) refer to the actual image content, so we must find
  // the content rect inside the element before mapping coordinates.
  const nw = img.naturalWidth  || W;
  const nh = img.naturalHeight || H;
  const naturalAspect = nw / nh;
  const elementAspect = W / H;

  let contentW: number, contentH: number, offsetX: number, offsetY: number;
  if (Math.abs(naturalAspect - elementAspect) < 0.01) {
    // Near-perfect fit — no bars
    contentW = W; contentH = H; offsetX = 0; offsetY = 0;
  } else if (naturalAspect > elementAspect) {
    // Image wider than element → bars on top & bottom
    contentW = W;
    contentH = W / naturalAspect;
    offsetX = 0;
    offsetY = (H - contentH) / 2;
  } else {
    // Image taller than element → bars on left & right
    contentH = H;
    contentW = H * naturalAspect;
    offsetX = (W - contentW) / 2;
    offsetY = 0;
  }

  // ─────────────────────────────────────────────────────────────────────────

  for (const det of detections) {
    const [yMin, xMin, yMax, xMax] = normalizeBBox(det);

    // Map 0-1000 normalised coords into the content area
    const x1 = offsetX + (xMin / 1000) * contentW;
    const y1 = offsetY + (yMin / 1000) * contentH;
    const x2 = offsetX + (xMax / 1000) * contentW;
    const y2 = offsetY + (yMax / 1000) * contentH;
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
  const visibleDetections = detections.filter((det) => shouldRenderDetection(det, normalizeBBox(det)));

  const redraw = useCallback(() => {
    if (!canvasRef.current || !imgRef.current || !imgLoaded) return;
    drawBoxes(canvasRef.current, imgRef.current, visibleDetections);
  }, [visibleDetections, imgLoaded]);

  // Redraw whenever detections or image change; brief rAF delay so the browser
  // has committed layout (offsetWidth/Height) before we sample dimensions.
  useEffect(() => {
    const id = requestAnimationFrame(() => redraw());
    return () => cancelAnimationFrame(id);
  }, [redraw]);

  // Use ResizeObserver on the <img> element — catches container resizes too,
  // not just window resize events.
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => requestAnimationFrame(() => redraw()));
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  return (
    <div className={`w-full ${className}`}>
      <div className="relative inline-block w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Evidence"
          className="block w-full rounded border"
          style={{ objectFit: "contain" }}
          onLoad={() => setImgLoaded(true)}
        />
        {/* Canvas must be positioned against the image-only wrapper.
            If it spans the legend too, the browser stretches the canvas
            vertically and the boxes drift away from the object. */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{ top: 0, left: 0 }}
        />
      </div>
      {visibleDetections.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {Array.from(new Set(visibleDetections.map((d) => d.label))).map((label) => (
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
