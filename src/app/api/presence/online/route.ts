import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// GET /api/presence/online
// ---------------------------------------------------------------------------
// Returns the list of user IDs that are currently online (lastSeenAt within
// the last 35 seconds). Used by the Admin Management page to show a green
// dot next to online admins.
//
// The 35s window gives a small buffer — the client heartbeats every 30s,
// so a healthy user's lastSeenAt is always <35s old. If the user closes
// their tab, the heartbeat sends a 'goingOffline' signal that sets
// lastSeenAt to 1 hour ago, so they appear offline immediately.
// Even without the goingOffline signal, the 35s threshold ensures they
// appear offline within 35 seconds of closing the tab.
// ---------------------------------------------------------------------------

const ONLINE_THRESHOLD_MS = 35 * 1000;

export async function GET(_request: NextRequest) {
  try {
    const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_MS);

    const onlineUsers = await db.user.findMany({
      where: {
        lastSeenAt: { gte: cutoff },
        deletedAt: null,
      },
      select: { id: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        onlineUserIds: onlineUsers.map((u) => u.id),
        count: onlineUsers.length,
        thresholdMs: ONLINE_THRESHOLD_MS,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
