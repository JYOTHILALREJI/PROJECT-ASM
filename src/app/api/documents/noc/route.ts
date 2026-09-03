import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { generateNocPdf, buildNocFileName, monthKeyFromNocDate, type NocEmployeeRow } from '@/lib/noc-pdf';
import { ensureStorageDir, slugify, uniqueFilePath } from '@/lib/document-storage';
import { getNocTemplate } from '@/lib/noc-template';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/noc
//   GET  — list all NOCs (drafts + finals, newest first)
//   POST — create a NOC.
//          status "draft": metadata only (auto-save / manual save), no PDF.
//          status "final": full validation, PDF generated + stored.
// ---------------------------------------------------------------------------

interface NocPayload {
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

/** System-generated sequential NOC number: NOC-YYYY-NNNNNN */
async function nextNocNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `NOC-${year}-`;
  const last = await db.nocDocument.findFirst({
    where: { nocNumber: { startsWith: prefix } },
    orderBy: { nocNumber: 'desc' },
    select: { nocNumber: true },
  });
  const lastNum = last ? parseInt(last.nocNumber.split('-')[2], 10) : 0;
  return `${prefix}${String(lastNum + 1).padStart(6, '0')}`;
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

function validateForFinal(body: NocPayload, employees: NocEmployeeRow[]): string[] {
  const errors: string[] = [];
  if ((body.clientName || '').trim().length < 2) errors.push('Client name is required (min 2 characters).');
  const nocDate = (body.nocDate || '').trim();
  if (!/^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})$/.test(nocDate)) errors.push('Date must be in DD-MM-YYYY format.');
  const stampType = body.stampType || 'procurement';
  if (!['procurement', 'signature', 'none'].includes(stampType)) errors.push('Invalid stamp selection.');
  if (employees.length === 0) errors.push('Add at least one employee to the NOC.');
  return errors;
}

export async function GET() {
  try {
    const rows = await db.nocDocument.findMany({
      orderBy: [{ updatedAt: 'desc' }],
    });
    return NextResponse.json({
      success: true,
      data: {
        nocs: rows.map((r) => ({
          id: r.id,
          nocNumber: r.nocNumber,
          status: r.status,
          version: r.version,
          clientName: r.clientName,
          projectName: r.projectName,
          clientAddress: r.clientAddress,
          nocDate: r.nocDate,
          monthKey: r.monthKey,
          contactPerson: r.contactPerson,
          contactPhone: r.contactPhone,
          contactEmail: r.contactEmail,
          stampType: r.stampType,
          employeeCount: r.employeeCount,
          fileName: r.fileName,
          filePath: r.filePath,
          createdBy: r.createdBy,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          employees: JSON.parse(r.employeesJson || '[]') as NocEmployeeRow[],
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/documents/noc error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load NOCs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as NocPayload;
    const status = body.status === 'final' ? 'final' : 'draft';
    const { employees, errors: employeeErrors } = parseEmployees(body.employees);

    if (status === 'final') {
      const errors = [...validateForFinal(body, employees), ...employeeErrors];
      if (errors.length > 0) {
        return NextResponse.json({ success: false, error: errors.join(' ') }, { status: 400 });
      }
    } else if (employeeErrors.length > 0) {
      // drafts tolerate incomplete data but never unnamed rows
      return NextResponse.json({ success: false, error: employeeErrors.join(' ') }, { status: 400 });
    }

    const clientName = (body.clientName || '').trim().toUpperCase();
    const nocDate = (body.nocDate || '').trim();
    const monthKey = nocDate ? monthKeyFromNocDate(nocDate) : '';
    const stampType = body.stampType || 'procurement';
    const nocNumber = await nextNocNumber();

    const recordData = {
      nocNumber,
      status,
      version: 1,
      clientName,
      projectName: (body.projectName || '').trim().toUpperCase(),
      clientAddress: (body.clientAddress || '').trim(),
      nocDate,
      monthKey,
      contactPerson: (body.contactPerson || '').trim(),
      contactPhone: (body.contactPhone || '').trim(),
      contactEmail: (body.contactEmail || '').trim(),
      stampType,
      employeesJson: JSON.stringify(employees),
      employeeCount: employees.length,
      fileName: '',
      filePath: null as string | null,
      createdBy: body.actorDisplayName || null,
    };

    if (status === 'final') {
      const template = await getNocTemplate();
      const pdfBytes = await generateNocPdf({
        clientName,
        projectName: recordData.projectName,
        clientAddress: recordData.clientAddress,
        nocDate,
        contactPerson: recordData.contactPerson || template.contactPerson,
        contactPhone: recordData.contactPhone || template.contactPhone,
        contactEmail: recordData.contactEmail || template.contactEmail,
        stampType,
        employees,
        bodyText: template.bodyText,
        companyName: template.companyName,
      });
      const dir = ensureStorageDir('noc', slugify(clientName), monthKey);
      const fileName = buildNocFileName({ clientName, projectName: recordData.projectName, nocDate });
      const absPath = uniqueFilePath(dir, fileName);
      fs.writeFileSync(absPath, pdfBytes);
      recordData.fileName = path.basename(absPath);
      recordData.filePath = path.relative(process.cwd(), absPath).replace(/\\/g, '/');
    }

    const noc = await db.nocDocument.create({ data: recordData });

    await logActivity({
      userId: body.actorUserId,
      displayName: body.actorDisplayName || 'Admin',
      action: status === 'final' ? 'noc_create' : 'noc_draft_save',
      entityType: 'noc_document',
      entityId: noc.id,
      entityName: noc.nocNumber,
      description:
        status === 'final'
          ? `Created NOC ${noc.nocNumber} for ${clientName} — ${recordData.projectName || 'no project'} (${employees.length} employees, dated ${nocDate})`
          : `Saved draft ${noc.nocNumber} (${clientName || 'untitled'})`,
      details: { clientName, projectName: recordData.projectName, nocDate, monthKey, employeeCount: employees.length, status },
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { noc } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/documents/noc error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create NOC' }, { status: 500 });
  }
}
