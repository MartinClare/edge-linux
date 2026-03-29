import type { Incident } from "@prisma/client";

type EmailConfig = Record<string, unknown>;

type IncidentWithRelations = Incident & {
  camera?: { name: string } | null;
  zone?: { name: string } | null;
  project?: { name: string } | null;
};

/**
 * Send an email notification for an incident.
 *
 * Config shape:
 * {
 *   smtpHost: string,
 *   smtpPort: number,
 *   smtpUser: string,
 *   smtpPass: string,
 *   from: string,
 *   to: string | string[],
 *   secure: boolean
 * }
 *
 * Uses nodemailer if available; falls back to logging.
 */
export async function sendEmail(config: EmailConfig, incident: IncidentWithRelations): Promise<void> {
  const to = config.to as string | string[];
  const from = (config.from as string) || "alerts@axon-vision.local";

  if (!to) {
    throw new Error("Email channel missing 'to' address");
  }

  const subject = `[${incident.riskLevel.toUpperCase()}] ${incident.type.replace(/_/g, " ")} — ${incident.camera?.name ?? "Unknown camera"}`;

  const body = [
    `Incident: ${incident.type.replace(/_/g, " ")}`,
    `Risk Level: ${incident.riskLevel.toUpperCase()}`,
    `Camera: ${incident.camera?.name ?? incident.cameraId}`,
    `Zone: ${incident.zone?.name ?? incident.zoneId}`,
    `Project: ${incident.project?.name ?? incident.projectId}`,
    `Detected: ${incident.detectedAt.toISOString()}`,
    incident.reasoning ? `\nDetails: ${incident.reasoning}` : "",
    `\n---\nAxon Vision CMP`,
  ].join("\n");

  try {
    const nodemailer = await import("nodemailer");

    const transporter = nodemailer.createTransport({
      host: config.smtpHost as string,
      port: (config.smtpPort as number) || 587,
      secure: (config.secure as boolean) ?? false,
      auth: {
        user: config.smtpUser as string,
        pass: config.smtpPass as string,
      },
    });

    await transporter.sendMail({
      from,
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      text: body,
    });

    console.log(`[Email] Sent to ${to} for incident ${incident.id}`);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.message.includes("Cannot find module") || err.message.includes("MODULE_NOT_FOUND"))
    ) {
      console.warn("[Email] nodemailer not installed — logging email instead");
      console.log(`[Email] To: ${to}, Subject: ${subject}`);
      console.log(`[Email] Body:\n${body}`);
      return;
    }
    throw err;
  }
}
