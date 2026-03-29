import { z } from "zod";

/**
 * Inbound edge webhook schema for POST /api/webhook/edge-report.
 *
 * This app lives in **CCTVCMP-linux** — a standalone CMP copy inside the edge-linux monorepo (not a submodule
 * of another repo). Keep in sync with: `../../python/app/cmp_webhook.py` (`build_edge_report_json_body`).
 *
 * Normalize risk labels from Gemini / edge (any casing) to CMP enum values.
 */
export function normalizeOverallRiskLevel(input: unknown): "Low" | "Medium" | "High" | "Critical" {
  if (typeof input !== "string") return "Low";
  const s = input.trim().toLowerCase();
  if (s === "low") return "Low";
  if (s === "medium") return "Medium";
  if (s === "high") return "High";
  if (s === "critical") return "Critical";
  return "Low";
}

function coerceSafetyCategory(input: unknown): { summary: string; issues: string[]; recommendations: string[] } {
  if (!input || typeof input !== "object") {
    return { summary: "", issues: [], recommendations: [] };
  }
  const o = input as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary : "";
  const issues = Array.isArray(o.issues) ? o.issues.filter((x): x is string => typeof x === "string") : [];
  const recommendations = Array.isArray(o.recommendations)
    ? o.recommendations.filter((x): x is string => typeof x === "string")
    : [];
  return { summary, issues, recommendations };
}

const analysisSchema = z
  .object({
    overallDescription: z.union([z.string(), z.null()]).optional(),
    overallRiskLevel: z.union([z.string(), z.null()]).optional(),
    constructionSafety: z.unknown().optional(),
    fireSafety: z.unknown().optional(),
    propertySecurity: z.unknown().optional(),
    peopleCount: z.number().nullish(),
    missingHardhats: z.number().nullish(),
    missingVests: z.number().nullish(),
  })
  .transform((a) => ({
    overallDescription: a.overallDescription ?? "",
    overallRiskLevel: normalizeOverallRiskLevel(a.overallRiskLevel),
    constructionSafety: coerceSafetyCategory(a.constructionSafety),
    fireSafety: coerceSafetyCategory(a.fireSafety),
    propertySecurity: coerceSafetyCategory(a.propertySecurity),
    peopleCount: a.peopleCount ?? null,
    missingHardhats: a.missingHardhats ?? null,
    missingVests: a.missingVests ?? null,
  }));

function truthyFlag(v: unknown): boolean {
  return v === true || v === 1 || String(v).toLowerCase() === "true";
}

/** Heartbeat / keepalive: explicit flags or common aliases from edge firmware / docs. */
function inferKeepalivePayload(o: Record<string, unknown>): boolean {
  if (truthyFlag(o.keepalive)) return true;
  const mt = String(o.messageType ?? "").trim().toLowerCase();
  if (mt === "keepalive" || mt === "heartbeat") return true;
  for (const key of ["type", "eventType", "event_type"] as const) {
    const t = String(o[key] ?? "").trim().toLowerCase();
    if (t === "heartbeat" || t === "keepalive") return true;
  }
  return false;
}

/**
 * edge-linux Python sends JSON only (`alarm_observer._send_to_central_server`): nested `analysis` each cycle.
 * That is effectively a liveness signal (updates `lastReportAt`) but is stored as `messageType: analysis`.
 * Some builds also send explicit keepalive/heartbeat posts — we normalize those here.
 */
function normalizeEdgeWebhookPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;

  const isKeepalive = inferKeepalivePayload(o);
  const messageType: "analysis" | "keepalive" = isKeepalive ? "keepalive" : "analysis";

  const timestamp =
    typeof o.timestamp === "string" && o.timestamp.trim()
      ? o.timestamp
      : new Date().toISOString();

  const hasNestedAnalysis = o.analysis != null && typeof o.analysis === "object" && !Array.isArray(o.analysis);
  if (hasNestedAnalysis) {
    const edgeCameraId = o.edgeCameraId ?? o.edge_camera_id;
    const cameraName = o.cameraName ?? o.camera_name ?? "";
    return {
      ...o,
      timestamp,
      edgeCameraId: typeof edgeCameraId === "string" ? edgeCameraId : o.edgeCameraId,
      cameraName: typeof cameraName === "string" ? cameraName : "",
      messageType,
      keepalive: isKeepalive,
      eventImageIncluded: o.eventImageIncluded === true,
      analysis: o.analysis,
    };
  }

  const edgeCameraId = o.edgeCameraId ?? o.edge_camera_id ?? o.camera_id;
  if (typeof edgeCameraId !== "string" || !edgeCameraId.trim()) {
    return raw;
  }

  const cameraName = typeof (o.cameraName ?? o.camera_name) === "string" ? String(o.cameraName ?? o.camera_name) : "";

  return {
    edgeCameraId: edgeCameraId.trim(),
    cameraName,
    timestamp,
    messageType,
    keepalive: isKeepalive,
    eventImageIncluded: o.eventImageIncluded === true,
    analysis: {
      overallDescription: o.overallDescription,
      overallRiskLevel: o.overallRiskLevel,
      constructionSafety: o.constructionSafety,
      fireSafety: o.fireSafety,
      propertySecurity: o.propertySecurity,
      peopleCount: o.peopleCount,
      missingHardhats: o.missingHardhats,
      missingVests: o.missingVests,
    },
  };
}

export const edgeReportSchema = z.preprocess(
  normalizeEdgeWebhookPayload,
  z
    .object({
      edgeCameraId: z.string().min(1),
      cameraName: z.string().default(""),
      timestamp: z.string(),
      messageType: z.enum(["analysis", "keepalive"]).default("analysis"),
      keepalive: z.boolean().default(false),
      eventImageIncluded: z.boolean().default(false),
      analysis: analysisSchema.optional(),
    })
    .superRefine((val, ctx) => {
      const isKeepalive = val.keepalive || val.messageType === "keepalive";
      if (!isKeepalive && val.messageType === "analysis" && !val.analysis) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["analysis"],
          message: "analysis is required when messageType is 'analysis'",
        });
      }
    })
);

export type EdgeReportPayload = z.infer<typeof edgeReportSchema>;
