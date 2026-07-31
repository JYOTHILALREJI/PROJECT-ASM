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
    // BUT: if the existing share has expired (expiresAt < now), don't reuse
    // it — create a new one instead. This handles the case where an admin
    // generates a new link for the same site+date after the previous one
    // expired without submission.
    const now = new Date();
    const existing = await db.attendanceShare.findFirst({
      where: { siteId, date, status: 'open' },
      orderBy: { createdAt: 'desc' },
    });

    // If the existing share is expired by time, mark it as 'expired' in DB
    // and don't reuse it (fall through to create a new one).
    if (existing && existing.expiresAt && existing.expiresAt < now) {
      await db.attendanceShare.update({
        where: { id: existing.id },
        data: { status: 'expired' },
      });
      // Fall through to create a new share
    } else if (existing) {
      // Existing share is still valid — reuse it. If it has no expiresAt
      // (created before this feature shipped), backfill it now.
      if (!existing.expiresAt) {
        const [yr, mo, dy] = date.split('-').map(Number);
        const endOfDay = new Date(yr, mo - 1, dy, 23, 59, 59, 999);
        await db.attendanceShare.update({
          where: { id: existing.id },
          data: { expiresAt: endOfDay },
        });
      }
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
            expiresAt: (existing.expiresAt || new Date(existing.createdAt.getTime() + 86400000)).toISOString(),
          },
          reused: true,
        },
      });
    }

    const token = generateToken();

    // ── Set expiry: end of the share's date (23:59:59.999 local server
    //    time) ──
    // The share can only be edited on the SAME DAY it was created for.
    // After midnight (start of the next day), the link auto-expires and
    // becomes read-only. If the TL didn't submit by end of day, the link
    // is dead and the admin must generate a new one.
    //
    // We parse the share's date (YYYY-MM-DD) as a local date and set
    // expiresAt to 23:59:59.999 of that day. Using local time (not UTC)
    // because the business operates in a single timezone and "same day"
    // means the calendar day the admin/TL sees.
    const [yr, mo, dy] = date.split('-').map(Number);
    const endOfDay = new Date(yr, mo - 1, dy, 23, 59, 59, 999);

    const share = await db.attendanceShare.create({
      data: {
        token,
        siteId,
        siteName: site.name,
        clientName: site.clientName,
        projectName: site.projectName,
        date,
        status: 'open',
        expiresAt: endOfDay,
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
          expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
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
// GET /api/attendance/share
// ---------------------------------------------------------------------------
// Two modes:
//   1. ?siteId=...&date=YYYY-MM-DD   → returns the most recent shares for the
//                                       given site + date (max 5).
//   2. (no params)                    → returns ALL shares grouped by site,
//                                       newest first. Used by the
//                                       'Attendance Copy' sidebar page to
//                                       list every link in the system.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const siteId = sp.get('siteId');
    const date = sp.get('date');

    // ── Mode 1: per-site+date lookup ──
    if (siteId && date && isValidDate(date)) {
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
    }

    // ── Mode 2: list all shares, grouped by site ──
    const allShares = await db.attendanceShare.findMany({
      orderBy: [{ siteName: 'asc' }, { date: 'desc' }, { createdAt: 'desc' }],
      take: 500, // Safety cap
    });

    // Group by siteId → { site info, shares[] }
    const groupedMap = new Map<string, {
      siteId: string;
      siteName: string;
      shares: Array<{
        id: string;
        token: string;
        date: string;
        status: string;
        submittedByName: string | null;
        createdAt: string;
        url: string;
      }>;
    }>();

    for (const s of allShares) {
      if (!groupedMap.has(s.siteId)) {
        groupedMap.set(s.siteId, {
          siteId: s.siteId,
          siteName: s.siteName,
          shares: [],
        });
      }
      groupedMap.get(s.siteId)!.shares.push({
        id: s.id,
        token: s.token,
        date: s.date,
        status: s.status,
        submittedByName: s.submittedByName,
        createdAt: s.createdAt.toISOString(),
        url: `/attendance/share/${s.token}`,
      });
    }

    // Convert to array, sort shares within each site by date desc
    const sites = Array.from(groupedMap.values()).map((g) => ({
      ...g,
      shares: g.shares.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    }));

    return NextResponse.json({
      success: true,
      data: {
        sites,
        totalShares: allShares.length,
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
