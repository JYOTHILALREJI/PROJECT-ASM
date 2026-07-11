import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (type && ['request', 'warning', 'fine'].includes(type)) {
      where.type = type;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      db.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.notification.count({ where }),
      db.notification.count({ where: { read: false } }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        notifications: notifications.map((n) => ({
          ...n,
          createdAt: n.createdAt.toISOString(),
          updatedAt: n.updatedAt.toISOString(),
        })),
        total,
        unreadCount,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, title, message, type } = body;

    if (!userId || !title || !message) {
      return NextResponse.json(
        { success: false, error: 'userId, title, and message are required' },
        { status: 400 }
      );
    }

    const validTypes = ['request', 'warning', 'fine'];
    const notificationType = type || 'request';

    if (!validTypes.includes(notificationType)) {
      return NextResponse.json(
        { success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    const notification = await db.notification.create({
      data: {
        userId,
        title,
        message,
        type: notificationType,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          notification: {
            ...notification,
            createdAt: notification.createdAt.toISOString(),
            updatedAt: notification.updatedAt.toISOString(),
          },
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, markAll, type } = body;

    if (markAll) {
      // Mark all as read, optionally filtered by type
      const where: Record<string, unknown> = { read: false };

      if (type && ['request', 'warning', 'fine'].includes(type)) {
        where.type = type;
      }

      const result = await db.notification.updateMany({
        where,
        data: { read: true },
      });

      return NextResponse.json({
        success: true,
        data: { updated: result.count },
      });
    }

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id or markAll is required' },
        { status: 400 }
      );
    }

    const notification = await db.notification.update({
      where: { id },
      data: { read: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        notification: {
          ...notification,
          createdAt: notification.createdAt.toISOString(),
          updatedAt: notification.updatedAt.toISOString(),
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
