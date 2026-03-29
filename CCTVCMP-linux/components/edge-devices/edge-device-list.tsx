"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatHKT } from "@/lib/utils";

type Device = {
  id: string;
  name: string;
  edgeCameraId: string | null;
  status: string;
  lastReportAt: string | null;
  createdAt: string;
  project: { id: string; name: string } | null;
  zone: { id: string; name: string } | null;
  isOnline: boolean;
  latestReport: {
    id: string;
    overallRiskLevel: string;
    overallDescription: string;
    eventImagePath: string | null;
    receivedAt: string;
  } | null;
  latestAlertEvidence: {
    id: string;
    overallRiskLevel: string;
    eventImagePath: string;
    receivedAt: string;
  } | null;
  incidentCount: number;
  reportCount: number;
};

const SNAPSHOT_REFRESH_MS = 30_000; // refresh every 30 s on the list page

/**
 * Snapshot thumbnail with graceful caching:
 *  - A hidden <img> preloads the latest frame in the background.
 *  - The visible image only swaps when the new frame is fully loaded.
 *  - On error (or 204 = no image yet) the old image (or placeholder) stays visible.
 *  - Auto-refreshes every 30 s so cards stay current without a page reload.
 */
function DeviceSnapshot({ deviceId, name }: { deviceId: string; name: string }) {
  const base = `/api/edge-devices/${deviceId}/snapshot`;

  // pendingSrc: what we're currently trying to load (bumped every 30 s)
  const [pendingSrc, setPendingSrc] = useState(base);
  // displaySrc: last successfully loaded image — never cleared on error
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);

  // Bump pendingSrc periodically so the hidden img re-fetches
  useEffect(() => {
    const id = setInterval(
      () => setPendingSrc(`${base}?t=${Date.now()}`),
      SNAPSHOT_REFRESH_MS
    );
    return () => clearInterval(id);
  }, [base]);

  return (
    <>
      {/* Hidden preloader — fetches new frame; swaps display only on success */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={pendingSrc}
        src={pendingSrc}
        alt=""
        aria-hidden
        className="hidden"
        onLoad={() => setDisplaySrc(pendingSrc)}
        // On error: do nothing — displaySrc (old image or null) stays unchanged
      />

      {displaySrc ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={displaySrc}
          alt={`${name} snapshot`}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      ) : (
        <SnapshotPlaceholder />
      )}
    </>
  );
}

function SnapshotPlaceholder() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground/40">
      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
      </svg>
      <span className="text-xs">No snapshot yet</span>
    </div>
  );
}

function StatusDot({ device }: { device: Device }) {
  if (device.status === "maintenance") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-yellow-400 font-medium">
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
        Maintenance
      </span>
    );
  }
  if (device.isOnline) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
        <span className="h-2.5 w-2.5 rounded-full bg-green-400 animate-pulse" />
        Online
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-red-400 font-medium">
      <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
      Offline
    </span>
  );
}

function riskBadge(level: string) {
  const l = level.toLowerCase();
  if (l === "critical" || l === "high") return <Badge variant="destructive">{level}</Badge>;
  if (l === "medium") return <Badge variant="default">{level}</Badge>;
  return <Badge variant="secondary">{level}</Badge>;
}

export function EdgeDeviceList({ devices }: { devices: Device[] }) {
  if (devices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
        <p className="text-lg font-medium mb-1">No edge devices registered</p>
        <p className="text-sm">Devices auto-register when they send their first report to the CMP.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {devices.map((d) => (
        <Link key={d.id} href={`/edge-devices/${d.id}`} className="group block">
          <Card className="h-full transition-all duration-150 hover:border-primary/60 hover:shadow-md group-focus-visible:ring-2 ring-primary">
            {/* Thumbnail — served from stored DB bytes via /api/edge-devices/[id]/snapshot */}
            <div className="relative overflow-hidden rounded-t-xl bg-muted/30 h-36">
              <DeviceSnapshot deviceId={d.id} name={d.name} />
              {/* Risk overlay badge */}
              {d.latestReport && (
                <div className="absolute top-2 right-2">
                  {riskBadge(d.latestReport.overallRiskLevel)}
                </div>
              )}
              {/* Status dot */}
              <div className="absolute top-2 left-2 rounded-full bg-background/80 px-2 py-0.5 backdrop-blur-sm">
                <StatusDot device={d} />
              </div>
            </div>

            <CardContent className="p-4 space-y-2">
              {/* Name */}
              <p className="font-semibold text-sm leading-tight truncate">{d.name}</p>

              {/* Project / Zone */}
              <p className="text-xs text-muted-foreground truncate">
                {d.project?.name ?? "—"}
                {d.zone?.name ? ` · ${d.zone.name}` : ""}
              </p>

              {/* Latest description */}
              {d.latestReport?.overallDescription && (
                <p className="text-xs text-muted-foreground/80 line-clamp-2 leading-relaxed">
                  {d.latestReport.overallDescription}
                </p>
              )}

              {/* Footer stats */}
              <div className="flex items-center justify-between pt-1 border-t border-border/50">
                <span className="text-xs text-muted-foreground">
                  {d.lastReportAt ? formatHKT(d.lastReportAt) : "Never"}
                </span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span title="Reports">{d.reportCount} rpt</span>
                  <span title="Incidents">{d.incidentCount} inc</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
