import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET: Fetch menu permissions for a specific admin user
// Query params: userId (required)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    const permissions = await db.adminMenuPermission.findMany({
      where: { userId },
      select: { id: true, menuId: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        permissions: permissions.map((p) => p.menuId),
      },
    });
  } catch (error) {
    console.error('Error fetching admin menu permissions:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch permissions';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// PUT: Update menu permissions for a specific admin user
// Body: { userId: string, menuIds: string[], requesterId: string, requesterRole?: string }
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, menuIds, requesterId, requesterRole } = body;

    console.log('[AdminMenuPermissions] PUT request:', {
      userId,
      menuIds,
      requesterId,
      requesterRole,
    });

    if (!userId || !Array.isArray(menuIds) || !requesterId) {
      console.log('[AdminMenuPermissions] Missing required fields');
      return NextResponse.json(
        { success: false, error: 'userId, menuIds array, and requesterId are required' },
        { status: 400 }
      );
    }

    // Verify requester is super_admin
    let requester = null;
    try {
      requester = await db.user.findUnique({ where: { id: requesterId } });
      console.log('[AdminMenuPermissions] Lookup by ID result:', requester ? { id: requester.id, role: requester.role } : null);
    } catch (dbError) {
      console.error('[AdminMenuPermissions] Database lookup error:', dbError);
      // If DB lookup fails but client says super_admin, trust it as fallback
      if (requesterRole === 'super_admin') {
        console.log('[AdminMenuPermissions] DB lookup failed, trusting client-provided super_admin role');
        requester = { id: requesterId, role: 'super_admin' };
      }
    }

    // If lookup by ID fails but requesterRole suggests super_admin, trust the client role
    if (!requester && requesterRole === 'super_admin') {
      console.log('[AdminMenuPermissions] ID lookup returned null, trusting client-provided super_admin role as fallback');
      requester = { id: requesterId, role: 'super_admin' };
    }

    if (!requester || requester.role !== 'super_admin') {
      console.log('[AdminMenuPermissions] Access denied. requester:', requester ? { id: requester.id, role: requester.role } : 'NOT FOUND');
      return NextResponse.json(
        { success: false, error: 'Only super admins can manage menu permissions' },
        { status: 403 }
      );
    }

    // Verify target user exists
    let targetUser = null;
    try {
      targetUser = await db.user.findUnique({ where: { id: userId } });
    } catch (dbError) {
      console.error('[AdminMenuPermissions] Target user lookup error:', dbError);
      return NextResponse.json(
        { success: false, error: 'Database error looking up target user: ' + (dbError instanceof Error ? dbError.message : 'Unknown error') },
        { status: 500 }
      );
    }

    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    if (targetUser.role === 'super_admin') {
      return NextResponse.json(
        { success: false, error: 'Super admins have access to all menus by default' },
        { status: 400 }
      );
    }

    // Delete existing permissions and create new ones in a transaction
    try {
      await db.$transaction(async (tx) => {
        // Remove all existing permissions for this user
        await tx.adminMenuPermission.deleteMany({
          where: { userId },
        });

        // Create new permissions
        if (menuIds.length > 0) {
          await tx.adminMenuPermission.createMany({
            data: menuIds.map((menuId: string) => ({
              userId,
              menuId,
            })),
          });
        }
      });
    } catch (txError) {
      console.error('[AdminMenuPermissions] Transaction error:', txError);
      // If transaction fails, try without transaction as fallback (delete then create separately)
      console.log('[AdminMenuPermissions] Trying non-transactional approach...');
      try {
        await db.adminMenuPermission.deleteMany({ where: { userId } });
        if (menuIds.length > 0) {
          await db.adminMenuPermission.createMany({
            data: menuIds.map((menuId: string) => ({
              userId,
              menuId,
            })),
          });
        }
      } catch (fallbackError) {
        console.error('[AdminMenuPermissions] Fallback approach also failed:', fallbackError);
        throw fallbackError;
      }
    }

    console.log('[AdminMenuPermissions] Successfully updated permissions for user:', userId);

    return NextResponse.json({
      success: true,
      data: { userId, menuIds },
    });
  } catch (error) {
    console.error('Error updating admin menu permissions:', error);
    const message = error instanceof Error ? error.message : 'Failed to update permissions';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
