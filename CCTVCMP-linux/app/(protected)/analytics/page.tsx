import { prisma } from "@/lib/prisma";
import { buildAnalyticsSnapshot } from "@/lib/analytics";
import { AnalyticsCharts } from "@/components/analytics/charts";
import { AutoRefresh } from "@/components/auto-refresh";

export default async function AnalyticsPage() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const reports = await prisma.edgeReport.findMany({
    where: { receivedAt: { gte: thirtyDaysAgo } },
    select: {
      receivedAt: true,
      overallRiskLevel: true,
      peopleCount: true,
      missingHardhats: true,
      missingVests: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  const snapshot = buildAnalyticsSnapshot(reports as Parameters<typeof buildAnalyticsSnapshot>[0]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Analytics</h2>
        <p className="text-sm text-muted-foreground">Last 30 days · {snapshot.totalReports.toLocaleString()} edge reports · auto-refreshes every 60 s</p>
      </div>
      <AutoRefresh intervalSec={60} />
      <AnalyticsCharts snapshot={snapshot} />
    </div>
  );
}
