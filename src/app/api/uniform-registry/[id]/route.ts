import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/uniform-registry/[id] - Get single uniform registry entry
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const entry = await db.uniformRegistry.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            isTeamLeader: true,
            currentSite: true,
            photo: true,
          },
        },
      },
    });

    if (!entry || entry.isDeleted) {
      return NextResponse.json(
        { success: false, error: 'Uniform registry entry not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        entry: {
          ...entry,
          createdAt: entry.createdAt.toISOString(),
          renewalDate: entry.renewalDate.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('[UNIFORM_REGISTRY_GET_BY_ID]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch uniform registry entry' },
      { status: 500 }
    );
  }
}

// PUT /api/uniform-registry/[id] - Update a uniform registry entry
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Check if entry exists
    const existing = await db.uniformRegistry.findUnique({ where: { id } });
    if (!existing || existing.isDeleted) {
      return NextResponse.json(
        { success: false, error: 'Uniform registry entry not found' },
        { status: 404 }
      );
    }

    // Allow updating multiple fields
    const updateData: Record<string, unknown> = {};
    if (body.items !== undefined) {
      updateData.items = typeof body.items === 'string' ? body.items : JSON.stringify(body.items);
    }
    if (body.siteName !== undefined) {
      updateData.siteName = body.siteName;
    }
    if (body.teamLeaderName !== undefined) {
      updateData.teamLeaderName = body.teamLeaderName;
    }
    if (body.documentType !== undefined) {
      updateData.documentType = body.documentType;
    }
    if (body.documentNumber !== undefined) {
      updateData.documentNumber = body.documentNumber;
    }

    // If createdAt is provided, update it and recalculate renewalDate
    if (body.createdAt !== undefined) {
      const createdAtDate = new Date(body.createdAt);
      updateData.createdAt = createdAtDate;
      // Recalculate renewalDate = createdAt + 6 months
      const renewalDate = new Date(createdAtDate);
      renewalDate.setMonth(renewalDate.getMonth() + 6);
      updateData.renewalDate = renewalDate;
    } else if (body.renewalDate !== undefined) {
      updateData.renewalDate = new Date(body.renewalDate);
    }

    // If employee has no site and a site is provided, assign the site to the employee
    if (body.siteName && existing.employeeId) {
      const employee = await db.employee.findUnique({
        where: { id: existing.employeeId },
      });
      if (employee && !employee.currentSite) {
        await db.employee.update({
          where: { id: existing.employeeId },
          data: { currentSite: body.siteName },
        });
      }
    }

    const entry = await db.uniformRegistry.update({
      where: { id },
      data: updateData,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            isTeamLeader: true,
            currentSite: true,
            photo: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        entry: {
          ...entry,
          createdAt: entry.createdAt.toISOString(),
          renewalDate: entry.renewalDate.toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('[UNIFORM_REGISTRY_PUT]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update uniform registry entry' },
      { status: 500 }
    );
  }
}

// DELETE /api/uniform-registry/[id] - Delete a uniform registry entry
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if entry exists
    const existing = await db.uniformRegistry.findUnique({ where: { id } });
    if (!existing || existing.isDeleted) {
      return NextResponse.json(
        { success: false, error: 'Uniform registry entry not found' },
        { status: 404 }
      );
    }

    // Soft delete - mark as deleted instead of removing from database
    await db.uniformRegistry.update({
      where: { id },
      data: { isDeleted: true },
    });

    return NextResponse.json({
      success: true,
      data: { message: 'Uniform registry entry deleted successfully' },
    });
  } catch (error) {
    console.error('[UNIFORM_REGISTRY_DELETE]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete uniform registry entry' },
      { status: 500 }
    );
  }
}
