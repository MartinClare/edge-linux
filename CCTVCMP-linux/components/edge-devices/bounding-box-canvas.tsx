"use client";

/**
 * BoundingBoxCanvas — renders an evidence image with coloured bounding-box
 * overlays for every detection returned by the edge's VLM analysis.
 *
 * VLM bbox format: [x_min, y_min, x_max, y_max] normalised 0–1000,
 * where (0,0) is the top-left corner of the image. This is standard COCO/xy
 * order as natively produced by Qwen-VL and other vision models.
 *
 * The canvas uses object-fit:contain letterbox correction so boxes align
 * with the visible content area regardless of image aspect ratio.
 *
 * Colour scheme:
 *  • Red   — PPE violations, fallen person
 *  • Orange — fire/smoke, machinery proximity
 *  • Amber  — height risk, smoking
 *  • Cyan  — person with full PPE compliance (filtered out by default)
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type Detection = {
  label: string;
  /** [x_min, y_min, x_max, y_max] normalised 0–1000, (0,0) = top-left */
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
  // safety_hazard intentionally excluded — general warnings never get a bbox
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

const ALWAYS_RENDER_LABELS = new Set([
  "no_hardhat",
  "no_vest",
  "no_hardhat_no_vest",
  "fire_smoke",
  "smoking",
  "machine_proximity",
  "working_at_height",
  "person_fallen",
]);

function tightenBoxForDisplay(det: Detection, bbox: [number, number, number, number]): [number, number, number, number] {
  let [xMin, yMin, xMax, yMax] = bbox;

  // VLM person/PPE boxes are often slightly loose and include surrounding
  // context. Tighten them for display so the overlay sits more cleanly on the worker.
  if (PERSON_LABELS.has(det.label)) {
    const w = xMax - xMin;
    const h = yMax - yMin;
    xMin += w * 0.08;
    xMax -= w * 0.08;
    yMin += h * 0.12;
    yMax -= h * 0.04;
  }

  return [xMin, yMin, xMax, yMax];
}

function normalizeBBox(det: Detection): [number, number, number, number] {
  let [xMin, yMin, xMax, yMax] = det.bbox;

  // Auto-detect if the model returned 0–1 instead of 0–1000 and scale up.
  const maxVal = Math.max(xMin, yMin, xMax, yMax);
  const scale = maxVal <= 1.5 ? 1000 : 1;
  xMin *= scale; yMin *= scale; xMax *= scale; yMax *= scale;

  const clamp = (v: number) => Math.max(0, Math.min(1000, v));
  [xMin, yMin, xMax, yMax] = [clamp(xMin), clamp(yMin), clamp(xMax), clamp(yMax)];

  return tightenBoxForDisplay(det, [xMin, yMin, xMax, yMax]);
}

function shouldRenderDetection(det: Detection): boolean {
  // Never draw a bbox for person_ok (no violation) or safety_hazard (general warning).
  if (NON_VIOLATION_LABELS.has(det.label)) return false;
  if (det.label === "safety_hazard") return false;
  return ALWAYS_RENDER_LABELS.has(det.label);
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
    const [xMin, yMin, xMax, yMax] = normalizeBBox(det);

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

  }
}

type Props = {
  imageUrl: string;
  detections: Detection[];
  /** Extra CSS classes for the outer wrapper */
  className?: string;
  showLegend?: boolean;
  /** Optional max-height applied directly to the image (e.g. "480px") */
  maxHeight?: string;
};

export function BoundingBoxCanvas({ imageUrl, detections, className = "", showLegend = true, maxHeight }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const visibleDetections = detections.filter((det) => shouldRenderDetection(det));

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
      <div className="relative block w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Evidence"
          className="block w-full rounded border"
          style={{ objectFit: "contain", maxHeight: maxHeight ?? "none", display: "block" }}
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
      {showLegend && visibleDetections.length > 0 && (
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
