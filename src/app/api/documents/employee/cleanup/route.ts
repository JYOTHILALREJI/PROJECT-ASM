import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { resolveStoragePath } from '@/lib/document-storage';
import fs from 'fs';

// ---------------------------------------------------------------------------
// /api/documents/employee/cleanup — storage hygiene for the document
// repository (PRD §13-14, §52, §64).
//
//   POST { action: "report" } → dry run: what WOULD be marked/removed
//   POST { action: "clean"  } → perform:
//       · older duplicates (same employee + docType, not the newest ACTIVE)
//         are marked status = REPLACED (kept on disk — audit-safe)
//       · records whose physical file is missing are marked INVALID
//       · soft-deleted records (deletedAt set) get their files removed and
//         rows hard-deleted
//     Historical NOCs are NEVER affected: finalized NOCs store their own
//     employee snapshots and PDFs, they do not reference these files.
// ---------------------------------------------------------------------------

interface CleanupCandidate {
  id: string;
  employeeName: string;
  docType: string;
  docName: string;
  fileName: string;
  filePath: string;
  createdAt: Date;
  reason: string;
}

async function collectCandidates() {
  const docs = await db.employeeDocument.findMany({
    where: { deletedAt: null },
    orderBy: [{ employeeId: 'asc' }, { docType: 'asc' }, { createdAt: 'desc' }],
    include: { employee: { select: { fullName: true } } },
  });
  return docs;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: 'report' | 'clean';
      actorDisplayName?: string;
      actorUserId?: string;
    };
    const action = body.action === 'clean' ? 'clean' : 'report';

    const docs = await collectCandidates();

    // group by (employee, docType) — newest is protected, older become REPLACED
    const seen = new Set<string>();
    const replaced: CleanupCandidate[] = [];
    const invalid: CleanupCandidate[] = [];
    const orphanFiles: CleanupCandidate[] = []; // soft-deleted rows whose files still exist

    for (const d of docs) {
      const key = `${d.employeeId}::${d.docType}`;
      if (!seen.has(key)) seen.add(key); // newest valid-ish record per group is kept ACTIVE
      else if (d.status === 'ACTIVE') replaced.push({ id: d.id, employeeName: d.employee.fullName, docType: d.docType, docName: d.docName, fileName: d.fileName, filePath: d.filePath, createdAt: d.createdAt, reason: 'Older duplicate of the same document category' });
      else if (d.status === 'REPLACED' || d.status === 'INVALID') replaced.push({ id: d.id, employeeName: d.employee.fullName, docType: d.docType, docName: d.docName, fileName: d.fileName, filePath: d.filePath, createdAt: d.createdAt, reason: `Already marked ${d.status}` });
    }
    for (const d of docs) {
      if (d.status === 'ACTIVE') {
        const abs = resolveStoragePath(d.filePath);
        if (!fs.existsSync(abs) || fs.statSync(abs).size === 0) {
          invalid.push({ id: d.id, employeeName: d.employee.fullName, docType: d.docType, docName: d.docName, fileName: d.fileName, filePath: d.filePath, createdAt: d.createdAt, reason: 'Physical file is missing or empty' });
        }
      }
    }
    const softDeleted = await db.employeeDocument.findMany({ where: { deletedAt: { not: null } }, include: { employee: { select: { fullName: true } } } });
    for (const d of softDeleted) {
      if (fs.existsSync(resolveStoragePath(d.filePath))) {
        orphanFiles.push({ id: d.id, employeeName: d.employee.fullName, docType: d.docType, docName: d.docName, fileName: d.fileName, filePath: d.filePath, createdAt: d.createdAt, reason: 'Soft-deleted record with a leftover file' });
      }
    }

    if (action === 'report') {
      return NextResponse.json({
        success: true,
        data: {
          action,
          toReplace: replaced.length,
          toInvalidate: invalid.length,
          toPurgeFiles: orphanFiles.length,
          replaced: replaced.map(({ filePath, ...r }) => r),
          invalid: invalid.map(({ filePath, ...r }) => r),
          orphanFiles: orphanFiles.map(({ filePath, ...r }) => r),
        },
      });
    }

    // ── clean ──
    let markedReplaced = 0;
    for (const c of replaced) {
      const res = await db.employeeDocument.updateMany({ where: { id: c.id }, data: { status: 'REPLACED' } });
      markedReplaced += res.count;
    }
    let markedInvalid = 0;
    for (const c of invalid) {
      const res = await db.employeeDocument.updateMany({ where: { id: c.id }, data: { status: 'INVALID' } });
      markedInvalid += res.count;
    }
    let purgedFiles = 0;
    for (const c of orphanFiles) {
      try {
        const abs = resolveStoragePath(c.filePath);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
        purgedFiles += 1;
      } catch { /* best effort */ }
    }
    // hard-delete the soft-deleted rows (they no longer hold files)
    const removedRows = await db.employeeDocument.deleteMany({ where: { deletedAt: { not: null } } });

    await logActivity({
      userId: body.actorUserId,
      displayName: body.actorDisplayName || 'Admin',
      action: 'employee_documents_cleanup',
      entityType: 'employee_document',
      entityId: 'cleanup',
      entityName: 'Documents cleanup',
      description: `Document cleanup: ${markedReplaced} marked REPLACED, ${markedInvalid} marked INVALID, ${purgedFiles} files purged, ${removedRows.count} rows removed`,
    }).catch(() => undefined);

    return NextResponse.json({
      success: true,
      data: { action, markedReplaced, markedInvalid, purgedFiles, removedRows: removedRows.count },
    });
  } catch (error) {
    console.error('POST /api/documents/employee/cleanup error:', error);
    return NextResponse.json({ success: false, error: 'Cleanup failed' }, { status: 500 });
  }
}
