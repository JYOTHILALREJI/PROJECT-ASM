import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// POST /api/presence/heartbeat
// ---------------------------------------------------------------------------
// Updates the current user's lastSeenAt timestamp to "now". The client
// calls this every 30s while the app is open. A user is considered "online"
// if their lastSeenAt is within the last 90s (gives some slack for network
// hiccups).
//
// Body: { userId: string }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 },
      );
    }

    // Update lastSeenAt. We don't fail if the user doesn't exist (e.g. stale
    // localStorage) — just return success.
    await db.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: { lastSeenAt: new Date() },
    });

    return NextResponse.json({ success: true, data: { heartbeat: true } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
