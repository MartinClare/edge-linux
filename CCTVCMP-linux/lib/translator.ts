/**
 * Translates LLM-generated safety analysis text to Simplified Chinese.
 * Uses a fast, cheap OpenRouter model to batch all texts in one API call.
 * Called at ingest time in processReportBackground; result is stored in
 * EdgeReport.translationsJson.
 */

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Use a fast model for translation — accuracy over creativity
const TRANSLATOR_MODEL =
  process.env.TRANSLATOR_MODEL?.trim() || "qwen/qwen3.5-flash-02-23";

export type TranslationsJson = {
  overallDescription?: string;
  classifications?: Array<{ type: string; reasoning: string }>;
  visionSummary?: string;
  visionMissedHazards?: string[];
  visionIncorrectClaims?: string[];
};

type TranslateInput = {
  overallDescription: string;
  classifications: Array<{ type: string; reasoning: string }>;
  visionSummary?: string;
  visionMissedHazards?: string[];
  visionIncorrectClaims?: string[];
};

/**
 * Translate all dynamic texts from a processed edge report into Simplified Chinese.
 * Returns a TranslationsJson object whose fields mirror the source data.
 * Throws on API failure — caller should wrap in try/catch.
 */
export async function translateReportToZh(input: TranslateInput): Promise<TranslationsJson> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  // Build a compact JSON payload to translate in one round-trip
  const payload: Record<string, unknown> = {
    description: input.overallDescription,
    classifications: input.classifications,
    ...(input.visionSummary ? { visionSummary: input.visionSummary } : {}),
    ...(input.visionMissedHazards?.length ? { visionMissedHazards: input.visionMissedHazards } : {}),
    ...(input.visionIncorrectClaims?.length ? { visionIncorrectClaims: input.visionIncorrectClaims } : {}),
  };

  const systemPrompt = `You are a professional translator for construction site safety reports.
Translate the following JSON object from English to Traditional Chinese (繁體中文, as used in Hong Kong and Taiwan).
Rules:
- Translate all string values; keep all keys unchanged.
- Keep proper nouns, IDs, and technical abbreviations (CMP, PPE, VLM) in English.
- Return ONLY the translated JSON — no markdown, no explanation.`;

  const userContent = JSON.stringify(payload);

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TRANSLATOR_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenRouter translation failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";

  // Strip ```json fences if model wraps output
  const jsonStr = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  let translated: Record<string, unknown>;
  try {
    translated = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Translator returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  const result: TranslationsJson = {};

  if (typeof translated.description === "string") {
    result.overallDescription = translated.description;
  }

  if (Array.isArray(translated.classifications)) {
    result.classifications = (translated.classifications as Array<Record<string, unknown>>).map((c) => ({
      type: typeof c.type === "string" ? c.type : "",
      reasoning: typeof c.reasoning === "string" ? c.reasoning : "",
    }));
  }

  if (typeof translated.visionSummary === "string") {
    result.visionSummary = translated.visionSummary;
  }

  if (Array.isArray(translated.visionMissedHazards)) {
    result.visionMissedHazards = (translated.visionMissedHazards as unknown[])
      .filter((x): x is string => typeof x === "string");
  }

  if (Array.isArray(translated.visionIncorrectClaims)) {
    result.visionIncorrectClaims = (translated.visionIncorrectClaims as unknown[])
      .filter((x): x is string => typeof x === "string");
  }

  return result;
}
