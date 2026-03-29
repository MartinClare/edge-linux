import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildAnalyticsSnapshot } from "@/lib/analytics";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("projectId");
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const reports = await prisma.edgeReport.findMany({
    where: {
      receivedAt: { gte: thirtyDaysAgo },
      ...(projectId ? { camera: { projectId } } : {}),
    },
    select: {
      receivedAt: true,
      overallRiskLevel: true,
      peopleCount: true,
      missingHardhats: true,
      missingVests: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  return NextResponse.json({ data: buildAnalyticsSnapshot(reports as Parameters<typeof buildAnalyticsSnapshot>[0]) });
}
