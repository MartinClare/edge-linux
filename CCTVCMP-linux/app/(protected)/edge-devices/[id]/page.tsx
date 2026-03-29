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
import { StreamUrlForm } from "@/components/edge-devices/stream-url-form";

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export default async function EdgeDeviceDetailPage({ params }: { params: { id: string } }) {
  const camera = await prisma.camera.findUnique({
    where: { id: params.id },
    include: {
      project: true,
      zone: true,
      edgeReports: {
        orderBy: { receivedAt: "desc" },
        take: 50,
      },
      _count: { select: { incidents: true, edgeReports: true } },
    },
  });

  if (!camera) notFound();

  const now = Date.now();
  const isOnline =
    camera.status !== "maintenance" &&
    camera.lastReportAt != null &&
    now - camera.lastReportAt.getTime() < ONLINE_THRESHOLD_MS;
  const latestReport = camera.edgeReports[0];
  const latestAlertedReportWithEvidence =
    camera.edgeReports.find(
      (r) =>
        (r.overallRiskLevel === "Medium" || r.overallRiskLevel === "High" || r.overallRiskLevel === "Critical") &&
        !!r.eventImagePath
    ) ?? null;
  const latestAnalysis = extractLatestAnalysis(latestReport?.rawJson);

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSec={10} />
      <div className="flex items-center gap-4">
        <Link href="/edge-devices">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h2 className="text-2xl font-semibold">{camera.name}</h2>
          <p className="text-sm text-muted-foreground">
            {camera.edgeCameraId ?? "—"} · {camera.project.name}
            {camera.zone && ` · ${camera.zone.name}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {camera.status === "maintenance" ? (
            <Badge variant="secondary">Maintenance</Badge>
          ) : isOnline ? (
            <span className="flex items-center gap-1.5 text-sm text-green-600">
              <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
              Online
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-red-600">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              Offline
            </span>
          )}
          <EdgeDeviceActions deviceId={camera.id} status={camera.status} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Summary</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last report</span>
              <span>{camera.lastReportAt ? formatHKT(camera.lastReportAt) : "Never"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total reports</span>
              <span>{camera._count.edgeReports}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Incidents</span>
              <span>{camera._count.incidents}</span>
            </div>
            {latestReport && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Latest risk</span>
                  <Badge
                    variant={
                      latestReport.overallRiskLevel === "High"
                        ? "destructive"
                        : latestReport.overallRiskLevel === "Medium"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {latestReport.overallRiskLevel}
                  </Badge>
                </div>
                <p className="text-muted-foreground pt-2 border-t line-clamp-2">
                  {latestReport.overallDescription}
                </p>
                {latestAlertedReportWithEvidence?.eventImagePath && (
                  <div className="pt-2 border-t">
                    <p className="mb-2 text-xs text-muted-foreground">Latest alerted evidence image</p>
                    <div className="mb-2 flex items-center gap-2">
                      <Badge
                        variant={
                          latestAlertedReportWithEvidence.overallRiskLevel === "High" ||
                          latestAlertedReportWithEvidence.overallRiskLevel === "Critical"
                            ? "destructive"
                            : "default"
                        }
                      >
                        {latestAlertedReportWithEvidence.overallRiskLevel}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatHKT(latestAlertedReportWithEvidence.receivedAt)}
                      </span>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={latestAlertedReportWithEvidence.eventImagePath}
                      alt="Event evidence"
                      className="max-h-52 w-full rounded border object-contain"
                    />
                  </div>
                )}
              </>
            )}
            <div className="pt-2 border-t">
              <StreamUrlForm deviceId={camera.id} initialStreamUrl={camera.streamUrl} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Recent Reports</CardTitle></CardHeader>
          <CardContent>
            <div className="max-h-[280px] overflow-y-auto space-y-2">
              {camera.edgeReports.length === 0 ? (
                <p className="text-sm text-muted-foreground">No reports yet</p>
              ) : (
                camera.edgeReports.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded border p-2 text-sm"
                  >
                    <span className="text-muted-foreground line-clamp-1">{r.overallDescription}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={
                          r.overallRiskLevel === "High"
                            ? "destructive"
                            : r.overallRiskLevel === "Medium"
                            ? "default"
                            : "secondary"
                        }
                        className="text-xs"
                      >
                        {r.overallRiskLevel}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatHKT(r.receivedAt)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {latestAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle>Deep Vision AI Analysis (Latest Report)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded border p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-medium">Risk Level:</span>
                <Badge
                  variant={
                    latestAnalysis.overallRiskLevel === "High"
                      ? "destructive"
                      : latestAnalysis.overallRiskLevel === "Medium"
                      ? "default"
                      : "secondary"
                  }
                >
                  {latestAnalysis.overallRiskLevel}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {latestAnalysis.overallDescription || "No description available."}
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <SafetyCard title="Construction Safety" data={latestAnalysis.constructionSafety} />
              <SafetyCard title="Fire Safety" data={latestAnalysis.fireSafety} />
              <SafetyCard title="Property Security" data={latestAnalysis.propertySecurity} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type SafetyCategory = {
  summary?: string;
  issues?: string[];
  recommendations?: string[];
};

type EdgeAnalysis = {
  overallDescription?: string;
  overallRiskLevel?: "Low" | "Medium" | "High";
  constructionSafety?: SafetyCategory;
  fireSafety?: SafetyCategory;
  propertySecurity?: SafetyCategory;
};

function extractLatestAnalysis(rawJson: unknown): EdgeAnalysis | null {
  if (!rawJson || typeof rawJson !== "object") return null;
  const payload = rawJson as Record<string, unknown>;
  // Supports both payload shapes:
  // 1) rawJson = { edgeCameraId, cameraName, timestamp, analysis: {...} }
  // 2) rawJson = { ...analysis }
  const analysisCandidate =
    payload.analysis && typeof payload.analysis === "object"
      ? (payload.analysis as Record<string, unknown>)
      : payload;

  if (!analysisCandidate.overallRiskLevel && !analysisCandidate.overallDescription) {
    return null;
  }

  return analysisCandidate as EdgeAnalysis;
}

function SafetyCard({ title, data }: { title: string; data?: SafetyCategory }) {
  return (
    <div className="rounded border p-3">
      <p className="mb-1 text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">
        {data?.summary || "No summary available."}
      </p>
      {data?.issues && data.issues.length > 0 && (
        <p className="mt-2 text-xs">
          <span className="font-medium">Issues:</span> {data.issues.join("; ")}
        </p>
      )}
      {data?.recommendations && data.recommendations.length > 0 && (
        <p className="mt-1 text-xs">
          <span className="font-medium">Recommendations:</span>{" "}
          {data.recommendations.join("; ")}
        </p>
      )}
    </div>
  );
}
