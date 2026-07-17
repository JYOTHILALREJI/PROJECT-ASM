import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// POST /api/accounts/salary/toggle-paid
// ---------------------------------------------------------------------------
// Immediately toggles the isPaid status for ALL salary records of a given
// employee+month+year (both standard and premium, across ALL sites).
//
// We deliberately do NOT filter by siteId because:
//   1. "Paid" is a property of the employee's monthly salary, not per-site.
//      If an employee works at 2 sites, their salary is either paid or not
//      for the whole month.
//   2. The old WHERE clause (empId + siteId + month + year) could silently
//      match 0 records if the siteId in the client's merged row didn't
//      exactly match the siteId on the salary record (data inconsistency).
//      The endpoint would return success:true with updatedCount:0, the
//      client would show a "Marked as Paid" toast, but the DB was never
//      updated — so on refresh the paid status would "revert".
//
// The endpoint now:
//   - Updates ALL non-deleted records for empId+month+year
//   - Returns an error if updatedCount === 0 (so the client knows it failed)
//   - Returns the updated record IDs in the response for verification
// ---------------------------------------------------------------------------

interface TogglePaidRequest {
  empId: string;
  siteId?: string; // accepted for backward compat but NOT used in the WHERE
  month: string; // YYYY-MM
  year: number;
  isPaid: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: TogglePaidRequest = await request.json();
    const { empId, month, year, isPaid } = body;

    if (!empId || !month || !year) {
      return NextResponse.json(
        { success: false, error: 'empId, month, and year are required' },
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

    const yearNum = typeof year === 'number' ? year : parseInt(String(year), 10);

    // Update ALL non-deleted salary records for this employee+month+year,
    // regardless of siteId or rateTier. This ensures paid status is in sync
    // across all sites and both standard/premium tiers.
    const result = await db.salaryRecord.updateMany({
      where: {
        empId,
        month,
        year: yearNum,
        isDeleted: false,
      },
      data: {
        isPaid,
      },
    });

    if (result.count === 0) {
      // No records matched — this means the employee has no salary records
      // for this month+year. Return an error so the client can show a
      // meaningful message instead of a fake success.
      return NextResponse.json(
        {
          success: false,
          error: `No salary records found for employee ${empId} for ${month}/${yearNum}`,
        },
        { status: 404 },
      );
    }

    // Fetch the updated records to return to the caller for verification
    const updatedRecords = await db.salaryRecord.findMany({
      where: {
        empId,
        month,
        year: yearNum,
        isDeleted: false,
      },
      select: {
        id: true,
        empId: true,
        siteId: true,
        month: true,
        year: true,
        rateTier: true,
        isPaid: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        updatedCount: result.count,
        empId,
        month,
        year: yearNum,
        isPaid,
        records: updatedRecords.map((r) => ({
          ...r,
          // Spread to ensure plain object (no Date serialization issues)
        })),
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
