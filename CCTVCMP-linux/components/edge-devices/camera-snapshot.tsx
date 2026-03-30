"use client";

import { useEffect, useState } from "react";

function withTimestamp(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

interface CameraSnapshotProps {
  /** API URL for this camera's snapshot, e.g. /api/edge-devices/[id]/snapshot */
  snapshotUrl: string;
  /** Refresh interval in ms (default 15 s) */
  refreshMs?: number;
}

export function CameraSnapshot({ snapshotUrl, refreshMs = 15_000 }: CameraSnapshotProps) {
  const [src, setSrc] = useState(() => withTimestamp(snapshotUrl));

  useEffect(() => {
    setSrc(withTimestamp(snapshotUrl));
    const id = setInterval(() => setSrc(withTimestamp(snapshotUrl)), refreshMs);
    return () => clearInterval(id);
  }, [snapshotUrl, refreshMs]);

  return (
    <div className="relative w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <a href={src} target="_blank" rel="noreferrer">
        <img
          key={src}
          src={src}
          alt="Latest camera snapshot"
          className="w-full max-h-40 rounded border object-cover hover:opacity-90 transition-opacity bg-muted"
        />
      </a>
    </div>
  );
}
