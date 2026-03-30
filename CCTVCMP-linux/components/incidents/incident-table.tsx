"use client";

import { useState } from "react";
import Link from "next/link";
import { IncidentRiskLevel, IncidentStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { IncidentActions } from "@/components/incidents/incident-actions";
import { BoundingBoxCanvas } from "@/components/edge-devices/bounding-box-canvas";
import type { Detection } from "@/components/edge-devices/bounding-box-canvas";
import { formatHKT } from "@/lib/utils";

type IncidentRow = {
  id: string;
  type: string;
  riskLevel: IncidentRiskLevel;
  status: IncidentStatus;
  recordOnly: boolean;
  reasoning: string | null;
  detectedAt: Date;
  project: { name: string };
  zone: { name: string };
  camera: { name: string };
  assignee: { name: string } | null;
  evidence?: {
    reportId: string;
    imagePath: string | null;
    riskLevel: string;
    receivedAt: Date;
    detections?: Detection[];
  } | null;
};

function riskVariant(level: IncidentRiskLevel): "default" | "secondary" | "destructive" {
  if (level === "critical") return "destructive";
  if (level === "high") return "default";
  return "secondary";
}

function statusColor(status: IncidentStatus): string {
  switch (status) {
    case "open": return "text-red-400";
    case "acknowledged": return "text-yellow-400";
    case "resolved": return "text-green-400";
    case "dismissed": return "text-gray-400";
    case "record_only": return "text-blue-400";
    default: return "";
  }
}

const FILTERS: Array<{ label: string; value: IncidentStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Acknowledged", value: "acknowledged" },
  { label: "Resolved", value: "resolved" },
  { label: "Dismissed", value: "dismissed" },
  { label: "Record Only", value: "record_only" },
];

export function IncidentTable({ incidents }: { incidents: IncidentRow[] }) {
  const [filter, setFilter] = useState<IncidentStatus | "all">("all");

  const filtered = filter === "all" ? incidents : incidents.filter((i) => i.status === filter);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Incident Tracking</CardTitle>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={filter === f.value ? "default" : "outline"}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                {f.value !== "all" && (
                  <span className="ml-1 text-xs opacity-60">
                    ({incidents.filter((i) => i.status === f.value).length})
                  </span>
                )}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Camera</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Detected</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead>Assigned</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No incidents found
                </TableCell>
              </TableRow>
            )}
            {filtered.map((incident) => (
              <TableRow key={incident.id} className="hover:bg-muted/50">
                <TableCell>
                  <Link
                    href={`/incidents/${incident.id}`}
                    className="flex items-center gap-2 hover:underline focus:outline-none"
                  >
                    <span>{incident.type.replaceAll("_", " ")}</span>
                    {incident.recordOnly && (
                      <Badge variant="secondary" className="text-xs">record</Badge>
                    )}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={riskVariant(incident.riskLevel)}>{incident.riskLevel}</Badge>
                </TableCell>
                <TableCell>
                  <span className={statusColor(incident.status)}>
                    {incident.status.replace("_", " ")}
                  </span>
                </TableCell>
                <TableCell>{incident.camera.name}</TableCell>
                <TableCell>{incident.zone.name}</TableCell>
                <TableCell className="text-xs">{formatHKT(incident.detectedAt)}</TableCell>
                <TableCell>
                  {incident.evidence?.imagePath ? (
                    <Link href={`/incidents/${incident.id}`} className="block">
                      <BoundingBoxCanvas
                        imageUrl={incident.evidence.imagePath}
                        detections={incident.evidence.detections ?? []}
                        className="w-20"
                        showLegend={false}
                      />
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{incident.assignee?.name ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {incident.evidence?.reportId ? (
                      <Link
                        href={`/incidents/edge-report/${incident.evidence.reportId}`}
                        className="inline-flex items-center rounded-md border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                      >
                        View
                      </Link>
                    ) : (
                      <span className="inline-flex items-center rounded-md border border-muted px-2.5 py-1 text-xs text-muted-foreground cursor-not-allowed">
                        View
                      </span>
                    )}
                    <IncidentActions incidentId={incident.id} currentStatus={incident.status} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
