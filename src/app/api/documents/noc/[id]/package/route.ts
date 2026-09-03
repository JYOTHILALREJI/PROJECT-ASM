import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { buildNocPackage, storePackage } from '@/lib/noc-package';
import { resolveStoragePath } from '@/lib/document-storage';
import fs from 'fs';

// ---------------------------------------------------------------------------
// /api/documents/noc/[id]/package
//   POST                 — generate the NOC package ZIP server-side and store
//                          it (history row + file). Returns the SUMMARY so the
//                          UI can show per-category counts + missing list.
//   GET ?packageId=...   — stream a stored package ZIP (download; audited).
//   GET ?view=latest     — last completed package metadata for the NOC page.
//   GET ?view=history    — generation history.
//
// Security (§49): ZIPs live under storage/noc-packages/ (never public);
// downloads go through this authenticated route and are audit-logged.
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let packageRowId: string | null = null;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const actorUserId = (body as { actorUserId?: string }).actorUserId;
    const actorDisplayName = (body as { actorDisplayName?: string }).actorDisplayName || 'Admin';

    const noc = await db.nocDocument.findFirst({ where: { id, deletedAt: null } });
    if (!noc) {
      return NextResponse.json({ success: false, code: 'NOC_NOT_FOUND', error: 'NOC not found' }, { status: 404 });
    }
    if (noc.status !== 'final') {
      return NextResponse.json({ success: false, error: 'Only finalized NOCs can be packaged.' }, { status: 400 });
    }

    // history row — GENERATING (§25)
    const row = await db.nocDocumentPackage.create({
      data: {
        nocId: noc.id,
        fileName: 'pending',
        status: 'GENERATING',
        employeeCount: noc.employeeCount,
        generatedBy: actorDisplayName,
      },
    });
    packageRowId = row.id;

    let result;
    try {
      result = await buildNocPackage(noc);
    } catch (e) {
      // NOC PDF unreadable → the whole package fails (§55)
      const message = e instanceof Error ? e.message : 'Package generation failed';
      await db.nocDocumentPackage.update({
        where: { id: row.id },
        data: { status: 'FAILED', fileName: `NOC_${noc.nocNumber}.zip`, summaryJson: JSON.stringify({ error: message }) },
      });
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }

    const stored = storePackage(noc.nocNumber, result.zipName, result.buffer);
    const completed = await db.nocDocumentPackage.update({
      where: { id: row.id },
      data: {
        fileName: result.zipName,
        storagePath: stored.relPath,
        fileSize: result.buffer.length,
        employeeCount: result.summary.employeeCount,
        documentsIncluded: result.summary.documentsIncluded,
        documentsMissing: result.summary.documentsMissing,
        summaryJson: JSON.stringify(result.summary),
        status: 'COMPLETED',
      },
    });

    await logActivity({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'noc_package_created',
      entityType: 'noc_document',
      entityId: noc.id,
      entityName: noc.nocNumber,
      description: `Generated NOC package ${result.zipName} — ${result.summary.employeeZipsCreated} employee ZIPs, ${result.summary.documentsIncluded} documents included, ${result.summary.documentsMissing} missing`,
    }).catch(() => undefined);

    return NextResponse.json({
      success: true,
      data: {
        package: {
          id: completed.id,
          fileName: completed.fileName,
          fileSize: completed.fileSize,
          createdAt: completed.createdAt,
        },
        summary: result.summary,
        downloadUrl: `/api/documents/noc/${noc.id}/package?packageId=${completed.id}`,
      },
    });
  } catch (error) {
    console.error('POST /api/documents/noc/[id]/package error:', error);
    if (packageRowId) {
      await db.nocDocumentPackage.update({ where: { id: packageRowId }, data: { status: 'FAILED' } }).catch(() => undefined);
    }
    return NextResponse.json({ success: false, error: 'Failed to generate the NOC package' }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const noc = await db.nocDocument.findFirst({ where: { id, deletedAt: null } });
    if (!noc) {
      return NextResponse.json({ success: false, code: 'NOC_NOT_FOUND', error: 'NOC not found' }, { status: 404 });
    }

    const url = new URL(request.url);
    const packageId = url.searchParams.get('packageId');

    if (url.searchParams.get('view') === 'history') {
      const rows = await db.nocDocumentPackage.findMany({
        where: { nocId: noc.id, status: { not: 'GENERATING' } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, fileName: true, fileSize: true, employeeCount: true,
          documentsIncluded: true, documentsMissing: true, status: true,
          generatedBy: true, createdAt: true,
        },
      });
      return NextResponse.json({ success: true, data: { packages: rows } });
    }

    if (url.searchParams.get('view') === 'latest') {
      const last = await db.nocDocumentPackage.findFirst({
        where: { nocId: noc.id, status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, fileName: true, fileSize: true, employeeCount: true,
          documentsIncluded: true, documentsMissing: true, generatedBy: true, createdAt: true,
        },
      });
      // staleness signal (§26/§27): package older than the NOC's last update
      const stale = !!last && new Date(last.createdAt).getTime() < new Date(noc.updatedAt).getTime();
      return NextResponse.json({ success: true, data: { package: last, stale } });
    }

    if (!packageId) {
      return NextResponse.json({ success: false, error: 'packageId is required' }, { status: 400 });
    }

    const row = await db.nocDocumentPackage.findFirst({ where: { id: packageId, nocId: noc.id } });
    if (!row || !row.storagePath || row.status !== 'COMPLETED') {
      return NextResponse.json({ success: false, error: 'Package not found or not ready' }, { status: 404 });
    }
    const abs = resolveStoragePath(row.storagePath);
    if (!fs.existsSync(abs)) {
      return NextResponse.json({ success: false, error: 'The stored package file is missing — generate a new package.' }, { status: 404 });
    }

    const actorDisplayName = url.searchParams.get('actorDisplayName') || 'Admin';
    const actorUserId = url.searchParams.get('actorUserId') || undefined;
    await logActivity({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'noc_package_downloaded',
      entityType: 'noc_document',
      entityId: noc.id,
      entityName: noc.nocNumber,
      description: `Downloaded NOC package ${row.fileName}`,
    }).catch(() => undefined);

    const bytes = fs.readFileSync(abs);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${row.fileName.replace(/"/g, '')}"`,
        'Content-Length': String(bytes.length),
      },
    });
  } catch (error) {
    console.error('GET /api/documents/noc/[id]/package error:', error);
    return NextResponse.json({ success: false, error: 'Failed to serve the package' }, { status: 500 });
  }
}
