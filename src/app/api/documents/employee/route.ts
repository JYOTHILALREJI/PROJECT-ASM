import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { ensureStorageDir, sanitizeFileName, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/employee
//   GET  — list employee documents (?employeeId=... or ?limit=recent)
//   POST — upload a scanned document (multipart form):
//            employeeId, docType (passport|id_card|visa|other),
//            docName (optional custom name), file (binary)
// ---------------------------------------------------------------------------

const ALLOWED_DOC_TYPES = ['passport', 'id_card', 'visa', 'other'];
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx'];
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export async function GET(request: NextRequest) {
  try {
    // Dashboard summary: distinct employees holding at least one document
    if (request.nextUrl.searchParams.get('stats') === '1') {
      const rows = await db.employeeDocument.findMany({
        where: { deletedAt: null },
        select: { employeeId: true, docType: true },
      });
      const employeesWithDocuments = new Set(rows.map((r) => r.employeeId)).size;
      const byType: Record<string, number> = {};
      for (const r of rows) byType[r.docType] = (byType[r.docType] || 0) + 1;
      return NextResponse.json({ success: true, data: { employeesWithDocuments, total: rows.length, byType } });
    }

    const employeeId = request.nextUrl.searchParams.get('employeeId');

    const where: Record<string, unknown> = { deletedAt: null };
    if (employeeId) where.employeeId = employeeId;

    const docs = await db.employeeDocument.findMany({
      where,
      include: {
        employee: {
          select: { id: true, fullName: true, employeeId: true, trade: true, companyName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      data: {
        documents: docs.map((d) => ({
          id: d.id,
          employeeId: d.employeeId,
          employeeName: d.employee.fullName,
          employeeCode: d.employee.employeeId,
          trade: d.employee.trade,
          companyName: d.employee.companyName,
          docType: d.docType,
          docName: d.docName,
          fileName: d.fileName,
          mimeType: d.mimeType,
          fileSize: d.fileSize,
          expiryDate: d.expiryDate,
          notes: d.notes,
          createdBy: d.createdBy,
          createdAt: d.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/documents/employee error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load employee documents' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const employeeId = (form.get('employeeId') || '').toString().trim();
    const docType = (form.get('docType') || 'other').toString().trim();
    const customName = (form.get('docName') || '').toString().trim();
    const expiryDate = (form.get('expiryDate') || '').toString().trim();
    const notes = (form.get('notes') || '').toString().trim();
    const actorDisplayName = (form.get('actorDisplayName') || '').toString().trim();
    const actorUserId = (form.get('actorUserId') || '').toString().trim();
    const file = form.get('file');

    if (!employeeId) {
      return NextResponse.json({ success: false, error: 'employeeId is required' }, { status: 400 });
    }
    if (!ALLOWED_DOC_TYPES.includes(docType)) {
      return NextResponse.json({ success: false, error: 'Invalid document type' }, { status: 400 });
    }
    if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
      return NextResponse.json({ success: false, error: 'Expiry date must be in YYYY-MM-DD format' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'A file is required' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ success: false, error: 'The uploaded file is empty' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ success: false, error: 'File exceeds the 20 MB limit' }, { status: 400 });
    }
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { success: false, error: `Unsupported file type "${ext || 'unknown'}". Allowed: PDF, images, Word documents.` },
        { status: 400 },
      );
    }

    const employee = await db.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true, fullName: true, employeeId: true },
    });
    if (!employee) {
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }

    // Persist under storage/employee-documents/<employeeId>/ with the
    // standardized name {DOC_TYPE}_{EMPLOYEE_NAME}.{ext} (PRD §56).
    const dir = ensureStorageDir('employee-documents', employeeId);
    const stdBase = `${docType.toUpperCase()}_${employee.fullName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').toUpperCase()}`;
    const safeName = sanitizeFileName(`${stdBase}${ext || '.pdf'}`);
    const absPath = uniqueFilePath(dir, safeName);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(absPath, buffer);
    const relativePath = path.relative(process.cwd(), absPath).replace(/\\/g, '/');

    const doc = await db.employeeDocument.create({
      data: {
        employeeId,
        docType,
        docName: customName || path.basename(safeName, ext),
        fileName: path.basename(absPath),
        filePath: relativePath,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        expiryDate: expiryDate || null,
        notes: notes || null,
        createdBy: actorDisplayName || null,
      },
    });

    await logActivity({
      userId: actorUserId || undefined,
      displayName: actorDisplayName || 'Admin',
      action: 'employee_document_upload',
      entityType: 'employee_document',
      entityId: doc.id,
      entityName: doc.docName,
      description: `Uploaded ${docType} document "${doc.docName}" for ${employee.fullName} (${employee.employeeId})`,
      details: { docType, fileName: doc.fileName, fileSize: doc.fileSize },
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { document: doc } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/documents/employee error:', error);
    return NextResponse.json({ success: false, error: 'Failed to upload document' }, { status: 500 });
  }
}
