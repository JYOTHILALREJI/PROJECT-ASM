import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveStoragePath } from '@/lib/document-storage';
import fs from 'fs';

// ---------------------------------------------------------------------------
// GET /api/documents/employee/[id]/file?mode=inline|download
//   Serves the stored scan (PDF/image) for viewing or download.
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const doc = await db.employeeDocument.findFirst({ where: { id, deletedAt: null } });
    if (!doc) {
      return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    }

    const abs = resolveStoragePath(doc.filePath);
    if (!fs.existsSync(abs)) {
      return NextResponse.json({ success: false, error: 'Stored file is missing' }, { status: 410 });
    }

    const bytes = fs.readFileSync(abs);
    const mode = request.nextUrl.searchParams.get('mode');
    const safeName = (doc.fileName || 'document').replace(/"/g, '');
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `${mode === 'download' ? 'attachment' : 'inline'}; filename="${safeName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('GET /api/documents/employee/[id]/file error:', error);
    return NextResponse.json({ success: false, error: 'Failed to serve document' }, { status: 500 });
  }
}
