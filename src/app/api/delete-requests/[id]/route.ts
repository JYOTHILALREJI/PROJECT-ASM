import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, reviewedBy } = body;

    if (!status || !reviewedBy) {
      return NextResponse.json(
        { success: false, error: 'status and reviewedBy are required' },
        { status: 400 }
      );
    }

    const validStatuses = ['approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: 'Status must be "approved" or "rejected"' },
        { status: 400 }
      );
    }

    const existing = await db.cancellationRequest.findUnique({
      where: { id },
      include: {
        employee: {
          select: { id: true, fullName: true, employeeId: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Delete request not found' },
        { status: 404 }
      );
    }

    if (existing.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: `Delete request is already ${existing.status}` },
        { status: 400 }
      );
    }

    const result = await db.$transaction(async (tx) => {
      // Update the cancellation request
      const updatedRequest = await tx.cancellationRequest.update({
        where: { id },
        data: {
          status,
          reviewedById: reviewedBy,
          reviewedAt: new Date(),
        },
        include: {
          employee: {
            select: { id: true, fullName: true, employeeId: true },
          },
        },
      });

      if (status === 'approved') {
        // Set employee status to deleted
        await tx.employee.update({
          where: { id: existing.employeeId },
          data: { status: 'deleted' },
        });

        // Mark all uniform registry records for this employee as deleted (hidden)
        await tx.uniformRegistry.updateMany({
          where: { employeeId: existing.employeeId, isDeleted: false },
          data: { isDeleted: true },
        });
      } else {
        // Rejected: restore employee to active
        await tx.employee.update({
          where: { id: existing.employeeId },
          data: { status: 'active' },
        });
      }

      return updatedRequest;
    });

    return NextResponse.json({
      success: true,
      data: {
        deleteRequest: {
          ...result,
          reviewedAt: result.reviewedAt?.toISOString() || null,
          createdAt: result.createdAt.toISOString(),
          updatedAt: result.updatedAt.toISOString(),
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
