import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// POST /api/presence/heartbeat
// ---------------------------------------------------------------------------
// Updates the current user's lastSeenAt timestamp. The client calls this
// every 30s while the app is open. A user is considered "online" if their
// lastSeenAt is within the last 35s.
//
// Body: { userId: string, goingOffline?: boolean }
//
// When goingOffline=true, we set lastSeenAt to 1 hour ago — making the user
// appear OFFLINE immediately. This is sent when the user closes the tab
// (pagehide/beforeunload event) so the Admin Management page reflects the
// offline status within the next refresh cycle (20s) instead of waiting
// for the 35s threshold to expire.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, goingOffline } = body;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 },
      );
    }

    // If goingOffline, set lastSeenAt to 1 hour ago so the user appears
    // offline immediately. Otherwise, set to now.
    const lastSeenAt = goingOffline
      ? new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
      : new Date();

    await db.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: { lastSeenAt },
    });

    return NextResponse.json({ success: true, data: { heartbeat: true, offline: !!goingOffline } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
