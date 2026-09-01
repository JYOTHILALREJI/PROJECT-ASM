import { db } from '@/lib/db';
import { buildEmployeeTradeMap } from '@/lib/employee-trade';
import { getBaseRates } from '@/lib/base-rates';
import { getRateForMonth } from '@/lib/rate-changelog';
import { resolveRateSync } from '@/lib/rate-resolver';
import { isHelperTrade } from '@/lib/trade-utils';
import {
  computeThresholdSplit,
  computeSalary,
  computeBalance,
  computeStartingBalanceSeed,
  roundMoney,
  roundHours,
} from '@/lib/payroll-math';

// ---------------------------------------------------------------------------
// Recalculation Engine — Direct Hourly Rates
// ---------------------------------------------------------------------------
//
// Rate Table (DIRECT — no divisors):
//   | Employee type   | Rate below threshold | Rate above threshold |
//   | Helper          | baseLow (3.5)        | helperHigh (6.0)     |
//   | Other trade     | baseLow (3.5)        | tradeHigh (7.0)      |
//   | Custom (per emp)| Overrides both       | Overrides both       |
//   | TradeRate row   | Overrides both (flat)| Overrides both       |
//
// Priority: changelog > employee.customHourlyRate > TradeRate (+0.5 TL/Sup)
//           > base rates (trade-aware premium)
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
 *   3. Base rates (baseLow below threshold; helperHigh for Helpers /
 *      tradeHigh for other trades above the threshold)
 *
 * The tradeRateMap is an optional Map<string, number> mapping trade names
 * to hourly rates. The caller should build this from the TradeRate table
 * and pass it in. If not provided, trade rates are skipped.
 */
