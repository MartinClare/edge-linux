import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHKT } from "@/lib/utils";
import { BoundingBoxCanvas } from "@/components/edge-devices/bounding-box-canvas";
import type { Detection } from "@/components/edge-devices/bounding-box-canvas";
import { getTranslations, getLocale } from "next-intl/server";
import type { TranslationsJson } from "@/lib/translator";

type Props = { params: { id: string } };

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

function riskBadgeVariant(level: string): "secondary" | "default" | "destructive" {
  const v = level.toLowerCase();
  if (v === "critical" || v === "high") return "destructive";
  if (v === "medium") return "default";
  return "secondary";
}

export default async function EdgeReportDetailPage({ params }: Props) {
  const [report, t, locale] = await Promise.all([
    prisma.edgeReport.findUnique({
      where: { id: params.id },
      include: {
        camera: {
          select: { id: true, name: true, edgeCameraId: true, status: true, streamUrl: true },
        },
      },
    }),
    getTranslations("edgeReport"),
    getLocale(),
  ]);

  if (!report) notFound();

  const isZh = locale === "zh";
  const translations = (report.translationsJson ?? null) as TranslationsJson | null;

  const overallDescriptionText = (isZh && translations?.overallDescription)
    ? translations.overallDescription
    : (report.overallDescription || "");

  function getReasoningZh(type: string, fallback: string): string {
    if (!isZh || !translations?.classifications) return fallback;
    const match = translations.classifications.find((c) => c.type === type);
    return match?.reasoning || fallback;
  }

  const visionSummaryText = (isZh && translations?.visionSummary)
    ? translations.visionSummary
    : undefined;

  const missedHazardsArr = (isZh && translations?.visionMissedHazards?.length)
    ? translations.visionMissedHazards
    : undefined;

  const incorrectClaimsArr = (isZh && translations?.visionIncorrectClaims?.length)
    ? translations.visionIncorrectClaims
    : undefined;

  const detections = extractDetections(report.rawJson);

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSec={10} />

      {report.keepalive && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400">
          <strong>{t("keepaliveWarning")}</strong>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("reportId")} {report.id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("edgeLabel")}</span>
          <Badge variant={riskBadgeVariant(report.overallRiskLevel)}>{report.overallRiskLevel}</Badge>
          {report.cmpRiskLevel && (
            <>
              <span className="text-xs text-muted-foreground">{t("cmpLabel")}</span>
              <Badge variant={riskBadgeVariant(report.cmpRiskLevel)}>{report.cmpRiskLevel}</Badge>
            </>
          )}
          <Badge variant="outline">{report.messageType}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">{t("summary")}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label={t("cameraName")} value={report.cameraName} />
          <Row label={t("edgeCameraId")} value={report.edgeCameraId} />
          <Row label={t("cameraCmp")} value={report.camera?.name ?? "—"} />
          <Row label={t("timestamp")} value={formatHKT(report.eventTimestamp ?? report.receivedAt)} />
          <Row label={t("receivedAt")} value={formatHKT(report.receivedAt)} />
          {report.camera?.streamUrl && (
            <div className="pt-1">
              <span className="text-muted-foreground">{t("cameraStream")}</span>
              <div>
                <a className="text-primary hover:underline break-all" href={report.camera.streamUrl} target="_blank" rel="noreferrer">
                  {report.camera.streamUrl}
                </a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CmpConclusionCard
        classificationJson={report.classificationJson}
        visionVerificationJson={report.visionVerificationJson}
        cmpRiskLevel={report.cmpRiskLevel}
        getReasoningZh={getReasoningZh}
        visionSummaryOverride={visionSummaryText}
        missedHazardsOverride={missedHazardsArr}
        incorrectClaimsOverride={incorrectClaimsArr}
        isZh={isZh}
        t={t}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            {t("evidenceImage")}
            {detections.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {detections.length} {detections.length > 1 ? t("detectionsPlural", { count: detections.length }) : t("detections", { count: detections.length })}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.eventImagePath ? (
            <BoundingBoxCanvas imageUrl={report.eventImagePath} detections={detections} maxHeight="70vh" />
          ) : (
            <p className="text-sm text-muted-foreground">{t("noImage")}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">{t("constructionSafety")}</CardTitle></CardHeader>
          <CardContent><SafetyReportSection data={report.constructionSafety} t={t} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">{t("fireSafety")}</CardTitle></CardHeader>
          <CardContent><SafetyReportSection data={report.fireSafety} t={t} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">{t("propertySecurity")}</CardTitle></CardHeader>
          <CardContent><SafetyReportSection data={report.propertySecurity} t={t} /></CardContent>
        </Card>
      </div>

      {report.visionVerificationJson && (
        <VisionVerificationCard
          data={report.visionVerificationJson}
          summaryOverride={visionSummaryText}
          missedHazardsOverride={missedHazardsArr}
          incorrectClaimsOverride={incorrectClaimsArr}
          getReasoningZh={getReasoningZh}
          t={t}
        />
      )}

      <Card className="border-muted/40">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">{t("edgeDescription")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {overallDescriptionText || t("noDescription")}
          </p>
        </CardContent>
      </Card>

      <div>
        <Link href="/incidents" className="text-sm text-primary hover:underline">
          {t("backToIncidents")}
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-all">{value}</span>
    </div>
  );
}

type SafetyData = { summary: string; issues: string[]; recommendations: string[] };

function normalizeSafetyData(value: unknown): SafetyData {
  if (!value || typeof value !== "object") {
    return { summary: "No data provided.", issues: [], recommendations: [] };
  }
  const obj = value as Record<string, unknown>;
  return {
    summary: typeof obj.summary === "string" && obj.summary.trim() ? obj.summary : "No summary provided.",
    issues: Array.isArray(obj.issues) ? obj.issues.filter((x): x is string => typeof x === "string") : [],
    recommendations: Array.isArray(obj.recommendations) ? obj.recommendations.filter((x): x is string => typeof x === "string") : [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SafetyReportSection({ data, t }: { data: unknown; t: any }) {
  const s = normalizeSafetyData(data);
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("summaryLabel")}</p>
        <p className="mt-1 whitespace-pre-wrap">{s.summary}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("issuesLabel")}</p>
        {s.issues.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {s.issues.map((item, idx) => <li key={idx}>{item}</li>)}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground">{t("noIssues")}</p>
        )}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("recommendationsLabel")}</p>
        {s.recommendations.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {s.recommendations.map((item, idx) => <li key={idx}>{item}</li>)}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground">{t("noRecommendations")}</p>
        )}
      </div>
    </div>
  );
}

