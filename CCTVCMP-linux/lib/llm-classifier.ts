import type { IncidentRiskLevel, IncidentType } from "@prisma/client";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Text classifier model.
 *
 * Default: qwen/qwen3.5-9b  — works in HK region, fast, good at structured JSON.
 * Google Gemini models are region-blocked in HK.
 *
 * Override via CLASSIFIER_MODEL env var.
 */
const CLASSIFIER_MODEL =
  process.env.CLASSIFIER_MODEL?.trim() || "qwen/qwen3-vl-32b-instruct";
const CLASSIFIER_FALLBACK_MODEL =
  process.env.CLASSIFIER_FALLBACK_MODEL?.trim() || "qwen/qwen3.5-flash-02-23";

export type Classification = {
  type: IncidentType;
  detected: boolean;
  riskLevel: IncidentRiskLevel;
  confidence: number;
  reasoning: string;
};

export type ClassificationResult = {
  classifications: Classification[];
  /** How classifications were produced. "vision" = text+image reconciled. */
  source: "llm" | "fallback" | "vision";
  /** Which LLM model performed the text classification. */
  classifierModel?: string;
  /** Set when the image was verified by the vision model. */
  visionVerification?: import("@/lib/vision-verifier").VisionVerificationResult;
};

/** Labels emitted by Gemini per detection bounding-box. */
type DetectionLabel =
  | "person_ok"
  | "no_hardhat"
  | "no_vest"
  | "no_hardhat_no_vest"
  | "fire_smoke"
  | "smoking"
  | "machine_proximity"
  | "working_at_height"
  | "person_fallen"
  | "safety_hazard";

type Detection = {
  label: DetectionLabel;
  bbox?: [number, number, number, number];
  description?: string;
};

type AnalysisPayload = {
  overallDescription: string;
  overallRiskLevel: string;
  constructionSafety: { summary: string; issues: string[]; recommendations: string[] };
  fireSafety: { summary: string; issues: string[]; recommendations: string[] };
  propertySecurity: { summary: string; issues: string[]; recommendations: string[] };
  peopleCount?: number | null;
  missingHardhats?: number | null;
  missingVests?: number | null;
  /** Per-person / per-hazard bounding-box detections forwarded from edge. */
  detections?: Detection[];
};

const INCIDENT_TYPES: IncidentType[] = [
  "ppe_violation",
  "machinery_hazard",
  "fire_detected",
  "fall_risk",
  "smoking",
];

