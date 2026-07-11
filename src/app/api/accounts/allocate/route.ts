import { NextRequest, NextResponse } from 'next/server';
import { allocateEmployeeHours } from '@/lib/allocation-engine';

// ---------------------------------------------------------------------------
// Cross-Site Monthly Hour Allocation Engine (API Route)
// ---------------------------------------------------------------------------
// POST /api/accounts/allocate
// Body: { month: string (YYYY-MM), year: number }
//
// Delegates to the shared allocateEmployeeHours() function in
// @/lib/allocation-engine.ts so that other routes (e.g. bulk-save) can
// call the same logic without making an HTTP request.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { month, year } = body;

    // Validate input
    if (!month || year === undefined || year === null) {
      return NextResponse.json(
        { success: false, error: 'month and year are required' },
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
    if (isNaN(yearNum)) {
      return NextResponse.json(
        { success: false, error: 'year must be a valid integer' },
        { status: 400 },
      );
    }

    // Run the allocation engine
    const result = await allocateEmployeeHours(month, yearNum);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('[allocate POST] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