type VisionVerification = {
  descriptionAccuracy?: string;
  missedHazards?: string[];
  incorrectClaims?: string[];
  summary?: string;
  visionClassifications?: Array<{ type: string; detected: boolean; riskLevel: string; confidence: number; reasoning: string }>;
};

function accuracyColor(acc: string): string {
  if (acc === "accurate") return "text-green-500";
  if (acc === "partially_accurate") return "text-yellow-500";
  return "text-red-500";
}

function VisionVerificationCard({
  data,
  summaryOverride,
  missedHazardsOverride,
  incorrectClaimsOverride,
  getReasoningZh,
  t,
}: {
  data: unknown;
  summaryOverride?: string;
  missedHazardsOverride?: string[];
  incorrectClaimsOverride?: string[];
  getReasoningZh: (type: string, fallback: string) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const v = data as VisionVerification;
  const detected = (v.visionClassifications ?? []).filter((c) => c.detected);
  const displaySummary = summaryOverride ?? v.summary;
  const displayMissed = missedHazardsOverride ?? v.missedHazards ?? [];
  const displayIncorrect = incorrectClaimsOverride ?? v.incorrectClaims ?? [];

  return (
    <Card className="border-blue-500/30 bg-blue-950/10">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <span>{t("visionVerification")}</span>
          {v.descriptionAccuracy && (
            <span className={`text-xs font-normal ${accuracyColor(v.descriptionAccuracy)}`}>
              {v.descriptionAccuracy.replace("_", " ")}
            </span>
          )}
        </CardTitle>
        {displaySummary && <p className="text-xs text-muted-foreground">{displaySummary}</p>}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {displayMissed.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-yellow-500 mb-1">{t("missedByEdge")}</p>
            <ul className="list-disc pl-5 space-y-1">
              {displayMissed.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </div>
        )}
        {displayIncorrect.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-red-400 mb-1">{t("incorrectClaims")}</p>
            <ul className="list-disc pl-5 space-y-1">
              {displayIncorrect.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )}
        {detected.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{t("visionDetectedIncidents")}</p>
            <div className="space-y-1">
              {detected.map((c, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge variant={riskBadgeVariant(c.riskLevel)} className="shrink-0 text-xs">{c.riskLevel}</Badge>
                  <span className="font-mono text-xs">{c.type}</span>
                  <span className="text-muted-foreground text-xs">
                    ({Math.round(c.confidence * 100)}%) — {getReasoningZh(c.type, c.reasoning)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {detected.length === 0 && !displayMissed.length && !displayIncorrect.length && (
          <p className="text-muted-foreground text-xs">{t("noVision")}</p>
        )}
      </CardContent>
    </Card>
  );
}

type ClassificationItem = {
  type: string;
  detected: boolean;
  riskLevel: string;
  confidence: number;
  reasoning: string;
};

function CmpConclusionCard({
  classificationJson,
  visionVerificationJson,
  cmpRiskLevel,
  getReasoningZh,
  visionSummaryOverride,
  missedHazardsOverride,
  incorrectClaimsOverride,
  isZh,
  t,
}: {
  classificationJson: unknown;
  visionVerificationJson: unknown;
  cmpRiskLevel: string | null;
  getReasoningZh: (type: string, fallback: string) => string;
  visionSummaryOverride?: string;
  missedHazardsOverride?: string[];
  incorrectClaimsOverride?: string[];
  isZh: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const cls = classificationJson as { classifications?: ClassificationItem[]; source?: string; classifierModel?: string } | null;
  const vv = visionVerificationJson as VisionVerification | null;

  const detected = (cls?.classifications ?? []).filter((c) => c.detected);
  const source = cls?.source ?? "llm";

  // Build a prose summary
  let proseSummary = "";
  if (detected.length === 0) {
    proseSummary = t("notFoundYet");
  } else {
    const parts = detected.map(
      (c) => `${c.type.replace(/_/g, " ")} (${c.riskLevel}, ${Math.round(c.confidence * 100)}%)`
    );
    proseSummary = detected.length > 1
      ? t("foundIncidentsPlural", { parts: parts.join("; ") })
      : t("foundIncidents", { parts: parts.join("; ") });
  }

  const visionSummary = isZh
    ? (visionSummaryOverride ?? vv?.summary?.trim())
    : vv?.summary?.trim();
  if (visionSummary) proseSummary += ` ${t("visionAssessment", { summary: visionSummary })}`;

  const missed = isZh ? (missedHazardsOverride ?? vv?.missedHazards ?? []) : (vv?.missedHazards ?? []);
  const incorrect = isZh ? (incorrectClaimsOverride ?? vv?.incorrectClaims ?? []) : (vv?.incorrectClaims ?? []);

  if (missed.length > 0) proseSummary += ` ${t("additionalHazards", { hazards: missed.join("; ") })}`;
  if (incorrect.length > 0) proseSummary += ` ${t("unconfirmedClaims", { claims: incorrect.join("; ") })}`;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          {t("cmpConclusion")}
          {cmpRiskLevel && (
            <Badge variant={riskBadgeVariant(cmpRiskLevel)} className="ml-1">{cmpRiskLevel}</Badge>
          )}
          {source === "vision" && (
            <span className="text-xs text-muted-foreground font-normal">· {t("textImageVerified")}</span>
          )}
          {source === "llm" && (
            <span className="text-xs text-muted-foreground font-normal">· {t("textAnalysis")}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="whitespace-pre-wrap leading-relaxed">{proseSummary}</p>

        {detected.length > 0 && (
          <div className="space-y-2 pt-1 border-t border-border/40">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("detectedIncidents")}</p>
            {detected.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <Badge variant={riskBadgeVariant(c.riskLevel)} className="shrink-0 text-xs mt-0.5">
                  {c.riskLevel}
                </Badge>
                <div>
                  <span className="font-medium">{c.type.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground ml-2 text-xs">({Math.round(c.confidence * 100)}%)</span>
                  {c.reasoning && (
                    <p className="text-muted-foreground text-xs mt-0.5">
                      {getReasoningZh(c.type, c.reasoning)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!classificationJson && (
          <p className="text-muted-foreground text-xs">{t("notProcessed")}</p>
        )}
      </CardContent>
    </Card>
  );
}
