import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { generateNocPdf, buildNocFileName, monthKeyFromNocDate, type NocEmployeeRow } from '@/lib/noc-pdf';
import { resolveNocAssets } from '@/lib/noc-pdf-server';
import { ensureStorageDir, slugify, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/noc
//   GET  — paginated views (strict pagination: NOC archives grow unbounded):
//            ?view=stats                          dashboard counters
//            ?view=recent&limit=6                 latest final NOCs (light rows)
//            ?view=list&page=1&pageSize=20
//                 &search=&status=&year=          paginated light rows
//            ?view=folders                        client → year → month + counts
//            ?view=month&client=X&month=YYYY-MM
//                 &page=1&pageSize=50             one client-month, paginated
//          Light rows NEVER include employeesJson (the heavy column).
//   POST — create a NOC.
//          status "draft": metadata only (auto-save / manual save), no PDF.
//          status "final": full validation, PDF generated + stored.
//          Company / stamp: companyId, stampEnabled (default false — stamps
//          are opt-in), stampId (required only when stampEnabled).
// ---------------------------------------------------------------------------

interface NocPayload {
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
  employees?: Array<Partial<NocEmployeeRow>>;
  actorUserId?: string;
  actorDisplayName?: string;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

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

async function validateStampSelection(stampEnabled: boolean, stampId: string | null | undefined): Promise<string[]> {
  if (!stampEnabled) return [];
  if (!stampId) return []; // no explicit stamp chosen → legacy built-in will be used
  const stamp = await db.stamp.findFirst({ where: { id: stampId, deletedAt: null } });
  return stamp ? [] : ['The selected stamp no longer exists — pick another stamp or switch the stamp off.'];
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

/** Light row shape — everything the lists need, none of the heavy columns. */
function lightRow(r: {
  id: string; nocNumber: string; status: string; version: number; clientName: string;
  projectName: string; nocDate: string; monthKey: string; employeeCount: number;
  fileName: string; createdBy: string | null; stampEnabled: boolean; stampId: string | null;
  companyId: string | null; createdAt: Date; updatedAt: Date;
}, stampName: string | null = null, companyName: string | null = null) {
  return {
    id: r.id,
    nocNumber: r.nocNumber,
    status: r.status,
    version: r.version,
    clientName: r.clientName,
    projectName: r.projectName,
    nocDate: r.nocDate,
    monthKey: r.monthKey,
    employeeCount: r.employeeCount,
    fileName: r.fileName,
    createdBy: r.createdBy,
    stampEnabled: r.stampEnabled,
    stampId: r.stampId,
    stampName,
    companyId: r.companyId,
    companyName,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const LIST_SELECT = {
  id: true, nocNumber: true, status: true, version: true, clientName: true,
  projectName: true, nocDate: true, monthKey: true, employeeCount: true,
  fileName: true, createdBy: true, stampEnabled: true, stampId: true,
  companyId: true, createdAt: true, updatedAt: true,
} as const;

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const view = sp.get('view') || 'list';

    // ── dashboard counters ──
    if (view === 'stats') {
      const now = new Date();
      const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const [totalFinal, thisMonth, drafts, employeesWithDocuments] = await Promise.all([
        db.nocDocument.count({ where: { status: 'final', deletedAt: null } }),
        db.nocDocument.count({ where: { status: 'final', deletedAt: null, monthKey: nowKey } }),
        db.nocDocument.count({ where: { status: 'draft', deletedAt: null } }),
        db.employeeDocument.findMany({ where: { deletedAt: null }, select: { employeeId: true }, distinct: ['employeeId'] }),
      ]);
      return NextResponse.json({
        success: true,
        data: {
          totalFinal,
          thisMonth,
          drafts,
          employeesWithDocuments: employeesWithDocuments.length,
        },
      });
    }

    // ── recent final NOCs for the dashboard ──
    if (view === 'recent') {
      const limit = Math.min(parseInt(sp.get('limit') || '6', 10) || 6, 20);
      const rows = await db.nocDocument.findMany({
        where: { status: 'final', deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        select: LIST_SELECT,
        take: limit,
      });
      return NextResponse.json({ success: true, data: { nocs: rows.map((r) => lightRow(r)) } });
    }

    // ── client → year → month folder meta (counts only — light) ──
    if (view === 'folders') {
      const rows = await db.nocDocument.findMany({
        where: { status: 'final', deletedAt: null },
        select: { clientName: true, monthKey: true },
        orderBy: { clientName: 'asc' },
      });
      const clients = new Map<string, Map<string, Map<string, number>>>();
      for (const r of rows) {
        const year = (r.monthKey || '----').split('-')[0];
        if (!clients.has(r.clientName)) clients.set(r.clientName, new Map());
        const years = clients.get(r.clientName)!;
        if (!years.has(year)) years.set(year, new Map());
        const months = years.get(year)!;
        months.set(r.monthKey, (months.get(r.monthKey) || 0) + 1);
      }
      const grouped = [...clients.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([clientName, years]) => ({
          clientName,
          total: [...years.values()].reduce((n, months) => n + [...months.values()].reduce((m, c) => m + c, 0), 0),
          years: [...years.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([year, months]) => ({
              year,
              months: [...months.entries()]
                .sort((a, b) => b[0].localeCompare(a[0]))
                .map(([monthKey, count]) => ({ monthKey, count })),
            })),
        }));
      return NextResponse.json({ success: true, data: { clients: grouped } });
    }

    // ── one client-month with strict pagination ──
    if (view === 'month') {
      const client = (sp.get('client') || '').trim();
      const month = (sp.get('month') || '').trim();
      if (!client || !month) {
        return NextResponse.json({ success: false, error: 'client and month are required' }, { status: 400 });
      }
      const page = Math.max(parseInt(sp.get('page') || '1', 10) || 1, 1);
      const pageSize = Math.min(Math.max(parseInt(sp.get('pageSize') || '50', 10) || 50, 1), MAX_PAGE_SIZE);
      const where = { status: 'final', deletedAt: null, clientName: client, monthKey: month };
      const [total, rows] = await Promise.all([
        db.nocDocument.count({ where }),
        db.nocDocument.findMany({
          where,
          orderBy: { nocDate: 'desc' },
          select: { ...LIST_SELECT, stamp: { select: { name: true } }, company: { select: { name: true } } },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return NextResponse.json({
        success: true,
        data: {
          nocs: rows.map((r) => lightRow(r, r.stamp?.name ?? null, r.company?.name ?? null)),
          total,
          page,
          pageSize,
          totalPages: Math.max(Math.ceil(total / pageSize), 1),
        },
      });
    }

    // ── default: paginated, searchable list (drafts + finals) ──
    const page = Math.max(parseInt(sp.get('page') || '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(sp.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const search = (sp.get('search') || '').trim();
    const status = (sp.get('status') || 'all').trim();
    const year = (sp.get('year') || 'all').trim();

    const where: Record<string, unknown> = { deletedAt: null };
    if (status === 'final' || status === 'draft') where.status = status;
    if (year !== 'all' && /^\d{4}$/.test(year)) where.monthKey = { startsWith: year };
    if (search) {
      where.OR = [
        { nocNumber: { contains: search } },
        { clientName: { contains: search } },
        { projectName: { contains: search } },
        { nocDate: { contains: search } },
        { createdBy: { contains: search } },
        { employeesJson: { contains: search } },
      ];
    }

    const [total, rows] = await Promise.all([
      db.nocDocument.count({ where }),
      db.nocDocument.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        select: { ...LIST_SELECT, stamp: { select: { name: true } }, company: { select: { name: true } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        nocs: rows.map((r) => lightRow(r, r.stamp?.name ?? null, r.company?.name ?? null)),
        total,
        page,
        pageSize,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
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

    // stamps are opt-in: default OFF unless the legacy stampType says otherwise
    const legacyFromType = body.stampEnabled === undefined && (body.stampType || 'procurement') !== 'none';
    const stampEnabled = body.stampEnabled ?? legacyFromType;
    const companyId = body.companyId || null;

    if (status === 'final') {
      const errors = [...validateForFinal(body, employees), ...employeeErrors, ...(await validateStampSelection(stampEnabled, body.stampId))];
      if (companyId) {
        const company = await db.nocCompany.findFirst({ where: { id: companyId, deletedAt: null } });
        if (!company) errors.push('The selected company no longer exists.');
      }
      if (errors.length > 0) {
        return NextResponse.json({ success: false, error: errors.join(' ') }, { status: 400 });
      }
    } else {
      if (employeeErrors.length > 0) {
        // drafts tolerate incomplete data but never unnamed rows
        return NextResponse.json({ success: false, error: employeeErrors.join(' ') }, { status: 400 });
      }
      if (companyId) {
        const company = await db.nocCompany.findFirst({ where: { id: companyId, deletedAt: null } });
        if (!company) return NextResponse.json({ success: false, error: 'The selected company no longer exists.' }, { status: 400 });
      }
    }

    const clientName = (body.clientName || '').trim().toUpperCase();
    const nocDate = (body.nocDate || '').trim();
    const monthKey = nocDate ? monthKeyFromNocDate(nocDate) : '';
    const stampType = stampEnabled ? (body.stampType || 'procurement') : 'none';
    const nocNumber = await nextNocNumber();

    const recordData: Record<string, unknown> = {
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
      stampEnabled,
      stampId: stampEnabled ? body.stampId || null : null,
      companyId,
      employeesJson: JSON.stringify(employees),
      employeeCount: employees.length,
      fileName: '',
      filePath: null as string | null,
      createdBy: body.actorDisplayName || null,
    };

    if (status === 'final') {
      const assets = await resolveNocAssets({
        companyId,
        stampId: body.stampId,
        stampEnabled,
        stampType,
        contactPerson: (body.contactPerson || '').trim() || null,
        contactPhone: (body.contactPhone || '').trim() || null,
        contactEmail: (body.contactEmail || '').trim() || null,
      });
      const pdfBytes = await generateNocPdf({
        clientName,
        projectName: recordData.projectName as string,
        clientAddress: recordData.clientAddress as string,
        nocDate,
        contactPerson: assets.contactPerson,
        contactPhone: assets.contactPhone,
        contactEmail: assets.contactEmail,
        stampType,
        stampEnabled: assets.stampEnabled,
        stampImagePath: assets.stampImagePath,
        letterheadPath: assets.letterheadPath,
        employees,
        bodyText: assets.bodyText,
        companyName: assets.companyName,
      });
      const dir = ensureStorageDir('noc', slugify(clientName), monthKey);
      const fileName = buildNocFileName({ clientName, projectName: recordData.projectName as string, nocDate });
      const absPath = uniqueFilePath(dir, fileName);
      fs.writeFileSync(absPath, pdfBytes);
      recordData.fileName = path.basename(absPath);
      recordData.filePath = path.relative(process.cwd(), absPath).replace(/\\/g, '/');
    }

    const noc = await db.nocDocument.create({ data: recordData as Prisma.NocDocumentUncheckedCreateInput });

    await logActivity({
      userId: body.actorUserId,
      displayName: body.actorDisplayName || 'Admin',
      action: status === 'final' ? 'noc_create' : 'noc_draft_save',
      entityType: 'noc_document',
      entityId: noc.id,
      entityName: noc.nocNumber,
      description:
        status === 'final'
          ? `Created NOC ${noc.nocNumber} for ${clientName} — ${(recordData.projectName as string) || 'no project'} (${employees.length} employees, dated ${nocDate})`
          : `Saved draft ${noc.nocNumber} (${clientName || 'untitled'})`,
      details: { clientName, projectName: recordData.projectName, nocDate, monthKey, employeeCount: employees.length, status, stampEnabled },
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { noc } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/documents/noc error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create NOC' }, { status: 500 });
  }
}
