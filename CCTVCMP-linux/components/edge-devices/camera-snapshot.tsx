"use client";

import { useState, useEffect } from "react";

interface CameraSnapshotProps {
  /** API URL for this camera's snapshot, e.g. /api/edge-devices/[id]/snapshot */
  snapshotUrl: string;
  /** Refresh interval in ms (default 15 s) */
  refreshMs?: number;
}

/**
 * CameraSnapshot — shows the latest stored frame for an edge camera.
 *
 * Caching strategy:
 *  - A hidden <img> preloads the refreshed frame in the background.
 *  - The visible image only swaps to the new frame once it is fully loaded.
 *  - If the fetch fails (network error or 204 = no image yet) the previous
 *    image stays visible — the component never flashes to a broken/empty state.
 *  - Auto-refreshes every `refreshMs` milliseconds (default 15 s).
 */
export function CameraSnapshot({ snapshotUrl, refreshMs = 15_000 }: CameraSnapshotProps) {
  const [pendingSrc, setPendingSrc] = useState(snapshotUrl);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);

  // Bump pendingSrc on a timer so the hidden img re-fetches
  useEffect(() => {
    const id = setInterval(
      () => setPendingSrc(`${snapshotUrl}?t=${Date.now()}`),
      refreshMs
    );
    return () => clearInterval(id);
  }, [snapshotUrl, refreshMs]);

  return (
    <div className="relative w-full">
      {/* Hidden preloader */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={pendingSrc}
        src={pendingSrc}
        alt=""
        aria-hidden
        className="hidden"
        onLoad={() => setDisplaySrc(pendingSrc)}
        // On error: keep displaySrc (old frame) unchanged
      />

      {displaySrc ? (
        <a href={displaySrc} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displaySrc}
            alt="Latest camera snapshot"
            className="w-full max-h-40 rounded border object-cover hover:opacity-90 transition-opacity bg-muted"
          />
        </a>
      ) : (
        <div className="w-full h-28 rounded border bg-muted flex flex-col items-center justify-center gap-1 text-muted-foreground">
          <span className="text-2xl">📷</span>
          <span className="text-xs">No snapshot yet</span>
          <span className="text-xs opacity-60">Arrives with first analysis report</span>
        </div>
      )}
    </div>
  );
}
