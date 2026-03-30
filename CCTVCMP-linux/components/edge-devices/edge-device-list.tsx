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
  streamUrl: string | null;
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

const SNAPSHOT_REFRESH_MS = 15_000; // refresh every 15 s on the list page

function withTimestamp(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

/** Snapshot thumbnail that always fetches the latest frame directly. */
function DeviceSnapshot({ deviceId, name }: { deviceId: string; name: string }) {
  const base = `/api/edge-devices/${deviceId}/snapshot`;
  const [src, setSrc] = useState(() => withTimestamp(base));

  useEffect(() => {
    setSrc(withTimestamp(base));
    const id = setInterval(() => setSrc(withTimestamp(base)), SNAPSHOT_REFRESH_MS);
    return () => clearInterval(id);
  }, [base]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt={`${name} snapshot`}
        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
      />
    </>
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

              {(d.edgeCameraId || d.streamUrl) && (
                <p className="text-[11px] text-muted-foreground/80 truncate">
                  {d.edgeCameraId ?? "—"}
                  {d.streamUrl ? ` · ${d.streamUrl}` : ""}
                </p>
              )}

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
