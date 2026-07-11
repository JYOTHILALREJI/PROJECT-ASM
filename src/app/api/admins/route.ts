import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

export async function GET() {
  try {
    // Fetch all users (both admin and super_admin)
    const admins = await db.user.findMany({
      where: {
        role: { in: ['admin', 'super_admin'] },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [
        { role: 'desc' }, // super_admin first
        { createdAt: 'desc' },
      ],
    });

    return NextResponse.json({
      success: true,
      data: {
        admins: admins.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
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
    const { email, name, password, role, requesterId } = body;

    if (!email || !name || !password) {
      return NextResponse.json(
        { success: false, error: 'Email, name, and password are required' },
        { status: 400 }
      );
    }

    // Validate role - only allow admin by default; super_admin requires requester to be super_admin
    let userRole: 'admin' | 'super_admin' = 'admin';

    if (role === 'super_admin') {
      // Only allow super_admin creation if the requester is a super_admin
      if (requesterId) {
        const requester = await db.user.findUnique({
          where: { id: requesterId },
          select: { role: true },
        });
        if (requester?.role !== 'super_admin') {
          return NextResponse.json(
            { success: false, error: 'Only super admins can create super admin accounts' },
            { status: 403 }
          );
        }
      } else {
        // No requester ID provided - check if this is the initial signup (no super_admin exists yet)
        const superAdminExists = await db.user.findFirst({
          where: { role: 'super_admin' },
          select: { id: true },
        });
        if (superAdminExists) {
          return NextResponse.json(
            { success: false, error: 'Only super admins can create super admin accounts' },
            { status: 403 }
          );
        }
      }
      userRole = 'super_admin';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Check uniqueness
    const existing = await db.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'A user with this email already exists' },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(password);

    const user = await db.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        password: hashedPassword,
        role: userRole,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          admin: {
            ...user,
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
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
