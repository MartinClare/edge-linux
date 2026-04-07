import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IncidentActions } from "@/components/incidents/incident-actions";
import { IncidentNotes } from "@/components/incidents/incident-notes";
import { AutoRefresh } from "@/components/auto-refresh";
import { BoundingBoxCanvas } from "@/components/edge-devices/bounding-box-canvas";
import type { Detection } from "@/components/edge-devices/bounding-box-canvas";
import { formatHKT } from "@/lib/utils";
import { getTranslations, getLocale } from "next-intl/server";
import type { TranslationsJson } from "@/lib/translator";

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

type SafetySection = { summary?: string; issues?: string[]; recommendations?: string[] };

function normalizeSafetySection(v: unknown): SafetySection | null {
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  return {
    summary: typeof obj.summary === "string" ? obj.summary : undefined,
    issues: Array.isArray(obj.issues) ? (obj.issues as string[]) : [],
    recommendations: Array.isArray(obj.recommendations) ? (obj.recommendations as string[]) : [],
  };
}

type Classification = {
  type: string;
  detected: boolean;
  riskLevel: string;
  confidence: number;
  reasoning: string;
};

type ClassificationJson = {
  source?: string;
  classifications?: Classification[];
};

type VisionVerification = {
  descriptionAccuracy?: string;
  missedHazards?: string[];
  incorrectClaims?: string[];
  summary?: string;
  model?: string;
  visionClassifications?: Classification[];
};

function riskVariant(level: string): "destructive" | "default" | "secondary" {
  const l = level?.toLowerCase();
  if (l === "critical" || l === "high") return "destructive";
  if (l === "medium") return "default";
  return "secondary";
}

function accuracyColor(acc: string) {
  if (acc === "accurate") return "text-green-500";
  if (acc === "partially_accurate") return "text-yellow-500";
  return "text-red-400";
}

