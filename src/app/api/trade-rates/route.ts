import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/trade-rates
// ---------------------------------------------------------------------------
// GET    — list all trade rates
// POST   — create or update a trade rate (upsert by trade name)
// DELETE — delete a trade rate by trade name
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const rates = await db.tradeRate.findMany({
      orderBy: { trade: 'asc' },
    });
    return NextResponse.json({
      success: true,
      data: {
        tradeRates: rates.map((r) => ({
          id: r.id,
          trade: r.trade,
          hourlyRate: r.hourlyRate,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trade, hourlyRate } = body;

    if (!trade || typeof trade !== 'string' || trade.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'trade is required' },
        { status: 400 },
      );
    }
    if (typeof hourlyRate !== 'number' || hourlyRate <= 0) {
      return NextResponse.json(
        { success: false, error: 'hourlyRate must be a positive number' },
        { status: 400 },
      );
    }

    const trimmedTrade = trade.trim();

    const rate = await db.tradeRate.upsert({
      where: { trade: trimmedTrade },
      update: { hourlyRate },
      create: { trade: trimmedTrade, hourlyRate },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: rate.id,
        trade: rate.trade,
        hourlyRate: rate.hourlyRate,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const trade = searchParams.get('trade');

    if (!trade) {
      return NextResponse.json(
        { success: false, error: 'trade query parameter is required' },
        { status: 400 },
      );
    }

    await db.tradeRate.deleteMany({ where: { trade } });

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
