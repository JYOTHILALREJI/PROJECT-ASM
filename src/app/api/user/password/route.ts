import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, comparePassword } from '@/lib/auth';

export async function PUT(request: NextRequest) {
  try {
    const { userId, currentPassword, newPassword } = await request.json();
    if (!userId || !currentPassword || !newPassword) {
      return NextResponse.json({ success: false, error: 'All fields are required' }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ success: false, error: 'New password must be at least 6 characters' }, { status: 400 });
    }
    const user = await db.user.findUnique({ where: { id: userId }, select: { password: true } });
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    const isValid = await comparePassword(currentPassword, user.password);
    if (!isValid) {
      return NextResponse.json({ success: false, error: 'Current password is incorrect' }, { status: 400 });
    }
    const hashedPassword = await hashPassword(newPassword);
    await db.user.update({ where: { id: userId }, data: { password: hashedPassword } });
    return NextResponse.json({ success: true, message: 'Password updated successfully' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
