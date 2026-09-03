import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';

// ---------------------------------------------------------------------------
// POST /api/documents/noc/[id]/version
//   Creates a NEW DRAFT as the next VERSION of a finalized NOC
//   (same nocNumber, version+1, same data, original PDF retained).
//   Used by the "Edit" action on a FINAL NOC (PRD §45).
// ---------------------------------------------------------------------------

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

    const maxVersion = await db.nocDocument.aggregate({
      where: { nocNumber: noc.nocNumber },
      _max: { version: true },
    });
    const nextVersion = (maxVersion._max.version || 1) + 1;

    const draft = await db.nocDocument.create({
      data: {
        nocNumber: noc.nocNumber,
        status: 'draft',
        version: nextVersion,
        clientName: noc.clientName,
        projectName: noc.projectName,
        clientAddress: noc.clientAddress,
        nocDate: noc.nocDate,
        monthKey: noc.monthKey,
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
      action: 'noc_version_start',
      entityType: 'noc_document',
      entityId: draft.id,
      entityName: noc.nocNumber,
      description: `Started version ${nextVersion} of NOC ${noc.nocNumber} (draft)`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { noc: draft } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/documents/noc/[id]/version error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create NOC version' }, { status: 500 });
  }
}
