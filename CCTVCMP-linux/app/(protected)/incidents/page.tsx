import { prisma } from "@/lib/prisma";
import { IncidentTable } from "@/components/incidents/incident-table";
import { AutoRefresh } from "@/components/auto-refresh";
import type { IncidentStatus, IncidentRiskLevel } from "@prisma/client";
import type { Detection } from "@/components/edge-devices/bounding-box-canvas";
import { getTranslations } from "next-intl/server";

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
  const t = await getTranslations("incidents");
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
      edgeReport: {
        select: {
          id: true,
          eventImagePath: true,
          overallRiskLevel: true,
          receivedAt: true,
          rawJson: true,
        },
      },
    },
    orderBy: { detectedAt: "desc" },
  });

  const incidentsWithEvidence = incidents.map((incident) => {
    const r = incident.edgeReport;
    const evidence = r?.eventImagePath
      ? {
          reportId: r.id,
          imagePath: r.eventImagePath,
          riskLevel: r.overallRiskLevel,
          receivedAt: r.receivedAt,
          detections: extractDetections(r.rawJson),
        }
      : null;

    return { ...incident, evidence };
  });

  const filterLabel = [
    statusFilter?.length ? statusFilter.join(", ") : null,
    riskFilter?.length ? riskFilter.join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSec={10} />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{t("title")}</h2>
          {filterLabel && (
            <p className="text-sm text-muted-foreground mt-1">
              {t("filteredBy")} <span className="font-medium text-foreground">{filterLabel}</span>
              &nbsp;·&nbsp;
              <a href="/incidents" className="text-primary hover:underline">
                {t("clearFilter")}
              </a>
            </p>
          )}
        </div>
      </div>
      <IncidentTable incidents={incidentsWithEvidence} />
    </div>
  );
}
