import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { generateNocPdf, buildNocFileName, monthKeyFromNocDate, type NocEmployeeRow } from '@/lib/noc-pdf';
import { ensureStorageDir, slugify, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/noc
//   GET  — list all issued NOCs (newest first)
//   POST — create an NOC: validate payload, generate the PDF with the exact
//          reference layout, store it under storage/noc/<client>/<YYYY-MM>/,
//          and persist metadata + employee snapshot.
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
  employees?: Array<Partial<NocEmployeeRow>>;
  actorUserId?: string;
  actorDisplayName?: string;
}

function validatePayload(body: NocPayload): { errors: string[]; employees: NocEmployeeRow[] } {
  const errors: string[] = [];
  const clientName = (body.clientName || '').trim();
  if (clientName.length < 2) errors.push('Client name is required (min 2 characters).');

  const nocDate = (body.nocDate || '').trim();
  if (!/^(\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})$/.test(nocDate)) {
    errors.push('Date must be in DD-MM-YYYY format.');
  }

  const stampType = body.stampType || 'procurement';
  if (!['procurement', 'signature', 'none'].includes(stampType)) {
    errors.push('Invalid stamp selection.');
  }

  const rawRows = Array.isArray(body.employees) ? body.employees : [];
  if (rawRows.length === 0) errors.push('Add at least one employee to the NOC.');
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

  return { errors, employees };
}

export async function GET() {
  try {
    const rows = await db.nocDocument.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({
      success: true,
      data: {
        nocs: rows.map((r) => ({
          id: r.id,
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
    const { errors, employees } = validatePayload(body);
    if (errors.length > 0) {
      return NextResponse.json({ success: false, error: errors.join(' ') }, { status: 400 });
    }

    const clientName = (body.clientName || '').trim().toUpperCase();
    const nocDate = (body.nocDate || '').trim();
    const monthKey = monthKeyFromNocDate(nocDate);
    const stampType = body.stampType || 'procurement';

    const nocData = {
      clientName,
      projectName: (body.projectName || '').trim().toUpperCase(),
      clientAddress: (body.clientAddress || '').trim(),
      nocDate,
      contactPerson: (body.contactPerson || '').trim(),
      contactPhone: (body.contactPhone || '').trim(),
      contactEmail: (body.contactEmail || '').trim(),
      stampType,
      employees,
    };

    // Generate the PDF bytes with the exact reference layout
    const pdfBytes = await generateNocPdf(nocData);

    // Persist under storage/noc/<CLIENT>/<YYYY-MM>/<file>.pdf
    const dir = ensureStorageDir('noc', slugify(clientName), monthKey);
    const fileName = buildNocFileName(nocData);
    const absPath = uniqueFilePath(dir, fileName);
    fs.writeFileSync(absPath, pdfBytes);
    const relativePath = path.relative(process.cwd(), absPath).replace(/\\/g, '/');

    const noc = await db.nocDocument.create({
      data: {
        clientName,
        projectName: nocData.projectName,
        clientAddress: nocData.clientAddress,
        nocDate,
        monthKey,
        contactPerson: nocData.contactPerson,
        contactPhone: nocData.contactPhone,
        contactEmail: nocData.contactEmail,
        stampType,
        employeesJson: JSON.stringify(employees),
        employeeCount: employees.length,
        fileName: path.basename(absPath),
        filePath: relativePath,
        createdBy: body.actorDisplayName || null,
      },
    });

    await logActivity({
      userId: body.actorUserId,
      displayName: body.actorDisplayName || 'Admin',
      action: 'noc_create',
      entityType: 'noc_document',
      entityId: noc.id,
      entityName: noc.fileName,
      description: `Created NOC for ${clientName} — ${nocData.projectName || 'no project'} (${employees.length} employees, dated ${nocDate})`,
      details: { clientName, projectName: nocData.projectName, nocDate, monthKey, employeeCount: employees.length },
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { noc } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/documents/noc error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create NOC' }, { status: 500 });
  }
}
