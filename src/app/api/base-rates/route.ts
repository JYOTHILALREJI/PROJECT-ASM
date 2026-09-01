import { NextRequest, NextResponse } from 'next/server';
import { updateBaseRates, getBaseRates } from '@/lib/base-rates';
import { roundMoney } from '@/lib/payroll-math';

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
    const { baseLow, helperHigh, tradeHigh } = body;

    if (
      typeof baseLow !== 'number' ||
      typeof helperHigh !== 'number' ||
      typeof tradeHigh !== 'number' ||
      !Number.isFinite(baseLow) ||
      !Number.isFinite(helperHigh) ||
      !Number.isFinite(tradeHigh)
    ) {
      return NextResponse.json(
        { success: false, error: 'All rate fields must be valid numbers' },
        { status: 400 },
      );
    }

    if (baseLow <= 0 || helperHigh <= 0 || tradeHigh <= 0) {
      return NextResponse.json(
        { success: false, error: 'All rate fields must be greater than 0' },
        { status: 400 },
      );
    }

    await updateBaseRates({
      baseLow: roundMoney(baseLow),
      helperHigh: roundMoney(helperHigh),
      tradeHigh: roundMoney(tradeHigh),
    });

    const updated = await getBaseRates();
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
