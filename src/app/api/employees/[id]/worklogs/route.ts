import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { recalcEmployeeFromMonth, recalcEmployeeFull, getEmployeeRates, computeSalaryBreakdown, buildTradeRateMap } from '@/lib/recalculation';
import { buildEmployeeTradeMap } from '@/lib/employee-trade';

// Ensure fresh data on every request — no caching
export const dynamic = 'force-dynamic';

// GET /api/employees/[id]/worklogs
// Get all WorkLog entries for an employee, with SalaryRecord fallback for months without WorkLog entries
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const yearNum = year ? parseInt(year, 10) : null;

    const where: Record<string, unknown> = { employeeId: id, deletedAt: null };
    if (yearNum !== null) {
      where.year = yearNum;
    }

    // 2. Get employee info FIRST — before any other query.
    // This ensures we return a proper 404 (instead of a 500 from a later
    // query) if the employee doesn't exist.
    //
    // Defensive: try with the full select (including currentTotalWorkingHours)
    // first. If that fails (e.g. because the user's Prisma client wasn't
    // regenerated after the schema change that added currentTotalWorkingHours),
    // fall back to a simpler query without that field.
    let employee: {
      id: string;
      fullName: string;
      employeeId: string;
      role: string;
      isTeamLeader: boolean;
      isSupervisor: boolean;
      customHourlyRate: number | null;
      hoursThreshold: number;
      nationality: string | null;
      trade: string | null;
      currentTotalWorkingHours: number;
    } | null = null;
    try {
      employee = await db.employee.findUnique({
        where: { id },
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
    } catch (empErr) {
      console.warn('[worklogs GET] employee.findUnique with full select failed, trying simpler query:', empErr instanceof Error ? empErr.message : empErr);
      try {
        // Fallback: query without currentTotalWorkingHours (in case the
        // Prisma client wasn't regenerated after the schema change)
        const empSimple = await db.employee.findUnique({
          where: { id },
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
        employee = empSimple ? { ...empSimple, currentTotalWorkingHours: 0 } : null;
      } catch (empErr2) {
        console.error('[worklogs GET] employee.findUnique fallback also failed:', empErr2 instanceof Error ? empErr2.message : empErr2);
        employee = null;
      }
    }

    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    // 1. Fetch work logs (filtered by year if provided).
    // Defensive: try with `include: { site }` first; if that fails (e.g.
    // because the Site→Branch relation is broken in the user's Prisma client
    // or DB), fall back to a query without the include and fetch site names
    // separately.
    let workLogs: Array<{
      logId: number;
      employeeId: string;
      siteId: string;
      year: number;
      month: number;
      hoursWorked: number;
      allowances: number;
      deductions: number;
      deletedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      site?: { id: string; name: string } | null;
    }> = [];
    try {
      workLogs = await db.workLog.findMany({
        where,
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
        include: {
          site: { select: { id: true, name: true } },
        },
      });
    } catch (wlErr) {
      console.warn('[worklogs GET] workLog.findMany with include failed, falling back:', wlErr instanceof Error ? wlErr.message : wlErr);
      // Fallback: query without include
      try {
        workLogs = await db.workLog.findMany({
          where,
          orderBy: [{ year: 'asc' }, { month: 'asc' }],
        });
      } catch (wlErr2) {
        console.error('[worklogs GET] workLog.findMany fallback also failed:', wlErr2 instanceof Error ? wlErr2.message : wlErr2);
        workLogs = [];
      }
    }

    const tradeRateMap = await buildTradeRateMap();
    const employeeTradeMap = await buildEmployeeTradeMap();

    // Trade priority: SalaryRecord (Accounts edit) > EmployeeTrade > "Helper"
    // Defensive: if this query fails, fall back to EmployeeTrade or "Helper".
    let savedTrade: string | null = null;
    try {
      const salaryRecsForTrade = await db.salaryRecord.findMany({
        where: { empId: id, isDeleted: false },
        select: { trade: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      savedTrade = (salaryRecsForTrade[0]?.trade && salaryRecsForTrade[0].trade.trim()) || null;
    } catch (tradeErr) {
      console.warn('[worklogs GET] salaryRecsForTrade query failed:', tradeErr instanceof Error ? tradeErr.message : tradeErr);
      savedTrade = null;
    }
    const empTradeInfo = employeeTradeMap.get(id);
    const effectiveTrade = savedTrade || empTradeInfo?.trade || 'Helper';
    const employeeWithTrade = { ...employee, trade: effectiveTrade };
    const { lowRate, highRate, isCustom } = await getEmployeeRates(employeeWithTrade, tradeRateMap);
    const threshold = employee.hoursThreshold || 1000;

    // 3. Fetch ALL work logs (no year filter) for cumulative calculation.
    // Defensive: if this fails, use the year-filtered workLogs as a fallback.
    let allLogs: typeof workLogs = [];
    try {
      allLogs = await db.workLog.findMany({
        where: { employeeId: id, deletedAt: null },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
      });
    } catch (allLogsErr) {
      console.warn('[worklogs GET] allLogs query failed, using year-filtered workLogs as fallback:', allLogsErr instanceof Error ? allLogsErr.message : allLogsErr);
      allLogs = workLogs;
    }

    // 4. Fetch ALL salary records (no year filter) for cumulative calculation and fallback entries
    let allSalaryRecords: Array<{
      id: string;
      empId: string;
      empName: string;
      siteId: string;
      siteName: string;
      month: string;
      year: number;
      nationality: string;
      trade: string;
      employeeCode: string;
      slNo: number;
      totalHours: number;
      rtPerHour: number;
      totalSalary: number;
      deduction: number;
      advance: number;
      balanceSalary: number;
      isPaid: boolean;
      isDeleted: boolean;
      rateTier: string;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    }> = [];
    try {
      allSalaryRecords = await db.salaryRecord.findMany({
        where: {
          empId: id,
          isDeleted: false,
        },
      });
    } catch (srErr) {
      console.warn('[worklogs GET] salaryRecord.findMany failed, returning empty:', srErr instanceof Error ? srErr.message : srErr);
      allSalaryRecords = [];
    }

    // 5. Build combined month data for cumulative calculation
    // For each month, total hours = sum of work log hours + salary record hours for (siteId, month) combos not covered by work logs
    const combinedMonthHours = new Map<string, number>(); // monthKey -> total hours

    // Add work log hours
    for (const log of allLogs) {
      const key = `${log.year}-${String(log.month).padStart(2, '0')}`;
      combinedMonthHours.set(key, (combinedMonthHours.get(key) || 0) + log.hoursWorked);
    }

    // Build set of (siteId, monthKey) from ALL work logs for deduplication
    const allWorkLogSiteMonthSet = new Set<string>();
    for (const log of allLogs) {
      const key = `${log.siteId}|${log.year}-${String(log.month).padStart(2, '0')}`;
      allWorkLogSiteMonthSet.add(key);
    }

    // Aggregate salary record hours by (siteId, month) for combos NOT covered by work logs
    // EXCLUDE camp_sitting rate tier — those hours don't count toward the ledger
    const salarySiteMonthHours = new Map<string, { monthKey: string; totalHours: number }>();
    for (const sr of allSalaryRecords) {
      // Skip camp_sitting records — their hours are not part of the lifetime ledger
      if (sr.rateTier === 'camp_sitting') continue;
      const siteMonthKey = `${sr.siteId}|${sr.month}`;
      if (!allWorkLogSiteMonthSet.has(siteMonthKey)) {
        const existing = salarySiteMonthHours.get(siteMonthKey);
        if (existing) {
          existing.totalHours += sr.totalHours;
        } else {
          salarySiteMonthHours.set(siteMonthKey, { monthKey: sr.month, totalHours: sr.totalHours });
        }
      }
    }

    // Add salary record hours to combined month hours
    for (const [, data] of salarySiteMonthHours) {
      combinedMonthHours.set(data.monthKey, (combinedMonthHours.get(data.monthKey) || 0) + data.totalHours);
    }

    // 6. Compute cumulative before each month (from combined data)
    // CRITICAL: seed the running total with the employee's
    // currentTotalWorkingHours (manual starting balance). This way the
    // manual hours are reflected in every month's cumulative column AND
    // in the threshold progress bar. Without this, the manual hours only
    // show up in the aggregate total but not in the per-month cumulative.
    //
    // However, we only seed if the manual value is HIGHER than the sum of
    // all monthly hours (i.e. the manual value includes hours from before
    // the system was set up). If the monthly hours already sum to more
    // than the manual value, we don't seed (the monthly data is the
    // source of truth).
    const totalMonthlyHours = Array.from(combinedMonthHours.values()).reduce((s, h) => s + h, 0);
    const manualTotalHours = employee.currentTotalWorkingHours || 0;
    const seedHours = Math.max(0, manualTotalHours - totalMonthlyHours);

    const sortedMonthKeys = Array.from(combinedMonthHours.keys()).sort();
    const cumulativeMap = new Map<string, number>();
    let runningTotal = seedHours; // seed with manual starting balance
    for (const key of sortedMonthKeys) {
      cumulativeMap.set(key, runningTotal);
      runningTotal += combinedMonthHours.get(key)!;
    }

    // 7. Filter salary records for the requested year (for paid status and synthetic entries)
    const salaryRecords = yearNum !== null
      ? allSalaryRecords.filter(sr => sr.year === yearNum)
      : allSalaryRecords;

    // 8. Build set of (siteId, monthKey) from filtered work logs for deduplication
    const filteredWorkLogKeys = new Set<string>();
    for (const log of workLogs) {
      const monthKey = `${log.year}-${String(log.month).padStart(2, '0')}`;
      filteredWorkLogKeys.add(`${log.siteId}|${monthKey}`);
    }

    // 9. Build monthly data from work logs — AGGREGATED by month (not per-site)
    // If an employee worked at multiple sites in the same month, their hours
    // are summed into a single entry so the breakdown (below/above threshold)
    // is computed on the TOTAL hours, not just one site's hours.
    const workLogsByMonth = new Map<string, typeof workLogs>();
    for (const log of workLogs) {
      const monthKey = `${log.year}-${String(log.month).padStart(2, '0')}`;
      if (!workLogsByMonth.has(monthKey)) workLogsByMonth.set(monthKey, []);
      workLogsByMonth.get(monthKey)!.push(log);
    }

    const monthlyData = Array.from(workLogsByMonth.entries()).map(([monthKey, logs]) => {
      const cumulativeBefore = cumulativeMap.get(monthKey) || 0;
      // Sum hours across all sites for this month
      const totalHours = logs.reduce((sum, l) => sum + l.hoursWorked, 0);
      const breakdown = computeSalaryBreakdown(
        totalHours,
        cumulativeBefore,
        threshold,
        isCustom ? lowRate : lowRate,
        isCustom ? highRate : highRate,
      );

      // Find matching salary records for this month (across all sites)
      const monthSalaryRecords = salaryRecords.filter(sr => sr.month === monthKey);
      const stdRecord = monthSalaryRecords.find(sr => sr.rateTier === 'standard');
      const premRecord = monthSalaryRecords.find(sr => sr.rateTier === 'premium');

      const deduction = stdRecord?.deduction ?? premRecord?.deduction ?? 0;
      const advance = stdRecord?.advance ?? premRecord?.advance ?? 0;
      const isPaid = (stdRecord?.isPaid ?? false) || (premRecord?.isPaid ?? false);

      // Use first log for base fields; aggregate site names
      const firstLog = logs[0];
      const siteNames = logs.map(l => l.site?.name).filter(Boolean).join(', ');

      return {
        logId: firstLog.logId,
        employeeId: firstLog.employeeId,
        siteId: firstLog.siteId,
        siteName: siteNames || firstLog.site?.name || '',
        year: firstLog.year,
        month: firstLog.month,
        monthKey,
        hoursWorked: totalHours,
        allowances: logs.reduce((s, l) => s + l.allowances, 0),
        deductions: logs.reduce((s, l) => s + l.deductions, 0),
        cumulativeBefore,
        cumulativeAfter: cumulativeBefore + totalHours,
        // Rate info
        lowRate,
        highRate,
        isCustom,
        // Salary breakdown — computed on TOTAL hours
        belowHours: breakdown.belowHours,
        aboveHours: breakdown.aboveHours,
        belowSalary: breakdown.belowSalary,
        aboveSalary: breakdown.aboveSalary,
        totalSalary: breakdown.totalSalary,
        blendedRate: breakdown.blendedRate,
        // Financial
        deduction,
        advance,
        balanceSalary: parseFloat((breakdown.totalSalary - deduction - advance).toFixed(2)),
        isPaid,
        // Record IDs for updates (from first site's records)
        standardRecordId: stdRecord?.id ?? null,
        premiumRecordId: premRecord?.id ?? null,
        // Timestamps
        createdAt: firstLog.createdAt.toISOString(),
        updatedAt: firstLog.updatedAt.toISOString(),
        // Source indicator
        isSynthetic: false,
      };
    });

    // 10. Create synthetic entries for salary records that don't have corresponding work logs
    // Group salary records by (siteId, month) to aggregate standard+premium tiers into a single entry
    const salaryBySiteMonth = new Map<string, {
      siteId: string;
      siteName: string;
      month: string;
      year: number;
      totalHours: number;
      stdRecord: typeof salaryRecords[0] | undefined;
      premRecord: typeof salaryRecords[0] | undefined;
    }>();

    for (const sr of salaryRecords) {
      // Skip camp_sitting records — their hours are not part of the lifetime ledger
      if (sr.rateTier === 'camp_sitting') continue;
      const key = `${sr.siteId}|${sr.month}`;
      if (filteredWorkLogKeys.has(key)) continue; // Skip if work log exists for this site+month

      const existing = salaryBySiteMonth.get(key);
      if (existing) {
        existing.totalHours += sr.totalHours;
        if (sr.rateTier === 'standard') existing.stdRecord = sr;
        if (sr.rateTier === 'premium') existing.premRecord = sr;
      } else {
        salaryBySiteMonth.set(key, {
          siteId: sr.siteId,
          siteName: sr.siteName,
          month: sr.month,
          year: sr.year,
          totalHours: sr.totalHours,
          stdRecord: sr.rateTier === 'standard' ? sr : undefined,
          premRecord: sr.rateTier === 'premium' ? sr : undefined,
        });
      }
    }

    // Convert grouped salary records into synthetic work-log-shaped entries
    const syntheticEntries = Array.from(salaryBySiteMonth.values()).map(srGroup => {
      const monthNum = parseInt(srGroup.month.split('-')[1], 10);
      const cumulativeBefore = cumulativeMap.get(srGroup.month) || 0;
      const breakdown = computeSalaryBreakdown(
        srGroup.totalHours,
        cumulativeBefore,
        threshold,
        isCustom ? lowRate : lowRate,
        isCustom ? highRate : highRate,
      );

      const deduction = srGroup.stdRecord?.deduction ?? srGroup.premRecord?.deduction ?? 0;
      const advance = srGroup.stdRecord?.advance ?? srGroup.premRecord?.advance ?? 0;
      const isPaid = (srGroup.stdRecord?.isPaid ?? false) || (srGroup.premRecord?.isPaid ?? false);

      return {
        logId: null as number | null,
        employeeId: id,
        siteId: srGroup.siteId,
        siteName: srGroup.siteName,
        year: srGroup.year,
        month: monthNum,
        monthKey: srGroup.month,
        hoursWorked: srGroup.totalHours,
        allowances: 0,
        deductions: 0,
        cumulativeBefore,
        cumulativeAfter: cumulativeBefore + srGroup.totalHours,
        // Rate info
        lowRate,
        highRate,
        isCustom,
        // Salary breakdown
        belowHours: breakdown.belowHours,
        aboveHours: breakdown.aboveHours,
        belowSalary: breakdown.belowSalary,
        aboveSalary: breakdown.aboveSalary,
        totalSalary: breakdown.totalSalary,
        blendedRate: breakdown.blendedRate,
        // Financial
        deduction,
        advance,
        balanceSalary: parseFloat((breakdown.totalSalary - deduction - advance).toFixed(2)),
        isPaid,
        // Record IDs for updates
        standardRecordId: srGroup.stdRecord?.id ?? null,
        premiumRecordId: srGroup.premRecord?.id ?? null,
        // Timestamps
        createdAt: (srGroup.stdRecord ?? srGroup.premRecord)!.createdAt.toISOString(),
        updatedAt: (srGroup.stdRecord ?? srGroup.premRecord)!.updatedAt.toISOString(),
        // Source indicator
        isSynthetic: true,
      };
    });

    // 11. Combine and sort all entries chronologically
    // If there are manual starting-balance hours (seedHours > 0), prepend a
    // synthetic "Custom Hours" entry at the beginning of the list so the
    // monthly breakdown shows where those hours came from. This entry has
    // a special monthKey '__custom__' that the UI renders differently.
    let allEntries = [...monthlyData, ...syntheticEntries].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

    if (seedHours > 0) {
      const customEntry = {
        logId: null,
        employeeId: employee.id,
        siteId: '',
        siteName: 'Custom (Starting Balance)',
        year: 0,
        month: 0,
        monthKey: '__custom__',
        hoursWorked: seedHours,
        allowances: 0,
        deductions: 0,
        cumulativeBefore: 0,
        cumulativeAfter: seedHours,
        lowRate,
        highRate,
        isCustom,
        belowHours: seedHours,
        aboveHours: 0,
        belowSalary: 0,
        aboveSalary: 0,
        totalSalary: 0,
        blendedRate: 0,
        deduction: 0,
        advance: 0,
        balanceSalary: 0,
        isPaid: false,
        standardRecordId: null,
        premiumRecordId: null,
        createdAt: '',
        updatedAt: '',
        isSynthetic: true,
        isCustomHours: true,
      };
      allEntries = [customEntry, ...allEntries];
    }

    // 12. Aggregate total hours from ALL sources (work logs + salary record fallbacks)
    // Use the employee's currentTotalWorkingHours as a FLOOR — if the admin
    // manually set it to a value higher than the computed aggregate (e.g. a
    // starting balance from before the system was set up), use the manual
    // value so the ledger reflects it.
    const computedTotalHours = runningTotal;
    const aggregateTotalHours = Math.max(computedTotalHours, manualTotalHours);

    return NextResponse.json({
      success: true,
      data: {
        workLogs: allEntries,
        employeeInfo: {
          id: employee.id,
          fullName: employee.fullName,
          employeeId: employee.employeeId,
          role: employee.role,
          isTeamLeader: employee.isTeamLeader,
          isSupervisor: employee.isSupervisor,
          customHourlyRate: employee.customHourlyRate,
          hoursThreshold: threshold,
          nationality: employee.nationality,
          trade: effectiveTrade,
          lowRate,
          highRate,
          isCustom,
          totalWorkingHours: aggregateTotalHours,
          currentTier: aggregateTotalHours >= threshold ? 'premium' : 'standard',
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[worklogs GET] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// POST /api/employees/[id]/worklogs
// Add or update a work log entry (upsert by employee+site+year+month)
// Triggers recalculation from the affected month onward
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { siteId, year, month, hoursWorked, allowances, deductions, force } = body;

    if (!siteId || !year || !month || hoursWorked === undefined) {
      return NextResponse.json(
        { success: false, error: 'siteId, year, month, and hoursWorked are required' },
        { status: 400 }
      );
    }

    const yearNum = parseInt(String(year), 10);
    const monthNum = parseInt(String(month), 10);
    const hours = parseFloat(String(hoursWorked));

    if (monthNum < 1 || monthNum > 12) {
      return NextResponse.json(
        { success: false, error: 'month must be between 1 and 12' },
        { status: 400 }
      );
    }

    // Check if employee exists
    const employee = await db.employee.findUnique({ where: { id } });
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    // Check if site exists
    const site = await db.site.findUnique({ where: { id: siteId } });
    if (!site) {
      return NextResponse.json(
        { success: false, error: 'Site not found' },
        { status: 404 }
      );
    }

    // Check if any salary record for this month is already paid
    const monthKey = `${yearNum}-${String(monthNum).padStart(2, '0')}`;
    const paidRecords = await db.salaryRecord.findMany({
      where: {
        empId: id,
        siteId,
        month: monthKey,
        year: yearNum,
        isPaid: true,
        isDeleted: false,
      },
    });

    if (paidRecords.length > 0 && !force) {
      return NextResponse.json(
        {
          success: false,
          error: 'This month has already been marked as paid. Set force=true to override.',
          isPaidWarning: true,
          paidRecordIds: paidRecords.map(r => r.id),
        },
        { status: 409 }
      );
    }

    // Upsert the work log
    const workLog = await db.workLog.upsert({
      where: {
        employeeId_siteId_year_month: {
          employeeId: id,
          siteId,
          year: yearNum,
          month: monthNum,
        },
      },
      update: {
        hoursWorked: hours,
        allowances: allowances ? parseFloat(String(allowances)) : 0,
        deductions: deductions ? parseFloat(String(deductions)) : 0,
        deletedAt: null, // un-soft-delete if previously deleted
      },
      create: {
        employeeId: id,
        siteId,
        year: yearNum,
        month: monthNum,
        hoursWorked: hours,
        allowances: allowances ? parseFloat(String(allowances)) : 0,
        deductions: deductions ? parseFloat(String(deductions)) : 0,
      },
    });

    // Trigger recalculation from this month onward
    const recalcResult = await recalcEmployeeFromMonth(id, yearNum, monthNum);

    return NextResponse.json({
      success: true,
      data: {
        workLog: {
          ...workLog,
          createdAt: workLog.createdAt.toISOString(),
          updatedAt: workLog.updatedAt.toISOString(),
        },
        recalculation: recalcResult,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[worklogs POST] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// PUT /api/employees/[id]/worklogs
// Batch update multiple work log entries (for the hours ledger save)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { entries, force } = body;

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { success: false, error: 'entries must be a non-empty array' },
        { status: 400 }
      );
    }

    const employee = await db.employee.findUnique({ where: { id } });
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    // Check for paid months
    if (!force) {
      for (const entry of entries) {
        const monthKey = `${entry.year}-${String(entry.month).padStart(2, '0')}`;
        const paidRecords = await db.salaryRecord.findMany({
          where: {
            empId: id,
            month: monthKey,
            year: entry.year,
            isPaid: true,
            isDeleted: false,
          },
        });
        if (paidRecords.length > 0) {
          return NextResponse.json(
            {
              success: false,
              error: `Month ${monthKey} has already been marked as paid. Set force=true to override.`,
              isPaidWarning: true,
              month: monthKey,
            },
            { status: 409 }
          );
        }
      }
    }

    const results: Array<{ month: string; action: string }> = [];
    let earliestYear = Infinity;
    let earliestMonth = 13;

    for (const entry of entries) {
      const { siteId, year, month, hoursWorked, allowances, deductions } = entry;
      const yearNum = parseInt(String(year), 10);
      const monthNum = parseInt(String(month), 10);
      const hours = parseFloat(String(hoursWorked ?? 0));
      const effectiveSiteId = siteId || employee.currentSiteId;

      if (!effectiveSiteId) {
        results.push({ month: `${yearNum}-${String(monthNum).padStart(2, '0')}`, action: 'skipped_no_site' });
        continue;
      }

      // Track earliest month for recalculation
      if (yearNum < earliestYear || (yearNum === earliestYear && monthNum < earliestMonth)) {
        earliestYear = yearNum;
        earliestMonth = monthNum;
      }

      // Upsert work log
      await db.workLog.upsert({
        where: {
          employeeId_siteId_year_month: {
            employeeId: id,
            siteId: effectiveSiteId,
            year: yearNum,
            month: monthNum,
          },
        },
        update: {
          hoursWorked: hours,
          allowances: allowances ? parseFloat(String(allowances)) : 0,
          deductions: deductions ? parseFloat(String(deductions)) : 0,
          deletedAt: hours > 0 ? null : new Date(), // soft-delete if hours = 0
        },
        create: {
          employeeId: id,
          siteId: effectiveSiteId,
          year: yearNum,
          month: monthNum,
          hoursWorked: hours,
          allowances: allowances ? parseFloat(String(allowances)) : 0,
          deductions: deductions ? parseFloat(String(deductions)) : 0,
        },
      });

      results.push({ month: `${yearNum}-${String(monthNum).padStart(2, '0')}`, action: 'upserted' });
    }

    // Trigger recalculation from the earliest changed month
    let recalcResult: { monthsRecalculated: number; employeeId: string } | null = null;
    if (earliestYear < Infinity) {
      recalcResult = await recalcEmployeeFromMonth(id, earliestYear, earliestMonth);
    }

    return NextResponse.json({
      success: true,
      data: {
        updated: results.length,
        results,
        recalculation: recalcResult,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[worklogs PUT] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// DELETE /api/employees/[id]/worklogs
// Soft-delete a work log entry (set deletedAt)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const logId = searchParams.get('logId');
    const siteId = searchParams.get('siteId');
    const year = searchParams.get('year');
    const month = searchParams.get('month');

    if (!logId && (!siteId || !year || !month)) {
      return NextResponse.json(
        { success: false, error: 'Either logId or siteId+year+month is required' },
        { status: 400 }
      );
    }

    // Find the work log
    let workLog;
    if (logId) {
      workLog = await db.workLog.findFirst({
        where: { logId: parseInt(logId, 10), employeeId: id },
      });
    } else {
      workLog = await db.workLog.findUnique({
        where: {
          employeeId_siteId_year_month: {
            employeeId: id,
            siteId: siteId!,
            year: parseInt(year!, 10),
            month: parseInt(month!, 10),
          },
        },
      });
    }

    if (!workLog) {
      return NextResponse.json(
        { success: false, error: 'Work log not found' },
        { status: 404 }
      );
    }

    // Check for paid salary records
    const monthKey = `${workLog.year}-${String(workLog.month).padStart(2, '0')}`;
    const paidRecords = await db.salaryRecord.findMany({
      where: {
        empId: id,
        siteId: workLog.siteId,
        month: monthKey,
        year: workLog.year,
        isPaid: true,
        isDeleted: false,
      },
    });

    const force = searchParams.get('force') === 'true';
    if (paidRecords.length > 0 && !force) {
      return NextResponse.json(
        {
          success: false,
          error: 'This month has been marked as paid. Set force=true to override.',
          isPaidWarning: true,
        },
        { status: 409 }
      );
    }

    // Soft delete
    await db.workLog.update({
      where: { logId: workLog.logId },
      data: { deletedAt: new Date() },
    });

    // Trigger recalculation from this month onward
    const recalcResult = await recalcEmployeeFromMonth(id, workLog.year, workLog.month);

    return NextResponse.json({
      success: true,
      data: {
        deleted: true,
        logId: workLog.logId,
        month: monthKey,
        recalculation: recalcResult,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[worklogs DELETE] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
