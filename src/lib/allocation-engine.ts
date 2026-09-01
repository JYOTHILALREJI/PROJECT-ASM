import { db } from '@/lib/db';
import { buildTradeRateMap } from '@/lib/recalculation';
import { buildEmployeeTradeMap } from '@/lib/employee-trade';
import { getBaseRates } from '@/lib/base-rates';
import { resolveRateSync } from '@/lib/rate-resolver';
import { isHelperTrade } from '@/lib/trade-utils';
import {
  computeThresholdSplit,
  composeSalaryRecord,
  computeSalary,
  computeBalance,
  roundHours,
  roundMoney,
  EPSILON,
} from '@/lib/payroll-math';

// ---------------------------------------------------------------------------
// Cross-Site Monthly Hour Allocation Engine (Shared Module)
// ---------------------------------------------------------------------------
// Business Rules (Threshold-Based Direct Rates):
//   Wages = Σ (Hours Worked Within Tier × Tier Rate)
//
//   Tier Rates come from the BaseRate singleton in the DB:
//     - Below threshold (standard): baseLow (default 3.5) — EVERY employee
//     - Above threshold (premium):  helperHigh (default 6.0) for Helpers,
//                                   tradeHigh (default 7.0) for other trades
//
//   Effective Rate Table (defaults):
//     | Employee type | Below (baseLow) | Above threshold        |
//     | Helper        | 3.5             | 6.0                    |
//     | Other trade   | 3.5             | 7.0                    |
//     | Custom rate   | customRate      | customRate (flat)      |
//     | TradeRate row | tradeRate (+0.5 TL/Sup, flat)                  |
//
//   Where N = employee's hoursThreshold (default 1000).
//   KEY: The threshold is CUMULATIVE across all months, NOT per-month.
//
//   Sequential Allocation:
//     1. Compute previous months' cumulative hours for the employee
//     2. remainingThreshold = max(0, threshold - previousCumulative)
//     3. Sort employee's sites alphabetically by site name
//     4. Walk sites sequentially, consuming the remaining threshold
//     5. Split each site's hours into lowRate (standard) and highRate (premium)
// ---------------------------------------------------------------------------

/** True when the employee's trade is "Helper" (case-insensitive). */
function isHelperTradeLocal(trade: string | null | undefined): boolean {
  return (trade ?? '').trim().toLowerCase() === 'helper';
}

/**
 * Rates that have ever shipped as system defaults. A stored rate matching
 * one of these (or the current configured rates) is treated as a stale
 * default — NOT a deliberate user edit — so it gets re-priced to the
 * current trade-aware rate on every allocation run. Any other value is a
 * genuine manual override and is preserved.
 */
const LEGACY_DEFAULT_RATES = [2.5, 3.0, 5.0, 5.5];
function isDefaultLikeRate(
  rate: number | null | undefined,
  baseRates: { baseLow: number; helperHigh: number; tradeHigh: number },
): boolean {
  if (rate === null || rate === undefined) return true;
  return (
    LEGACY_DEFAULT_RATES.some((d) => Math.abs(rate - d) < EPSILON) ||
    Math.abs(rate - baseRates.baseLow) < EPSILON ||
    Math.abs(rate - baseRates.helperHigh) < EPSILON ||
    Math.abs(rate - baseRates.tradeHigh) < EPSILON
  );
}

export interface SiteAllocation {
  siteId: string;
  siteName: string;
  rawHours: number;
  lowRateHours: number;
  highRateHours: number;
  lowRate: number;
  highRate: number;
}

export interface EmployeeAllocation {
  empId: string;
  empName: string;
  threshold: number;
  previousCumulative: number;
  currentMonthTotal: number;
  totalRawHours: number;
  sites: SiteAllocation[];
  validation: {
    totalLowRateHours: number;
    totalHighRateHours: number;
    lowRateHoursWithinThreshold: boolean;
    hoursMatch: boolean;
  };
}

export interface AllocationResult {
  month: string;
  year: number;
  employeesProcessed: number;
  allocations: EmployeeAllocation[];
}

