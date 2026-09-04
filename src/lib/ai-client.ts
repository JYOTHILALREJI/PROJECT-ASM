// AI Assistant LLM client.
//
// Provider selection (in priority order):
//   1. Any OpenAI-compatible API — fully driven by environment variables so the
//      owner can plug in ANY model they like (OpenAI, Azure OpenAI, Groq,
//      OpenRouter, Ollama, LM Studio, DeepSeek, Gemini-compat, …):
//        AI_API_BASE_URL  e.g. https://api.openai.com/v1   (optional, defaults to OpenAI)
//        AI_API_TOKEN     the bearer token (REQUIRED to activate this path)
//        AI_MODEL         e.g. gpt-4o-mini                  (optional)
//   2. Built-in fallback (z-ai-web-dev-sdk) used while AI_API_TOKEN is left at
//      its placeholder value, so the assistant works out of the box.
//
// The token lives ONLY in env — it is never exposed to the client bundle.

const PLACEHOLDER_TOKENS = new Set([
  '',
  'your-api-token-here',
  'your_api_token_here',
  'changeme',
  'sk-your-api-token',
  'sk-placeholder',
]);

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** True when a real (non-placeholder) AI_API_TOKEN is configured in env. */
export function envAIConfigured(): boolean {
  const token = (process.env.AI_API_TOKEN || '').trim();
  return !PLACEHOLDER_TOKENS.has(token);
}

function envBase(): string {
  const base = (process.env.AI_API_BASE_URL || 'https://api.openai.com/v1').trim();
  return base.replace(/\/+$/, ''); // strip trailing slashes
}

function envModel(): string {
  return (process.env.AI_MODEL || 'gpt-4o-mini').trim();
}

/** Single non-streaming chat completion against the configured provider. */
export async function callLLM(
  messages: LlmMessage[],
  opts?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  if (envAIConfigured()) {
    return callOpenAICompatible(messages, opts);
  }
  return callZai(messages, opts);
}

async function callOpenAICompatible(
  messages: LlmMessage[],
  opts?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const token = (process.env.AI_API_TOKEN || '').trim();
  const url = `${envBase()}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: envModel(),
        messages,
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.maxTokens ?? 1500,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AI provider returned ${res.status} (${envModel()}). ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content || !content.trim()) throw new Error('AI provider returned an empty response');
    return content.trim();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('AI provider timed out after 90s');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callZai(
  messages: LlmMessage[],
  _opts?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  // Lazy import so the SDK is only loaded when actually used (server-side only).
  const { default: ZAI } = await import('z-ai-web-dev-sdk');
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
     
    messages: messages as any,
    thinking: { type: 'disabled' },
  });
  const content = completion.choices?.[0]?.message?.content;
  if (!content || !content.trim()) throw new Error('Built-in AI returned an empty response');
  return content.trim();
}

/**
 * Best-effort JSON extraction from a model reply. Models often wrap JSON in
 * markdown fences or add prose around it; this finds the outermost object.
 * Returns null when no JSON object is present.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, '```');
  const fenced = cleaned.match(/```([\s\S]*?)```/);
  const candidates: string[] = [];
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(cleaned.trim());
  // Outermost braces slice
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(cleaned.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}
