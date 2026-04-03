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

  const [rules, systemUser] = await Promise.all([
    prisma.alarmRule.findMany({ where: { enabled: true } }),
    prisma.user.findFirst({ where: { role: "admin" } }),
  ]);
  const ruleMap = new Map(rules.map((r) => [r.incidentType, r]));

  if (!systemUser) {
    console.error("[AlarmEngine] No admin user found for incident logs");
    return result;
  }

  const isCmpVerified = classification.source === "vision";

  // CMP is the final arbiter for user-facing alarms. If a vision-verified result
  // says an issue is not present, dismiss any matching open alarm immediately.
  if (isCmpVerified) {
    for (const cls of classification.classifications.filter((c) => !c.detected)) {
      const openIncidents = await prisma.incident.findMany({
        where: {
          cameraId: camera.cameraId,
          type: cls.type,
          status: { in: ["open", "acknowledged"] as IncidentStatus[] },
        },
        select: { id: true },
      });

      for (const incident of openIncidents) {
        await prisma.incident.update({
          where: { id: incident.id },
          data: {
            status: "dismissed",
            dismissedAt: new Date(),
            logs: {
              create: {
                userId: systemUser.id,
                action: "dismissed",
              },
            },
          },
        });
        result.skipped.push({ type: cls.type, reason: "dismissed_by_cmp_verification" });
      }
    }
  }

  const detected = classification.classifications.filter((c) => c.detected);
  if (detected.length === 0) return result;

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
        edgeReportId,
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
  if (count > 0) {
    _defaultRulesSeeded = true;
    // Still run policy migration in case rules exist but need updating.
    await migrateStrictAlertPolicy();
    return;
  }

  // Only the four high-priority incident types generate active alerts.
  // All other types are seeded as disabled so they don't clutter the UI.
  const defaults: Array<{
    name: string;
    incidentType: string;
    minRiskLevel: IncidentRiskLevel;
    dedupMinutes: number;
    consecutiveHits: number;
    recordOnly: boolean;
    enabled: boolean;
  }> = [
    { name: "PPE Violation (No Hardhat)", incidentType: "ppe_violation",    minRiskLevel: "high", dedupMinutes: 5,  consecutiveHits: 1, recordOnly: false, enabled: true  },
    { name: "Fire / Smoke",               incidentType: "fire_detected",    minRiskLevel: "high", dedupMinutes: 5,  consecutiveHits: 1, recordOnly: false, enabled: true  },
    { name: "Machinery Hazard",           incidentType: "machinery_hazard", minRiskLevel: "high", dedupMinutes: 5,  consecutiveHits: 1, recordOnly: false, enabled: true  },
    { name: "Person Fallen / Injured",    incidentType: "fall_risk",        minRiskLevel: "high", dedupMinutes: 5,  consecutiveHits: 1, recordOnly: false, enabled: true  },
    { name: "Smoking",               incidentType: "smoking",               minRiskLevel: "high", dedupMinutes: 5,  consecutiveHits: 1, recordOnly: false, enabled: true  },
    // Disabled — not raised under the strict alert policy
    { name: "Smoke Detected",        incidentType: "smoke_detected",        minRiskLevel: "high", dedupMinutes: 5,  consecutiveHits: 1, recordOnly: true,  enabled: false },
    { name: "Restricted Zone Entry", incidentType: "restricted_zone_entry", minRiskLevel: "high", dedupMinutes: 10, consecutiveHits: 1, recordOnly: true,  enabled: false },
    { name: "Near Miss",             incidentType: "near_miss",             minRiskLevel: "high", dedupMinutes: 15, consecutiveHits: 2, recordOnly: true,  enabled: false },
  ];

  for (const d of defaults) {
    await prisma.alarmRule.create({
      data: d as Parameters<typeof prisma.alarmRule.create>[0]["data"],
    });
  }

  _defaultRulesSeeded = true;
  console.log("[AlarmEngine] Seeded default alarm rules (strict policy)");
}

/**
 * Enforce the strict alert policy on existing alarm rules.
 *
 * Active (create real incidents):  ppe_violation, fire_detected, machinery_hazard, fall_risk, smoking
 * Disabled (record-only / off):    smoke_detected, restricted_zone_entry, near_miss
 *
 * Only updates rules that still have old defaults — manually customised rules are preserved.
 */
