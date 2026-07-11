import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Helper: Sync WorkLog entry when working hours are updated.
 * Ensures Employee Hours Ledger (which reads from WorkLog) displays the data.
 */
async function syncWorkLogForEmployee(
  empId: string,
  month: string, // YYYY-MM
  totalWorkingHours: number,
): Promise<void> {
  try {
    const employee = await db.employee.findUnique({
      where: { id: empId },
      select: { currentSite: true },
    });
    let siteId = employee?.currentSite;
    if (!siteId) return;

    // Try to find site by ID first, then by name as fallback
    let siteExists = await db.site.findUnique({ where: { id: siteId } });
    if (!siteExists) {
      // currentSite might be a name instead of an ID — look up by name
      const siteByName = await db.site.findFirst({ where: { name: siteId } });
      if (siteByName) {
        siteId = siteByName.id;
      } else {
        return; // Site not found by ID or name
      }
    }

    const [yearStr, monthStr] = month.split('-');
    const yearNum = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) return;

    await db.workLog.upsert({
      where: {
        employeeId_siteId_year_month: {
          employeeId: empId,
          siteId,
          year: yearNum,
          month: monthNum,
        },
      },
      update: {
        hoursWorked: totalWorkingHours,
        deletedAt: null,
      },
      create: {
        employeeId: empId,
        siteId,
        year: yearNum,
        month: monthNum,
        hoursWorked: totalWorkingHours,
        allowances: 0,
        deductions: 0,
      },
    });
  } catch (error: unknown) {
    console.error('[accounts/working-hours] WorkLog sync failed:', error);
  }
}

// Helper: Calculate RT/HR based on aggregate working hours and team leader/supervisor status
function calculateRtPerHour(
  totalWorkingHours: number,
  isTeamLeader: boolean,
  isSupervisor: boolean,
  isCustom: boolean,
  customRtPerHour: number,
  threshold: number = 1000
): number {
  if (isCustom) return customRtPerHour;
  // Divisor-based formula: effective rate = tier rate / divisor
  const hasBonus = isTeamLeader || isSupervisor;
  const lowDivisor = hasBonus ? 3.0 : 1.0;
  const highDivisor = hasBonus ? 5.5 : 1.0;
  if (totalWorkingHours >= threshold) {
    return 5.0 / highDivisor;  // Standard: 5.0, TL/Sup: 0.9091
  }
  return 2.5 / lowDivisor;  // Standard: 2.5, TL/Sup: 0.8333
}

