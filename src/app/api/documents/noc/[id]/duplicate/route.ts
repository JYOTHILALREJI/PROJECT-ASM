import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { monthKeyFromNocDate } from '@/lib/noc-pdf';

// ---------------------------------------------------------------------------
// POST /api/documents/noc/[id]/duplicate
//   Duplicates a NOC into a brand-new DRAFT: copies client/project/template/
//   employee selection but assigns a NEW NOC number and TODAY's date
//   (PRD §46 — accelerates recurring client requests).
// ---------------------------------------------------------------------------

function todayDMY(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const noc = await db.nocDocument.findUnique({ where: { id } });
    if (!noc || noc.deletedAt) {
      return NextResponse.json({ success: false, error: 'NOC not found' }, { status: 404 });
    }

    const nocDate = todayDMY();
    const draft = await db.nocDocument.create({
      data: {
        nocNumber: await nextNocNumber(),
        status: 'draft',
        version: 1,
        clientName: noc.clientName,
        projectName: noc.projectName,
        clientAddress: noc.clientAddress,
        nocDate,
        monthKey: monthKeyFromNocDate(nocDate),
        contactPerson: noc.contactPerson,
        contactPhone: noc.contactPhone,
        contactEmail: noc.contactEmail,
        stampType: noc.stampType,
        employeesJson: noc.employeesJson,
        employeeCount: noc.employeeCount,
        fileName: '',
        filePath: null,
        createdBy: request.nextUrl.searchParams.get('actorDisplayName') || noc.createdBy,
      },
    });

    const actorDisplayName = request.nextUrl.searchParams.get('actorDisplayName') || 'Admin';
    await logActivity({
      displayName: actorDisplayName,
      action: 'noc_duplicate',
      entityType: 'noc_document',
      entityId: draft.id,
      entityName: draft.nocNumber,
      description: `Duplicated NOC ${noc.nocNumber} as draft ${draft.nocNumber}`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { noc: draft } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/documents/noc/[id]/duplicate error:', error);
    return NextResponse.json({ success: false, error: 'Failed to duplicate NOC' }, { status: 500 });
  }
}
