import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const superAdmin = await db.user.findFirst({
      where: { role: 'super_admin' },
      select: { id: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        hasUsers: !!superAdmin,
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
