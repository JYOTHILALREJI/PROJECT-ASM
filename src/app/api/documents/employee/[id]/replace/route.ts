import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { ensureStorageDir, resolveStoragePath, sanitizeFileName, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// POST /api/documents/employee/[id]/replace  (multipart)
//   Replaces the stored file of an existing document while keeping its name,
//   type and history intact (PRD §33 "Replace").
// ---------------------------------------------------------------------------

const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx'];
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const doc = await db.employeeDocument.findFirst({ where: { id, deletedAt: null } });
    if (!doc) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    const form = await request.formData();
    const file = form.get('file');
    const actorDisplayName = (form.get('actorDisplayName') || '').toString().trim();
    const actorUserId = (form.get('actorUserId') || '').toString().trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'A file is required' }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ success: false, error: 'File must be between 1 byte and 20 MB' }, { status: 400 });
    }
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ success: false, error: `Unsupported file type "${ext || 'unknown'}"` }, { status: 400 });
    }

    // Write the replacement with the standardized name (deduped)
    const dir = ensureStorageDir('employee-documents', doc.employeeId);
    const absPath = uniqueFilePath(dir, sanitizeFileName(doc.fileName || `document${ext}`));
    fs.writeFileSync(absPath, Buffer.from(await file.arrayBuffer()));
    const relativePath = path.relative(process.cwd(), absPath).replace(/\\/g, '/');

    // Remove the old file
    if (doc.filePath) {
      const oldAbs = resolveStoragePath(doc.filePath);
      if (fs.existsSync(oldAbs)) {
        try {
          fs.unlinkSync(oldAbs);
        } catch {
          // best effort
        }
      }
    }

    const updated = await db.employeeDocument.update({
      where: { id },
      data: {
        filePath: relativePath,
        fileName: path.basename(absPath),
        mimeType: file.type || doc.mimeType,
        fileSize: file.size,
      },
    });

    await logActivity({
      userId: actorUserId || undefined,
      displayName: actorDisplayName || 'Admin',
      action: 'employee_document_replace',
      entityType: 'employee_document',
      entityId: doc.id,
      entityName: doc.docName,
      description: `Replaced the file of "${doc.docName}"`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { document: updated } });
  } catch (error) {
    console.error('POST /api/documents/employee/[id]/replace error:', error);
    return NextResponse.json({ success: false, error: 'Failed to replace document file' }, { status: 500 });
  }
}
