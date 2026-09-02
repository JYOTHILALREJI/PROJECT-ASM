import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/advances/pending-by-month
// ---------------------------------------------------------------------------
// GET — for a given month/year, return a map of empId -> total pending advance
// amount, plus the list of pending advances.
//
// Query params:
//   month (required, YYYY-MM)
//   year  (required, integer)
//
// This is used by the Accounts page to display the "Advance" column with the
// pending advance amounts that will be deducted once salary records are saved.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const month = sp.get('month');
    const year = sp.get('year');

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, error: 'month (YYYY-MM) is required' },
        { status: 400 },
      );
    }
    if (!year) {
      return NextResponse.json(
        { success: false, error: 'year is required' },
        { status: 400 },
      );
    }

    const yearNum = parseInt(year, 10);

    // Find all pending advances for this month/year.
    // Wrapped defensively — if the Advance table doesn't exist yet (pre-
    // migration), return [] instead of crashing the whole endpoint.
    let pendingAdvances: Array<{
      id: string;
      empId: string;
      empName: string;
      employeeCode: string;
      amount: number;
      reason: string;
      effectiveMonth: string;
      effectiveYear: number;
      createdAt: Date;
      employee: { id: string; fullName: string; employeeId: string; currentSite: string | null } | null;
    }> = [];
    try {
      pendingAdvances = await db.advance.findMany({
        where: {
          effectiveMonth: month,
          effectiveYear: yearNum,
          status: 'pending',
          deletedAt: null,
        },
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              employeeId: true,
              currentSite: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    } catch (err) {
      console.warn(
        '[advances/pending-by-month] Advance table missing or query failed, returning [].',
        err instanceof Error ? err.message : err,
      );
      pendingAdvances = [];
    }

    // Active recurring advances that START in this month — shown in a separate
    // section on the Advance page so admins can see/manage them (they never
    // enter totalPending / byEmployee, which stay strictly "pending").
    let recurringAdvances: Array<{
      id: string;
      empId: string;
      empName: string;
      employeeCode: string;
      amount: number;
      reason: string;
      effectiveMonth: string;
      effectiveYear: number;
      monthlyDeductionAmount: number | null;
      remainingBalance: number | null;
      recurringUntil: string | null;
      status: string;
      createdAt: Date;
    }> = [];
    try {
      recurringAdvances = await db.advance.findMany({
        where: {
          effectiveMonth: month,
          effectiveYear: yearNum,
          deductionType: 'recurring',
          status: 'active',
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
      });
    } catch (err) {
      console.warn(
        '[advances/pending-by-month] Recurring advance query failed, returning [].',
        err instanceof Error ? err.message : err,
      );
      recurringAdvances = [];
    }

    // Group by empId -> total amount
    const byEmp = new Map<string, { empId: string; empName: string; employeeCode: string; total: number; count: number }>();
    for (const a of pendingAdvances) {
      const existing = byEmp.get(a.empId);
      if (existing) {
        existing.total += a.amount;
        existing.count += 1;
      } else {
        byEmp.set(a.empId, {
          empId: a.empId,
          empName: a.empName || a.employee?.fullName || '',
          employeeCode: a.employeeCode || a.employee?.employeeId || '',
          total: a.amount,
          count: 1,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        month,
        year: yearNum,
        totalPending: pendingAdvances.reduce((s, a) => s + a.amount, 0),
        totalCount: pendingAdvances.length,
        byEmployee: Array.from(byEmp.values()),
        advances: pendingAdvances.map((a) => ({
          id: a.id,
          empId: a.empId,
          empName: a.empName || a.employee?.fullName || '',
          employeeCode: a.employeeCode || a.employee?.employeeId || '',
          amount: a.amount,
          reason: a.reason,
          effectiveMonth: a.effectiveMonth,
          effectiveYear: a.effectiveYear,
          createdAt: a.createdAt.toISOString(),
        })),
        recurringAdvances: recurringAdvances.map((a) => ({
          id: a.id,
          empId: a.empId,
          empName: a.empName,
          employeeCode: a.employeeCode,
          amount: a.amount,
          reason: a.reason,
          effectiveMonth: a.effectiveMonth,
          effectiveYear: a.effectiveYear,
          monthlyDeductionAmount: a.monthlyDeductionAmount,
          remainingBalance: a.remainingBalance,
          recurringUntil: a.recurringUntil,
          status: a.status,
          createdAt: a.createdAt.toISOString(),
        })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
