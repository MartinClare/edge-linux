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
 * SMTP credentials are read from environment variables (SMTP_HOST, SMTP_PORT,
 * SMTP_USER, SMTP_PASS, SMTP_FROM).  The channel config only needs to supply
 * the recipient address(es) via the `to` field.
 */
export async function sendEmail(config: EmailConfig, incident: IncidentWithRelations): Promise<void> {
  const to = config.to as string | string[] | undefined;
  if (!to || (Array.isArray(to) && to.length === 0)) {
    throw new Error("Email channel missing 'to' address");
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user ?? "alerts@axon-vision.local";

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS in .env"
    );
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

  const nodemailer = await import("nodemailer");

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    text: body,
  });

  console.log(`[Email] Sent to ${Array.isArray(to) ? to.join(", ") : to} for incident ${incident.id}`);
}
