type AnalyticsReport = {
  receivedAt: Date;
  overallRiskLevel: string;
  cmpRiskLevel: string | null;
  peopleCount: number | null;
  missingHardhats: number | null;
  missingVests: number | null;
  keepalive: boolean;
  messageType: string;
};

export type TrendPoint = {
  date: string;
  totalReports: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
  /** PPE compliance %, null when no people were detected that day */
  ppeCompliance: number | null;
};

export type AnalyticsSnapshot = {
  trend: TrendPoint[];
  totalReports: number;
  highRiskCount: number;
  totalPeopleDetected: number;
  /** Overall PPE compliance %, null when no people detected */
  ppeCompliance: number | null;
};

/** Derive all analytics from real EdgeReport rows. Excludes keepalive-only rows. */
export function buildAnalyticsSnapshot(reports: AnalyticsReport[]): AnalyticsSnapshot {
  const dailyMap = new Map<
    string,
    { total: number; high: number; medium: number; low: number; withPeople: number; ppeCompliant: number }
  >();

  let totalHighRisk = 0;
  let totalWithPeople = 0;
  let totalPpeCompliant = 0;
  let totalPeopleDetected = 0;
  let totalReports = 0;

  for (const r of reports) {
    if (r.keepalive || r.messageType === "keepalive") continue;

    // Shift UTC → HKT (+8 h) then take YYYY-MM-DD
    const hktMs = r.receivedAt.getTime() + 8 * 60 * 60 * 1000;
    const hktDate = new Date(hktMs).toISOString().slice(0, 10);

    if (!dailyMap.has(hktDate)) {
      dailyMap.set(hktDate, { total: 0, high: 0, medium: 0, low: 0, withPeople: 0, ppeCompliant: 0 });
    }
    const day = dailyMap.get(hktDate)!;
    day.total++;
    totalReports++;

    const risk = (r.cmpRiskLevel || r.overallRiskLevel || "Low").toLowerCase();
    if (risk === "high") { day.high++; totalHighRisk++; }
    else if (risk === "critical") { day.high++; totalHighRisk++; }
    else if (risk === "medium") day.medium++;
    else day.low++;

    const people = r.peopleCount ?? 0;
    totalPeopleDetected += people;

    if (people > 0) {
      day.withPeople++;
      totalWithPeople++;
      const compliant = (r.missingHardhats ?? 0) === 0 && (r.missingVests ?? 0) === 0;
      if (compliant) { day.ppeCompliant++; totalPpeCompliant++; }
    }
  }

  const trend: TrendPoint[] = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      totalReports: v.total,
      highRisk: v.high,
      mediumRisk: v.medium,
      lowRisk: v.low,
      ppeCompliance: v.withPeople > 0 ? Math.round((v.ppeCompliant / v.withPeople) * 100) : null,
    }));

  return {
    trend,
    totalReports,
    highRiskCount: totalHighRisk,
    totalPeopleDetected,
    ppeCompliance: totalWithPeople > 0 ? Math.round((totalPpeCompliant / totalWithPeople) * 100) : null,
  };
}
