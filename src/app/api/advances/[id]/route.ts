import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/advances/[id]
// ---------------------------------------------------------------------------
// DELETE — soft-delete an advance (only if status === "pending")
// PATCH   — update amount/reason/effectiveMonth/effectiveYear (only if pending)
//           or cancel (status -> "cancelled")
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const existing = await db.advance.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Advance not found' },
        { status: 404 },
      );
    }

    if (existing.status === 'applied') {
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot delete an advance that has already been applied to a salary record. Cancel it instead.',
        },
        { status: 400 },
      );
    }

    // Soft-delete
    const updated = await db.advance.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await db.advance.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Advance not found' },
        { status: 404 },
      );
    }

    if (existing.status === 'applied') {
      return NextResponse.json(
        { success: false, error: 'Cannot edit an advance that has already been applied' },
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = {};

    if (typeof body.amount === 'number' && body.amount > 0) {
      updateData.amount = body.amount;
    }
    if (typeof body.reason === 'string') {
      updateData.reason = body.reason;
    }
    if (typeof body.effectiveMonth === 'string' && /^\d{4}-\d{2}$/.test(body.effectiveMonth)) {
      updateData.effectiveMonth = body.effectiveMonth;
    }
    if (typeof body.effectiveYear === 'number') {
      updateData.effectiveYear = body.effectiveYear;
    }
    if (body.status === 'cancelled') {
      updateData.status = 'cancelled';
    }
    if (body.status === 'pending' && existing.status === 'cancelled') {
      updateData.status = 'pending';
    }

    const updated = await db.advance.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
