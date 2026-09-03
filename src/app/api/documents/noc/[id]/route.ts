import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { generateNocPdf, buildNocFileName, monthKeyFromNocDate, type NocEmployeeRow, type StampRectMeta } from '@/lib/noc-pdf';
import { resolveNocAssets } from '@/lib/noc-pdf-server';
import { ensureStorageDir, resolveStoragePath, slugify, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/noc/[id]
//   GET      — single NOC (metadata + employee snapshot + stamp/company names)
//   PATCH    — DRAFT: update fields/employees/currentStep; status:"final"
//              finalizes. FINAL: only the stamp decision is editable after
//              issue — { stampUpdate: true, stampEnabled, stampId } re-renders
//              the ACTIVE rendition while the ORIGINAL as-issued PDF is kept
//              on disk (originalFilePath) for auditability. Any other change
//              to a final → 409 (use /version).
//   DELETE   — delete (draft: hard delete; final: soft delete, PDFs removed)
//   Response contract: { success: true, id } | 404 { success:false,
//   code: "NOC_NOT_FOUND" }
// ---------------------------------------------------------------------------

interface NocPatchPayload {
  clientName?: string;
  projectName?: string;
  clientAddress?: string;
  nocDate?: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  stampType?: string; // legacy
  stampEnabled?: boolean;
  stampId?: string | null;
  companyId?: string | null;
  status?: string; // "draft" | "final"
  stampUpdate?: boolean; // final-NOC stamp-only update
  currentStep?: number; // draft workspace step (exact resume point)
  employees?: Array<Partial<NocEmployeeRow>>;
  actorUserId?: string;
  actorDisplayName?: string;
}

function parseEmployees(raw: unknown): { employees: NocEmployeeRow[]; errors: string[] } {
  const errors: string[] = [];
  const rawRows = Array.isArray(raw) ? raw : [];
  if (rawRows.length > 500) errors.push('A single NOC supports up to 500 employees.');
  const employees: NocEmployeeRow[] = [];
  rawRows.forEach((row, idx) => {
    const name = (row?.name || '').toString().trim().toUpperCase();
    if (!name) {
      errors.push(`Row ${idx + 1}: employee name is required.`);
      return;
    }
    employees.push({
      name,
      trade: (row?.trade || '').toString().trim().toUpperCase(),
      company: (row?.company || '').toString().trim().toUpperCase(),
      nationality: (row?.nationality || '').toString().trim().toUpperCase(),
      passport: (row?.passport || '').toString().trim().toUpperCase(),
    });
  });
  return { employees, errors };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const noc = await db.nocDocument.findUnique({
      where: { id },
      include: {
        stamp: { select: { name: true } },
        company: { select: { id: true, name: true, contactPerson: true, contactPhone: true, contactEmail: true } },
      },
    });
    if (!noc || noc.deletedAt) {
      return NextResponse.json({ success: false, code: 'NOC_NOT_FOUND', error: 'NOC not found' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      data: {
        noc: {
          id: noc.id,
          nocNumber: noc.nocNumber,
          status: noc.status,
          version: noc.version,
          clientName: noc.clientName,
          projectName: noc.projectName,
          clientAddress: noc.clientAddress,
          nocDate: noc.nocDate,
          monthKey: noc.monthKey,
          contactPerson: noc.contactPerson,
          contactPhone: noc.contactPhone,
          contactEmail: noc.contactEmail,
          stampType: noc.stampType,
          stampEnabled: noc.stampEnabled,
          stampId: noc.stampId,
          stampName: noc.stamp?.name ?? null,
          stampAppliedAt: noc.stampAppliedAt,
          stampAppliedBy: noc.stampAppliedBy,
          stampRect: noc.stampRect ? JSON.parse(noc.stampRect) as StampRectMeta : null,
          companyId: noc.companyId,
          company: noc.company,
          employeeCount: noc.employeeCount,
          currentStep: noc.currentStep,
          fileName: noc.fileName,
          filePath: noc.filePath,
          originalFilePath: noc.originalFilePath,
          stampSnapshotPath: noc.stampSnapshotPath,
          createdBy: noc.createdBy,
          createdAt: noc.createdAt,
          updatedAt: noc.updatedAt,
          employees: JSON.parse(noc.employeesJson || '[]') as NocEmployeeRow[],
        },
      },
    });
  } catch (error) {
    console.error('GET /api/documents/noc/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load NOC' }, { status: 500 });
  }
}

