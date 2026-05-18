/**
 * OpenRouter vision API for edge analysis when `vision.activeModel` is `openrouter`.
 * Uses the same safety JSON contract as local models.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type OpenRouterVisionOptions = {
  model: string;
  fallbackModel?: string;
  maxTokens?: number;
  apiKey: string;
};

/**
 * @param imageMime e.g. image/jpeg
 * @param imageBase64 raw base64 without data URL prefix
 * @param prompt full safety analysis prompt
 */
export async function callOpenRouterVision(
  imageMime: string,
  imageBase64: string,
  prompt: string,
  options: OpenRouterVisionOptions,
): Promise<string> {
  const { model, fallbackModel, maxTokens = 512, apiKey } = options;
  if (!apiKey?.trim()) {
    throw new Error('OPENROUTER_API_KEY is not set (or empty)');
  }
  const dataUrl = `data:${imageMime};base64,${imageBase64}`;

  const body = (m: string) => ({
    model: m,
    temperature: 0.2,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const doFetch = async (m: string) => {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/axon-vision/edge',
        'X-Title': 'Axon Edge Vision',
      },
      body: JSON.stringify(body(m)),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`OpenRouter HTTP ${res.status}: ${t.slice(0, 500)}`);
    }
    return res.json() as Promise<{
      choices?: Array<{ message?: { content?: string } }>;
    }>;
  };

  try {
    const j = await doFetch(model);
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenRouter returned empty content');
    return text;
  } catch (e) {
    if (!fallbackModel || fallbackModel === model) throw e;
    const j = await doFetch(fallbackModel);
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenRouter returned empty content (fallback)');
    return text;
  }
}
