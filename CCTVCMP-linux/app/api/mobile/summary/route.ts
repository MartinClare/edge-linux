import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSyntheticEdgeCamera, ONLINE_THRESHOLD_MS } from "@/lib/camera-status";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const [openIncidents, highCriticalIncidents, cameras] = await Promise.all([
    prisma.incident.count({
      where: {
        status: { in: ["open", "acknowledged"] },
        OR: [{ notes: null }, { notes: { not: "__test__" } }],
      },
    }),
    prisma.incident.count({
      where: {
        status: { in: ["open", "acknowledged"] },
        riskLevel: { in: ["high", "critical"] },
        OR: [{ notes: null }, { notes: { not: "__test__" } }],
      },
    }),
    prisma.camera.findMany({
      select: { id: true, name: true, edgeCameraId: true, status: true, lastReportAt: true },
    }),
  ]);

  const visibleCameras = cameras.filter((camera) => !isSyntheticEdgeCamera(camera));
  const now = Date.now();
  const edgeDevicesOnline = visibleCameras.filter(
    (camera) =>
      camera.status !== "maintenance" &&
      camera.lastReportAt != null &&
      now - camera.lastReportAt.getTime() < ONLINE_THRESHOLD_MS
  ).length;

  return NextResponse.json({
    openIncidents,
    highCriticalIncidents,
    edgeDevicesOnline,
    edgeDevicesTotal: visibleCameras.length,
  });
}
