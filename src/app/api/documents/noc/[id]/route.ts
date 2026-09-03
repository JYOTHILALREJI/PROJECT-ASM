import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { generateNocPdf, buildNocFileName, monthKeyFromNocDate, type NocEmployeeRow } from '@/lib/noc-pdf';
import { ensureStorageDir, resolveStoragePath, slugify, uniqueFilePath } from '@/lib/document-storage';
import { getNocTemplate } from '@/lib/noc-template';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/noc/[id]
//   GET      — single NOC (metadata + employee snapshot)
//   PATCH    — update a DRAFT (fields/employees); status:"final" generates
//              the PDF and finalizes. FINAL NOCs are immutable here — the UI
//              creates a new version via /version instead.
//   DELETE   — delete (draft: hard delete; final: soft delete, PDF kept)
// ---------------------------------------------------------------------------

interface NocPatchPayload {
  clientName?: string;
  projectName?: string;
  clientAddress?: string;
  nocDate?: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  stampType?: string;
  status?: string; // "draft" | "final"
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
    const noc = await db.nocDocument.findUnique({ where: { id } });
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
    if (noc.status === 'final') {
      return NextResponse.json(
        { success: false, error: 'This NOC is finalized. Use "Edit" to create a new version instead of overwriting the issued document.' },
        { status: 409 },
      );
    }

    const body = (await request.json()) as NocPatchPayload;
    const targetStatus = body.status === 'final' ? 'final' : 'draft';
    // When employees are omitted (e.g. status-only PATCH), keep the stored snapshot
    const employeesForUpdate: NocEmployeeRow[] = body.employees === undefined
      ? (JSON.parse(noc.employeesJson || '[]') as NocEmployeeRow[])
      : parseEmployees(body.employees).employees;
    const employeeErrors = body.employees === undefined ? [] : parseEmployees(body.employees).errors;
    const employees = employeesForUpdate;
    const clientName = (body.clientName ?? noc.clientName).trim().toUpperCase();
    const nocDate = (body.nocDate ?? noc.nocDate).trim();
    const stampType = body.stampType ?? noc.stampType;

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

      const template = await getNocTemplate();
      const pdfBytes = await generateNocPdf({
        clientName,
        projectName: data.projectName as string,
        clientAddress: data.clientAddress as string,
        nocDate,
        contactPerson: (data.contactPerson as string) || template.contactPerson,
        contactPhone: (data.contactPhone as string) || template.contactPhone,
        contactEmail: (data.contactEmail as string) || template.contactEmail,
        stampType,
        employees,
        bodyText: template.bodyText,
        companyName: template.companyName,
      });
      const dir = ensureStorageDir('noc', slugify(clientName), data.monthKey as string);
      const fileName = buildNocFileName({ clientName, projectName: data.projectName as string, nocDate });
      const absPath = uniqueFilePath(dir, fileName);
      fs.writeFileSync(absPath, pdfBytes);
      data.status = 'final';
      data.fileName = path.basename(absPath);
      data.filePath = path.relative(process.cwd(), absPath).replace(/\\/g, '/');
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