export default async function IncidentDetailPage({ params }: { params: { id: string } }) {
  const [incident, t, locale] = await Promise.all([
    prisma.incident.findUnique({
      where: { id: params.id },
      include: {
        project: true,
        camera: true,
        zone: true,
        assignee: true,
        edgeReport: {
          select: {
            id: true,
            eventImagePath: true,
            overallRiskLevel: true,
            overallDescription: true,
            constructionSafety: true,
            fireSafety: true,
            propertySecurity: true,
            peopleCount: true,
            missingHardhats: true,
            missingVests: true,
            classificationJson: true,
            visionVerificationJson: true,
            translationsJson: true,
            receivedAt: true,
            rawJson: true,
          },
        },
        logs: {
          include: { user: { select: { name: true } } },
          orderBy: { timestamp: "asc" },
        },
        notificationLogs: {
          include: { channel: { select: { name: true, type: true } } },
          orderBy: { sentAt: "desc" },
        },
      },
    }),
    getTranslations("incidents"),
    getLocale(),
  ]);

  if (!incident) notFound();

  const evidence = incident.edgeReport;
  const translations = (evidence?.translationsJson ?? null) as TranslationsJson | null;
  const isZh = locale === "zh";

  const riskColor = incident.riskLevel === "critical" || incident.riskLevel === "high"
    ? "destructive" as const
    : "secondary" as const;

  const cmpClassification = evidence?.classificationJson as ClassificationJson | null;
  const visionVerif = evidence?.visionVerificationJson as VisionVerification | null;
  const detectedByLLM = cmpClassification?.classifications?.filter((c) => c.detected) ?? [];
  const allClassifications = cmpClassification?.classifications ?? [];

  const constructionSafety = normalizeSafetySection(evidence?.constructionSafety);
  const fireSafety = normalizeSafetySection(evidence?.fireSafety);
  const propertySecurity = normalizeSafetySection(evidence?.propertySecurity);

  // Helper: get the Chinese reasoning for a classification type if available
  function getReasoningZh(type: string, fallback: string): string {
    if (!isZh || !translations?.classifications) return fallback;
    const match = translations.classifications.find((c) => c.type === type);
    return match?.reasoning || fallback;
  }

  const overallDescriptionText = (isZh && translations?.overallDescription)
    ? translations.overallDescription
    : (evidence?.overallDescription ?? "");

  // CMP Reasoning: look up Chinese reasoning for this specific incident type
  const reasoningText = (isZh && incident.reasoning)
    ? getReasoningZh(incident.type, incident.reasoning)
    : (incident.reasoning || "");

  const visionSummaryText = (isZh && translations?.visionSummary)
    ? translations.visionSummary
    : (visionVerif?.summary ?? "");

  const missedHazardsArr = (isZh && translations?.visionMissedHazards?.length)
    ? translations.visionMissedHazards
    : (visionVerif?.missedHazards ?? []);

  const incorrectClaimsArr = (isZh && translations?.visionIncorrectClaims?.length)
    ? translations.visionIncorrectClaims
    : (visionVerif?.incorrectClaims ?? []);

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSec={15} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold capitalize">
            {incident.type.replace(/_/g, " ")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {incident.camera.name} &middot; {incident.zone?.name} &middot; {incident.project.name}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={riskColor}>{incident.riskLevel}</Badge>
          <Badge variant="outline">{incident.status.replace("_", " ")}</Badge>
          {incident.recordOnly && <Badge variant="secondary">{t("recordOnly")}</Badge>}
          <IncidentActions incidentId={incident.id} currentStatus={incident.status} />
        </div>
      </div>

      {/* Details + CMP Reasoning */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">{t("details")}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={t("detectedAt")} value={formatHKT(incident.detectedAt)} />
            {incident.acknowledgedAt && <Row label={t("acknowledgedAt")} value={formatHKT(incident.acknowledgedAt)} />}
            {incident.resolvedAt && <Row label={t("resolvedAt")} value={formatHKT(incident.resolvedAt)} />}
            {incident.dismissedAt && <Row label={t("dismissedAt")} value={formatHKT(incident.dismissedAt)} />}
            <Row label={t("assignedTo")} value={incident.assignee?.name ?? t("common.unassigned")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">{t("reasoning")}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {reasoningText || t("noReasoning")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      <Card>
        <CardHeader><CardTitle className="text-sm">{t("notes")}</CardTitle></CardHeader>
        <CardContent>
          <IncidentNotes incidentId={incident.id} currentNotes={incident.notes} />
        </CardContent>
      </Card>

      {/* Evidence image + Edge description */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            {t("evidenceImage")}
            {evidence && (
              <Badge variant={riskVariant(evidence.overallRiskLevel)} className="text-xs">
                Edge: {evidence.overallRiskLevel}
              </Badge>
            )}
            {evidence && (
              <span className="text-xs font-normal text-muted-foreground ml-1">
                Captured {formatHKT(evidence.receivedAt)}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {evidence?.eventImagePath ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <BoundingBoxCanvas
                imageUrl={evidence.eventImagePath}
                detections={extractDetections(evidence.rawJson)}
                maxHeight="480px"
              />
              <div className="space-y-4">
                {overallDescriptionText && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {overallDescriptionText}
                  </p>
                )}
                <Link
                  href={`/incidents/edge-report/${evidence.id}`}
                  className="text-xs text-primary hover:underline"
                >
                  {t("viewFullReport")}
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noEvidence")}</p>
          )}
        </CardContent>
      </Card>

      {/* Edge safety analysis sections */}
      {(constructionSafety || fireSafety || propertySecurity) && (
        <Card>
          <CardHeader><CardTitle className="text-sm">{t("edgeSafetyAnalysis")}</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            {[
              { label: "Construction Safety", data: constructionSafety, color: "text-orange-400" },
              { label: "Fire Safety", data: fireSafety, color: "text-red-400" },
              { label: "Property Security", data: propertySecurity, color: "text-blue-400" },
            ].map(({ label, data, color }) => {
              if (!data) return null;
              return (
                <div key={label}>
                  <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${color}`}>{label}</p>
                  {data.summary && (
                    <p className="text-sm text-muted-foreground leading-relaxed mb-2">{data.summary}</p>
                  )}
                  {data.issues && data.issues.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1 text-sm text-foreground/80">
                      {data.issues.map((issue, i) => <li key={i}>{issue}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* CMP Classification conclusion */}
      {cmpClassification && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              {t("cmpClassification")}
              {cmpClassification.source && (
                <span className="text-xs font-normal text-muted-foreground">
                  via {cmpClassification.source}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {detectedByLLM.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("detected")}</p>
                {detectedByLLM.map((c, i) => (
                  <div key={i} className="rounded-md border bg-muted/20 p-3 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={riskVariant(c.riskLevel)} className="text-xs">{c.riskLevel}</Badge>
                      <span className="font-mono text-xs font-semibold">{c.type.replace(/_/g, " ")}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {Math.round(c.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {getReasoningZh(c.type, c.reasoning)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("notDetected")}</p>
            )}

            {allClassifications.length > detectedByLLM.length && (
              <details className="group">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground list-none">
                  <span className="group-open:hidden">▶ {t("showAllChecks", { count: allClassifications.length })}</span>
                  <span className="hidden group-open:block">▼ {t("hide")}</span>
                </summary>
                <div className="mt-2 space-y-1.5">
                  {allClassifications.filter((c) => !c.detected).map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground py-1 border-b last:border-0">
                      <Badge variant="secondary" className="text-xs shrink-0">—</Badge>
                      <span className="font-mono">{c.type.replace(/_/g, " ")}</span>
                      <span className="ml-auto">{getReasoningZh(c.type, c.reasoning)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* CMP Vision Verification */}
      {visionVerif && (
        <Card className="border-blue-500/20">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              {t("cmpVisionVerification")}
              {visionVerif.descriptionAccuracy && (
                <span className={`text-xs font-normal ${accuracyColor(visionVerif.descriptionAccuracy)}`}>
                  {visionVerif.descriptionAccuracy.replace("_", " ")}
                </span>
              )}
            </CardTitle>
            {visionSummaryText && (
              <p className="text-xs text-muted-foreground">{visionSummaryText}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {missedHazardsArr.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-yellow-500 mb-1">{t("missedByEdge")}</p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {missedHazardsArr.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </div>
            )}
            {incorrectClaimsArr.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-red-400 mb-1">{t("incorrectClaims")}</p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {incorrectClaimsArr.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
            {visionVerif.visionClassifications?.filter((c) => c.detected).length ? (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{t("visionDetected")}</p>
                <div className="space-y-1">
                  {visionVerif.visionClassifications.filter((c) => c.detected).map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <Badge variant={riskVariant(c.riskLevel)} className="shrink-0 text-xs">{c.riskLevel}</Badge>
                      <span className="font-mono">{c.type.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground">({Math.round(c.confidence * 100)}%) — {getReasoningZh(c.type, c.reasoning)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {!missedHazardsArr.length && !incorrectClaimsArr.length &&
             !visionVerif.visionClassifications?.filter((c) => c.detected).length && (
              <p className="text-muted-foreground text-xs">{t("noVision")}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Notification History */}
      {incident.notificationLogs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">{t("notificationsSent")}</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {incident.notificationLogs.map((nl) => (
                <div key={nl.id} className="flex items-center justify-between text-sm border-b pb-2">
                  <div>
                    <span className="font-medium">{nl.channel.name}</span>
                    <span className="text-muted-foreground"> ({nl.channel.type})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={nl.status === "sent" ? "secondary" : "destructive"}>
                      {nl.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatHKT(nl.sentAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
