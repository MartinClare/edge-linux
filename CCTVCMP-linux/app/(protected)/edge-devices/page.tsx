import { prisma } from "@/lib/prisma";
import { EdgeDeviceList } from "@/components/edge-devices/edge-device-list";
import { RegisterDeviceForm } from "@/components/edge-devices/register-device-form";
import { AutoRefresh } from "@/components/auto-refresh";

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export default async function EdgeDevicesPage() {
  const [cameras, projects] = await Promise.all([
    prisma.camera.findMany({
    include: {
      project: { select: { id: true, name: true } },
      zone: { select: { id: true, name: true } },
      edgeReports: {
        orderBy: { receivedAt: "desc" },
        take: 10,
        select: {
          id: true,
          overallRiskLevel: true,
          overallDescription: true,
          eventImagePath: true,
          receivedAt: true,
        },
      },
      _count: { select: { incidents: true, edgeReports: true } },
    },
    orderBy: { createdAt: "desc" },
  }),
    prisma.project.findMany({
      include: { zones: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const now = Date.now();
  const devices = cameras.map((cam) => {
    const latestReport = cam.edgeReports[0] ?? null;
    const latestAlertEvidence =
      cam.edgeReports.find(
        (r) =>
          (r.overallRiskLevel === "Medium" || r.overallRiskLevel === "High" || r.overallRiskLevel === "Critical") &&
          !!r.eventImagePath
      ) ?? null;

    return {
      id: cam.id,
      name: cam.name,
      edgeCameraId: cam.edgeCameraId,
      status: cam.status,
      lastReportAt: cam.lastReportAt?.toISOString() ?? null,
      createdAt: cam.createdAt.toISOString(),
      project: cam.project,
      zone: cam.zone,
      isOnline:
        cam.status !== "maintenance" &&
        cam.lastReportAt != null &&
        now - cam.lastReportAt.getTime() < ONLINE_THRESHOLD_MS,
      latestReport: latestReport
        ? {
            ...latestReport,
            receivedAt: latestReport.receivedAt.toISOString(),
          }
        : null,
      latestAlertEvidence: latestAlertEvidence
        ? {
            id: latestAlertEvidence.id,
            overallRiskLevel: latestAlertEvidence.overallRiskLevel,
            eventImagePath: latestAlertEvidence.eventImagePath!,
            receivedAt: latestAlertEvidence.receivedAt.toISOString(),
          }
        : null,
      incidentCount: cam._count.incidents,
      reportCount: cam._count.edgeReports,
    };
  });

  const onlineCount = devices.filter((d) => d.isOnline).length;

  const projectList = projects.map((p) => ({
    id: p.id,
    name: p.name,
    zones: p.zones,
  }));

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSec={10} />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Edge Devices</h2>
          <p className="text-sm text-muted-foreground">
            {onlineCount} online / {devices.length} total
          </p>
        </div>
        <RegisterDeviceForm projects={projectList} />
      </div>
      <EdgeDeviceList devices={devices} />
    </div>
  );
}
