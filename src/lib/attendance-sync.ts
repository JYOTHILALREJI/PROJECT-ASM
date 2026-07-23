import { db } from '@/lib/db';
import { allocateEmployeeHours } from '@/lib/allocation-engine';
import { recalcEmployeeFromMonth } from '@/lib/recalculation';
import { buildTradeRateMap } from '@/lib/recalculation';
import { buildEmployeeTradeMap } from '@/lib/employee-trade';

// ---------------------------------------------------------------------------
// Attendance → Salary sync
// ---------------------------------------------------------------------------
// Business rule (per project owner):
//   When attendance is marked for an employee on a given day:
//     - status === "present"      → 10 hours for that day
//     - status === "overtime"     → 10 hours base + overtimeHours additional
//     - status === "camp_sitting" → 8 hours (NOT counted in lifetime/threshold)
//     - status === "absent"       → 0 hours
//     - status === "no_site"      → 0 hours
//     - status === "not_marked"   → 0 hours (treated as no entry)
//
// Camp Sitting (C) is special: the 8 hours ARE added to the monthly total
// for salary purposes, but they are NOT included in the lifetime cumulative
// hours that determine the low/high rate threshold. This is implemented by
// storing camp_sitting hours in a SEPARATE SalaryRecord with
// rateTier='camp_sitting'. The allocation engine excludes 'camp_sitting'
// records from the previousCumulative calculation and from the current
// month's threshold split.
//
// After upserting the salary records, the allocation engine is run for
// that month so that the standard/premium split is recomputed, and
// TotalEmployeeWorkingHours is updated accordingly.
// ---------------------------------------------------------------------------

export const HOURS_PER_PRESENT_DAY = 10;
export const HOURS_PER_CAMP_SITTING = 8;

/**
 * Compute the total working hours for an employee in a given month
 * based on attendance records.
 *
 * Returns both the total (including camp_sitting) and the camp_sitting
 * component separately so the caller can store them in different
 * SalaryRecord rateTiers.
 *
 * Rules:
 *   present      → 10 hours
 *   overtime     → 10 + overtimeHours
 *   camp_sitting → 8 hours (tracked separately)
 *   absent       → 0
 *   no_site      → 0
 *   not_marked   → 0
 */
