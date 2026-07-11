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

    const leaveRequests = await db.leaveRequest.findMany({
      where,
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
        leaveRequests: leaveRequests.map((r) => ({
          id: r.id,
          employeeId: r.employeeId,
          employee: r.employee,
          type: r.leaveType,
          otherTypeText: r.otherTypeText,
          startDate: r.startDate.toISOString(),
          endDate: r.endDate.toISOString(),
          totalDays: r.totalDays,
          reason: r.reason,
          status: r.status,
          createdBy: r.createdBy,
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
    const { employeeId, type, otherTypeText, startDate, endDate, totalDays, reason, createdById } = body;

    if (!employeeId || !type || !startDate || !endDate || !totalDays || !reason || !createdById) {
      return NextResponse.json(
        { success: false, error: 'employeeId, type, startDate, endDate, totalDays, reason, and createdById are required' },
        { status: 400 }
      );
    }

    const validLeaveTypes = ['casual', 'sick', 'annual', 'emergency', 'marriage', 'other'];
    if (!validLeaveTypes.includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Invalid leave type. Must be one of: casual, sick, annual, emergency, marriage, other' },
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
        { success: false, error: 'Cannot create leave request for deleted employee' },
        { status: 400 }
      );
    }

    // Verify creator exists
    let finalCreatedById = createdById;
    const creator = await db.user.findUnique({ where: { id: createdById } });
    if (!creator) {
      const fallbackUser = await db.user.findFirst({ select: { id: true } });
      if (fallbackUser) {
        finalCreatedById = fallbackUser.id;
      } else {
        return NextResponse.json(
          { success: false, error: 'No user found in the system' },
          { status: 400 }
        );
      }
    }

    const leaveRequest = await db.$transaction(async (tx) => {
      const newRequest = await tx.leaveRequest.create({
        data: {
          employeeId,
          leaveType: type,
          otherTypeText: type === 'other' ? (otherTypeText || null) : null,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          totalDays: parseInt(String(totalDays), 10),
          reason,
          createdById: finalCreatedById,
          status: 'pending',
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
        },
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
            title: 'New Leave Request',
            message: `A ${type} leave request has been submitted for employee ${newRequest.employee.fullName} (${newRequest.employee.employeeId}) for ${totalDays} day(s).`,
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
          leaveRequest: {
            id: leaveRequest.id,
            employeeId: leaveRequest.employeeId,
            employee: leaveRequest.employee,
            type: leaveRequest.leaveType,
            otherTypeText: leaveRequest.otherTypeText,
            startDate: leaveRequest.startDate.toISOString(),
            endDate: leaveRequest.endDate.toISOString(),
            totalDays: leaveRequest.totalDays,
            reason: leaveRequest.reason,
            status: leaveRequest.status,
            createdBy: leaveRequest.createdBy,
            reviewedBy: null,
            reviewedAt: null,
            createdAt: leaveRequest.createdAt.toISOString(),
            updatedAt: leaveRequest.updatedAt.toISOString(),
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
