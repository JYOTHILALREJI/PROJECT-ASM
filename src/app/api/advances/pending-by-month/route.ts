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

    // Find all pending advances for this month/year
    const pendingAdvances = await db.advance.findMany({
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
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
