import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cascadeSoftDeleteEmployee } from '@/lib/soft-delete';

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
        { success: false, error: 'Cancellation request not found' },
        { status: 404 }
      );
    }

    if (existing.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: `Cancellation request is already ${existing.status}` },
        { status: 400 }
      );
    }

    // Verify reviewer exists — if not, look up first available user as fallback
    let finalReviewedById = reviewedBy;
    const reviewer = await db.user.findUnique({ where: { id: reviewedBy } });
    if (!reviewer) {
      const fallbackUser = await db.user.findFirst({ select: { id: true } });
      if (fallbackUser) {
        finalReviewedById = fallbackUser.id;
      } else {
        return NextResponse.json(
          { success: false, error: 'No user found in the system' },
          { status: 400 }
        );
      }
    }

    const result = await db.$transaction(async (tx) => {
      // Update the cancellation request
      const updatedRequest = await tx.cancellationRequest.update({
        where: { id },
        data: {
          status,
          reviewedById: finalReviewedById,
          reviewedAt: new Date(),
        },
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              employeeId: true,
              position: true,
              phone: true,
              nationality: true,
              status: true,
            },
          },
          requestedBy: {
            select: { id: true, name: true, email: true },
          },
          reviewedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      if (status === 'approved') {
        // Mark employee status as pending the cascade (cascade runs after tx commits)
        await tx.employee.update({
          where: { id: existing.employeeId },
          data: { status: 'pending_deletion' },
        });
      } else {
        // Rejected: restore employee to active
        await tx.employee.update({
          where: { id: existing.employeeId },
          data: { status: 'active' },
        });
      }

      // Notify the requester about the review result
      await tx.notification.create({
        data: {
          userId: updatedRequest.requestedById,
          title: `Cancellation Request ${status === 'approved' ? 'Approved' : 'Rejected'}`,
          message: `The cancellation request for employee ${updatedRequest.employee.fullName} (${updatedRequest.employee.employeeId}) has been ${status}.`,
          type: 'request',
        },
      });

      return updatedRequest;
    });

    // After the request transaction commits, perform the cascading soft-delete
    // of the employee and every related child record (attendance, warnings,
    // fines, salary records, working hours, etc.). This keeps the cascade
    // atomic in its own transaction while leaving the audit trail intact.
    if (status === 'approved') {
      await cascadeSoftDeleteEmployee(existing.employeeId);
    }

    return NextResponse.json({
      success: true,
      data: {
        cancellationRequest: {
          id: result.id,
          employeeId: result.employeeId,
          employee: result.employee,
          reason: result.reason || '',
          status: result.status,
          requestedBy: result.requestedBy,
          reviewedBy: result.reviewedBy?.name || null,
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
