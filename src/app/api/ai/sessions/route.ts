import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// AI Assistant chat sessions.
//
// GET /api/ai/sessions?userId=...                       → list sessions (+today's messages when ensureToday=1)
// GET /api/ai/sessions?userId=...&sessionId=...         → messages of one session (ownership enforced)
//
// A fresh session is auto-created per user per calendar day (Asia/Dubai) the
// first time the assistant is opened that day — "fresh chat area appears each
// day", while previous days stay accessible from the session rail.

function todayDubai(): string {
  // en-CA formats as YYYY-MM-DD — exactly the session `day` key format.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
}

async function assertUser(userId: string) {
  if (!userId) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return null;
  return user;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = (searchParams.get('userId') || '').trim();
    const ensureToday = searchParams.get('ensureToday') === '1';
    const sessionId = (searchParams.get('sessionId') || '').trim();

    const user = await assertUser(userId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Valid userId is required' }, { status: 400 });
    }

    // Ownership check when a specific session is requested
    if (sessionId) {
      const session = await db.aiChatSession.findFirst({
        where: { id: sessionId, userId },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!session) {
        return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        data: {
          session: {
            id: session.id,
            day: session.day,
            title: session.title,
            updatedAt: session.updatedAt,
          },
          messages: session.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          })),
        },
      });
    }

    let todaySession: { id: string; day: string; title: string; updatedAt: Date } | null = null;

    if (ensureToday) {
      const day = todayDubai();
      const existing = await db.aiChatSession.findUnique({
        where: { userId_day: { userId, day } },
      });
      if (existing) {
        todaySession = existing;
      } else {
        todaySession = await db.aiChatSession.create({
          data: { userId, day },
        });
      }
    }

    const sessions = await db.aiChatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        day: true,
        title: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    let todayMessages: Array<{ id: string; role: string; content: string; createdAt: Date }> = [];
    if (todaySession) {
      const msgs = await db.aiChatMessage.findMany({
        where: { sessionId: todaySession.id },
        orderBy: { createdAt: 'asc' },
      });
      todayMessages = msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt }));
    }

    return NextResponse.json({
      success: true,
      data: {
        today: todaySession
          ? { id: todaySession.id, day: todaySession.day, title: todaySession.title, updatedAt: todaySession.updatedAt }
          : null,
        todayMessages,
        sessions: sessions.map((s) => ({
          id: s.id,
          day: s.day,
          title: s.title,
          updatedAt: s.updatedAt,
          messageCount: s._count.messages,
        })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
