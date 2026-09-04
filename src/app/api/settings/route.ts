import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Global app settings, stored as key → value rows in AppSetting and merged
// over the defaults. Managed ONLY by the super admin (enforced on writes);
// every authenticated client reads them so a single change applies app-wide.

export const SETTING_DEFAULTS: Record<string, string> = {
  currency: 'AED', // dirhams by default — used by every money display
  companyName: 'Arabian Shield Manpower',
};

// Whitelist: only these keys can ever be written via the API.
const ALLOWED_KEYS = new Set(Object.keys(SETTING_DEFAULTS));

// Currency codes accepted for the "currency" key.
const VALID_CURRENCIES = new Set([
  'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'USD', 'EUR', 'GBP', 'INR', 'PKR',
]);

function validateValue(key: string, value: string): string | null {
  if (value.length > 200) return `${key} is too long (max 200 characters)`;
  if (key === 'currency' && !VALID_CURRENCIES.has(value)) {
    return `Invalid currency: ${value}`;
  }
  if (key === 'companyName' && value.trim().length === 0) {
    return 'Company name cannot be empty';
  }
  return null;
}

async function loadSettings(): Promise<Record<string, string>> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: Object.keys(SETTING_DEFAULTS) } },
    select: { key: true, value: true },
  });
  const map: Record<string, string> = { ...SETTING_DEFAULTS };
  for (const row of rows) map[row.key] = row.value;
  return map;
}

export async function GET() {
  try {
    const settings = await loadSettings();
    return NextResponse.json({ success: true, data: { settings } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, settings } = body as {
      userId?: string;
      settings?: Record<string, unknown>;
    };

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return NextResponse.json(
        { success: false, error: 'settings object is required' },
        { status: 400 }
      );
    }

    // ── Super admin permission gate: only a super admin can change settings ──
    const actor = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true, deletedAt: true },
    });
    if (!actor || actor.deletedAt) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    if (actor.role !== 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Only the Super Admin can change app settings' },
        { status: 403 }
      );
    }

    const keys = Object.keys(settings);
    if (keys.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No settings provided' },
        { status: 400 }
      );
    }

    for (const key of keys) {
      if (!ALLOWED_KEYS.has(key)) {
        return NextResponse.json(
          { success: false, error: `Unknown setting: ${key}` },
          { status: 400 }
        );
      }
      const value = String(settings[key] ?? '').trim();
      const validationError = validateValue(key, value);
      if (validationError) {
        return NextResponse.json({ success: false, error: validationError }, { status: 400 });
      }
      await db.appSetting.upsert({
        where: { key },
        update: { value, updatedById: actor.id },
        create: { key, value, updatedById: actor.id },
      });
    }

    const updated = await loadSettings();
    return NextResponse.json({ success: true, data: { settings: updated } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
