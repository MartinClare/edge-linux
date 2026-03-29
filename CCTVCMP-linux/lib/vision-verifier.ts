/**
 * Vision Verifier — CMP-side image re-analysis.
 *
 * When the edge device sends a JPEG frame alongside its textual analysis, this
 * module sends that image to a vision-capable LLM and asks it to independently
 * verify whether the description is accurate.  The result is then reconciled
 * with the text-classifier output so that:
 *
 *  • CMP never introduces new issue types from vision alone.
 *  • Hazards claimed in text but absent from the image have their confidence
 *    reduced.
 *  • The final `ClassificationResult` carries a `visionVerified` flag and a
 *    human-readable `visionSummary` for display in the UI.
 */

import type { Classification } from "@/lib/llm-classifier";
import type { IncidentRiskLevel, IncidentType } from "@prisma/client";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Vision model for image re-analysis and edge description verification.
 *
 * Default: google/gemini-3-flash-preview
 *   — Newest Gemini, designed for agentic multimodal workflows.
 *   — Near-Pro reasoning on construction site images; #1 ranked in Health
 *     (closest publicly tracked safety-adjacent domain) on OpenRouter.
 *   — Supports 1 M token context, allowing large base64 images inline.
 *   — $0.50/M input — far cheaper than Claude ($3/M) or GPT-5.4 ($2.50/M).
 *
 * Override via VISION_MODEL env var (e.g. anthropic/claude-sonnet-4-6 for
 * maximum accuracy when budget is not a concern).
 */
const VISION_MODEL =
  process.env.VISION_MODEL?.trim() || "google/gemini-3-flash-preview";

/**
 * Thinking budget for the vision model (Gemini 3 Flash reasoning tokens).
 * The model reasons internally before producing its JSON answer.
 * 2048 gives it enough budget to carefully inspect the image region-by-region
 * before committing to a PPE/fire/machinery verdict.
 */
const VISION_THINKING_BUDGET = 2048;

/** Structure returned by the vision LLM. */
export type VisionVerificationResult = {
  /** Whether the vision model broadly agrees with the edge description. */
  descriptionAccuracy: "accurate" | "partially_accurate" | "inaccurate";
  /** Hazards seen in the image that the edge did not mention. */
  missedHazards: string[];
  /** Claims in the edge description that are NOT visible in the image. */
  incorrectClaims: string[];
  /** Vision model's own incident-level classifications. */
  visionClassifications: Classification[];
  /** One-sentence human-readable verdict. */
  summary: string;
};

const INCIDENT_TYPES: IncidentType[] = [
  "ppe_violation",
  "machinery_hazard",
  "smoking",
  "fire_detected",
];

const VISION_SYSTEM_PROMPT = `You are an expert construction-site safety auditor with deep expertise in PPE compliance, fire hazards, and machinery safety. You are reviewing a camera image.

An edge AI device has already produced a text description of this scene. Your task is to verify whether the edge's description is visually supported.

Step-by-step approach (reason carefully before answering):
1. Read the edge summary first.
2. Only evaluate these 4 issue types: ppe_violation, smoking, fire_detected, machinery_hazard.
3. Compare the image to the edge summary and decide whether each edge-mentioned issue is visually supported.
4. NEVER introduce a new issue type that the edge did not mention.
5. Do NOT use people counts; they are not reliable enough for this task.

Risk rules:
- ppe_violation    → "high" when visually supported
- smoking          → "high" when visually supported
- fire_detected    → "critical" when active fire/flame is visible
- machinery_hazard → "high" when machinery is too close to a person

Return STRICT JSON only — no markdown fences, no commentary outside the JSON:
{
  "descriptionAccuracy": "accurate|partially_accurate|inaccurate",
  "missedHazards": [],
  "incorrectClaims": ["describe each edge claim NOT visible in the image"],
  "visionClassifications": [
    { "type": "<one of the 4 types>", "detected": true/false, "riskLevel": "low|high|critical", "confidence": 0.0-1.0, "reasoning": "one concise line citing visual evidence" }
  ],
  "summary": "one sentence overall verdict"
}`;

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```json")) t = t.slice(7);
  else if (t.startsWith("```")) t = t.slice(3);
  if (t.endsWith("```")) t = t.slice(0, -3);
  return t.trim();
}

function parseVisionJson(text: string): VisionVerificationResult | null {
  const candidates = [stripFences(text)];
  const first = candidates[0];
  const a = first.indexOf("{");
  const b = first.lastIndexOf("}");
  if (a >= 0 && b > a) candidates.push(first.slice(a, b + 1));
  candidates.push(...candidates.map((c) => c.replace(/,\s*([}\]])/g, "$1")));

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as VisionVerificationResult;
      if (parsed.visionClassifications) return parsed;
    } catch {
      // continue
    }
  }
  return null;
}

function buildEdgeSummaryText(analysis: {
  overallDescription: string;
  constructionSafety: { summary: string; issues: string[] };
  fireSafety: { summary: string; issues: string[] };
  propertySecurity: { summary: string; issues: string[] };
  peopleCount?: number | null;
  missingHardhats?: number | null;
  missingVests?: number | null;
}): string {
  const lines: string[] = [
    `Overall: ${analysis.overallDescription}`,
    `PPE flags from edge: missing hardhats: ${analysis.missingHardhats ?? 0}, missing vests: ${analysis.missingVests ?? 0}`,
    `Construction safety: ${analysis.constructionSafety.summary}`,
    ...(analysis.constructionSafety.issues.length ? [`  Issues: ${analysis.constructionSafety.issues.join("; ")}`] : []),
    `Fire safety: ${analysis.fireSafety.summary}`,
    ...(analysis.fireSafety.issues.length ? [`  Issues: ${analysis.fireSafety.issues.join("; ")}`] : []),
    `Property security: ${analysis.propertySecurity.summary}`,
    ...(analysis.propertySecurity.issues.length ? [`  Issues: ${analysis.propertySecurity.issues.join("; ")}`] : []),
  ];
  return lines.join("\n");
}

