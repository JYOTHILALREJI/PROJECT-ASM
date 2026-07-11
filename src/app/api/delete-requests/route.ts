import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');

    const where: Record<string, unknown> = {};

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      where.status = status;
    }

    const cancellationRequests = await db.cancellationRequest.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            status: true,
            position: true,
            nationality: true,
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
        deleteRequests: cancellationRequests.map((r) => ({
          ...r,
          reason: r.reason || null,
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
    const { employeeId, requestedBy, reason } = body;

    if (!employeeId || !requestedBy) {
      return NextResponse.json(
        { success: false, error: 'employeeId and requestedBy are required' },
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

    const deleteRequest = await db.$transaction(async (tx) => {
      const request = await tx.cancellationRequest.create({
        data: {
          employeeId,
          requestedById: requestedBy,
          reason: reason || null,
          status: 'pending',
        },
        include: {
          employee: {
            select: { fullName: true, employeeId: true },
          },
        },
      });

      // Update employee status to pending_deletion
      await tx.employee.update({
        where: { id: employeeId },
        data: { status: 'pending_deletion' },
      });

      return request;
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          deleteRequest: {
            ...deleteRequest,
            createdAt: deleteRequest.createdAt.toISOString(),
            updatedAt: deleteRequest.updatedAt.toISOString(),
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
