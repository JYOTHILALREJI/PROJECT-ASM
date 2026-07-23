import { db } from '@/lib/db';
import { buildEmployeeTradeMap } from '@/lib/employee-trade';

// ---------------------------------------------------------------------------
// Recalculation Engine — Direct Hourly Rates (PRD v2.0)
// ---------------------------------------------------------------------------
//
// Rate Table (DIRECT — no divisors):
//   | Role            | Rate below 1000h | Rate at/above 1000h |
//   | Standard        | 2.5              | 5.0                  |
//   | Team Leader     | 3.0              | 5.5                  |
//   | Supervisor      | 3.0              | 5.5                  |
//   | Custom (per emp)| Overrides both   | Overrides both       |
//
// Priority: employee.customHourlyRate > role-based rates
//
// Cumulative hours span ALL years (no yearly reset).
// When editing past hours, recalculate from the edited month onward.
// ---------------------------------------------------------------------------

/**
 * Get the direct hourly rates for an employee.
 *
 * Priority:
 *   1. employee.customHourlyRate (per-employee override) — highest priority
 *   2. TradeRate (per-trade rate from the TradeRate table) — if the
 *      employee's trade has a custom rate, use it for both below and above
 *   3. Role-based rates (TL/Supervisor: 3.0/5.5, Standard: 2.5/5.0)
 *
 * The tradeRateMap is an optional Map<string, number> mapping trade names
 * to hourly rates. The caller should build this from the TradeRate table
 * and pass it in. If not provided, trade rates are skipped.
 */
export function getEmployeeRates(
  employee: {
    customHourlyRate: number | null;
    role: string;
    isTeamLeader: boolean;
    isSupervisor: boolean;
    trade?: string | null;
  },
  tradeRateMap?: Map<string, number> | null,
): { lowRate: number; highRate: number; isCustom: boolean } {
  const isLeader = employee.isTeamLeader || employee.isSupervisor || employee.role === 'Team Leader' || employee.role === 'Supervisor';

  // 1. Per-employee custom rate (from Hours Ledger) — HIGHEST priority
  //    ONLY this rate is used. No trade, no +0.5 bonus, no threshold.
  if (employee.customHourlyRate !== null && employee.customHourlyRate !== undefined) {
    return {
      lowRate: employee.customHourlyRate,
      highRate: employee.customHourlyRate,
      isCustom: true,
    };
  }

  // 2. Trade-based rate (if a TradeRate exists for this employee's trade)
  //    NEW: if TL/Supervisor, trade rate gets +0.5 bonus.
  //    NOTE: employee.trade here is the EFFECTIVE trade (overridden by the caller
  //    to be the SalaryRecord trade, NOT the Employee table trade). The caller
  //    is responsible for setting it correctly before calling this function.
  if (tradeRateMap && employee.trade) {
    const tradeRate = tradeRateMap.get(employee.trade);
    if (tradeRate !== undefined && tradeRate > 0) {
      const effectiveRate = isLeader ? tradeRate + 0.5 : tradeRate;
      return {
        lowRate: effectiveRate,
        highRate: effectiveRate,
        isCustom: true,
      };
    }
  }

  // 3. Role-based rates (Helper / no trade)
  return {
    lowRate: isLeader ? 3.0 : 2.5,
    highRate: isLeader ? 5.5 : 5.0,
    isCustom: false,
  };
}

/**
 * Build a trade rate map from the TradeRate table for use with
 * getEmployeeRates. Returns a Map<tradeName, hourlyRate>.
 */
export async function buildTradeRateMap(): Promise<Map<string, number>> {
  try {
    const tradeRates = await db.tradeRate.findMany();
    const map = new Map<string, number>();
    for (const tr of tradeRates) {
      map.set(tr.trade, tr.hourlyRate);
    }
    return map;
  } catch {
    // Table might not exist yet (before migration) — return empty map
    return new Map();
  }
}

/**
 * Compute the below/above threshold split for a single month's hours.
 */
