import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { allocateEmployeeHours } from '@/lib/allocation-engine';

// GET /api/salary-records?siteId=xxx&month=YYYY-MM&year=YYYY
// If siteId is not provided, returns all records for the month (for consolidated view)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId');
    const month = searchParams.get('month'); // YYYY-MM
    const yearStr = searchParams.get('year');

    if (!month) {
      return NextResponse.json(
        { success: false, error: 'month query parameter is required' },
        { status: 400 }
      );
    }

    const yearNum = yearStr ? parseInt(yearStr, 10) : parseInt(month.split('-')[0], 10);

    const where: Record<string, unknown> = {
      month,
      year: yearNum,
      isDeleted: false,
    };

    if (siteId) {
      where.siteId = siteId;
    }

    const records = await db.salaryRecord.findMany({
      where,
      orderBy: [{ slNo: 'asc' }, { empName: 'asc' }],
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            currentSite: true,
            trade: true,
            nationality: true,
            customHourlyRate: true,
            isTeamLeader: true,
            isSupervisor: true,
            role: true,
          },
        },
      },
    });

    // If no siteId filter, also compute site summaries for consolidated view
    let siteSummaries: Array<{
      siteId: string;
      siteName: string;
      clientName: string | null;
      employeeCount: number;
      totalHours: number;
      totalBelowThresholdHours: number;
      totalAboveThresholdHours: number;
      totalSalary: number;
      totalGrossSalary: number;
      totalDeductions: number;
      totalAdvances: number;
      netBalance: number;
      paidCount: number;
      totalRecords: number;
      employees: typeof records;
    }> = [];

    let totals: {
      totalSites: number;
      totalEmployees: number;
      totalHours: number;
      totalBelowThresholdHours: number;
      totalAboveThresholdHours: number;
      totalSalary: number;
      totalGrossSalary: number;
      totalDeductions: number;
      totalAdvances: number;
      netBalance: number;
      paidCount: number;
      totalRecords: number;
    } | null = null;

    if (!siteId) {
      // Group records by site
      const siteMap = new Map<string, typeof records>();
      for (const record of records) {
        const key = record.siteId;
        if (!siteMap.has(key)) {
          siteMap.set(key, []);
        }
        siteMap.get(key)!.push(record);
      }

      // Fetch site details
      const sites = await db.site.findMany({
        where: { id: { in: Array.from(siteMap.keys()) } },
        select: { id: true, name: true, clientName: true },
      });
      const siteInfoMap = new Map(sites.map(s => [s.id, s]));

      // Helper: compute divisor-based gross salary for a set of records
      const computeGrossSalary = (recs: typeof records) => {
        // Merge records by empId
        const empMap = new Map<string, { belowHours: number; aboveHours: number; isTL: boolean; isSup: boolean; customRate: number | null }>();
        for (const r of recs) {
          const empKey = r.empId;
          if (!empMap.has(empKey)) {
            empMap.set(empKey, {
              belowHours: 0,
              aboveHours: 0,
              isTL: r.employee?.isTeamLeader ?? false,
              isSup: r.employee?.isSupervisor ?? false,
              customRate: r.employee?.customHourlyRate ?? null,
            });
          }
          const entry = empMap.get(empKey)!;
          if (r.rateTier === 'standard') {
            entry.belowHours += r.totalHours;
          } else if (r.rateTier === 'premium') {
            entry.aboveHours += r.totalHours;
          }
        }

        let gross = 0;
        for (const [, emp] of empMap) {
          if (emp.customRate !== null && emp.customRate > 0) {
            gross += (emp.belowHours + emp.aboveHours) * emp.customRate;
          } else {
            const hasBonus = emp.isTL || emp.isSup;
            const lowDivisor = hasBonus ? 3.0 : 1.0;
            const highDivisor = hasBonus ? 5.5 : 1.0;
            gross += (emp.belowHours * 2.5) / lowDivisor + (emp.aboveHours * 5.0) / highDivisor;
          }
        }
        return gross;
      };

      // Build site summaries
      for (const [sId, sRecords] of siteMap) {
        const siteInfo = siteInfoMap.get(sId);
        const belowHours = sRecords.filter(r => r.rateTier === 'standard').reduce((sum, r) => sum + r.totalHours, 0);
        const aboveHours = sRecords.filter(r => r.rateTier === 'premium').reduce((sum, r) => sum + r.totalHours, 0);

        siteSummaries.push({
          siteId: sId,
          siteName: siteInfo?.name || sRecords[0]?.siteName || 'Unknown',
          clientName: siteInfo?.clientName || null,
          employeeCount: new Set(sRecords.map(r => r.empId)).size,
          totalHours: sRecords.reduce((sum, r) => sum + r.totalHours, 0),
          totalBelowThresholdHours: belowHours,
          totalAboveThresholdHours: aboveHours,
          totalSalary: sRecords.reduce((sum, r) => sum + r.totalSalary, 0),
          totalGrossSalary: computeGrossSalary(sRecords),
          totalDeductions: sRecords.filter(r => r.rateTier === 'standard').reduce((sum, r) => sum + r.deduction, 0),
          totalAdvances: sRecords.filter(r => r.rateTier === 'standard').reduce((sum, r) => sum + r.advance, 0),
          netBalance: sRecords.reduce((sum, r) => sum + r.balanceSalary, 0),
          paidCount: new Set(sRecords.filter(r => r.isPaid).map(r => r.empId)).size,
          totalRecords: sRecords.length,
          employees: sRecords,
        });
      }

      // Sort by site name
      siteSummaries.sort((a, b) => a.siteName.localeCompare(b.siteName));

      // Grand totals
      const allBelowHours = records.filter(r => r.rateTier === 'standard').reduce((sum, r) => sum + r.totalHours, 0);
      const allAboveHours = records.filter(r => r.rateTier === 'premium').reduce((sum, r) => sum + r.totalHours, 0);

      totals = {
        totalSites: siteSummaries.length,
        totalEmployees: new Set(records.map(r => r.empId)).size,
        totalHours: records.reduce((sum, r) => sum + r.totalHours, 0),
        totalBelowThresholdHours: allBelowHours,
        totalAboveThresholdHours: allAboveHours,
        totalSalary: records.reduce((sum, r) => sum + r.totalSalary, 0),
        totalGrossSalary: computeGrossSalary(records),
        totalDeductions: records.filter(r => r.rateTier === 'standard').reduce((sum, r) => sum + r.deduction, 0),
        totalAdvances: records.filter(r => r.rateTier === 'standard').reduce((sum, r) => sum + r.advance, 0),
        netBalance: records.reduce((sum, r) => sum + r.balanceSalary, 0),
        paidCount: new Set(records.filter(r => r.isPaid).map(r => r.empId)).size,
        totalRecords: new Set(records.map(r => r.empId)).size,
      };
    }

    return NextResponse.json({
      success: true,
      data: { records, siteSummaries, totals },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// POST /api/salary-records - Generate salary records from attendance
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { siteId, siteName, month, year, generateFromAttendance } = body;

    if (!siteId || !siteName || !month || !year) {
      return NextResponse.json(
        { success: false, error: 'siteId, siteName, month, and year are required' },
        { status: 400 }
      );
    }

    if (!generateFromAttendance) {
      return NextResponse.json(
        { success: false, error: 'Only generateFromAttendance mode is supported' },
        { status: 400 }
      );
    }

    // Find the site to get its name for matching employees
    const site = await db.site.findUnique({ where: { id: siteId } });
    if (!site) {
      return NextResponse.json(
        { success: false, error: 'Site not found' },
        { status: 404 }
      );
    }

    // Get all active employees at this site via currentSite assignment
    const currentSiteEmployees = await db.employee.findMany({
      where: {
        currentSite: site.name,
        status: 'active',
      },
      orderBy: { employeeId: 'asc' },
    });

    // Also get employees assigned to this site via EmpCountSitePerMonth for the specific month
    // This captures employees who were at the site in that month even if they've since moved
    const siteMonthRecords = await db.empCountSitePerMonth.findMany({
      where: {
        siteId,
        month,
        deletedDate: null,
      },
      select: { empId: true },
    });
    const empIdsFromHistory = siteMonthRecords.map(r => r.empId);

    // Merge both sources: currentSite employees + history employees for this month
    const allEmpIds = new Set(currentSiteEmployees.map(e => e.id));
    // Fetch any history employees not already in the currentSite list
    const historyOnlyIds = empIdsFromHistory.filter(id => !allEmpIds.has(id));

    let historyEmployees: typeof currentSiteEmployees = [];
    if (historyOnlyIds.length > 0) {
      historyEmployees = await db.employee.findMany({
        where: {
          id: { in: historyOnlyIds },
          status: 'active',
        },
        orderBy: { employeeId: 'asc' },
      });
    }

    const employees = [...currentSiteEmployees, ...historyEmployees];

    if (employees.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No active employees found at this site' },
        { status: 400 }
      );
    }

    // Soft-delete existing salary records for this site+month
    await db.salaryRecord.updateMany({
      where: {
        siteId,
        month,
        year,
        isDeleted: false,
      },
      data: { isDeleted: true },
    });

    // Get working hours for employees at this site for this month
    const workingHours = await db.totalEmployeeWorkingHours.findMany({
      where: {
        month,
        isDeleted: false,
      },
    });

    const workingHoursMap = new Map<string, { totalWorkingHours: number; rtPerHour: number; isCustom: boolean }>();
    for (const wh of workingHours) {
      workingHoursMap.set(wh.empId, {
        totalWorkingHours: wh.totalWorkingHours,
        rtPerHour: wh.rtPerHour,
        isCustom: wh.isCustom,
      });
    }

    // Get attendance-based hours calculation for employees at this site
    const attendanceRecords = await db.attendance.findMany({
      where: {
        date: { startsWith: month },
        isHidden: false,
      },
    });

    // Calculate total hours per employee from attendance
    const attendanceHoursMap = new Map<string, { presentDays: number; overtimeHours: number; absentDays: number }>();
    for (const att of attendanceRecords) {
      const existing = attendanceHoursMap.get(att.employeeId) || { presentDays: 0, overtimeHours: 0, absentDays: 0 };
      if (att.status === 'present') {
        existing.presentDays += 1;
      } else if (att.status === 'overtime') {
        existing.overtimeHours += att.overtimeHours || 0;
        existing.presentDays += 1; // overtime also counts as present
      } else if (att.status === 'absent') {
        existing.absentDays += 1;
      }
      attendanceHoursMap.set(att.employeeId, existing);
    }

    // Create salary records with standard rate tier initially
    // The allocation engine will re-split them into standard/premium based on cumulative hours
    let created = 0;
    let slNo = 1;

    for (const emp of employees) {
      // Get total hours: prefer working hours table, fallback to attendance calculation
      const whData = workingHoursMap.get(emp.id);
      const attData = attendanceHoursMap.get(emp.id);

      let totalHours = 0;

      if (whData) {
        totalHours = whData.totalWorkingHours;
      } else if (attData) {
        // Estimate: each present day = 8 hours + overtime hours
        totalHours = attData.presentDays * 8 + attData.overtimeHours;
      }

      // Determine rate based on employee type (divisor-based formula)
      const hasBonus = emp.isTeamLeader || emp.isSupervisor;
      const lowDivisor = hasBonus ? 3.0 : 1.0;
      const rtPerHour = 2.5 / lowDivisor;  // Standard: 2.5, TL/Sup: 0.8333

      const totalSalary = totalHours * rtPerHour;
      const deduction = 0;
      const advance = 0;
      const balanceSalary = totalSalary - deduction - advance;

      await db.salaryRecord.create({
        data: {
          empId: emp.id,
          empName: emp.fullName,
          siteId,
          siteName: site.name,
          month,
          year,
          nationality: emp.nationality || '',
          trade: emp.trade || emp.position || '',
          employeeCode: emp.employeeId,
          slNo,
          totalHours,
          rtPerHour,
          totalSalary,
          deduction,
          advance,
          balanceSalary,
          isPaid: false,
          rateTier: 'standard',
        },
      });

      created++;
      slNo++;
    }

    // Run the allocation engine to properly split hours into standard/premium rate tiers
    // This ensures the cumulative hours threshold is applied correctly across years
    try {
      await allocateEmployeeHours(month, year);
    } catch (allocError) {
      console.error('[salary-records POST] Allocation engine error:', allocError);
      // Don't fail the request, just log the error - records are still created
    }

    return NextResponse.json({
      success: true,
      data: {
        created,
        message: `${created} salary records generated for ${site.name}`,
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

// PUT /api/salary-records - Update individual salary record
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, totalHours, deduction, advance, rtPerHour, isPaid } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Record id is required' },
        { status: 400 }
      );
    }

    const existing = await db.salaryRecord.findUnique({ where: { id } });
    if (!existing || existing.isDeleted) {
      return NextResponse.json(
        { success: false, error: 'Salary record not found' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};

    if (typeof totalHours === 'number') {
      updateData.totalHours = Math.max(0, totalHours);
    }
    if (typeof deduction === 'number') {
      updateData.deduction = Math.max(0, deduction);
    }
    if (typeof advance === 'number') {
      updateData.advance = Math.max(0, advance);
    }
    if (typeof rtPerHour === 'number') {
      updateData.rtPerHour = Math.max(0, rtPerHour);
    }
    if (typeof isPaid === 'boolean') {
      updateData.isPaid = isPaid;
    }

    // Recalculate totalSalary and balanceSalary using new values if provided
    const newTotalHours = typeof totalHours === 'number' ? Math.max(0, totalHours) : existing.totalHours;
    const newRtPerHour = typeof rtPerHour === 'number' ? Math.max(0, rtPerHour) : existing.rtPerHour;
    const newDeduction = typeof deduction === 'number' ? Math.max(0, deduction) : existing.deduction;
    const newAdvance = typeof advance === 'number' ? Math.max(0, advance) : existing.advance;

    const newTotalSalary = newTotalHours * newRtPerHour;
    const newBalanceSalary = newTotalSalary - newDeduction - newAdvance;

    updateData.totalSalary = newTotalSalary;
    updateData.balanceSalary = newBalanceSalary;

    const updated = await db.salaryRecord.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      data: { record: updated },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
