import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// POST /api/accounts/salary/toggle-paid
// ---------------------------------------------------------------------------
// Immediately toggles the isPaid status for ALL salary records of a given
// employee+site+month+year (both standard and premium). This ensures that
// the paid status is always in sync between the site salary sheet and the
// consolidated salary sheet.
// ---------------------------------------------------------------------------

interface TogglePaidRequest {
  empId: string;
  siteId: string;
  month: string; // YYYY-MM
  year: number;
  isPaid: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: TogglePaidRequest = await request.json();
    const { empId, siteId, month, year, isPaid } = body;

    if (!empId || !siteId || !month || !year) {
      return NextResponse.json(
        { success: false, error: 'empId, siteId, month, and year are required' },
        { status: 400 },
      );
    }

    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      return NextResponse.json(
        { success: false, error: 'month must be in YYYY-MM format' },
        { status: 400 },
      );
    }

    // Update ALL non-deleted salary records for this employee+site+month+year
    const result = await db.salaryRecord.updateMany({
      where: {
        empId,
        siteId,
        month,
        year,
        isDeleted: false,
      },
      data: {
        isPaid,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        updatedCount: result.count,
        empId,
        siteId,
        month,
        year,
        isPaid,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('[salary toggle-paid POST] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
