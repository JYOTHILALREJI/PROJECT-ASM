import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/uniform-registry - List all uniform registry entries
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const siteName = searchParams.get('siteName') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const skip = (page - 1) * limit;

    // Build where clause - always exclude deleted records
    const where: Record<string, unknown> = { isDeleted: false };

    if (search) {
      const orConditions: Record<string, unknown>[] = [
        { employeeName: { contains: search, mode: 'insensitive' } },
        { documentNumber: { contains: search, mode: 'insensitive' } },
      ];
      const tokenNum = parseInt(search, 10);
      if (!isNaN(tokenNum)) {
        orConditions.push({ tokenNumber: tokenNum });
      }
      where.OR = orConditions;
    }

    if (siteName) {
      where.siteName = siteName;
    }

    const [entries, total] = await Promise.all([
      db.uniformRegistry.findMany({
        where,
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
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.uniformRegistry.count({ where }),
    ]);

    // Serialize dates as ISO strings
    const serialized = entries.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      renewalDate: entry.renewalDate.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      data: {
        entries: serialized,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[UNIFORM_REGISTRY_GET]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch uniform registry entries' },
      { status: 500 }
    );
  }
}

// POST /api/uniform-registry - Create a new uniform registry entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      employeeName,
      employeeId,
      documentType,
      documentNumber,
      items,
      siteName,
      teamLeaderName,
      isRenewal,
      previousTokenId,
    } = body;

    // Validate required fields
    if (!employeeName || !employeeId || !documentType || !documentNumber || !items) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: employeeName, employeeId, documentType, documentNumber, items' },
        { status: 400 }
      );
    }

    // Validate documentType
    if (!['id', 'passport'].includes(documentType)) {
      return NextResponse.json(
        { success: false, error: 'documentType must be "id" or "passport"' },
        { status: 400 }
      );
    }

    // Validate that the employee exists
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    // Auto-increment tokenNumber: find max tokenNumber and add 1
    const maxToken = await db.uniformRegistry.findFirst({
      orderBy: { tokenNumber: 'desc' },
      select: { tokenNumber: true },
    });
    const tokenNumber = (maxToken?.tokenNumber ?? 0) + 1;

    // Use provided createdAt or default to now
    const createdAtDate = body.createdAt ? new Date(body.createdAt) : new Date();
    // Calculate renewalDate = createdAt + 6 months
    const renewalDate = new Date(createdAtDate);
    renewalDate.setMonth(renewalDate.getMonth() + 6);

    // If employee has no site and a site is provided, assign the site to the employee
    if (siteName && !employee.currentSite) {
      await db.employee.update({
        where: { id: employeeId },
        data: { currentSite: siteName },
      });
    }

    const entry = await db.uniformRegistry.create({
      data: {
        tokenNumber,
        employeeName,
        employeeId,
        documentType,
        documentNumber,
        items: typeof items === 'string' ? items : JSON.stringify(items),
        siteName: siteName || null,
        teamLeaderName: teamLeaderName || null,
        isRenewal: isRenewal ?? false,
        previousTokenId: previousTokenId || null,
        createdAt: createdAtDate,
        renewalDate,
      },
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

    return NextResponse.json(
      {
        success: true,
        data: {
          entry: {
            ...entry,
            createdAt: entry.createdAt.toISOString(),
            renewalDate: entry.renewalDate.toISOString(),
          },
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[UNIFORM_REGISTRY_POST]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create uniform registry entry' },
      { status: 500 }
    );
  }
}