async function migrateStrictAlertPolicy(): Promise<void> {
  const active: Array<{ incidentType: string; name: string }> = [
    { incidentType: "ppe_violation",    name: "PPE Violation (No Hardhat)" },
    { incidentType: "fire_detected",    name: "Fire / Smoke" },
    { incidentType: "machinery_hazard", name: "Machinery Hazard" },
    { incidentType: "fall_risk",        name: "Person Fallen / Injured" },
    { incidentType: "smoking",          name: "Smoking" },
  ];
  const inactive: Array<{ incidentType: string; name: string }> = [
    { incidentType: "smoke_detected",        name: "Smoke Detected" },
    { incidentType: "restricted_zone_entry", name: "Restricted Zone Entry" },
    { incidentType: "near_miss",             name: "Near Miss" },
  ];

  for (const t of active) {
    const rule = await prisma.alarmRule.findFirst({ where: { incidentType: t.incidentType as import("@prisma/client").IncidentType } });
    if (!rule) {
      await prisma.alarmRule.create({
        data: {
          name: t.name, incidentType: t.incidentType, minRiskLevel: "high",
          dedupMinutes: 5, consecutiveHits: 1, recordOnly: false, enabled: true,
        } as Parameters<typeof prisma.alarmRule.create>[0]["data"],
      });
      console.log(`[AlarmEngine] Created active rule: ${t.incidentType}`);
    } else if (!rule.enabled || rule.recordOnly) {
      await prisma.alarmRule.update({
        where: { id: rule.id },
        data: { enabled: true, recordOnly: false, minRiskLevel: "high" },
      });
      console.log(`[AlarmEngine] Activated rule: ${t.incidentType}`);
    }
  }

  for (const t of inactive) {
    const rule = await prisma.alarmRule.findFirst({ where: { incidentType: t.incidentType as import("@prisma/client").IncidentType } });
    if (!rule) {
      await prisma.alarmRule.create({
        data: {
          name: t.name, incidentType: t.incidentType, minRiskLevel: "high",
          dedupMinutes: 5, consecutiveHits: 1, recordOnly: true, enabled: false,
        } as Parameters<typeof prisma.alarmRule.create>[0]["data"],
      });
    } else if (rule.enabled && !rule.recordOnly) {
      await prisma.alarmRule.update({
        where: { id: rule.id },
        data: { enabled: false, recordOnly: true },
      });
      console.log(`[AlarmEngine] Disabled rule: ${t.incidentType}`);
    }
  }
}

/**
 * The three categories that always produce an immediate popup alert in the CMP UI
 * regardless of other alarm-rule settings.
 */
export const CRITICAL_ALERT_TYPES = [
  "ppe_violation",
  "smoking",
  "fire_detected",
  "machinery_hazard",
] as const;

export type CriticalAlertType = typeof CRITICAL_ALERT_TYPES[number];

/**
 * Ensure the four critical-alert rules exist with correct defaults.
 * Safe to call repeatedly; only updates rules whose values still match the
 * *old* (pre-critical) defaults so that manual admin changes are preserved.
 */
export async function migrateCriticalAlertRules(): Promise<void> {
  const targets = [
    { incidentType: "ppe_violation",    name: "PPE Violation",    oldMinRisk: "medium" as IncidentRiskLevel },
    { incidentType: "smoking",          name: "Smoking",          oldMinRisk: "low"    as IncidentRiskLevel },
    { incidentType: "fire_detected",    name: "Fire Detected",    oldMinRisk: "low"    as IncidentRiskLevel },
    { incidentType: "machinery_hazard", name: "Machinery Hazard", oldMinRisk: "medium" as IncidentRiskLevel },
  ];

  for (const t of targets) {
    const rule = await prisma.alarmRule.findFirst({ where: { incidentType: t.incidentType as import("@prisma/client").IncidentType } });
    if (!rule) {
      // Create if missing (handles fresh installs where seeding hasn't run yet)
      await prisma.alarmRule.create({
        data: {
          name: t.name,
          incidentType: t.incidentType,
          minRiskLevel: "high",
          dedupMinutes: 5,
          consecutiveHits: 1,
          recordOnly: false,
        } as Parameters<typeof prisma.alarmRule.create>[0]["data"],
      });
    } else if (rule.minRiskLevel === t.oldMinRisk || rule.recordOnly) {
      // Update only if still at old default (not manually customised)
      await prisma.alarmRule.update({
        where: { id: rule.id },
        data: {
          minRiskLevel: "high",
          dedupMinutes: rule.dedupMinutes === 15 || rule.dedupMinutes === 2 ? 5 : rule.dedupMinutes,
          recordOnly: false,
        },
      });
      console.log(`[AlarmEngine] Migrated critical rule: ${t.incidentType}`);
    }
  }
}
