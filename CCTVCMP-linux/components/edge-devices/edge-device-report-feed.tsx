"use client";

/**
 * EdgeDeviceReportFeed — shows all analysis messages received from an edge camera,
 * styled like the PPE-UI monitoring panel on the edge box itself.
 *
 * Features:
 *  • Filter tabs: All / Analysis / Alerts (non-low) / Keepalive
 *  • Each report card shows: image with bounding boxes, risk badges, description,
 *    PPE stats, detected incident types, construction/fire/property summaries
 *  • Keepalive reports shown as compact heartbeat rows
 *  • "View full record" link to the edge-report detail page
 */

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatHKT } from "@/lib/utils";
import { BoundingBoxCanvas } from "@/components/edge-devices/bounding-box-canvas";
import type { Detection } from "@/components/edge-devices/bounding-box-canvas";

/** Extract validated detections from rawJson (same logic as edge-report detail page). */
function extractDetections(rawJson: unknown): Detection[] {
  if (!rawJson || typeof rawJson !== "object") return [];
  const payload = rawJson as Record<string, unknown>;
  const analysis = payload.analysis && typeof payload.analysis === "object"
    ? (payload.analysis as Record<string, unknown>)
    : payload;
  const dets = analysis.detections;
  if (!Array.isArray(dets)) return [];
  return dets.filter(
    (d): d is Detection =>
      d !== null &&
      typeof d === "object" &&
      typeof (d as Record<string, unknown>).label === "string" &&
      Array.isArray((d as Record<string, unknown>).bbox) &&
      ((d as Record<string, unknown>).bbox as unknown[]).length === 4
  );
}

type SafetySection = {
  summary?: string;
  issues?: string[];
  recommendations?: string[];
};

type Classification = {
  type: string;
  detected: boolean;
  riskLevel: string;
  confidence: number;
  reasoning?: string;
};

type Report = {
  id: string;
  receivedAt: string;
  messageType: string;
  keepalive: boolean;
  overallRiskLevel: string;
  cmpRiskLevel: string | null;
  overallDescription: string;
  eventImagePath: string | null;
  eventImageIncluded: boolean;
  peopleCount: number | null;
  missingHardhats: number | null;
  missingVests: number | null;
  constructionSafety: unknown;
  fireSafety: unknown;
  propertySecurity: unknown;
  classificationJson: unknown;
  /** Full webhook payload; contains analysis.detections (bounding boxes). */
  rawJson: unknown;
};

type FilterMode = "all" | "analysis" | "alerts" | "keepalive";

const INCIDENT_LABELS: Record<string, string> = {
  ppe_violation:        "PPE Violation",
  fall_risk:            "Fall Risk",
  fire_detected:        "Fire",
  smoke_detected:       "Smoke",
  machinery_hazard:     "Machinery Hazard",
  restricted_zone_entry:"Restricted Zone",
  smoking:              "Smoking",
  near_miss:            "Near Miss",
};

const CRITICAL_TYPES = new Set(["ppe_violation", "smoking", "fire_detected", "machinery_hazard"]);

function riskVariant(level: string): "destructive" | "default" | "secondary" {
  const l = level.toLowerCase();
  if (l === "critical" || l === "high") return "destructive";
  if (l === "medium") return "default";
  return "secondary";
}

function riskBorderColor(level: string): string {
  const l = level.toLowerCase();
  if (l === "critical") return "border-l-red-600";
  if (l === "high") return "border-l-orange-500";
  if (l === "medium") return "border-l-yellow-500";
  return "border-l-green-600";
}

function parseSafety(raw: unknown): SafetySection {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    summary: typeof r.summary === "string" ? r.summary : undefined,
    issues: Array.isArray(r.issues) ? (r.issues as string[]) : [],
    recommendations: Array.isArray(r.recommendations) ? (r.recommendations as string[]) : [],
  };
}

function parseClassifications(raw: unknown): Classification[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.classifications)) return [];
  return (r.classifications as Classification[]).filter((c) => c.detected);
}

