import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { edgeReportSchema } from "@/lib/validations/webhook";
import { classifyAnalysis } from "@/lib/llm-classifier";
import { evaluateAlarms, ensureDefaultRules } from "@/lib/alarm-engine";

function getApiKey(request: NextRequest): string | null {
  return request.headers.get("x-api-key") ?? request.headers.get("X-API-Key");
}

function isActionableRisk(level: string): boolean {
  return level === "Medium" || level === "High" || level === "Critical";
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
 * Background task: classify the saved EdgeReport and evaluate alarms.
 * Runs after the HTTP response is already sent so the edge device isn't blocked.
 */
async function processReportBackground(
  edgeReportId: string,
  analysis: Parameters<typeof classifyAnalysis>[0],
  cameraContext: { cameraId: string; projectId: string; zoneId: string },
  detectedAt: Date
) {
  try {
    await ensureDefaultRules();

    const classification = await classifyAnalysis(analysis);

    await prisma.edgeReport.update({
      where: { id: edgeReportId },
      data: { classificationJson: classification as object },
    });

    await evaluateAlarms(classification, cameraContext, edgeReportId, detectedAt);
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
        name: cameraName,
        edgeCameraId,
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
      rawJson: fullPayload as object,
    },
  });

  if (parsedBody.image) {
    await prisma.edgeReport.update({
      where: { id: edgeReport.id },
      data: { eventImagePath: `/api/edge-reports/${edgeReport.id}/image` },
    });
  }

  // --- 2. Update Camera.lastReportAt and sync name from edge ---
  await prisma.camera.update({
    where: { id: camera.id },
    data: { lastReportAt: eventTimestamp, status: "online", name: cameraName },
  });

  // --- 3. Fire background processing for actionable analysis reports only ---
  if (messageType === "analysis" && !keepalive && analysis && isActionableRisk(analysis.overallRiskLevel)) {
    processReportBackground(
      edgeReport.id,
      analysis as Parameters<typeof classifyAnalysis>[0],
      { cameraId: camera.id, projectId: camera.projectId, zoneId },
      eventTimestamp
    ).catch(() => { /* already logged inside */ });
  }

  // --- 4. Respond immediately so the edge device isn't kept waiting ---
  return NextResponse.json({ success: true }, { status: 200 });
}
