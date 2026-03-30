/**
 * Re-verify existing PPE-related edge reports with the new vision logic.
 *
 * This script finds edge reports that:
 * 1. Have an image attached (eventImageData or eventImagePath)
 * 2. Either have a PPE violation incident OR description mentions PPE/hardhat/vest
 * 3. Don't already have vision verification OR have old verification pre-dating the fix
 *
 * It then re-runs vision verification and shows what would happen under new rules.
 */

import { prisma } from "@/lib/prisma";
import { verifyWithVision } from "@/lib/vision-verifier";
import { classifyAnalysis } from "@/lib/llm-classifier";
import { reconcileClassifications } from "@/lib/vision-verifier";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

const BATCH_SIZE = 10;
type EdgeReportRecord = NonNullable<Awaited<ReturnType<typeof prisma.edgeReport.findFirst>>>;
type IncidentRecord = NonNullable<Awaited<ReturnType<typeof prisma.incident.findFirst>>>;

async function findReportsToReverify() {
  // Find PPE violation incidents and their associated edge reports
  const ppeIncidents = await prisma.incident.findMany({
    where: { type: "ppe_violation" },
    orderBy: { detectedAt: "desc" },
    include: {
      camera: { select: { id: true, name: true, edgeCameraId: true } },
    },
  });

  const reportsToCheck = [];

  for (const incident of ppeIncidents) {
    // Find the edge report that likely triggered this incident
    // (within 2 minutes of incident detection time)
    const report = await prisma.edgeReport.findFirst({
      where: {
        cameraId: incident.cameraId,
        receivedAt: {
          gte: new Date(incident.detectedAt.getTime() - 2 * 60 * 1000),
          lte: new Date(incident.detectedAt.getTime() + 2 * 60 * 1000),
        },
        messageType: "analysis",
        keepalive: false,
      },
      orderBy: { receivedAt: "desc" },
    });

    if (report) {
      reportsToCheck.push({
        incident,
        report,
      });
    }
  }

  return reportsToCheck;
}

async function getImageBuffer(report: EdgeReportRecord): Promise<Buffer | null> {
  // Try BYTEA data first
  if (report.eventImageData && report.eventImageData.length > 0) {
    return Buffer.from(report.eventImageData);
  }

  // Try file path
  if (report.eventImagePath) {
    const possiblePaths = [
      report.eventImagePath,
      join(process.cwd(), "public", report.eventImagePath.replace(/^\//, "")),
      join(process.cwd(), report.eventImagePath.replace(/^\//, "")),
    ];

    for (const p of possiblePaths) {
      if (existsSync(p)) {
        return readFile(p);
      }
    }
  }

  return null;
}

async function reverifyReport(
  report: EdgeReportRecord,
  incident: IncidentRecord
) {
  const imageBuffer = await getImageBuffer(report);
  if (!imageBuffer) {
    return {
      status: "no_image",
      message: "No image available for re-verification",
    };
  }

  // Re-classify text
  const analysis: Parameters<typeof classifyAnalysis>[0] = {
    overallDescription: report.overallDescription,
    overallRiskLevel: report.overallRiskLevel,
    constructionSafety: report.constructionSafety as Parameters<typeof classifyAnalysis>[0]["constructionSafety"],
    fireSafety: report.fireSafety as Parameters<typeof classifyAnalysis>[0]["fireSafety"],
    propertySecurity: report.propertySecurity as Parameters<typeof classifyAnalysis>[0]["propertySecurity"],
    peopleCount: report.peopleCount ?? undefined,
    missingHardhats: report.missingHardhats ?? undefined,
    missingVests: report.missingVests ?? undefined,
  };

  const textClassification = await classifyAnalysis(analysis);

  // Run vision verification
  const visionResult = await verifyWithVision(
    imageBuffer,
    report.eventImageMimeType || "image/jpeg",
    analysis
  ).catch((err) => {
    console.error(`Vision verification failed for report ${report.id}:`, err);
    return null;
  });

  if (!visionResult) {
    return {
      status: "vision_failed",
      message: "Vision verification failed",
      textClassification,
    };
  }

  // Reconcile with new logic
  const reconciledClassifications = reconcileClassifications(
    textClassification.classifications,
    visionResult.visionClassifications
  );

  const ppeResult = reconciledClassifications.find((c) => c.type === "ppe_violation");

  // Determine outcome under new rules
  const oldBlocked = !incident.recordOnly; // Old incident was created
  const newBlocked = !ppeResult?.detected; // New logic would block it

  return {
    status: "verified",
    oldBlocked,
    newBlocked,
    wouldBeDifferent: oldBlocked !== newBlocked,
    ppeResult,
    textPPE: textClassification.classifications.find((c) => c.type === "ppe_violation"),
    visionPPE: visionResult.visionClassifications.find((c) => c.type === "ppe_violation"),
    visionAccuracy: visionResult.descriptionAccuracy,
    visionIncorrectClaims: visionResult.incorrectClaims,
  };
}

async function main() {
  console.log("=== PPE Report Re-verification ===\n");
  console.log("Finding PPE incidents and their associated edge reports...\n");

  const reportsToCheck = await findReportsToReverify();
  console.log(`Found ${reportsToCheck.length} PPE incidents with potential edge reports\n`);

  let processed = 0;
  let wouldBeBlocked = 0;
  let wouldStay = 0;
  let noImage = 0;
  let visionFailed = 0;

  for (const { incident, report } of reportsToCheck.slice(0, BATCH_SIZE)) {
    console.log(`\n--- Report: ${report.id.slice(0, 8)} | Camera: ${incident.camera.name} ---`);
    console.log(`Incident: ${incident.id.slice(0, 8)} | Status: ${incident.status} | Risk: ${incident.riskLevel}`);
    console.log(`Received: ${report.receivedAt.toISOString()}`);
    console.log(`Description: ${report.overallDescription.slice(0, 80)}...`);

    const result = await reverifyReport(report, incident);

    if (result.status === "no_image") {
      console.log(`Result: ❌ ${result.message}`);
      noImage++;
    } else if (result.status === "vision_failed") {
      console.log(`Result: ❌ ${result.message}`);
      visionFailed++;
    } else if (result.status === "verified") {
      processed++;

      if (result.wouldBeDifferent && result.newBlocked) {
        console.log(`\n>>> 🔴 WOULD BE BLOCKED NOW`);
        console.log(`Text claimed: ${result.textPPE?.detected ? "PPE violation" : "no PPE issue"}`);
        console.log(`Vision found: ${result.visionPPE?.detected ? "PPE violation" : "PPE OK / unclear"}`);
        console.log(`Vision accuracy: ${result.visionAccuracy}`);
        if (result.visionIncorrectClaims?.length > 0) {
          console.log(`Vision incorrect claims: ${result.visionIncorrectClaims.join("; ")}`);
        }
        wouldBeBlocked++;
      } else if (result.wouldBeDifferent && !result.newBlocked) {
        console.log(`\n>>> 🟢 Would stay valid (both agree on PPE violation)`);
        wouldStay++;
      } else {
        console.log(`\n>>> ⚪ No change needed`);
        if (!result.oldBlocked) {
          console.log(`(Was already record-only or not created)`);
        }
      }
    }
  }

  console.log("\n\n=== Summary ===");
  console.log(`Total PPE incidents checked: ${reportsToCheck.length}`);
  console.log(`Processed with vision: ${processed}`);
  console.log(`Would be BLOCKED under new rules: ${wouldBeBlocked}`);
  console.log(`Would stay VALID: ${wouldStay}`);
  console.log(`No image available: ${noImage}`);
  console.log(`Vision failed: ${visionFailed}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
