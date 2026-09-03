import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { ensureStorageDir, sanitizeFileName, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/employee/batch   (BATCH document upload with auto-matching)
// ---------------------------------------------------------------------------
// POST (application/json)   → INSPECT mode:
//      body { files: [{ name: "ASM-SEED-001 Passport.pdf" }, ...] }
//      Returns, per file: the detected document type and the best employee
//      match (+ candidates) so the UI can show a review grid BEFORE anything
//      is stored.
//
// POST (multipart/form-data) → UPLOAD mode:
//      files[]        : the binary files (index-aligned with `mappings`)
//      mappings       : JSON array [{ employeeId, docType, docName?, expiryDate?, notes? } | null]
//      actorUserId / actorDisplayName
//      Stores every file, magic-byte validated, under the target employee's
//      folder and creates ACTIVE EmployeeDocument rows. Per-file results are
//      returned — one bad file never aborts the batch.
// ---------------------------------------------------------------------------

const ALLOWED_DOC_TYPES = ['passport', 'id_card', 'visa', 'other'];
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx'];
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB per file
const MAX_BATCH_FILES = 100; // safety cap per batch

// ── helpers shared by both modes ────────────────────────────────────────────

/** Guess the document type from the file name (passport / emirates id / visa / …). */
function detectDocType(fileName: string): string {
  const n = fileName.toLowerCase().replace(/[-_.]/g, ' ').replace(/\s+/g, ' ');
  if (/passport|pasport|pass port/.test(n)) return 'passport';
  if (/(emirates|eid|em id|labour card|labor card|id card|idcard|national id|\bid\b|id no)/.test(n)) return 'id_card';
  if (/visa|residence|residens/.test(n)) return 'visa';
  return 'other';
}

interface MatchCandidate {
  id: string;
  fullName: string;
  employeeId: string;
  confidence: number; // 1.0 exact employee-code · 0.9 full name · 0.7 all-name-tokens
}

/** Match a file name against an employee (employee-code hit beats name hit). */
function matchEmployeeInFileName(
  fileName: string,
  employees: Array<{ id: string; fullName: string; employeeId: string }>,
): { employee: MatchCandidate | null; candidates: MatchCandidate[] } {
  const stripped = fileName.replace(/\.[^.]+$/, '');
  // keep TWO views of the name: employee codes contain dashes ("ASM-SEED-001")
  // while people write full names with spaces — each is matched the way it
  // naturally appears in the file name.
  const rawLower = stripped.toLowerCase().replace(/\s+/g, ' ').trim(); // dashes kept
  const spaced = rawLower.replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
  const normTokens = new Set(spaced.split(' '));

  const scored: MatchCandidate[] = [];
  for (const emp of employees) {
    const code = emp.employeeId.toLowerCase().trim();
    const nameL = emp.fullName.toLowerCase().trim();
    let confidence = 0;

    if (code && (rawLower.includes(code) || normTokens.has(code.replace(/-/g, '')))) {
      confidence = 1.0; // employee code printed in the file name — strongest
    } else if (nameL && spaced.includes(nameL)) {
      confidence = 0.9; // full name appears verbatim
    } else {
      const nameTokens = nameL.split(/\s+/).filter((t) => t.length >= 2);
      if (nameTokens.length >= 2 && nameTokens.every((t) => normTokens.has(t))) {
        confidence = 0.7; // every name token present (order/extra words ignored)
      }
    }
    if (confidence > 0) {
      scored.push({ id: emp.id, fullName: emp.fullName, employeeId: emp.employeeId, confidence });
    }
  }
  scored.sort((a, b) => b.confidence - a.confidence || a.fullName.localeCompare(b.fullName));
  return { employee: scored[0] ?? null, candidates: scored.slice(0, 3) };
}

/** Magic-byte sniffing — same rules as the single-upload route (§5-6). */
function sniffFileError(buffer: Buffer, ext: string): string | null {
  if (buffer.length < 8) return 'The file is too small to be a valid document.';
  const head = buffer.subarray(0, 12);
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isWebp = head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isDoc = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  switch (ext) {
    case '.pdf': return isPdf ? null : 'The file content is not a valid PDF (corrupted or renamed file).';
    case '.jpg':
    case '.jpeg': return isJpeg ? null : 'The file content is not a valid JPG image (corrupted or renamed file).';
    case '.png': return isPng ? null : 'The file content is not a valid PNG image (corrupted or renamed file).';
    case '.webp': return isWebp ? null : 'The file content is not a valid WEBP image (corrupted or renamed file).';
    case '.docx': return isZip ? null : 'The file content is not a valid Word document (corrupted or renamed file).';
    case '.doc': return isDoc || isZip ? null : 'The file content is not a valid Word document (corrupted or renamed file).';
    default: return 'Unsupported file format.';
  }
}

// ── INSPECT (JSON) ──────────────────────────────────────────────────────────

async function handleInspect(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { files?: Array<{ name?: string }> } | null;
  const files = (body?.files || []).map((f) => (f?.name || '').toString()).filter(Boolean).slice(0, MAX_BATCH_FILES);
  if (files.length === 0) {
    return NextResponse.json({ success: false, error: 'files[] with at least one file name is required' }, { status: 400 });
  }

  const employees = await db.employee.findMany({
    where: { deletedAt: null, status: { not: 'deleted' } },
    select: { id: true, fullName: true, employeeId: true },
    orderBy: { fullName: 'asc' },
  });

  const results = files.map((name) => {
    const { employee, candidates } = matchEmployeeInFileName(name, employees);
    return {
      fileName: name,
      docType: detectDocType(name),
      employee, // best suggestion (may be null)
      candidates,
    };
  });

  return NextResponse.json({ success: true, data: { results } });
}

// ── UPLOAD (multipart) ──────────────────────────────────────────────────────

async function handleUpload(request: NextRequest) {
  const form = await request.formData();
  const actorDisplayName = (form.get('actorDisplayName') || '').toString().trim();
  const actorUserId = (form.get('actorUserId') || '').toString().trim();
  const files = form.getAll('files').filter((f): f is File => f instanceof File).slice(0, MAX_BATCH_FILES);
  if (files.length === 0) {
    return NextResponse.json({ success: false, error: 'At least one file is required' }, { status: 400 });
  }

  let mappings: Array<Record<string, unknown> | null> = [];
  try {
    mappings = JSON.parse((form.get('mappings') || '[]').toString());
  } catch {
    return NextResponse.json({ success: false, error: 'mappings must be a JSON array' }, { status: 400 });
  }
  if (!Array.isArray(mappings) || mappings.length !== files.length) {
    return NextResponse.json(
      { success: false, error: `mappings must align with files (${files.length} files, ${mappings.length} mappings)` },
      { status: 400 },
    );
  }

  const results: Array<Record<string, unknown>> = [];
  let created = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const mapping = (mappings[i] || {}) as Record<string, unknown>;
    const fileName = file.name;
    try {
      const employeeId = (mapping.employeeId || '').toString().trim();
      const docType = (mapping.docType || detectDocType(fileName)).toString().trim();

      if (!employeeId) {
        throw new Error('No employee assigned — skip this file or pick an employee first');
      }
      if (!ALLOWED_DOC_TYPES.includes(docType)) {
        throw new Error(`Invalid document type "${docType}"`);
      }
      if (file.size === 0) throw new Error('The file is empty');
      if (file.size > MAX_FILE_BYTES) throw new Error('File exceeds the 20 MB limit');
      const ext = path.extname(fileName).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw new Error(`Unsupported file type "${ext || 'unknown'}"`);
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const contentError = sniffFileError(buffer, ext);
      if (contentError) throw new Error(contentError);

      const employee = await db.employee.findFirst({
        where: { id: employeeId, deletedAt: null },
        select: { id: true, fullName: true, employeeId: true },
      });
      if (!employee) throw new Error('Assigned employee not found');

      const expiryRaw = (mapping.expiryDate || '').toString().trim();
      if (expiryRaw && !/^\d{4}-\d{2}-\d{2}$/.test(expiryRaw)) {
        throw new Error('Expiry date must be in YYYY-MM-DD format');
      }
      const notes = (mapping.notes || '').toString().trim();

      // standardized storage name {DOC_TYPE}_{EMPLOYEE_NAME}.{ext} (PRD §56)
      const dir = ensureStorageDir('employee-documents', employee.id);
      const stdBase = `${docType.toUpperCase()}_${employee.fullName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').toUpperCase()}`;
      const safeName = sanitizeFileName(`${stdBase}${ext || '.pdf'}`);
      const absPath = uniqueFilePath(dir, safeName);
      fs.writeFileSync(absPath, buffer);
      const relativePath = path.relative(process.cwd(), absPath).replace(/\\/g, '/');

      const customName = (mapping.docName || '').toString().trim();
      const doc = await db.employeeDocument.create({
        data: {
          employeeId: employee.id,
          docType,
          docName: customName || path.basename(safeName, ext),
          fileName: path.basename(absPath),
          filePath: relativePath,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          expiryDate: expiryRaw || null,
          notes: notes || null,
          createdBy: actorDisplayName || null,
        },
      });

      created++;
      results.push({ fileName, success: true, docId: doc.id, employeeId: employee.id, employeeName: employee.fullName, docType });

      await logActivity({
        userId: actorUserId || undefined,
        displayName: actorDisplayName || 'Admin',
        action: 'employee_document_batch_upload',
        entityType: 'employee_document',
        entityId: doc.id,
        entityName: doc.docName,
        description: `Batch-uploaded ${docType} document "${doc.docName}" for ${employee.fullName} (${employee.employeeId})`,
        details: { batch: true, docType, fileName: doc.fileName, fileSize: doc.fileSize },
      }).catch(() => undefined);
    } catch (err) {
      failed++;
      results.push({
        fileName,
        success: false,
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }

  return NextResponse.json({
    success: true,
    data: { total: files.length, created, failed, results },
  }, { status: 201 });
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await handleInspect(request);
    }
    if (contentType.includes('multipart/form-data')) {
      return await handleUpload(request);
    }
    return NextResponse.json(
      { success: false, error: 'Send JSON for inspect or multipart/form-data for upload' },
      { status: 400 },
    );
  } catch (error) {
    console.error('POST /api/documents/employee/batch error:', error);
    return NextResponse.json({ success: false, error: 'Batch upload failed' }, { status: 500 });
  }
}
