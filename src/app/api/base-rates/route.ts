import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBaseRates, updateBaseRates } from '@/lib/base-rates';

export const dynamic = 'force-dynamic';

// GET /api/base-rates — returns the current base rates
export async function GET() {
  try {
    const rates = await getBaseRates();
    return NextResponse.json({ success: true, data: rates });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// PUT /api/base-rates — updates the base rates
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { standardLow, standardHigh, tlLow, tlHigh, supLow, supHigh } = body;

    if (
      typeof standardLow !== 'number' ||
      typeof standardHigh !== 'number' ||
      typeof tlLow !== 'number' ||
      typeof tlHigh !== 'number' ||
      typeof supLow !== 'number' ||
      typeof supHigh !== 'number'
    ) {
      return NextResponse.json(
        { success: false, error: 'All rate fields must be numbers' },
        { status: 400 },
      );
    }

    await updateBaseRates({
      standardLow,
      standardHigh,
      tlLow,
      tlHigh,
      supLow,
      supHigh,
    });

    return NextResponse.json({ success: true, data: { updated: true } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
