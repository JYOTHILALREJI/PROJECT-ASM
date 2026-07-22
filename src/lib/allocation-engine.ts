import { db } from '@/lib/db';
import { buildTradeRateMap } from '@/lib/recalculation';

// ---------------------------------------------------------------------------
// Cross-Site Monthly Hour Allocation Engine (Shared Module)
// ---------------------------------------------------------------------------
// Business Rules (Divisor-Based Formula from PRD):
//   Wages = Σ (Hours Worked Within Tier × Tier Rate / Role Divisor)
//
//   Tier Rates are ALWAYS the same regardless of role:
//     - Below threshold (standard): Tier Rate = 2.5
//     - Above threshold (premium):  Tier Rate = 5.0
//
//   Divisor Reference Rules:
//     | Role            | Below Threshold Divisor | Above Threshold Divisor |
//     | Standard        | 1.0                     | 1.0                     |
//     | Team Leader     | 3.0                     | 5.5                     |
//     | Supervisor      | 3.0                     | 5.5                     |
//
//   Effective Rate = Tier Rate / Divisor:
//     | Role            | Below (2.5/div) | Above (5.0/div) |
//     | Standard        | 2.5000          | 5.0000           |
//     | Team Leader     | 0.8333          | 0.9091           |
//     | Supervisor      | 0.8333          | 0.9091           |
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
  // 0. Build trade rate map (for trade-based custom rates)
  // ------------------------------------------------------------------
  const tradeRateMap = await buildTradeRateMap();

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

    // Direct hourly rates (PRD v2.0 — no divisors):
    // Priority: 1) employee.customHourlyRate (per-employee override)
    //           2) Trade rate (from TradeRate table, e.g. "Hilti" = 6)
    //           3) Role-based (TL/Sup: 3.0/5.5, Standard: 2.5/5.0)
    //
    // TRADE PRIORITY for rate lookup:
    //   1. Trade from SalaryRecord (set by admin in Accounts page) — highest
    //   2. Default to "Helper" if no trade set in SalaryRecord
    //
    // NEVER use Employee.trade for rate calculation — that field is only
    // for ID/identification purposes, not for salary calculation.
    const savedTrade = records.length > 0
      ? (records.find(r => r.trade && r.trade.trim() !== '')?.trade || 'Helper')
      : 'Helper';
    const tradeRate = savedTrade ? tradeRateMap.get(savedTrade) : undefined;
    const hasTradeRate = tradeRate !== undefined && tradeRate > 0;
    const hasCustomRate = employeeCustomRate !== null && employeeCustomRate !== undefined;

    const lowRate = hasCustomRate
      ? employeeCustomRate!
      : hasTradeRate
        ? tradeRate!
        : (hasBonus ? 3.0 : 2.5);
    const highRate = hasCustomRate
      ? employeeCustomRate!
      : hasTradeRate
        ? tradeRate!
        : (hasBonus ? 5.5 : 5.0);

    // ------------------------------------------------------------------
    // 3a2. Check if employee has a custom rate override
    // ------------------------------------------------------------------
    // Priority: 1) Employee.customHourlyRate (set directly on employee)
    //           2) TotalEmployeeWorkingHours.isCustom + rtPerHour (legacy)
    //           3) Standard tier rates
    const currentMonthWhRecord = await db.totalEmployeeWorkingHours.findUnique({
      where: { empId_month: { empId, month } },
    });
    const isCustomRate = hasCustomRate || hasTradeRate
      ? true
      : (currentMonthWhRecord?.isCustom ?? false);
    const customRate = hasCustomRate
      ? employeeCustomRate!
      : hasTradeRate
        ? tradeRate!
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
    const previousSalaryRecords = await db.salaryRecord.findMany({
      where: {
        empId,
        month: { lt: month },
        isDeleted: false,
      },
    });

    // Previous cumulative = sum of ALL hours from salary records in months BEFORE current month
    // This spans ALL years, not just the current year.
    const previousCumulative = previousSalaryRecords.reduce(
      (sum, sr) => sum + sr.totalHours,
      0,
    );

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
      siteData.rawHours += record.totalHours;

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
    // KEY CHANGE: Start consumedThreshold from previous cumulative hours
    // This means if the employee already has 800 hours from previous months,
    // only 200 more hours can be at the low rate in this month
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

      const remainingThreshold = threshold - consumedThreshold;
      let lowRateHours = 0;
      let highRateHours = 0;

      if (site.rawHours <= 0) {
        lowRateHours = 0;
        highRateHours = 0;
      } else if (remainingThreshold >= site.rawHours) {
        // Case 1: Site fully inside remaining threshold → all hours at low rate
        lowRateHours = site.rawHours;
        highRateHours = 0;
        consumedThreshold += site.rawHours;
      } else if (remainingThreshold > 0) {
        // Case 2: Site crosses the threshold → split
        lowRateHours = remainingThreshold;
        highRateHours = site.rawHours - remainingThreshold;
        consumedThreshold = threshold;
      } else {
        // Case 3: Threshold already exhausted → all hours at high rate
        lowRateHours = 0;
        highRateHours = site.rawHours;
      }

      siteAllocations.push({
        siteId: site.siteId,
        siteName: site.siteName,
        rawHours: site.rawHours,
        lowRateHours,
        highRateHours,
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
          : (existingStdRate && existingStdRate !== lowRate)
            ? existingStdRate
            : alloc.lowRate;
        const totalSalary = alloc.lowRateHours * effectiveLowRate;
        const carryDeduction = siteData.existingStandard?.deduction ?? 0;
        const carryAdvance = siteData.existingStandard?.advance ?? 0;
        const balanceSalary = totalSalary - carryDeduction - carryAdvance;

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
            trade: siteData.existingStandard?.trade || savedTrade,
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
            trade: savedTrade,
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
          : (existingPremRate && existingPremRate !== highRate)
            ? existingPremRate
            : alloc.highRate;
        const totalSalary = alloc.highRateHours * effectiveHighRate;
        const carryDeduction = siteData.existingPremium?.deduction ?? 0;
        const carryAdvance = siteData.existingPremium?.advance ?? 0;
        const balanceSalary = totalSalary - carryDeduction - carryAdvance;

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
            trade: siteData.existingPremium?.trade || savedTrade,
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
            trade: savedTrade,
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
    const totalLowRateHours = siteAllocations.reduce(
      (sum, s) => sum + s.lowRateHours,
      0,
    );
    const totalHighRateHours = siteAllocations.reduce(
      (sum, s) => sum + s.highRateHours,
      0,
    );

    const perSiteMatch = siteAllocations.every(
      (s) => Math.abs(s.lowRateHours + s.highRateHours - s.rawHours) < 0.01,
    );

    const totalMatch =
      Math.abs(totalLowRateHours + totalHighRateHours - currentMonthTotal) < 0.01;

    const noNegative = siteAllocations.every(
      (s) => s.lowRateHours >= 0 && s.highRateHours >= 0 && s.rawHours >= 0,
    );

    allocations.push({
      empId,
      empName: employee.fullName,
      threshold,
      previousCumulative,
      currentMonthTotal,
      totalRawHours: previousCumulative + currentMonthTotal,
      sites: siteAllocations,
      validation: {
        totalLowRateHours,
        totalHighRateHours,
        lowRateHoursWithinThreshold: (previousCumulative + totalLowRateHours) <= threshold + 0.01,
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

    const empHasBonus =
      empInfo?.isTeamLeader || empInfo?.isSupervisor || false;
    const empThreshold = empInfo?.hoursThreshold || 1000;

    // Direct hourly rates (PRD v2.0 — no divisors)
    const employeeCustomRateCheck = await db.employee.findUnique({
      where: { id: allocation.empId },
      select: { customHourlyRate: true },
    });
    const empCustomRate = employeeCustomRateCheck?.customHourlyRate;
    
    const calculatedRt =
      empCustomRate !== null && empCustomRate !== undefined
        ? empCustomRate
        : (aggregateTotal >= empThreshold
          ? (empHasBonus ? 5.5 : 5.0)
          : (empHasBonus ? 3.0 : 2.5));

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
          rtPerHour: 2.5,
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
  isTeamLeader: boolean;
  isSupervisor: boolean;
  isCustomRate?: boolean;
  customRate?: number;
  customHourlyRate?: number | null;
}): SiteAllocation[] {
  const { previousCumulative, currentMonthSiteHours, threshold, isTeamLeader, isSupervisor, isCustomRate = false, customRate = 2.5, customHourlyRate = null } = params;
  const hasBonus = isTeamLeader || isSupervisor;
  // Direct hourly rates (PRD v2.0 — no divisors)
  const effectiveCustomRate = customHourlyRate != null ? customHourlyRate : customRate;
  const effectiveIsCustom = isCustomRate || customHourlyRate != null;
  const lowRate = effectiveIsCustom && effectiveCustomRate
    ? effectiveCustomRate
    : (hasBonus ? 3.0 : 2.5);
  const highRate = effectiveIsCustom && effectiveCustomRate
    ? effectiveCustomRate
    : (hasBonus ? 5.5 : 5.0);

  let consumedThreshold = Math.min(previousCumulative, threshold);
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

    const remainingThreshold = threshold - consumedThreshold;
    let lowRateHours = 0;
    let highRateHours = 0;

    if (site.rawHours <= 0) {
      lowRateHours = 0;
      highRateHours = 0;
    } else if (remainingThreshold >= site.rawHours) {
      // Case 1: Site fully inside remaining threshold
      lowRateHours = site.rawHours;
      highRateHours = 0;
      consumedThreshold += site.rawHours;
    } else if (remainingThreshold > 0) {
      // Case 2: Site crosses the threshold
      lowRateHours = remainingThreshold;
      highRateHours = site.rawHours - remainingThreshold;
      consumedThreshold = threshold;
    } else {
      // Case 3: Threshold already exhausted
      lowRateHours = 0;
      highRateHours = site.rawHours;
    }

    siteAllocations.push({
      siteId: site.siteId,
      siteName: site.siteName,
      rawHours: site.rawHours,
      lowRateHours,
      highRateHours,
      lowRate,
      highRate,
    });
  }

  return siteAllocations;
}
