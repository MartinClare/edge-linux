import { prisma } from "@/lib/prisma";
import type { ClassificationResult } from "@/lib/llm-classifier";
import type { IncidentRiskLevel, IncidentStatus } from "@prisma/client";
import { dispatchNotifications } from "@/lib/notifications/dispatcher";

const RISK_ORDER: Record<IncidentRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

type AlarmResult = {
  created: Array<{ id: string; type: string; riskLevel: string; reasoning: string }>;
  skipped: Array<{ type: string; reason: string }>;
  recordOnly: Array<{ id: string; type: string }>;
};

type CameraContext = {
  cameraId: string;
  projectId: string;
  zoneId: string;
};

/**
 * Evaluate classifications against alarm rules, handle dedup and consecutive hits,
 * create incidents, and dispatch notifications.
 */
export async function evaluateAlarms(
  classification: ClassificationResult,
  camera: CameraContext,
  edgeReportId: string,
  detectedAt: Date
): Promise<AlarmResult> {
  const result: AlarmResult = { created: [], skipped: [], recordOnly: [] };

  const detected = classification.classifications.filter((c) => c.detected);
  if (detected.length === 0) return result;

  const [rules, systemUser] = await Promise.all([
    prisma.alarmRule.findMany({ where: { enabled: true } }),
    prisma.user.findFirst({ where: { role: "admin" } }),
  ]);
  const ruleMap = new Map(rules.map((r) => [r.incidentType, r]));

  if (!systemUser) {
    console.error("[AlarmEngine] No admin user found for incident logs");
    return result;
  }

  for (const cls of detected) {
    const rule = ruleMap.get(cls.type);

    if (!rule) {
      result.skipped.push({ type: cls.type, reason: "no_rule" });
      continue;
    }

    if (cls.confidence < rule.minConfidence) {
      result.skipped.push({
        type: cls.type,
        reason: `confidence ${cls.confidence.toFixed(2)} < ${rule.minConfidence}`,
      });
      continue;
    }

    if (RISK_ORDER[cls.riskLevel] < RISK_ORDER[rule.minRiskLevel]) {
      result.skipped.push({
        type: cls.type,
        reason: `risk ${cls.riskLevel} < min ${rule.minRiskLevel}`,
      });
      continue;
    }

    if (rule.consecutiveHits > 1) {
      const windowMs = rule.dedupMinutes * 60 * 1000;
      const since = new Date(detectedAt.getTime() - windowMs);
      const recentReports = await prisma.edgeReport.count({
        where: {
          cameraId: camera.cameraId,
          receivedAt: { gte: since },
        },
      });
      if (recentReports < rule.consecutiveHits) {
        result.skipped.push({
          type: cls.type,
          reason: `consecutive ${recentReports}/${rule.consecutiveHits}`,
        });
        continue;
      }
    }

    const dedupSince = new Date(detectedAt.getTime() - rule.dedupMinutes * 60 * 1000);
    const existing = await prisma.incident.findFirst({
      where: {
        cameraId: camera.cameraId,
        type: cls.type,
        status: { in: ["open", "acknowledged"] as IncidentStatus[] },
        detectedAt: { gte: dedupSince },
      },
    });

    if (existing) {
      result.skipped.push({ type: cls.type, reason: "duplicate" });
      continue;
    }

    const incident = await prisma.incident.create({
      data: {
        projectId: camera.projectId,
        cameraId: camera.cameraId,
        zoneId: camera.zoneId,
        type: cls.type,
        riskLevel: cls.riskLevel,
        status: rule.recordOnly ? "record_only" : "open",
        recordOnly: rule.recordOnly,
        reasoning: cls.reasoning,
        detectedAt,
        logs: {
          create: { userId: systemUser.id, action: "created" },
        },
      },
      include: {
        camera: { select: { name: true } },
        zone: { select: { name: true } },
        project: { select: { name: true } },
      },
    });

    if (rule.recordOnly) {
      result.recordOnly.push({ id: incident.id, type: cls.type });
    } else {
      result.created.push({
        id: incident.id,
        type: cls.type,
        riskLevel: cls.riskLevel,
        reasoning: cls.reasoning,
      });

      dispatchNotifications(incident).catch((err) =>
        console.error("[AlarmEngine] Notification dispatch error:", err)
      );
    }
  }

  return result;
}

/**
 * Seed default alarm rules if none exist.
 * Called on first webhook or from settings.
 */
/** In-memory cache so we only hit the DB once per server process. */
let _defaultRulesSeeded = false;

export async function ensureDefaultRules(): Promise<void> {
  if (_defaultRulesSeeded) return;
  const count = await prisma.alarmRule.count();
  if (count > 0) { _defaultRulesSeeded = true; return; }

  const defaults: Array<{
    name: string;
    incidentType: string;
    minRiskLevel: IncidentRiskLevel;
    dedupMinutes: number;
    consecutiveHits: number;
    recordOnly: boolean;
  }> = [
    { name: "PPE Violation", incidentType: "ppe_violation", minRiskLevel: "medium", dedupMinutes: 5, consecutiveHits: 1, recordOnly: false },
    { name: "Fall Risk", incidentType: "fall_risk", minRiskLevel: "medium", dedupMinutes: 10, consecutiveHits: 1, recordOnly: false },
    { name: "Fire Detected", incidentType: "fire_detected", minRiskLevel: "low", dedupMinutes: 2, consecutiveHits: 1, recordOnly: false },
    { name: "Smoke Detected", incidentType: "smoke_detected", minRiskLevel: "low", dedupMinutes: 5, consecutiveHits: 1, recordOnly: false },
    { name: "Restricted Zone Entry", incidentType: "restricted_zone_entry", minRiskLevel: "medium", dedupMinutes: 10, consecutiveHits: 1, recordOnly: false },
    { name: "Machinery Hazard", incidentType: "machinery_hazard", minRiskLevel: "medium", dedupMinutes: 10, consecutiveHits: 1, recordOnly: false },
    { name: "Near Miss", incidentType: "near_miss", minRiskLevel: "medium", dedupMinutes: 15, consecutiveHits: 2, recordOnly: true },
    { name: "Smoking", incidentType: "smoking", minRiskLevel: "low", dedupMinutes: 15, consecutiveHits: 1, recordOnly: true },
  ];

  for (const d of defaults) {
    await prisma.alarmRule.create({
      data: d as Parameters<typeof prisma.alarmRule.create>[0]["data"],
    });
  }

  _defaultRulesSeeded = true;
  console.log("[AlarmEngine] Seeded default alarm rules");
}
