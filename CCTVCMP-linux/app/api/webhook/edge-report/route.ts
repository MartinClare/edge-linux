import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { edgeReportSchema } from "@/lib/validations/webhook";
import { classifyAnalysis } from "@/lib/llm-classifier";
import { evaluateAlarms, ensureDefaultRules } from "@/lib/alarm-engine";
import { verifyWithVision, reconcileClassifications } from "@/lib/vision-verifier";

// ── LLM rate limiting ─────────────────────────────────────────────────────────
//
// The edge sends one webhook per camera every `geminiInterval` seconds (default 5 s,
// rotating through N cameras).  Without a gate the CMP would call the LLM on every
// incoming report, burning tokens and hitting API rate limits.
//
// Design:
//   • One LLM call (text + optional vision) per camera per LLM_RATE_LIMIT_MS.
//   • Hard minimum: 60 000 ms (1 per minute), regardless of env var.
//   • Vision has its own (longer) limit since it sends the full JPEG.
//   • Rate-limited reports are still stored and still receive a risk level — the
//     last successful classification is propagated so the UI is never stale.
//   • The in-memory Maps reset on cold start (Vercel): at most one extra call per
//     warm-up, which is acceptable.
//
// Configure via env vars (values below are in seconds):
//   LLM_RATE_LIMIT_SECONDS   — text classifier   (default 60, min 60)
//   VISION_RATE_LIMIT_SECONDS — vision verifier   (default 120, min 60)

const _parseSec = (key: string, fallback: number) =>
  Math.max(60, parseInt(process.env[key] ?? String(fallback)) || fallback);

const LLM_RATE_LIMIT_MS    = _parseSec("LLM_RATE_LIMIT_SECONDS",    60)  * 1000;
const VISION_RATE_LIMIT_MS = _parseSec("VISION_RATE_LIMIT_SECONDS", 120) * 1000;

/** cameraId → ms timestamp of last LLM call for that camera. */
const lastTextLLMAt   = new Map<string, number>();
const lastVisionLLMAt = new Map<string, number>();

function getApiKey(request: NextRequest): string | null {
  return request.headers.get("x-api-key") ?? request.headers.get("X-API-Key");
}

/** All analysis reports are forwarded for CMP classification and alarm evaluation.
 *  CMP decides which incidents to create based on its own alarm rules — the edge
 *  does not gate by risk level. */
function isAnalysisReport(messageType: string, keepalive: boolean): boolean {
  return messageType === "analysis" && !keepalive;
}

async function parseRequestBody(request: NextRequest): Promise<
  | { ok: true; payload: unknown; image: { bytes: Buffer; mimeType: string } | null }
  | { ok: false; message: string }
> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return { ok: false, message: "Invalid multipart form-data" };
    }

    const payloadField = form.get("payload");
    if (typeof payloadField !== "string" || payloadField.trim() === "") {
      return { ok: false, message: "Missing multipart field: payload" };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadField);
    } catch {
      return { ok: false, message: "Invalid JSON in multipart payload field" };
    }

    const imageField = form.get("image");
    if (imageField instanceof File) {
      const mimeType = imageField.type || "image/jpeg";
      const bytes = Buffer.from(await imageField.arrayBuffer());
      return { ok: true, payload, image: { bytes, mimeType } };
    }

    return { ok: true, payload, image: null };
  }

  if (contentType.includes("application/json") || contentType === "") {
    try {
      return { ok: true, payload: await request.json(), image: null };
    } catch {
      return { ok: false, message: "Invalid JSON" };
    }
  }

  return { ok: false, message: "Unsupported Content-Type" };
}

/**
 * Derive the highest risk level across all detected classifications.
 * This is the CMP's own overall assessment — independent of what the edge reported.
 */
function deriveCmpRiskLevel(classifications: import("@/lib/llm-classifier").Classification[]): string {
  const ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const detected = classifications.filter((c) => c.detected);
  if (detected.length === 0) return "Low";
  const top = detected.reduce((best, c) =>
    (ORDER[c.riskLevel] ?? 0) > (ORDER[best.riskLevel] ?? 0) ? c : best
  );
  // Capitalise first letter to match stored overallRiskLevel format ("Low","Medium","High","Critical")
  return top.riskLevel.charAt(0).toUpperCase() + top.riskLevel.slice(1);
}

/**
 * Propagate the last successful classification to a rate-limited report so
 * every report in the UI has a cmpRiskLevel and classificationJson, even when
 * the LLM was skipped.  Alarm evaluation is re-run against the cached result
 * so incidents still fire on the correct schedule.
 */
