import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// GET /api/presence/online
// ---------------------------------------------------------------------------
// Returns the list of user IDs that are currently online (lastSeenAt within
// the last 90 seconds). Used by the Admin Management page to show a green
// dot next to online admins.
//
// The 90s window gives some slack — the client heartbeats every 30s, so a
// healthy user's lastSeenAt is always <60s old. 90s allows for one missed
// heartbeat.
// ---------------------------------------------------------------------------

const ONLINE_THRESHOLD_MS = 90 * 1000;

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
