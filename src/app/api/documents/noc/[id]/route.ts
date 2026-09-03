import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { resolveStoragePath } from '@/lib/document-storage';
import fs from 'fs';

// ---------------------------------------------------------------------------
// /api/documents/noc/[id]
//   GET    — single NOC (metadata + employee snapshot)
//   DELETE — soft-delete the NOC (folder view hides it)
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const noc = await db.nocDocument.findFirst({ where: { id, deletedAt: null } });
    if (!noc) {
      return NextResponse.json({ success: false, error: 'NOC not found' }, { status: 404 });
    }
    return NextResponse.json({
      success: true,
      data: {
        noc: {
          id: noc.id,
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
          employees: JSON.parse(noc.employeesJson || '[]') as NocEmployeeRow[],
        },
      },
    });
  } catch (error) {
    console.error('GET /api/documents/noc/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load NOC' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const noc = await db.nocDocument.findFirst({ where: { id, deletedAt: null } });
    if (!noc) {
      return NextResponse.json({ success: false, error: 'NOC not found' }, { status: 404 });
    }

    await db.nocDocument.update({ where: { id }, data: { deletedAt: new Date() } });

    // Remove the stored PDF file (metadata stays for audit; PDF is
    // regenerable from the snapshot if the record is restored).
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

    const actorDisplayName = request.nextUrl.searchParams.get('actorDisplayName') || 'Admin';
    const actorUserId = request.nextUrl.searchParams.get('actorUserId') || undefined;
    await logActivity({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'noc_delete',
      entityType: 'noc_document',
      entityId: noc.id,
      entityName: noc.fileName,
      description: `Deleted NOC ${noc.fileName}`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/documents/noc/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete NOC' }, { status: 500 });
  }
}

