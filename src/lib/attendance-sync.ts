import { db } from '@/lib/db';
import { allocateEmployeeHours } from '@/lib/allocation-engine';
import { recalcEmployeeFromMonth } from '@/lib/recalculation';

// ---------------------------------------------------------------------------
// Attendance → Salary sync
// ---------------------------------------------------------------------------
// Business rule (per project owner):
//   When attendance is marked for an employee on a given day:
//     - status === "present"   → 10 hours for that day
//     - status === "overtime"  → 10 hours base + overtimeHours additional
//     - status === "absent"    → 0 hours
//     - status === "no_site"   → 0 hours
//     - status === "not_marked"→ 0 hours (treated as no entry)
//
// These hours are written into the employee's SalaryRecord for the
// employee's CURRENT WORKING SITE for that month. If the employee has
// no current site, the sync is skipped (no-op).
//
// After upserting the salary record, the allocation engine is run for
// that month so that the standard/premium split is recomputed, and
// TotalEmployeeWorkingHours is updated accordingly.
// ---------------------------------------------------------------------------

export const HOURS_PER_PRESENT_DAY = 10;

/**
 * Compute the total working hours for an employee in a given month
 * based on attendance records.
 *
 * Rules:
 *   present  → 10 hours
 *   overtime → 10 + overtimeHours
 *   absent   → 0
 *   no_site  → 0
 *   not_marked → 0
 */
export async function computeMonthlyHoursFromAttendance(
  employeeId: string,
  month: string, // YYYY-MM
): Promise<number> {
  // month is "YYYY-MM" — build start/end dates that cover the whole month
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  if (!year || !monthNum) return 0;

  const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(monthNum).padStart(2, '0')}-31`;

  const records = await db.attendance.findMany({
    where: {
      employeeId,
      date: { gte: startDate, lt: endDate },
      deletedAt: null,
    },
  });

  let totalHours = 0;
  for (const r of records) {
    if (r.status === 'present') {
      totalHours += HOURS_PER_PRESENT_DAY;
    } else if (r.status === 'overtime') {
      // 10 hours base + overtime hours on top
      totalHours += HOURS_PER_PRESENT_DAY + (r.overtimeHours || 0);
    }
    // absent / no_site / not_marked → 0 hours
  }

  return totalHours;
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

  // 2. Compute hours from attendance
  const totalHours = await computeMonthlyHoursFromAttendance(employeeId, month);

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

  const hasBonus = employee.isTeamLeader || employee.isSupervisor;
  const defaultLowRate = employee.customHourlyRate ?? (hasBonus ? 3.0 : 2.5);
  const rtPerHour = existingRecord?.rtPerHour ?? defaultLowRate;

  // Preserve deduction / advance / isPaid from existing record
  const deduction = existingRecord?.deduction ?? 0;
  const advance = existingRecord?.advance ?? 0;
  const isPaid = existingRecord?.isPaid ?? false;
  const slNo = existingRecord?.slNo ?? 0;
  const employeeCode = existingRecord?.employeeCode || employee.employeeId || '';

  // 3. If totalHours is 0, soft-delete any existing standard record (no work = no salary entry)
  if (totalHours <= 0) {
    if (existingRecord && !existingRecord.isDeleted) {
      await db.salaryRecord.update({
        where: { id: existingRecord.id },
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

    // Run allocation to clean up premium records too
    try {
      await allocateEmployeeHours(month, year);
    } catch (err) {
      console.error('[attendance-sync] allocateEmployeeHours failed:', err);
    }

    return {
      ok: true,
      skipped: false,
      totalHours: 0,
      reason: 'No present days — salary record removed',
    };
  }

  // 4. Upsert salary record with computed hours
  const totalSalary = totalHours * rtPerHour;
  const balanceSalary = totalSalary - deduction - advance;

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
      trade: employee.trade || '',
      employeeCode,
      slNo,
      totalHours,
      rtPerHour,
      totalSalary,
      deduction,
      advance,
      balanceSalary,
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
      trade: employee.trade || '',
      employeeCode,
      slNo,
      totalHours,
      rtPerHour,
      totalSalary,
      deduction,
      advance,
      balanceSalary,
      isPaid,
      rateTier: 'standard',
    },
  });

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
    salaryRecordId: upserted.id,
  };
}
