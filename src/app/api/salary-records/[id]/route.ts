import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// PUT /api/salary-records/[id] — Update individual salary record fields
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const existing = await db.salaryRecord.findUnique({ where: { id } });

    if (!existing || existing.isDeleted) {
      return NextResponse.json(
        { success: false, error: 'Salary record not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const {
      deduction,
      advance,
      rtPerHour,
      totalHours,
      isPaid,
      rateTier,
      empName,
      nationality,
      trade,
      employeeCode,
    } = body;

    // Use new values if provided, otherwise keep existing
    const newTotalHours = totalHours !== undefined ? totalHours : existing.totalHours;
    const newRtPerHour = rtPerHour !== undefined ? rtPerHour : existing.rtPerHour;
    const newDeduction = deduction !== undefined ? deduction : existing.deduction;
    const newAdvance = advance !== undefined ? advance : existing.advance;

    // Recalculate totals
    const newTotalSalary = newTotalHours * newRtPerHour;
    const newBalanceSalary = newTotalSalary - newDeduction - newAdvance;

    const salaryRecord = await db.salaryRecord.update({
      where: { id },
      data: {
        ...(totalHours !== undefined ? { totalHours: newTotalHours } : {}),
        ...(rtPerHour !== undefined ? { rtPerHour: newRtPerHour } : {}),
        ...(deduction !== undefined ? { deduction: newDeduction } : {}),
        ...(advance !== undefined ? { advance: newAdvance } : {}),
        totalSalary: newTotalSalary,
        balanceSalary: newBalanceSalary,
        ...(isPaid !== undefined ? { isPaid } : {}),
        ...(rateTier !== undefined ? { rateTier } : {}),
        ...(empName !== undefined ? { empName } : {}),
        ...(nationality !== undefined ? { nationality } : {}),
        ...(trade !== undefined ? { trade } : {}),
        ...(employeeCode !== undefined ? { employeeCode } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        salaryRecord: {
          ...salaryRecord,
          createdAt: salaryRecord.createdAt.toISOString(),
          updatedAt: salaryRecord.updatedAt.toISOString(),
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// PATCH /api/salary-records/[id] — Toggle soft delete (undo delete)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const body = await request.json();
    const { isDeleted } = body;

    if (typeof isDeleted !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'isDeleted boolean is required' },
        { status: 400 }
      );
    }

    const existing = await db.salaryRecord.findUnique({ where: { id } });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Salary record not found' },
        { status: 404 }
      );
    }

    const salaryRecord = await db.salaryRecord.update({
      where: { id },
      data: { isDeleted },
    });

    return NextResponse.json({
      success: true,
      data: {
        salaryRecord: {
          ...salaryRecord,
          createdAt: salaryRecord.createdAt.toISOString(),
          updatedAt: salaryRecord.updatedAt.toISOString(),
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// DELETE /api/salary-records/[id] — Soft delete a salary record
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const existing = await db.salaryRecord.findUnique({ where: { id } });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Salary record not found' },
        { status: 404 }
      );
    }

    if (existing.isDeleted) {
      return NextResponse.json(
        { success: false, error: 'Salary record already deleted' },
        { status: 400 }
      );
    }

    const salaryRecord = await db.salaryRecord.update({
      where: { id },
      data: { isDeleted: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        salaryRecord: {
          ...salaryRecord,
          createdAt: salaryRecord.createdAt.toISOString(),
          updatedAt: salaryRecord.updatedAt.toISOString(),
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