export async function getEmployeeRates(
  employee: {
    customHourlyRate: number | null;
    role: string;
    isTeamLeader: boolean;
    isSupervisor: boolean;
    trade?: string | null;
  },
  tradeRateMap?: Map<string, number> | null,
): Promise<{ lowRate: number; highRate: number; isCustom: boolean }> {
  // Delegate to the canonical resolver (rate-resolver.ts).
  // This ensures the priority logic exists in exactly ONE place.
  // NOTE: This function does NOT apply the per-month changelog override —
  // callers that need changelog support should use resolveEmployeeRate()
  // or resolveRateMapForMonth() from rate-resolver.ts directly.
  const baseRates = await getBaseRates();

  // Resolve the trade rate from the map
  let tradeRate: number | null = null;
  if (tradeRateMap && employee.trade) {
    const tr = tradeRateMap.get(employee.trade);
    if (tr !== undefined && tr > 0) {
      tradeRate = tr;
    }
  }

  // Use the role field as a fallback for TL/Sup detection
  const isTL = employee.isTeamLeader || employee.role === 'Team Leader';
  const isSup = employee.isSupervisor || employee.role === 'Supervisor';

  const resolved = resolveRateSync(
    employee.customHourlyRate ?? null,
    tradeRate,
    isTL,
    isSup,
    baseRates,
    isHelperTrade(employee.trade),
  );

  return {
    lowRate: resolved.lowRate,
    highRate: resolved.highRate,
    isCustom: resolved.isCustom,
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
 * Delegates to the canonical split in payroll-math.ts (single source of
 * truth, drift-free, rounded to 2 decimals).
 */
export function computeMonthSplit(
  monthHours: number,
  cumulativeBefore: number,
  threshold: number,
): { belowHours: number; aboveHours: number } {
  return computeThresholdSplit(monthHours, cumulativeBefore, threshold);
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
      currentTotalWorkingHours: true,
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
  const { lowRate, highRate, isCustom } = await getEmployeeRates(employeeWithTrade, tradeRateMap);
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

  // ── Manual starting balance seed (canonical lifetime-hours floor) ──
  // Same rule as the allocation engine / worklogs API: the admin-set
  // currentTotalWorkingHours is a FLOOR on tracked hours; the untracked
  // excess counts toward the cumulative threshold.
  {
    const trackedAllMonths = roundHours(allMonthsData.reduce((sum, md) => sum + md.hoursWorked, 0));
    const seed = computeStartingBalanceSeed(employee.currentTotalWorkingHours, trackedAllMonths);
    cumulative = roundHours(cumulative + seed);
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

    // ── Rate changelog override for this month ──
    // If a changelog entry exists with effectiveMonth <= md.monthKey, use its
    // rate for BOTH lowRate and highRate. This makes past months keep their
    // old rate while future months use the new rate during recalculation.
    const changelogRate = await getRateForMonth(employeeId, md.monthKey);
    const monthLowRate = changelogRate.rate !== null ? changelogRate.rate : lowRate;
    const monthHighRate = changelogRate.rate !== null ? changelogRate.rate : highRate;
    const monthIsCustom = changelogRate.rate !== null ? true : isCustom;

    if (monthIsCustom) {
      // Custom rate: all hours at the custom rate as a single "standard" record
      const monthHoursRounded = roundHours(md.hoursWorked);
      const totalSalary = computeSalary(monthHoursRounded, monthLowRate); // lowRate == highRate for custom
      const blendedRate = monthHoursRounded > 0 ? roundMoney(totalSalary / monthHoursRounded) : 0;

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
        const siteHoursRounded = roundHours(sh.hours);
        const siteSalary = computeSalary(siteHoursRounded, monthLowRate);
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
            totalHours: siteHoursRounded,
            rtPerHour: monthLowRate,
            totalSalary: siteSalary,
            // Clamp: salary never goes below 0
            balanceSalary: computeBalance(siteSalary, existingDeduction, existingAdvance),
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
            totalHours: siteHoursRounded,
            rtPerHour: monthLowRate,
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
        // Canonical drift-free split (payroll-math) — passes the running
        // consumed threshold as "cumulativeBefore" so each site takes its
        // share of the remaining threshold in deterministic order.
        const split = computeThresholdSplit(sh.hours, consumedThreshold, threshold);
        const siteBelow = split.belowHours;
        const siteAbove = split.aboveHours;
        consumedThreshold = Math.min(threshold, consumedThreshold + siteBelow);

        siteSplits.push({
          siteId: sh.siteId,
          siteName: sh.siteName,
          siteBelow,
          siteAbove,
        });

        totalSalary = roundMoney(totalSalary + computeSalary(siteBelow, monthLowRate) + computeSalary(siteAbove, monthHighRate));
      }

      const blendedRate = md.hoursWorked > 0 ? roundMoney(totalSalary / roundHours(md.hoursWorked)) : 0;

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
          const stdHours = roundHours(split.siteBelow);
          const stdSalary = computeSalary(stdHours, monthLowRate);
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
              totalHours: stdHours,
              rtPerHour: monthLowRate,
              totalSalary: stdSalary,
              // Clamp: salary never goes below 0
              balanceSalary: computeBalance(stdSalary, stdDeduction, stdAdvance),
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
              totalHours: stdHours,
              rtPerHour: monthLowRate,
              totalSalary: stdSalary,
              deduction: 0,
              advance: 0,
              balanceSalary: stdSalary,
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
          const premHours = roundHours(split.siteAbove);
          const premSalary = computeSalary(premHours, monthHighRate);
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
              totalHours: premHours,
              rtPerHour: monthHighRate,
              totalSalary: premSalary,
              // Clamp: salary never goes below 0
              balanceSalary: computeBalance(premSalary, premDeduction, premAdvance),
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
              totalHours: premHours,
              rtPerHour: monthHighRate,
              totalSalary: premSalary,
              deduction: 0,
              advance: 0,
              balanceSalary: premSalary,
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
  const belowSalary = computeSalary(belowHours, lowRate);
  const aboveSalary = computeSalary(aboveHours, highRate);
  const totalSalary = roundMoney(belowSalary + aboveSalary);
  const blendedRate = monthHours > 0 ? roundMoney(totalSalary / roundHours(monthHours)) : 0;

  return {
    belowHours,
    aboveHours,
    belowSalary,
    aboveSalary,
    totalSalary,
    blendedRate: parseFloat(blendedRate.toFixed(4)),
  };
}
