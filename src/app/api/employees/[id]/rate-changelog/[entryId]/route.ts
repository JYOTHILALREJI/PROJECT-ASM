import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { deleteRateChangelog } from '@/lib/rate-changelog';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// /api/employees/[id]/rate-changelog/[entryId]
// ---------------------------------------------------------------------------
// DELETE — remove a rate changelog entry.
//          After deletion, months from that effectiveMonth onward will fall
//          back to the previous changelog entry (or the default rate
//          resolution if no earlier entry exists).
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  try {
    const { id, entryId } = await params;

    // Verify employee exists
    const employee = await db.employee.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 },
      );
    }

    await deleteRateChangelog(entryId);

    return NextResponse.json({
      success: true,
      data: { deleted: true },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[rate-changelog DELETE] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
