import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cascadeSoftDeleteSite } from '@/lib/soft-delete';
import { logActivity } from '@/lib/activity-logger';

export async function GET() {
  try {
    const sites = await db.site.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, clientName: true, projectName: true, projectId: true, branchId: true, isActive: true, createdAt: true, branch: { select: { id: true, name: true, code: true } } },
      orderBy: { name: 'asc' },
    });

    // Get employee counts per site
    const employeesBySite = await db.employee.groupBy({
      by: ['currentSite'],
      where: {
        currentSite: { not: null },
        status: { not: 'deleted' },
      },
      _count: {
        currentSite: true,
      },
    });

    const countMap = new Map<string, number>();
    for (const row of employeesBySite) {
      if (row.currentSite) {
        countMap.set(row.currentSite, row._count.currentSite);
      }
    }

    const sitesWithCounts = sites.map((site) => ({
      ...site,
      createdAt: site.createdAt.toISOString(),
      employeeCount: countMap.get(site.name) || 0,
    }));

    return NextResponse.json({
      success: true,
      data: { sites: sitesWithCounts },
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
    const { name, clientName, projectName, projectId, branchId, isActive, actorUserId, actorDisplayName } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Site name is required' },
        { status: 400 }
      );
    }

    const trimmedName = name.trim();

    // Check uniqueness
    const existing = await db.site.findUnique({
      where: { name: trimmedName },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Site with this name already exists' },
        { status: 409 }
      );
    }

    const site = await db.site.create({
      data: {
        name: trimmedName,
        clientName: typeof clientName === 'string' ? clientName.trim() : undefined,
        projectName: typeof projectName === 'string' ? projectName.trim() : undefined,
        projectId: typeof projectId === 'string' ? projectId.trim() : undefined,
        branchId: typeof branchId === 'string' && branchId ? branchId : null,
        isActive: typeof isActive === 'boolean' ? isActive : true,
      },
    });

    await logActivity({
      userId: actorUserId || null,
      displayName: actorDisplayName || 'Admin',
      action: 'create',
      entityType: 'site',
      entityId: site.id,
      entityName: site.name,
      description: `Created site "${site.name}"${site.clientName ? ` (client: ${site.clientName})` : ''}`,
      details: { name: site.name, clientName: site.clientName, projectName: site.projectName, projectId: site.projectId, isActive: site.isActive },
      request,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          site: {
            ...site,
            createdAt: site.createdAt.toISOString(),
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
    const { id, name, clientName, projectName, projectId, branchId, isActive, actorUserId, actorDisplayName } = body;

    if (!id || !name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Site id and new name are required' },
        { status: 400 }
      );
    }

    const trimmedName = name.trim();

    // Check site exists
    const existing = await db.site.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Site not found' },
        { status: 404 }
      );
    }

    // Check uniqueness (excluding current site)
    const duplicate = await db.site.findFirst({
      where: {
        name: trimmedName,
        id: { not: id },
      },
    });

    if (duplicate) {
      return NextResponse.json(
        { success: false, error: 'A site with this name already exists' },
        { status: 409 }
      );
    }

    const oldName = existing.name;

    // Build update data
    const updateData: Record<string, unknown> = { name: trimmedName };

    if (clientName !== undefined) {
      updateData.clientName = typeof clientName === 'string' ? clientName.trim() : null;
    }
    if (projectName !== undefined) {
      updateData.projectName = typeof projectName === 'string' ? projectName.trim() : null;
    }
    if (projectId !== undefined) {
      updateData.projectId = typeof projectId === 'string' ? projectId.trim() : null;
    }
    if (branchId !== undefined) {
      updateData.branchId = typeof branchId === 'string' && branchId ? branchId : null;
    }
    if (isActive !== undefined) {
      updateData.isActive = typeof isActive === 'boolean' ? isActive : true;
    }

    // Update site
    const site = await db.site.update({
      where: { id },
      data: updateData,
    });

    // Update all employees who were assigned to the old site name
    if (oldName !== trimmedName) {
      await db.employee.updateMany({
        where: { currentSite: oldName },
        data: { currentSite: trimmedName },
      });
    }

    await logActivity({
      userId: actorUserId || null,
      displayName: actorDisplayName || 'Admin',
      action: 'update',
      entityType: 'site',
      entityId: site.id,
      entityName: site.name,
      description: `Updated site "${site.name}"${oldName !== trimmedName ? ` (renamed from "${oldName}")` : ''}`,
      details: { oldName, newName: site.name, clientName: site.clientName, projectName: site.projectName, projectId: site.projectId, isActive: site.isActive },
      request,
    });

    return NextResponse.json({
      success: true,
      data: {
        site: {
          ...site,
          createdAt: site.createdAt.toISOString(),
        },
        oldName,
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

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, actorUserId, actorDisplayName } = body;

    if (!id && !name) {
      return NextResponse.json(
        { success: false, error: 'Site id or name is required' },
        { status: 400 }
      );
    }

    // Find the site
    const site = id
      ? await db.site.findUnique({ where: { id } })
      : await db.site.findUnique({ where: { name } });

    if (!site) {
      return NextResponse.json(
        { success: false, error: 'Site not found' },
        { status: 404 }
      );
    }

    // Cascade soft-delete: marks the site and all related records (work logs,
    // salary records, site history, month activations) with deletedAt, and
    // unassigns all employees currently attached to this site. No rows are
    // ever hard-deleted.
    await cascadeSoftDeleteSite(site.id);

    await logActivity({
      userId: actorUserId || null,
      displayName: actorDisplayName || 'Admin',
      action: 'delete',
      entityType: 'site',
      entityId: site.id,
      entityName: site.name,
      description: `Deleted site "${site.name}"`,
      details: { siteId: site.id, siteName: site.name },
      request,
    });

    return NextResponse.json({
      success: true,
      data: { message: `Site "${site.name}" soft-deleted successfully. Employees have been unassigned and related records archived.` },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
