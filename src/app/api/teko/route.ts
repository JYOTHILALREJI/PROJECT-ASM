import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// /api/teko
// ---------------------------------------------------------------------------
// GET  — list all teko entries (cancelled employees whose identity is reused)
// POST — create a new teko entry
//        Body: { realName, workName, workEmployeeId, linkedEmployeeId?, notes? }
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const tekoEntries = await db.teko.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        linkedEmployee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            status: true,
            currentSite: true,
            trade: true,
            photo: true,
            nationality: true,
            phone: true,
            isTeamLeader: true,
            isSupervisor: true,
          },
        },
      },
    });

    // Also fetch the "original" cancelled employee for each teko entry.
    // The original employee is the one whose status='cancelled' and whose
    // employeeId matches the teko's workEmployeeId.
    const workIds = tekoEntries.map((t) => t.workEmployeeId);
    let originalEmployees: Array<{
      id: string;
      fullName: string;
      employeeId: string;
      nationality: string | null;
      phone: string | null;
      trade: string | null;
      currentSite: string | null;
      isTeamLeader: boolean;
      isSupervisor: boolean;
      status: string;
      photo: string | null;
      joinDate: Date | null;
    }> = [];
    try {
      originalEmployees = await db.employee.findMany({
        where: {
          employeeId: { in: workIds },
          status: 'cancelled',
        },
        select: {
          id: true,
          fullName: true,
          employeeId: true,
          nationality: true,
          phone: true,
          trade: true,
          currentSite: true,
          isTeamLeader: true,
          isSupervisor: true,
          status: true,
          photo: true,
          joinDate: true,
        },
      });
    } catch {
      // Employee table might not have cancelled employees yet
    }
    const originalMap = new Map(originalEmployees.map((e) => [e.employeeId, e]));

    return NextResponse.json({
      success: true,
      data: {
        teko: tekoEntries.map((t) => {
          const original = originalMap.get(t.workEmployeeId);
          return {
            id: t.id,
            realName: t.realName,
            workName: t.workName,
            workEmployeeId: t.workEmployeeId,
            linkedEmployeeId: t.linkedEmployeeId,
            notes: t.notes,
            cancelledAt: t.cancelledAt.toISOString(),
            createdAt: t.createdAt.toISOString(),
            updatedAt: t.updatedAt.toISOString(),
            linkedEmployee: t.linkedEmployee
              ? {
                  ...t.linkedEmployee,
                  photo: t.linkedEmployee.photo ?? null,
                  currentSite: t.linkedEmployee.currentSite ?? null,
                  trade: t.linkedEmployee.trade ?? null,
                  nationality: t.linkedEmployee.nationality ?? null,
                  phone: t.linkedEmployee.phone ?? null,
                }
              : null,
            originalEmployee: original
              ? {
                  ...original,
                  photo: original.photo ?? null,
                  nationality: original.nationality ?? null,
                  phone: original.phone ?? null,
                  trade: original.trade ?? null,
                  currentSite: original.currentSite ?? null,
                  joinDate: original.joinDate ? original.joinDate.toISOString() : null,
                }
              : null,
          };
        }),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[teko GET] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { realName, workName, workEmployeeId, linkedEmployeeId, notes, cancelledFromEmployeeId } = body;

    if (!realName || typeof realName !== 'string' || !realName.trim()) {
      return NextResponse.json(
        { success: false, error: 'realName is required' },
        { status: 400 },
      );
    }
    if (!workName || typeof workName !== 'string' || !workName.trim()) {
      return NextResponse.json(
        { success: false, error: 'workName is required' },
        { status: 400 },
      );
    }
    if (!workEmployeeId || typeof workEmployeeId !== 'string' || !workEmployeeId.trim()) {
      return NextResponse.json(
        { success: false, error: 'workEmployeeId is required' },
        { status: 400 },
      );
    }

    // Check for existing teko with same workEmployeeId
    const existing = await db.teko.findUnique({ where: { workEmployeeId: workEmployeeId.trim() } });
    if (existing && existing.deletedAt === null) {
      return NextResponse.json(
        { success: false, error: 'A teko entry with this work employee ID already exists' },
        { status: 409 },
      );
    }

    // If linkedEmployeeId is provided, verify the employee exists
    if (linkedEmployeeId) {
      const emp = await db.employee.findUnique({ where: { id: linkedEmployeeId } });
      if (!emp) {
        return NextResponse.json(
          { success: false, error: 'Linked employee not found' },
          { status: 404 },
        );
      }
    }

    const teko = await db.teko.create({
      data: {
        realName: realName.trim(),
        workName: workName.trim(),
        workEmployeeId: workEmployeeId.trim(),
        linkedEmployeeId: linkedEmployeeId || null,
        notes: typeof notes === 'string' ? notes : '',
      },
    });

    // If this teko is being created from cancelling an existing employee
    // (cancelledFromEmployeeId), mark that employee as 'cancelled' status
    if (cancelledFromEmployeeId) {
      try {
        await db.employee.update({
          where: { id: cancelledFromEmployeeId },
          data: { status: 'cancelled' },
        });
      } catch {
        // Non-fatal — the teko entry is still created
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: teko.id,
        realName: teko.realName,
        workName: teko.workName,
        workEmployeeId: teko.workEmployeeId,
        linkedEmployeeId: teko.linkedEmployeeId,
        notes: teko.notes,
        cancelledAt: teko.cancelledAt.toISOString(),
        createdAt: teko.createdAt.toISOString(),
        updatedAt: teko.updatedAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[teko POST] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
