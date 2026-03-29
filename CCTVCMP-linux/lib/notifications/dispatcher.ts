import { prisma } from "@/lib/prisma";
import type { Incident, IncidentRiskLevel } from "@prisma/client";
import { sendEmail } from "@/lib/notifications/email";
import { sendWebhook } from "@/lib/notifications/webhook";

const RISK_ORDER: Record<IncidentRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

type IncidentWithRelations = Incident & {
  camera?: { name: string } | null;
  zone?: { name: string } | null;
  project?: { name: string } | null;
};

/**
 * Send notifications for an incident through all eligible channels.
 * Runs asynchronously — caller should fire-and-forget with .catch().
 */
export async function dispatchNotifications(incident: IncidentWithRelations): Promise<void> {
  // Fast-path: skip expensive query if no channels are configured at all
  let channels;
  try {
    channels = await prisma.notificationChannel.findMany({
      where: { enabled: true },
    });
  } catch (err) {
    console.error("[Notification] Could not fetch channels (pool busy?):", err);
    return;
  }

  const eligible = channels.filter(
    (ch) => RISK_ORDER[incident.riskLevel] >= RISK_ORDER[ch.minRiskLevel]
  );

  if (eligible.length === 0) return;

  const promises = eligible.map(async (channel) => {
    let status = "sent";
    let error: string | null = null;

    try {
      switch (channel.type) {
        case "email":
          await sendEmail(channel.config as Record<string, unknown>, incident);
          break;
        case "webhook":
          await sendWebhook(channel.config as Record<string, unknown>, incident);
          break;
        case "dashboard":
          break;
      }
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
      console.error(`[Notification] ${channel.type} channel '${channel.name}' failed:`, error);
    }

    await prisma.notificationLog.create({
      data: {
        channelId: channel.id,
        incidentId: incident.id,
        status,
        error,
      },
    });
  });

  await Promise.allSettled(promises);
}
