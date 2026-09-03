import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { ensureStorageDir, sanitizeFileName, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/stamps — the stamp library stored in the database
//   GET   — active stamps (id, name, isDefault, imagePath)
//   POST  — upload a new stamp (multipart: name, isDefault?, file png/jpg)
// ---------------------------------------------------------------------------

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — stamps are small images

export async function GET() {
  try {
    const stamps = await db.stamp.findMany({
      where: { deletedAt: null, active: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, imagePath: true, isDefault: true, createdAt: true },
    });
    return NextResponse.json({ success: true, data: { stamps } });
  } catch (error) {
    console.error('GET /api/documents/stamps error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load stamps' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const name = (form.get('name') || '').toString().trim();
    const isDefault = (form.get('isDefault') || '').toString() === '1' || (form.get('isDefault') || '').toString() === 'true';
    const actorDisplayName = (form.get('actorDisplayName') || '').toString().trim();
    const actorUserId = (form.get('actorUserId') || '').toString().trim();
    const file = form.get('file');

    if (name.length < 2) {
      return NextResponse.json({ success: false, error: 'Give the stamp a name (min 2 characters).' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'A stamp image file is required.' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ success: false, error: 'The uploaded file is empty.' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ success: false, error: 'Stamp image exceeds the 5 MB limit.' }, { status: 400 });
    }
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ success: false, error: `Unsupported image type "${ext || 'unknown'}". Allowed: PNG, JPG, WEBP.` }, { status: 400 });
    }

    const dir = ensureStorageDir('stamps');
    const absPath = uniqueFilePath(dir, sanitizeFileName(`${name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')}${ext}`));
    fs.writeFileSync(absPath, Buffer.from(await file.arrayBuffer()));
    const relativePath = path.relative(process.cwd(), absPath).replace(/\\/g, '/');

    if (isDefault) {
      await db.stamp.updateMany({ where: { deletedAt: null }, data: { isDefault: false } });
    }

    const stamp = await db.stamp.create({
      data: { name, imagePath: relativePath, isDefault, active: true },
    });

    await logActivity({
      userId: actorUserId || undefined,
      displayName: actorDisplayName || 'Admin',
      action: 'stamp_create',
      entityType: 'stamp',
      entityId: stamp.id,
      entityName: stamp.name,
      description: `Added stamp "${stamp.name}" to the NOC stamp library`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { stamp } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/documents/stamps error:', error);
    return NextResponse.json({ success: false, error: 'Failed to add stamp' }, { status: 500 });
  }
}
