/**
 * One-shot script: resend the most recent real incident as an alert email.
 * Run with:  npx tsx scripts/resend-last-alert.ts
 */


import { PrismaClient } from "@prisma/client";
import { sendEmail } from "@/lib/notifications/email";

const prisma = new PrismaClient();

async function main() {
  const incident = await prisma.incident.findFirst({
    orderBy: { detectedAt: "desc" },
    where: { OR: [{ notes: null }, { notes: { not: "__test__" } }] },
    include: {
      camera: { select: { name: true } },
      zone: { select: { name: true } },
      project: { select: { name: true } },
      edgeReport: {
        select: {
          id: true,
          overallDescription: true,
          classificationJson: true,
          visionVerificationJson: true,
          eventImagePath: true,
          eventImageMimeType: true,
        },
      },
    },
  });

  if (!incident) {
    console.error("No real incidents found in the database.");
    process.exit(1);
  }

  const channel = await prisma.notificationChannel.findFirst({
    where: { type: "email", enabled: true },
  });

  if (!channel) {
    console.error("No enabled email notification channel found.");
    process.exit(1);
  }

  console.log(`Resending incident: [${incident.riskLevel.toUpperCase()}] ${incident.type}`);
  console.log(`  Camera      : ${incident.camera?.name ?? incident.cameraId}`);
  console.log(`  Detected at : ${incident.detectedAt.toISOString()}`);
  console.log(`  Edge report : ${incident.edgeReport?.id ?? "none"}`);
  console.log(`  Has classif.: ${!!incident.edgeReport?.classificationJson}`);
  console.log(`  Has vision  : ${!!incident.edgeReport?.visionVerificationJson}`);
  console.log(`  Has image   : ${!!incident.edgeReport?.eventImagePath}`);
  console.log(`  Sending to  : ${JSON.stringify(channel.config)}`);

  await sendEmail(channel.config as Record<string, unknown>, incident);
  console.log("Email sent successfully.");
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
