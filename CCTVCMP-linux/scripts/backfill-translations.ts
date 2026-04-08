/**
 * One-time backfill: translate all EdgeReports that were processed by the LLM
 * but have no translationsJson yet.
 *
 * Run from the CCTVCMP-linux directory:
 *   npx tsx scripts/backfill-translations.ts
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { translateReportToZh } from "../lib/translator";

const prisma = new PrismaClient();

type ClassificationEntry = {
  type?: string;
  reasoning?: string;
  [key: string]: unknown;
};

type VisionVerification = {
  summary?: string;
  missedHazards?: string[];
  incorrectClaims?: string[];
  [key: string]: unknown;
};

async function main() {
  console.log("[backfill] Fetching untranslated reports...");

  // Only process reports that have been classified (classificationJson not null)
  // but don't yet have translations
  const reports = await prisma.edgeReport.findMany({
    where: {
      translationsJson: { equals: Prisma.DbNull },
      NOT: { classificationJson: { equals: Prisma.DbNull } },
    },
    select: {
      id: true,
      overallDescription: true,
      classificationJson: true,
      visionVerificationJson: true,
    },
    orderBy: { receivedAt: "desc" },
  });

  console.log(`[backfill] Found ${reports.length} report(s) to translate.`);

  if (reports.length === 0) {
    console.log("[backfill] Nothing to do.");
    return;
  }

  let success = 0;
  let failed = 0;

  for (const report of reports) {
    try {
      const classification = report.classificationJson as {
        classifications?: ClassificationEntry[];
      } | null;

      const vision = report.visionVerificationJson as VisionVerification | null;

      const classifications = (classification?.classifications ?? [])
        .filter((c) => c.type && c.reasoning)
        .map((c) => ({ type: String(c.type), reasoning: String(c.reasoning) }));

      if (!report.overallDescription && classifications.length === 0) {
        console.log(`[backfill] Skipping ${report.id} — no text content to translate.`);
        continue;
      }

      const translations = await translateReportToZh({
        overallDescription: report.overallDescription ?? "",
        classifications,
        visionSummary: vision?.summary,
        visionMissedHazards: vision?.missedHazards,
        visionIncorrectClaims: vision?.incorrectClaims,
      });

      await prisma.edgeReport.update({
        where: { id: report.id },
        data: { translationsJson: translations as object },
      });

      console.log(`[backfill] ✓ Translated report ${report.id}`);
      success++;

      // Small delay to avoid hitting API rate limits
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`[backfill] ✗ Failed for report ${report.id}:`, err);
      failed++;
    }
  }

  console.log(`\n[backfill] Done. ${success} translated, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error("[backfill] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
