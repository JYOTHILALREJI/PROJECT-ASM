import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { resolveStoragePath } from '@/lib/document-storage';
import fs from 'fs';

// ---------------------------------------------------------------------------
// /api/documents/employee/[id]
//   PATCH  — rename a document (docName)
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

    const body = (await request.json()) as { docName?: string; docType?: string };
    const docName = (body.docName || '').trim();
    if (!docName) {
      return NextResponse.json({ success: false, error: 'Document name cannot be empty' }, { status: 400 });
    }

    const data: Record<string, string> = { docName };
    if (body.docType && ['passport', 'id_card', 'visa', 'other'].includes(body.docType)) {
      data.docType = body.docType;
    }

    const updated = await db.employeeDocument.update({ where: { id }, data });
    return NextResponse.json({ success: true, data: { document: updated } });
  } catch (error) {
    console.error('PATCH /api/documents/employee/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to rename document' }, { status: 500 });
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
