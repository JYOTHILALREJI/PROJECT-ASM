import { NextRequest, NextResponse } from 'next/server';
import { recalcEmployeeFull } from '@/lib/recalculation';

// POST /api/employees/[id]/recalculate
// Manual full recalculation for an employee
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await recalcEmployeeFull(id);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[recalculate POST] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
