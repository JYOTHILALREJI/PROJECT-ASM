import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { credentialsFromMap } from '@/lib/ai-client';

// List the models offered by the configured model provider (any
// OpenAI-compatible /v1/models endpoint). Used by Settings → AI Assistant →
// Model provider to fill the searchable model dropdown from the pasted API key.
//
// Credential resolution for the lookup itself (in priority order):
//   1. Values typed in the form right now (body.apiKey / body.baseUrl) —
//      the saved key is masked server-side, so the user may re-enter it.
//   2. The saved Settings provider (aiApiKey / aiBaseUrl).
//   3. The environment (AI_API_TOKEN / AI_API_BASE_URL).
//
// Super-admin gated, exactly like the settings write path — the model list is
// provider-account information.

const TIMEOUT_MS = 15_000;

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';

    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 });
    }

    // ── Super admin gate (same policy as settings writes) ──
    const actor = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!actor || actor.deletedAt) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    if (actor.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Only the Super Admin can manage the model provider' },
        { status: 403 }
      );
    }

    // ── Resolve which provider to query ──
    const rows = await db.appSetting.findMany({
      where: { key: { in: ['aiApiKey', 'aiBaseUrl', 'aiModel'] } },
      select: { key: true, value: true },
    });
    const settingsMap: Record<string, string> = {};
    for (const row of rows) settingsMap[row.key] = row.value;

    const bodyKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    const bodyBase = typeof body?.baseUrl === 'string' ? normalizeBase(body.baseUrl) : '';

    let apiKey = bodyKey;
    let baseUrl = bodyBase;
    if (!apiKey) {
      const creds = credentialsFromMap(settingsMap);
      if (creds) {
        apiKey = creds.apiKey;
        baseUrl = baseUrl || creds.baseUrl;
      }
    }
    if (!apiKey) {
      const envToken = (process.env.AI_API_TOKEN || '').trim();
      if (envToken) apiKey = envToken;
    }
    if (!baseUrl) {
      baseUrl = normalizeBase(process.env.AI_API_BASE_URL || 'https://api.openai.com/v1');
    }
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            'No API key available — paste a key above (or save one in Settings) and try again.',
        },
        { status: 400 }
      );
    }

    // ── Fetch the model list ──
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return NextResponse.json(
          {
            success: false,
            error: `Provider returned ${res.status} for ${baseUrl}/models. ${text.slice(0, 200)}`,
          },
          { status: 502 }
        );
      }
      const data = (await res.json()) as {
        data?: Array<{ id?: string }>;
        models?: Array<{ id?: string; name?: string }>;
      };
      // OpenAI-compatible shape is { data: [{ id }] }; be lenient with variants.
      const ids = new Set<string>();
      for (const m of data.data ?? []) {
        if (m && typeof m.id === 'string' && m.id.trim()) ids.add(m.id.trim());
      }
      for (const m of data.models ?? []) {
        const id = m?.id || m?.name;
        if (typeof id === 'string' && id.trim()) ids.add(id.trim());
      }
      const models = [...ids].sort((a, b) => a.localeCompare(b));
      return NextResponse.json({ success: true, data: { baseUrl, models } });
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? `The provider took longer than ${TIMEOUT_MS / 1000}s to respond`
          : `Could not reach ${baseUrl}/models — check the base URL and key`;
      return NextResponse.json({ success: false, error: message }, { status: 502 });
    } finally {
      clearTimeout(timer);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
