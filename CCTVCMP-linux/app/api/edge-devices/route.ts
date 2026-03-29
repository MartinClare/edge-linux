import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { ONLINE_THRESHOLD_MS } from "@/lib/camera-status";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const cameras = await prisma.camera.findMany({
    include: {
      project: { select: { id: true, name: true } },
      zone: { select: { id: true, name: true } },
      edgeReports: {
        orderBy: { receivedAt: "desc" },
        take: 1,
        select: {
          id: true,
          overallRiskLevel: true,
          overallDescription: true,
          peopleCount: true,
          receivedAt: true,
        },
      },
      _count: { select: { incidents: true, edgeReports: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();
  const data = cameras.map((cam) => ({
    ...cam,
    streamUrl: cam.streamUrl,
    isOnline:
      cam.status !== "maintenance" &&
      cam.lastReportAt != null &&
      now - cam.lastReportAt.getTime() < ONLINE_THRESHOLD_MS,
    latestReport: cam.edgeReports[0] ?? null,
  }));

  return NextResponse.json({ data });
}

const createSchema = z.object({
  name: z.string().min(1),
  edgeCameraId: z.string().min(1),
  streamUrl: z.string().trim().min(1).optional(),
  projectId: z.string().min(1),
  zoneId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });

  const existing = await prisma.camera.findUnique({ where: { edgeCameraId: parsed.data.edgeCameraId } });
  if (existing) {
    return NextResponse.json({ message: "Edge camera ID already registered" }, { status: 409 });
  }

  const camera = await prisma.camera.create({
    data: {
      name: parsed.data.name,
      edgeCameraId: parsed.data.edgeCameraId,
      streamUrl: parsed.data.streamUrl,
      projectId: parsed.data.projectId,
      zoneId: parsed.data.zoneId,
    },
  });

  return NextResponse.json({ data: camera }, { status: 201 });
}
