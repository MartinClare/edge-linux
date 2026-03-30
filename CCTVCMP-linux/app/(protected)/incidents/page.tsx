import { prisma } from "@/lib/prisma";
import { IncidentTable } from "@/components/incidents/incident-table";
import { AutoRefresh } from "@/components/auto-refresh";
import type { IncidentStatus, IncidentRiskLevel } from "@prisma/client";
import type { Detection } from "@/components/edge-devices/bounding-box-canvas";

const VALID_STATUSES: IncidentStatus[] = ["open", "acknowledged", "resolved", "dismissed", "record_only"];
const VALID_RISKS: IncidentRiskLevel[] = ["low", "medium", "high", "critical"];

function extractDetections(rawJson: unknown): Detection[] {
  if (!rawJson || typeof rawJson !== "object") return [];
  const payload = rawJson as Record<string, unknown>;
  const analysis = payload.analysis && typeof payload.analysis === "object"
    ? (payload.analysis as Record<string, unknown>)
    : payload;
  const dets = analysis.detections;
  if (!Array.isArray(dets)) return [];
  return dets.filter(
    (d): d is Detection =>
      d !== null &&
      typeof d === "object" &&
      typeof (d as Record<string, unknown>).label === "string" &&
      Array.isArray((d as Record<string, unknown>).bbox) &&
      ((d as Record<string, unknown>).bbox as unknown[]).length === 4
  );
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const statusParam = typeof params.status === "string" ? params.status : undefined;
  const riskParam = typeof params.riskLevel === "string" ? params.riskLevel : undefined;

  const statusFilter = statusParam
    ?.split(",")
    .filter((s): s is IncidentStatus => VALID_STATUSES.includes(s as IncidentStatus));

  const riskFilter = riskParam
    ?.split(",")
    .filter((r): r is IncidentRiskLevel => VALID_RISKS.includes(r as IncidentRiskLevel));

  const incidents = await prisma.incident.findMany({
    where: {
      ...(statusFilter?.length ? { status: { in: statusFilter } } : {}),
      ...(riskFilter?.length ? { riskLevel: { in: riskFilter } } : {}),
    },
    include: {
      project: { select: { name: true } },
      zone: { select: { name: true } },
      camera: { select: { name: true } },
      assignee: { select: { name: true } },
    },
    orderBy: { detectedAt: "desc" },
  });

  const cameraIds = Array.from(new Set(incidents.map((i) => i.cameraId)));
  const evidenceReports = cameraIds.length
    ? await prisma.edgeReport.findMany({
        where: {
          cameraId: { in: cameraIds },
          eventImagePath: { not: null },
          keepalive: false,
          messageType: "analysis",
        },
        select: {
          id: true,
          cameraId: true,
          eventImagePath: true,
          overallRiskLevel: true,
          receivedAt: true,
          rawJson: true,
        },
        orderBy: { receivedAt: "desc" },
        take: 1000,
      })
    : [];

  const evidenceByCamera = new Map<string, typeof evidenceReports>();
  for (const r of evidenceReports) {
    const arr = evidenceByCamera.get(r.cameraId) ?? [];
    arr.push(r);
    evidenceByCamera.set(r.cameraId, arr);
  }

  const incidentsWithEvidence = incidents.map((incident) => {
    const candidates = evidenceByCamera.get(incident.cameraId) ?? [];
    let best: (typeof candidates)[number] | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;

    for (const c of candidates) {
      const diff = Math.abs(c.receivedAt.getTime() - incident.detectedAt.getTime());
      if (diff < bestDiff) {
        bestDiff = diff;
        best = c;
      }
    }

    // Keep only nearby evidence (within 2 hours) to avoid misleading mismatches.
    const evidence = best && bestDiff <= 2 * 60 * 60 * 1000
      ? {
          reportId: best.id,
          imagePath: best.eventImagePath,
          riskLevel: best.overallRiskLevel,
          receivedAt: best.receivedAt,
          detections: extractDetections(best.rawJson),
        }
      : null;

    return { ...incident, evidence };
  });

  const filterLabel = [
    statusFilter?.length ? `Status: ${statusFilter.join(", ")}` : null,
    riskFilter?.length ? `Risk: ${riskFilter.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSec={10} />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Incident Management</h2>
          {filterLabel && (
            <p className="text-sm text-muted-foreground mt-1">
              Filtered by: <span className="font-medium text-foreground">{filterLabel}</span>
              &nbsp;·&nbsp;
              <a href="/incidents" className="text-primary hover:underline">
                Clear filter
              </a>
            </p>
          )}
        </div>
      </div>
      <IncidentTable incidents={incidentsWithEvidence} />
    </div>
  );
}
