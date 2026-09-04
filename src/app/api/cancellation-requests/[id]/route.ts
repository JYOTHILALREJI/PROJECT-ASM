import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { db } from '@/lib/db';
import { cascadeSoftDeleteEmployee, permanentlyDeleteEmployee } from '@/lib/soft-delete';
import { resolveStoragePath } from '@/lib/document-storage';
import { logActivity } from '@/lib/activity-logger';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, reviewedBy, actorDisplayName } = body;

    // deletionMode decides what happens to the employee on approval:
    //   "soft"      (default) → recycle bin (soft delete, restorable)
    //   "permanent" → hard delete (employee + every related record, irreversible)
    const deletionMode = body.deletionMode === 'permanent' ? 'permanent' : 'soft';

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
          message:
            status === 'rejected'
              ? `The cancellation request for employee ${updatedRequest.employee.fullName} (${updatedRequest.employee.employeeId}) has been rejected — the employee stays active.`
              : deletionMode === 'permanent'
                ? `The cancellation request for employee ${updatedRequest.employee.fullName} (${updatedRequest.employee.employeeId}) has been approved — the employee record has been PERMANENTLY deleted.`
                : `The cancellation request for employee ${updatedRequest.employee.fullName} (${updatedRequest.employee.employeeId}) has been approved — the employee has been moved to the Recycle Bin and can be restored.`,
          type: 'request',
          actorId: finalReviewedById,
        },
      });

      return updatedRequest;
    });

    // After the request transaction commits, perform the actual deletion of the
    // employee. "soft" cascades a restorable soft-delete (recycle bin);
    // "permanent" irreversibly removes the employee and every related record.
    if (status === 'approved') {
      if (deletionMode === 'permanent') {
        const { filePaths } = await permanentlyDeleteEmployee(existing.employeeId);
        for (const rel of filePaths) {
          try {
            const abs = resolveStoragePath(rel);
            if (fs.existsSync(abs)) fs.unlinkSync(abs);
          } catch {
            // best effort file cleanup
          }
        }
      } else {
        await cascadeSoftDeleteEmployee(existing.employeeId);
      }
    }

    // Log the activity
    await logActivity({
      userId: finalReviewedById,
      displayName: actorDisplayName || reviewer?.name || reviewer?.email || 'Admin',
      action: status === 'approved' ? 'cancellation_request_approve' : 'cancellation_request_reject',
      entityType: 'cancellation_request',
      entityId: id,
      entityName: result.employee.fullName,
      description: `${status === 'approved' ? 'Approved' : 'Rejected'} cancellation request for ${result.employee.fullName} (${result.employee.employeeId})${status === 'approved' ? (deletionMode === 'permanent' ? ' — employee PERMANENTLY deleted with all related records' : ' — employee moved to the Recycle Bin (soft delete with cascade)') : ' — employee restored to active'}`,
      details: { status, deletionMode: status === 'approved' ? deletionMode : undefined, employeeId: existing.employeeId, reason: existing.reason },
      request,
    });

    return NextResponse.json({
      success: true,
      data: {
        cancellationRequest: {
          id: result.id,
          employeeId: result.employeeId,
          employee: result.employee,
          reason: result.reason || '',
          status: result.status,
          deletionMode,
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
