import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/activity-logs
// ---------------------------------------------------------------------------
// GET — list activity logs.
//
// Query params (all optional):
//   userId=...          → filter to a specific user
//   action=...          → filter to a specific action type
//   entityType=...      → filter to a specific entity type
//   limit=...           → max results (default 200, capped at 1000)
//   groupByUser=true    → group results by user (returns { users: [...] })
//
// By default returns a flat list (newest first). When groupByUser=true,
// returns logs grouped by user so the All Logs page can render a table
// under each account holder's name.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const userId = sp.get('userId');
    const action = sp.get('action');
    const entityType = sp.get('entityType');
    const groupByUser = sp.get('groupByUser') === 'true';
    const limit = Math.min(parseInt(sp.get('limit') || '500', 10), 1000);

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;

    const logs = await db.activityLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (groupByUser) {
      // Group by userId (null userId → 'system' group)
      const groupedMap = new Map<string, {
        userId: string | null;
        displayName: string;
        userEmail: string | null;
        actorType: string;
        logCount: number;
        lastActivityAt: string;
        logs: Array<{
          id: string;
          action: string;
          entityType: string;
          entityId: string | null;
          entityName: string | null;
          description: string;
          details: string | null;
          ipAddress: string | null;
          createdAt: string;
        }>;
      }>();

      for (const log of logs) {
        const key = log.userId || '__system__';
        if (!groupedMap.has(key)) {
          groupedMap.set(key, {
            userId: log.userId,
            displayName: log.displayName,
            userEmail: log.user?.email || null,
            actorType: log.actorType,
            logCount: 0,
            lastActivityAt: log.createdAt.toISOString(),
            logs: [],
          });
        }
        const group = groupedMap.get(key)!;
        group.logCount++;
        group.logs.push({
          id: log.id,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          entityName: log.entityName,
          description: log.description,
          details: log.details,
          ipAddress: log.ipAddress,
          createdAt: log.createdAt.toISOString(),
        });
      }

      // Sort groups by most recent activity
      const users = Array.from(groupedMap.values()).sort((a, b) => {
        return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
      });

      return NextResponse.json({
        success: true,
        data: {
          users,
          totalLogs: logs.length,
          totalUsers: users.length,
        },
      });
    }

    // Flat list
    return NextResponse.json({
      success: true,
      data: {
        logs: logs.map((l) => ({
          id: l.id,
          userId: l.userId,
          displayName: l.displayName,
          userEmail: l.user?.email || null,
          actorType: l.actorType,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          entityName: l.entityName,
          description: l.description,
          details: l.details,
          ipAddress: l.ipAddress,
          createdAt: l.createdAt.toISOString(),
        })),
        total: logs.length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