/**
 * Run the allocation engine for a specific month+year.
 *
 * This function:
 * 1. Fetches all non-deleted salary records for the given month+year
 * 2. Groups them by employee
 * 3. For each employee:
 *    a. Fetches employee details and ALL previous months' working hours
 *    b. Computes cumulative hours from previous months
 *    c. Calculates remaining threshold
 *    d. Applies sequential allocation across sites
 * 4. Creates/updates/soft-deletes salary records (standard & premium tiers)
 * 5. Updates TotalEmployeeWorkingHours for each processed employee
 * 6. Returns allocation results
 */
export async function allocateEmployeeHours(
  month: string,
  year: number,
): Promise<AllocationResult> {
  // ------------------------------------------------------------------
  // 0. Build trade rate map + employee trade map + base rates
  // ------------------------------------------------------------------
  const tradeRateMap = await buildTradeRateMap();
  const employeeTradeMap = await buildEmployeeTradeMap();
  const baseRates = await getBaseRates();

  // ------------------------------------------------------------------
  // 1. Fetch all non-deleted salary records for the given month+year
  // ------------------------------------------------------------------
  const salaryRecords = await db.salaryRecord.findMany({
    where: {
      month,
      year,
      isDeleted: false,
    },
  });

  // ------------------------------------------------------------------
  // 2. Group by employee (empId)
  // ------------------------------------------------------------------
  const employeeMap = new Map<string, typeof salaryRecords>();
  for (const record of salaryRecords) {
    if (!employeeMap.has(record.empId)) {
      employeeMap.set(record.empId, []);
    }
    employeeMap.get(record.empId)!.push(record);
  }

  // ------------------------------------------------------------------
  // 3. Process each employee
  // ------------------------------------------------------------------
  const allocations: EmployeeAllocation[] = [];

  for (const [empId, records] of employeeMap) {
    // 3a. Fetch employee details
    const employee = await db.employee.findUnique({
      where: { id: empId },
      select: {
        id: true,
        fullName: true,
        employeeId: true,
        isTeamLeader: true,
        isSupervisor: true,
        hoursThreshold: true,
        nationality: true,
        trade: true,
        customHourlyRate: true,
        role: true,
      },
    });

    // Skip if employee not found
    if (!employee) continue;

    const threshold = employee.hoursThreshold || 1000;
    const hasBonus = employee.isTeamLeader || employee.isSupervisor;
    const employeeCustomRate = employee.customHourlyRate;

    // ── Rate resolution: delegate to the canonical resolver ──
    // Priority: Custom > Trade(+0.5 if TL/Sup) > BaseRate
    // The changelog override is NOT applied here because the allocation
    // engine runs per-month and the caller already passes the correct month.
    // If changelog support is needed, the caller should pre-resolve the
    // custom rate and pass it as employeeCustomRate.
    const savedTrade = records.length > 0
      ? (records.find(r => r.trade && r.trade.trim() !== '')?.trade || null)
      : null;
    const empTradeInfo = employeeTradeMap.get(empId);
    const effectiveTradeName = savedTrade || empTradeInfo?.trade || 'Helper';
    const isHelper = effectiveTradeName.toLowerCase() === 'helper';
    const tradeRateVal = !isHelper ? (tradeRateMap.get(effectiveTradeName) ?? null) : null;

    const resolved = resolveRateSync(
      employeeCustomRate ?? null,
      tradeRateVal,
      employee.isTeamLeader,
      employee.isSupervisor,
      baseRates,
      isHelperTrade(effectiveTradeName),
    );
    const lowRate = resolved.lowRate;
    const highRate = resolved.highRate;
    const hasCustomRate = resolved.isCustom;
    const hasTradeRate = resolved.source === 'trade';

    // ------------------------------------------------------------------
    // 3a2. Check if employee has a custom rate override
    // ------------------------------------------------------------------
    // isCustomRate = true when the employee has a custom rate OR a trade rate
    // (both override the threshold-based split).
    const currentMonthWhRecord = await db.totalEmployeeWorkingHours.findUnique({
      where: { empId_month: { empId, month } },
    });
    const isCustomRate = hasCustomRate || hasTradeRate
      ? true
      : (currentMonthWhRecord?.isCustom ?? false);
    // NOTE: for trade-rate employees the resolver already includes the
    // +0.5 TL/Sup bonus in lowRate/highRate, so we reuse lowRate here.
    const customRate = hasCustomRate
      ? employeeCustomRate!
      : hasTradeRate
        ? lowRate
        : (currentMonthWhRecord?.rtPerHour ?? lowRate);

    // ------------------------------------------------------------------
    // 3b. Compute previous months' cumulative hours
    // ------------------------------------------------------------------
    // IMPORTANT: We compute previousCumulative from SALARY RECORDS directly
    // rather than from TotalEmployeeWorkingHours, because TotalEmployeeWorkingHours
    // can become inconsistent (e.g., aggregate values saved as monthly totals).
    // Salary records are the source of truth for hours worked.
    //
    // CRITICAL: This is CUMULATIVE ACROSS ALL YEARS, not per-year.
    // String comparison "2024-12" < "2025-01" is correct for YYYY-MM format,
    // so month: { lt: month } correctly includes all prior months across years.
    //
    // CRITICAL: Exclude rateTier='camp_sitting' — camp sitting hours must NOT
    // count toward the lifetime threshold (only P=10h and overtime count).
    const previousSalaryRecords = await db.salaryRecord.findMany({
      where: {
        empId,
        month: { lt: month },
        isDeleted: false,
        rateTier: { in: ['standard', 'premium'] },
      },
    });

    // Previous cumulative = sum of ALL hours from salary records in months BEFORE current month
    // This spans ALL years, not just the current year. Rounded to 2dp.
    const previousCumulative = roundHours(previousSalaryRecords.reduce(
      (sum, sr) => sum + sr.totalHours,
      0,
    ));

    // ------------------------------------------------------------------
    // 3c. Group by site, calculate rawHours per site
    // ------------------------------------------------------------------
    const siteMap = new Map<
      string,
      {
        siteId: string;
        siteName: string;
        rawHours: number;
        existingStandard: (typeof records)[0] | undefined;
        existingPremium: (typeof records)[0] | undefined;
      }
    >();

    for (const record of records) {
      // Skip camp_sitting records — they're handled separately and must NOT
      // be included in the threshold split or the site's rawHours.
      if (record.rateTier === 'camp_sitting') continue;

      if (!siteMap.has(record.siteId)) {
        siteMap.set(record.siteId, {
          siteId: record.siteId,
          siteName: record.siteName,
          rawHours: 0,
          existingStandard: undefined,
          existingPremium: undefined,
        });
      }
      const siteData = siteMap.get(record.siteId)!;
      // Round each addition so accumulating many sites can never drift.
      siteData.rawHours = roundHours(siteData.rawHours + record.totalHours);

      // Track existing records by rateTier for carry-forward
      if (record.rateTier === 'standard') {
        siteData.existingStandard = record;
      } else if (record.rateTier === 'premium') {
        siteData.existingPremium = record;
      }
    }

    // ------------------------------------------------------------------
    // 3d. Sort by site name (alphabetically) for deterministic allocation
    // ------------------------------------------------------------------
    const sortedSites = Array.from(siteMap.values()).sort((a, b) =>
      a.siteName.localeCompare(b.siteName),
    );

    // ------------------------------------------------------------------
    // 3e. Calculate total raw hours across all sites for current month
    // ------------------------------------------------------------------
    const currentMonthTotal = sortedSites.reduce((sum, s) => sum + s.rawHours, 0);

    // ------------------------------------------------------------------
    // 3f. Apply sequential allocation algorithm with cumulative threshold
    // ------------------------------------------------------------------
    // KEY: Start consumedThreshold from previous cumulative hours.
    // This means if the employee already has 800 hours from previous months,
    // only 200 more hours can be at the low rate in this month.
    //
    // If the employee has a custom rate, skip the split entirely —
    // all hours go at the custom rate as a single "standard" record.
    let consumedThreshold = Math.min(previousCumulative, threshold);
    const siteAllocations: SiteAllocation[] = [];

    for (const site of sortedSites) {
      if (isCustomRate) {
        // ── Custom Rate: no split, all hours at the custom rate ──
        siteAllocations.push({
          siteId: site.siteId,
          siteName: site.siteName,
          rawHours: site.rawHours,
          lowRateHours: site.rawHours,
          highRateHours: 0,
          lowRate: customRate,
          highRate: customRate,
        });
        continue;
      }

      // Canonical drift-free split (payroll-math) — the running consumed
      // threshold is passed as "cumulativeBefore" so each site consumes its
      // share of the remaining threshold in deterministic (alphabetical) order.
      const split = computeThresholdSplit(site.rawHours, consumedThreshold, threshold);
      consumedThreshold = Math.min(threshold, consumedThreshold + split.belowHours);

      siteAllocations.push({
        siteId: site.siteId,
        siteName: site.siteName,
        rawHours: site.rawHours,
        lowRateHours: split.belowHours,
        highRateHours: split.aboveHours,
        lowRate,
        highRate,
      });
    }

    // ------------------------------------------------------------------
    // 3g. Create / update / soft-delete salary records
    // ------------------------------------------------------------------
    for (let i = 0; i < sortedSites.length; i++) {
      const siteData = sortedSites[i];
      const alloc = siteAllocations[i];

      // Determine the isPaid status for this employee+site+month+year
      // Use OR logic: if either standard or premium is paid, both should be paid
      const carryIsPaidForSite = siteData.existingStandard?.isPaid || siteData.existingPremium?.isPaid || false;

      // --- Standard (lowRate) record ---
      if (alloc.lowRateHours > 0) {
        // For custom rate employees, always use the custom rate
        // For others, preserve user-edited rate from existing record if it differs from default
        const existingStdRate = siteData.existingStandard?.rtPerHour;
        const effectiveLowRate = isCustomRate
          ? customRate
          : isDefaultLikeRate(existingStdRate, baseRates)
            ? alloc.lowRate
            : existingStdRate!;
        // Compose every derived value (hours/rate/salary/balance) through the
        // canonical payroll math — rounded, clamped, drift-free.
        const composed = composeSalaryRecord({
          hours: alloc.lowRateHours,
          rate: effectiveLowRate,
          deduction: siteData.existingStandard?.deduction ?? 0,
          advance: siteData.existingStandard?.advance ?? 0,
        });
        const totalSalary = composed.totalSalary;
        const carryDeduction = siteData.existingStandard?.deduction ?? 0;
        const carryAdvance = siteData.existingStandard?.advance ?? 0;
        const balanceSalary = composed.balanceSalary;

        await db.salaryRecord.upsert({
          where: {
            empId_siteId_month_year_rateTier: {
              empId,
              siteId: alloc.siteId,
              month,
              year,
              rateTier: 'standard',
            },
          },
          update: {
            empName: employee.fullName,
            siteName: alloc.siteName,
            nationality: employee.nationality || '',
            // Preserve the trade from the existing salary record — don't
            // overwrite with employee.trade. The admin may have changed the
            // trade in Accounts (e.g. from "Labor" to "Hilti") and that
            // change must survive the allocation engine. Fall back to
            // 'Helper' if no trade is set.
            trade: siteData.existingStandard?.trade || effectiveTradeName,
            employeeCode: employee.employeeId || '',
            totalHours: alloc.lowRateHours,
            rtPerHour: effectiveLowRate,
            totalSalary,
            deduction: carryDeduction,
            advance: carryAdvance,
            balanceSalary,
            isPaid: carryIsPaidForSite,
            isDeleted: false,
          },
          create: {
            empId,
            empName: employee.fullName,
            siteId: alloc.siteId,
            siteName: alloc.siteName,
            month,
            year,
            nationality: employee.nationality || '',
            trade: effectiveTradeName,
            employeeCode: employee.employeeId || '',
            slNo: 0,
            totalHours: alloc.lowRateHours,
            rtPerHour: effectiveLowRate,
            totalSalary,
            deduction: carryDeduction,
            advance: carryAdvance,
            balanceSalary,
            isPaid: carryIsPaidForSite,
            rateTier: 'standard',
          },
        });
      } else {
        // lowRateHours is 0 — soft-delete the standard record if it exists
        const existing = await db.salaryRecord.findUnique({
          where: {
            empId_siteId_month_year_rateTier: {
              empId,
              siteId: alloc.siteId,
              month,
              year,
              rateTier: 'standard',
            },
          },
        });
        if (existing && !existing.isDeleted) {
          await db.salaryRecord.update({
            where: { id: existing.id },
            data: { isDeleted: true },
          });
        }
      }

      // --- Premium (highRate) record ---
      if (alloc.highRateHours > 0) {
        // For custom rate employees, always use the custom rate
        // For others, preserve user-edited rate from existing record if it differs from default
        const existingPremRate = siteData.existingPremium?.rtPerHour;
        const effectiveHighRate = isCustomRate
          ? customRate
          : isDefaultLikeRate(existingPremRate, baseRates)
            ? alloc.highRate
            : existingPremRate!;
        // Compose every derived value through the canonical payroll math.
        const composedPrem = composeSalaryRecord({
          hours: alloc.highRateHours,
          rate: effectiveHighRate,
          deduction: siteData.existingPremium?.deduction ?? 0,
          advance: siteData.existingPremium?.advance ?? 0,
        });
        const totalSalary = composedPrem.totalSalary;
        const carryDeduction = siteData.existingPremium?.deduction ?? 0;
        const carryAdvance = siteData.existingPremium?.advance ?? 0;
        const balanceSalary = composedPrem.balanceSalary;

        await db.salaryRecord.upsert({
          where: {
            empId_siteId_month_year_rateTier: {
              empId,
              siteId: alloc.siteId,
              month,
              year,
              rateTier: 'premium',
            },
          },
          update: {
            empName: employee.fullName,
            siteName: alloc.siteName,
            nationality: employee.nationality || '',
            // Preserve trade from existing record (see standard record comment above)
            trade: siteData.existingPremium?.trade || effectiveTradeName,
            employeeCode: employee.employeeId || '',
            totalHours: alloc.highRateHours,
            rtPerHour: effectiveHighRate,
            totalSalary,
            deduction: carryDeduction,
            advance: carryAdvance,
            balanceSalary,
            isPaid: carryIsPaidForSite,
            isDeleted: false,
          },
          create: {
            empId,
            empName: employee.fullName,
            siteId: alloc.siteId,
            siteName: alloc.siteName,
            month,
            year,
            nationality: employee.nationality || '',
            trade: effectiveTradeName,
            employeeCode: employee.employeeId || '',
            slNo: 0,
            totalHours: alloc.highRateHours,
            rtPerHour: effectiveHighRate,
            totalSalary,
            deduction: carryDeduction,
            advance: carryAdvance,
            balanceSalary,
            isPaid: carryIsPaidForSite,
            rateTier: 'premium',
          },
        });
      } else {
        // highRateHours is 0 — soft-delete the premium record if it exists
        const existing = await db.salaryRecord.findUnique({
          where: {
            empId_siteId_month_year_rateTier: {
              empId,
              siteId: alloc.siteId,
              month,
              year,
              rateTier: 'premium',
            },
          },
        });
        if (existing && !existing.isDeleted) {
          await db.salaryRecord.update({
            where: { id: existing.id },
            data: { isDeleted: true },
          });
        }
      }
    }

    // ------------------------------------------------------------------
    // 3h. Validation checks
    // ------------------------------------------------------------------
    const totalLowRateHours = roundHours(siteAllocations.reduce(
      (sum, s) => sum + s.lowRateHours,
      0,
    ));
    const totalHighRateHours = roundHours(siteAllocations.reduce(
      (sum, s) => sum + s.highRateHours,
      0,
    ));

    const perSiteMatch = siteAllocations.every(
      (s) => Math.abs(s.lowRateHours + s.highRateHours - s.rawHours) < EPSILON,
    );

    const totalMatch =
      Math.abs(totalLowRateHours + totalHighRateHours - roundHours(currentMonthTotal)) < EPSILON;

    const noNegative = siteAllocations.every(
      (s) => s.lowRateHours >= 0 && s.highRateHours >= 0 && s.rawHours >= 0,
    );

    allocations.push({
      empId,
      empName: employee.fullName,
      threshold,
      previousCumulative,
      currentMonthTotal,
      totalRawHours: roundHours(previousCumulative + currentMonthTotal),
      sites: siteAllocations,
      validation: {
        totalLowRateHours,
        totalHighRateHours,
        lowRateHoursWithinThreshold: (previousCumulative + totalLowRateHours) <= threshold + EPSILON,
        hoursMatch: perSiteMatch && totalMatch && noNegative,
      },
    });
  }

  // ------------------------------------------------------------------
  // 4. Update TotalEmployeeWorkingHours for each processed employee
  // ------------------------------------------------------------------
  for (const allocation of allocations) {
    const updatedSalaryRecords = await db.salaryRecord.findMany({
      where: {
        empId: allocation.empId,
        month,
        year,
        isDeleted: false,
      },
    });

    const totalHoursFromSalary = updatedSalaryRecords.reduce(
      (sum, sr) => sum + sr.totalHours,
      0,
    );

    // Compute aggregate total from salary records directly (source of truth)
    // rather than from TotalEmployeeWorkingHours which can become stale/inconsistent
    const allSalaryRecordsForEmp = await db.salaryRecord.findMany({
      where: { empId: allocation.empId, isDeleted: false },
    });
    const aggregateTotal = allSalaryRecordsForEmp.reduce(
      (sum, sr) => sum + sr.totalHours,
      0,
    );

    // Find existing record for current month to preserve isCustom / custom rate
    const currentMonthWhRecord = await db.totalEmployeeWorkingHours.findUnique({
      where: { empId_month: { empId: allocation.empId, month } },
    });

    // Calculate rtPerHour based on aggregate and employee type
    const empInfo = await db.employee.findUnique({
      where: { id: allocation.empId },
      select: {
        isTeamLeader: true,
        isSupervisor: true,
        hoursThreshold: true,
      },
    });

    const empThreshold = empInfo?.hoursThreshold || 1000;

    // Direct hourly rates — trade-aware premium (Helper 6.0 / other trades 7.0)
    const employeeCustomRateCheck = await db.employee.findUnique({
      where: { id: allocation.empId },
      select: { customHourlyRate: true, trade: true },
    });
    const empCustomRate = employeeCustomRateCheck?.customHourlyRate;
    const empIsHelper = isHelperTrade(employeeCustomRateCheck?.trade);

    const calculatedRt =
      empCustomRate !== null && empCustomRate !== undefined
        ? empCustomRate
        : (aggregateTotal >= empThreshold
          ? (empIsHelper ? baseRates.helperHigh : baseRates.tradeHigh)
          : baseRates.baseLow);

    const isCustom = currentMonthWhRecord?.isCustom ?? false;
    const effectiveRt = isCustom
      ? (currentMonthWhRecord?.rtPerHour ?? calculatedRt)
      : calculatedRt;

    await db.totalEmployeeWorkingHours.upsert({
      where: {
        empId_month: { empId: allocation.empId, month },
      },
      update: {
        totalWorkingHours: totalHoursFromSalary,
        empName: allocation.empName,
        rtPerHour: effectiveRt,
        isCustom,
        isDeleted: false,
      },
      create: {
        empId: allocation.empId,
        empName: allocation.empName,
        month,
        totalWorkingHours: totalHoursFromSalary,
        rtPerHour: effectiveRt,
        isCustom: false,
      },
    });

    // Also fix previous months' TotalEmployeeWorkingHours to ensure consistency
    // Compute the correct monthly totals from salary records and update
    const allEmpMonths = new Set(allSalaryRecordsForEmp.map(sr => sr.month));
    for (const m of allEmpMonths) {
      if (m === month) continue; // Already handled above
      const monthTotal = allSalaryRecordsForEmp
        .filter(sr => sr.month === m)
        .reduce((sum, sr) => sum + sr.totalHours, 0);

      await db.totalEmployeeWorkingHours.upsert({
        where: { empId_month: { empId: allocation.empId, month: m } },
        update: { totalWorkingHours: monthTotal, isDeleted: false },
        create: {
          empId: allocation.empId,
          empName: allocation.empName,
          month: m,
          totalWorkingHours: monthTotal,
          rtPerHour: baseRates.baseLow,
          isCustom: false,
        },
      });
    }
  }

  return {
    month,
    year,
    employeesProcessed: allocations.length,
    allocations,
  };
}