function KeepaliveRow({ report }: { report: Report }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-lg border border-border/40 bg-muted/20 text-xs text-muted-foreground">
      <span className="h-2 w-2 rounded-full bg-green-500/60" />
      <span className="font-medium text-green-400/80">Heartbeat</span>
      <span className="ml-auto">{formatHKT(report.receivedAt)}</span>
      <Link href={`/incidents/edge-report/${report.id}`} className="hover:text-foreground underline">
        #
      </Link>
    </div>
  );
}

function ReportCard({ report }: { report: Report }) {
  const [expanded, setExpanded] = useState(false);
  const construction = parseSafety(report.constructionSafety);
  const fire = parseSafety(report.fireSafety);
  const property = parseSafety(report.propertySecurity);
  const detectedIncidents = parseClassifications(report.classificationJson);
  const criticalDetected = detectedIncidents.filter((c) => CRITICAL_TYPES.has(c.type));

  // Effective risk — prefer CMP assessment
  const displayRisk = report.cmpRiskLevel ?? report.overallRiskLevel;

  return (
    <Card className={`border-l-4 ${riskBorderColor(displayRisk)}`}>
      <CardContent className="p-0">
        {/* ── Top bar ─────────────────────────────────────────── */}
        <div className="flex items-start gap-3 p-4">
          {/* Image with bounding-box overlay */}
          {report.eventImagePath && (() => {
            const dets = extractDetections(report.rawJson);
            return (
              <div className="shrink-0 w-36">
                <BoundingBoxCanvas
                  imageUrl={report.eventImagePath}
                  detections={dets}
                  className="rounded-md"
                />
              </div>
            );
          })()}
          {!report.eventImagePath && report.eventImageIncluded && (
            <div className="h-24 w-32 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center text-xs text-muted-foreground">
              Image pending
            </div>
          )}

          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Risk badges + time */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={riskVariant(displayRisk)}>{displayRisk.toUpperCase()}</Badge>
              {report.cmpRiskLevel && report.cmpRiskLevel !== report.overallRiskLevel && (
                <span className="text-xs text-muted-foreground">
                  Edge: <Badge variant={riskVariant(report.overallRiskLevel)} className="text-xs">{report.overallRiskLevel}</Badge>
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground shrink-0">
                {formatHKT(report.receivedAt)}
              </span>
            </div>

            {/* Description */}
            <p className="text-sm leading-relaxed line-clamp-2">{report.overallDescription || "No description."}</p>

            {/* PPE stats row */}
            {(report.peopleCount != null || report.missingHardhats != null || report.missingVests != null) && (
              <div className="flex flex-wrap gap-3 text-xs">
                {report.peopleCount != null && (
                  <span className="text-muted-foreground">
                    👥 <span className="font-medium text-foreground">{report.peopleCount}</span> people
                  </span>
                )}
                {report.missingHardhats != null && report.missingHardhats > 0 && (
                  <span className="text-red-400 font-semibold">
                    ⛑ {report.missingHardhats} missing hardhat{report.missingHardhats > 1 ? "s" : ""}
                  </span>
                )}
                {report.missingVests != null && report.missingVests > 0 && (
                  <span className="text-orange-400 font-semibold">
                    🦺 {report.missingVests} missing vest{report.missingVests > 1 ? "s" : ""}
                  </span>
                )}
                {(report.missingHardhats === 0 && report.missingVests === 0 && (report.peopleCount ?? 0) > 0) && (
                  <span className="text-green-400">✓ PPE compliant</span>
                )}
              </div>
            )}

            {/* Critical incident type badges */}
            {criticalDetected.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {criticalDetected.map((c) => (
                  <Badge key={c.type} variant="destructive" className="text-xs gap-1">
                    ⚠ {INCIDENT_LABELS[c.type] ?? c.type}
                  </Badge>
                ))}
              </div>
            )}

            {/* Other detected incidents */}
            {detectedIncidents.filter((c) => !CRITICAL_TYPES.has(c.type)).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {detectedIncidents.filter((c) => !CRITICAL_TYPES.has(c.type)).map((c) => (
                  <Badge key={c.type} variant="default" className="text-xs">
                    {INCIDENT_LABELS[c.type] ?? c.type}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Expandable detail ───────────────────────────────── */}
        <div className="px-4 pb-3 flex items-center gap-3 border-t border-border/30 pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? "▲ Hide details" : "▼ Show details"}
          </Button>
          <Link
            href={`/incidents/edge-report/${report.id}`}
            className="text-xs text-primary hover:underline ml-auto"
          >
            Full record →
          </Link>
        </div>

        {expanded && (
          <div className="px-4 pb-4 grid gap-3 md:grid-cols-3 border-t border-border/20 pt-3">
            <SafetySection title="Construction Safety" data={construction} />
            <SafetySection title="Fire Safety" data={fire} />
            <SafetySection title="Property Security" data={property} />

            {/* Classification reasoning */}
            {detectedIncidents.length > 0 && (
              <div className="md:col-span-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">CMP Classification</p>
                {detectedIncidents.map((c) => (
                  <div key={c.type} className="flex items-start gap-2 text-xs">
                    <Badge variant={riskVariant(c.riskLevel)} className="shrink-0 text-xs">{c.riskLevel}</Badge>
                    <span className="font-medium">{INCIDENT_LABELS[c.type] ?? c.type}</span>
                    <span className="text-muted-foreground">({Math.round(c.confidence * 100)}%) — {c.reasoning}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SafetySection({ title, data }: { title: string; data: SafetySection }) {
  const hasIssues = (data.issues?.length ?? 0) > 0;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
      {data.summary && <p className="text-xs text-foreground/80">{data.summary}</p>}
      {hasIssues && (
        <ul className="text-xs text-orange-400 space-y-0.5 pl-3 list-disc">
          {data.issues!.map((issue, i) => <li key={i}>{issue}</li>)}
        </ul>
      )}
      {!data.summary && !hasIssues && (
        <p className="text-xs text-muted-foreground/60 italic">No issues</p>
      )}
    </div>
  );
}

const FILTER_LABELS: Record<FilterMode, string> = {
  all: "All",
  analysis: "Analysis",
  alerts: "Alerts Only",
  keepalive: "Heartbeats",
};

export function EdgeDeviceReportFeed({ reports }: { reports: Report[] }) {
  const [filter, setFilter] = useState<FilterMode>("analysis");

  const filtered = reports.filter((r) => {
    if (filter === "keepalive") return r.keepalive || r.messageType === "keepalive";
    if (filter === "analysis") return !r.keepalive && r.messageType !== "keepalive";
    if (filter === "alerts") {
      const risk = (r.cmpRiskLevel ?? r.overallRiskLevel).toLowerCase();
      return !r.keepalive && (risk === "high" || risk === "critical" || risk === "medium");
    }
    return true;
  });

  const analysisCount = reports.filter((r) => !r.keepalive && r.messageType !== "keepalive").length;
  const alertCount = reports.filter((r) => {
    const risk = (r.cmpRiskLevel ?? r.overallRiskLevel).toLowerCase();
    return !r.keepalive && (risk === "high" || risk === "critical");
  }).length;
  const keepaliveCount = reports.filter((r) => r.keepalive || r.messageType === "keepalive").length;

  const counts: Record<FilterMode, number> = {
    all: reports.length,
    analysis: analysisCount,
    alerts: alertCount,
    keepalive: keepaliveCount,
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {(["analysis", "alerts", "all", "keepalive"] as FilterMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setFilter(mode)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors
              ${filter === mode
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
          >
            {FILTER_LABELS[mode]}
            <span className="ml-1.5 opacity-70">{counts[mode]}</span>
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          Showing {filtered.length} of {reports.length} records
        </span>
      </div>

      {/* Feed */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">
          No records match this filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) =>
            r.keepalive || r.messageType === "keepalive"
              ? <KeepaliveRow key={r.id} report={r} />
              : <ReportCard key={r.id} report={r} />
          )}
        </div>
      )}
    </div>
  );
}
