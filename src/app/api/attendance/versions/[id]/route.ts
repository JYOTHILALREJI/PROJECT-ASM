import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { restoreAttendanceVersion } from '@/lib/attendance-version';

// ---------------------------------------------------------------------------
// /api/attendance/versions/[id]
// ---------------------------------------------------------------------------
// GET    — fetch a single version (with parsed snapshot)
// DELETE — delete a version (admin only — no auth check here, but the UI is
//          admin-gated; this is a soft safety net)
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const version = await db.attendanceVersion.findUnique({ where: { id } });
    if (!version) {
      return NextResponse.json(
        { success: false, error: 'Version not found' },
        { status: 404 },
      );
    }
    let snapshot: unknown = [];
    try { snapshot = JSON.parse(version.snapshot); } catch { snapshot = []; }
    return NextResponse.json({
      success: true,
      data: {
        ...version,
        createdAt: version.createdAt.toISOString(),
        snapshot,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const existing = await db.attendanceVersion.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Version not found' },
        { status: 404 },
      );
    }
    await db.attendanceVersion.delete({ where: { id } });
    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/attendance/versions/[id]   (with ?action=restore)
// ---------------------------------------------------------------------------
// Restore a prior version: re-write the live attendance to match the
// snapshot, then capture a NEW version (source='restore') so the history
// shows the restore action.
//
// Body: { restoredById?: string, restoredByName?: string }
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sp = request.nextUrl.searchParams;
    const action = sp.get('action');

    if (action !== 'restore') {
      return NextResponse.json(
        { success: false, error: 'Unknown action. Use ?action=restore.' },
        { status: 400 },
      );
    }

    let body: { restoredById?: string; restoredByName?: string } = {};
    try {
      body = await request.json();
    } catch {
      // No body is fine
    }

    const restoredBy = body.restoredById
      ? { id: body.restoredById, name: body.restoredByName || 'Admin' }
      : null;

    const result = await restoreAttendanceVersion(id, restoredBy);
    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Failed to restore version' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        newVersionId: result.newVersionId,
        newVersionNumber: result.newVersionNumber,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
