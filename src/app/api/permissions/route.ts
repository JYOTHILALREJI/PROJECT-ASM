import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Define all sidebar menu permissions that should exist in the system
const PERMISSION_SEEDS = [
  { name: 'Dashboard', slug: 'dashboard', group: 'general' },
  { name: 'Employees', slug: 'employees', group: 'workforce' },
  { name: 'Sites', slug: 'sites', group: 'workforce' },
  { name: 'Attendance', slug: 'attendance', group: 'workforce' },
  { name: 'Accounts', slug: 'accounts', group: 'finance' },
  { name: 'Consolidated Salary', slug: 'consolidated_salary', group: 'finance' },
  { name: 'Materials Registry', slug: 'uniform_registry', group: 'workforce' },
  { name: 'Leave Requests', slug: 'leave_requests', group: 'workforce' },
  { name: 'Cancellations', slug: 'cancellation_requests', group: 'workforce' },
  { name: 'Notifications', slug: 'notifications', group: 'general' },
  { name: 'Admin Management', slug: 'admins', group: 'admin' },
];

// Menus always visible to all users (including admin)
const ALWAYS_VISIBLE_SLUGS = ['dashboard', 'uniform_registry'];

const VALID_SLUGS = PERMISSION_SEEDS.map(s => s.slug);

/**
 * Ensure all permissions exist in the database (auto-seed)
 * Also clean up stale permissions that are no longer in the sidebar
 */
async function ensurePermissionsSeeded() {
  for (const seed of PERMISSION_SEEDS) {
    await db.permission.upsert({
      where: { slug: seed.slug },
      update: { name: seed.name, group: seed.group },
      create: { name: seed.name, slug: seed.slug, group: seed.group },
    });
  }

  // Clean up stale permissions that are no longer in the sidebar
  const allPerms = await db.permission.findMany({ select: { id: true, slug: true } });
  for (const perm of allPerms) {
    if (!VALID_SLUGS.includes(perm.slug)) {
      // Delete associated AdminPermission records first
      await db.adminPermission.deleteMany({ where: { permissionId: perm.id } });
      await db.adminMenuPermission.deleteMany({ where: { menuKey: perm.slug } });
      await db.permission.delete({ where: { id: perm.id } });
    }
  }
}

// GET: List all permissions, optionally with granted status for a specific admin
export async function GET(request: NextRequest) {
  try {
    // Auto-seed permissions to ensure they exist
    await ensurePermissionsSeeded();

    const group = request.nextUrl.searchParams.get('group') || '';
    const adminId = request.nextUrl.searchParams.get('adminId') || '';

    const where: Record<string, unknown> = {};
    if (group) where.group = group;

    const permissions = await db.permission.findMany({
      where,
      orderBy: [{ group: 'asc' }, { name: 'asc' }],
      include: {
        adminPermissions: adminId ? {
          where: { adminId },
          select: { id: true },
        } : false,
      },
    });

    // Also get legacy AdminMenuPermission for backward compat
    let legacyPermissions: string[] = [];
    if (adminId) {
      const menuPerms = await db.adminMenuPermission.findMany({
        where: { userId: adminId, allowed: true },
        select: { menuKey: true },
      });
      legacyPermissions = menuPerms.map(p => p.menuKey);
    }

    // Merge: a permission is granted if it exists in AdminPermission OR in legacy AdminMenuPermission
    const result = permissions.map(p => {
      const newGranted = adminId ? p.adminPermissions.length > 0 : undefined;
      const legacyGranted = legacyPermissions.includes(p.slug);
      const granted = newGranted || legacyGranted;
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        group: p.group,
        isAlwaysVisible: ALWAYS_VISIBLE_SLUGS.includes(p.slug),
        granted: adminId ? granted : undefined,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        permissions: result,
        alwaysVisibleSlugs: ALWAYS_VISIBLE_SLUGS,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// POST: Grant or revoke a permission for an admin
export async function POST(request: NextRequest) {
  try {
    const { adminId, permissionSlug, granted } = await request.json();
    if (!adminId || !permissionSlug || typeof granted !== 'boolean') {
      return NextResponse.json({ success: false, error: 'adminId, permissionSlug, and granted are required' }, { status: 400 });
    }

    // Verify the user is an admin (not super_admin)
    const user = await db.user.findUnique({ where: { id: adminId }, select: { role: true } });
    if (!user || user.role === 'super_admin') {
      return NextResponse.json({ success: false, error: 'Cannot set permissions for super admin' }, { status: 400 });
    }

    // Find the permission by slug
    const permission = await db.permission.findUnique({ where: { slug: permissionSlug } });
    if (!permission) {
      return NextResponse.json({ success: false, error: 'Permission not found' }, { status: 404 });
    }

    if (granted) {
      // Grant permission via AdminPermission
      await db.adminPermission.upsert({
        where: { adminId_permissionId: { adminId, permissionId: permission.id } },
        update: {},
        create: { adminId, permissionId: permission.id },
      });
    } else {
      // Revoke permission via AdminPermission
      await db.adminPermission.deleteMany({
        where: { adminId, permissionId: permission.id },
      });
    }

    // Also sync to legacy AdminMenuPermission for backward compat with sidebar
    await db.adminMenuPermission.upsert({
      where: { userId_menuKey: { userId: adminId, menuKey: permissionSlug } },
      update: { allowed: granted },
      create: { userId: adminId, menuKey: permissionSlug, allowed: granted },
    });

    return NextResponse.json({ success: true, data: { granted, permissionSlug } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// PUT: Bulk update permissions for an admin
export async function PUT(request: NextRequest) {
  try {
    const { adminId, permissionSlugs } = await request.json();
    if (!adminId || !Array.isArray(permissionSlugs)) {
      return NextResponse.json({ success: false, error: 'adminId and permissionSlugs array are required' }, { status: 400 });
    }

    // Verify the user is an admin (not super_admin)
    const user = await db.user.findUnique({ where: { id: adminId }, select: { role: true } });
    if (!user || user.role === 'super_admin') {
      return NextResponse.json({ success: false, error: 'Cannot set permissions for super admin' }, { status: 400 });
    }

    // Delete all existing permissions for this admin
    await db.adminPermission.deleteMany({ where: { adminId } });

    // Grant new permissions
    if (permissionSlugs.length > 0) {
      const permissions = await db.permission.findMany({
        where: { slug: { in: permissionSlugs } },
      });
      await db.adminPermission.createMany({
        data: permissions.map(p => ({ adminId, permissionId: p.id })),
      });
    }

    // Sync legacy AdminMenuPermission
    const allPermissions = await db.permission.findMany({ select: { slug: true } });
    for (const perm of allPermissions) {
      await db.adminMenuPermission.upsert({
        where: { userId_menuKey: { userId: adminId, menuKey: perm.slug } },
        update: { allowed: permissionSlugs.includes(perm.slug) },
        create: { userId: adminId, menuKey: perm.slug, allowed: permissionSlugs.includes(perm.slug) },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
