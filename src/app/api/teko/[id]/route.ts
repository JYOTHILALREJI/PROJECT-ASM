import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// /api/teko/[id]
// ---------------------------------------------------------------------------
// PUT    — update a teko entry (e.g. link/unlink an employee, edit names)
// DELETE — soft-delete a teko entry
// ---------------------------------------------------------------------------

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await db.teko.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return NextResponse.json(
        { success: false, error: 'Teko entry not found' },
        { status: 404 },
      );
    }

    const updateData: Record<string, unknown> = {};

    if (typeof body.realName === 'string' && body.realName.trim()) {
      updateData.realName = body.realName.trim();
    }
    if (typeof body.workName === 'string' && body.workName.trim()) {
      updateData.workName = body.workName.trim();
    }
    if (typeof body.workEmployeeId === 'string' && body.workEmployeeId.trim()) {
      // Check for conflict
      const conflict = await db.teko.findUnique({ where: { workEmployeeId: body.workEmployeeId.trim() } });
      if (conflict && conflict.id !== id) {
        return NextResponse.json(
          { success: false, error: 'A teko entry with this work employee ID already exists' },
          { status: 409 },
        );
      }
      updateData.workEmployeeId = body.workEmployeeId.trim();
    }
    if (typeof body.notes === 'string') {
      updateData.notes = body.notes;
    }
    // Link/unlink an employee
    if (body.linkedEmployeeId !== undefined) {
      if (body.linkedEmployeeId === null) {
        updateData.linkedEmployeeId = null;
      } else {
        // Verify the employee exists
        const emp = await db.employee.findUnique({ where: { id: body.linkedEmployeeId } });
        if (!emp) {
          return NextResponse.json(
            { success: false, error: 'Linked employee not found' },
            { status: 404 },
          );
        }
        updateData.linkedEmployeeId = body.linkedEmployeeId;
      }
    }

    const updated = await db.teko.update({ where: { id }, data: updateData });

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        realName: updated.realName,
        workName: updated.workName,
        workEmployeeId: updated.workEmployeeId,
        linkedEmployeeId: updated.linkedEmployeeId,
        notes: updated.notes,
        cancelledAt: updated.cancelledAt.toISOString(),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[teko PUT] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const existing = await db.teko.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return NextResponse.json(
        { success: false, error: 'Teko entry not found' },
        { status: 404 },
      );
    }

    // Soft-delete the teko entry and unlink any employee
    await db.$transaction([
      db.teko.update({
        where: { id },
        data: { deletedAt: new Date(), linkedEmployeeId: null },
      }),
    ]);

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[teko DELETE] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