/** Render the NOC PDF bytes for a given stamp decision (pure — writes nothing). */
async function renderNocBytes(noc: {
  clientName: string; projectName: string; clientAddress: string; nocDate: string;
  contactPerson: string; contactPhone: string; contactEmail: string;
  stampType: string; stampId: string | null; companyId: string | null;
  employeesJson: string;
}, opts: { stampEnabled: boolean; meta?: { stampRect?: StampRectMeta | null } }): Promise<Buffer> {
  const employees = JSON.parse(noc.employeesJson || '[]') as NocEmployeeRow[];
  const assets = await resolveNocAssets({
    companyId: noc.companyId,
    stampId: noc.stampId,
    stampEnabled: opts.stampEnabled,
    stampType: noc.stampType,
    contactPerson: noc.contactPerson || null,
    contactPhone: noc.contactPhone || null,
    contactEmail: noc.contactEmail || null,
  });
  const pdfBytes = await generateNocPdf({
    clientName: noc.clientName,
    projectName: noc.projectName,
    clientAddress: noc.clientAddress,
    nocDate: noc.nocDate,
    contactPerson: assets.contactPerson,
    contactPhone: assets.contactPhone,
    contactEmail: assets.contactEmail,
    stampType: noc.stampType,
    stampEnabled: assets.stampEnabled,
    stampImagePath: assets.stampImagePath,
    letterheadPath: assets.letterheadPath,
    employees,
    bodyText: assets.bodyText,
    companyName: assets.companyName,
  }, opts.meta);
  return Buffer.from(pdfBytes);
}

const toRel = (abs: string) => path.relative(process.cwd(), abs).replace(/\\/g, '/');

