import type { IncidentRiskLevel, IncidentType } from "@prisma/client";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Text classifier model.
 *
 * Default: google/gemini-2.5-flash
 *   — Built-in "thinking" mode reasons step-by-step before classifying, which
 *     handles ambiguous safety text (cooking smoke vs dangerous smoke, PPE
 *     partially obscured, etc.) far better than a non-thinking flash model.
 *   — ~6× cheaper than Claude/GPT-5 while matching them on structured JSON tasks.
 *
 * Override via CLASSIFIER_MODEL env var (e.g. anthropic/claude-sonnet-4-6 for
 * maximum quality, google/gemini-2.5-flash-lite for maximum throughput).
 */
const CLASSIFIER_MODEL =
  process.env.CLASSIFIER_MODEL?.trim() || "google/gemini-2.5-flash";

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
  "smoking",
  "fire_detected",
];

const CLASSIFICATION_PROMPT = `You are a construction-site incident verifier working for a Central Monitoring Platform (CMP).

The edge device has already analysed the scene and produced a text report. Your job is NOT to invent new issue types. Your job is only to read the edge text and decide whether the edge explicitly mentioned any of these 4 issue types:
- ppe_violation
- smoking
- fire_detected
- machinery_hazard

Strict rules:
1. NEVER raise a new issue type that the edge text does not mention.
2. Ignore vague terms like "near miss", "general hazard", "unsafe condition", or "people count".
3. Do NOT classify fall_risk, near_miss, restricted_zone_entry, or smoke_detected.
4. Do NOT use peopleCount to decide severity; it is not reliable enough.
5. For PPE, only detect ppe_violation when the edge explicitly describes missing PPE or PPE-violation detections.
6. For fire_detected, require the edge to mention active fire/flame/burning — not only smoke.
7. If the edge description says the view is wide, distant, overview-only, or that PPE is unclear / not verifiable, DO NOT detect ppe_violation.

Risk rules:
- ppe_violation    → "high" when edge clearly reports missing PPE
- smoking          → "high" when edge clearly reports a person smoking
- fire_detected    → "critical" when edge clearly reports active fire/flame
- machinery_hazard → "high" when edge clearly reports machinery too close to people

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
  const ppeClean = (analysis.missingHardhats ?? 0) === 0 && (analysis.missingVests ?? 0) === 0;
  // Hazard detections from Gemini mean the LLM can still classify fire/smoke/machinery
  const hasHazardDetections = analysis.detections?.some((d) =>
    ["fire_smoke", "smoking", "machine_proximity", "no_hardhat", "no_vest", "no_hardhat_no_vest"].includes(d.label)
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
 * CMP's own PPE risk assessment — independent of the edge's overallRiskLevel.
 *
 * CMP no longer estimates the number of people involved; edge people counts are
 * not reliable enough. PPE is treated as a focused issue type: if the edge text
 * or detections indicate missing PPE, CMP marks ppe_violation=true and lets the
 * alarm rules / UI handle severity policy.
 */
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
  const missingNumeric = missingHats + missingVests;

  const ppeLabels = ["no_hardhat", "no_vest", "no_hardhat_no_vest"] as const;
  const ppeDetections = analysis.detections?.filter((d) =>
    ppeLabels.includes(d.label as typeof ppeLabels[number])
  ) ?? [];

  const detected = missingNumeric > 0 || ppeDetections.length > 0;

  if (!detected) {
    return {
      type: "ppe_violation",
      detected: false,
      riskLevel: "low",
      confidence: 1.0,
      reasoning: "No PPE violations from numeric fields or detection labels",
    };
  }

  const parts: string[] = [];
  if (missingNumeric > 0) {
    parts.push(`${missingHats} missing hardhats, ${missingVests} missing vests reported by edge`);
  }
  if (ppeDetections.length > 0) {
    parts.push(`${ppeDetections.length} bounding-box PPE violation(s): ${ppeDetections.map((d) => d.label).join(", ")}`);
  }

  return {
    type: "ppe_violation",
    detected: true,
    riskLevel: "high",
    confidence: missingNumeric > 0 ? 1.0 : 0.85,
    reasoning: `CMP verification: edge reported PPE violation. ${parts.join("; ")}`,
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

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://axon-vision-cmp.vercel.app",
      "X-Title": "Axon CMP Classifier",
    },
    body: JSON.stringify({
      model: CLASSIFIER_MODEL,
      messages: [
        { role: "system", content: CLASSIFICATION_PROMPT },
        { role: "user", content: `Classify this safety report:\n${JSON.stringify(compactPayload, null, 2)}` },
      ],
      temperature: 0.1,
      max_tokens: CLASSIFIER_MAX_TOKENS,
      // Enable step-by-step reasoning for Gemini 2.5 Flash (thinking tokens).
      // Other models ignore this parameter gracefully.
      thinking: { type: "enabled", budget_tokens: CLASSIFIER_THINKING_BUDGET },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "unknown");
    console.error(`[LLM-Classifier] API error ${response.status}: ${errText}`);
    return [];
  }

  const result = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = result.choices?.[0]?.message?.content;
  if (!text) return [];

  try {
    const parsed = parseLLMJsonPayload(text);
    if (!parsed) {
      throw new Error("Unable to parse model JSON payload");
    }
    const filtered = (parsed.classifications ?? []).filter(
      (c) => INCIDENT_TYPES.includes(c.type) && c.type !== "ppe_violation"
    );
    classificationCache.set(cacheKey, { at: Date.now(), results: filtered, model: CLASSIFIER_MODEL });
    return filtered;
  } catch (e) {
    const preview = text.length > 600 ? `${text.slice(0, 600)}…` : text;
    console.error("[LLM-Classifier] Failed to parse response:", e, "\n[LLM-Classifier] Raw response preview:", preview);
    return [];
  }
}

// ---- Keyword fallback (improved) ----

const FIRE_KEYWORDS = ["active fire", "flame", "burning", "blaze", "on fire", "engulfed"];
const MACHINERY_KEYWORDS = ["machine", "machinery", "heavy equipment", "crane", "forklift", "excavator", "too close"];
const SMOKING_KEYWORDS = ["smoking", "cigarette", "tobacco"];

function issuesContain(issues: string[], keywords: string[]): boolean {
  const text = issues.join(" ").toLowerCase();
  return keywords.some((k) => text.includes(k));
}

function issuesNegate(issues: string[], summary: string): boolean {
  const combinedText = (summary + " " + issues.join(" ")).toLowerCase();
  const negations = ["no ", "not ", "none ", "clear", "no issues", "no hazard", "no concern", "all clear"];
  return negations.some((n) => combinedText.includes(n)) && issues.length === 0;
}

/** Map Gemini detection labels to incident types for direct (no-LLM) classification. */
const DETECTION_LABEL_TO_INCIDENT: Partial<Record<DetectionLabel, IncidentType>> = {
  fire_smoke:        "fire_detected",
  smoking:           "smoking",
  machine_proximity: "machinery_hazard",
};

/**
 * CMP's own inherent risk level per incident type — independent of what the edge reported.
 * These reflect the CMP's safety policy and are used by the fallback classifier.
 * The LLM classifier produces its own values; these only apply when LLM is unavailable.
 */
const INHERENT_RISK: Record<IncidentType, IncidentRiskLevel> = {
  fire_detected:        "critical",
  machinery_hazard:     "high",
  ppe_violation:        "high",
  smoking:              "high",
} as unknown as Record<IncidentType, IncidentRiskLevel>;

/** Escalate risk for detection labels that imply a more severe case. */
function escalateByDetection(base: IncidentRiskLevel, type: IncidentType, detections: Detection[]): IncidentRiskLevel {
  if (type === "fire_detected" && detections.some((d) => d.label === "fire_smoke")) return "critical";
  return base;
}

function fallbackClassify(analysis: AnalysisPayload): Classification[] {
  const results: Classification[] = [];
  const detections = analysis.detections ?? [];

  // Build detection-label lookup
  const detectedByLabel = new Set<IncidentType>();
  for (const det of detections) {
    const incidentType = DETECTION_LABEL_TO_INCIDENT[det.label];
    if (incidentType) detectedByLabel.add(incidentType);
  }

  const categories: Array<{
    type: IncidentType;
    keywords: string[];
    issues: string[];
    summary: string;
  }> = [
    { type: "fire_detected",         keywords: FIRE_KEYWORDS,      issues: analysis.fireSafety.issues,         summary: analysis.fireSafety.summary },
    { type: "machinery_hazard",      keywords: MACHINERY_KEYWORDS, issues: analysis.constructionSafety.issues, summary: analysis.constructionSafety.summary },
    { type: "smoking",               keywords: SMOKING_KEYWORDS,   issues: [...analysis.fireSafety.issues, ...analysis.propertySecurity.issues], summary: "" },
  ];

  for (const cat of categories) {
    const negated = issuesNegate(cat.issues, cat.summary);
    const textDetected = !negated && cat.issues.length > 0 && issuesContain(cat.issues, cat.keywords);
    const labelDetected = detectedByLabel.has(cat.type);
    const detected = textDetected || labelDetected;

    // CMP inherent risk — NOT copied from edge's overallRiskLevel
    const baseRisk = INHERENT_RISK[cat.type] ?? "medium";
    const riskLevel = detected ? escalateByDetection(baseRisk, cat.type, detections) : "low";

    const reasoning = labelDetected
      ? `CMP detection-label match → inherent ${riskLevel} for ${cat.type}`
      : textDetected
      ? `CMP keyword match → inherent ${riskLevel} for ${cat.type}`
      : "Not detected";

    results.push({
      type: cat.type,
      detected,
      riskLevel,
      confidence: labelDetected ? 0.9 : textDetected ? 0.6 : 0.9,
      reasoning,
    });
  }

  return results;
}

/**
 * Hybrid classifier: numeric PPE + LLM for other categories.
 * Falls back to keyword matching if LLM is unavailable.
 */
export async function classifyAnalysis(analysis: AnalysisPayload): Promise<ClassificationResult> {
  const ppeResult = classifyPPE(analysis);

  let llmResults = await classifyWithLLM(analysis).catch((err) => {
    console.error("[LLM-Classifier] LLM call failed, using fallback:", err);
    return [] as Classification[];
  });

  let source: "llm" | "fallback" = "llm";

  if (llmResults.length === 0) {
    llmResults = fallbackClassify(analysis);
    source = "fallback";
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

  console.log(`[LLM-Classifier] source=${source} model=${source === "llm" ? CLASSIFIER_MODEL : "fallback"} types=${deduped.filter((c) => c.detected).map((c) => c.type).join(",") || "none"}`);

  return {
    classifications: deduped,
    source,
    classifierModel: source === "llm" ? CLASSIFIER_MODEL : undefined,
  };
}
