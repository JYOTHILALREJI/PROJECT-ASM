import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { generateNocPdf, buildNocFileName, monthKeyFromNocDate, type NocEmployeeRow } from '@/lib/noc-pdf';
import { resolveNocAssets } from '@/lib/noc-pdf-server';
import { ensureStorageDir, resolveStoragePath, slugify, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/noc/[id]
//   GET      — single NOC (metadata + employee snapshot + stamp/company names)
//   PATCH    — DRAFT: update fields/employees; status:"final" finalizes.
//              FINAL: only the stamp decision is editable after issue —
//              { stampUpdate: true, stampEnabled, stampId } re-renders the
//              stored PDF in place (toggle a stamp / switch which stamp is
//              used). Any other change to a final → 409 (use /version).
//   DELETE   — delete (draft: hard delete; final: soft delete, PDF removed)
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
      return NextResponse.json({ success: false, error: 'NOC not found' }, { status: 404 });
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
          companyId: noc.companyId,
          company: noc.company,
          employeeCount: noc.employeeCount,
          fileName: noc.fileName,
          filePath: noc.filePath,
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

/** Re-render a final NOC's PDF with the current record + stamp choice. */
async function regenerateFinalPdf(noc: {
  id: string; clientName: string; projectName: string; clientAddress: string; nocDate: string;
  monthKey: string; contactPerson: string; contactPhone: string; contactEmail: string;
  stampType: string; stampEnabled: boolean; stampId: string | null; companyId: string | null;
  employeesJson: string; filePath: string | null; fileName: string;
}): Promise<{ fileName: string; filePath: string | null }> {
  const employees = JSON.parse(noc.employeesJson || '[]') as NocEmployeeRow[];
  const assets = await resolveNocAssets({
    companyId: noc.companyId,
    stampId: noc.stampId,
    stampEnabled: noc.stampEnabled,
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
  });
  const dir = ensureStorageDir('noc', slugify(noc.clientName), noc.monthKey);
  const fileName = buildNocFileName({ clientName: noc.clientName, projectName: noc.projectName, nocDate: noc.nocDate });
  const absPath = uniqueFilePath(dir, fileName);
  fs.writeFileSync(absPath, pdfBytes);
  return {
    fileName: path.basename(absPath),
    filePath: path.relative(process.cwd(), absPath).replace(/\\/g, '/'),
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const noc = await db.nocDocument.findUnique({ where: { id } });
    if (!noc || noc.deletedAt) {
      return NextResponse.json({ success: false, error: 'NOC not found' }, { status: 404 });
    }

    const body = (await request.json()) as NocPatchPayload;

    // ── FINAL NOC: stamp-only update (toggle stamp / choose which stamp) ──
    if (noc.status === 'final' && body.stampUpdate === true) {
      const stampEnabled = body.stampEnabled === true;
      if (stampEnabled && body.stampId) {
        const stamp = await db.stamp.findFirst({ where: { id: body.stampId, deletedAt: null } });
        if (!stamp) {
          return NextResponse.json({ success: false, error: 'The selected stamp no longer exists.' }, { status: 400 });
        }
      }
      const data: Record<string, unknown> = {
        stampEnabled,
        stampId: stampEnabled ? body.stampId || null : null,
        // keep legacy column consistent with the decision
        stampType: stampEnabled ? (body.stampId ? noc.stampType === 'none' ? 'procurement' : noc.stampType : noc.stampType === 'none' ? 'procurement' : noc.stampType) : 'none',
      };
      const regenerated = await regenerateFinalPdf({ ...noc, ...data } as typeof noc);
      if (noc.filePath) {
        const oldAbs = resolveStoragePath(noc.filePath);
        if (fs.existsSync(oldAbs) && (!regenerated.filePath || oldAbs !== resolveStoragePath(regenerated.filePath))) {
          try { fs.unlinkSync(oldAbs); } catch { /* best effort */ }
        }
      }
      data.fileName = regenerated.fileName;
      data.filePath = regenerated.filePath;
      const updated = await db.nocDocument.update({ where: { id }, data });
      await logActivity({
        userId: body.actorUserId,
        displayName: body.actorDisplayName || 'Admin',
        action: 'noc_stamp_update',
        entityType: 'noc_document',
        entityId: noc.id,
        entityName: noc.nocNumber,
        description: `${stampEnabled ? 'Applied' : 'Removed'} stamp on final NOC ${noc.nocNumber} (v${noc.version}) — PDF re-rendered`,
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
      const stamp = await db.stamp.findFirst({ where: { id: body.stampId, deletedAt: null } });
      if (!stamp) return NextResponse.json({ success: false, error: 'The selected stamp no longer exists.' }, { status: 400 });
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

      const regenerated = await regenerateFinalPdf({
        ...noc,
        clientName,
        projectName: data.projectName as string,
        clientAddress: data.clientAddress as string,
        nocDate,
        monthKey: data.monthKey as string,
        contactPerson: data.contactPerson as string,
        contactPhone: data.contactPhone as string,
        contactEmail: data.contactEmail as string,
        stampType,
        stampEnabled,
        stampId: data.stampId as string | null,
        companyId,
        employeesJson: data.employeesJson as string,
      } as typeof noc);
      if (noc.filePath) {
        const oldAbs = resolveStoragePath(noc.filePath);
        if (fs.existsSync(oldAbs) && (!regenerated.filePath || oldAbs !== resolveStoragePath(regenerated.filePath))) {
          try { fs.unlinkSync(oldAbs); } catch { /* best effort */ }
        }
      }
      data.status = 'final';
      data.fileName = regenerated.fileName;
      data.filePath = regenerated.filePath;
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
      return NextResponse.json({ success: false, error: 'NOC not found' }, { status: 404 });
    }

    if (noc.status === 'draft') {
      // Drafts are working data — hard delete keeps the drafts list clean.
      await db.nocDocument.delete({ where: { id } });
    } else {
      await db.nocDocument.update({ where: { id }, data: { deletedAt: new Date() } });
      if (noc.filePath) {
        const abs = resolveStoragePath(noc.filePath);
        if (fs.existsSync(abs)) {
          try {
            fs.unlinkSync(abs);
          } catch {
            // best effort
          }
        }
      }
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/documents/noc/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete NOC' }, { status: 500 });
  }
}