function removeFileQuiet(relPath: string | null | undefined): void {
  if (!relPath) return;
  const abs = resolveStoragePath(relPath);
  if (fs.existsSync(abs)) {
    try { fs.unlinkSync(abs); } catch { /* best effort */ }
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const noc = await db.nocDocument.findUnique({ where: { id } });
    if (!noc || noc.deletedAt) {
      return NextResponse.json({ success: false, code: 'NOC_NOT_FOUND', error: 'NOC not found' }, { status: 404 });
    }

    const body = (await request.json()) as NocPatchPayload;

    /** §32 — a stamp belongs to a company; a mismatched company is rejected.
     *  Legacy rows may carry a companyId that no longer exists (e.g. "1" from
     *  pre-NocCompany data) — such NOCs have NO valid company restriction and
     *  behave like companyId=null (any stamp allowed). */
    const validateStampForCompany = async (stampId: string | null | undefined, nocCompanyId: string | null): Promise<string | null> => {
      if (!stampId) return null;
      const stamp = await db.stamp.findFirst({ where: { id: stampId, deletedAt: null } });
      if (!stamp) return 'The selected stamp no longer exists.';
      if (nocCompanyId && stamp.companyId && stamp.companyId !== nocCompanyId) {
        const nocCompanyExists = await db.nocCompany.findFirst({ where: { id: nocCompanyId, deletedAt: null }, select: { id: true } });
        if (nocCompanyExists) return 'INVALID_STAMP_FOR_COMPANY';
      }
      return null;
    };

    // ── FINAL NOC: stamp-only update (toggle stamp / choose which stamp) ──
    // SNAPSHOT MODEL: the stored PDF (filePath) is ALWAYS the unstamped
    // as-issued original — switching or removing a stamp only updates the
    // decision in the database and NEVER writes a stamped copy. The stamped
    // version is rendered on the fly for preview/print/download, and a
    // snapshot is captured only when a stamped PDF is actually downloaded.
    // Legacy rows whose filePath still points at a stamped rendition are
    // normalized here (the preserved original is restored as the base).
    if (noc.status === 'final' && body.stampUpdate === true) {
      const stampEnabled = body.stampEnabled === true;
      if (stampEnabled && body.stampId) {
        const stampError = await validateStampForCompany(body.stampId, noc.companyId);
        if (stampError === 'INVALID_STAMP_FOR_COMPANY') {
          return NextResponse.json({ success: false, code: 'INVALID_STAMP_FOR_COMPANY', error: 'This stamp belongs to a different company than the NOC.' }, { status: 400 });
        }
        if (stampError) {
          return NextResponse.json({ success: false, error: stampError }, { status: 400 });
        }
      }

      const plainName = buildNocFileName({ clientName: noc.clientName, projectName: noc.projectName, nocDate: noc.nocDate });
      const dir = ensureStorageDir('noc', slugify(noc.clientName), noc.monthKey);

      // Resolve the unstamped base PDF — the one file that must stay on disk.
      let baseRel: string | null = null;
      if (noc.originalFilePath && fs.existsSync(resolveStoragePath(noc.originalFilePath))) {
        baseRel = noc.originalFilePath;
      } else if (noc.filePath && fs.existsSync(resolveStoragePath(noc.filePath))) {
        const looksStamped = noc.stampEnabled && noc.fileName.includes('(stamped)');
        if (!looksStamped) baseRel = noc.filePath;
      }
      if (!baseRel) {
        // no usable base on disk — regenerate the unstamped letter
        const plainBytes = await renderNocBytes(noc, { stampEnabled: false });
        const plainAbs = uniqueFilePath(dir, plainName);
        fs.writeFileSync(plainAbs, plainBytes);
        baseRel = toRel(plainAbs);
      }
      // a legacy stamped rendition is replaceable — remove it (never the base)
      if (noc.filePath && noc.filePath !== baseRel) removeFileQuiet(noc.filePath);

      const data: Record<string, unknown> = {
        stampEnabled,
        stampId: stampEnabled ? body.stampId || null : null,
        // keep legacy column consistent with the decision
        stampType: stampEnabled ? (noc.stampType === 'none' ? 'procurement' : noc.stampType) : 'none',
        filePath: baseRel,
        fileName: path.basename(baseRel),
        originalFilePath: baseRel,
      };

      if (stampEnabled) {
        // Pure in-memory render with the NEW decision — validates the stamp
        // image (§28: a corrupt image must never silently "apply") and
        // captures WHERE the stamp lands for the placement animation. No file
        // is written here; the snapshot is captured at DOWNLOAD time.
        const stampedMeta: { stampRect?: StampRectMeta | null } = {};
        try {
          await renderNocBytes(
            { ...noc, stampId: body.stampId || null },
            { stampEnabled: true, meta: stampedMeta },
          );
        } catch (renderError) {
          console.error('stamp validation render failed:', renderError);
          return NextResponse.json(
            { success: false, error: 'The stamp image file could not be read — re-upload the stamp in NOC Settings, then try again.' },
            { status: 400 },
          );
        }
        data.stampRect = stampedMeta.stampRect ? JSON.stringify(stampedMeta.stampRect) : (noc.stampRect ?? null);
        data.stampAppliedAt = new Date();
        data.stampAppliedBy = body.actorDisplayName || 'Admin';
      } else {
        data.stampRect = null;
        data.stampAppliedAt = null;
        data.stampAppliedBy = null;
      }
      // A stamp change invalidates any previously downloaded stamped snapshot
      // — "no copy of the old stamped one" is kept after switching.
      if (noc.stampSnapshotPath) {
        removeFileQuiet(noc.stampSnapshotPath);
        data.stampSnapshotPath = null;
      }

      const updated = await db.nocDocument.update({ where: { id }, data });
      await logActivity({
        userId: body.actorUserId,
        displayName: body.actorDisplayName || 'Admin',
        action: 'noc_stamp_update',
        entityType: 'noc_document',
        entityId: noc.id,
        entityName: noc.nocNumber,
        description: `${stampEnabled ? 'Applied' : 'Removed'} stamp on final NOC ${noc.nocNumber} (v${noc.version}) — stored PDF stays unstamped`,
      }).catch(() => undefined);
      return NextResponse.json({ success: true, data: { noc: updated } });
    }

    if (noc.status === 'final') {
      return NextResponse.json(
        { success: false, error: 'This NOC is finalized. Use "Edit" to create a new version instead of overwriting the issued document.' },
        { status: 409 },
      );
    }

    // ── DRAFT update ──
    const targetStatus = body.status === 'final' ? 'final' : 'draft';
    // When employees are omitted (e.g. status-only PATCH), keep the stored snapshot
    const employeesForUpdate: NocEmployeeRow[] = body.employees === undefined
      ? (JSON.parse(noc.employeesJson || '[]') as NocEmployeeRow[])
      : parseEmployees(body.employees).employees;
    const employeeErrors = body.employees === undefined ? [] : parseEmployees(body.employees).errors;
    const employees = employeesForUpdate;
    const clientName = (body.clientName ?? noc.clientName).trim().toUpperCase();
    const nocDate = (body.nocDate ?? noc.nocDate).trim();

    // stamps are opt-in; legacy stampType kept in sync for old readers
    const legacyFromType = body.stampEnabled === undefined && body.stampType !== undefined && body.stampType !== 'none';
    const stampEnabled = body.stampEnabled ?? legacyFromType ?? noc.stampEnabled;
    const stampType = stampEnabled ? ((body.stampType ?? noc.stampType) === 'none' ? 'procurement' : (body.stampType ?? noc.stampType)) : 'none';
    const companyId = body.companyId !== undefined ? (body.companyId || null) : noc.companyId;

    if (companyId) {
      const company = await db.nocCompany.findFirst({ where: { id: companyId, deletedAt: null } });
      if (!company) return NextResponse.json({ success: false, error: 'The selected company no longer exists.' }, { status: 400 });
    }
    if (stampEnabled && body.stampId) {
      const stampError = await validateStampForCompany(body.stampId, companyId ?? noc.companyId);
      if (stampError === 'INVALID_STAMP_FOR_COMPANY') {
        return NextResponse.json({ success: false, code: 'INVALID_STAMP_FOR_COMPANY', error: 'This stamp belongs to a different company than the NOC.' }, { status: 400 });
      }
      if (stampError) return NextResponse.json({ success: false, error: stampError }, { status: 400 });
    }

    const data: Record<string, unknown> = {
      clientName,
      projectName: (body.projectName ?? noc.projectName).trim().toUpperCase(),
      clientAddress: (body.clientAddress ?? noc.clientAddress).trim(),
      nocDate,
      monthKey: nocDate ? monthKeyFromNocDate(nocDate) : noc.monthKey,
      contactPerson: (body.contactPerson ?? noc.contactPerson).trim(),
      contactPhone: (body.contactPhone ?? noc.contactPhone).trim(),
      contactEmail: (body.contactEmail ?? noc.contactEmail).trim(),
      stampType,
      stampEnabled,
      stampId: stampEnabled ? (body.stampId !== undefined ? body.stampId || null : noc.stampId) : null,
      companyId,
      employeesJson: JSON.stringify(employees),
      employeeCount: employees.length,
      // exact resume point (§28) — only meaningful while the NOC is a draft
      currentStep: Math.min(Math.max(Math.round(body.currentStep ?? noc.currentStep) || 1, 1), 3),
    };

    if (targetStatus === 'final') {
      const errors: string[] = [];
      if (clientName.length < 2) errors.push('Client name is required (min 2 characters).');
      if (!/^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})$/.test(nocDate)) errors.push('Date must be in DD-MM-YYYY format.');
      if (!['procurement', 'signature', 'none'].includes(stampType)) errors.push('Invalid stamp selection.');
      if (employees.length === 0) errors.push('Add at least one employee to the NOC.');
      if (employeeErrors.length > 0) errors.push(...employeeErrors);
      if (errors.length > 0) {
        return NextResponse.json({ success: false, error: errors.join(' ') }, { status: 400 });
      }

      // Finalize — write ONLY the ORIGINAL as-issued PDF (always unstamped;
      // the stored PDF is never stamped on disk). When a stamp is enabled it
      // is validated with a pure in-memory render (which also captures the
      // stamp placement for the animation) — the stamped output itself is
      // rendered on the fly at preview/download time and snapshotted on
      // download.
      const nocLike = {
        clientName,
        projectName: data.projectName as string,
        clientAddress: data.clientAddress as string,
        nocDate,
        contactPerson: data.contactPerson as string,
        contactPhone: data.contactPhone as string,
        contactEmail: data.contactEmail as string,
        stampType,
        stampId: data.stampId as string | null,
        companyId,
        employeesJson: data.employeesJson as string,
      };
      const plainName = buildNocFileName({ clientName, projectName: nocLike.projectName, nocDate });
      const dir = ensureStorageDir('noc', slugify(clientName), data.monthKey as string);

      const plainBytes = await renderNocBytes(nocLike, { stampEnabled: false });
      const plainAbs = uniqueFilePath(dir, plainName);
      fs.writeFileSync(plainAbs, plainBytes);

      let stampRectJson: string | null = null;
      if (stampEnabled) {
        const stampedMeta: { stampRect?: StampRectMeta | null } = {};
        try {
          await renderNocBytes(nocLike, { stampEnabled: true, meta: stampedMeta });
        } catch (renderError) {
          console.error('stamp validation render failed:', renderError);
          return NextResponse.json(
            { success: false, error: 'The stamp image file could not be read — finalize without the stamp or re-upload it in NOC Settings.' },
            { status: 400 },
          );
        }
        if (stampedMeta.stampRect) stampRectJson = JSON.stringify(stampedMeta.stampRect);
      }
      // a draft never had files, but clean up defensively (legacy rows)
      if (noc.filePath && noc.filePath !== toRel(plainAbs)) removeFileQuiet(noc.filePath);

      data.status = 'final';
      data.fileName = path.basename(plainAbs);
      data.filePath = toRel(plainAbs);
      data.originalFilePath = toRel(plainAbs);
      data.stampRect = stampRectJson;
      data.stampAppliedAt = stampEnabled ? new Date() : null;
      data.stampAppliedBy = stampEnabled ? (body.actorDisplayName || 'Admin') : null;
    } else {
      if (employeeErrors.length > 0) {
        return NextResponse.json({ success: false, error: employeeErrors.join(' ') }, { status: 400 });
      }
      data.status = 'draft';
    }

    const updated = await db.nocDocument.update({ where: { id }, data });

    await logActivity({
      userId: body.actorUserId,
      displayName: body.actorDisplayName || 'Admin',
      action: targetStatus === 'final' ? 'noc_finalize' : 'noc_draft_update',
      entityType: 'noc_document',
      entityId: noc.id,
      entityName: noc.nocNumber,
      description:
        targetStatus === 'final'
          ? `Finalized NOC ${noc.nocNumber} (v${noc.version}) — ${employees.length} employees`
          : `Updated draft ${noc.nocNumber}`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { noc: updated } });
  } catch (error) {
    console.error('PATCH /api/documents/noc/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update NOC' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const noc = await db.nocDocument.findUnique({ where: { id } });
    if (!noc || noc.deletedAt) {
      return NextResponse.json({ success: false, code: 'NOC_NOT_FOUND', error: 'NOC not found' }, { status: 404 });
    }

    if (noc.status === 'draft') {
      // Drafts are working data — hard delete keeps the drafts list clean.
      await db.nocDocument.delete({ where: { id } });
    } else {
      await db.nocDocument.update({ where: { id }, data: { deletedAt: new Date() } });
      // remove every stored rendition (base + legacy original + download snapshot)
      removeFileQuiet(noc.filePath);
      if (noc.originalFilePath && noc.originalFilePath !== noc.filePath) removeFileQuiet(noc.originalFilePath);
      if (noc.stampSnapshotPath) removeFileQuiet(noc.stampSnapshotPath);
    }

    const actorDisplayName = request.nextUrl.searchParams.get('actorDisplayName') || 'Admin';
    const actorUserId = request.nextUrl.searchParams.get('actorUserId') || undefined;
    await logActivity({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'noc_delete',
      entityType: 'noc_document',
      entityId: noc.id,
      entityName: noc.nocNumber,
      description: `Deleted ${noc.status} NOC ${noc.nocNumber} (v${noc.version})`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, id: noc.id });
  } catch (error) {
    console.error('DELETE /api/documents/noc/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete NOC' }, { status: 500 });
  }
}
