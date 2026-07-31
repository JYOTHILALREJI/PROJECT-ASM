import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  getRateChangelog,
  upsertRateChangelog,
} from '@/lib/rate-changelog';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// /api/employees/[id]/rate-changelog
// ---------------------------------------------------------------------------
// GET  — list all rate changelog entries for an employee (ordered by month DESC)
// POST — create or update a rate changelog entry
//        Body: { rate: number, effectiveMonth: "YYYY-MM", reason?: string, createdBy?: string }
//        If an entry already exists for (employeeId, effectiveMonth), it is updated.
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Verify employee exists
    const employee = await db.employee.findUnique({
      where: { id },
      select: { id: true, fullName: true, employeeId: true, customHourlyRate: true },
    });
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 },
      );
    }

    const changelog = await getRateChangelog(id);

    return NextResponse.json({
      success: true,
      data: {
        employee: {
          id: employee.id,
          fullName: employee.fullName,
          employeeId: employee.employeeId,
          currentCustomHourlyRate: employee.customHourlyRate,
        },
        changelog: changelog.map((e) => ({
          id: e.id,
          employeeId: e.employeeId,
          rate: e.rate,
          effectiveMonth: e.effectiveMonth,
          reason: e.reason,
          createdBy: e.createdBy,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString(),
        })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[rate-changelog GET] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { rate, effectiveMonth, reason, createdBy } = body;

    // Validate rate
    if (typeof rate !== 'number' || rate <= 0) {
      return NextResponse.json(
        { success: false, error: 'rate must be a positive number' },
        { status: 400 },
      );
    }

    // Validate effectiveMonth (YYYY-MM)
    if (typeof effectiveMonth !== 'string' || !/^\d{4}-\d{2}$/.test(effectiveMonth)) {
      return NextResponse.json(
        { success: false, error: 'effectiveMonth must be in YYYY-MM format' },
        { status: 400 },
      );
    }

    // Verify employee exists
    const employee = await db.employee.findUnique({
      where: { id },
      select: { id: true, customHourlyRate: true },
    });
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 },
      );
    }

    // Create or update the changelog entry
    const entry = await upsertRateChangelog(
      id,
      rate,
      effectiveMonth,
      typeof reason === 'string' ? reason : '',
      typeof createdBy === 'string' ? createdBy : null,
    );

    // Also update Employee.customHourlyRate to mirror the latest changelog
    // entry's rate (for backward compat with code that reads it directly).
    // We only do this if the new entry's effectiveMonth is the current month
    // or later (i.e. it's the "active" rate going forward).
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (effectiveMonth >= currentMonth) {
      // Check if this is the latest entry
      const allEntries = await getRateChangelog(id);
      if (allEntries.length > 0 && allEntries[0].id === entry.id) {
        // This is the latest entry — update Employee.customHourlyRate
        await db.employee.update({
          where: { id },
          data: { customHourlyRate: rate },
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: entry.id,
        employeeId: entry.employeeId,
        rate: entry.rate,
        effectiveMonth: entry.effectiveMonth,
        reason: entry.reason,
        createdBy: entry.createdBy,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[rate-changelog POST] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
