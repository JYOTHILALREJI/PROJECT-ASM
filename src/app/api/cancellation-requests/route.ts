import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const employeeId = searchParams.get('employeeId');

    const where: Record<string, unknown> = {};

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      where.status = status;
    }

    if (employeeId) {
      where.employeeId = employeeId;
    }

    const cancellationRequests = await db.cancellationRequest.findMany({
      where,
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
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      data: {
        cancellationRequests: cancellationRequests.map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          employee: r.employee,
          reason: r.reason || '',
          status: r.status,
          requestedBy: r.requestedBy,
          reviewedBy: r.reviewedBy?.name || null,
          reviewedAt: r.reviewedAt?.toISOString() || null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employeeId, reason, createdById } = body;

    if (!employeeId || !createdById) {
      return NextResponse.json(
        { success: false, error: 'employeeId and createdById are required' },
        { status: 400 }
      );
    }

    // Verify employee exists
    const employee = await db.employee.findUnique({ where: { id: employeeId } });

    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    if (employee.status === 'deleted') {
      return NextResponse.json(
        { success: false, error: 'Employee is already deleted' },
        { status: 400 }
      );
    }

    if (employee.status === 'pending_deletion') {
      return NextResponse.json(
        { success: false, error: 'Employee already has a pending cancellation request' },
        { status: 400 }
      );
    }

    // Verify requester exists
    let finalRequestedById = createdById;
    const requester = await db.user.findUnique({ where: { id: createdById } });
    if (!requester) {
      const fallbackUser = await db.user.findFirst({ select: { id: true } });
      if (fallbackUser) {
        finalRequestedById = fallbackUser.id;
      } else {
        return NextResponse.json(
          { success: false, error: 'No user found in the system' },
          { status: 400 }
        );
      }
    }

    const cancellationRequest = await db.$transaction(async (tx) => {
      const newRequest = await tx.cancellationRequest.create({
        data: {
          employeeId,
          requestedById: finalRequestedById,
          reason: reason || null,
          status: 'pending',
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
        },
      });

      // Update employee status to pending_deletion
      await tx.employee.update({
        where: { id: employeeId },
        data: { status: 'pending_deletion' },
      });

      // Create notification for super admins
      const superAdmins = await tx.user.findMany({
        where: { role: 'super_admin' },
        select: { id: true },
      });

      for (const admin of superAdmins) {
        await tx.notification.create({
          data: {
            userId: admin.id,
            title: 'New Cancellation Request',
            message: `A cancellation request has been submitted for employee ${newRequest.employee.fullName} (${newRequest.employee.employeeId}).${reason ? ` Reason: ${reason}` : ''}`,
            type: 'request',
          },
        });
      }

      return newRequest;
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          cancellationRequest: {
            id: cancellationRequest.id,
            employeeId: cancellationRequest.employeeId,
            employee: cancellationRequest.employee,
            reason: cancellationRequest.reason || '',
            status: cancellationRequest.status,
            requestedBy: cancellationRequest.requestedBy,
            reviewedBy: null,
            reviewedAt: null,
            createdAt: cancellationRequest.createdAt.toISOString(),
            updatedAt: cancellationRequest.updatedAt.toISOString(),
          },
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
