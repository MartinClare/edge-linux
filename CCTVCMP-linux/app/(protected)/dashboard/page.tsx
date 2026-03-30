import { prisma } from "@/lib/prisma";
import { KpiCards } from "@/components/kpi-cards";
import { EdgeStatusPanel } from "@/components/dashboard/edge-status-panel";
import { RiskBreakdown } from "@/components/dashboard/risk-breakdown";
import { AlertFeed } from "@/components/dashboard/alert-feed";
import { AutoRefresh } from "@/components/auto-refresh";
import { ONLINE_THRESHOLD_MS } from "@/lib/camera-status";

const CATEGORY_MAP: Record<string, { category: string; icon: string }> = {
  ppe_violation: { category: "PPE", icon: "🪖" },
  fall_risk: { category: "Construction", icon: "🏗️" },
  machinery_hazard: { category: "Construction", icon: "🏗️" },
  restricted_zone_entry: { category: "Security", icon: "🔒" },
  fire_detected: { category: "Fire", icon: "🔥" },
  smoke_detected: { category: "Fire", icon: "🔥" },
  near_miss: { category: "Construction", icon: "🏗️" },
  smoking: { category: "Fire", icon: "🔥" },
};

export default async function DashboardPage() {
  const [incidents, metrics, cameras, recentIncidents] = await Promise.all([
    prisma.incident.findMany(),
    prisma.dailyMetric.findMany({ orderBy: { date: "desc" }, take: 14 }),
    prisma.camera.findMany({
      include: {
        edgeReports: {
          orderBy: { receivedAt: "desc" },
          take: 1,
          select: {
            messageType: true,
            keepalive: true,
            overallRiskLevel: true,
            overallDescription: true,
            receivedAt: true,
          },
        },
      },
    }),
    prisma.incident.findMany({
      take: 20,
      orderBy: { detectedAt: "desc" },
      include: { camera: { select: { name: true } } },
    }),
  ]);

  const now = Date.now();
  const edgeDevices = cameras
    .filter((cam) => {
      // Hide probe-only / heartbeat-only pseudo devices from the dashboard.
      // Real CCTV devices either publish a stream URL or have at least one
      // non-keepalive analysis report.
      const hasAnalysisReport = cam.edgeReports.some(
        (r) => !r.keepalive && r.messageType !== "keepalive"
      );
      return Boolean(cam.streamUrl) || hasAnalysisReport;
    })
    .map((cam) => ({
      id: cam.id,
      name: cam.name,
      edgeCameraId: cam.edgeCameraId,
      streamUrl: cam.streamUrl,
      status: cam.status,
      lastReportAt: cam.lastReportAt?.toISOString() ?? null,
      isOnline:
        cam.status !== "maintenance" &&
        cam.lastReportAt != null &&
        now - cam.lastReportAt.getTime() < ONLINE_THRESHOLD_MS,
      latestRiskLevel: cam.edgeReports[0]?.overallRiskLevel ?? null,
      latestDescription: cam.edgeReports[0]?.overallDescription ?? null,
    }));

  const edgeOnline = edgeDevices.filter((d) => d.isOnline).length;
  const openIncidents = incidents.filter((i) => i.status === "open").length;
  const highCriticalRisk = incidents.filter(
    (i) => i.riskLevel === "high" || i.riskLevel === "critical"
  ).length;
  const avgResponseTime =
    metrics.length > 0
      ? metrics.reduce((acc, m) => acc + m.avgResponseTime, 0) / metrics.length
      : 0;

  const categoryMeta: Record<string, { icon: string }> = {};
  for (const [, { category, icon }] of Object.entries(CATEGORY_MAP)) {
    if (!categoryMeta[category]) categoryMeta[category] = { icon };
  }
  const riskCategories = Object.entries(categoryMeta).map(([category, { icon }]) => {
    const typesInCategory = Object.entries(CATEGORY_MAP)
      .filter(([, meta]) => meta.category === category)
      .map(([t]) => t);
    const categoryIncidents = incidents.filter((i) => typesInCategory.includes(i.type));
    const openCount = categoryIncidents.filter((i) => i.status === "open").length;
    const latest = categoryIncidents.sort(
      (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
    )[0];
    return {
      category,
      icon,
      openCount,
      latestRisk: latest?.riskLevel ?? null,
      latestSummary: latest?.reasoning ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSec={10} />
      <h2 className="text-2xl font-semibold">Operational Dashboard</h2>
      <KpiCards
        edgeOnline={edgeOnline}
        edgeTotal={edgeDevices.length}
        openIncidents={openIncidents}
        highCriticalRisk={highCriticalRisk}
        avgResponseTime={avgResponseTime}
      />
      <EdgeStatusPanel devices={edgeDevices} />
      <div className="grid gap-4 lg:grid-cols-2">
        <RiskBreakdown categories={riskCategories} />
        <AlertFeed
          incidents={recentIncidents.map((i) => ({
            id: i.id,
            type: i.type,
            riskLevel: i.riskLevel,
            status: i.status,
            cameraName: i.camera.name,
            detectedAt: i.detectedAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