async function propagateLastClassification(
  edgeReportId: string,
  cameraContext: { cameraId: string; projectId: string; zoneId: string },
  detectedAt: Date,
  throttledForMs: number
) {
  const last = await prisma.edgeReport.findFirst({
    where: {
      cameraId: cameraContext.cameraId,
      NOT: { classificationJson: { equals: Prisma.JsonNull } },
      id: { not: edgeReportId },
    },
    orderBy: { receivedAt: "desc" },
    select: { classificationJson: true, cmpRiskLevel: true },
  });

  if (last?.classificationJson && last.cmpRiskLevel) {
    await prisma.edgeReport.update({
      where: { id: edgeReportId },
      data: {
        cmpRiskLevel: last.cmpRiskLevel,
        classificationJson: last.classificationJson,
      },
    });

    // Still run alarm evaluation so dedup logic sees consecutive hits
    const cachedResult = last.classificationJson as { classifications: import("@/lib/llm-classifier").Classification[] };
    if (Array.isArray(cachedResult?.classifications)) {
      await evaluateAlarms(
        { classifications: cachedResult.classifications, source: "llm" },
        cameraContext,
        edgeReportId,
        detectedAt
      );
    }

    console.log(
      `[webhook] Rate-limited camera=${cameraContext.cameraId} (${(throttledForMs / 1000).toFixed(1)}s < ${LLM_RATE_LIMIT_MS / 1000}s min) — propagated last classification (${last.cmpRiskLevel})`
    );
  } else {
    console.log(
      `[webhook] Rate-limited camera=${cameraContext.cameraId} — no previous classification to propagate yet`
    );
  }
}

/**
 * Background task: classify the saved EdgeReport, optionally verify with the
 * image, reconcile the two, then evaluate alarms.
 * Runs after the HTTP response is already sent so the edge device isn't blocked.
 *
 * Rate limiting: at most one LLM call per camera per LLM_RATE_LIMIT_MS (text)
 * and per VISION_RATE_LIMIT_MS (vision).  Rate-limited reports still receive
 * a cmpRiskLevel by propagating the previous classification.
 */
async function processReportBackground(
  edgeReportId: string,
  analysis: Parameters<typeof classifyAnalysis>[0],
  cameraContext: { cameraId: string; projectId: string; zoneId: string },
  detectedAt: Date,
  imageBytes?: Buffer,
  imageMimeType?: string
) {
  try {
    await ensureDefaultRules();

    const now = Date.now();
    const { cameraId } = cameraContext;

    // ── Text-classifier rate gate ─────────────────────────────────────────────
    const timeSinceText = now - (lastTextLLMAt.get(cameraId) ?? 0);
    if (timeSinceText < LLM_RATE_LIMIT_MS) {
      await propagateLastClassification(edgeReportId, cameraContext, detectedAt, timeSinceText);
      return;
    }
    lastTextLLMAt.set(cameraId, now);

    // 1. Text-based classification (LLM or keyword fallback)
    const textClassification = await classifyAnalysis(analysis);
    console.log(
      `[webhook] LLM text classify camera=${cameraId} source=${textClassification.source} model=${textClassification.classifierModel ?? "fallback"} ` +
      `detected=${textClassification.classifications.filter((c) => c.detected).map((c) => c.type).join(",") || "none"} ` +
      `(last was ${(timeSinceText / 1000).toFixed(1)}s ago)`
    );

    let finalClassification = textClassification;

    // ── Vision-verifier rate gate ─────────────────────────────────────────────
    const canRunVision = imageBytes && imageMimeType;
    if (canRunVision) {
      const timeSinceVision = now - (lastVisionLLMAt.get(cameraId) ?? 0);
      if (timeSinceVision >= VISION_RATE_LIMIT_MS) {
        lastVisionLLMAt.set(cameraId, now);

        const visionResult = await verifyWithVision(imageBytes, imageMimeType, analysis).catch((err) => {
          console.error("[webhook] Vision verification failed:", err);
          return null;
        });

        if (visionResult) {
          const reconciledClassifications = reconcileClassifications(
            textClassification.classifications,
            visionResult.visionClassifications
          );
          finalClassification = {
            classifications: reconciledClassifications,
            source: "vision",
            classifierModel: textClassification.classifierModel,
            visionVerification: visionResult,
          };
          console.log(
            `[webhook] Vision verify camera=${cameraId} accuracy=${visionResult.descriptionAccuracy} ` +
            `missed=${visionResult.missedHazards.length} incorrect=${visionResult.incorrectClaims.length} ` +
            `(last was ${(timeSinceVision / 1000).toFixed(1)}s ago)`
          );
        }
      } else {
        console.log(
          `[webhook] Vision rate-limited camera=${cameraId} (${(timeSinceVision / 1000).toFixed(1)}s < ${VISION_RATE_LIMIT_MS / 1000}s min) — text-only classification used`
        );
      }
    }

    const cmpRiskLevel = deriveCmpRiskLevel(finalClassification.classifications);

    await prisma.edgeReport.update({
      where: { id: edgeReportId },
      data: {
        classificationJson: finalClassification as object,
        cmpRiskLevel,
        visionVerificationJson: finalClassification.visionVerification
          ? (finalClassification.visionVerification as object)
          : undefined,
      },
    });

    await evaluateAlarms(finalClassification, cameraContext, edgeReportId, detectedAt);
  } catch (err) {
    console.error("[webhook] Background processing failed for report", edgeReportId, err);
  }
}

