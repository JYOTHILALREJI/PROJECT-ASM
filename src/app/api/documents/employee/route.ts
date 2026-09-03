import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { ensureStorageDir, sanitizeFileName, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/employee
//   GET  — ?view=employees : PAGINATED employee directory with per-type
//          document counts (the Employee Documents tab — strict pagination
//          because the archive grows with the company):
//            ?view=employees&page=1&pageSize=12&search=&filter=all|with_docs
//          ?employeeId=... : all documents of one employee
//          ?stats=1        : dashboard counters
//   POST — upload a scanned document (multipart form):
//            employeeId, docType (passport|id_card|visa|other),
//            docName (optional custom name), file (binary)
// ---------------------------------------------------------------------------

const ALLOWED_DOC_TYPES = ['passport', 'id_card', 'visa', 'other'];
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx'];

/**
 * Magic-byte sniffing (§5-6) — never trust the extension alone. Returns an
 * error string when the CONTENT does not match the declared file type.
 */
function sniffFileError(buffer: Buffer, ext: string): string | null {
  if (buffer.length < 8) return 'The file is too small to be a valid document.';
  const head = buffer.subarray(0, 12);
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isWebp = head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // PK — docx
  const isDoc = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0; // OLE2 — doc
  switch (ext) {
    case '.pdf':
      return isPdf ? null : 'The file content is not a valid PDF (corrupted or renamed file).';
    case '.jpg':
    case '.jpeg':
      return isJpeg ? null : 'The file content is not a valid JPG image (corrupted or renamed file).';
    case '.png':
      return isPng ? null : 'The file content is not a valid PNG image (corrupted or renamed file).';
    case '.webp':
      return isWebp ? null : 'The file content is not a valid WEBP image (corrupted or renamed file).';
    case '.docx':
      return isZip ? null : 'The file content is not a valid Word document (corrupted or renamed file).';
    case '.doc':
      return isDoc || isZip ? null : 'The file content is not a valid Word document (corrupted or renamed file).';
    default:
      return 'Unsupported file format.';
  }
}
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const view = sp.get('view') || '';

    // Dashboard summary: distinct employees holding at least one document
    if (sp.get('stats') === '1') {
      const rows = await db.employeeDocument.findMany({
        where: { deletedAt: null },
        select: { employeeId: true, docType: true },
      });
      const employeesWithDocuments = new Set(rows.map((r) => r.employeeId)).size;
      const byType: Record<string, number> = {};
      for (const r of rows) byType[r.docType] = (byType[r.docType] || 0) + 1;
      return NextResponse.json({ success: true, data: { employeesWithDocuments, total: rows.length, byType } });
    }

    // ── paginated employee directory with document counts ──
    if (view === 'employees') {
      const page = Math.max(parseInt(sp.get('page') || '1', 10) || 1, 1);
      const pageSize = Math.min(Math.max(parseInt(sp.get('pageSize') || '12', 10) || 12, 1), 60);
      const search = (sp.get('search') || '').trim();
      const filter = sp.get('filter') || 'all'; // all | with_docs

      const where: Record<string, unknown> = { deletedAt: null };
      if (search) {
        where.OR = [
          { fullName: { contains: search } },
          { employeeId: { contains: search } },
          { passportNumber: { contains: search } },
          { trade: { contains: search } },
          { companyName: { contains: search } },
        ];
      }
      if (filter === 'with_docs') {
        where.documents = { some: { deletedAt: null } };
      }

      const [total, employees] = await Promise.all([
        db.employee.count({ where }),
        db.employee.findMany({
          where,
          orderBy: { fullName: 'asc' },
          select: {
            id: true, fullName: true, employeeId: true, trade: true,
            companyName: true, nationality: true, passportNumber: true,
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      // per-type document counts for exactly this page's employees
      const ids = employees.map((e) => e.id);
      const counts = ids.length
        ? await db.employeeDocument.groupBy({
            by: ['employeeId', 'docType'],
            where: { deletedAt: null, employeeId: { in: ids } },
            _count: { _all: true },
          })
        : [];
      const countMap = new Map<string, Record<string, number>>();
      for (const c of counts) {
        const entry = countMap.get(c.employeeId) || { passport: 0, id_card: 0, visa: 0, other: 0, total: 0 };
        entry[c.docType] = (entry[c.docType] || 0) + (c._count._all || 0);
        entry.total += c._count._all || 0;
        countMap.set(c.employeeId, entry);
      }

      return NextResponse.json({
        success: true,
        data: {
          employees: employees.map((e) => ({
            ...e,
            docCounts: countMap.get(e.id) || { passport: 0, id_card: 0, visa: 0, other: 0, total: 0 },
          })),
          total,
          page,
          pageSize,
          totalPages: Math.max(Math.ceil(total / pageSize), 1),
        },
      });
    }

    const employeeId = sp.get('employeeId');

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

    // content integrity check BEFORE touching storage (§6)
    const contentCheck = sniffFileError(Buffer.from(await file.arrayBuffer()), ext);
    if (contentCheck) {
      return NextResponse.json({ success: false, error: contentCheck }, { status: 400 });
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
