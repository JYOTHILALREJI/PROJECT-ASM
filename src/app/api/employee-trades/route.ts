import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/employee-trades
// ---------------------------------------------------------------------------
// GET    — list all employee-trade assignments (with trade name + rate)
// POST   — assign a trade to one or more employees (upsert by employeeId)
// DELETE — remove trade assignment for an employee
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const employeeId = sp.get('employeeId');

    const where: Record<string, unknown> = {};
    if (employeeId) where.employeeId = employeeId;

    const assignments = await db.employeeTrade.findMany({
      where,
      include: {
        tradeRate: { select: { id: true, trade: true, hourlyRate: true } },
        employee: { select: { id: true, fullName: true, employeeId: true } },
      },
      orderBy: { assignedAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      data: {
        assignments: assignments.map((a) => ({
          id: a.id,
          employeeId: a.employeeId,
          employeeName: a.employee?.fullName || '',
          employeeCode: a.employee?.employeeId || '',
          tradeRateId: a.tradeRateId,
          trade: a.tradeRate?.trade || '',
          hourlyRate: a.tradeRate?.hourlyRate || 0,
          assignedAt: a.assignedAt.toISOString(),
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
    const { employeeIds, tradeRateId, assignedBy } = body as {
      employeeIds: string[];
      tradeRateId: string;
      assignedBy?: string;
    };

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'employeeIds must be a non-empty array' },
        { status: 400 },
      );
    }
    if (!tradeRateId || typeof tradeRateId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'tradeRateId is required' },
        { status: 400 },
      );
    }

    // Verify the TradeRate exists
    const tradeRate = await db.tradeRate.findUnique({ where: { id: tradeRateId } });
    if (!tradeRate) {
      return NextResponse.json(
        { success: false, error: 'TradeRate not found' },
        { status: 404 },
      );
    }

    // Upsert: assign the trade to each employee (one trade per employee)
    let upserted = 0;
    for (const empId of employeeIds) {
      await db.employeeTrade.upsert({
        where: { employeeId: empId },
        update: { tradeRateId, assignedBy: assignedBy || null },
        create: { employeeId: empId, tradeRateId, assignedBy: assignedBy || null },
      });
      upserted++;
    }

    return NextResponse.json({
      success: true,
      data: {
        upserted,
        trade: tradeRate.trade,
        hourlyRate: tradeRate.hourlyRate,
        employeeIds,
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
    const employeeId = searchParams.get('employeeId');

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: 'employeeId is required' },
        { status: 400 },
      );
    }

    await db.employeeTrade.deleteMany({ where: { employeeId } });

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
