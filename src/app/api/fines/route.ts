import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employeeId');

    const where: Record<string, unknown> = {};

    if (employeeId) {
      where.employeeId = employeeId;
    }

    const fines = await db.fine.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
          },
        },
        createdBy: {
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
        fines: fines.map((f) => ({
          ...f,
          createdAt: f.createdAt.toISOString(),
          updatedAt: f.updatedAt.toISOString(),
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
    const { employeeId, reason, amount, createdById } = body;

    if (!employeeId || !reason || amount === undefined || !createdById) {
      return NextResponse.json(
        { success: false, error: 'employeeId, reason, amount, and createdById are required' },
        { status: 400 }
      );
    }

    if (amount < 0) {
      return NextResponse.json(
        { success: false, error: 'Amount must be a positive number' },
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

    // Verify creator exists — if not, look up first available user as fallback
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

    const fine = await db.$transaction(async (tx) => {
      const newFine = await tx.fine.create({
        data: {
          employeeId,
          reason,
          amount,
          createdById: finalCreatedById,
        },
        include: {
          employee: {
            select: { fullName: true, employeeId: true, rating: true },
          },
        },
      });

      // Deduct 1 star for the fine
      const newRating = Math.max(0, Math.round((newFine.employee.rating - 1) * 10) / 10);
      await tx.employee.update({
        where: { id: employeeId },
        data: { rating: newRating },
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
            title: 'New Fine Issued',
            message: `A fine of ${amount} SAR has been issued for employee ${newFine.employee.fullName} (${newFine.employee.employeeId}). Reason: ${reason}`,
            type: 'fine',
          },
        });
      }

      return newFine;
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          fine: {
            ...fine,
            createdAt: fine.createdAt.toISOString(),
            updatedAt: fine.updatedAt.toISOString(),
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
