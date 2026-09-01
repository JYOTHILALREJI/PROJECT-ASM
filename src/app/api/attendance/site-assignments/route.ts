import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// GET /api/attendance/site-assignments?month=YYYY-MM
// ---------------------------------------------------------------------------
// Returns all EmpCountSitePerMonth records for the given month, including
// records where removedDate is set (i.e. the employee was moved away from
// the site mid-month). This lets the attendance page show employees at
// EVERY site they were assigned to during the month — not just their
// current site — so that moved-away employees still appear at their old
// site with their historical attendance preserved.
//
// Response shape:
//   {
//     success: true,
//     data: {
//       assignments: Array<{
//         id: string,
//         empId: string,
//         empName: string,
//         siteId: string,
//         siteName: string,
//         month: string,
//         createdDate: string (ISO),
//         removedDate: string | null (ISO),
//       }>
//     }
//   }
//
// The attendance page uses createdDate/removedDate to determine the date
// range an employee was active at each site, so it can:
//   - Show attendance only for dates within that range
//   - Make out-of-range cells non-interactive and faded
//   - Move the employee to the bottom of the site's list when removedDate
//     is set (i.e. they've left the site)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // YYYY-MM

    if (!month) {
      return NextResponse.json(
        { success: false, error: 'month query parameter is required (YYYY-MM)' },
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

    // Fetch ALL EmpCountSitePerMonth records for this month, including
    // ones where the employee has been removed (removedDate is set).
    // We exclude soft-deleted records (deletedDate / deletedAt).
    const records = await db.empCountSitePerMonth.findMany({
      where: {
        month,
        deletedDate: null,
        deletedAt: null,
      },
      select: {
        id: true,
        empId: true,
        empName: true,
        siteId: true,
        siteName: true,
        month: true,
        createdDate: true,
        removedDate: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        assignments: records.map((r) => ({
          id: r.id,
          empId: r.empId,
          empName: r.empName,
          siteId: r.siteId,
          siteName: r.siteName,
          month: r.month,
          createdDate: r.createdDate.toISOString(),
          removedDate: r.removedDate ? r.removedDate.toISOString() : null,
        })),
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('[site-assignments GET] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
