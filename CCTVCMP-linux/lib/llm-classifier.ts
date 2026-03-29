import type { IncidentRiskLevel, IncidentType } from "@prisma/client";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const CLASSIFIER_MODEL = "google/gemini-2.0-flash-001";

export type Classification = {
  type: IncidentType;
  detected: boolean;
  riskLevel: IncidentRiskLevel;
  confidence: number;
  reasoning: string;
};

export type ClassificationResult = {
  classifications: Classification[];
  source: "llm" | "fallback";
};

type AnalysisPayload = {
  overallDescription: string;
  overallRiskLevel: string;
  constructionSafety: { summary: string; issues: string[]; recommendations: string[] };
  fireSafety: { summary: string; issues: string[]; recommendations: string[] };
  propertySecurity: { summary: string; issues: string[]; recommendations: string[] };
  peopleCount?: number;
  missingHardhats?: number;
  missingVests?: number;
};

const INCIDENT_TYPES: IncidentType[] = [
  "ppe_violation",
  "fall_risk",
  "restricted_zone_entry",
  "machinery_hazard",
  "near_miss",
  "smoking",
  "fire_detected",
  "smoke_detected",
];

const CLASSIFICATION_PROMPT = `Classify safety issues into incident types.

Rules:
- fire_detected only if active flame/fire is mentioned
- smoke_detected only if visible smoke is mentioned
- "no issues" / clear statements mean not detected
- output ALL 8 incident types

Return STRICT JSON only:
{
  "classifications": [
    { "type": "<incident_type>", "detected": true/false, "riskLevel": "low|medium|high|critical", "confidence": 0-1, "reasoning": "brief" }
  ]
}`;

const CLASSIFIER_MAX_TOKENS = 350;
const CLASSIFIER_CACHE_TTL_MS = 3 * 60 * 1000;
const classificationCache = new Map<string, { at: number; results: Classification[] }>();

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

function extractCompactPayload(analysis: AnalysisPayload) {
  return {
    overallRiskLevel: analysis.overallRiskLevel,
    peopleCount: analysis.peopleCount ?? 0,
    missingHardhats: analysis.missingHardhats ?? 0,
    missingVests: analysis.missingVests ?? 0,
    constructionIssues: analysis.constructionSafety.issues ?? [],
    fireIssues: analysis.fireSafety.issues ?? [],
    propertyIssues: analysis.propertySecurity.issues ?? [],
  };
}

function shouldSkipLLM(analysis: AnalysisPayload): boolean {
  const noIssueText =
    (analysis.constructionSafety.issues?.length ?? 0) === 0 &&
    (analysis.fireSafety.issues?.length ?? 0) === 0 &&
    (analysis.propertySecurity.issues?.length ?? 0) === 0;
  const ppeClean = (analysis.missingHardhats ?? 0) === 0 && (analysis.missingVests ?? 0) === 0;
  return noIssueText && ppeClean;
}

/**
 * Classify PPE violations directly from numeric fields (no LLM needed).
 */
function classifyPPE(analysis: AnalysisPayload): Classification {
  const missing = (analysis.missingHardhats ?? 0) + (analysis.missingVests ?? 0);
  if (missing > 0) {
    const level = mapOverallRisk(analysis.overallRiskLevel);
    return {
      type: "ppe_violation",
      detected: true,
      riskLevel: level === "low" ? "medium" : level,
      confidence: 1.0,
      reasoning: `${analysis.missingHardhats ?? 0} missing hardhats, ${analysis.missingVests ?? 0} missing vests out of ${analysis.peopleCount ?? 0} people`,
    };
  }
  return {
    type: "ppe_violation",
    detected: false,
    riskLevel: "low",
    confidence: 1.0,
    reasoning: "No PPE violations detected from numeric fields",
  };
}

function mapOverallRisk(level: string): IncidentRiskLevel {
  switch (level) {
    case "Critical": return "critical";
    case "High": return "high";
    case "Medium": return "medium";
    case "Low": return "low";
    default: return "low";
  }
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
  if (cached && Date.now() - cached.at < CLASSIFIER_CACHE_TTL_MS) {
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
        { role: "user", content: `Classify this report:\n${JSON.stringify(compactPayload)}` },
      ],
      temperature: 0.1,
      max_tokens: CLASSIFIER_MAX_TOKENS,
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
    classificationCache.set(cacheKey, { at: Date.now(), results: filtered });
    return filtered;
  } catch (e) {
    const preview = text.length > 600 ? `${text.slice(0, 600)}…` : text;
    console.error("[LLM-Classifier] Failed to parse response:", e, "\n[LLM-Classifier] Raw response preview:", preview);
    return [];
  }
}

// ---- Keyword fallback (improved) ----

const FALL_KEYWORDS = ["fall", "height", "scaffold", "ladder", "tripping", "slip", "guardrail", "harness"];
const FIRE_KEYWORDS = ["active fire", "flame", "burning", "blaze", "on fire", "engulfed"];
const SMOKE_KEYWORDS = ["visible smoke", "smoldering", "smoking area"];
const INTRUSION_KEYWORDS = ["intrusion", "unauthorized", "restricted", "trespass", "breached"];
const MACHINERY_KEYWORDS = ["machinery", "heavy equipment", "crane", "forklift", "excavator"];
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

function fallbackClassify(analysis: AnalysisPayload): Classification[] {
  const results: Classification[] = [];
  const risk = mapOverallRisk(analysis.overallRiskLevel);

  const categories: Array<{
    type: IncidentType;
    keywords: string[];
    issues: string[];
    summary: string;
  }> = [
    { type: "fall_risk", keywords: FALL_KEYWORDS, issues: analysis.constructionSafety.issues, summary: analysis.constructionSafety.summary },
    { type: "fire_detected", keywords: FIRE_KEYWORDS, issues: analysis.fireSafety.issues, summary: analysis.fireSafety.summary },
    { type: "smoke_detected", keywords: SMOKE_KEYWORDS, issues: analysis.fireSafety.issues, summary: analysis.fireSafety.summary },
    { type: "restricted_zone_entry", keywords: INTRUSION_KEYWORDS, issues: analysis.propertySecurity.issues, summary: analysis.propertySecurity.summary },
    { type: "machinery_hazard", keywords: MACHINERY_KEYWORDS, issues: analysis.constructionSafety.issues, summary: analysis.constructionSafety.summary },
    { type: "smoking", keywords: SMOKING_KEYWORDS, issues: [...analysis.fireSafety.issues, ...analysis.propertySecurity.issues], summary: "" },
  ];

  for (const cat of categories) {
    const negated = issuesNegate(cat.issues, cat.summary);
    const detected = !negated && cat.issues.length > 0 && issuesContain(cat.issues, cat.keywords);
    results.push({
      type: cat.type,
      detected,
      riskLevel: detected ? risk : "low",
      confidence: detected ? 0.5 : 0.8,
      reasoning: detected ? `Keyword match in issues (fallback)` : "No keyword match or negated",
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

  return { classifications: deduped, source };
}
