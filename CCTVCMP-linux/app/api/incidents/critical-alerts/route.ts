/**
 * GET /api/incidents/critical-alerts?since=<ISO-8601>
 *
 * Returns open incidents of the three critical alert categories that were
 * created after the `since` timestamp.  Used by the CriticalAlertPopup
 * component to poll for new popup-worthy events.
 *
 * Requires an authenticated session cookie (standard cookie auth).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth";
import { CRITICAL_ALERT_TYPES } from "@/lib/alarm-engine";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 60_000);

  if (Number.isNaN(since.getTime())) {
    return NextResponse.json({ message: "Invalid `since` timestamp" }, { status: 400 });
  }

  const incidents = await prisma.incident.findMany({
    where: {
      type: { in: [...CRITICAL_ALERT_TYPES] as import("@prisma/client").IncidentType[] },
      riskLevel: { in: ["high", "critical"] },
      status: { in: ["open"] },
      detectedAt: { gt: since },
    },
    include: {
      camera: { select: { name: true, id: true } },
      project: { select: { name: true } },
    },
    orderBy: { detectedAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ incidents });
}
