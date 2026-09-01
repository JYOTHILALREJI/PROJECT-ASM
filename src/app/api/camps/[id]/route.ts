import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// /api/camps/[id]
// ---------------------------------------------------------------------------
// GET    — get a single camp with occupancy stats + employee list
// PUT    — update a camp
// DELETE — soft-delete a camp
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const camp = await db.camp.findUnique({
      where: { id },
      include: {
        employees: {
          where: { status: { not: 'deleted' } },
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            nationality: true,
            trade: true,
            currentSite: true,
            isTeamLeader: true,
            isSupervisor: true,
            role: true,
            status: true,
            phone: true,
            photo: true,
          },
          orderBy: { fullName: 'asc' },
        },
      },
    });

    if (!camp || camp.deletedAt) {
      return NextResponse.json(
        { success: false, error: 'Camp not found' },
        { status: 404 },
      );
    }

    const occupied = camp.employees.length;

    return NextResponse.json({
      success: true,
      data: {
        camp: {
          id: camp.id,
          name: camp.name,
          location: camp.location,
          totalBedSpaces: camp.totalBedSpaces,
          occupiedBedSpaces: occupied,
          availableBedSpaces: Math.max(0, camp.totalBedSpaces - occupied),
          isActive: camp.isActive,
          createdAt: camp.createdAt.toISOString(),
          updatedAt: camp.updatedAt.toISOString(),
        },
        employees: camp.employees,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[camps GET by id] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await db.camp.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return NextResponse.json(
        { success: false, error: 'Camp not found' },
        { status: 404 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) {
      // Check for name conflict
      const conflict = await db.camp.findUnique({ where: { name: body.name.trim() } });
      if (conflict && conflict.id !== id) {
        return NextResponse.json(
          { success: false, error: 'A camp with this name already exists' },
          { status: 409 },
        );
      }
      updateData.name = body.name.trim();
    }
    if (body.location !== undefined) {
      updateData.location = typeof body.location === 'string' ? (body.location.trim() || null) : null;
    }
    if (typeof body.totalBedSpaces === 'number') {
      updateData.totalBedSpaces = Math.max(0, body.totalBedSpaces);
    }
    if (typeof body.isActive === 'boolean') {
      updateData.isActive = body.isActive;
    }

    const updated = await db.camp.update({ where: { id }, data: updateData });

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        location: updated.location,
        totalBedSpaces: updated.totalBedSpaces,
        isActive: updated.isActive,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[camps PUT] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const existing = await db.camp.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return NextResponse.json(
        { success: false, error: 'Camp not found' },
        { status: 404 },
      );
    }

    // Soft-delete the camp and unset campId on all employees
    await db.$transaction([
      db.camp.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      }),
      db.employee.updateMany({
        where: { campId: id },
        data: { campId: null },
      }),
    ]);

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[camps DELETE] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
