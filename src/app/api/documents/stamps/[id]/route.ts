import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { resolveStoragePath } from '@/lib/document-storage';
import fs from 'fs';

// ---------------------------------------------------------------------------
// /api/documents/stamps/[id]
//   PATCH  — rename a stamp / make it the default
//   DELETE — remove a stamp from the library (soft; NOCs keep SetNull)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const stamp = await db.stamp.findFirst({ where: { id, deletedAt: null } });
    if (!stamp) {
      return NextResponse.json({ success: false, error: 'Stamp not found' }, { status: 404 });
    }
    const body = (await request.json()) as {
      name?: string;
      isDefault?: boolean;
      actorDisplayName?: string;
      actorUserId?: string;
    };

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (name.length < 2) {
        return NextResponse.json({ success: false, error: 'Stamp name needs at least 2 characters.' }, { status: 400 });
      }
      data.name = name;
    }
    if (body.isDefault === true) {
      await db.stamp.updateMany({ where: { deletedAt: null }, data: { isDefault: false } });
      data.isDefault = true;
    } else if (body.isDefault === false) {
      data.isDefault = false;
    }

    const updated = await db.stamp.update({ where: { id }, data });

    await logActivity({
      userId: body.actorUserId,
      displayName: body.actorDisplayName || 'Admin',
      action: 'stamp_update',
      entityType: 'stamp',
      entityId: stamp.id,
      entityName: updated.name,
      description: `Updated stamp "${updated.name}"`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { stamp: updated } });
  } catch (error) {
    console.error('PATCH /api/documents/stamps/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update stamp' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const stamp = await db.stamp.findFirst({ where: { id, deletedAt: null } });
    if (!stamp) {
      return NextResponse.json({ success: false, error: 'Stamp not found' }, { status: 404 });
    }

    await db.stamp.update({ where: { id }, data: { deletedAt: new Date(), active: false, isDefault: false } });

    // remove the image file for non-built-in stamps (built-ins live in src/)
    if (!stamp.imagePath.startsWith('builtin:')) {
      try {
        const abs = resolveStoragePath(stamp.imagePath);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch {
        // best effort
      }
    }

    const actorDisplayName = request.nextUrl.searchParams.get('actorDisplayName') || 'Admin';
    const actorUserId = request.nextUrl.searchParams.get('actorUserId') || undefined;
    await logActivity({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'stamp_delete',
      entityType: 'stamp',
      entityId: stamp.id,
      entityName: stamp.name,
      description: `Removed stamp "${stamp.name}" from the library`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/documents/stamps/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete stamp' }, { status: 500 });
  }
}
