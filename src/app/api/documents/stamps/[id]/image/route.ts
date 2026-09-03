import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { stampImageAbsolutePath } from '@/lib/noc-pdf-server';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// GET /api/documents/stamps/[id]/image — serve a stamp image inline so the
// settings page and pickers can show a thumbnail. Works for both built-in
// stamps (src/assets/noc/*) and uploaded ones (storage/stamps/*).
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const stamp = await db.stamp.findFirst({ where: { id, deletedAt: null } });
    if (!stamp) {
      return NextResponse.json({ success: false, error: 'Stamp not found' }, { status: 404 });
    }
    const abs = stampImageAbsolutePath(stamp.imagePath);
    if (!abs || !fs.existsSync(abs)) {
      return NextResponse.json({ success: false, error: 'Stamp image missing' }, { status: 404 });
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    const bytes = fs.readFileSync(abs);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    console.error('GET /api/documents/stamps/[id]/image error:', error);
    return NextResponse.json({ success: false, error: 'Failed to serve stamp image' }, { status: 500 });
  }
}
