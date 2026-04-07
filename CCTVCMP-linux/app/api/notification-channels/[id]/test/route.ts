import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { classifyAnalysis } from "@/lib/llm-classifier";
import { verifyWithVision, reconcileClassifications } from "@/lib/vision-verifier";
import { sendTestRunEmail } from "@/lib/notifications/email";
import { sendWebhook } from "@/lib/notifications/webhook";
import type { AlarmEvalResult } from "@/lib/notifications/email";
import type { IncidentRiskLevel } from "@prisma/client";
import { readFile } from "fs/promises";
import { join } from "path";

const IMAGE_DIR =
  process.env.IMAGE_STORAGE_PATH ?? join(process.cwd(), "..", "data", "images");
const TEST_IMAGE_PATH = join(IMAGE_DIR, "_test-notification-sample.jpg");
const EDGE_ANALYZE_URL =
  process.env.EDGE_ANALYZE_URL?.trim() || "http://127.0.0.1:3001/api/analyze-image";

const RISK_ORDER: Record<IncidentRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

type EdgeAnalysisPayload = Parameters<typeof classifyAnalysis>[0];

async function runEdgeAnalysis(
  imageBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<EdgeAnalysisPayload> {
  const form = new FormData();
  const imageArrayBuffer = new ArrayBuffer(imageBuffer.byteLength);
  new Uint8Array(imageArrayBuffer).set(imageBuffer);
  form.set("image", new Blob([imageArrayBuffer], { type: mimeType }), fileName);

  let response: Response;
  try {
    response = await fetch(EDGE_ANALYZE_URL, {
      method: "POST",
      body: form,
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Edge analyzer is not connected at ${EDGE_ANALYZE_URL}: ${message}`);
  }

  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; error?: string; data?: EdgeAnalysisPayload }
    | null;

  if (!response.ok || !payload?.success || !payload.data) {
    throw new Error(
      payload?.error ||
        `Edge analyzer request failed (${response.status})`
    );
  }

  return payload.data;
}

/**
 * POST /api/notification-channels/[id]/test
 *
 * Full dry-run of the CMP classification pipeline:
 *   1. Load the selected test image.
 *   2. Run the real edge analyzer on that image to produce edge analysis input.
 *   3. Run CMP text classification against the real edge analysis.
 *   4. Run vision verifier against the same image.
 *   4. Reconcile text + vision classifications.
 *   5. Evaluate alarm rules in-memory (reads rules from DB, no writes).
 *   6. Send a rich HTML email summarising every pipeline step.
 *
 * Nothing is written to the database.
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const channel = await prisma.notificationChannel.findUnique({
    where: { id: context.params.id },
  });
  if (!channel) {
    return NextResponse.json({ message: "Channel not found" }, { status: 404 });
  }

  // ── 1. Load image — uploaded takes priority, falls back to saved default ──
  let imageBuffer: Buffer | null = null;
  let imageMimeType = "image/jpeg";
  let imageFileName = "test-image.jpg";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const file = form.get("image");
      if (file instanceof File && file.size > 0) {
        imageBuffer = Buffer.from(await file.arrayBuffer());
        imageMimeType = file.type || "image/jpeg";
        imageFileName = file.name || "uploaded-test-image";
        console.log(`[TestRun] Using uploaded image: ${file.name} (${file.size} bytes)`);
      }
    } catch {
      console.warn("[TestRun] Failed to parse uploaded image — falling back to default");
    }
  }
  if (!imageBuffer) {
    try {
      imageBuffer = await readFile(TEST_IMAGE_PATH);
      imageMimeType = "image/jpeg";
      imageFileName = "_test-notification-sample.jpg";
      console.log("[TestRun] Using default test image");
    } catch {
      console.warn(`[TestRun] Default test image not found at ${TEST_IMAGE_PATH} — proceeding without image`);
    }
  }

  if (!imageBuffer) {
    return NextResponse.json(
      {
        success: false,
        message: "No test image available. Upload an image or restore the default test image.",
      },
      { status: 500 }
    );
  }

  // ── 2. Real edge analysis ────────────────────────────────────────────────
  const edgeAnalysis = await runEdgeAnalysis(imageBuffer, imageMimeType, imageFileName);
  console.log(`[TestRun] Edge analysis result: riskLevel=${edgeAnalysis.overallRiskLevel} people=${edgeAnalysis.peopleCount} missingHats=${edgeAnalysis.missingHardhats} detections=${edgeAnalysis.detections?.length ?? 0}`);
  console.log(`[TestRun] Edge description: ${edgeAnalysis.overallDescription?.slice(0, 200)}`);

  // ── 3. Text classification ───────────────────────────────────────────────
  const classificationResult = await classifyAnalysis(edgeAnalysis);

  // ── 4. Vision verification ───────────────────────────────────────────────
  const visionResult = await verifyWithVision(imageBuffer, imageMimeType, edgeAnalysis);

  // ── 5. Reconcile text + vision ───────────────────────────────────────────
  const finalClassifications =
    visionResult
      ? reconcileClassifications(
          classificationResult.classifications,
          visionResult.visionClassifications
        )
      : classificationResult.classifications;

  // ── 6. In-memory alarm evaluation (no DB writes) ─────────────────────────
  const rules = await prisma.alarmRule.findMany({ where: { enabled: true } });
  const ruleMap = new Map(rules.map((r) => [r.incidentType, r]));

  const alarmEval: AlarmEvalResult[] = finalClassifications.map((cls) => {
    if (!cls.detected) {
      return { type: cls.type, wouldCreate: false, reason: "not detected" };
    }
    const rule = ruleMap.get(cls.type);
    if (!rule) {
      return { type: cls.type, wouldCreate: false, reason: "no alarm rule configured" };
    }
    if (cls.confidence < rule.minConfidence) {
      return {
        type: cls.type,
        wouldCreate: false,
        reason: `confidence ${(cls.confidence * 100).toFixed(0)}% < required ${(rule.minConfidence * 100).toFixed(0)}%`,
      };
    }
    if (RISK_ORDER[cls.riskLevel] < RISK_ORDER[rule.minRiskLevel]) {
      return {
        type: cls.type,
        wouldCreate: false,
        reason: `risk level "${cls.riskLevel}" below rule minimum "${rule.minRiskLevel}"`,
      };
    }
    return {
      type: cls.type,
      wouldCreate: true,
      riskLevel: cls.riskLevel,
      reason: cls.reasoning,
    };
  });

  // ── 7. Send notification ──────────────────────────────────────────────────
  let status = "sent";
  let error: string | null = null;

  try {
    switch (channel.type) {
      case "email":
        await sendTestRunEmail(channel.config as Record<string, unknown>, {
          edgeDescription: edgeAnalysis.overallDescription,
          classificationResult,
          visionResult,
          finalClassifications,
          alarmEval,
          imageBuffer,
        });
        break;

      case "webhook": {
        // For webhooks, send a structured JSON summary of the dry-run results.
        const triggered = alarmEval.filter((a) => a.wouldCreate);
        await sendWebhook(channel.config as Record<string, unknown>, {
          id: "test-dry-run",
          projectId: "test",
          cameraId: "test",
          zoneId: "test",
          edgeReportId: null,
          type: (triggered[0]?.type ?? "ppe_violation") as import("@prisma/client").IncidentType,
          riskLevel: (triggered[0]?.riskLevel ?? "high") as IncidentRiskLevel,
          status: "open" as const,
          recordOnly: false,
          notes: "__test_dry_run__",
          reasoning: edgeAnalysis.overallDescription,
          detectedAt: new Date(),
          acknowledgedAt: null,
          resolvedAt: null,
          dismissedAt: null,
          assignedTo: null,
          camera: { name: "Test Camera (dry run)" },
          zone: { name: "Test Zone" },
          project: { name: "Test Project" },
        });
        break;
      }

      case "dashboard":
        break;
    }
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  }

  const triggered = alarmEval.filter((a) => a.wouldCreate);
  return NextResponse.json({
    success: status === "sent",
    message:
      status === "sent"
        ? triggered.length > 0
          ? `Test run complete — pipeline would create ${triggered.length} incident(s): ${triggered.map((a) => a.type).join(", ")}`
          : "Test run complete — pipeline assessed the scene as safe (no incident)"
        : error,
    pipeline: {
      textClassification: classificationResult.classifications.map((c) => ({
        type: c.type,
        detected: c.detected,
        riskLevel: c.riskLevel,
        confidence: c.confidence,
      })),
      visionVerification: visionResult
        ? {
            accuracy: visionResult.descriptionAccuracy,
            summary: visionResult.summary,
          }
        : null,
      alarmEval,
    },
  });
}
