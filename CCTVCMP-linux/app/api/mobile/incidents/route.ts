import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveMobilePublicBaseUrl } from "@/lib/runtime-config";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, limitParam)) : 40;

  const publicBaseUrl = await resolveMobilePublicBaseUrl(request.url);

  const incidents = await prisma.incident.findMany({
    where: {
      OR: [{ notes: null }, { notes: { not: "__test__" } }],
    },
    select: {
      id: true,
      type: true,
      riskLevel: true,
      status: true,
      recordOnly: true,
      reasoning: true,
      notes: true,
      detectedAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      dismissedAt: true,
      camera: { select: { name: true } },
      project: { select: { name: true } },
      zone: { select: { name: true } },
      assignee: { select: { name: true } },
      edgeReport: {
        select: {
          id: true,
          overallRiskLevel: true,
          overallDescription: true,
          receivedAt: true,
        },
      },
    },
    orderBy: { detectedAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    incidents: incidents.map((incident) => ({
      ...incident,
      edgeReport: incident.edgeReport
        ? {
            ...incident.edgeReport,
            imageUrl: `${publicBaseUrl}/api/edge-reports/${incident.edgeReport.id}/image`,
          }
        : null,
    })),
  });
}