const CLASSIFICATION_PROMPT = `You are a construction-site incident verifier working for a Central Monitoring Platform (CMP).

The edge device has already analysed the scene and produced a text report. Your job is ONLY to identify the following HIGH-PRIORITY incident types — everything else must be ignored:
- ppe_violation    (missing hardhat only)
- fire_detected    (active fire OR dense/thick smoke)
- machinery_hazard (person in immediate danger from machinery)
- fall_risk        (person has actually fallen or is injured on the ground)
- smoking          (person actively smoking a cigarette/cigar on site)

Strict rules:
1. NEVER raise any incident type not in the list above.
2. Do NOT classify: near_miss, restricted_zone_entry, smoke_detected, or any other type.
3. Ignore vague terms like "general hazard", "unsafe condition", "potential risk".
4. For ppe_violation, only detect when the edge explicitly describes a MISSING HARDHAT on a specific person. A missing vest alone is NOT sufficient — do not raise ppe_violation for vest-only. The violation must involve a missing hard hat / safety helmet.
5. For fire_detected, detect when the edge mentions: (a) active fire, flame, or burning, OR (b) dense/thick/heavy smoke visible at the scene. Light haze or dust does NOT count. Both fire and significant smoke should be reported as fire_detected.
6. If the edge description says the view is wide, distant, overview-only, or PPE is unclear/not verifiable, DO NOT detect ppe_violation.
7. For machinery_hazard, ALL of the following must be true: (a) heavy machinery is present AND (b) a specific confirmed person is described as physically too close to that machine — within its swing radius, directly in its path, or in immediate danger of being struck — AND (c) peopleCount > 0. Workers simply being on the same site as machinery does NOT count.
8. If the text only mentions machinery operating WITHOUT a person described as dangerously close right now, set machinery_hazard=false.
9. CRITICAL — no speculative hazards: conditional/hypothetical language ("if workers were present", "potential risk if", "could be dangerous") = NOT detected. Only confirmed, currently observed situations count.
10. If peopleCount = 0 and no person is seen, set machinery_hazard=false regardless of machinery present.
11. ABSOLUTE RULE — no workers, no high risk: if peopleCount = 0, max riskLevel is "low" EXCEPT fire_detected ("critical") and fall_risk ("high" if person is visible on ground).
12. For fall_risk, the person MUST already have fallen, collapsed, or be lying injured on the ground RIGHT NOW. A risk of falling (working at height, uneven ground) does NOT count. Only confirmed fallen/collapsed/injured persons detected by the edge qualify.
13. fall_risk TRUE positive examples: "worker collapsed on the ground", "person lying motionless", "employee fell from scaffold and is on the ground", "injured worker visible".
14. fall_risk FALSE positive examples: "worker at height without harness", "risk of falling", "slippery surface", "working near edge" — these are risks, NOT confirmed falls.
15. machinery_hazard FALSE positive: "excavator operating on site, workers present nearby" — nearby is too vague.
16. machinery_hazard TRUE positive: "worker within the swing radius of the excavator arm", "person directly in the path of the reversing forklift".
17. CRITICAL — machine_proximity detection label is NOT evidence of dangerous proximity. Require explicit text confirming danger before setting machinery_hazard=true.

Risk rules:
- ppe_violation    → "high" only when edge clearly reports missing HARDHAT AND peopleCount > 0
- fire_detected    → "critical" for active fire/flame; "high" for dense smoke without confirmed flame
- machinery_hazard → "high" only when edge clearly reports machinery in immediate danger range of a confirmed person
- fall_risk        → "high" when person is confirmed fallen/collapsed/injured on the ground
- smoking          → "high" when edge clearly reports a person actively smoking AND peopleCount > 0

Return STRICT JSON only:
{
  "classifications": [
    { "type": "<one of the 4 incident types>", "detected": true/false, "riskLevel": "low|high|critical", "confidence": 0.0-1.0, "reasoning": "one line citing the edge text evidence" }
  ]
}`;

/**
 * Budget for "thinking" tokens (Gemini 2.5 Flash internal reasoning).
 * These are consumed before the visible response and count toward cost but
 * not toward CLASSIFIER_MAX_TOKENS.  1024 is enough for careful step-by-step
 * reasoning about 8 incident types without over-spending.
 */
const CLASSIFIER_THINKING_BUDGET = 1024;
const CLASSIFIER_MAX_TOKENS = 500;
const CLASSIFIER_CACHE_TTL_MS = 3 * 60 * 1000;
const classificationCache = new Map<string, { at: number; results: Classification[]; model: string }>();

function stripMarkdownFences(input: string): string {
  let cleaned = input.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

function parseLLMJsonPayload(text: string): { classifications: Classification[] } | null {
  const fenced = stripMarkdownFences(text);
  const candidates: string[] = [fenced];

  // Try extracting the largest JSON object block from mixed text.
  const firstBrace = fenced.indexOf("{");
  const lastBrace = fenced.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(fenced.slice(firstBrace, lastBrace + 1));
  }

  // Common model formatting issue: trailing commas before } or ].
  const repaired = candidates
    .map((c) => c.replace(/,\s*([}\]])/g, "$1"))
    .filter((c, i, arr) => arr.indexOf(c) === i);
  candidates.push(...repaired);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as { classifications: Classification[] };
    } catch {
      // Continue trying other candidates.
    }
  }
  return null;
}

