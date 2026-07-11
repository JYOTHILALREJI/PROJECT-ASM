import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/attendance/versions
// ---------------------------------------------------------------------------
// GET — list attendance versions for a given site+date (or share token).
//
// Query params:
//   siteId=...&date=YYYY-MM-DD   → list versions for that site+date
//   shareToken=...               → list versions captured via that share
//   (none)                        → list ALL versions (newest first, capped)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const siteId = sp.get('siteId');
    const date = sp.get('date');
    const shareToken = sp.get('shareToken');

    const where: Record<string, unknown> = {};
    if (siteId) where.siteId = siteId;
    if (date) where.date = date;
    if (shareToken) where.shareToken = shareToken;

    const versions = await db.attendanceVersion.findMany({
      where,
      orderBy: [{ date: 'desc' }, { versionNumber: 'desc' }],
      take: 200,
    });

    return NextResponse.json({
      success: true,
      data: {
        versions: versions.map((v) => ({
          id: v.id,
          siteId: v.siteId,
          siteName: v.siteName,
          date: v.date,
          versionNumber: v.versionNumber,
          source: v.source,
          shareToken: v.shareToken,
          changedById: v.changedById,
          changedByName: v.changedByName,
          summary: v.summary,
          createdAt: v.createdAt.toISOString(),
          // Parse the snapshot for the client (so it doesn't have to)
          snapshot: safeParseSnapshot(v.snapshot),
        })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

function safeParseSnapshot(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}
