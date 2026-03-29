import type { Incident } from "@prisma/client";

type WebhookConfig = Record<string, unknown>;

type IncidentWithRelations = Incident & {
  camera?: { name: string } | null;
  zone?: { name: string } | null;
  project?: { name: string } | null;
};

/**
 * Send an outbound webhook notification for an incident.
 *
 * Config shape:
 * {
 *   url: string,
 *   headers?: Record<string, string>,
 *   secret?: string
 * }
 */
export async function sendWebhook(config: WebhookConfig, incident: IncidentWithRelations): Promise<void> {
  const url = config.url as string;
  if (!url) {
    throw new Error("Webhook channel missing 'url'");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.headers as Record<string, string> ?? {}),
  };

  if (config.secret) {
    headers["X-Webhook-Secret"] = config.secret as string;
  }

  const payload = {
    event: "incident.created",
    incident: {
      id: incident.id,
      type: incident.type,
      riskLevel: incident.riskLevel,
      status: incident.status,
      camera: incident.camera?.name ?? incident.cameraId,
      zone: incident.zone?.name ?? incident.zoneId,
      project: incident.project?.name ?? incident.projectId,
      reasoning: incident.reasoning,
      detectedAt: incident.detectedAt.toISOString(),
    },
    sentAt: new Date().toISOString(),
  };

  const MAX_RETRIES = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        console.log(`[Webhook] Sent to ${url} for incident ${incident.id}`);
        return;
      }

      lastError = new Error(`HTTP ${response.status}: ${await response.text().catch(() => "")}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }

  throw lastError ?? new Error("Webhook failed");
}
