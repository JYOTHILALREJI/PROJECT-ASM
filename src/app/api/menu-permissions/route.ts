import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Menus always visible to all users (including admin)
const ALWAYS_VISIBLE_SLUGS = ['dashboard', 'uniform_registry'];

// GET: Fetch allowed menu slugs for a user (reads from both AdminPermission and AdminMenuPermission)
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 });
    }

    // Check if user is super_admin - they get all menus
    const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role === 'super_admin') {
      const allPerms = await db.permission.findMany({ select: { slug: true } });
      return NextResponse.json({
        success: true,
        data: {
          allowedMenus: allPerms.map(p => p.slug),
          permissions: allPerms.map(p => ({ menuKey: p.slug, allowed: true })),
        },
      });
    }

    // Get permissions from the new AdminPermission system
    const adminPerms = await db.adminPermission.findMany({
      where: { adminId: userId },
      include: { permission: { select: { slug: true } } },
    });
    const newSystemAllowed = adminPerms.map(ap => ap.permission.slug);

    // Also get from legacy AdminMenuPermission
    const legacyPerms = await db.adminMenuPermission.findMany({
      where: { userId, allowed: true },
      select: { menuKey: true },
    });
    const legacyAllowed = legacyPerms.map(p => p.menuKey);

    // Merge: a menu is allowed if it exists in EITHER system
    const allAllowed = [...new Set([...ALWAYS_VISIBLE_SLUGS, ...newSystemAllowed, ...legacyAllowed])];

    return NextResponse.json({
      success: true,
      data: {
        allowedMenus: allAllowed,
        permissions: allAllowed.map(slug => ({ menuKey: slug, allowed: true })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// POST: Set menu permission for a user (writes to both systems)
export async function POST(request: NextRequest) {
  try {
    const { userId, menuKey, allowed } = await request.json();
    if (!userId || !menuKey || typeof allowed !== 'boolean') {
      return NextResponse.json({ success: false, error: 'userId, menuKey, and allowed are required' }, { status: 400 });
    }
    // Verify the user is an admin (not super_admin)
    const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || user.role === 'super_admin') {
      return NextResponse.json({ success: false, error: 'Cannot set permissions for super admin' }, { status: 400 });
    }

    // Write to legacy AdminMenuPermission
    const permission = await db.adminMenuPermission.upsert({
      where: { userId_menuKey: { userId, menuKey } },
      update: { allowed },
      create: { userId, menuKey, allowed },
    });

    // Also write to new AdminPermission system
    const permRecord = await db.permission.findUnique({ where: { slug: menuKey } });
    if (permRecord) {
      if (allowed) {
        await db.adminPermission.upsert({
          where: { adminId_permissionId: { adminId: userId, permissionId: permRecord.id } },
          update: {},
          create: { adminId: userId, permissionId: permRecord.id },
        });
      } else {
        await db.adminPermission.deleteMany({
          where: { adminId: userId, permissionId: permRecord.id },
        });
      }
    }

    return NextResponse.json({ success: true, data: { permission } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// DELETE: Remove all permissions for a user
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await request.json();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 });
    }
    await db.adminMenuPermission.deleteMany({ where: { userId } });
    await db.adminPermission.deleteMany({ where: { adminId: userId } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
