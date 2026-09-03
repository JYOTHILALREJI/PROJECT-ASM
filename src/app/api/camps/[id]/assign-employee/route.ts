import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// /api/camps/[id]/assign-employee
// ---------------------------------------------------------------------------
// POST   — assign an employee to this camp.
//          If the employee is already in another camp, the caller should set
//          `confirmTransfer: true` to confirm the transfer.
//          Returns a 409 with `needsConfirmation: true` if the employee is
//          in another camp and confirmTransfer is not set.
// PATCH  — update the bed space number of an employee in this camp.
// DELETE — remove an employee from this camp (unset campId)
// ---------------------------------------------------------------------------

const MAX_BED_SPACE_LENGTH = 50;

function normalizeBedSpace(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'bedSpaceNumber must be a string' };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > MAX_BED_SPACE_LENGTH) {
    return { ok: false, error: `Bed space number must be ${MAX_BED_SPACE_LENGTH} characters or fewer` };
  }
  return { ok: true, value: trimmed };
}

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

    // Assign the employee to the camp (a fresh assignment never inherits a
    // bed space number from a previous camp — beds belong to a specific camp)
    await db.employee.update({
      where: { id: employeeId },
      data: { campId, bedSpaceNumber: null },
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
// PATCH — update the bed space number of an employee in this camp.
//         Body: { employeeId, bedSpaceNumber } (null / "" clears it)
// ---------------------------------------------------------------------------
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: campId } = await params;
    const body = await request.json();
    const { employeeId } = body;

    if (!employeeId || typeof employeeId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'employeeId is required' },
        { status: 400 },
      );
    }

    const bed = normalizeBedSpace(body.bedSpaceNumber);
    if (!bed.ok) {
      return NextResponse.json(
        { success: false, error: bed.error },
        { status: 400 },
      );
    }

    const camp = await db.camp.findUnique({ where: { id: campId } });
    if (!camp || camp.deletedAt) {
      return NextResponse.json(
        { success: false, error: 'Camp not found' },
        { status: 404 },
      );
    }

    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, campId: true, fullName: true },
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

    const updated = await db.employee.update({
      where: { id: employeeId },
      data: { bedSpaceNumber: bed.value },
      select: { id: true, bedSpaceNumber: true },
    });

    return NextResponse.json({
      success: true,
      data: { id: updated.id, bedSpaceNumber: updated.bedSpaceNumber },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[camps bed-space] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove an employee from this camp (unset campId + bed space)
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
      data: { campId: null, bedSpaceNumber: null },
    });

    return NextResponse.json({ success: true, data: { removed: true } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[camps remove-employee] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
