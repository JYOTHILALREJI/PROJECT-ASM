import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { allocateEmployeeHours } from '@/lib/allocation-engine';

// GET: Get monthly hours data for a specific employee and year
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const empId = searchParams.get('empId');
    const yearParam = searchParams.get('year');

    if (!empId) {
      return NextResponse.json(
        { success: false, error: 'empId is required' },
        { status: 400 }
      );
    }

    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    if (isNaN(year)) {
      return NextResponse.json(
        { success: false, error: 'year must be a valid integer' },
        { status: 400 }
      );
    }

    // Get employee info
    const employee = await db.employee.findUnique({
      where: { id: empId },
      select: {
        id: true,
        fullName: true,
        employeeId: true,
        isTeamLeader: true,
        isSupervisor: true,
        hoursThreshold: true,
        customHourlyRate: true,
        role: true,
      },
    });

    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    // Get all monthly working hours records for this employee for the given year
    const yearPrefix = `${year}-`;
    const monthlyRecords = await db.totalEmployeeWorkingHours.findMany({
      where: {
        empId,
        month: { startsWith: yearPrefix },
        isDeleted: false,
      },
      orderBy: { month: 'asc' },
    });

    // Get aggregate total across all years using SALARY RECORDS as source of truth
    // This is consistent with the allocation engine and accounts GET route
    const allSalaryRecords = await db.salaryRecord.findMany({
      where: { empId, isDeleted: false },
      select: { totalHours: true, rtPerHour: true, month: true, rateTier: true },
    });
    const aggregateTotalHours = allSalaryRecords.reduce((sum, r) => sum + r.totalHours, 0);

    // Compute cumulative hours from ALL months before the current month (cross-year)
    // This is the same logic used in the allocation engine
    const previousCumulativeHours = allSalaryRecords
      .filter(r => r.month < `${year}-01`)
      .reduce((sum, r) => sum + r.totalHours, 0);

    // Also compute cumulative hours within the selected year up to the current month
    // This is used for the per-month cumulative display
    // PRD: If a month has NO hours worked (totalHours = 0), cumulative = 0
    // For months WITH hours, cumulative = running sum including that month (cross-year)
    const withinYearCumulative: Record<string, number> = {};
    const monthsInOrder: string[] = [];
    for (let m = 1; m <= 12; m++) {
      const monthStr = `${year}-${String(m).padStart(2, '0')}`;
      monthsInOrder.push(monthStr);
    }
    let runningTotal = previousCumulativeHours;
    for (const m of monthsInOrder) {
      const monthHours = allSalaryRecords
        .filter(r => r.month === m)
        .reduce((sum, r) => sum + r.totalHours, 0);
      // If this month has hours, cumulative = running total + this month's hours
      // If this month has NO hours, cumulative = 0 (drop to zero instead of trailing duplicate)
      withinYearCumulative[m] = monthHours > 0 ? runningTotal + monthHours : 0;
      runningTotal += monthHours; // running total always carries forward
    }

    // Get custom rate info from TotalEmployeeWorkingHours (all months)
    const allWhRecords = await db.totalEmployeeWorkingHours.findMany({
      where: { empId, isDeleted: false },
      select: { totalWorkingHours: true, rtPerHour: true, isCustom: true, month: true },
    });

    // Get the latest custom status and rate
    const hasCustom = allWhRecords.some(r => r.isCustom);
    const latestRate = allWhRecords.length > 0
      ? allWhRecords[allWhRecords.length - 1].rtPerHour
      : 2.5;

    // Auto-calculate the aggregate rate (direct rates — no divisors)
    const hasBonus = employee.isTeamLeader || employee.isSupervisor;
    const empThreshold = employee.hoursThreshold || 1000;
    // Direct hourly rates (PRD v2.0)
    const lowRate = employee.customHourlyRate != null
      ? employee.customHourlyRate
      : (hasBonus ? 3.0 : 2.5);
    const highRate = employee.customHourlyRate != null
      ? employee.customHourlyRate
      : (hasBonus ? 5.5 : 5.0);
    const autoRate = aggregateTotalHours >= empThreshold ? highRate : lowRate;

    // Build monthly data for all 12 months
    // Use SalaryRecord as source of truth for per-month hours (sum of standard + premium)
    const monthlyData: Array<{ month: string; totalHours: number; cumulativeHours: number; rtPerHour: number; recordId: string | null }> = [];
    for (let m = 0; m < 12; m++) {
      const monthStr = `${year}-${String(m + 1).padStart(2, '0')}`;
      const record = monthlyRecords.find((r) => r.month === monthStr);

      // Sum hours from salary records for this month (source of truth)
      const monthSalaryHours = allSalaryRecords
        .filter(r => r.month === monthStr)
        .reduce((sum, r) => sum + r.totalHours, 0);

      // Use salary record hours if available, fall back to TotalEmployeeWorkingHours
      const totalHours = monthSalaryHours > 0 ? monthSalaryHours : (record?.totalWorkingHours ?? 0);

      // Cumulative hours up to and including this month (cross-year)
      const cumulativeHours = withinYearCumulative[monthStr] || 0;

      monthlyData.push({
        month: monthStr,
        totalHours,
        cumulativeHours,
        rtPerHour: record?.rtPerHour ?? (hasCustom ? latestRate : autoRate),
        recordId: record?.id || null,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        monthlyData,
        employeeInfo: {
          isTeamLeader: employee.isTeamLeader,
          isSupervisor: employee.isSupervisor,
          totalWorkingHours: aggregateTotalHours,
          rtPerHour: hasCustom ? latestRate : autoRate,
          isCustom: hasCustom,
          hoursThreshold: empThreshold,
          previousCumulativeHours,
          previousYearHours: previousCumulativeHours,
          customHourlyRate: employee.customHourlyRate,
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[employee-monthly GET] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// PUT: Update monthly hours for a specific employee
// This endpoint handles saving per-month hours to TotalEmployeeWorkingHours
// and bidirectionally syncing with SalaryRecord
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { empId, year, monthlyData } = body;

    if (!empId || !year || !monthlyData || !Array.isArray(monthlyData)) {
      return NextResponse.json(
        { success: false, error: 'empId, year, and monthlyData are required' },
        { status: 400 }
      );
    }

    // Get employee info
    const employee = await db.employee.findUnique({
      where: { id: empId },
      select: {
        id: true,
        fullName: true,
        employeeId: true,
        isTeamLeader: true,
        isSupervisor: true,
        currentSite: true,
        currentSiteId: true,
      },
    });

    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    const results: Array<{ month: string; action: string; id: string; totalWorkingHours: number }> = [];
    const errors: Array<{ month: string; error: string }> = [];
    const monthsToReallocate = new Set<string>();

    for (const monthEntry of monthlyData) {
      const { month, totalHours, rtPerHour } = monthEntry;

      // Validate each entry
      if (!month || typeof month !== 'string') {
        errors.push({ month, error: 'Invalid month value' });
        continue;
      }

      const numTotalHours = typeof totalHours === 'number' ? totalHours : 0;
      const numRtPerHour = typeof rtPerHour === 'number' ? rtPerHour : 2.5;

      try {
        // Upsert into TotalEmployeeWorkingHours (per employee per month)
        const upserted = await db.totalEmployeeWorkingHours.upsert({
          where: {
            empId_month: { empId, month },
          },
          update: {
            totalWorkingHours: numTotalHours,
            rtPerHour: numRtPerHour,
            empName: employee.fullName,
            isDeleted: false,
          },
          create: {
            empId,
            empName: employee.fullName,
            month,
            totalWorkingHours: numTotalHours,
            rtPerHour: numRtPerHour,
            isCustom: false,
          },
        });
        results.push({ month, action: 'upserted', id: upserted.id, totalWorkingHours: upserted.totalWorkingHours });

        // Bidirectional sync: update SalaryRecord if records exist for this month
        const existingSalaryRecords = await db.salaryRecord.findMany({
          where: { empId, month, year: parseInt(String(year), 10), isDeleted: false },
        });

        const premiumRecords = existingSalaryRecords.filter(sr => sr.rateTier === 'premium');

        if (existingSalaryRecords.length > 0 && premiumRecords.length > 0) {
          // ── SPLIT RECORDS (standard + premium) exist ──
          // Consolidate: set the standard record's totalHours to the raw total hours,
          // soft-delete the premium record, then let the allocation engine re-split.
          // Group by site to handle multi-site correctly.
          const siteMap = new Map<string, { standard: typeof existingSalaryRecords[0] | undefined; premium: typeof existingSalaryRecords[0] | undefined }>();

          for (const sr of existingSalaryRecords) {
            if (!siteMap.has(sr.siteId)) {
              siteMap.set(sr.siteId, { standard: undefined, premium: undefined });
            }
            const group = siteMap.get(sr.siteId)!;
            if (sr.rateTier === 'standard') group.standard = sr;
            if (sr.rateTier === 'premium') group.premium = sr;
          }

          for (const [siteId, group] of siteMap) {
            // Compute raw hours for this site (standard + premium combined)
            const rawHoursForSite = (group.standard?.totalHours || 0) + (group.premium?.totalHours || 0);

            if (group.standard) {
              // Update the standard record with the raw (total) hours for this site
              const totalSalary = rawHoursForSite * numRtPerHour;
              await db.salaryRecord.update({
                where: { id: group.standard.id },
                data: {
                  totalHours: rawHoursForSite,
                  rtPerHour: numRtPerHour,
                  totalSalary,
                  balanceSalary: totalSalary - group.standard.deduction - group.standard.advance,
                },
              });
            }

            // Soft-delete the premium record so allocation engine can re-create it if needed
            if (group.premium) {
              await db.salaryRecord.update({
                where: { id: group.premium.id },
                data: { isDeleted: true },
              });
            }
          }

          // Mark this month for reallocation so the allocation engine re-splits based on threshold
          monthsToReallocate.add(month);
        } else if (existingSalaryRecords.length > 0) {
          // ── SINGLE RECORD TYPE (only standard or only premium) ──
          // Update it with the new hours and rate, then reallocate to ensure proper split
          const totalSalary = numTotalHours * numRtPerHour;
          for (const sr of existingSalaryRecords) {
            await db.salaryRecord.update({
              where: { id: sr.id },
              data: {
                totalHours: numTotalHours,
                rtPerHour: numRtPerHour,
                totalSalary,
                balanceSalary: totalSalary - sr.deduction - sr.advance,
              },
            });
          }
          // Mark this month for reallocation to ensure proper split
          monthsToReallocate.add(month);
        } else if (numTotalHours > 0) {
          // ── NO EXISTING RECORDS ──
          // Try to create a salary record if we can find a site
          const siteRecords = await db.empCountSitePerMonth.findMany({
            where: { empId, month, deletedDate: null },
            include: { site: { select: { id: true, name: true } } },
          });

          let siteId: string | null = null;
          let siteName = '';

          if (siteRecords.length > 0) {
            siteId = siteRecords[0].siteId;
            siteName = siteRecords[0].site.name;
          } else if (employee.currentSiteId) {
            const site = await db.site.findUnique({ where: { id: employee.currentSiteId } });
            if (site) {
              siteId = site.id;
              siteName = site.name;
            }
          }

          if (!siteId) {
            // Try any historical site assignment
            const anySiteRecord = await db.empCountSitePerMonth.findFirst({
              where: { empId },
              include: { site: { select: { id: true, name: true } } },
              orderBy: { createdDate: 'desc' },
            });
            if (anySiteRecord) {
              siteId = anySiteRecord.siteId;
              siteName = anySiteRecord.site.name;
            }
          }

          if (siteId) {
            const salaryYear = parseInt(month.split('-')[0], 10);
            const totalSalary = numTotalHours * numRtPerHour;
            await db.salaryRecord.create({
              data: {
                empId,
                empName: employee.fullName,
                siteId,
                siteName,
                month,
                year: salaryYear,
                nationality: '',
                trade: '',
                employeeCode: employee.employeeId,
                slNo: 0,
                totalHours: numTotalHours,
                rtPerHour: numRtPerHour,
                totalSalary,
                deduction: 0,
                advance: 0,
                balanceSalary: totalSalary,
                isPaid: false,
              },
            });
            // Mark this month for reallocation to ensure proper split
            monthsToReallocate.add(month);
          }
        }
      } catch (monthError: unknown) {
        const errMsg = monthError instanceof Error ? monthError.message : 'Unknown error';
        console.error(`[employee-monthly PUT] Error saving month ${month}:`, errMsg);
        errors.push({ month, error: errMsg });
      }
    }

    // Run the allocation engine for each unique month that was updated
    // This will re-split the consolidated hours into standard + premium based on the threshold
    for (const month of monthsToReallocate) {
      try {
        const salaryYear = parseInt(month.split('-')[0], 10);
        await allocateEmployeeHours(month, salaryYear);
      } catch (allocError: unknown) {
        const errMsg = allocError instanceof Error ? allocError.message : 'Unknown error';
        console.error(`[employee-monthly PUT] Error reallocating month ${month}:`, errMsg);
        // Don't fail the whole request, just log the error
      }
    }

    // Calculate aggregate total working hours across all months
    const allRecords = await db.totalEmployeeWorkingHours.findMany({
      where: { empId, isDeleted: false },
      select: { totalWorkingHours: true },
    });
    const aggregateTotalHours = allRecords.reduce((sum, r) => sum + r.totalWorkingHours, 0);

    return NextResponse.json({
      success: true,
      data: {
        updated: results.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
        totalWorkingHours: aggregateTotalHours,
        reallocatedMonths: Array.from(monthsToReallocate),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[employee-monthly PUT] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
