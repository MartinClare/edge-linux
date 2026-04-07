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
import { useTranslations } from "next-intl";

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

export function IncidentTable({ incidents }: { incidents: IncidentRow[] }) {
  const t = useTranslations("incidents");
  const tCommon = useTranslations("common");
  const FILTERS: Array<{ label: string; value: IncidentStatus | "all" }> = [
    { label: t("filterAll"), value: "all" },
    { label: t("filterOpen"), value: "open" },
    { label: t("filterAcknowledged"), value: "acknowledged" },
    { label: t("filterResolved"), value: "resolved" },
    { label: t("filterDismissed"), value: "dismissed" },
    { label: t("filterRecordOnly"), value: "record_only" },
  ];

  const [filter, setFilter] = useState<IncidentStatus | "all">("all");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  function onStatusChange(incidentId: string, newStatus: IncidentStatus) {
    if (newStatus === "dismissed") {
      setHiddenIds((prev) => new Set([...prev, incidentId]));
    }
  }

  const filtered = (filter === "all" ? incidents : incidents.filter((i) => i.status === filter))
    .filter((i) => !hiddenIds.has(i.id));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{t("incidentTracking")}</CardTitle>
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
              <TableHead>{t("colType")}</TableHead>
              <TableHead>{t("colRisk")}</TableHead>
              <TableHead>{t("colStatus")}</TableHead>
              <TableHead>{t("colCamera")}</TableHead>
              <TableHead>{t("colZone")}</TableHead>
              <TableHead>{t("colDetected")}</TableHead>
              <TableHead>{t("colEvidence")}</TableHead>
              <TableHead>{t("colAssigned")}</TableHead>
              <TableHead>{t("colAction")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  {t("noIncidentsFound")}
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
                    <span>{t(`types.${incident.type}` as Parameters<typeof t>[0]) || incident.type.replaceAll("_", " ")}</span>
                    {incident.recordOnly && (
                      <Badge variant="secondary" className="text-xs">{t("record")}</Badge>
                    )}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={riskVariant(incident.riskLevel)}>{tCommon(`riskLevel.${incident.riskLevel}` as Parameters<typeof tCommon>[0])}</Badge>
                </TableCell>
                <TableCell>
                  <span className={statusColor(incident.status)}>
                    {tCommon(`status.${incident.status}` as Parameters<typeof tCommon>[0])}
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
                    <Link
                      href={`/incidents/${incident.id}`}
                      className="inline-flex items-center rounded-md border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                    >
                      {t("view")}
                    </Link>
                    <IncidentActions incidentId={incident.id} currentStatus={incident.status} onStatusChange={onStatusChange} />
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