// GET: Get all working hours records (aggregated from monthly records)
// Or get available employees not yet in the table (available=true)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const empId = searchParams.get('empId');
    const available = searchParams.get('available');

    // If available=true, return employees NOT in TotalEmployeeWorkingHours
    if (available === 'true') {
      const existingRecords = await db.totalEmployeeWorkingHours.findMany({
        where: { isDeleted: false },
        distinct: ['empId'],
        select: { empId: true },
      });
      const existingEmpIds = [...new Set(existingRecords.map((r) => r.empId))];

      const employees = await db.employee.findMany({
        where: {
          id: { notIn: existingEmpIds },
          status: 'active',
        },
        select: {
          id: true,
          fullName: true,
          employeeId: true,
          trade: true,
          nationality: true,
          isTeamLeader: true,
          isSupervisor: true,
          currentSite: true,
          hoursThreshold: true,
        },
        orderBy: { fullName: 'asc' },
      });

      return NextResponse.json({
        success: true,
        data: { employees },
      });
    }

    // If a specific empId is requested, return that single record (aggregated)
    if (empId) {
      const monthlyRecords = await db.totalEmployeeWorkingHours.findMany({
        where: { empId, isDeleted: false },
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              employeeId: true,
              trade: true,
              nationality: true,
              isTeamLeader: true,
              isSupervisor: true,
              teamLeaderSiteId: true,
              currentSite: true,
              hoursThreshold: true,
            },
          },
        },
        orderBy: { month: 'asc' },
      });

      if (monthlyRecords.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Working hours record not found for this employee' },
          { status: 404 }
        );
      }

      const totalWorkingHours = monthlyRecords.reduce((sum, r) => sum + r.totalWorkingHours, 0);
      const hasCustom = monthlyRecords.some(r => r.isCustom);
      const latestRt = monthlyRecords[monthlyRecords.length - 1].rtPerHour;
      const emp = monthlyRecords[0].employee;

      const calculatedRtPerHour = calculateRtPerHour(
        totalWorkingHours,
        emp.isTeamLeader,
        emp.isSupervisor,
        hasCustom,
        latestRt,
        emp.hoursThreshold || 1000
      );

      return NextResponse.json({
        success: true,
        data: {
          record: {
            id: monthlyRecords[0].id,
            empId,
            empName: monthlyRecords[0].empName,
            totalWorkingHours,
            rtPerHour: hasCustom ? latestRt : calculatedRtPerHour,
            isCustom: hasCustom,
            calculatedRtPerHour,
            monthlyRecords: monthlyRecords.map(r => ({
              id: r.id,
              month: r.month,
              totalWorkingHours: r.totalWorkingHours,
              rtPerHour: r.rtPerHour,
              isCustom: r.isCustom,
            })),
            employee: emp,
          },
        },
      });
    }

    // Build where clause for search
    const whereClause: Record<string, unknown> = {};
    if (search) {
      whereClause.OR = [
        { empName: { contains: search } },
        { empId: { contains: search } },
        {
          employee: {
            OR: [
              { fullName: { contains: search } },
              { employeeId: { contains: search } },
              { trade: { contains: search } },
              { nationality: { contains: search } },
            ],
          },
        },
      ];
    }

    // Ensure soft-deleted records are excluded
    whereClause.isDeleted = false;

    // Get all monthly records, then aggregate by empId
    const allRecords = await db.totalEmployeeWorkingHours.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            trade: true,
            nationality: true,
            isTeamLeader: true,
            isSupervisor: true,
            teamLeaderSiteId: true,
            currentSite: true,
            hoursThreshold: true,
          },
        },
      },
      orderBy: [{ empName: 'asc' }, { month: 'asc' }],
    });

    // Group by empId and aggregate
    const empMap = new Map<string, {
      empId: string;
      empName: string;
      totalWorkingHours: number;
      rtPerHour: number;
      isCustom: boolean;
      employee: (typeof allRecords)[0]['employee'];
    }>();

    for (const record of allRecords) {
      const existing = empMap.get(record.empId);
      if (existing) {
        existing.totalWorkingHours += record.totalWorkingHours;
        existing.isCustom = existing.isCustom || record.isCustom;
        existing.rtPerHour = record.rtPerHour; // Use latest month's rate
      } else {
        empMap.set(record.empId, {
          empId: record.empId,
          empName: record.empName,
          totalWorkingHours: record.totalWorkingHours,
          rtPerHour: record.rtPerHour,
          isCustom: record.isCustom,
          employee: record.employee,
        });
      }
    }

    const formattedRecords = Array.from(empMap.values()).map((record) => {
      const calculatedRtPerHour = calculateRtPerHour(
        record.totalWorkingHours,
        record.employee.isTeamLeader,
        record.employee.isSupervisor,
        record.isCustom,
        record.rtPerHour,
        record.employee.hoursThreshold || 1000
      );

      return {
        id: '', // No single ID since this is aggregated
        empId: record.empId,
        empName: record.empName,
        totalWorkingHours: record.totalWorkingHours,
        rtPerHour: record.isCustom ? record.rtPerHour : calculatedRtPerHour,
        isCustom: record.isCustom,
        calculatedRtPerHour,
        employee: record.employee,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        records: formattedRecords,
        total: formattedRecords.length,
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

// POST: Create new working hours records
// Supports: single record or batch (employeeIds array) - creates initial monthly records
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { empId, empName, totalWorkingHours, rtPerHour, isCustom, employeeIds } = body;

    // Batch creation from AddEmployeeDialog
    if (employeeIds && Array.isArray(employeeIds) && employeeIds.length > 0) {
      const results: Array<{
        id: string;
        empId: string;
        empName: string;
        totalWorkingHours: number;
        rtPerHour: number;
        isCustom: boolean;
        calculatedRtPerHour: number;
        employee: {
          id: string;
          fullName: string;
          employeeId: string;
          trade: string | null;
          nationality: string | null;
          isTeamLeader: boolean;
          isSupervisor: boolean;
          hoursThreshold: number;
        };
      }> = [];
      for (const eid of employeeIds) {
        const employee = await db.employee.findUnique({
          where: { id: eid },
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            trade: true,
            nationality: true,
            isTeamLeader: true,
            isSupervisor: true,
            hoursThreshold: true,
          },
        });

        if (!employee) continue;

        // Check if any records already exist for this employee
        const existing = await db.totalEmployeeWorkingHours.findFirst({
          where: { empId: eid, isDeleted: false },
        });
        if (existing) continue;

        const calculatedRt = calculateRtPerHour(0, employee.isTeamLeader, employee.isSupervisor, false, 2.5, employee.hoursThreshold || 1000);

        // Create an initial record for current month
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        const record = await db.totalEmployeeWorkingHours.create({
          data: {
            empId: eid,
            empName: employee.fullName,
            month: currentMonth,
            totalWorkingHours: 0,
            rtPerHour: calculatedRt,
            isCustom: false,
          },
        });

        // Sync WorkLog entry so Employee Hours Ledger shows this data
        await syncWorkLogForEmployee(eid, currentMonth, 0);

        results.push({
          id: record.id,
          empId: record.empId,
          empName: record.empName,
          totalWorkingHours: record.totalWorkingHours,
          rtPerHour: record.rtPerHour,
          isCustom: record.isCustom,
          calculatedRtPerHour: calculatedRt,
          employee,
        });
      }

      return NextResponse.json({
        success: true,
        data: {
          created: results.length,
          records: results,
        },
      });
    }

    // Single record creation (legacy)
    if (!empId || !empName) {
      return NextResponse.json(
        { success: false, error: 'empId and empName are required' },
        { status: 400 }
      );
    }

    const employee = await db.employee.findUnique({
      where: { id: empId },
      select: {
        id: true, fullName: true, employeeId: true, trade: true,
        nationality: true, isTeamLeader: true, isSupervisor: true,
        teamLeaderSiteId: true, currentSite: true, hoursThreshold: true,
      },
    });

    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    const parsedTotalHours = typeof totalWorkingHours === 'number' ? totalWorkingHours : 0;
    const parsedIsCustom = typeof isCustom === 'boolean' ? isCustom : false;
    const parsedRtPerHour = typeof rtPerHour === 'number' ? rtPerHour : 2.5;

    const calculatedRtPerHour = calculateRtPerHour(
      parsedTotalHours, employee.isTeamLeader, employee.isSupervisor, parsedIsCustom, parsedRtPerHour, employee.hoursThreshold || 1000
    );

    // Create for current month
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const record = await db.totalEmployeeWorkingHours.upsert({
      where: { empId_month: { empId, month: currentMonth } },
      update: {
        empName,
        totalWorkingHours: parsedTotalHours,
        rtPerHour: parsedIsCustom ? parsedRtPerHour : calculatedRtPerHour,
        isCustom: parsedIsCustom,
        isDeleted: false,
      },
      create: {
        empId,
        empName,
        month: currentMonth,
        totalWorkingHours: parsedTotalHours,
        rtPerHour: parsedIsCustom ? parsedRtPerHour : calculatedRtPerHour,
        isCustom: parsedIsCustom,
      },
    });

    // Sync WorkLog entry so Employee Hours Ledger shows this data
    await syncWorkLogForEmployee(empId, currentMonth, record.totalWorkingHours);

    return NextResponse.json({
      success: true,
      data: {
        record: {
          id: record.id,
          empId: record.empId,
          empName: record.empName,
          totalWorkingHours: record.totalWorkingHours,
          rtPerHour: record.rtPerHour,
          isCustom: record.isCustom,
          calculatedRtPerHour,
          employee,
        },
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

// PUT: Update a working hours record - update aggregate by setting specific month's hours
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, empId, totalWorkingHours, rtPerHour, isCustom, empName, month } = body;

    if (!id && !empId) {
      return NextResponse.json(
        { success: false, error: 'Either id or empId is required' },
        { status: 400 }
      );
    }

    // If empId is provided without specific month, this is an aggregate update from Manage Working Hours
    // We need to find or create a record for the current month
    if (empId && !month) {
      const existingRecords = await db.totalEmployeeWorkingHours.findMany({
        where: { empId, isDeleted: false },
        include: {
          employee: {
            select: {
              id: true, fullName: true, employeeId: true, trade: true,
              nationality: true, isTeamLeader: true, isSupervisor: true,
              teamLeaderSiteId: true, currentSite: true, hoursThreshold: true,
            },
          },
        },
        orderBy: { month: 'desc' },
      });

      if (existingRecords.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Working hours record not found' },
          { status: 404 }
        );
      }

      const emp = existingRecords[0].employee;
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // Find or create current month record
      let currentMonthRecord = existingRecords.find(r => r.month === currentMonth);
      const finalIsCustom = typeof isCustom === 'boolean' ? isCustom : existingRecords.some(r => r.isCustom);

      if (!currentMonthRecord) {
        // Create for current month
        const calculatedRt = calculateRtPerHour(
          typeof totalWorkingHours === 'number' ? totalWorkingHours : 0,
          emp.isTeamLeader, emp.isSupervisor, finalIsCustom,
          typeof rtPerHour === 'number' ? rtPerHour : 2.5,
          emp.hoursThreshold || 1000
        );

        currentMonthRecord = await db.totalEmployeeWorkingHours.create({
          data: {
            empId,
            empName: emp.fullName,
            month: currentMonth,
            totalWorkingHours: typeof totalWorkingHours === 'number' ? totalWorkingHours : 0,
            rtPerHour: finalIsCustom ? (typeof rtPerHour === 'number' ? rtPerHour : calculatedRt) : calculatedRt,
            isCustom: finalIsCustom,
          },
          include: { employee: true },
        });
      } else {
        // Update current month record
        const finalTotalHours = typeof totalWorkingHours === 'number' ? totalWorkingHours : currentMonthRecord.totalWorkingHours;
        const calculatedRt = calculateRtPerHour(
          finalTotalHours, emp.isTeamLeader, emp.isSupervisor, finalIsCustom,
          typeof rtPerHour === 'number' ? rtPerHour : currentMonthRecord.rtPerHour,
          emp.hoursThreshold || 1000
        );

        currentMonthRecord = await db.totalEmployeeWorkingHours.update({
          where: { id: currentMonthRecord.id },
          data: {
            totalWorkingHours: finalTotalHours,
            rtPerHour: finalIsCustom ? (typeof rtPerHour === 'number' ? rtPerHour : calculatedRt) : calculatedRt,
            isCustom: finalIsCustom,
            empName: typeof empName === 'string' ? empName : emp.fullName,
          },
          include: { employee: true },
        });
      }

      // Calculate aggregate total
      const allRecords = await db.totalEmployeeWorkingHours.findMany({
        where: { empId, isDeleted: false },
        select: { totalWorkingHours: true, rtPerHour: true, isCustom: true },
      });
      const aggregateTotal = allRecords.reduce((sum, r) => sum + r.totalWorkingHours, 0);
      const anyCustom = allRecords.some(r => r.isCustom);
      const latestRate = allRecords[allRecords.length - 1]?.rtPerHour || 2.5;

      const aggregateRt = calculateRtPerHour(
        aggregateTotal, emp.isTeamLeader, emp.isSupervisor, anyCustom, latestRate,
        emp.hoursThreshold || 1000
      );

      // Bidirectional sync: update salary records
      if (typeof rtPerHour === 'number' || typeof totalWorkingHours === 'number') {
        const salaryRecords = await db.salaryRecord.findMany({
          where: { empId, isDeleted: false },
        });
        for (const sr of salaryRecords) {
          const newTotalSalary = sr.totalHours * (anyCustom ? latestRate : aggregateRt);
          const newBalanceSalary = newTotalSalary - sr.deduction - sr.advance;
          await db.salaryRecord.update({
            where: { id: sr.id },
            data: { rtPerHour: anyCustom ? latestRate : aggregateRt, totalSalary: newTotalSalary, balanceSalary: newBalanceSalary },
          });
        }
      }

      // Sync WorkLog entry so Employee Hours Ledger shows this data
      await syncWorkLogForEmployee(empId, currentMonth, currentMonthRecord.totalWorkingHours);

      return NextResponse.json({
        success: true,
        data: {
          record: {
            id: currentMonthRecord.id,
            empId,
            empName: currentMonthRecord.empName,
            totalWorkingHours: aggregateTotal,
            rtPerHour: anyCustom ? latestRate : aggregateRt,
            isCustom: anyCustom,
            calculatedRtPerHour: aggregateRt,
            employee: emp,
          },
        },
      });
    }

    // If specific month provided, update that specific month's record
    if (empId && month) {
      const upserted = await db.totalEmployeeWorkingHours.upsert({
        where: { empId_month: { empId, month } },
        update: {
          totalWorkingHours: typeof totalWorkingHours === 'number' ? totalWorkingHours : undefined,
          rtPerHour: typeof rtPerHour === 'number' ? rtPerHour : undefined,
          isCustom: typeof isCustom === 'boolean' ? isCustom : undefined,
          empName: typeof empName === 'string' ? empName : undefined,
          isDeleted: false,
        },
        create: {
          empId,
          empName: empName || '',
          month,
          totalWorkingHours: typeof totalWorkingHours === 'number' ? totalWorkingHours : 0,
          rtPerHour: typeof rtPerHour === 'number' ? rtPerHour : 2.5,
          isCustom: typeof isCustom === 'boolean' ? isCustom : false,
        },
        include: {
          employee: {
            select: {
              id: true, fullName: true, employeeId: true, trade: true,
              nationality: true, isTeamLeader: true, isSupervisor: true,
              teamLeaderSiteId: true, currentSite: true, hoursThreshold: true,
            },
          },
        },
      });

      // Sync WorkLog entry so Employee Hours Ledger shows this data
      await syncWorkLogForEmployee(empId, month, upserted.totalWorkingHours);

      return NextResponse.json({
        success: true,
        data: {
          record: {
            id: upserted.id,
            empId: upserted.empId,
            empName: upserted.empName,
            totalWorkingHours: upserted.totalWorkingHours,
            rtPerHour: upserted.rtPerHour,
            isCustom: upserted.isCustom,
            month: upserted.month,
            employee: upserted.employee,
          },
        },
      });
    }

    // Update by id (single record)
    const existing = await db.totalEmployeeWorkingHours.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!existing || existing.isDeleted) {
      return NextResponse.json(
        { success: false, error: 'Working hours record not found' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (typeof empName === 'string') updateData.empName = empName;
    if (typeof totalWorkingHours === 'number') updateData.totalWorkingHours = totalWorkingHours;

    const finalIsCustom = typeof isCustom === 'boolean' ? isCustom : existing.isCustom;
    updateData.isCustom = finalIsCustom;

    const finalTotalHours = typeof totalWorkingHours === 'number' ? totalWorkingHours : existing.totalWorkingHours;
    const finalCustomRtPerHour = typeof rtPerHour === 'number' ? rtPerHour : existing.rtPerHour;

    if (finalIsCustom) {
      updateData.rtPerHour = typeof rtPerHour === 'number' ? rtPerHour : existing.rtPerHour;
    } else {
      const calculatedRt = calculateRtPerHour(
        finalTotalHours, existing.employee?.isTeamLeader || false,
        existing.employee?.isSupervisor || false, false, finalCustomRtPerHour,
        existing.employee?.hoursThreshold || 1000
      );
      updateData.rtPerHour = calculatedRt;
    }

    const updated = await db.totalEmployeeWorkingHours.update({
      where: { id: existing.id },
      data: updateData,
      include: { employee: true },
    });

    // Sync WorkLog entry so Employee Hours Ledger shows this data
    await syncWorkLogForEmployee(updated.empId, updated.month, updated.totalWorkingHours);

    return NextResponse.json({
      success: true,
      data: {
        record: {
          id: updated.id,
          empId: updated.empId,
          empName: updated.empName,
          totalWorkingHours: updated.totalWorkingHours,
          rtPerHour: updated.rtPerHour,
          isCustom: updated.isCustom,
          month: updated.month,
          employee: updated.employee,
        },
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