/**
 * Compute the allocation split for a single employee in a given month
 * WITHOUT writing to the database. Useful for previewing the split
 * or for the GET endpoint to show calculated splits.
 */
export function computeAllocationSplit(params: {
  previousCumulative: number;
  currentMonthSiteHours: Array<{ siteId: string; siteName: string; rawHours: number }>;
  threshold: number;
  isTeamLeader?: boolean;
  isSupervisor?: boolean;
  /** The employee's effective trade — decides helper (6.0) vs trade (7.0) premium */
  trade?: string | null;
  isCustomRate?: boolean;
  customRate?: number;
  customHourlyRate?: number | null;
  baseRates?: { baseLow: number; helperHigh: number; tradeHigh: number };
}): SiteAllocation[] {
  const { previousCumulative, currentMonthSiteHours, threshold, isCustomRate = false, customRate, customHourlyRate = null, baseRates, trade } = params;
  // Trade-aware base rates: baseLow below threshold; helperHigh (Helpers)
  // or tradeHigh (other trades) above threshold. TL/Sup flags no longer
  // change the base tiers — only a defined TradeRate (+0.5) can override.
  const br = baseRates ?? { baseLow: 3.5, helperHigh: 6.0, tradeHigh: 7.0 };
  const isHelper = isHelperTrade(trade);
  const baseLow = br.baseLow;
  const baseHigh = isHelper ? br.helperHigh : br.tradeHigh;
  const effectiveCustomRate = customHourlyRate != null ? customHourlyRate : (customRate ?? baseLow);
  const effectiveIsCustom = isCustomRate || customHourlyRate != null;
  const lowRate = effectiveIsCustom && effectiveCustomRate
    ? effectiveCustomRate
    : baseLow;
  const highRate = effectiveIsCustom && effectiveCustomRate
    ? effectiveCustomRate
    : baseHigh;

  let consumedThreshold = Math.min(roundHours(previousCumulative), threshold);
  const siteAllocations: SiteAllocation[] = [];

  // Sort sites alphabetically by name for deterministic allocation
  const sortedSites = [...currentMonthSiteHours].sort((a, b) =>
    a.siteName.localeCompare(b.siteName),
  );

  for (const site of sortedSites) {
    // If custom rate is set, no split — all hours at the custom rate
    if (effectiveIsCustom && effectiveCustomRate) {
      siteAllocations.push({
        siteId: site.siteId,
        siteName: site.siteName,
        rawHours: site.rawHours,
        lowRateHours: site.rawHours,
        highRateHours: 0,
        lowRate: effectiveCustomRate,
        highRate: effectiveCustomRate,
      });
      continue;
    }

    // Canonical drift-free split (payroll-math)
    const split = computeThresholdSplit(site.rawHours, consumedThreshold, threshold);
    consumedThreshold = Math.min(threshold, consumedThreshold + split.belowHours);

    siteAllocations.push({
      siteId: site.siteId,
      siteName: site.siteName,
      rawHours: site.rawHours,
      lowRateHours: split.belowHours,
      highRateHours: split.aboveHours,
      lowRate,
      highRate,
    });
  }

  return siteAllocations;
}
