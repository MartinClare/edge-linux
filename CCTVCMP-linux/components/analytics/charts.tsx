"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  Bar,
  BarChart,
} from "recharts";
import type { AnalyticsSnapshot } from "@/lib/analytics";

const RISK_COLORS = { high: "#ef4444", medium: "#f97316", low: "#22c55e" };

export function AnalyticsCharts({ snapshot }: { snapshot: AnalyticsSnapshot }) {
  const { trend, totalReports, highRiskCount, ppeCompliance } = snapshot;

  const riskDistribution = [
    { name: "High", value: trend.reduce((s, d) => s + d.highRisk, 0), fill: RISK_COLORS.high },
    { name: "Medium", value: trend.reduce((s, d) => s + d.mediumRisk, 0), fill: RISK_COLORS.medium },
    { name: "Low", value: trend.reduce((s, d) => s + d.lowRisk, 0), fill: RISK_COLORS.low },
  ].filter((d) => d.value > 0);

  const ppeChartData = trend
    .filter((d) => d.ppeCompliance !== null)
    .map((d) => ({ date: d.date, compliance: d.ppeCompliance }));

  const noData = trend.length === 0;

  return (
    <div className="space-y-4">
      {/* KPI Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Reports (30d)" value={totalReports.toLocaleString()} sub="edge reports received" />
        <StatCard title="High-Risk Reports" value={highRiskCount.toLocaleString()} sub={`${totalReports ? Math.round((highRiskCount / totalReports) * 100) : 0}% of total`} accent="text-red-500" />
        <StatCard
          title="PPE Compliance"
          value={ppeCompliance !== null ? `${ppeCompliance}%` : "N/A"}
          sub={ppeCompliance !== null ? "when workers present" : "no workers detected"}
          accent={ppeCompliance !== null && ppeCompliance < 80 ? "text-red-500" : "text-green-500"}
        />
      </div>

      {noData ? (
        <Card>
          <CardContent className="flex h-48 items-center justify-center text-muted-foreground">
            No edge reports in the last 30 days.
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {/* Daily Report Trend */}
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Daily Report Volume & Risk (HKT)</CardTitle></CardHeader>
            <CardContent className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="highRisk" name="High Risk" stackId="a" fill={RISK_COLORS.high} />
                  <Bar dataKey="mediumRisk" name="Medium Risk" stackId="a" fill={RISK_COLORS.medium} />
                  <Bar dataKey="lowRisk" name="Low Risk" stackId="a" fill={RISK_COLORS.low} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Risk Distribution Pie */}
          <Card>
            <CardHeader><CardTitle>Risk Distribution</CardTitle></CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={riskDistribution} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${String(name ?? "")} ${Math.round((percent ?? 0) * 100)}%`}>
                    {riskDistribution.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [v, "Reports"]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* PPE Compliance Over Time */}
          <Card>
            <CardHeader><CardTitle>PPE Compliance Over Time (%)</CardTitle></CardHeader>
            <CardContent className="h-[300px]">
              {ppeChartData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No worker detections in this period.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ppeChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(v) => [`${v ?? 0}%`, "PPE Compliance"]} />
                    <Line type="monotone" dataKey="compliance" name="PPE Compliance" stroke="#06b6d4" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function StatCard({ title, value, sub, accent }: { title: string; value: string; sub: string; accent?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-3xl font-bold ${accent ?? ""}`}>{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