/**
 * Send the image to a vision LLM and ask it to verify the edge's description.
 * Returns null if no API key is configured or the image is too large.
 */
export async function verifyWithVision(
  imageBytes: Buffer,
  mimeType: string,
  analysis: Parameters<typeof buildEdgeSummaryText>[0]
): Promise<VisionVerificationResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[VisionVerifier] OPENROUTER_API_KEY not set — skipping vision verification");
    return null;
  }

  // Guard: skip if the image is implausibly large (> 10 MB would inflate the base64 payload)
  if (imageBytes.length > 10 * 1024 * 1024) {
    console.warn("[VisionVerifier] Image too large for inline base64 — skipping");
    return null;
  }

  const base64Image = imageBytes.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64Image}`;
  const edgeSummary = buildEdgeSummaryText(analysis);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://axon-vision-cmp.vercel.app",
        "X-Title": "Axon CMP Vision Verifier",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: "system", content: VISION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Edge device analysis to verify:\n\n${edgeSummary}\n\nExamine the image carefully, then verify whether the description is accurate and provide your own independent safety classification.`,
              },
              {
                type: "image_url",
                image_url: { url: dataUrl },
              },
            ],
          },
        ],
        temperature: 0.1,
        // Extra headroom for thinking tokens (Gemini 3 Flash) + JSON output
        max_tokens: 800,
        // Enable internal reasoning before producing the JSON answer.
        // Gemini models use this; other models ignore it gracefully.
        thinking: { type: "enabled", budget_tokens: VISION_THINKING_BUDGET },
      }),
    });
  } catch (err) {
    console.error("[VisionVerifier] Network error calling vision API:", err);
    return null;
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    console.error(`[VisionVerifier] API error ${response.status}: ${errText}`);
    return null;
  }

  const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = result.choices?.[0]?.message?.content;
  if (!text) return null;

  const parsed = parseVisionJson(text);
  if (!parsed) {
    console.error("[VisionVerifier] Failed to parse vision JSON. Raw:", text.slice(0, 400));
    return null;
  }

  // Sanitise: keep only known incident types
  parsed.visionClassifications = (parsed.visionClassifications ?? []).filter(
    (c) => INCIDENT_TYPES.includes(c.type)
  );

  // Attach which model performed the verification so it can be displayed in the UI
  (parsed as Record<string, unknown>).model = VISION_MODEL;

  return parsed;
}

const RISK_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function higher(a: IncidentRiskLevel, b: IncidentRiskLevel): IncidentRiskLevel {
  return (RISK_ORDER[a] ?? 0) >= (RISK_ORDER[b] ?? 0) ? a : b;
}

/**
 * Merge text-classifier results with vision-classifier results.
 *
 * Strategy per incident type:
 *  - Both detected  → keep higher risk, average confidence, append reasoning.
 *  - Vision only    → ignored (CMP must not invent a new issue not mentioned by edge).
 *  - Text only      → keep but reduce confidence by 20% (vision didn't corroborate).
 *  - Neither        → not detected.
 */
export function reconcileClassifications(
  textResults: Classification[],
  visionResults: Classification[]
): Classification[] {
  const textMap = new Map(textResults.map((c) => [c.type, c]));
  const visionMap = new Map(visionResults.map((c) => [c.type, c]));

  const allTypes = new Set<IncidentType>([
    ...textMap.keys(),
    ...visionMap.keys(),
  ]);

  const reconciled: Classification[] = [];

  for (const type of allTypes) {
    const t = textMap.get(type);
    const v = visionMap.get(type);

    if (t?.detected && v?.detected) {
      reconciled.push({
        type,
        detected: true,
        riskLevel: higher(t.riskLevel, v.riskLevel),
        confidence: Math.min(1.0, (t.confidence + v.confidence) / 2 + 0.1),
        reasoning: `Text+Vision agree. Text: ${t.reasoning} | Vision: ${v.reasoning}`,
      });
    } else if (!t?.detected && v?.detected) {
      // Ignore vision-only issues — CMP must not raise new issue types the edge did not mention
      reconciled.push({
        type,
        detected: false,
        riskLevel: "low",
        confidence: Math.min(0.75, v.confidence),
        reasoning: `Ignored vision-only issue (edge did not mention it): ${v.reasoning}`,
      });
    } else if (t?.detected && !v?.detected) {
      // Text claims detection but vision disagrees — reduce confidence
      reconciled.push({
        type,
        detected: true,
        riskLevel: t.riskLevel,
        confidence: Math.max(0, t.confidence - 0.2),
        reasoning: `Text detected but vision did not corroborate (confidence reduced): ${t.reasoning}`,
      });
    } else {
      // Neither detected
      reconciled.push({
        type,
        detected: false,
        riskLevel: "low",
        confidence: t?.confidence ?? v?.confidence ?? 0.9,
        reasoning: t?.reasoning ?? v?.reasoning ?? "Not detected",
      });
    }
  }

  return reconciled;
}
