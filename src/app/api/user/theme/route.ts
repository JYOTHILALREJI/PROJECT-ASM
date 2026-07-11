import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/user/theme?userId=xxx - Get theme for a user
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId query parameter is required' },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, theme: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        userId: user.id,
        theme: user.theme,
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

// PUT /api/user/theme - Update theme for a user
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, theme } = body;

    if (!userId || !theme) {
      return NextResponse.json(
        { success: false, error: 'userId and theme are required' },
        { status: 400 }
      );
    }

    if (!['dark', 'light'].includes(theme)) {
      return NextResponse.json(
        { success: false, error: 'theme must be "dark" or "light"' },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const updatedUser = await db.user.update({
      where: { id: userId },
      data: { theme },
      select: { id: true, theme: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        userId: updatedUser.id,
        theme: updatedUser.theme,
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
