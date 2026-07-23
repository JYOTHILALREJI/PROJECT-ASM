import { db } from '@/lib/db';
import { allocateEmployeeHours } from '@/lib/allocation-engine';
import { recalcEmployeeFromMonth } from '@/lib/recalculation';

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
 * Sync an employee's salary record for the given month with attendance-derived hours.
 *
 * Steps:
 *   1. Look up the employee's currentSiteId. If none, return early (no-op).
 *   2. Compute total hours from attendance records for that month.
 *   3. Upsert a SalaryRecord (rateTier='standard') for (employee, currentSite, month, year).
 *      - totalHours = computed hours
 *      - totalSalary = totalHours × rtPerHour (using existing rtPerHour or default 2.5)
 *      - balanceSalary = totalSalary − deduction − advance (preserved from existing record)
 *   4. Run the allocation engine for that month so standard/premium split is recomputed.
 *   5. Run recalcEmployeeFromMonth so downstream months stay consistent.
 *
 * Returns a summary of what was done.
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
  // 1. Fetch employee with current site
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

  if (!employee.currentSiteId) {
    return {
      ok: false,
      skipped: true,
      reason: 'Employee has no current site — cannot create salary record',
      totalHours: 0,
    };
  }

  // Verify the site still exists
  const site = await db.site.findUnique({
    where: { id: employee.currentSiteId },
    select: { id: true, name: true },
  });

  if (!site) {
    return {
      ok: false,
      skipped: true,
      reason: 'Current site not found',
      totalHours: 0,
    };
  }

  // 2. Compute hours from attendance (regular + camp_sitting tracked separately)
  const { totalHours, regularHours, campSittingHours } = await computeMonthlyHoursFromAttendance(employeeId, month);

  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  void monthStr; // suppress unused-var lint

  // Determine the rate to use for the salary record
  // Priority: existing record's rtPerHour (user may have customized) > customHourlyRate > role-based default
  const existingRecord = await db.salaryRecord.findUnique({
    where: {
      empId_siteId_month_year_rateTier: {
        empId: employeeId,
        siteId: site.id,
        month,
        year,
        rateTier: 'standard',
      },
    },
  });

  // Also fetch any existing camp_sitting record so we can preserve its fields
  const existingCampRecord = await db.salaryRecord.findUnique({
    where: {
      empId_siteId_month_year_rateTier: {
        empId: employeeId,
        siteId: site.id,
        month,
        year,
        rateTier: 'camp_sitting',
      },
    },
  });

  const hasBonus = employee.isTeamLeader || employee.isSupervisor;
  const defaultLowRate = employee.customHourlyRate ?? (hasBonus ? 3.0 : 2.5);
  const rtPerHour = existingRecord?.rtPerHour ?? defaultLowRate;

  // Preserve deduction / advance / isPaid from existing record
  const deduction = existingRecord?.deduction ?? 0;
  const advance = existingRecord?.advance ?? 0;
  const isPaid = existingRecord?.isPaid ?? false;
  const slNo = existingRecord?.slNo ?? 0;
  const employeeCode = existingRecord?.employeeCode || employee.employeeId || '';

  // 3. If totalHours is 0, soft-delete any existing standard AND camp_sitting records
  if (totalHours <= 0) {
    if (existingRecord && !existingRecord.isDeleted) {
      await db.salaryRecord.update({
        where: { id: existingRecord.id },
        data: { isDeleted: true },
      });
    }
    if (existingCampRecord && !existingCampRecord.isDeleted) {
      await db.salaryRecord.update({
        where: { id: existingCampRecord.id },
        data: { isDeleted: true },
      });
    }

    // Re-sync TotalEmployeeWorkingHours to 0 for this month
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

    // Soft-delete any existing WorkLog for this employee+site+month so the
    // Employee Hours Ledger doesn't show stale hours from a previous mark.
    await db.workLog.updateMany({
      where: {
        employeeId,
        siteId: site.id,
        year,
        month: monthNum,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    // Run allocation to clean up premium records too
    try {
      await allocateEmployeeHours(month, year);
    } catch (err) {
      console.error('[attendance-sync] allocateEmployeeHours failed:', err);
    }

    // Recalculate downstream months since hours changed
    try {
      await recalcEmployeeFromMonth(employeeId, year, monthNum);
    } catch (err) {
      console.error('[attendance-sync] recalcEmployeeFromMonth (zero hours) failed:', err);
    }

    return {
      ok: true,
      skipped: false,
      totalHours: 0,
      reason: 'No present days — salary record removed',
    };
  }

  // 4. Upsert STANDARD salary record with REGULAR hours (excludes camp_sitting)
  //    The allocation engine will split these into standard/premium tiers.
  //    Camp_sitting hours are stored in a SEPARATE record (rateTier='camp_sitting')
  //    so they're excluded from the lifetime/threshold calculation.
  const standardHours = regularHours;
  const standardSalary = standardHours * rtPerHour;
  const standardBalance = standardSalary - deduction - advance;

  let upsertedId: string | undefined;

  if (standardHours > 0) {
    const upserted = await db.salaryRecord.upsert({
      where: {
        empId_siteId_month_year_rateTier: {
          empId: employeeId,
          siteId: site.id,
          month,
          year,
          rateTier: 'standard',
        },
      },
      update: {
        empName: employee.fullName,
        siteName: site.name,
        nationality: employee.nationality || '',
        employeeCode,
        slNo,
        totalHours: standardHours,
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
        siteId: site.id,
        siteName: site.name,
        month,
        year,
        nationality: employee.nationality || '',
        trade: 'Helper',
        employeeCode,
        slNo,
        totalHours: standardHours,
        rtPerHour,
        totalSalary: standardSalary,
        deduction,
        advance,
        balanceSalary: standardBalance,
        isPaid,
        rateTier: 'standard',
      },
    });
    upsertedId = upserted.id;
  } else {
    // No regular hours — soft-delete the standard record if it exists
    if (existingRecord && !existingRecord.isDeleted) {
      await db.salaryRecord.update({
        where: { id: existingRecord.id },
        data: { isDeleted: true },
      });
    }
  }

  // 4b. Upsert CAMP_SITTING salary record (separate rateTier)
  //    Camp_sitting hours are always at the low rate (no threshold split).
  //    These hours ARE included in the monthly salary but NOT in lifetime.
  if (campSittingHours > 0) {
    const campSalary = campSittingHours * defaultLowRate;
    const campDeduction = existingCampRecord?.deduction ?? 0;
    const campAdvance = existingCampRecord?.advance ?? 0;
    const campBalance = campSalary - campDeduction - campAdvance;
    await db.salaryRecord.upsert({
      where: {
        empId_siteId_month_year_rateTier: {
          empId: employeeId,
          siteId: site.id,
          month,
          year,
          rateTier: 'camp_sitting',
        },
      },
      update: {
        empName: employee.fullName,
        siteName: site.name,
        nationality: employee.nationality || '',
        employeeCode,
        slNo,
        totalHours: campSittingHours,
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
        siteId: site.id,
        siteName: site.name,
        month,
        year,
        nationality: employee.nationality || '',
        trade: 'Helper',
        employeeCode,
        slNo,
        totalHours: campSittingHours,
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
    // No camp_sitting hours — soft-delete the camp_sitting record if it exists
    if (existingCampRecord && !existingCampRecord.isDeleted) {
      await db.salaryRecord.update({
        where: { id: existingCampRecord.id },
        data: { isDeleted: true },
      });
    }
  }

  // 5. Ensure a TotalEmployeeWorkingHours entry exists for this month
  await db.totalEmployeeWorkingHours.upsert({
    where: { empId_month: { empId: employeeId, month } },
    update: {
      totalWorkingHours: totalHours,
      empName: employee.fullName,
      isDeleted: false,
    },
    create: {
      empId: employeeId,
      empName: employee.fullName,
      month,
      totalWorkingHours: totalHours,
      rtPerHour: defaultLowRate,
      isCustom: false,
    },
  });

  // 6. Ensure EmpCountSitePerMonth exists so employee shows up in site dropdowns
  await db.empCountSitePerMonth.upsert({
    where: {
      empId_siteId_month: {
        empId: employeeId,
        siteId: site.id,
        month,
      },
    },
    update: {
      empName: employee.fullName,
      siteName: site.name,
      deletedDate: null,
    },
    create: {
      empId: employeeId,
      empName: employee.fullName,
      siteId: site.id,
      siteName: site.name,
      month,
      deletedDate: null,
    },
  });

  // 6b. Upsert a WorkLog entry so the Employee Hours Ledger reflects the
  // attendance-derived hours.
  //
  // The hours ledger (GET /api/employees/[id]/worklogs) reads from WorkLog
  // first and falls back to SalaryRecord only if no WorkLog exists. Without
  // this upsert, the ledger would show stale WorkLog hours (or no entry at
  // all if only a SalaryRecord was created). By keeping the WorkLog in sync
  // with the attendance-derived hours, the ledger always shows the correct
  // total whenever attendance changes.
  await db.workLog.upsert({
    where: {
      employeeId_siteId_year_month: {
        employeeId: employeeId,
        siteId: site.id,
        year,
        month: monthNum,
      },
    },
    update: {
      hoursWorked: totalHours,
      deletedAt: null, // un-soft-delete if previously deleted
    },
    create: {
      employeeId: employeeId,
      siteId: site.id,
      year,
      month: monthNum,
      hoursWorked: totalHours,
      allowances: 0,
      deductions: 0,
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
    totalHours,
    salaryRecordId: upsertedId,
  };
}
