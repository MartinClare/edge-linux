import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatHKT } from "@/lib/utils";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { EdgeDeviceActions } from "@/components/edge-devices/edge-device-actions";
import { EdgeDeviceReportFeed } from "@/components/edge-devices/edge-device-report-feed";
import { CameraSnapshot } from "@/components/edge-devices/camera-snapshot";
import { ONLINE_THRESHOLD_MS } from "@/lib/camera-status";

function buildCmpDescription(classificationJson: unknown, visionVerificationJson: unknown): string {
  const cls = classificationJson as { classifications?: Array<{ type: string; detected: boolean; riskLevel: string; confidence: number; reasoning?: string }>; source?: string } | null;
  const vv = visionVerificationJson as { summary?: string; missedHazards?: string[]; incorrectClaims?: string[] } | null;
  const detected = (cls?.classifications ?? []).filter((c) => c.detected);
  if (detected.length === 0 && !vv?.summary) return "";
  let text = detected.length === 0
    ? "CMP found no safety incidents."
    : `CMP identified: ${detected.map((c) => `${c.type.replace(/_/g, " ")} (${c.riskLevel}, ${Math.round(c.confidence * 100)}%)`).join("; ")}.`;
  if (vv?.summary) text += ` ${vv.summary}`;
  if (vv?.missedHazards?.length) text += ` Missed by edge: ${vv.missedHazards.join("; ")}.`;
  if (vv?.incorrectClaims?.length) text += ` Not confirmed: ${vv.incorrectClaims.join("; ")}.`;
  return text;
}

export default async function EdgeDeviceDetailPage({ params }: { params: { id: string } }) {
  const camera = await prisma.camera.findUnique({
    where: { id: params.id },
    include: {
      project: true,
      zone: true,
      _count: { select: { incidents: true, edgeReports: true } },
    },
  });

  if (!camera) notFound();

  // Load analysis reports separately for the feed.
  // Heartbeats are intentionally hidden in the UI, so querying only analysis rows
  // prevents recent keepalives from pushing older analyses out of the 200-row window.
  const reports = await prisma.edgeReport.findMany({
    where: {
      cameraId: camera.id,
      keepalive: false,
      NOT: { messageType: "keepalive" },
    },
    orderBy: { receivedAt: "desc" },
    take: 200,
    select: {
      id: true,
      receivedAt: true,
      messageType: true,
      keepalive: true,
      overallRiskLevel: true,
      cmpRiskLevel: true,
      overallDescription: true,
      eventImagePath: true,
      eventImageIncluded: true,
      peopleCount: true,
      missingHardhats: true,
      missingVests: true,
      constructionSafety: true,
      fireSafety: true,
      propertySecurity: true,
      classificationJson: true,
      visionVerificationJson: true,
      // rawJson carries analysis.detections (bounding boxes) from Gemini
      rawJson: true,
    },
  });

  const now = Date.now();
  const isOnline =
    camera.status !== "maintenance" &&
    camera.status !== "degraded" &&
    camera.lastReportAt != null &&
    now - camera.lastReportAt.getTime() < ONLINE_THRESHOLD_MS;

  const latestAnalysis = reports[0] ?? null;

  const snapshotUrl = `/api/edge-devices/${camera.id}/snapshot`;

  // Serialize dates for client components
  const serializedReports = reports.map((r) => ({
    ...r,
    receivedAt: r.receivedAt.toISOString(),
    cmpRiskLevel: r.cmpRiskLevel ?? null,
    constructionSafety: r.constructionSafety ?? null,
    fireSafety: r.fireSafety ?? null,
    propertySecurity: r.propertySecurity ?? null,
    classificationJson: r.classificationJson ?? null,
    visionVerificationJson: r.visionVerificationJson ?? null,
    rawJson: r.rawJson ?? null,
  }));

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSec={10} />

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link href="/edge-devices">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-semibold truncate">{camera.name}</h2>
          <p className="text-sm text-muted-foreground">
            {camera.edgeCameraId ?? "—"} · {camera.project.name}
            {camera.zone ? ` · ${camera.zone.name}` : ""}
          </p>
          {camera.streamUrl && (
            <p className="text-xs text-muted-foreground break-all">{camera.streamUrl}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {camera.status === "maintenance" ? (
            <Badge variant="secondary">Maintenance</Badge>
          ) : camera.status === "degraded" ? (
            <span className="flex items-center gap-1.5 text-sm text-yellow-500">
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500 animate-pulse" />
              Stream Issue
            </span>
          ) : isOnline ? (
            <span className="flex items-center gap-1.5 text-sm text-green-500">
              <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
              Online
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-red-500">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              Offline
            </span>
          )}
          <EdgeDeviceActions deviceId={camera.id} status={camera.status} />
        </div>
      </div>

      {/* ── Stats + config row ───────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Summary stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Last report" value={camera.lastReportAt ? formatHKT(camera.lastReportAt) : "Never"} />
            <Row label="Edge address" value={camera.streamUrl ?? "—"} />
            <Row label="Total reports" value={String(camera._count.edgeReports)} />
            <Row label="Incidents" value={String(camera._count.incidents)} />
            {latestAnalysis && (
              <>
                <div className="flex items-center justify-between pt-1 border-t">
                  <span className="text-muted-foreground">Latest risk (edge)</span>
                  <RiskBadge level={latestAnalysis.overallRiskLevel} />
                </div>
                {latestAnalysis.cmpRiskLevel && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">CMP assessment</span>
                    <RiskBadge level={latestAnalysis.cmpRiskLevel} />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Latest description */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Latest Analysis</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {latestAnalysis ? (
              <>
                <p className="text-muted-foreground/90 leading-relaxed text-xs">
                  {buildCmpDescription(latestAnalysis.classificationJson, latestAnalysis.visionVerificationJson) || latestAnalysis.overallDescription || "No description."}
                </p>
                {(latestAnalysis.missingHardhats ?? 0) > 0 && (
                  <p className="text-red-400 text-xs font-medium">
                    ⛑ {latestAnalysis.missingHardhats} missing hardhat(s)
                  </p>
                )}
                {(latestAnalysis.missingVests ?? 0) > 0 && (
                  <p className="text-orange-400 text-xs font-medium">
                    🦺 {latestAnalysis.missingVests} missing vest(s)
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No analysis received yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Latest snapshot */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Latest Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* CameraSnapshot auto-refreshes every 30 s and always shows the last
                known good frame — never flashes to a placeholder during reload */}
            <CameraSnapshot snapshotUrl={snapshotUrl} />
            <p className="text-xs text-muted-foreground">
              Edge address is synced automatically from the edge backend and cannot be edited here.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Full report feed ─────────────────────────────────── */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Report Feed</h3>
        <EdgeDeviceReportFeed reports={serializedReports} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const l = level.toLowerCase();
  if (l === "critical" || l === "high") return <Badge variant="destructive">{level}</Badge>;
  if (l === "medium") return <Badge variant="default">{level}</Badge>;
  return <Badge variant="secondary">{level}</Badge>;
}
