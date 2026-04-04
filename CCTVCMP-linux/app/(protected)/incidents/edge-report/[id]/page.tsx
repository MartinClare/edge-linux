import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatHKT } from "@/lib/utils";
import { BoundingBoxCanvas } from "@/components/edge-devices/bounding-box-canvas";
import type { Detection } from "@/components/edge-devices/bounding-box-canvas";

type Props = { params: { id: string } };

/** Extract the validated detections array from rawJson stored by the webhook handler. */
function extractDetections(rawJson: unknown): Detection[] {
  if (!rawJson || typeof rawJson !== "object") return [];
  const payload = rawJson as Record<string, unknown>;
  const analysis = payload.analysis && typeof payload.analysis === "object"
    ? (payload.analysis as Record<string, unknown>)
    : payload;
  const dets = analysis.detections;
  if (!Array.isArray(dets)) return [];
  return dets
    .filter(
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
  const report = await prisma.edgeReport.findUnique({
    where: { id: params.id },
    include: {
      camera: {
        select: {
          id: true,
          name: true,
          edgeCameraId: true,
          status: true,
          streamUrl: true,
        },
      },
    },
  });

  if (!report) notFound();

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSec={10} />

      {report.keepalive && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400">
          <strong>Keepalive report</strong> — this is a heartbeat message from the edge device. No AI analysis was performed on this frame. Risk level and detections shown below reflect the raw heartbeat, not a safety assessment.
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Edge Risk Record Details</h2>
          <p className="text-sm text-muted-foreground">
            Report ID: {report.id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Edge:</span>
          <Badge variant={riskBadgeVariant(report.overallRiskLevel)}>{report.overallRiskLevel}</Badge>
          {report.cmpRiskLevel && (
            <>
              <span className="text-xs text-muted-foreground">CMP:</span>
              <Badge variant={riskBadgeVariant(report.cmpRiskLevel)}>{report.cmpRiskLevel}</Badge>
            </>
          )}
          <Badge variant="outline">{report.messageType}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Camera Name" value={report.cameraName} />
          <Row label="Edge Camera ID" value={report.edgeCameraId} />
          <Row label="Camera (CMP)" value={report.camera?.name ?? "—"} />
          <Row label="Timestamp" value={formatHKT(report.eventTimestamp ?? report.receivedAt)} />
          <Row label="Received At" value={formatHKT(report.receivedAt)} />
          {report.camera?.streamUrl && (
            <div className="pt-1">
              <span className="text-muted-foreground">Camera Stream</span>
              <div>
                <a className="text-primary hover:underline break-all" href={report.camera.streamUrl} target="_blank" rel="noreferrer">
                  {report.camera.streamUrl}
                </a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CMP Overall Conclusion — derived from classificationJson + visionVerificationJson */}
      <CmpConclusionCard
        classificationJson={report.classificationJson}
        visionVerificationJson={report.visionVerificationJson}
        cmpRiskLevel={report.cmpRiskLevel}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Evidence Image
            {extractDetections(report.rawJson).length > 0 && (
              <Badge variant="outline" className="text-xs">
                {extractDetections(report.rawJson).length} detection{extractDetections(report.rawJson).length > 1 ? "s" : ""}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.eventImagePath ? (
            <div className="space-y-3">
              <BoundingBoxCanvas
                imageUrl={report.eventImagePath}
                detections={extractDetections(report.rawJson)}
                maxHeight="70vh"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No image attached for this record.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Construction Safety</CardTitle>
          </CardHeader>
          <CardContent>
            <SafetyReportSection data={report.constructionSafety} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Fire Safety</CardTitle>
          </CardHeader>
          <CardContent>
            <SafetyReportSection data={report.fireSafety} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Property Security</CardTitle>
          </CardHeader>
          <CardContent>
            <SafetyReportSection data={report.propertySecurity} />
          </CardContent>
        </Card>
      </div>

      {report.visionVerificationJson && (
        <VisionVerificationCard data={report.visionVerificationJson} />
      )}

      {/* Edge original description — secondary reference */}
      <Card className="border-muted/40">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Edge Original Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{report.overallDescription || "No description."}</p>
        </CardContent>
      </Card>

      <div>
        <Link href="/incidents" className="text-sm text-primary hover:underline">
          ← Back to incidents
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

type SafetyData = {
  summary: string;
  issues: string[];
  recommendations: string[];
};

function normalizeSafetyData(value: unknown): SafetyData {
  if (!value || typeof value !== "object") {
    return { summary: "No data provided.", issues: [], recommendations: [] };
  }
  const obj = value as Record<string, unknown>;
  return {
    summary: typeof obj.summary === "string" && obj.summary.trim() ? obj.summary : "No summary provided.",
    issues: Array.isArray(obj.issues) ? obj.issues.filter((x): x is string => typeof x === "string") : [],
    recommendations: Array.isArray(obj.recommendations)
      ? obj.recommendations.filter((x): x is string => typeof x === "string")
      : [],
  };
}

type VisionVerification = {
  descriptionAccuracy?: string;
  missedHazards?: string[];
  incorrectClaims?: string[];
  summary?: string;
  visionClassifications?: Array<{
    type: string;
    detected: boolean;
    riskLevel: string;
    confidence: number;
    reasoning: string;
  }>;
};

function accuracyColor(acc: string): string {
  if (acc === "accurate") return "text-green-500";
  if (acc === "partially_accurate") return "text-yellow-500";
  return "text-red-500";
}

function VisionVerificationCard({ data }: { data: unknown }) {
  const v = data as VisionVerification;
  const detected = (v.visionClassifications ?? []).filter((c) => c.detected);

  return (
    <Card className="border-blue-500/30 bg-blue-950/10">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <span>CMP Vision Verification</span>
          {v.descriptionAccuracy && (
            <span className={`text-xs font-normal ${accuracyColor(v.descriptionAccuracy)}`}>
              {v.descriptionAccuracy.replace("_", " ")}
            </span>
          )}
        </CardTitle>
        {v.summary && (
          <p className="text-xs text-muted-foreground">{v.summary}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {v.missedHazards && v.missedHazards.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-yellow-500 mb-1">Missed by edge</p>
            <ul className="list-disc pl-5 space-y-1">
              {v.missedHazards.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          </div>
        )}
        {v.incorrectClaims && v.incorrectClaims.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-red-400 mb-1">Incorrect claims from edge</p>
            <ul className="list-disc pl-5 space-y-1">
              {v.incorrectClaims.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )}
        {detected.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Vision-detected incidents</p>
            <div className="space-y-1">
              {detected.map((c, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge variant={riskBadgeVariant(c.riskLevel)} className="shrink-0 text-xs">{c.riskLevel}</Badge>
                  <span className="font-mono text-xs">{c.type}</span>
                  <span className="text-muted-foreground text-xs">({Math.round(c.confidence * 100)}%) — {c.reasoning}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {detected.length === 0 && !v.missedHazards?.length && !v.incorrectClaims?.length && (
          <p className="text-muted-foreground text-xs">Vision model found no additional issues.</p>
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
}: {
  classificationJson: unknown;
  visionVerificationJson: unknown;
  cmpRiskLevel: string | null;
}) {
  const cls = classificationJson as { classifications?: ClassificationItem[]; source?: string; classifierModel?: string } | null;
  const vv = visionVerificationJson as VisionVerification | null;

  const detected = (cls?.classifications ?? []).filter((c) => c.detected);
  const source = cls?.source ?? "llm";
  const model = cls?.classifierModel;

  // Build a prose summary from detected incidents
  let proseSummary = "";
  if (detected.length === 0) {
    proseSummary = "CMP analysis found no safety incidents in this report.";
  } else {
    const parts = detected.map(
      (c) => `${c.type.replace(/_/g, " ")} (${c.riskLevel}, ${Math.round(c.confidence * 100)}% confidence)`
    );
    proseSummary = `CMP identified the following incident${detected.length > 1 ? "s" : ""}: ${parts.join("; ")}.`;
  }

  // Append vision summary if available
  const visionSummary = vv?.summary?.trim();
  if (visionSummary) {
    proseSummary += ` Vision assessment: ${visionSummary}`;
  }

  // Append corrections from vision verifier
  const missed = vv?.missedHazards ?? [];
  const incorrect = vv?.incorrectClaims ?? [];
  if (missed.length > 0) {
    proseSummary += ` Additional hazards identified by CMP vision: ${missed.join("; ")}.`;
  }
  if (incorrect.length > 0) {
    proseSummary += ` Edge claims not confirmed by CMP: ${incorrect.join("; ")}.`;
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          CMP Overall Conclusion
          {cmpRiskLevel && (
            <Badge variant={riskBadgeVariant(cmpRiskLevel)} className="ml-1">
              {cmpRiskLevel}
            </Badge>
          )}
          {source === "vision" && (
            <span className="text-xs text-muted-foreground font-normal">· text + image verified</span>
          )}
          {source === "llm" && (
            <span className="text-xs text-muted-foreground font-normal">· text analysis</span>
          )}
        </CardTitle>
        {model && (
          <p className="text-xs text-muted-foreground">Model: {model}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="whitespace-pre-wrap leading-relaxed">{proseSummary}</p>

        {detected.length > 0 && (
          <div className="space-y-2 pt-1 border-t border-border/40">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Detected incidents</p>
            {detected.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <Badge variant={riskBadgeVariant(c.riskLevel)} className="shrink-0 text-xs mt-0.5">
                  {c.riskLevel}
                </Badge>
                <div>
                  <span className="font-medium">{c.type.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground ml-2 text-xs">({Math.round(c.confidence * 100)}%)</span>
                  {c.reasoning && (
                    <p className="text-muted-foreground text-xs mt-0.5">{c.reasoning}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!classificationJson && (
          <p className="text-muted-foreground text-xs">CMP has not yet processed this report.</p>
        )}
      </CardContent>
    </Card>
  );
}

function SafetyReportSection({ data }: { data: unknown }) {
  const s = normalizeSafetyData(data);
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Summary</p>
        <p className="mt-1 whitespace-pre-wrap">{s.summary}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Issues</p>
        {s.issues.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {s.issues.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground">No issues reported.</p>
        )}
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Recommendations</p>
        {s.recommendations.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {s.recommendations.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground">No recommendations provided.</p>
        )}
      </div>
    </div>
  );
}
