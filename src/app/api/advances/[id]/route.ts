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
        { success: false, error: 'Cannot edit a one-time advance that has already been applied' },
        { status: 400 },
      );
    }

    // "completed" recurring advances CAN be edited (to change the monthly
    // amount and reactivate them). Only block edits to one-time "applied".

    const updateData: Record<string, unknown> = {};

    if (typeof body.amount === 'number' && body.amount > 0) {
      updateData.amount = body.amount;
      // Recurring advances track a remaining balance — when the total amount
      // changes, the balance must shift by the same delta, otherwise the
      // advance can never complete (or completes early). Repayments already
      // made are preserved: only the difference is applied.
      if (existing.deductionType === 'recurring' && existing.remainingBalance !== null && body.deductionType !== 'one_time') {
        const delta = body.amount - existing.amount;
        const nextBalance = Math.max(0, (existing.remainingBalance ?? 0) + delta);
        updateData.remainingBalance = nextBalance;
        if (nextBalance === 0 && existing.status === 'active') {
          updateData.status = 'completed';
        } else if (nextBalance > 0 && existing.status === 'completed') {
          updateData.status = 'active';
        }
      }
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

    // ── Recurring deduction fields ──
    // Allow changing the monthly deduction amount mid-way. The new amount
    // applies from the next month onward — previous repayments are unaffected.
    // If the advance was "completed", changing the amount reactivates it.
    if (typeof body.monthlyDeductionAmount === 'number' && body.monthlyDeductionAmount >= 0) {
      updateData.monthlyDeductionAmount = body.monthlyDeductionAmount;
      // If the advance is recurring and was completed, reactivate it
      if (existing.deductionType === 'recurring' && existing.status === 'completed') {
        updateData.status = 'active';
      }
    }

    // ── Recurring end month (recurringUntil) ──
    // Accepted values:
    //   null / ''            → clear the end (deduct until fully repaid)
    //   "YYYY-MM"            → inclusive final deduction month; must not be
    //                          earlier than the (possibly updated) effectiveMonth
    if (existing.deductionType === 'recurring' && 'recurringUntil' in body) {
      const raw = body.recurringUntil;
      if (raw === null || raw === '') {
        updateData.recurringUntil = null;
      } else if (typeof raw === 'string' && /^\d{4}-\d{2}$/.test(raw)) {
        const effectiveStart =
          (typeof updateData.effectiveMonth === 'string' ? updateData.effectiveMonth : existing.effectiveMonth);
        if (raw < effectiveStart) {
          return NextResponse.json(
            {
              success: false,
              error: `recurringUntil (${raw}) must not be earlier than the effective month (${effectiveStart})`,
            },
            { status: 400 },
          );
        }
        updateData.recurringUntil = raw;
        // If the advance was completed and the end month now allows future
        // deductions, keep status as-is — reactivation stays amount-driven.
      } else {
        return NextResponse.json(
          { success: false, error: 'recurringUntil must be in YYYY-MM format (or null to clear)' },
          { status: 400 },
        );
      }
    }

    // Allow changing deductionType (one_time ↔ recurring)
    if (body.deductionType === 'recurring' || body.deductionType === 'one_time') {
      updateData.deductionType = body.deductionType;
      if (body.deductionType === 'recurring') {
        // When switching to recurring, initialize remainingBalance
        if (typeof body.monthlyDeductionAmount === 'number' && body.monthlyDeductionAmount > 0) {
          updateData.monthlyDeductionAmount = body.monthlyDeductionAmount;
        }
        updateData.remainingBalance = body.amount ?? existing.amount;
        if (existing.status !== 'completed') {
          updateData.status = 'active';
        }
      } else {
        // Switching back to one_time — clear recurring fields
        updateData.monthlyDeductionAmount = null;
        updateData.remainingBalance = null;
        if (existing.status === 'active') {
          updateData.status = 'pending';
        }
      }
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