function getApiKey(): string | null {
  // Trim to guard against Vercel env vars saved with accidental whitespace
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

/** Summarise detection labels as a compact string for the LLM prompt. */
function summariseDetections(detections: Detection[] | undefined): string | null {
  if (!detections?.length) return null;
  const counts: Partial<Record<DetectionLabel, number>> = {};
  for (const d of detections) {
    counts[d.label] = (counts[d.label] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([label, n]) => `${n}×${label}`)
    .join(", ");
}

function extractCompactPayload(analysis: AnalysisPayload) {
  // Intentionally omit overallRiskLevel so the LLM assesses each incident type
  // independently rather than echoing the edge device's single-number assessment.
  const base = {
    overallDescription: analysis.overallDescription,
    peopleCount: analysis.peopleCount ?? 0,
    missingHardhats: analysis.missingHardhats ?? 0,
    missingVests: analysis.missingVests ?? 0,
    constructionIssues: analysis.constructionSafety.issues ?? [],
    constructionSummary: analysis.constructionSafety.summary,
    fireIssues: analysis.fireSafety.issues ?? [],
    fireSummary: analysis.fireSafety.summary,
    propertyIssues: analysis.propertySecurity.issues ?? [],
    propertySummary: analysis.propertySecurity.summary,
  };
  const detectionSummary = summariseDetections(analysis.detections);
  if (detectionSummary) {
    return { ...base, detections: detectionSummary };
  }
  return base;
}

function shouldSkipLLM(analysis: AnalysisPayload): boolean {
  const noIssueText =
    (analysis.constructionSafety.issues?.length ?? 0) === 0 &&
    (analysis.fireSafety.issues?.length ?? 0) === 0 &&
    (analysis.propertySecurity.issues?.length ?? 0) === 0;
  // Vest-only violations no longer trigger incidents; only missing hardhats do.
  const ppeClean = (analysis.missingHardhats ?? 0) === 0;
  // Only keep LLM alive for labels that reliably indicate a real high-priority hazard.
  // no_vest excluded — vest-only violations no longer raise incidents.
  // machine_proximity excluded — label alone does not confirm dangerous proximity.
  const hasHazardDetections = analysis.detections?.some((d) =>
    ["fire_smoke", "smoking", "no_hardhat", "no_hardhat_no_vest", "person_fallen"].includes(d.label)
  ) ?? false;
  return noIssueText && ppeClean && !hasHazardDetections;
}

function isWideOrUnclearForPPE(analysis: AnalysisPayload): boolean {
  const text = [
    analysis.overallDescription,
    analysis.constructionSafety.summary,
    ...(analysis.constructionSafety.issues ?? []),
  ]
    .join(" ")
    .toLowerCase();

  const unclearSignals = [
    "wide view",
    "wide-angle",
    "overview",
    "distant",
    "far away",
    "too far",
    "too small",
    "small figures",
    "not clear",
    "unclear",
    "cannot verify ppe",
    "ppe not visible",
    "ppe unclear",
    "cannot clearly see",
    "not possible to verify ppe",
  ];

  return unclearSignals.some((signal) => text.includes(signal));
}

/**
 * CMP PPE assessment — hardhat violations only, ≥ 90% confidence required.
 *
 * Rules:
 * - Missing vest alone does NOT raise a ppe_violation incident.
 * - Only a confirmed missing hardhat triggers the alert.
 * - Numeric field (missingHardhats > 0): confidence 1.0 — edge VLM directly counted.
 * - Bounding-box label only (no_hardhat / no_hardhat_no_vest): confidence 0.85
 *   which falls below the 90% threshold, so it does NOT create an incident.
 *   This avoids false positives from workers wearing light-coloured or non-standard
 *   hardhats that the VLM might miss.
 */
const PPE_CONFIDENCE_THRESHOLD = 0.9;

function classifyPPE(analysis: AnalysisPayload): Classification {
  if (isWideOrUnclearForPPE(analysis)) {
    return {
      type: "ppe_violation",
      detected: false,
      riskLevel: "low",
      confidence: 0.9,
      reasoning: "PPE not assessed because the edge described a wide or unclear view",
    };
  }

  const missingHats = analysis.missingHardhats ?? 0;
  const missingVests = analysis.missingVests ?? 0;

  // Only hardhat-related bounding-box labels count.
  // no_vest alone is intentionally excluded.
  const hardhatLabels = ["no_hardhat", "no_hardhat_no_vest"] as const;
  const hardhatDetections = analysis.detections?.filter((d) =>
    hardhatLabels.includes(d.label as typeof hardhatLabels[number])
  ) ?? [];

  const hasHardhatViolation = missingHats > 0 || hardhatDetections.length > 0;
  const hasVestOnlyIssue = missingVests > 0 || (analysis.detections?.some((d) => d.label === "no_vest") ?? false);

  if (!hasHardhatViolation) {
    return {
      type: "ppe_violation",
      detected: false,
      riskLevel: "low",
      confidence: 1.0,
      reasoning: hasVestOnlyIssue
        ? "Vest-only violation — not raised as incident (hardhat violations only)"
        : "No hardhat PPE violations detected",
    };
  }

  // Numeric field: direct VLM count → reliable → 1.0
  // Detection label only: bounding-box, higher false-positive rate → 0.85
  const confidence = missingHats > 0 ? 1.0 : 0.85;

  if (confidence < PPE_CONFIDENCE_THRESHOLD) {
    return {
      type: "ppe_violation",
      detected: false,
      riskLevel: "low",
      confidence,
      reasoning: `Hardhat detection confidence ${Math.round(confidence * 100)}% is below the 90% threshold — not raised to avoid false positives`,
    };
  }

  const parts: string[] = [];
  if (missingHats > 0) {
    parts.push(`${missingHats} missing hardhat(s) reported by edge`);
  }
  if (hardhatDetections.length > 0) {
    parts.push(`${hardhatDetections.length} bounding-box hardhat violation(s): ${hardhatDetections.map((d) => d.label).join(", ")}`);
  }
  if (missingVests > 0) {
    parts.push(`${missingVests} missing vest(s) noted but not counted toward incident`);
  }

  return {
    type: "ppe_violation",
    detected: true,
    riskLevel: "high",
    confidence,
    reasoning: `CMP verification: missing hardhat confirmed. ${parts.join("; ")}`,
  };
}


/**
 * Use LLM to classify natural language categories.
 * Returns classifications for all non-PPE incident types.
 */
async function classifyWithLLM(analysis: AnalysisPayload): Promise<Classification[]> {
  if (shouldSkipLLM(analysis)) {
    // No non-PPE safety issues to classify; avoid spending tokens.
    return [];
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("[LLM-Classifier] OPENROUTER_API_KEY is not set or empty — using keyword fallback");
    return [];
  }

  const compactPayload = extractCompactPayload(analysis);
  const cacheKey = JSON.stringify(compactPayload);
  const cached = classificationCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CLASSIFIER_CACHE_TTL_MS && cached.model === CLASSIFIER_MODEL) {
    return cached.results;
  }

  const callModel = async (model: string) => {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://axon-vision-cmp.vercel.app",
        "X-Title": "Axon CMP Classifier",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: CLASSIFICATION_PROMPT },
          { role: "user", content: `Classify this safety report:\n${JSON.stringify(compactPayload, null, 2)}` },
        ],
        temperature: 0.1,
        max_tokens: CLASSIFIER_MAX_TOKENS,
        // Gemini uses this; other models ignore it gracefully.
        thinking: { type: "enabled", budget_tokens: CLASSIFIER_THINKING_BUDGET },
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "unknown");
      throw Object.assign(new Error(errText), { status: response.status });
    }
    const result = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return result.choices?.[0]?.message?.content ?? "";
  };

  let text = "";
  let usedModel = CLASSIFIER_MODEL;
  try {
    text = await callModel(CLASSIFIER_MODEL);
  } catch (err) {
    const status = (err as { status?: number }).status;
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    const isBlocked = status === 403 || msg.includes("banned") || msg.includes("not available in your region");
    if (!isBlocked) {
      console.error(`[LLM-Classifier] API error ${status ?? "unknown"}:`, err);
      return [];
    }
    console.warn(`[LLM-Classifier] Primary model blocked; retrying with ${CLASSIFIER_FALLBACK_MODEL}`);
    try {
      text = await callModel(CLASSIFIER_FALLBACK_MODEL);
      usedModel = CLASSIFIER_FALLBACK_MODEL;
    } catch (fallbackErr) {
      console.error("[LLM-Classifier] Fallback model also failed:", fallbackErr);
      return [];
    }
  }

  if (!text) return [];

  try {
    const parsed = parseLLMJsonPayload(text);
    if (!parsed) {
      throw new Error("Unable to parse model JSON payload");
    }
    const noWorkers = (analysis.peopleCount ?? 0) === 0;
    const filtered = (parsed.classifications ?? [])
      .filter((c) => INCIDENT_TYPES.includes(c.type) && c.type !== "ppe_violation")
      .map((c) => {
        // Hard cap: no workers on site → nothing can be high/critical except fire and confirmed falls.
        // fall_risk is exempt because a fallen person IS a person even if peopleCount=0.
        if (noWorkers && c.type !== "fire_detected" && c.type !== "fall_risk") {
          return { ...c, detected: false, riskLevel: "low" as const, confidence: 0.1,
            reasoning: `[CMP override] peopleCount=0 — scene has no workers; risk capped at low. Original: ${c.reasoning}` };
        }
        return c;
      });
    classificationCache.set(cacheKey, { at: Date.now(), results: filtered, model: usedModel });
    return filtered;
  } catch (e) {
    const preview = text.length > 600 ? `${text.slice(0, 600)}…` : text;
    console.error("[LLM-Classifier] Failed to parse response:", e, "\n[LLM-Classifier] Raw response preview:", preview);
    return [];
  }
}