export async function POST(request: NextRequest) {
  const apiKey = getApiKey(request);
  const expectedKey = process.env.EDGE_API_KEY;
  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  // Optional bearer token for edge-side auth context (currently not enforced by CMP).
  request.headers.get("authorization");

  const parsedBody = await parseRequestBody(request);
  if (!parsedBody.ok) {
    return NextResponse.json({ message: parsedBody.message }, { status: 400 });
  }

  const parsed = edgeReportSchema.safeParse(parsedBody.payload);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.flatten() }, { status: 400 });
  }

  const {
    edgeCameraId,
    cameraName,
    streamUrl,
    timestamp,
    messageType,
    keepalive,
    eventImageIncluded,
    analysis,
  } = parsed.data;

  // edge-linux Python sends JSON only (no multipart). Only reject if client explicitly
  // claims an image without uploading one.
  if (eventImageIncluded === true && !parsedBody.image) {
    return NextResponse.json(
      { message: "eventImageIncluded=true but multipart image file is missing" },
      { status: 400 }
    );
  }

  // --- Resolve or auto-create camera ---
  let camera = await prisma.camera.findUnique({
    where: { edgeCameraId },
    include: { project: true, zone: true },
  });

  if (!camera) {
    let project = await prisma.project.findFirst();
    let zone = await prisma.zone.findFirst({ where: { projectId: project?.id } });
    if (!project) {
      project = await prisma.project.create({
        data: { name: "Edge Site", location: "Edge" },
      });
    }
    if (!zone) {
      zone = await prisma.zone.create({
        data: { projectId: project.id, name: "Default", riskLevel: "medium" },
      });
    }
    camera = await prisma.camera.create({
      data: {
        name: cameraName || edgeCameraId,
        edgeCameraId,
        streamUrl: streamUrl.trim() || null,
        projectId: project.id,
        zoneId: zone.id,
      },
      include: { project: true, zone: true },
    });
  }

  // Ensure camera has a zone
  let zoneId = camera.zoneId;
  if (!zoneId) {
    const zone =
      (await prisma.zone.findFirst({ where: { projectId: camera.projectId } })) ??
      (await prisma.zone.create({
        data: { projectId: camera.projectId, name: "Default", riskLevel: "medium" },
      }));
    zoneId = zone.id;
    await prisma.camera.update({ where: { id: camera.id }, data: { zoneId } });
  }

  // --- 1. Persist EdgeReport (full payload in rawJson) ---
  const detectedAt = new Date(timestamp);
  const eventTimestamp = Number.isNaN(detectedAt.getTime()) ? new Date() : detectedAt;
  const fullPayload = {
    edgeCameraId,
    cameraName,
    streamUrl,
    timestamp,
    messageType,
    keepalive,
    eventImageIncluded: eventImageIncluded || !!parsedBody.image,
    analysis: analysis ?? null,
  };
  const edgeReport = await prisma.edgeReport.create({
    data: {
      cameraId: camera.id,
      edgeCameraId,
      cameraName,
      messageType,
      keepalive,
      eventImageIncluded: eventImageIncluded || !!parsedBody.image,
      eventImageMimeType: parsedBody.image?.mimeType ?? null,
      eventImageData: parsedBody.image?.bytes ?? null,
      eventTimestamp,
      overallRiskLevel: analysis?.overallRiskLevel ?? "Low",
      overallDescription:
        analysis?.overallDescription ??
        (messageType === "keepalive" || keepalive ? "Keepalive heartbeat" : ""),
      constructionSafety: analysis?.constructionSafety as object | undefined,
      fireSafety: analysis?.fireSafety as object | undefined,
      propertySecurity: analysis?.propertySecurity as object | undefined,
      peopleCount: analysis?.peopleCount ?? null,
      missingHardhats: analysis?.missingHardhats ?? null,
      missingVests: analysis?.missingVests ?? null,
      // detections stored in rawJson.analysis.detections (no separate column needed)
      rawJson: fullPayload as object,
    },
  });

  if (parsedBody.image) {
    await prisma.edgeReport.update({
      where: { id: edgeReport.id },
      data: { eventImagePath: `/api/edge-reports/${edgeReport.id}/image` },
    });
  }

  // --- 2. Update Camera.lastReportAt and sync current edge metadata ---
  // Use CMP server receive time (new Date()), NOT the edge device's timestamp.
  // This ensures clock drift on the edge box never causes false-offline readings.
  await prisma.camera.update({
    where: { id: camera.id },
    data: {
      lastReportAt: new Date(),
      status: "online",
      name: cameraName || camera.name,
      streamUrl: streamUrl.trim() || camera.streamUrl,
    },
  });

  // --- 3. Fire background processing for ALL analysis reports (CMP decides severity) ---
  if (analysis && isAnalysisReport(messageType, keepalive)) {
    processReportBackground(
      edgeReport.id,
      analysis as Parameters<typeof classifyAnalysis>[0],
      { cameraId: camera.id, projectId: camera.projectId, zoneId },
      eventTimestamp,
      parsedBody.image?.bytes,
      parsedBody.image?.mimeType
    ).catch(() => { /* already logged inside */ });
  }

  // --- 4. Respond immediately so the edge device isn't kept waiting ---
  return NextResponse.json({ success: true }, { status: 200 });
}
