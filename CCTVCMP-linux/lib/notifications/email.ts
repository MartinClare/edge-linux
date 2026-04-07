/**
 * Email notifications — incident alerts and test-run reports.
 *
 * ARCHITECTURE NOTE
 * -----------------
 * There is exactly ONE HTML template: buildEmailHtml().
 * Both the real-incident path (sendEmail) and the test-run path
 * (sendTestRunEmail) convert their data into the same UnifiedEmailParams
 * shape and call buildEmailHtml().  Adding, removing, or restyling a
 * section only ever requires editing buildEmailHtml() — the two callers
 * stay in sync automatically.
 */

import type { Incident } from "@prisma/client";
import type { ClassificationResult, Classification } from "@/lib/llm-classifier";
import type { VisionVerificationResult } from "@/lib/vision-verifier";
import { readFile } from "fs/promises";
import { join } from "path";

const IMAGE_DIR =
  process.env.IMAGE_STORAGE_PATH ?? join(process.cwd(), "..", "data", "images");

const CMP_URL =
  (process.env.NEXTAUTH_URL ?? "http://localhost:3002").replace(/\/$/, "");

type EmailConfig = Record<string, unknown>;

// ── EdgeReport subset carried through the notification pipeline ─────────────

type EdgeReportForEmail = {
  id: string;
  overallDescription: string | null;
  classificationJson: unknown;
  visionVerificationJson: unknown;
  eventImagePath: string | null;
  eventImageMimeType: string | null;
};

export type IncidentWithRelations = Incident & {
  camera?: { name: string } | null;
  zone?: { name: string } | null;
  project?: { name: string } | null;
  edgeReport?: EdgeReportForEmail | null;
};

// ── Shared SMTP helper ──────────────────────────────────────────────────────

async function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS in .env");
  }

  const nodemailer = await import("nodemailer");
  return {
    transporter: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    }),
    from: process.env.SMTP_FROM ?? user ?? "alerts@axon-vision.local",
  };
}

// ── Shared primitive helpers ────────────────────────────────────────────────

const RISK_COLOR: Record<string, string> = {
  critical: "#dc2626",
  high:     "#ea580c",
  medium:   "#ca8a04",
  low:      "#16a34a",
};

function riskBadge(level: string) {
  const color = RISK_COLOR[level.toLowerCase()] ?? "#6b7280";
  return `<span style="background:${color};color:#fff;padding:1px 7px;border-radius:4px;font-size:0.8em;font-weight:700;letter-spacing:0.05em;text-transform:uppercase">${level}</span>`;
}

function metaRow(label: string, value: string) {
  return `<tr>
    <td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;font-size:0.85em;vertical-align:top">${label}</td>
    <td style="padding:4px 0;font-size:0.85em">${value}</td>
  </tr>`;
}

function sectionHeading(title: string) {
  return `<h3 style="margin:24px 0 8px;font-size:0.95em;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:4px">${title}</h3>`;
}

// ── The single unified email template ──────────────────────────────────────
//
// ALL structural changes (new sections, reordering, restyling) belong here.
// The two callers (incidentToParams / testRunToParams) only supply data.

type UnifiedEmailParams = {
  /** Dark top banner. */
  header: {
    title: string;
    subtitle: string;
  };
  /** Coloured strip immediately below the header. */
  verdict: {
    color: string;
    text: string;
  };
  /** Optional key–value rows shown before the photo. */
  metaTable?: Array<{ label: string; value: string }>;
  /** Inline evidence / test image. Pass null when unavailable. */
  image: {
    available: boolean;
    cid: string;       // nodemailer CID that matches the attachment
    altText: string;
    sectionTitle: string;
  };
  /** Raw description from the edge analyser. */
  edgeDescription: string | null;
  /** Results from the CMP text classifier. */
  classifications: Classification[];
  /** Results from the CMP vision verifier. */
  visionResult: VisionVerificationResult | null;
  /**
   * Section rendered at the bottom of the body, above the footer.
   * For incidents: alarm-rule outcome.
   * For test runs : a note that no DB writes occurred.
   * Pass raw HTML.
   */
  bottomSection: {
    title: string;
    html: string;
  };
  /** HKT timestamp shown in the footer. */
  timestamp: string;
};

