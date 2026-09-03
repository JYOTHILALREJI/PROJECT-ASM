import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { resolveStoragePath, ensureStorageDir, sanitizeFileName, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/employee/[id]
//   PATCH  — rename a document (docName) · reassign it to another employee
//            (targetEmployeeId) to fix batch-upload mismatches · both at once
//   DELETE — soft-delete the row and remove the stored file
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const doc = await db.employeeDocument.findFirst({ where: { id, deletedAt: null } });
    if (!doc) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    const body = (await request.json()) as {
      docName?: string;
      docType?: string;
      expiryDate?: string | null;
      notes?: string | null;
      targetEmployeeId?: string;
      actorDisplayName?: string;
      actorUserId?: string;
    };

    const data: Record<string, unknown> = {};

    // ── reassign (fix mismatch): move the document to another employee ──
    let previousEmployee: { id: string; fullName: string; employeeId: string } | null = null;
    let newEmployee: { id: string; fullName: string; employeeId: string } | null = null;
    const targetEmployeeId = (body.targetEmployeeId || '').toString().trim();
    if (targetEmployeeId && targetEmployeeId !== doc.employeeId) {
      const target = await db.employee.findFirst({
        where: { id: targetEmployeeId, deletedAt: null },
        select: { id: true, fullName: true, employeeId: true },
      });
      if (!target) {
        return NextResponse.json({ success: false, error: 'Target employee not found' }, { status: 404 });
      }
      const current = await db.employee.findFirst({
        where: { id: doc.employeeId },
        select: { id: true, fullName: true, employeeId: true },
      });
      previousEmployee = current;
      newEmployee = target;
      data.employeeId = target.id;
    }

    // rename stays OPTIONAL when reassigning; required when only renaming
    const docName = (body.docName || '').trim();
    if (docName) {
      data.docName = docName;
    } else if (!targetEmployeeId) {
      return NextResponse.json({ success: false, error: 'Document name cannot be empty' }, { status: 400 });
    }

    if (body.docType && ['passport', 'id_card', 'visa', 'other'].includes(body.docType)) {
      data.docType = body.docType;
    }
    if (body.expiryDate !== undefined) {
      const exp = (body.expiryDate || '').toString().trim();
      if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
        return NextResponse.json({ success: false, error: 'Expiry date must be in YYYY-MM-DD format' }, { status: 400 });
      }
      data.expiryDate = exp || null;
    }
    if (body.notes !== undefined) {
      data.notes = (body.notes || '').toString().trim() || null;
    }

    const updated = await db.employeeDocument.update({ where: { id }, data });

    // keep the physical file layout consistent with the standard convention:
    // storage/employee-documents/<employeeId>/{DOC_TYPE}_{EMPLOYEE_NAME}.{ext}
    if (newEmployee) {
      try {
        const srcAbs = resolveStoragePath(updated.filePath);
        if (fs.existsSync(srcAbs)) {
          const ext = path.extname(updated.filePath).toLowerCase() || '.pdf';
          const stdBase = `${updated.docType.toUpperCase()}_${newEmployee.fullName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').toUpperCase()}`;
          const dir = ensureStorageDir('employee-documents', newEmployee.id);
          const targetAbs = uniqueFilePath(dir, sanitizeFileName(`${stdBase}${ext}`));
          fs.copyFileSync(srcAbs, targetAbs);
          const relativePath = path.relative(process.cwd(), targetAbs).replace(/\\/g, '/');
          await db.employeeDocument.update({
            where: { id },
            data: { filePath: relativePath, fileName: path.basename(targetAbs) },
          });
          fs.unlinkSync(srcAbs); // remove from the OLD employee's folder
        }
      } catch (moveErr) {
        // the DB row is already reassigned — a failed physical move must not
        // 500 the request; surface it as a warning field instead
        console.error('[documents reassign] file move failed:', moveErr);
        return NextResponse.json({
          success: true,
          data: { document: updated, warning: 'Reassigned in the database, but the physical file could not be moved' },
        });
      }

      await logActivity({
        userId: body.actorUserId || undefined,
        displayName: body.actorDisplayName || 'Admin',
        action: 'employee_document_reassign',
        entityType: 'employee_document',
        entityId: updated.id,
        entityName: updated.docName,
        description: `Moved ${updated.docType} document "${updated.docName}" from ${previousEmployee?.fullName ?? '?'} (${previousEmployee?.employeeId ?? '?'}) to ${newEmployee.fullName} (${newEmployee.employeeId})`,
      }).catch(() => undefined);
    }

    return NextResponse.json({ success: true, data: { document: updated } });
  } catch (error) {
    console.error('PATCH /api/documents/employee/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update document' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const doc = await db.employeeDocument.findFirst({ where: { id, deletedAt: null } });
    if (!doc) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    await db.employeeDocument.update({ where: { id }, data: { deletedAt: new Date() } });

    if (doc.filePath) {
      const abs = resolveStoragePath(doc.filePath);
      if (fs.existsSync(abs)) {
        try {
          fs.unlinkSync(abs);
        } catch {
          // best effort — the soft-deleted row hides the doc anyway
        }
      }
    }

    const actorDisplayName = request.nextUrl.searchParams.get('actorDisplayName') || 'Admin';
    const actorUserId = request.nextUrl.searchParams.get('actorUserId') || undefined;
    await logActivity({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'employee_document_delete',
      entityType: 'employee_document',
      entityId: doc.id,
      entityName: doc.docName,
      description: `Deleted ${doc.docType} document "${doc.docName}"`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/documents/employee/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete document' }, { status: 500 });
  }
}
