import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';

// ---------------------------------------------------------------------------
// /api/branches
// ---------------------------------------------------------------------------
// GET  — list all active branches
// POST — create a new branch
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const branches = await db.branch.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            sites: { where: { deletedAt: null } },
            employees: { where: { status: { not: 'deleted' } } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      success: true,
      data: {
        branches: branches.map((b) => ({
          id: b.id,
          name: b.name,
          code: b.code,
          isActive: b.isActive,
          createdAt: b.createdAt.toISOString(),
          siteCount: b._count.sites,
          employeeCount: b._count.employees,
        })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, code, actorUserId, actorDisplayName } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Branch name is required' },
        { status: 400 },
      );
    }

    const trimmedName = name.trim();

    const existing = await db.branch.findUnique({ where: { name: trimmedName } });
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'A branch with this name already exists' },
        { status: 409 },
      );
    }

    const branch = await db.branch.create({
      data: {
        name: trimmedName,
        code: typeof code === 'string' ? code.trim().toUpperCase() || null : null,
      },
    });

    await logActivity({
      userId: actorUserId || null,
      displayName: actorDisplayName || 'Admin',
      action: 'create',
      entityType: 'branch',
      entityId: branch.id,
      entityName: branch.name,
      description: `Created branch "${branch.name}"${branch.code ? ` (code: ${branch.code})` : ''}`,
      request,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...branch,
        createdAt: branch.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