export function computeMonthSplit(
  monthHours: number,
  cumulativeBefore: number,
  threshold: number,
): { belowHours: number; aboveHours: number } {
  if (cumulativeBefore < threshold) {
    const remaining = threshold - cumulativeBefore;
    const below = Math.min(monthHours, remaining);
    const above = monthHours - below;
    return { belowHours: below, aboveHours: above };
  }
  return { belowHours: 0, aboveHours: monthHours };
}

/**
 * Recalculate an employee's cumulative hours and salary records
 * starting from a given month onward.
 *
 * This is the core propagation function. When hours are edited for month M,
 * all months from M onward need their cumulative values and salary splits
 * recomputed.
 *
 * @param employeeId - The employee's internal ID (cuid)
 * @param fromYear - The year to start recalculation from
 * @param fromMonth - The month (1-12) to start recalculation from
 */
export async function recalcEmployeeFromMonth(
  employeeId: string,
  fromYear: number,
  fromMonth: number,
): Promise<{
  monthsRecalculated: number;
  employeeId: string;
}> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      fullName: true,
      employeeId: true,
      role: true,
      isTeamLeader: true,
      isSupervisor: true,
      customHourlyRate: true,
      hoursThreshold: true,
      nationality: true,
      trade: true,
    },
  });

  if (!employee) {
    throw new Error(`Employee not found: ${employeeId}`);
  }

  const tradeRateMap = await buildTradeRateMap();
  const employeeTradeMap = await buildEmployeeTradeMap();

  // Trade priority: SalaryRecord trade (Accounts edit) > EmployeeTrade > "Helper"
  const salaryRecsForTrade = await db.salaryRecord.findMany({
    where: { empId: employeeId, isDeleted: false },
    select: { trade: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  const savedTrade = (salaryRecsForTrade[0]?.trade && salaryRecsForTrade[0].trade.trim()) || null;
  const empTradeInfo = employeeTradeMap.get(employeeId);
  const effectiveTrade = savedTrade || empTradeInfo?.trade || 'Helper';

  // Override employee.trade with the effective trade for rate lookup
  const employeeWithTrade = { ...employee, trade: effectiveTrade };
  const { lowRate, highRate, isCustom } = getEmployeeRates(employeeWithTrade, tradeRateMap);
  const threshold = employee.hoursThreshold || 1000;

  // Fetch all non-deleted work logs for this employee, sorted chronologically
  const allLogs = await db.workLog.findMany({
    where: { employeeId, deletedAt: null },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  // Compute cumulative hours BEFORE the fromMonth
  let cumulative = 0;
  for (const log of allLogs) {
    if (log.year < fromYear || (log.year === fromYear && log.month < fromMonth)) {
      cumulative += log.hoursWorked;
    }
  }

  // Also consider salary records for months before fromMonth that don't have work logs
  // (for backward compatibility with existing data)
  const allSalaryRecords = await db.salaryRecord.findMany({
    where: { empId: employeeId, isDeleted: false },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  // Recalculate cumulative from all data sources
  // Use work logs as primary source; fall back to salary records for months without work logs
  const logMonthSet = new Set(allLogs.map(l => `${l.year}-${String(l.month).padStart(2, '0')}`));
  
  // Recompute cumulative properly from ALL months
  cumulative = 0;
  const allMonthsData: Array<{
    monthKey: string;
    year: number;
    month: number;
    hoursWorked: number;
    siteHours: Array<{ siteId: string; siteName: string; hours: number }>;
  }> = [];

  // Build a map of work logs by year-month
  const logsByMonth = new Map<string, typeof allLogs>();
  for (const log of allLogs) {
    const key = `${log.year}-${String(log.month).padStart(2, '0')}`;
    if (!logsByMonth.has(key)) logsByMonth.set(key, []);
    logsByMonth.get(key)!.push(log);
  }

  // Build a map of salary records by year-month
  const salaryByMonth = new Map<string, typeof allSalaryRecords>();
  for (const sr of allSalaryRecords) {
    if (!salaryByMonth.has(sr.month)) salaryByMonth.set(sr.month, []);
    salaryByMonth.get(sr.month)!.push(sr);
  }

  // Collect all unique months from both sources
  const allMonthKeys = new Set([...logsByMonth.keys(), ...salaryByMonth.keys()]);
  const sortedMonthKeys = Array.from(allMonthKeys).sort();

  for (const monthKey of sortedMonthKeys) {
    const [yearStr, monthStr] = monthKey.split('-');
    const yr = parseInt(yearStr, 10);
    const mo = parseInt(monthStr, 10);

    // Get total hours for this month
    const monthLogs = logsByMonth.get(monthKey) || [];
    const monthSalaryRecords = salaryByMonth.get(monthKey) || [];

    let totalHours = 0;
    const siteHours: Array<{ siteId: string; siteName: string; hours: number }> = [];

    if (monthLogs.length > 0) {
      // Work logs are the source of truth
      for (const log of monthLogs) {
        totalHours += log.hoursWorked;
        const site = await db.site.findUnique({ where: { id: log.siteId }, select: { name: true } });
        siteHours.push({
          siteId: log.siteId,
          siteName: site?.name || '',
          hours: log.hoursWorked,
        });
      }
    } else if (monthSalaryRecords.length > 0) {
      // Fall back to salary records (backward compatibility)
      totalHours = monthSalaryRecords.reduce((sum, sr) => sum + sr.totalHours, 0);
      // Group by site
      const siteMap = new Map<string, { siteName: string; hours: number }>();
      for (const sr of monthSalaryRecords) {
        const existing = siteMap.get(sr.siteId);
        if (existing) {
          existing.hours += sr.totalHours;
        } else {
          siteMap.set(sr.siteId, { siteName: sr.siteName, hours: sr.totalHours });
        }
      }
      for (const [siteId, data] of siteMap) {
        siteHours.push({ siteId, siteName: data.siteName, hours: data.hours });
      }
    }

    allMonthsData.push({
      monthKey,
      year: yr,
      month: mo,
      hoursWorked: totalHours,
      siteHours,
    });
  }

  // Now recalculate from fromMonth onward
  // First, compute cumulative before fromMonth
  cumulative = 0;
  for (const md of allMonthsData) {
    if (md.year < fromYear || (md.year === fromYear && md.month < fromMonth)) {
      cumulative += md.hoursWorked;
    }
  }

  let monthsRecalculated = 0;

  for (const md of allMonthsData) {
    // Skip months before fromMonth
    if (md.year < fromYear || (md.year === fromYear && md.month < fromMonth)) {
      continue;
    }

    if (md.hoursWorked <= 0) {
      // No hours this month — skip but advance cumulative
      continue;
    }

    if (isCustom) {
      // Custom rate: all hours at the custom rate as a single "standard" record
      const totalSalary = md.hoursWorked * lowRate; // lowRate == highRate for custom
      const blendedRate = md.hoursWorked > 0 ? totalSalary / md.hoursWorked : 0;

      // Update TotalEmployeeWorkingHours
      await db.totalEmployeeWorkingHours.upsert({
        where: { empId_month: { empId: employeeId, month: md.monthKey } },
        update: {
          totalWorkingHours: md.hoursWorked,
          rtPerHour: blendedRate,
          isDeleted: false,
        },
        create: {
          empId: employeeId,
          empName: employee.fullName,
          month: md.monthKey,
          totalWorkingHours: md.hoursWorked,
          rtPerHour: blendedRate,
          isCustom: true,
        },
      });

      // For custom rate, put all hours in a single salary record per site
      for (const sh of md.siteHours) {
        const siteSalary = sh.hours * lowRate;
        // Check for existing records
        const existingStd = await db.salaryRecord.findUnique({
          where: {
            empId_siteId_month_year_rateTier: {
              empId: employeeId,
              siteId: sh.siteId,
              month: md.monthKey,
              year: md.year,
              rateTier: 'standard',
            },
          },
        });
        const existingPrem = await db.salaryRecord.findUnique({
          where: {
            empId_siteId_month_year_rateTier: {
              empId: employeeId,
              siteId: sh.siteId,
              month: md.monthKey,
              year: md.year,
              rateTier: 'premium',
            },
          },
        });

        // Soft-delete premium record if it exists
        if (existingPrem && !existingPrem.isDeleted) {
          await db.salaryRecord.update({
            where: { id: existingPrem.id },
            data: { isDeleted: true },
          });
        }

        // Upsert standard record with all hours
        const existingDeduction = existingStd?.deduction ?? 0;
        const existingAdvance = existingStd?.advance ?? 0;
        const existingIsPaid = existingStd?.isPaid ?? existingPrem?.isPaid ?? false;

        await db.salaryRecord.upsert({
          where: {
            empId_siteId_month_year_rateTier: {
              empId: employeeId,
              siteId: sh.siteId,
              month: md.monthKey,
              year: md.year,
              rateTier: 'standard',
            },
          },
          update: {
            empName: employee.fullName,
            siteName: sh.siteName,
            nationality: employee.nationality || '',
            trade: effectiveTrade,
            employeeCode: employee.employeeId || '',
            totalHours: sh.hours,
            rtPerHour: lowRate,
            totalSalary: siteSalary,
            balanceSalary: siteSalary - existingDeduction - existingAdvance,
            deduction: existingDeduction,
            advance: existingAdvance,
            isPaid: existingIsPaid,
            isDeleted: false,
          },
          create: {
            empId: employeeId,
            empName: employee.fullName,
            siteId: sh.siteId,
            siteName: sh.siteName,
            month: md.monthKey,
            year: md.year,
            nationality: employee.nationality || '',
            trade: effectiveTrade,
            employeeCode: employee.employeeId || '',
            slNo: 0,
            totalHours: sh.hours,
            rtPerHour: lowRate,
            totalSalary: siteSalary,
            deduction: 0,
            advance: 0,
            balanceSalary: siteSalary,
            isPaid: false,
            rateTier: 'standard',
          },
        });
      }
    } else {
      // Role-based rates: use sequential allocation across sites
      // (matching the allocation engine's algorithm for consistency)
      //
      // Sequential Allocation:
      //   1. consumedThreshold = min(cumulative, threshold)
      //   2. Sort sites alphabetically by site name
      //   3. Walk sites sequentially, consuming the remaining threshold
      //   4. Split each site's hours into below (standard) and above (premium)
      let consumedThreshold = Math.min(cumulative, threshold);

      // Sort sites alphabetically by name for deterministic allocation
      const sortedSiteHours = [...md.siteHours].sort((a, b) =>
        a.siteName.localeCompare(b.siteName),
      );

      // Compute per-site splits and total salary
      let totalSalary = 0;
      const siteSplits: Array<{
        siteId: string;
        siteName: string;
        siteBelow: number;
        siteAbove: number;
      }> = [];

      for (const sh of sortedSiteHours) {
        const remainingThreshold = threshold - consumedThreshold;
        let siteBelow = 0;
        let siteAbove = 0;

        if (sh.hours <= 0) {
          siteBelow = 0;
          siteAbove = 0;
        } else if (remainingThreshold >= sh.hours) {
          // Site fully inside remaining threshold → all hours at low rate
          siteBelow = sh.hours;
          siteAbove = 0;
          consumedThreshold += sh.hours;
        } else if (remainingThreshold > 0) {
          // Site crosses the threshold → split
          siteBelow = remainingThreshold;
          siteAbove = sh.hours - remainingThreshold;
          consumedThreshold = threshold;
        } else {
          // Threshold already exhausted → all hours at high rate
          siteBelow = 0;
          siteAbove = sh.hours;
        }

        siteSplits.push({
          siteId: sh.siteId,
          siteName: sh.siteName,
          siteBelow,
          siteAbove,
        });

        totalSalary += siteBelow * lowRate + siteAbove * highRate;
      }

      const blendedRate = md.hoursWorked > 0 ? totalSalary / md.hoursWorked : 0;

      // Update TotalEmployeeWorkingHours
      await db.totalEmployeeWorkingHours.upsert({
        where: { empId_month: { empId: employeeId, month: md.monthKey } },
        update: {
          totalWorkingHours: md.hoursWorked,
          rtPerHour: blendedRate,
          isDeleted: false,
        },
        create: {
          empId: employeeId,
          empName: employee.fullName,
          month: md.monthKey,
          totalWorkingHours: md.hoursWorked,
          rtPerHour: blendedRate,
          isCustom: false,
        },
      });

      // Create/update/soft-delete salary records per site
      for (const split of siteSplits) {
        // Get existing records for carry-forward of deduction/advance/isPaid
        const existingStd = await db.salaryRecord.findUnique({
          where: {
            empId_siteId_month_year_rateTier: {
              empId: employeeId,
              siteId: split.siteId,
              month: md.monthKey,
              year: md.year,
              rateTier: 'standard',
            },
          },
        });
        const existingPrem = await db.salaryRecord.findUnique({
          where: {
            empId_siteId_month_year_rateTier: {
              empId: employeeId,
              siteId: split.siteId,
              month: md.monthKey,
              year: md.year,
              rateTier: 'premium',
            },
          },
        });

        const existingIsPaid = existingStd?.isPaid || existingPrem?.isPaid || false;

        // Standard (below threshold) record
        if (split.siteBelow > 0.001) {
          const stdSalary = split.siteBelow * lowRate;
          const stdDeduction = existingStd?.deduction ?? 0;
          const stdAdvance = existingStd?.advance ?? 0;

          await db.salaryRecord.upsert({
            where: {
              empId_siteId_month_year_rateTier: {
                empId: employeeId,
                siteId: split.siteId,
                month: md.monthKey,
                year: md.year,
                rateTier: 'standard',
              },
            },
            update: {
              empName: employee.fullName,
              siteName: split.siteName,
              nationality: employee.nationality || '',
              trade: effectiveTrade,
              employeeCode: employee.employeeId || '',
              totalHours: parseFloat(split.siteBelow.toFixed(2)),
              rtPerHour: lowRate,
              totalSalary: parseFloat(stdSalary.toFixed(2)),
              balanceSalary: parseFloat((stdSalary - stdDeduction - stdAdvance).toFixed(2)),
              deduction: stdDeduction,
              advance: stdAdvance,
              isPaid: existingIsPaid,
              isDeleted: false,
            },
            create: {
              empId: employeeId,
              empName: employee.fullName,
              siteId: split.siteId,
              siteName: split.siteName,
              month: md.monthKey,
              year: md.year,
              nationality: employee.nationality || '',
              trade: effectiveTrade,
              employeeCode: employee.employeeId || '',
              slNo: 0,
              totalHours: parseFloat(split.siteBelow.toFixed(2)),
              rtPerHour: lowRate,
              totalSalary: parseFloat(stdSalary.toFixed(2)),
              deduction: 0,
              advance: 0,
              balanceSalary: parseFloat(stdSalary.toFixed(2)),
              isPaid: false,
              rateTier: 'standard',
            },
          });
        } else if (existingStd && !existingStd.isDeleted) {
          // No below-threshold hours — soft-delete the standard record
          await db.salaryRecord.update({
            where: { id: existingStd.id },
            data: { isDeleted: true },
          });
        }

        // Premium (above threshold) record
        if (split.siteAbove > 0.001) {
          const premSalary = split.siteAbove * highRate;
          const premDeduction = existingPrem?.deduction ?? 0;
          const premAdvance = existingPrem?.advance ?? 0;

          await db.salaryRecord.upsert({
            where: {
              empId_siteId_month_year_rateTier: {
                empId: employeeId,
                siteId: split.siteId,
                month: md.monthKey,
                year: md.year,
                rateTier: 'premium',
              },
            },
            update: {
              empName: employee.fullName,
              siteName: split.siteName,
              nationality: employee.nationality || '',
              trade: effectiveTrade,
              employeeCode: employee.employeeId || '',
              totalHours: parseFloat(split.siteAbove.toFixed(2)),
              rtPerHour: highRate,
              totalSalary: parseFloat(premSalary.toFixed(2)),
              balanceSalary: parseFloat((premSalary - premDeduction - premAdvance).toFixed(2)),
              deduction: premDeduction,
              advance: premAdvance,
              isPaid: existingIsPaid,
              isDeleted: false,
            },
            create: {
              empId: employeeId,
              empName: employee.fullName,
              siteId: split.siteId,
              siteName: split.siteName,
              month: md.monthKey,
              year: md.year,
              nationality: employee.nationality || '',
              trade: effectiveTrade,
              employeeCode: employee.employeeId || '',
              slNo: 0,
              totalHours: parseFloat(split.siteAbove.toFixed(2)),
              rtPerHour: highRate,
              totalSalary: parseFloat(premSalary.toFixed(2)),
              deduction: 0,
              advance: 0,
              balanceSalary: parseFloat(premSalary.toFixed(2)),
              isPaid: false,
              rateTier: 'premium',
            },
          });
        } else if (existingPrem && !existingPrem.isDeleted) {
          // No above-threshold hours — soft-delete the premium record
          await db.salaryRecord.update({
            where: { id: existingPrem.id },
            data: { isDeleted: true },
          });
        }
      }
    }

    cumulative += md.hoursWorked;
    monthsRecalculated++;
  }

  return { monthsRecalculated, employeeId };
}

/**
 * Full recalculation for an employee — starts from the earliest month.
 * Used when role, customHourlyRate, or hoursThreshold changes.
 */
export async function recalcEmployeeFull(employeeId: string): Promise<{
  monthsRecalculated: number;
  employeeId: string;
}> {
  // Find the earliest work log or salary record for this employee
  const earliestLog = await db.workLog.findFirst({
    where: { employeeId, deletedAt: null },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  const earliestSalary = await db.salaryRecord.findFirst({
    where: { empId: employeeId, isDeleted: false },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });

  let fromYear = 2020;
  let fromMonth = 1;

  if (earliestLog) {
    fromYear = earliestLog.year;
    fromMonth = earliestLog.month;
  }
  const earliestSalaryMonth = earliestSalary ? parseInt(earliestSalary.month.split('-')[1], 10) : 0;
  if (earliestSalary && (earliestSalary.year < fromYear || (earliestSalary.year === fromYear && earliestSalaryMonth < fromMonth))) {
    fromYear = earliestSalary.year;
    fromMonth = parseInt(earliestSalary.month.split('-')[1], 10);
  }

  return recalcEmployeeFromMonth(employeeId, fromYear, fromMonth);
}

/**
 * Compute salary breakdown for display purposes (no DB writes).
 * Useful for the frontend to preview calculations.
 */
export function computeSalaryBreakdown(
  monthHours: number,
  cumulativeBefore: number,
  threshold: number,
  lowRate: number,
  highRate: number,
): {
  belowHours: number;
  aboveHours: number;
  belowSalary: number;
  aboveSalary: number;
  totalSalary: number;
  blendedRate: number;
} {
  const { belowHours, aboveHours } = computeMonthSplit(monthHours, cumulativeBefore, threshold);
  const belowSalary = belowHours * lowRate;
  const aboveSalary = aboveHours * highRate;
  const totalSalary = belowSalary + aboveSalary;
  const blendedRate = monthHours > 0 ? totalSalary / monthHours : 0;

  return {
    belowHours,
    aboveHours,
    belowSalary: parseFloat(belowSalary.toFixed(2)),
    aboveSalary: parseFloat(aboveSalary.toFixed(2)),
    totalSalary: parseFloat(totalSalary.toFixed(2)),
    blendedRate: parseFloat(blendedRate.toFixed(4)),
  };
}