export async function computeMonthlyHoursFromAttendance(
  employeeId: string,
  month: string, // YYYY-MM
): Promise<{ totalHours: number; regularHours: number; campSittingHours: number }> {
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  if (!year || !monthNum) return { totalHours: 0, regularHours: 0, campSittingHours: 0 };

  const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(monthNum).padStart(2, '0')}-31`;

  const records = await db.attendance.findMany({
    where: {
      employeeId,
      date: { gte: startDate, lt: endDate },
      deletedAt: null,
    },
  });

  let regularHours = 0;
  let campSittingHours = 0;
  for (const r of records) {
    if (r.status === 'present') {
      regularHours += HOURS_PER_PRESENT_DAY;
    } else if (r.status === 'overtime') {
      regularHours += HOURS_PER_PRESENT_DAY + (r.overtimeHours || 0);
    } else if (r.status === 'camp_sitting') {
      campSittingHours += HOURS_PER_CAMP_SITTING;
    }
    // absent / no_site / not_marked → 0 hours
  }

  return {
    totalHours: regularHours + campSittingHours,
    regularHours,
    campSittingHours,
  };
}

/**
 * Compute hours PER SITE for an employee in a given month.
 *
 * Uses EmpCountSitePerMonth to determine which days the employee was at
 * which site, then attributes each attendance record to the site the
 * employee was at on that date.
 *
 * Returns a Map<siteId, { siteName, regularHours, campSittingHours, totalHours }>
 * — one entry per site the employee worked at during the month.
 *
 * If there are no EmpCountSitePerMonth records, falls back to attributing
 * ALL hours to the employee's current site (legacy behaviour).
 */
export async function computeMonthlyHoursPerSite(
  employeeId: string,
  month: string, // YYYY-MM
  fallbackSiteId: string | null,
  fallbackSiteName: string | null,
): Promise<Map<string, { siteName: string; regularHours: number; campSittingHours: number; totalHours: number }>> {
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  if (!year || !monthNum) return new Map();

  const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(monthNum).padStart(2, '0')}-31`;

  // Fetch all attendance records for this employee in this month
  const records = await db.attendance.findMany({
    where: {
      employeeId,
      date: { gte: startDate, lt: endDate },
      deletedAt: null,
    },
  });

  // Fetch all EmpCountSitePerMonth records for this employee + month
  // These tell us which site the employee was at on each day.
  const siteAssignments = await db.empCountSitePerMonth.findMany({
    where: {
      empId: employeeId,
      month,
      deletedDate: null,
    },
  });

  // If no site assignments, fall back to attributing all hours to the
  // employee's current site (legacy behaviour)
  if (siteAssignments.length === 0) {
    if (!fallbackSiteId) return new Map();
    let reg = 0;
    let camp = 0;
    for (const r of records) {
      if (r.status === 'present') reg += HOURS_PER_PRESENT_DAY;
      else if (r.status === 'overtime') reg += HOURS_PER_PRESENT_DAY + (r.overtimeHours || 0);
      else if (r.status === 'camp_sitting') camp += HOURS_PER_CAMP_SITTING;
    }
    const m = new Map();
    m.set(fallbackSiteId, {
      siteName: fallbackSiteName || '',
      regularHours: reg,
      campSittingHours: camp,
      totalHours: reg + camp,
    });
    return m;
  }

  // Build a date → siteId map using the EmpCountSitePerMonth records.
  // Each assignment has a createdDate (when the employee started at the
  // site) and an optional removedDate (when they left). For each day in
  // the month, we find the assignment whose [createdDate, removedDate]
  // range contains that day.
  const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`;
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const monthEnd = `${year}-${String(monthNum).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  // Helper: clamp a date string to [monthStart, monthEnd]
  const clamp = (d: string): string => {
    if (d < monthStart) return monthStart;
    if (d > monthEnd) return monthEnd;
    return d;
  };

  // For each site assignment, compute the clamped date range
  const ranges = siteAssignments.map((a) => {
    const start = clamp(a.createdDate.toISOString().split('T')[0]);
    const end = a.removedDate
      ? clamp(a.removedDate.toISOString().split('T')[0])
      : monthEnd;
    return { siteId: a.siteId, siteName: a.siteName, start, end };
  });

  // For each attendance record, find which site it belongs to
  const siteMap = new Map<string, { siteName: string; regularHours: number; campSittingHours: number; totalHours: number }>();

  for (const r of records) {
    // Find the site assignment whose range contains this date
    const matchingRange = ranges.find((rg) => r.date >= rg.start && r.date <= rg.end);
    if (!matchingRange) continue; // date doesn't fall in any site assignment

    if (!siteMap.has(matchingRange.siteId)) {
      siteMap.set(matchingRange.siteId, {
        siteName: matchingRange.siteName,
        regularHours: 0,
        campSittingHours: 0,
        totalHours: 0,
      });
    }
    const entry = siteMap.get(matchingRange.siteId)!;
    if (r.status === 'present') {
      entry.regularHours += HOURS_PER_PRESENT_DAY;
    } else if (r.status === 'overtime') {
      entry.regularHours += HOURS_PER_PRESENT_DAY + (r.overtimeHours || 0);
    } else if (r.status === 'camp_sitting') {
      entry.campSittingHours += HOURS_PER_CAMP_SITTING;
    }
    entry.totalHours = entry.regularHours + entry.campSittingHours;
  }

  return siteMap;
}

