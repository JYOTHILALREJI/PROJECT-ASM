// AI Assistant LLM client.
//
// Provider selection (in priority order):
//   1. Model provider saved in Settings (AppSetting.aiApiKey / aiBaseUrl /
//      aiModel — configured by the super admin in Settings → AI Assistant).
//      callLLM receives these pre-resolved as `creds` from the API routes.
//   2. Any OpenAI-compatible API via environment variables (same behaviour as
//      (1), but owner-level env instead of the Settings UI):
//        AI_API_BASE_URL  e.g. https://api.openai.com/v1   (optional, defaults to OpenAI)
//        AI_API_TOKEN     the bearer token (REQUIRED to activate this path)
//        AI_MODEL         e.g. gpt-4o-mini                  (optional)
//   3. Built-in fallback (z-ai-web-dev-sdk) used while no real key is saved
//      anywhere, so the assistant works out of the box.
//
// The key lives ONLY on the server (AppSetting row / env) — it is never
// exposed to the client bundle, and /api/settings GET returns only a mask.

import { db } from '@/lib/db';

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

/** Resolved model-provider credentials (Settings → AI Assistant → Model provider). */
export interface AiCredentials {
  apiKey: string;
  baseUrl: string; // no trailing slash; defaults to OpenAI when empty
  model: string; // defaults to gpt-4o-mini when empty
}

/** Build credentials from an already-loaded key→value settings map (no extra DB hit). */
export function credentialsFromMap(map: Record<string, string>): AiCredentials | null {
  const apiKey = (map.aiApiKey || '').trim();
  if (!apiKey || PLACEHOLDER_TOKENS.has(apiKey)) return null;
  return {
    apiKey,
    baseUrl: (map.aiBaseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, ''),
    model: (map.aiModel || 'gpt-4o-mini').trim() || 'gpt-4o-mini',
  };
}

/**
 * Load the super-admin-saved model provider from AppSetting rows.
 * Returns null when no real key is saved — callers then fall back to env /
 * the built-in provider. Server-side only (touches the database).
 */
export async function resolveSettingsAiCredentials(): Promise<AiCredentials | null> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: ['aiApiKey', 'aiBaseUrl', 'aiModel'] } },
    select: { key: true, value: true },
  });
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;
  return credentialsFromMap(map);
}

function envBase(): string {
  const base = (process.env.AI_API_BASE_URL || 'https://api.openai.com/v1').trim();
  return base.replace(/\/+$/, ''); // strip trailing slashes
}

function envModel(): string {
  return (process.env.AI_MODEL || 'gpt-4o-mini').trim();
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resilient provider chain: saved Settings provider → env provider → built-in.
 *
 * A broken custom provider must NEVER brick the assistant: if the saved
 * OpenAI-compatible endpoint is unreachable, misconfigured or erroring, the
 * chain falls through to the next provider so chat keeps working (the failure
 * is logged server-side for diagnostics). Only when EVERY configured provider
 * fails does the caller see an error — and that error names everything that
 * was tried, so a bad Settings entry is easy to diagnose.
 */
export async function callLLM(
  messages: LlmMessage[],
  opts?: { temperature?: number; maxTokens?: number },
  creds?: AiCredentials | null
): Promise<string> {
  const tried: string[] = [];

  if (creds && creds.apiKey) {
    try {
      return await callOpenAICompatible(messages, opts, creds);
    } catch (err) {
      const msg = errMessage(err);
      tried.push(`saved provider ${creds.baseUrl} (${creds.model}): ${msg}`);
      console.warn(`[ai-client] saved model provider failed, falling back — ${msg}`);
    }
  }

  if (envAIConfigured()) {
    try {
      return await callOpenAICompatible(messages, opts);
    } catch (err) {
      const msg = errMessage(err);
      tried.push(`env provider (${envModel()}): ${msg}`);
      console.warn(`[ai-client] env model provider failed, falling back to built-in — ${msg}`);
    }
  }

  try {
    return await callZai(messages, opts);
  } catch (err) {
    const msg = errMessage(err);
    // Single configured provider (the common case) → keep the original,
    // specific message (429 rate-limit ladder in the chat route matches on it).
    if (tried.length === 0) throw err;
    tried.push(`built-in: ${msg}`);
    throw new Error(
      `The AI assistant could not get a reply from any configured model provider. Tried: ${tried.join(' · ')}. ` +
        `If a custom provider is saved, check its URL / key / model in Settings → AI Assistant.`
    );
  }
}

async function callOpenAICompatible(
  messages: LlmMessage[],
  opts?: { temperature?: number; maxTokens?: number },
  creds?: AiCredentials
): Promise<string> {
  const token = creds?.apiKey || (process.env.AI_API_TOKEN || '').trim();
  const baseUrl = (creds?.baseUrl || envBase()).replace(/\/+$/, '');
  const model = creds?.model || envModel();
  const url = `${baseUrl}/chat/completions`;
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
        model,
        messages,
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.maxTokens ?? 1500,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AI provider returned ${res.status} (${model}). ${text.slice(0, 300)}`);
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
  // The built-in SDK has no built-in abort — race it against a hard timeout so
  // a stalled model can never wedge the agent loop.
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Built-in AI timed out after 120s')), 120_000)
  );
  const run = async (): Promise<string> => {
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
  };
  return Promise.race([run(), timeout]);
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
  // Multiple concatenated objects ("{…}\n{…}") — models sometimes emit a
  // whole action batch at once. Parse the FIRST balanced object so the
  // protocol stays "one action per turn" instead of failing entirely.
  if (first !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = first; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (esc) {
        esc = false;
      } else if (ch === '\\') {
        esc = true;
      } else if (ch === '"') {
        inStr = !inStr;
      } else if (!inStr) {
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            try {
              const parsed = JSON.parse(cleaned.slice(first, i + 1));
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
              }
            } catch {
              break;
            }
          }
        }
      }
    }
  }
  return null;
}
