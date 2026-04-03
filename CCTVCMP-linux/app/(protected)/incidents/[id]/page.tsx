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
  const incident = await prisma.incident.findUnique({
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
  });

  if (!incident) notFound();

  const evidence = incident.edgeReport;

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
          {incident.recordOnly && <Badge variant="secondary">record only</Badge>}
          <IncidentActions incidentId={incident.id} currentStatus={incident.status} />
        </div>
      </div>

      {/* Details + CMP Reasoning */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Detected" value={formatHKT(incident.detectedAt)} />
            {incident.acknowledgedAt && <Row label="Acknowledged" value={formatHKT(incident.acknowledgedAt)} />}
            {incident.resolvedAt && <Row label="Resolved" value={formatHKT(incident.resolvedAt)} />}
            {incident.dismissedAt && <Row label="Dismissed" value={formatHKT(incident.dismissedAt)} />}
            <Row label="Assigned To" value={incident.assignee?.name ?? "Unassigned"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">CMP Reasoning</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {incident.reasoning || "No reasoning available."}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Notes */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
        <CardContent>
          <IncidentNotes incidentId={incident.id} currentNotes={incident.notes} />
        </CardContent>
      </Card>

      {/* Evidence image + Edge description */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Evidence Image
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
              {/* Image */}
              <BoundingBoxCanvas
                imageUrl={evidence.eventImagePath}
                detections={extractDetections(evidence.rawJson)}
                maxHeight="480px"
              />

              {/* Metadata */}
              <div className="space-y-4">
                {/* People / PPE counts */}
                {(evidence.peopleCount != null || evidence.missingHardhats != null || evidence.missingVests != null) && (
                  <div className="flex flex-wrap gap-2 text-sm">
                    {evidence.peopleCount != null && (
                      <span className="rounded-md border px-2 py-0.5">
                        👷 {evidence.peopleCount} {evidence.peopleCount === 1 ? "person" : "people"}
                      </span>
                    )}
                    {evidence.missingHardhats != null && evidence.missingHardhats > 0 && (
                      <span className="rounded-md border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-orange-400">
                        ⛑ {evidence.missingHardhats} missing hardhat{evidence.missingHardhats > 1 ? "s" : ""}
                      </span>
                    )}
                    {evidence.missingVests != null && evidence.missingVests > 0 && (
                      <span className="rounded-md border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-orange-400">
                        🦺 {evidence.missingVests} missing vest{evidence.missingVests > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                )}

                {/* Overall description */}
                {evidence.overallDescription && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {evidence.overallDescription}
                  </p>
                )}

                <Link
                  href={`/incidents/edge-report/${evidence.id}`}
                  className="text-xs text-primary hover:underline"
                >
                  View full edge report →
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No evidence image available for this incident.</p>
          )}
        </CardContent>
      </Card>

      {/* Edge safety analysis sections */}
      {(constructionSafety || fireSafety || propertySecurity) && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Edge Safety Analysis</CardTitle></CardHeader>
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
              CMP Classification
              {cmpClassification.source && (
                <span className="text-xs font-normal text-muted-foreground">
                  via {cmpClassification.source}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Detected incidents */}
            {detectedByLLM.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Detected</p>
                {detectedByLLM.map((c, i) => (
                  <div key={i} className="rounded-md border bg-muted/20 p-3 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={riskVariant(c.riskLevel)} className="text-xs">{c.riskLevel}</Badge>
                      <span className="font-mono text-xs font-semibold">{c.type.replace(/_/g, " ")}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {Math.round(c.confidence * 100)}% confidence
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{c.reasoning}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No violations detected by CMP classifier.</p>
            )}

            {/* Non-detected classifications (collapsed) */}
            {allClassifications.length > detectedByLLM.length && (
              <details className="group">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground list-none">
                  <span className="group-open:hidden">▶ Show all {allClassifications.length} checks</span>
                  <span className="hidden group-open:block">▼ Hide</span>
                </summary>
                <div className="mt-2 space-y-1.5">
                  {allClassifications.filter((c) => !c.detected).map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground py-1 border-b last:border-0">
                      <Badge variant="secondary" className="text-xs shrink-0">not detected</Badge>
                      <span className="font-mono">{c.type.replace(/_/g, " ")}</span>
                      <span className="ml-auto">{c.reasoning}</span>
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
              CMP Vision Verification
              {visionVerif.model && (
                <span className="text-xs font-normal text-muted-foreground">{visionVerif.model}</span>
              )}
              {visionVerif.descriptionAccuracy && (
                <span className={`text-xs font-normal ${accuracyColor(visionVerif.descriptionAccuracy)}`}>
                  {visionVerif.descriptionAccuracy.replace("_", " ")}
                </span>
              )}
            </CardTitle>
            {visionVerif.summary && (
              <p className="text-xs text-muted-foreground">{visionVerif.summary}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {visionVerif.missedHazards && visionVerif.missedHazards.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-yellow-500 mb-1">Missed by edge</p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {visionVerif.missedHazards.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
              </div>
            )}
            {visionVerif.incorrectClaims && visionVerif.incorrectClaims.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-red-400 mb-1">Incorrect claims from edge</p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {visionVerif.incorrectClaims.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
            {visionVerif.visionClassifications && visionVerif.visionClassifications.filter((c) => c.detected).length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Vision-detected</p>
                <div className="space-y-1">
                  {visionVerif.visionClassifications.filter((c) => c.detected).map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <Badge variant={riskVariant(c.riskLevel)} className="shrink-0 text-xs">{c.riskLevel}</Badge>
                      <span className="font-mono">{c.type.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground">({Math.round(c.confidence * 100)}%) — {c.reasoning}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!visionVerif.missedHazards?.length && !visionVerif.incorrectClaims?.length &&
             !visionVerif.visionClassifications?.filter((c) => c.detected).length && (
              <p className="text-muted-foreground text-xs">Vision model found no additional issues.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Notification History */}
      {incident.notificationLogs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Notifications Sent</CardTitle></CardHeader>
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
