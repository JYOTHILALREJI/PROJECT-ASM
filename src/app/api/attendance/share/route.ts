import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// POST /api/attendance/share
// ---------------------------------------------------------------------------
// Create a shareable attendance link for a single site + date.
//
// Body:
//   siteId: string  (required)
//   date:   string  (required, YYYY-MM-DD)
//
// Returns the share token + the full URL the client should display/copy.
// The link is auth-free and tied to this single site + date. Once the
// TL/Supervisor submits attendance via the link, the share is marked
// 'submitted' and cannot be edited again.
// ---------------------------------------------------------------------------

function generateToken(): string {
  // 32-char unguessable token. crypto.randomUUID is available in Node 18+.
  const uuid = (globalThis.crypto?.randomUUID?.() as string | undefined) || '';
  if (uuid) return uuid.replace(/-/g, '');
  // Fallback (shouldn't happen on modern Node)
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { siteId, date } = body;

    if (!siteId || typeof siteId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'siteId is required' },
        { status: 400 },
      );
    }
    if (!date || !isValidDate(date)) {
      return NextResponse.json(
        { success: false, error: 'date is required (YYYY-MM-DD)' },
        { status: 400 },
      );
    }

    // Verify the site exists and is active
    const site = await db.site.findUnique({ where: { id: siteId } });
    if (!site) {
      return NextResponse.json(
        { success: false, error: 'Site not found' },
        { status: 404 },
      );
    }
    if (site.deletedAt) {
      return NextResponse.json(
        { success: false, error: 'Site has been deleted' },
        { status: 404 },
      );
    }

    // Check if there's already an open share for this site+date — if so,
    // return the existing one instead of creating a duplicate.
    const existing = await db.attendanceShare.findFirst({
      where: { siteId, date, status: 'open' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return NextResponse.json({
        success: true,
        data: {
          token: existing.token,
          url: `/attendance/share/${existing.token}`,
          share: {
            id: existing.id,
            token: existing.token,
            siteId: existing.siteId,
            siteName: existing.siteName,
            date: existing.date,
            status: existing.status,
            createdAt: existing.createdAt.toISOString(),
          },
          reused: true,
        },
      });
    }

    const token = generateToken();
    const share = await db.attendanceShare.create({
      data: {
        token,
        siteId,
        siteName: site.name,
        clientName: site.clientName,
        projectName: site.projectName,
        date,
        status: 'open',
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        token: share.token,
        url: `/attendance/share/${share.token}`,
        share: {
          id: share.id,
          token: share.token,
          siteId: share.siteId,
          siteName: share.siteName,
          date: share.date,
          status: share.status,
          createdAt: share.createdAt.toISOString(),
        },
        reused: false,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[attendance/share POST] error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/attendance/share?siteId=...&date=...
// ---------------------------------------------------------------------------
// Returns the most recent share (any status) for the given site + date.
// Useful for the admin UI to show whether a share is already open/submitted.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const siteId = sp.get('siteId');
    const date = sp.get('date');

    if (!siteId || !date || !isValidDate(date)) {
      return NextResponse.json(
        { success: false, error: 'siteId and date (YYYY-MM-DD) are required' },
        { status: 400 },
      );
    }

    const shares = await db.attendanceShare.findMany({
      where: { siteId, date },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return NextResponse.json({
      success: true,
      data: {
        shares: shares.map((s) => ({
          id: s.id,
          token: s.token,
          siteId: s.siteId,
          siteName: s.siteName,
          date: s.date,
          status: s.status,
          submittedByName: s.submittedByName,
          createdAt: s.createdAt.toISOString(),
          url: `/attendance/share/${s.token}`,
        })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