/**
 * Sync an employee's salary records for the given month with attendance-derived hours.
 *
 * SITE-AWARE: This function splits the employee's attendance hours across
 * ALL sites they worked at during the month, using EmpCountSitePerMonth
 * records to determine which site each day belongs to. A separate
 * SalaryRecord is created/updated for EACH site.
 *
 * Steps:
 *   1. Look up the employee. If not found, return early.
 *   2. Compute hours PER SITE using computeMonthlyHoursPerSite().
 *   3. For each site:
 *      a. Upsert a SalaryRecord (rateTier='standard') with the site's regular hours.
 *      b. Upsert a SalaryRecord (rateTier='camp_sitting') with the site's camp_sitting hours.
 *      c. If a site has 0 hours, soft-delete its salary records.
 *   4. Update TotalEmployeeWorkingHours with the grand total across all sites.
 *   5. Run the allocation engine for that month so standard/premium split is recomputed.
 *   6. Run recalcEmployeeFromMonth so downstream months stay consistent.
 *
 * CRITICAL: This ensures NO hour is missed — every attendance record is
 * attributed to exactly one site, and a salary record exists for each site
 * the employee worked at. The Accounts page shows all sites, so the full
 * salary is visible.
 */
export async function syncEmployeeSalaryFromAttendance(
  employeeId: string,
  month: string, // YYYY-MM
): Promise<{
  ok: boolean;
  skipped: boolean;
  reason?: string;
  totalHours: number;
  salaryRecordId?: string;
}> {
  // 1. Fetch employee
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      fullName: true,
      employeeId: true,
      currentSiteId: true,
      currentSite: true,
      nationality: true,
      trade: true,
      isTeamLeader: true,
      isSupervisor: true,
      customHourlyRate: true,
    },
  });

  if (!employee) {
    return { ok: false, skipped: true, reason: 'Employee not found', totalHours: 0 };
  }

  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  void monthStr;

  const hasBonus = employee.isTeamLeader || employee.isSupervisor;

  // ── Compute the effective rate ──
  // Priority (per project owner):
  //   1) Employee.customHourlyRate (from Hours Ledger) → ONLY this rate
  //   2) Trade rate (from EmployeeTrade junction) → +0.5 if TL/Sup
  //   3) Helper default → 2.5 (standard) or 3.0 (TL/Sup)
  const employeeCustomRate = employee.customHourlyRate;
  const hasCustomRate = employeeCustomRate !== null && employeeCustomRate !== undefined;

  let defaultLowRate: number;
  if (hasCustomRate) {
    // Priority 1: Custom rate → only this rate, no bonus
    defaultLowRate = employeeCustomRate!;
  } else {
    // Check if employee has a trade assignment
    const tradeRateMap = await buildTradeRateMap();
    const employeeTradeMap = await buildEmployeeTradeMap();
    const empTradeInfo = employeeTradeMap.get(employeeId);
    const tradeName = empTradeInfo?.trade || 'Helper';
    const isHelper = tradeName.toLowerCase() === 'helper';
    const tradeRate = !isHelper ? tradeRateMap.get(tradeName) : undefined;
    const hasTradeRate = tradeRate !== undefined && tradeRate > 0;

    if (hasTradeRate) {
      // Priority 2: Trade rate → +0.5 if TL/Sup, otherwise just trade rate
      defaultLowRate = hasBonus ? tradeRate! + 0.5 : tradeRate!;
    } else {
      // Priority 3: Helper default
      defaultLowRate = hasBonus ? 3.0 : 2.5;
    }
  }

  // 2. Compute hours PER SITE
  const hoursPerSite = await computeMonthlyHoursPerSite(
    employeeId,
    month,
    employee.currentSiteId,
    employee.currentSite,
  );

  // Grand total across all sites
  let grandTotalHours = 0;
  let grandRegularHours = 0;
  let grandCampSittingHours = 0;
  for (const [, siteData] of hoursPerSite) {
    grandRegularHours += siteData.regularHours;
    grandCampSittingHours += siteData.campSittingHours;
    grandTotalHours += siteData.totalHours;
  }

  // 3. If no hours at all, soft-delete ALL existing salary records for this
  //    employee+month (across all sites) and zero out TotalEmployeeWorkingHours
  if (grandTotalHours <= 0) {
    // Soft-delete all standard + camp_sitting records for this employee+month
    await db.salaryRecord.updateMany({
      where: {
        empId: employeeId,
        month,
        year,
        isDeleted: false,
        rateTier: { in: ['standard', 'premium', 'camp_sitting'] },
      },
      data: { isDeleted: true },
    });

    // Re-sync TotalEmployeeWorkingHours to 0
    await db.totalEmployeeWorkingHours.upsert({
      where: { empId_month: { empId: employeeId, month } },
      update: { totalWorkingHours: 0, isDeleted: false, empName: employee.fullName },
      create: {
        empId: employeeId,
        empName: employee.fullName,
        month,
        totalWorkingHours: 0,
        rtPerHour: defaultLowRate,
        isCustom: false,
      },
    });

    // Soft-delete WorkLog entries
    await db.workLog.updateMany({
      where: {
        employeeId,
        year,
        month: monthNum,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    // Run allocation + recalc
    try {
      await allocateEmployeeHours(month, year);
    } catch (err) {
      console.error('[attendance-sync] allocateEmployeeHours failed:', err);
    }
    try {
      await recalcEmployeeFromMonth(employeeId, year, monthNum);
    } catch (err) {
      console.error('[attendance-sync] recalcEmployeeFromMonth (zero hours) failed:', err);
    }

    return {
      ok: true,
      skipped: false,
      totalHours: 0,
      reason: 'No present days — all salary records removed',
    };
  }

  // 4. For each site, upsert standard + camp_sitting salary records
  let lastUpsertedId: string | undefined;

  for (const [siteId, siteData] of hoursPerSite) {
    // Verify the site still exists
    const siteInfo = await db.site.findUnique({
      where: { id: siteId },
      select: { id: true, name: true },
    });
    if (!siteInfo) continue; // site was deleted — skip

    // Fetch existing standard + camp_sitting records for this site
    const existingStandard = await db.salaryRecord.findUnique({
      where: {
        empId_siteId_month_year_rateTier: {
          empId: employeeId,
          siteId,
          month,
          year,
          rateTier: 'standard',
        },
      },
    });
    const existingCamp = await db.salaryRecord.findUnique({
      where: {
        empId_siteId_month_year_rateTier: {
          empId: employeeId,
          siteId,
          month,
          year,
          rateTier: 'camp_sitting',
        },
      },
    });

    const rtPerHour = existingStandard?.rtPerHour ?? defaultLowRate;
    const deduction = existingStandard?.deduction ?? 0;
    const advance = existingStandard?.advance ?? 0;
    const isPaid = (existingStandard?.isPaid ?? false) || (existingCamp?.isPaid ?? false);
    const slNo = existingStandard?.slNo ?? 0;
    const employeeCode = existingStandard?.employeeCode || employee.employeeId || '';

    // --- Standard record (regular hours only) ---
    if (siteData.regularHours > 0) {
      const standardSalary = siteData.regularHours * rtPerHour;
      const standardBalance = standardSalary - deduction - advance;
      const upserted = await db.salaryRecord.upsert({
        where: {
          empId_siteId_month_year_rateTier: {
            empId: employeeId,
            siteId,
            month,
            year,
            rateTier: 'standard',
          },
        },
        update: {
          empName: employee.fullName,
          siteName: siteInfo.name,
          nationality: employee.nationality || '',
          employeeCode,
          slNo,
          totalHours: siteData.regularHours,
          rtPerHour,
          totalSalary: standardSalary,
          deduction,
          advance,
          balanceSalary: standardBalance,
          isPaid,
          isDeleted: false,
        },
        create: {
          empId: employeeId,
          empName: employee.fullName,
          siteId,
          siteName: siteInfo.name,
          month,
          year,
          nationality: employee.nationality || '',
          trade: 'Helper',
          employeeCode,
          slNo,
          totalHours: siteData.regularHours,
          rtPerHour,
          totalSalary: standardSalary,
          deduction,
          advance,
          balanceSalary: standardBalance,
          isPaid,
          rateTier: 'standard',
        },
      });
      lastUpsertedId = upserted.id;
    } else {
      // No regular hours for this site — soft-delete the standard record
      if (existingStandard && !existingStandard.isDeleted) {
        await db.salaryRecord.update({
          where: { id: existingStandard.id },
          data: { isDeleted: true },
        });
      }
    }

    // --- Camp_sitting record (separate rateTier) ---
    if (siteData.campSittingHours > 0) {
      const campSalary = siteData.campSittingHours * defaultLowRate;
      const campDeduction = existingCamp?.deduction ?? 0;
      const campAdvance = existingCamp?.advance ?? 0;
      const campBalance = campSalary - campDeduction - campAdvance;
      await db.salaryRecord.upsert({
        where: {
          empId_siteId_month_year_rateTier: {
            empId: employeeId,
            siteId,
            month,
            year,
            rateTier: 'camp_sitting',
          },
        },
        update: {
          empName: employee.fullName,
          siteName: siteInfo.name,
          nationality: employee.nationality || '',
          employeeCode,
          slNo,
          totalHours: siteData.campSittingHours,
          rtPerHour: defaultLowRate,
          totalSalary: campSalary,
          deduction: campDeduction,
          advance: campAdvance,
          balanceSalary: campBalance,
          isPaid,
          isDeleted: false,
        },
        create: {
          empId: employeeId,
          empName: employee.fullName,
          siteId,
          siteName: siteInfo.name,
          month,
          year,
          nationality: employee.nationality || '',
          trade: 'Helper',
          employeeCode,
          slNo,
          totalHours: siteData.campSittingHours,
          rtPerHour: defaultLowRate,
          totalSalary: campSalary,
          deduction: campDeduction,
          advance: campAdvance,
          balanceSalary: campBalance,
          isPaid,
          rateTier: 'camp_sitting',
        },
      });
    } else {
      if (existingCamp && !existingCamp.isDeleted) {
        await db.salaryRecord.update({
          where: { id: existingCamp.id },
          data: { isDeleted: true },
        });
      }
    }

    // Ensure EmpCountSitePerMonth exists for this site
    await db.empCountSitePerMonth.upsert({
      where: {
        empId_siteId_month: {
          empId: employeeId,
          siteId,
          month,
        },
      },
      update: {
        empName: employee.fullName,
        siteName: siteInfo.name,
        deletedDate: null,
      },
      create: {
        empId: employeeId,
        empName: employee.fullName,
        siteId,
        siteName: siteInfo.name,
        month,
        deletedDate: null,
      },
    });

    // Upsert WorkLog for this site
    await db.workLog.upsert({
      where: {
        employeeId_siteId_year_month: {
          employeeId: employeeId,
          siteId,
          year,
          month: monthNum,
        },
      },
      update: {
        hoursWorked: siteData.totalHours,
        deletedAt: null,
      },
      create: {
        employeeId: employeeId,
        siteId,
        year,
        month: monthNum,
        hoursWorked: siteData.totalHours,
        allowances: 0,
        deductions: 0,
      },
    });
  }

  // 5. Soft-delete salary records for sites that are NO LONGER in hoursPerSite
  //    (the employee moved away and has no attendance at that site anymore)
  const activeSiteIds = Array.from(hoursPerSite.keys());
  await db.salaryRecord.updateMany({
    where: {
      empId: employeeId,
      month,
      year,
      isDeleted: false,
      siteId: { notIn: activeSiteIds },
      rateTier: { in: ['standard', 'premium', 'camp_sitting'] },
    },
    data: { isDeleted: true },
  });

  // 6. Update TotalEmployeeWorkingHours with the grand total
  await db.totalEmployeeWorkingHours.upsert({
    where: { empId_month: { empId: employeeId, month } },
    update: {
      totalWorkingHours: grandTotalHours,
      empName: employee.fullName,
      isDeleted: false,
    },
    create: {
      empId: employeeId,
      empName: employee.fullName,
      month,
      totalWorkingHours: grandTotalHours,
      rtPerHour: defaultLowRate,
      isCustom: false,
    },
  });

  // 7. Run the allocation engine so standard/premium split is correct
  try {
    await allocateEmployeeHours(month, year);
  } catch (err) {
    console.error('[attendance-sync] allocateEmployeeHours failed:', err);
  }

  // 8. Recalculate downstream months (in case cumulative hours changed)
  try {
    await recalcEmployeeFromMonth(employeeId, year, monthNum);
  } catch (err) {
    console.error('[attendance-sync] recalcEmployeeFromMonth failed:', err);
  }

  return {
    ok: true,
    skipped: false,
    totalHours: grandTotalHours,
    salaryRecordId: lastUpsertedId,
  };
}
