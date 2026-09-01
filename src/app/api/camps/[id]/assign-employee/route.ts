import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// /api/camps/[id]/assign-employee
// ---------------------------------------------------------------------------
// POST — assign an employee to this camp.
//        If the employee is already in another camp, the caller should set
//        `confirmTransfer: true` to confirm the transfer.
//        Returns a 409 with `needsConfirmation: true` if the employee is
//        in another camp and confirmTransfer is not set.
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: campId } = await params;
    const body = await request.json();
    const { employeeId, confirmTransfer } = body;

    if (!employeeId || typeof employeeId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'employeeId is required' },
        { status: 400 },
      );
    }

    // Verify camp exists
    const camp = await db.camp.findUnique({ where: { id: campId } });
    if (!camp || camp.deletedAt) {
      return NextResponse.json(
        { success: false, error: 'Camp not found' },
        { status: 404 },
      );
    }

    // Verify employee exists
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, fullName: true, campId: true, status: true },
    });
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 },
      );
    }

    // If employee is already in THIS camp, nothing to do
    if (employee.campId === campId) {
      return NextResponse.json({
        success: true,
        data: { alreadyAssigned: true },
      });
    }

    // If employee is in a DIFFERENT camp, require confirmation
    if (employee.campId && !confirmTransfer) {
      const currentCamp = await db.camp.findUnique({
        where: { id: employee.campId },
        select: { name: true },
      });
      return NextResponse.json({
        success: false,
        error: `${employee.fullName} is already assigned to camp "${currentCamp?.name ?? 'Unknown'}". Transfer to "${camp.name}"?`,
        needsConfirmation: true,
        currentCampId: employee.campId,
        currentCampName: currentCamp?.name ?? null,
      }, { status: 409 });
    }

    // Check bed space availability
    const occupiedCount = await db.employee.count({
      where: { campId, status: { not: 'deleted' } },
    });
    if (occupiedCount >= camp.totalBedSpaces) {
      return NextResponse.json(
        { success: false, error: `Camp "${camp.name}" is full (${camp.totalBedSpaces}/${camp.totalBedSpaces} beds occupied).` },
        { status: 400 },
      );
    }

    // Assign the employee to the camp
    await db.employee.update({
      where: { id: employeeId },
      data: { campId },
    });

    return NextResponse.json({
      success: true,
      data: { assigned: true, campName: camp.name },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[camps assign-employee] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove an employee from this camp (unset campId)
// ---------------------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: campId } = await params;
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');

    if (!employeeId) {
      return NextResponse.json(
        { success: false, error: 'employeeId query parameter is required' },
        { status: 400 },
      );
    }

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, campId: true },
    });
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 },
      );
    }
    if (employee.campId !== campId) {
      return NextResponse.json(
        { success: false, error: 'Employee is not in this camp' },
        { status: 400 },
      );
    }

    await db.employee.update({
      where: { id: employeeId },
      data: { campId: null },
    });

    return NextResponse.json({ success: true, data: { removed: true } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[camps remove-employee] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
