import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// /api/camps
// ---------------------------------------------------------------------------
// GET  — list all camps (with occupancy stats)
// POST — create a new camp
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const camps = await db.camp.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { employees: { where: { status: { not: 'deleted' } } } } },
      },
    });

    const result = camps.map((camp) => {
      const occupied = camp._count.employees;
      return {
        id: camp.id,
        name: camp.name,
        location: camp.location,
        totalBedSpaces: camp.totalBedSpaces,
        occupiedBedSpaces: occupied,
        availableBedSpaces: Math.max(0, camp.totalBedSpaces - occupied),
        isActive: camp.isActive,
        createdAt: camp.createdAt.toISOString(),
        updatedAt: camp.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({ success: true, data: { camps: result } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[camps GET] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, location, totalBedSpaces, isActive } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { success: false, error: 'Camp name is required' },
        { status: 400 },
      );
    }

    // Check for existing camp with same name
    const existing = await db.camp.findUnique({ where: { name: name.trim() } });
    if (existing && existing.deletedAt === null) {
      return NextResponse.json(
        { success: false, error: 'A camp with this name already exists' },
        { status: 409 },
      );
    }

    const camp = await db.camp.create({
      data: {
        name: name.trim(),
        location: typeof location === 'string' ? location.trim() || null : null,
        totalBedSpaces: typeof totalBedSpaces === 'number' ? Math.max(0, totalBedSpaces) : 0,
        isActive: typeof isActive === 'boolean' ? isActive : true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: camp.id,
        name: camp.name,
        location: camp.location,
        totalBedSpaces: camp.totalBedSpaces,
        isActive: camp.isActive,
        createdAt: camp.createdAt.toISOString(),
        updatedAt: camp.updatedAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[camps POST] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
