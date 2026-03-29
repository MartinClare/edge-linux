import { prisma } from "@/lib/prisma";
import { IncidentTable } from "@/components/incidents/incident-table";
import { AutoRefresh } from "@/components/auto-refresh";
import type { IncidentStatus, IncidentRiskLevel } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatHKT } from "@/lib/utils";
import Link from "next/link";

const VALID_STATUSES: IncidentStatus[] = ["open", "acknowledged", "resolved", "dismissed", "record_only"];
const VALID_RISKS: IncidentRiskLevel[] = ["low", "medium", "high", "critical"];

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const statusParam = typeof params.status === "string" ? params.status : undefined;
  const riskParam = typeof params.riskLevel === "string" ? params.riskLevel : undefined;
  const edgeImageParam = typeof params.edgeImage === "string" ? params.edgeImage : "all";
  const edgePageParam = typeof params.edgePage === "string" ? Number(params.edgePage) : 1;
  const edgeImageFilter: "all" | "with" | "without" =
    edgeImageParam === "with" || edgeImageParam === "without" ? edgeImageParam : "all";
  const edgePage = Number.isFinite(edgePageParam) && edgePageParam > 0 ? Math.floor(edgePageParam) : 1;
  const EDGE_PAGE_SIZE = 20;

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
        },
        select: {
          id: true,
          cameraId: true,
          eventImagePath: true,
          overallRiskLevel: true,
          receivedAt: true,
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
        }
      : null;

    return { ...incident, evidence };
  });

  const edgeRiskWhere = {
    messageType: "analysis" as const,
    keepalive: false,
    overallRiskLevel: { in: ["Medium", "High", "Critical"] as Array<"Medium" | "High" | "Critical"> },
    ...(edgeImageFilter === "with" ? { eventImagePath: { not: null as string | null } } : {}),
    ...(edgeImageFilter === "without" ? { eventImagePath: null as string | null } : {}),
  };

  const totalEdgeRiskRecords = await prisma.edgeReport.count({ where: edgeRiskWhere });
  const totalEdgePages = Math.max(1, Math.ceil(totalEdgeRiskRecords / EDGE_PAGE_SIZE));
  const safeEdgePage = Math.min(edgePage, totalEdgePages);

  const recentEdgeRiskReports = await prisma.edgeReport.findMany({
    skip: (safeEdgePage - 1) * EDGE_PAGE_SIZE,
    take: EDGE_PAGE_SIZE,
    where: {
      ...edgeRiskWhere,
    },
    select: {
      id: true,
      cameraName: true,
      overallRiskLevel: true,
      overallDescription: true,
      eventImagePath: true,
      eventTimestamp: true,
      receivedAt: true,
    },
    orderBy: { receivedAt: "desc" },
  });

  const recentEdgeReports = recentEdgeRiskReports.length
    ? recentEdgeRiskReports
    : await prisma.edgeReport.findMany({
        take: 10,
        where: {
          messageType: "analysis",
          keepalive: false,
          ...(edgeImageFilter === "with" ? { eventImagePath: { not: null } } : {}),
          ...(edgeImageFilter === "without" ? { eventImagePath: null } : {}),
        },
        select: {
          id: true,
          cameraName: true,
          overallRiskLevel: true,
          overallDescription: true,
          eventImagePath: true,
          eventTimestamp: true,
          receivedAt: true,
        },
        orderBy: { receivedAt: "desc" },
      });

  const edgeListQuery = (filter: "all" | "with" | "without", page: number) =>
    `/incidents?edgeImage=${filter}&edgePage=${page}`;

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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Edge Risk Records</CardTitle>
            <div className="flex items-center gap-2 text-sm">
              <Link
                href={edgeListQuery("all", 1)}
                className={edgeImageFilter === "all" ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}
              >
                All
              </Link>
              <span className="text-muted-foreground">|</span>
              <Link
                href={edgeListQuery("with", 1)}
                className={edgeImageFilter === "with" ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}
              >
                With image
              </Link>
              <span className="text-muted-foreground">|</span>
              <Link
                href={edgeListQuery("without", 1)}
                className={edgeImageFilter === "without" ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}
              >
                Without image
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            The standard edge build sends <span className="font-medium text-foreground">JSON analysis only</span> to the
            CMP (no JPEG). Evidence thumbnails appear here only when a report includes a stored image (e.g. future
            multipart uploads).{" "}
            <span className="text-foreground/80">
              Configure a camera stream on the edge device page for a live visual reference.
            </span>
          </p>
          {incidentsWithEvidence.length === 0 && (
            <p className="mb-3 text-sm text-muted-foreground">
              No incidents were generated yet. Recent edge risk records are shown below.
            </p>
          )}
          {recentEdgeRiskReports.length === 0 && (
            <p className="mb-3 text-sm text-muted-foreground">
              No Medium/High/Critical records in the latest window; showing latest analysis records instead.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Camera</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentEdgeReports.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No edge event records found
                  </TableCell>
                </TableRow>
              )}
              {recentEdgeReports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell>{report.cameraName}</TableCell>
                  <TableCell>
                    <Badge variant={report.overallRiskLevel.toLowerCase() === "critical" ? "destructive" : "secondary"}>
                      {report.overallRiskLevel}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xl">
                    <details className="group">
                      <summary className="cursor-pointer list-none text-sm text-foreground/90">
                        <span className="group-open:hidden block truncate">
                          {report.overallDescription || "—"}
                        </span>
                        <span className="hidden group-open:block font-medium text-primary">
                          Hide details
                        </span>
                      </summary>
                      <div className="mt-2 rounded-md border bg-muted/30 p-3 text-sm leading-6 text-foreground whitespace-pre-wrap">
                        {report.overallDescription || "No description"}
                      </div>
                    </details>
                  </TableCell>
                  <TableCell className="text-xs">{formatHKT(report.eventTimestamp ?? report.receivedAt)}</TableCell>
                  <TableCell>
                    {report.eventImagePath ? (
                      <Link href={`/incidents/edge-report/${report.id}`} className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={report.eventImagePath}
                          alt="Edge event evidence"
                          className="h-12 w-20 rounded border object-cover"
                        />
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/incidents/edge-report/${report.id}`} className="text-sm text-primary hover:underline">
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {recentEdgeRiskReports.length > 0 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                Showing {(safeEdgePage - 1) * EDGE_PAGE_SIZE + 1}-
                {Math.min(safeEdgePage * EDGE_PAGE_SIZE, totalEdgeRiskRecords)} of {totalEdgeRiskRecords} records
              </p>
              <div className="flex items-center gap-3">
                {safeEdgePage > 1 ? (
                  <Link href={edgeListQuery(edgeImageFilter, safeEdgePage - 1)} className="text-primary hover:underline">
                    Previous
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Previous</span>
                )}
                <span className="text-muted-foreground">
                  Page {safeEdgePage} / {totalEdgePages}
                </span>
                {safeEdgePage < totalEdgePages ? (
                  <Link href={edgeListQuery(edgeImageFilter, safeEdgePage + 1)} className="text-primary hover:underline">
                    Next
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Next</span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
