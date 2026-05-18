/**
 * Local vLLM OpenAI-compatible chat completions for Qwen3-VL (image + text).
 * Same payload shape as OpenRouter — base64 data URL in image_url.
 */

export type LocalVllmVisionOptions = {
  /** Base URL e.g. http://127.0.0.1:8002 (no trailing slash) */
  baseUrl: string;
  /** Must match vLLM --served-model-name */
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
};

/**
 * @param imageMime e.g. image/jpeg
 * @param imageBase64 raw base64 without data URL prefix
 */
export async function callLocalVllmVision(
  imageMime: string,
  imageBase64: string,
  prompt: string,
  options: LocalVllmVisionOptions,
): Promise<string> {
  const { baseUrl, model, maxTokens = 1536, timeoutMs = 600_000 } = options;
  const root = baseUrl.replace(/\/$/, '');
  const url = `${root}/v1/chat/completions`;
  const dataUrl = `data:${imageMime};base64,${imageBase64}`;

  const body = {
    model,
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
  };

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  const ts = new Date().toISOString();
  const t0 = Date.now();
  console.log(`[${ts}] Local vLLM -> ${url} model=${model}`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const duration = ((Date.now() - t0) / 1000).toFixed(2);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Local vLLM HTTP ${res.status} (took ${duration}s): ${t.slice(0, 500)}`);
    }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Local vLLM returned empty content');
    console.log(`[${ts}] Local vLLM success (took ${duration}s)`);
    return text;
  } finally {
    clearTimeout(to);
  }
}
