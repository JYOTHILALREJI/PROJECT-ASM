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

    const existing = await db.leaveRequest.findUnique({
      where: { id },
      include: {
        employee: {
          select: { id: true, fullName: true, employeeId: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Leave request not found' },
        { status: 404 }
      );
    }

    if (existing.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: `Leave request is already ${existing.status}` },
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
      const updatedRequest = await tx.leaveRequest.update({
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
              companyName: true,
              phone: true,
              nationality: true,
            },
          },
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          reviewedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      // Notify the creator of the request about the review result
      await tx.notification.create({
        data: {
          userId: updatedRequest.createdById,
          title: `Leave Request ${status === 'approved' ? 'Approved' : 'Rejected'}`,
          message: `The ${updatedRequest.leaveType} leave request for employee ${updatedRequest.employee.fullName} (${updatedRequest.employee.employeeId}) has been ${status}.`,
          type: 'request',
        },
      });

      return updatedRequest;
    });

    return NextResponse.json({
      success: true,
      data: {
        leaveRequest: {
          id: result.id,
          employeeId: result.employeeId,
          employee: result.employee,
          type: result.leaveType,
          otherTypeText: result.otherTypeText,
          startDate: result.startDate.toISOString(),
          endDate: result.endDate.toISOString(),
          totalDays: result.totalDays,
          reason: result.reason,
          status: result.status,
          createdBy: result.createdBy,
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
