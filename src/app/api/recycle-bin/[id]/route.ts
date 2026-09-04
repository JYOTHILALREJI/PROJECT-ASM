import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { db } from '@/lib/db';
import {
  permanentlyDeleteEmployee,
  restoreSoftDeletedEmployee,
} from '@/lib/soft-delete';
import { resolveStoragePath } from '@/lib/document-storage';
import { logActivity } from '@/lib/activity-logger';

/**
 * Recycle Bin — single employee actions.
 *
 * POST   /api/recycle-bin/[id]  → RESTORE the soft-deleted employee (undo)
 * DELETE /api/recycle-bin/[id]  → PERMANENTLY delete the employee (irreversible)
 */

function cleanupFiles(filePaths: string[]) {
  for (const rel of filePaths) {
    try {
      const abs = resolveStoragePath(rel);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {
      // best effort — never block the deletion on file cleanup
    }
  }
}

async function getBinEmployee(id: string) {
  return db.employee.findFirst({
    where: { id, OR: [{ isDeleted: true }, { deletedAt: { not: null } }] },
    select: { id: true, fullName: true, employeeId: true },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const userId = typeof body.userId === 'string' ? body.userId : null;
    const actorDisplayName = typeof body.actorDisplayName === 'string' ? body.actorDisplayName : null;

    const employee = await getBinEmployee(id);
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found in the Recycle Bin' },
        { status: 404 }
      );
    }

    await restoreSoftDeletedEmployee(id);

    try {
      await logActivity({
        userId,
        displayName: actorDisplayName || 'Admin',
        action: 'recycle_bin_restore',
        entityType: 'employee',
        entityId: id,
        entityName: employee.fullName,
        description: `Restored ${employee.fullName} (${employee.employeeId}) from the Recycle Bin`,
        details: { employeeId: id },
        request,
      });
    } catch {
      // logging must never break the operation
    }

    return NextResponse.json({
      success: true,
      data: { restored: true, employeeId: id },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const userId = typeof body.userId === 'string' ? body.userId : null;
    const actorDisplayName = typeof body.actorDisplayName === 'string' ? body.actorDisplayName : null;

    const employee = await getBinEmployee(id);
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found in the Recycle Bin' },
        { status: 404 }
      );
    }

    const { filePaths } = await permanentlyDeleteEmployee(id);
    cleanupFiles(filePaths);

    try {
      await logActivity({
        userId,
        displayName: actorDisplayName || 'Admin',
        action: 'recycle_bin_permanent_delete',
        entityType: 'employee',
        entityId: id,
        entityName: employee.fullName,
        description: `Permanently deleted ${employee.fullName} (${employee.employeeId}) from the Recycle Bin`,
        details: { employeeId: id, filesRemoved: filePaths.length },
        request,
      });
    } catch {
      // logging must never break the operation
    }

    return NextResponse.json({
      success: true,
      data: { deleted: true, employeeId: id },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
