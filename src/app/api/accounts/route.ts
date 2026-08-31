import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildTradeRateMap } from '@/lib/recalculation';
import { buildEmployeeTradeMap } from '@/lib/employee-trade';
import { getBaseRates } from '@/lib/base-rates';
import { safeFindPendingAdvances } from '@/lib/safe-advance';
import { safeFetchSitesWithBranch } from '@/lib/safe-site';
import { getRateMapForMonth } from '@/lib/rate-changelog';
import { getEligibleRecurringAdvances, computeMonthlyDeduction } from '@/lib/advance-deduction';
import { resolveRateSync } from '@/lib/rate-resolver';

export const dynamic = 'force-dynamic';

// GET /api/accounts
// Mode 1: Per-site query (siteId + month required) → returns salary records for that site
// Mode 2: Consolidated query (month required, no siteId) → returns all sites with employees
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const siteId = searchParams.get('siteId');
    const month = searchParams.get('month'); // YYYY-MM
    const year = searchParams.get('year');

    // Build trade rate map + employee trade map + base rates
    const tradeRateMap = await buildTradeRateMap();
    const employeeTradeMap = await buildEmployeeTradeMap();
    const baseRates = await getBaseRates();

    if (!month) {
      return NextResponse.json(
        { success: false, error: 'month (YYYY-MM) query parameter is required' },
        { status: 400 }
      );
    }

    const yearNum = year ? parseInt(year, 10) : parseInt(month.split('-')[0], 10);

    // ─── Mode 1: Per-site query ───
    if (siteId) {
      const site = await db.site.findUnique({
        where: { id: siteId },
        select: { id: true, name: true, clientName: true },
      });

      if (!site) {
        return NextResponse.json(
          { success: false, error: 'Site not found' },
          { status: 404 }
        );
      }

      const salaryRecords = await db.salaryRecord.findMany({
        where: { siteId, month, year: yearNum, isDeleted: false },
        orderBy: [{ slNo: 'asc' }, { empName: 'asc' }],
      });

      const totalEmployees = await db.employee.count({
        where: { currentSite: site.name, status: { not: 'deleted' } },
      });

      const totalHours = salaryRecords.reduce((sum, r) => sum + r.totalHours, 0);
      const totalSalary = salaryRecords.reduce((sum, r) => sum + r.totalSalary, 0);
      const totalDeductions = salaryRecords.reduce((sum, r) => sum + r.deduction, 0);
      const totalAdvances = salaryRecords.reduce((sum, r) => sum + r.advance, 0);
      const totalBalance = salaryRecords.reduce((sum, r) => sum + r.balanceSalary, 0);
      const totalPaid = salaryRecords.filter((r) => r.isPaid).length;
      const totalUnpaid = salaryRecords.filter((r) => !r.isPaid).length;

      return NextResponse.json({
        success: true,
        data: {
          site: { id: site.id, name: site.name, clientName: site.clientName },
          totals: {
            totalEmployees,
            totalSalaryRecords: salaryRecords.length,
            totalHours,
            totalSalary,
            totalDeductions,
            totalAdvances,
            totalBalance,
            totalPaid,
            totalUnpaid,
          },
          salaryRecords: salaryRecords.map((r) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })),
        },
      });
    }

    // ─── Mode 2: Consolidated query (no siteId) ───
    // Returns all sites with their employees for the given month
    // This is used by the Consolidated Salary Sheet

    // Fetch all non-deleted salary records for this month+year
    const allSalaryRecords = await db.salaryRecord.findMany({
      where: { month, year: yearNum, isDeleted: false },
      orderBy: [{ slNo: 'asc' }, { empName: 'asc' }],
    });

    // ── Merge pending advances into the salary records ──
    // Pending advances (status='pending', effectiveMonth=month, effectiveYear=year)
    // are added to the corresponding employee's standard-tier salary record's
    // `advance` field, and `balanceSalary` is recomputed.
    //
    // This is done in-memory here (NOT written to DB) so the Accounts page
    // always shows the latest pending advance amount. The actual DB write
    // happens when the user clicks "Save All" via the bulk-save route.
    //
    // IMPORTANT: This must match the logic in /api/salary-records and the
    // bulk-save route so all three views (Accounts, Consolidated, and saved
    // salary records) agree on the advance amount.
    //
    // The pendingByEmp map is also used later for stub entries (employees
    // with no salary records yet) so their advance amount shows up too.
    const pendingByEmp = new Map<string, number>();
    {
      const pendingAdvances = await safeFindPendingAdvances(month, yearNum);

      if (pendingAdvances.length > 0) {
        // Group pending advances by empId (into the outer pendingByEmp map)
        for (const a of pendingAdvances) {
          pendingByEmp.set(a.empId, (pendingByEmp.get(a.empId) || 0) + a.amount);
        }

        if (allSalaryRecords.length > 0) {
        // Apply to standard-tier records first (one per empId)
        const appliedEmps = new Set<string>();
        for (let i = 0; i < allSalaryRecords.length; i++) {
          const r = allSalaryRecords[i];
          const pending = pendingByEmp.get(r.empId);
          if (pending === undefined) continue;
          if (appliedEmps.has(r.empId)) continue;
          if (r.rateTier !== 'standard') continue;

          const newAdvance = r.advance + pending;
          // Clamp: advance + deduction must never exceed totalSalary.
          // If it does, cap the advance so balance = 0 (salary never negative).
          const maxAdvance = Math.max(0, r.totalSalary - r.deduction);
          const clampedAdvance = Math.min(newAdvance, maxAdvance);
          const newBalance = Math.max(0, r.totalSalary - r.deduction - clampedAdvance);
          allSalaryRecords[i] = {
            ...r,
            advance: clampedAdvance,
            balanceSalary: newBalance,
          };
          appliedEmps.add(r.empId);
        }

        // For employees with no standard-tier record, apply to the first record
        for (let i = 0; i < allSalaryRecords.length; i++) {
          const r = allSalaryRecords[i];
          if (appliedEmps.has(r.empId)) continue;
          const pending = pendingByEmp.get(r.empId);
          if (pending === undefined) continue;

          const newAdvance = r.advance + pending;
          // Same clamping as above
          const maxAdvance2 = Math.max(0, r.totalSalary - r.deduction);
          const clampedAdvance2 = Math.min(newAdvance, maxAdvance2);
          const newBalance2 = Math.max(0, r.totalSalary - r.deduction - clampedAdvance2);
          allSalaryRecords[i] = {
            ...r,
            advance: clampedAdvance2,
            balanceSalary: newBalance2,
          };
          appliedEmps.add(r.empId);
        }
        } // end if (allSalaryRecords.length > 0)
      }
    } // end pending advances block

    // Get all unique empIds from salary records
    const empIds = [...new Set(allSalaryRecords.map((r) => r.empId))];

    // ── Recurring advance deductions for this month ──
    // For each employee with an active recurring advance, compute the monthly
    // deduction (min of monthlyDeductionAmount and remainingBalance) and add
    // it to the pendingByEmp map so it gets merged into the salary records'
    // `advance` field — same as one-time pending advances above.
    //
    // Repayments are NOT recorded here (this is a read-only merge for display).
    // The actual repayment recording happens in bulk-save / toggle-paid when
    // the salary is saved/paid.
    let recurringAdvancesMap: Map<string, ReturnType<typeof computeMonthlyDeduction>> = new Map();
    if (empIds.length > 0) {
      const eligibleMap = await getEligibleRecurringAdvances(empIds, month);
      for (const [empId, advances] of eligibleMap) {
        const deduction = computeMonthlyDeduction(advances);
        if (deduction.totalDeduction > 0) {
          pendingByEmp.set(empId, (pendingByEmp.get(empId) || 0) + deduction.totalDeduction);
          recurringAdvancesMap.set(empId, deduction);
        }
      }
    }

    // Fetch employee details for all employees in salary records
    const employees = await db.employee.findMany({
      where: { id: { in: empIds } },
      select: {
        id: true,
        fullName: true,
        employeeId: true,
        isTeamLeader: true,
        isSupervisor: true,
        isTeko: true,
        hoursThreshold: true,
        nationality: true,
        trade: true,
        customHourlyRate: true,
        role: true,
      },
    });
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    // Teko identity map (realName/workName behind a shared employee code).
    // The data model has no source table for this mapping yet — the UI only
    // consumes `isTeko`. Kept as an (empty) lookup so the stub-employee path
    // below stays type-correct and never crashes; wire it up when a real
    // source for teko identities exists.
    const tekoInfoMap = new Map<string, { realName: string; workName: string }>();

    // ── Fetch per-month rate overrides from the EmployeeRateChangelog table ──
    // For the requested month, get the rate that was effective for each employee.
    // If a changelog entry exists with effectiveMonth <= month, its rate overrides
    // the employee's customHourlyRate for THIS month. This is what makes past
    // months keep their old rate while future months use the new rate.
    const changelogRateMap = await getRateMapForMonth(empIds, month);

    // Fetch ALL salary records for these employees (for cumulative hours calculation)
    // Use salary records as the source of truth (consistent with allocation engine)
    const allEmpSalaryRecords = empIds.length > 0
      ? await db.salaryRecord.findMany({
          where: { empId: { in: empIds }, isDeleted: false },
          select: { empId: true, totalHours: true, month: true },
        })
      : [];

    // Compute previousCumulativeHours for each employee
    // previousCumulative = sum of totalHours from salary records in months BEFORE the current month
    const cumulativeHoursMap = new Map<string, number>();
    for (const sr of allEmpSalaryRecords) {
      if (sr.month < month) {
        cumulativeHoursMap.set(sr.empId, (cumulativeHoursMap.get(sr.empId) || 0) + sr.totalHours);
      }
    }

    // Also compute aggregate total for each employee (all months)
    const aggregateHoursMap = new Map<string, number>();
    for (const sr of allEmpSalaryRecords) {
      aggregateHoursMap.set(sr.empId, (aggregateHoursMap.get(sr.empId) || 0) + sr.totalHours);
    }

    // Fetch TotalEmployeeWorkingHours for custom rate info
    const workingHoursRecords = empIds.length > 0
      ? await db.totalEmployeeWorkingHours.findMany({
          where: { empId: { in: empIds }, isDeleted: false },
          select: {
            id: true,
            empId: true,
            totalWorkingHours: true,
            rtPerHour: true,
            isCustom: true,
            month: true,
          },
        })
      : [];

    // Group working hours by empId
    const whByEmp = new Map<string, typeof workingHoursRecords>();
    for (const wh of workingHoursRecords) {
      if (!whByEmp.has(wh.empId)) whByEmp.set(wh.empId, []);
      whByEmp.get(wh.empId)!.push(wh);
    }

    // Group salary records by siteId
    const siteMap = new Map<string, {
      siteId: string;
      siteName: string;
      records: typeof allSalaryRecords;
    }>();

    for (const record of allSalaryRecords) {
      if (!siteMap.has(record.siteId)) {
        siteMap.set(record.siteId, { siteId: record.siteId, siteName: record.siteName, records: [] });
      }
      siteMap.get(record.siteId)!.records.push(record);
    }

    // ─────────────────────────────────────────────────────────────────
    // ALSO include sites/employees from:
    //   1. EmpCountSitePerMonth (filtered: exclude same-day add/remove)
    //   2. Employees whose currentSite matches a site (for the current month)
    // ─────────────────────────────────────────────────────────────────

    // Helper: check if createdDate and removedDate are the same calendar day
    function isSameDayAddRemove(created: Date, removed: Date | null): boolean {
      if (!removed) return false;
      return created.getFullYear() === removed.getFullYear()
        && created.getMonth() === removed.getMonth()
        && created.getDate() === removed.getDate();
    }

    const empCountRecords = await db.empCountSitePerMonth.findMany({
      where: {
        month,
        deletedDate: null,
      },
      select: {
        empId: true,
        empName: true,
        siteId: true,
        siteName: true,
        createdDate: true,
        removedDate: true,
      },
    });

    // Filter out same-day add/remove (employee added and removed from site on the same day)
    const validEmpCountRecords = empCountRecords.filter(
      (r) => !isSameDayAddRemove(r.createdDate, r.removedDate)
    );

    // Also get employees whose currentSite matches a site for the current month
    const currentMonthStr = month; // YYYY-MM
    const currentYearNum = parseInt(month.split('-')[0], 10);
    const currentMonthNum = parseInt(month.split('-')[1], 10);
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === currentYearNum && (now.getMonth() + 1) === currentMonthNum;

    // Get all active employees with a currentSite set
    const employeesWithSite = isCurrentMonth
      ? await db.employee.findMany({
          where: {
            currentSite: { not: null, notIn: ['', 'Idle'] },
            status: { not: 'deleted' },
          },
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            currentSite: true,
            isTeamLeader: true,
            isSupervisor: true,
            hoursThreshold: true,
            nationality: true,
            trade: true,
            customHourlyRate: true,
            role: true,
          },
        })
      : [];

    // Build a map of site name -> site info for currentSite matching
    const allSites = await db.site.findMany({
      select: { id: true, name: true, clientName: true, projectName: true },
    });
    const siteByNameMap = new Map(allSites.map((s) => [s.name, s]));

    // Add employees with currentSite to siteMap if not already present
    for (const emp of employeesWithSite) {
      const site = siteByNameMap.get(emp.currentSite || '');
      if (!site) continue;

      // Add site to siteMap if not present
      if (!siteMap.has(site.id)) {
        siteMap.set(site.id, { siteId: site.id, siteName: site.name, records: [] });
      }

      // Add employee info to employeeMap if not present
      if (!employeeMap.has(emp.id)) {
        employeeMap.set(emp.id, emp);
      }
    }

    // Add empCount sites to siteMap if not already present
    for (const ecr of validEmpCountRecords) {
      if (!siteMap.has(ecr.siteId)) {
        siteMap.set(ecr.siteId, { siteId: ecr.siteId, siteName: ecr.siteName, records: [] });
      }
    }

    // Collect empIds from empCount and currentSite that aren't in salaryRecords
    const salaryEmpIds = new Set(allSalaryRecords.map((r) => r.empId));
    const missingEmpIdsFromEmpCount = validEmpCountRecords
      .map((r) => r.empId)
      .filter((id) => !salaryEmpIds.has(id));
    const missingEmpIdsFromCurrentSite = employeesWithSite
      .map((e) => e.id)
      .filter((id) => !salaryEmpIds.has(id));
    const missingEmpIds = [...new Set([...missingEmpIdsFromEmpCount, ...missingEmpIdsFromCurrentSite])];

    // Fetch employee details for missing employees
    let missingEmployeesMap = new Map<string, typeof employees[0]>();
    if (missingEmpIds.length > 0) {
      const missingEmps = await db.employee.findMany({
        where: { id: { in: missingEmpIds } },
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
      for (const e of missingEmps) {
        missingEmployeesMap.set(e.id, e);
        employeeMap.set(e.id, e);
      }
    }

    // Also compute cumulative + aggregate for the missing employees
    if (missingEmpIds.length > 0) {
      const allMissingSalaryRecords = await db.salaryRecord.findMany({
        where: { empId: { in: missingEmpIds }, isDeleted: false },
        select: { empId: true, totalHours: true, month: true },
      });
      for (const sr of allMissingSalaryRecords) {
        if (sr.month < month) {
          cumulativeHoursMap.set(sr.empId, (cumulativeHoursMap.get(sr.empId) || 0) + sr.totalHours);
        }
        aggregateHoursMap.set(sr.empId, (aggregateHoursMap.get(sr.empId) || 0) + sr.totalHours);
      }

      // Fetch changelog rates for the missing employees too
      const missingChangelogRates = await getRateMapForMonth(missingEmpIds, month);
      for (const [empId, rate] of missingChangelogRates) {
        changelogRateMap.set(empId, rate);
      }

      // Fetch recurring advance deductions for missing employees too
      const missingRecurringMap = await getEligibleRecurringAdvances(missingEmpIds, month);
      for (const [empId, advances] of missingRecurringMap) {
        const deduction = computeMonthlyDeduction(advances);
        if (deduction.totalDeduction > 0) {
          pendingByEmp.set(empId, (pendingByEmp.get(empId) || 0) + deduction.totalDeduction);
          recurringAdvancesMap.set(empId, deduction);
        }
      }
    }

    // Also fetch working hours for missing employees
    if (missingEmpIds.length > 0) {
      const missingWh = await db.totalEmployeeWorkingHours.findMany({
        where: { empId: { in: missingEmpIds }, isDeleted: false },
        select: {
          id: true,
          empId: true,
          totalWorkingHours: true,
          rtPerHour: true,
          isCustom: true,
          month: true,
        },
      });
      for (const wh of missingWh) {
        if (!whByEmp.has(wh.empId)) whByEmp.set(wh.empId, []);
        whByEmp.get(wh.empId)!.push(wh);
      }
    }

    // Group empCount records by siteId -> empIds for stub entries
    const empCountBySite = new Map<string, { empId: string; empName: string; siteName: string }[]>();
    for (const ecr of validEmpCountRecords) {
      // Only include if NOT already in salary records for this site
      const siteSalaryEmpIds = new Set(
        (siteMap.get(ecr.siteId)?.records || []).map((r) => r.empId)
      );
      if (siteSalaryEmpIds.has(ecr.empId)) continue;

      if (!empCountBySite.has(ecr.siteId)) {
        empCountBySite.set(ecr.siteId, []);
      }
      // Avoid duplicates
      const existing = empCountBySite.get(ecr.siteId)!;
      if (!existing.some((e) => e.empId === ecr.empId)) {
        existing.push({ empId: ecr.empId, empName: ecr.empName, siteName: ecr.siteName });
      }
    }

    // Also add employees from currentSite that aren't in salary records or empCount
    for (const emp of employeesWithSite) {
      const site = siteByNameMap.get(emp.currentSite || '');
      if (!site) continue;

      const siteSalaryEmpIds = new Set(
        (siteMap.get(site.id)?.records || []).map((r) => r.empId)
      );
      if (siteSalaryEmpIds.has(emp.id)) continue;

      // Also skip if already in empCountBySite
      const existingStubs = empCountBySite.get(site.id) || [];
      if (existingStubs.some((e) => e.empId === emp.id)) continue;

      if (!empCountBySite.has(site.id)) {
        empCountBySite.set(site.id, []);
      }
      empCountBySite.get(site.id)!.push({ empId: emp.id, empName: emp.fullName, siteName: site.name });
    }

    // Fetch site info for all sites in the results.
    // IMPORTANT: Use safeFetchSitesWithBranch — it falls back to a branch-less
    // query if the Branch table or Site.branchId column doesn't exist yet
    // (pre-migration state). Without this fallback, the entire /api/accounts
    // route throws a 500 and the Accounts page shows no data.
    const siteIds = Array.from(siteMap.keys());
    const sites = siteIds.length > 0
      ? await safeFetchSitesWithBranch({ id: { in: siteIds } })
      : [];
    const siteInfoMap = new Map(sites.map((s) => [s.id, s]));

    // Define the employee entry type for reuse
    type EmployeeEntry = {
      empId: string;
      empName: string;
      employeeCode: string;
      nationality: string;
      trade: string;
      assignedTrade: string | null;
      assignedTradeRate: number | null;
      isTeamLeader: boolean;
      isSupervisor: boolean;
      rateTier: 'standard' | 'premium';
      salaryRecord: Omit<(typeof allSalaryRecords)[0], 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string } | null;
      workingHours: {
        id?: string;
        empId: string;
        empName: string;
        totalWorkingHours: number;
        rtPerHour: number;
        isCustom: boolean;
        calculatedRtPerHour: number;
        previousCumulativeHours: number;
        hoursThreshold: number;
        customHourlyRate: number | null;
      };
      tekoInfo: { realName: string; workName: string } | null;
      isTeko: boolean;
    };

    // Build the response
    const siteResults: Array<{
      site: {
        id: string;
        name: string;
        clientName: string | null;
        projectName: string | null;
        branchId: string | null;
        branch: { id: string; name: string; code: string | null } | null;
      };
      employeeCount: number;
      totalHours: number;
      totalSalary: number;
      totalDeductions: number;
      totalAdvances: number;
      totalBalanceSalary: number;
      employees: EmployeeEntry[];
    }> = [];
    for (const [sId, sData] of siteMap) {
      const siteInfo = siteInfoMap.get(sId);
      const employeeEntries: EmployeeEntry[] = [];

      // Group records by empId within this site
      const empRecordsMap = new Map<string, typeof sData.records>();
      for (const rec of sData.records) {
        if (!empRecordsMap.has(rec.empId)) empRecordsMap.set(rec.empId, []);
        empRecordsMap.get(rec.empId)!.push(rec);
      }

      for (const [eId, eRecords] of empRecordsMap) {
        const emp = employeeMap.get(eId);
        const hasBonus = emp?.isTeamLeader || emp?.isSupervisor || false;
        const threshold = emp?.hoursThreshold || 1000;
        const previousCumulativeHours = cumulativeHoursMap.get(eId) || 0;
        const aggregateTotal = aggregateHoursMap.get(eId) || 0;
        // ── Rate changelog override ──
        // If the changelog has a rate for this employee for THIS month, use it
        // instead of the employee's current customHourlyRate. This makes past
        // months keep their old rate while future months use the new rate.
        const changelogRate = changelogRateMap.get(eId) ?? null;
        const employeeCustomRate = changelogRate !== null
          ? changelogRate
          : (emp?.customHourlyRate ?? null);

        // ── Rate resolution via the canonical resolver ──
        // Priority: changelog > custom > trade(+0.5 if TL/Sup) > BaseRate
        const salaryTrade = eRecords[0]?.trade || null;
        const empTradeInfo = employeeTradeMap.get(eId);
        const effectiveTrade = salaryTrade || empTradeInfo?.trade || 'Helper';
        const isHelper = effectiveTrade.toLowerCase() === 'helper';
        const tradeRateVal = !isHelper ? (tradeRateMap.get(effectiveTrade) ?? null) : null;

        const resolvedRate = resolveRateSync(
          employeeCustomRate,
          tradeRateVal,
          emp?.isTeamLeader ?? false,
          emp?.isSupervisor ?? false,
          baseRates,
        );
        const lowRate = resolvedRate.lowRate;
        const highRate = resolvedRate.highRate;
        const isCustom = resolvedRate.isCustom;
        const hasCustomRate = resolvedRate.source === 'custom' || resolvedRate.source === 'changelog';
        const hasTradeRate = resolvedRate.source === 'trade';

        // Get working hours info
        const empWhRecords = whByEmp.get(eId) || [];
        const currentMonthWh = empWhRecords.find((wh) => wh.month === month);
        const customRtPerHour = isCustom
          ? (employeeCustomRate ?? (tradeRateVal !== null ? (hasBonus ? tradeRateVal + 0.5 : tradeRateVal) : lowRate))
          : (currentMonthWh?.rtPerHour ?? (empWhRecords.length > 0 ? empWhRecords[empWhRecords.length - 1].rtPerHour : baseRates.standardLow));

        const calculatedRtPerHour = isCustom
          ? customRtPerHour
          : aggregateTotal >= threshold
            ? highRate
            : lowRate;

        // Get current month total working hours from TotalEmployeeWorkingHours
        const totalWorkingHours = currentMonthWh?.totalWorkingHours ?? eRecords.reduce((sum, r) => sum + r.totalHours, 0);

        // For each rate tier, create an entry
        for (const rec of eRecords) {
          employeeEntries.push({
            empId: eId,
            empName: rec.empName,
            employeeCode: rec.employeeCode,
            nationality: rec.nationality,
            trade: rec.trade,
            assignedTrade: employeeTradeMap.get(eId)?.trade || null,
            assignedTradeRate: employeeTradeMap.get(eId)?.hourlyRate ?? null,
            isTeamLeader: emp?.isTeamLeader ?? false,
            isSupervisor: emp?.isSupervisor ?? false,
            rateTier: rec.rateTier as 'standard' | 'premium',
            salaryRecord: {
              ...rec,
              createdAt: rec.createdAt.toISOString(),
              updatedAt: rec.updatedAt.toISOString(),
            },
            workingHours: {
              id: currentMonthWh?.id,
              empId: eId,
              empName: rec.empName,
              totalWorkingHours,
              rtPerHour: isCustom ? customRtPerHour : calculatedRtPerHour,
              isCustom,
              calculatedRtPerHour,
              previousCumulativeHours,
              hoursThreshold: threshold,
              customHourlyRate: employeeCustomRate,
            },
            // Teko info — if a teko entry exists for this employee's ID,
            // the front-end shows a "TEKO" badge next to their name.
            tekoInfo: null,
            isTeko: (emp as Record<string, unknown>)?.isTeko === true,
          });
        }
      }

      // ── Add stub entries for employees assigned via EmpCountSitePerMonth
      //     that have NO salary records yet (so they still show up) ──
      const stubEmpsForSite = empCountBySite.get(sId) || [];
      for (const stub of stubEmpsForSite) {
        // Skip if already added from salary records
        if (empRecordsMap.has(stub.empId)) continue;

        const emp = employeeMap.get(stub.empId);
        const hasBonus = emp?.isTeamLeader || emp?.isSupervisor || false;
        const threshold = emp?.hoursThreshold || 1000;
        const previousCumulativeHours = cumulativeHoursMap.get(stub.empId) || 0;
        const aggregateTotal = aggregateHoursMap.get(stub.empId) || 0;
        // ── Rate changelog override (same as records path above) ──
        const changelogRate = changelogRateMap.get(stub.empId) ?? null;
        const employeeCustomRate = changelogRate !== null
          ? changelogRate
          : (emp?.customHourlyRate ?? null);

        // ── Rate resolution via the canonical resolver (same as records path) ──
        const stubEmpTradeInfo = employeeTradeMap.get(stub.empId);
        const stubEffectiveTrade = stubEmpTradeInfo?.trade || 'Helper';
        const stubIsHelper = stubEffectiveTrade.toLowerCase() === 'helper';
        const tradeRateVal = !stubIsHelper ? (tradeRateMap.get(stubEffectiveTrade) ?? null) : null;

        const resolvedRate = resolveRateSync(
          employeeCustomRate,
          tradeRateVal,
          emp?.isTeamLeader ?? false,
          emp?.isSupervisor ?? false,
          baseRates,
        );
        const lowRate = resolvedRate.lowRate;
        const highRate = resolvedRate.highRate;
        const isCustom = resolvedRate.isCustom;
        const hasCustomRate = resolvedRate.source === 'custom' || resolvedRate.source === 'changelog';
        const hasTradeRate = resolvedRate.source === 'trade';

        const empWhRecords = whByEmp.get(stub.empId) || [];
        const currentMonthWh = empWhRecords.find((wh) => wh.month === month);
        const customRtPerHour = isCustom
          ? (employeeCustomRate ?? (tradeRateVal !== null ? (hasBonus ? tradeRateVal + 0.5 : tradeRateVal) : lowRate))
          : (currentMonthWh?.rtPerHour ?? baseRates.standardLow);

        const calculatedRtPerHour = isCustom
          ? customRtPerHour
          : aggregateTotal >= threshold ? highRate : lowRate;

        const totalWorkingHours = currentMonthWh?.totalWorkingHours ?? 0;

        // Check if this stub employee has a pending advance for this month
        const stubPendingAdvance = pendingByEmp.get(stub.empId) || 0;

        employeeEntries.push({
          empId: stub.empId,
          empName: stub.empName,
          employeeCode: emp?.employeeId || '',
          nationality: emp?.nationality || '',
          trade: emp?.trade || '',
          assignedTrade: employeeTradeMap.get(stub.empId)?.trade || null,
          assignedTradeRate: employeeTradeMap.get(stub.empId)?.hourlyRate ?? null,
          isTeamLeader: emp?.isTeamLeader ?? false,
          isSupervisor: emp?.isSupervisor ?? false,
          rateTier: 'standard',
          // If there's a pending advance, include it in a partial salary record
          // so the front-end mergeApiEntries picks it up. The advance field is
          // the only field that matters here — the rest will be computed from
          // working hours.
          salaryRecord: stubPendingAdvance > 0 ? {
            id: '',
            empId: stub.empId,
            empName: stub.empName,
            siteId: sId,
            siteName: sData.siteName,
            month,
            year: yearNum,
            nationality: emp?.nationality || '',
            trade: 'Helper',
            employeeCode: emp?.employeeId || '',
            slNo: 0,
            totalHours: 0,
            rtPerHour: isCustom ? customRtPerHour : calculatedRtPerHour,
            totalSalary: 0,
            deduction: 0,
            advance: stubPendingAdvance,
            balanceSalary: -stubPendingAdvance,
            isPaid: false,
            isDeleted: false,
            rateTier: 'standard',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          } as any : null,
          workingHours: {
            id: currentMonthWh?.id,
            empId: stub.empId,
            empName: stub.empName,
            totalWorkingHours,
            rtPerHour: isCustom ? customRtPerHour : calculatedRtPerHour,
            isCustom,
            calculatedRtPerHour,
            previousCumulativeHours,
            hoursThreshold: threshold,
            customHourlyRate: employeeCustomRate,
          },
          tekoInfo: tekoInfoMap.get(emp?.employeeId || '') || null,
        });
      }

      // Calculate site totals
      const siteSalaryRecords = sData.records;
      const allSiteEmpIds = [
        ...new Set([
          ...siteSalaryRecords.map((r) => r.empId),
          ...stubEmpsForSite.map((s) => s.empId),
        ]),
      ];
      siteResults.push({
        site: {
          id: sId,
          name: siteInfo?.name || sData.siteName,
          clientName: siteInfo?.clientName || null,
          projectName: siteInfo?.projectName || null,
          branchId: siteInfo?.branchId || null,
          branch: siteInfo?.branch || null,
        },
        employeeCount: allSiteEmpIds.length,
        totalHours: siteSalaryRecords.reduce((sum, r) => sum + r.totalHours, 0),
        totalSalary: siteSalaryRecords.reduce((sum, r) => sum + r.totalSalary, 0),
        totalDeductions: siteSalaryRecords.reduce((sum, r) => sum + r.deduction, 0),
        totalAdvances: siteSalaryRecords.reduce((sum, r) => sum + r.advance, 0),
        totalBalanceSalary: siteSalaryRecords.reduce((sum, r) => sum + r.balanceSalary, 0),
        employees: employeeEntries,
      });
    }

    return NextResponse.json({
      success: true,
      data: { sites: siteResults },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[accounts GET] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