const LLM_CLEAN_RESULTS = (INCIDENT_TYPES as IncidentType[])
  .filter((t) => t !== "ppe_violation")
  .map((type): Classification => ({
    type,
    detected: false,
    riskLevel: "low" as IncidentRiskLevel,
    confidence: 0.95,
    reasoning: "No safety issues reported by edge — LLM classification skipped",
  }));

/**
 * Classify the edge analysis using LLM only.
 * The LLM is skipped only when the edge report is provably clean (no issues, no hazard labels).
 * There is no keyword fallback — if the LLM fails, all non-PPE types are returned as not detected
 * to avoid false positives from low-quality heuristics.
 */
export async function classifyAnalysis(analysis: AnalysisPayload): Promise<ClassificationResult> {
  const ppeResult = classifyPPE(analysis);

  // When the edge report has no issues, no PPE violations, and no hazard detections,
  // skip the LLM (to save tokens) and return all-clean results immediately.
  // This is an intentional skip, NOT a failure.
  if (shouldSkipLLM(analysis)) {
    console.log(`[LLM-Classifier] source=llm (skipped — clean report) types=none`);
    return {
      classifications: [ppeResult, ...LLM_CLEAN_RESULTS],
      source: "llm",
      classifierModel: CLASSIFIER_MODEL,
    };
  }

  let llmResults: Classification[];
  try {
    llmResults = await classifyWithLLM(analysis);
    if (llmResults.length === 0) {
      throw new Error("LLM returned empty classifications array");
    }
  } catch (err) {
    console.error("[LLM-Classifier] LLM call failed — returning clean to avoid false positives:", err);
    const allClassifications = [ppeResult, ...LLM_CLEAN_RESULTS.map((r) => ({
      ...r,
      reasoning: "LLM unavailable — incident suppressed to avoid false positives",
    }))];
    console.log(`[LLM-Classifier] source=llm (error) types=none`);
    return {
      classifications: allClassifications,
      source: "llm",
      classifierModel: CLASSIFIER_MODEL,
    };
  }

  const allClassifications = [ppeResult, ...llmResults];

  const seen = new Set<string>();
  const deduped: Classification[] = [];
  for (const c of allClassifications) {
    if (!seen.has(c.type)) {
      seen.add(c.type);
      deduped.push(c);
    }
  }

  console.log(`[LLM-Classifier] source=llm model=${CLASSIFIER_MODEL} types=${deduped.filter((c) => c.detected).map((c) => c.type).join(",") || "none"}`);

  return {
    classifications: deduped,
    source: "llm",
    classifierModel: CLASSIFIER_MODEL,
  };
}