function buildEmailHtml(p: UnifiedEmailParams): string {
  // ── Classification table ──────────────────────────────────────────────────
  const classRows = p.classifications.map(c => `
    <tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:6px 8px;font-size:0.82em">${c.type.replace(/_/g, " ")}</td>
      <td style="padding:6px 8px;text-align:center">${c.detected
        ? '<span style="color:#dc2626;font-weight:700">YES</span>'
        : '<span style="color:#16a34a">no</span>'}</td>
      <td style="padding:6px 8px;text-align:center">${riskBadge(c.riskLevel)}</td>
      <td style="padding:6px 8px;font-size:0.8em;color:#374151">${(c.confidence * 100).toFixed(0)}%</td>
      <td style="padding:6px 8px;font-size:0.78em;color:#6b7280">${c.reasoning}</td>
    </tr>`).join("");

  const classTable = p.classifications.length > 0
    ? `<table style="width:100%;border-collapse:collapse;font-size:0.82em">
         <thead><tr style="background:#f3f4f6">
           <th style="text-align:left;padding:6px 8px">Type</th>
           <th style="padding:6px 8px">Detected</th>
           <th style="padding:6px 8px">Risk</th>
           <th style="padding:6px 8px">Conf.</th>
           <th style="text-align:left;padding:6px 8px">Reasoning</th>
         </tr></thead>
         <tbody>${classRows}</tbody>
       </table>`
    : `<p style="color:#6b7280;font-size:0.85em;font-style:italic">No classification data available.</p>`;

  // ── Vision verifier section ───────────────────────────────────────────────
  const visionHtml = p.visionResult
    ? `<table style="border-collapse:collapse;width:100%"><tbody>
         ${metaRow("Accuracy", p.visionResult.descriptionAccuracy)}
         ${metaRow("Summary", p.visionResult.summary)}
         ${p.visionResult.missedHazards.length ? metaRow("Missed hazards", p.visionResult.missedHazards.join(", ")) : ""}
         ${p.visionResult.incorrectClaims.length ? metaRow("Incorrect claims", p.visionResult.incorrectClaims.join(", ")) : ""}
       </tbody></table>`
    : `<p style="color:#6b7280;font-size:0.85em;font-style:italic">Vision verification skipped (API unavailable or no image).</p>`;

  // ── Meta table (optional) ─────────────────────────────────────────────────
  const metaTableHtml = p.metaTable?.length
    ? `${sectionHeading("Incident Details")}
       <table style="border-collapse:collapse;width:100%"><tbody>
         ${p.metaTable.map(r => metaRow(r.label, r.value)).join("")}
       </tbody></table>`
    : "";

  // ── Image section ─────────────────────────────────────────────────────────
  const imageHtml = p.image.available
    ? `${sectionHeading(p.image.sectionTitle)}
       <img src="cid:${p.image.cid}" alt="${p.image.altText}"
            style="max-width:100%;border-radius:6px;border:1px solid #e5e7eb;margin-bottom:16px">`
    : `<p style="color:#6b7280;font-size:0.85em;font-style:italic;margin-top:24px">No photo attached to this report.</p>`;

  // ── Edge analysis section ─────────────────────────────────────────────────
  const edgeHtml = p.edgeDescription
    ? `${sectionHeading("Edge Analysis Input")}
       <p style="font-size:0.85em;color:#374151;line-height:1.6;background:#f8fafc;border-left:3px solid #e2e8f0;padding:10px 14px;border-radius:0 4px 4px 0;margin:0">${p.edgeDescription}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb">
<tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0"
       style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12)">

  <!-- ① Header -->
  <tr><td style="background:#1e293b;padding:20px 28px">
    <div style="font-size:1.1em;font-weight:700;color:#fff;letter-spacing:0.02em">${p.header.title}</div>
    <div style="font-size:0.8em;color:#94a3b8;margin-top:4px">${p.header.subtitle}</div>
  </td></tr>

  <!-- ② Verdict banner -->
  <tr><td style="background:${p.verdict.color};padding:14px 28px;color:#fff;font-weight:700;font-size:0.95em">
    ${p.verdict.text}
  </td></tr>

  <!-- ③ Body -->
  <tr><td style="padding:24px 28px">

    <!-- ③-a Metadata table (incidents only) -->
    ${metaTableHtml}

    <!-- ③-b Evidence / test photo -->
    ${imageHtml}

    <!-- ③-c Edge analysis description -->
    ${edgeHtml}

    <!-- ③-d CMP Text Classifier -->
    ${sectionHeading("CMP Text Classifier")}
    ${classTable}

    <!-- ③-e Vision Verifier -->
    ${sectionHeading("Vision Verifier")}
    ${visionHtml}

    <!-- ③-f Bottom section (alarm eval or test note) -->
    ${sectionHeading(p.bottomSection.title)}
    ${p.bottomSection.html}

  </td></tr>

  <!-- ④ Footer -->
  <tr><td style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e5e7eb">
    <p style="margin:0;font-size:0.78em;color:#9ca3af">
      Axon Vision CMP · ${p.timestamp}
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Load incident image from disk ───────────────────────────────────────────

async function loadIncidentImage(edgeReportId: string): Promise<Buffer | null> {
  for (const ext of ["jpg", "jpeg", "png"]) {
    try {
      return await readFile(join(IMAGE_DIR, `${edgeReportId}.${ext}`));
    } catch {
      // try next extension
    }
  }
  return null;
}

// ── Adapter: real incident → UnifiedEmailParams ─────────────────────────────

function incidentToParams(
  incident: IncidentWithRelations,
  classifications: Classification[],
  visionResult: VisionVerificationResult | null,
  imageBuffer: Buffer | null,
): UnifiedEmailParams {
  const ts = incident.detectedAt.toLocaleString("en-HK", { timeZone: "Asia/Hong_Kong" }) + " HKT";
  const riskColor = RISK_COLOR[incident.riskLevel.toLowerCase()] ?? "#6b7280";
  const label = incident.type.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  const incidentUrl = `${CMP_URL}/incidents/${incident.id}`;

  const bottomHtml = `<p style="color:#16a34a;font-size:0.85em">
    This incident has been logged and is now open in the CMP.<br>
    <a href="${incidentUrl}" style="color:#2563eb">View incident #${incident.id} →</a>
  </p>`;

  return {
    header: {
      title: `⚠ INCIDENT ALERT — ${label}`,
      subtitle: "CMP has confirmed and logged this incident.",
    },
    verdict: {
      color: riskColor,
      text: `${riskBadge(incident.riskLevel)} ${label} confirmed by CMP`,
    },
    metaTable: [
      { label: "Type",        value: label },
      { label: "Risk Level",  value: riskBadge(incident.riskLevel) },
      { label: "Camera",      value: incident.camera?.name ?? incident.cameraId },
      { label: "Zone",        value: incident.zone?.name ?? (incident.zoneId ?? "—") },
      { label: "Project",     value: incident.project?.name ?? (incident.projectId ?? "—") },
      { label: "Detected At", value: ts },
      { label: "Incident ID", value: `<a href="${incidentUrl}" style="color:#2563eb;font-size:0.82em">${incident.id}</a>` },
      ...(incident.reasoning ? [{ label: "CMP Reasoning", value: `<span style="font-size:0.82em;color:#374151">${incident.reasoning}</span>` }] : []),
    ],
    image: {
      available: !!imageBuffer,
      cid: "incident_image",
      altText: "Incident frame",
      sectionTitle: "Evidence Photo",
    },
    edgeDescription: incident.edgeReport?.overallDescription ?? null,
    classifications,
    visionResult,
    bottomSection: {
      title: "Alarm Engine Outcome",
      html: bottomHtml,
    },
    timestamp: ts,
  };
}

// ── Adapter: test-run payload → UnifiedEmailParams ──────────────────────────

function testRunToParams(payload: TestRunPayload): UnifiedEmailParams {
  const ts = new Date().toLocaleString("en-HK", { timeZone: "Asia/Hong_Kong" }) + " HKT";
  const triggered = payload.alarmEval.filter(a => a.wouldCreate);
  const verdictColor = triggered.length > 0
    ? (triggered.some(a => a.riskLevel === "critical") ? "#dc2626" : "#ea580c")
    : "#16a34a";
  const verdictText = triggered.length > 0
    ? `⚠ INCIDENT CONFIRMED — ${triggered.map(a => a.type.replace(/_/g, " ")).join(", ")}`
    : "✓ No incident — scene assessed as safe";

  const alarmRows = triggered.map(a => `
    <tr>
      <td style="padding:6px 8px;font-size:0.82em">${a.type.replace(/_/g, " ")}</td>
      <td style="padding:6px 8px">${riskBadge(a.riskLevel ?? "")}</td>
      <td style="padding:6px 8px;font-size:0.78em;color:#374151">${a.reason}</td>
    </tr>`).join("");

  const bottomHtml = triggered.length > 0
    ? `<table style="width:100%;border-collapse:collapse;font-size:0.82em">
         <thead><tr style="background:#fef2f2">
           <th style="text-align:left;padding:6px 8px">Type</th>
           <th style="padding:6px 8px">Risk</th>
           <th style="text-align:left;padding:6px 8px">Reasoning</th>
         </tr></thead>
         <tbody>${alarmRows}</tbody>
       </table>`
    : `<p style="color:#16a34a;font-size:0.85em">No incidents would be created for this frame.</p>`;

  return {
    header: {
      title: "🧪 CMP TEST RUN — Pipeline Dry Run",
      subtitle: "No data was written to the database. This is a full pipeline simulation.",
    },
    verdict: {
      color: verdictColor,
      text: verdictText,
    },
    image: {
      available: !!payload.imageBuffer,
      cid: "test_image",
      altText: "Test frame",
      sectionTitle: "Test Image",
    },
    edgeDescription: payload.edgeDescription,
    classifications: payload.finalClassifications,
    visionResult: payload.visionResult,
    bottomSection: {
      title: "Alarm Engine Evaluation",
      html: bottomHtml,
    },
    timestamp: ts,
  };
}

// ── Production incident email ───────────────────────────────────────────────

export async function sendEmail(config: EmailConfig, incident: IncidentWithRelations): Promise<void> {
  const to = config.to as string | string[] | undefined;
  if (!to || (Array.isArray(to) && to.length === 0)) {
    throw new Error("Email channel missing 'to' address");
  }

  const { transporter, from } = await createTransporter();

  const classRaw = incident.edgeReport?.classificationJson as Partial<ClassificationResult> | null | undefined;
  const classifications: Classification[] = Array.isArray(classRaw?.classifications)
    ? (classRaw!.classifications as Classification[])
    : [];
  const visionResult = (incident.edgeReport?.visionVerificationJson ?? null) as VisionVerificationResult | null;

  let imageBuffer: Buffer | null = null;
  if (incident.edgeReport?.id) {
    imageBuffer = await loadIncidentImage(incident.edgeReport.id).catch(() => null);
  }

  const params = incidentToParams(incident, classifications, visionResult, imageBuffer);

  const subject = `[${incident.riskLevel.toUpperCase()}] ${incident.type.replace(/_/g, " ")} — ${incident.camera?.name ?? "Unknown camera"}`;

  const attachments: object[] = [];
  if (imageBuffer) {
    attachments.push({ filename: "incident-frame.jpg", content: imageBuffer, cid: "incident_image" });
  }

  await transporter.sendMail({
    from,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    html: buildEmailHtml(params),
    attachments,
  });

  console.log(`[Email] Sent to ${Array.isArray(to) ? to.join(", ") : to} for incident ${incident.id}`);
}

// ── Test-run dry-run pipeline email ────────────────────────────────────────

export type AlarmEvalResult = {
  type: string;
  wouldCreate: boolean;
  riskLevel?: string;
  reason: string;
};

export type TestRunPayload = {
  edgeDescription: string;
  classificationResult: ClassificationResult;
  visionResult: VisionVerificationResult | null;
  finalClassifications: Classification[];
  alarmEval: AlarmEvalResult[];
  imageBuffer: Buffer | null;
};

export async function sendTestRunEmail(config: EmailConfig, payload: TestRunPayload): Promise<void> {
  const to = config.to as string | string[] | undefined;
  if (!to || (Array.isArray(to) && to.length === 0)) {
    throw new Error("Email channel missing 'to' address");
  }

  const { transporter, from } = await createTransporter();

  const params = testRunToParams(payload);

  const triggered = payload.alarmEval.filter(a => a.wouldCreate);
  const subject = triggered.length > 0
    ? `[TEST] ⚠ CMP would raise incident — ${triggered.map(a => a.type.replace(/_/g, " ")).join(", ")}`
    : "[TEST] ✓ CMP pipeline run — no incident detected";

  const attachments: object[] = [];
  if (payload.imageBuffer) {
    attachments.push({ filename: "test-frame.jpg", content: payload.imageBuffer, cid: "test_image" });
  }

  await transporter.sendMail({
    from,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    html: buildEmailHtml(params),
    attachments,
  });

  console.log(`[Email] Test run report sent to ${Array.isArray(to) ? to.join(", ") : to}`);
}
