import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto';

// Helper: decrypt sensitive fields on read
function decryptEmployee(employee: Record<string, unknown>) {
  if (employee.passportNumber) {
    employee.passportNumber = decrypt(employee.passportNumber as string);
  }
  if (employee.idNumber) {
    employee.idNumber = decrypt(employee.idNumber as string);
  }
  return employee;
}

// Generate auto employeeId: ASM-YYYY-NNN
async function generateEmployeeId(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ASM-${year}-`;

  const employees = await db.employee.findMany({
    where: {
      employeeId: {
        startsWith: prefix,
      },
    },
    select: { employeeId: true },
    orderBy: { employeeId: 'desc' },
  });

  let nextNum = 1;
  if (employees.length > 0) {
    const lastId = employees[0].employeeId;
    const lastNum = parseInt(lastId.split('-')[2], 10);
    nextNum = lastNum + 1;
  }

  return `${prefix}${String(nextNum).padStart(3, '0')}`;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const skip = (page - 1) * limit;

    // Advanced filters
    const siteFilter = searchParams.get('site') || '';
    const tradeFilter = searchParams.get('trade') || '';
    const idleFilter = searchParams.get('idle') || '';
    const teamLeaderFilter = searchParams.get('teamLeaders') || '';
    const supervisorFilter = searchParams.get('supervisors') || '';
    const branchFilter = searchParams.get('branchId') || '';

    const where: Record<string, unknown> = {
      status: { not: 'deleted' },
    };

    if (status && status !== 'all') {
      where.status = status;
    }

    if (siteFilter) {
      where.currentSite = siteFilter;
    }

    if (branchFilter) {
      where.branchId = branchFilter;
    }

    if (tradeFilter) {
      where.trade = tradeFilter;
    }

    // Idle workers: no site assigned
    if (idleFilter === '1' || idleFilter === 'true') {
      where.OR = [
        { currentSite: null },
        { currentSite: '' },
        { currentSite: 'Idle' },
      ];
    }

    // Team Leaders filter
    if (teamLeaderFilter === '1' || teamLeaderFilter === 'true') {
      where.isTeamLeader = true;
    }

    // Supervisors filter
    if (supervisorFilter === '1' || supervisorFilter === 'true') {
      where.isSupervisor = true;
    }

    if (search && !idleFilter) {
      where.OR = [
        { fullName: { contains: search } },
        { employeeId: { contains: search } },
        { nationality: { contains: search } },
        { phone: { contains: search } },
        { position: { contains: search } },
        { trade: { contains: search } },
        { companyName: { contains: search } },
      ];
    } else if (search && idleFilter) {
      // For idle filter + search, combine with AND
      const idleConditions = [
        { currentSite: null },
        { currentSite: '' },
        { currentSite: 'Idle' },
      ];
      where.OR = idleConditions.map(cond => ({
        ...cond,
        OR: [
          { fullName: { contains: search } },
          { employeeId: { contains: search } },
          { nationality: { contains: search } },
          { phone: { contains: search } },
          { trade: { contains: search } },
        ],
      }));
    }

    const [employees, total] = await Promise.all([
      db.employee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      db.employee.count({ where }),
    ]);

    const decryptedEmployees = employees.map((emp) =>
      decryptEmployee({ ...emp, dateOfBirth: emp.dateOfBirth?.toISOString() || null, joinDate: emp.joinDate?.toISOString() || null, createdAt: emp.createdAt.toISOString(), updatedAt: emp.updatedAt.toISOString() })
    );

    // Get distinct trades for filter dropdowns
    const trades = await db.employee.findMany({
      where: { trade: { not: null }, status: { not: 'deleted' } },
      select: { trade: true },
      distinct: ['trade'],
    });

    // Count idle employees
    const idleCount = await db.employee.count({
      where: {
        OR: [
          { currentSite: null },
          { currentSite: '' },
          { currentSite: 'Idle' },
        ],
        status: { not: 'deleted' },
      },
    });

    // Count team leaders and supervisors
    const [teamLeaderCount, supervisorCount] = await Promise.all([
      db.employee.count({
        where: { isTeamLeader: true, status: { not: 'deleted' } },
      }),
      db.employee.count({
        where: { isSupervisor: true, status: { not: 'deleted' } },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        employees: decryptedEmployees,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        trades: trades.map(t => t.trade).filter(Boolean).sort(),
        idleCount,
        teamLeaderCount,
        supervisorCount,
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

    if (!body.fullName) {
      return NextResponse.json(
        { success: false, error: 'Full name is required' },
        { status: 400 }
      );
    }

    // Generate employee ID if not provided
    const employeeId = (body.employeeId && body.employeeId.trim()) || (await generateEmployeeId());

    // Check uniqueness
    const existing = await db.employee.findUnique({
      where: { employeeId },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Employee ID already exists' },
        { status: 409 }
      );
    }

    // Validate team leader assignment
    const isTeamLeader = body.isTeamLeader === true;
    const teamLeaderSiteId = body.teamLeaderSiteId || null;

    if (isTeamLeader && teamLeaderSiteId) {
      const existingLeader = await db.employee.findFirst({
        where: {
          isTeamLeader: true,
          teamLeaderSiteId,
          status: { not: 'deleted' },
        },
      });
      if (existingLeader) {
        return NextResponse.json(
          { success: false, error: `Another employee (${existingLeader.fullName}) is already team leader of this site. Remove them first.` },
          { status: 409 }
        );
      }
    }

    // Validate supervisor assignment
    const isSupervisor = body.isSupervisor === true;
    const supervisorSiteId = body.supervisorSiteId || null;

    if (isSupervisor && supervisorSiteId) {
      const existingSupervisor = await db.employee.findFirst({
        where: {
          isSupervisor: true,
          supervisorSiteId,
          status: { not: 'deleted' },
        },
      });
      if (existingSupervisor) {
        return NextResponse.json(
          { success: false, error: `Another employee (${existingSupervisor.fullName}) is already supervisor of this site. Remove them first.` },
          { status: 409 }
        );
      }
    }

    // Encrypt sensitive fields
    const data: Record<string, unknown> = {
      fullName: body.fullName,
      employeeId,
      nationality: body.nationality || null,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
      emergencyContact: body.emergencyContact || null,
      position: body.trade || body.position || null, // Backward compat: trade falls back to position
      trade: body.trade || null,
      joinDate: body.joinDate ? new Date(body.joinDate) : null,
      companyName: body.companyName || null,
      passportStatus: body.passportStatus || null,
      idStatus: body.idStatus || null,
      currentSite: body.currentSite || null,
      rating: 5,
      status: 'active',
      photo: body.photo || null,
      isTeamLeader,
      teamLeaderSiteId: isTeamLeader ? teamLeaderSiteId : null,
      isSupervisor,
      supervisorSiteId: isSupervisor ? supervisorSiteId : null,
      role: isSupervisor ? 'Supervisor' : (isTeamLeader ? 'Team Leader' : (body.role || 'Standard')),
      customHourlyRate: body.customHourlyRate != null ? body.customHourlyRate : null,
      currentTotalWorkingHours:
        body.currentTotalWorkingHours != null
          ? Math.max(0, parseFloat(body.currentTotalWorkingHours) || 0)
          : 0,
    };

    // Sync currentSiteId FK from the site name when provided
    if (body.currentSite) {
      const matchedSite = await db.site.findFirst({
        where: { name: body.currentSite, deletedAt: null },
        select: { id: true },
      });
      data.currentSiteId = matchedSite?.id ?? null;
    }

    if (body.passportNumber) {
      data.passportNumber = encrypt(body.passportNumber);
    }

    if (body.idNumber) {
      data.idNumber = encrypt(body.idNumber);
    }

    const employee = await db.employee.create({
      data: data as Parameters<typeof db.employee.create>[0]['data'],
    });

    const decrypted = decryptEmployee({
      ...employee,
      dateOfBirth: employee.dateOfBirth?.toISOString() || null,
      joinDate: employee.joinDate?.toISOString() || null,
      createdAt: employee.createdAt.toISOString(),
      updatedAt: employee.updatedAt.toISOString(),
    });

    return NextResponse.json(
      { success: true, data: { employee: decrypted } },
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
