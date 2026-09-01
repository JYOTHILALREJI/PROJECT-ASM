import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildTradeRateMap } from '@/lib/recalculation';
import { buildEmployeeTradeMap } from '@/lib/employee-trade';
import { getBaseRates } from '@/lib/base-rates';
import { resolveRateSync, resolveEffectiveTradeName } from '@/lib/rate-resolver';

// GET: Returns all active employees with their cumulative hours and effective rate
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Fetch all active (non-deleted) employees
    const employees = await db.employee.findMany({
      where: { status: { not: 'deleted' } },
      select: {
        id: true,
        fullName: true,
        employeeId: true,
        trade: true,
        isTeamLeader: true,
        isSupervisor: true,
        customHourlyRate: true,
        hoursThreshold: true,
        currentSite: true,
        currentTotalWorkingHours: true,
      },
      orderBy: { fullName: 'asc' },
    });

    // Batch fetch all salary records for cumulative hours calculation
    const allSalaryRecords = await db.salaryRecord.findMany({
      where: { isDeleted: false },
      select: {
        empId: true,
        totalHours: true,
        month: true,
        siteId: true,
      },
    });

    // Batch fetch all WorkLog entries (hours entered directly in the Hours
    // Ledger). These must be included in the cumulative total so the
    // directory progress bar updates when hours are added via the ledger.
    const allWorkLogs = await db.workLog.findMany({
      where: { deletedAt: null },
      select: {
        employeeId: true,
        siteId: true,
        year: true,
        month: true,
        hoursWorked: true,
      },
    });

    // Build a map of empId → cumulative hours from BOTH sources:
    //   1. WorkLog entries (directly entered hours)
    //   2. SalaryRecord entries for (empId, siteId, month) combos NOT
    //      already covered by a WorkLog (to avoid double-counting)
    //
    // This mirrors the logic in /api/employees/[id]/worklogs GET.
    const cumulativeHoursMap = new Map<string, number>();

    // First, add all WorkLog hours
    const workLogSiteMonthSet = new Set<string>(); // empId|siteId|year-month
    for (const wl of allWorkLogs) {
      const current = cumulativeHoursMap.get(wl.employeeId) || 0;
      cumulativeHoursMap.set(wl.employeeId, current + wl.hoursWorked);
      const key = `${wl.employeeId}|${wl.siteId}|${wl.year}-${String(wl.month).padStart(2, '0')}`;
      workLogSiteMonthSet.add(key);
    }

    // Then, add SalaryRecord hours ONLY for combos not covered by WorkLog
    for (const sr of allSalaryRecords) {
      const srMonthNum = parseInt(sr.month.split('-')[1], 10);
      const srYearNum = parseInt(sr.month.split('-')[0], 10);
      const key = `${sr.empId}|${sr.siteId}|${srYearNum}-${String(srMonthNum).padStart(2, '0')}`;
      if (!workLogSiteMonthSet.has(key)) {
        const current = cumulativeHoursMap.get(sr.empId) || 0;
        cumulativeHoursMap.set(sr.empId, current + sr.totalHours);
      }
    }

    // Batch fetch latest EmpCountSitePerMonth for each employee to resolve currentSite
    // Get the most recent month entry per employee (where not deleted)
    const siteDeployments = await db.empCountSitePerMonth.findMany({
      where: { deletedDate: null },
      select: {
        empId: true,
        siteId: true,
        siteName: true,
        month: true,
      },
      orderBy: { month: 'desc' },
    });

    // Build a map of empId → latest site info from deployments
    const latestSiteMap = new Map<string, { siteId: string; siteName: string }>();
    for (const dep of siteDeployments) {
      if (!latestSiteMap.has(dep.empId)) {
        latestSiteMap.set(dep.empId, { siteId: dep.siteId, siteName: dep.siteName });
      }
    }

    // Batch fetch site names for employees with currentSite set
    const siteIds = [...new Set(employees.map(e => e.currentSite).filter(Boolean))] as string[];
    const sites = await db.site.findMany({
      where: { id: { in: siteIds } },
      select: { id: true, name: true },
    });
    const siteNameMap = new Map(sites.map(s => [s.id, s.name]));

    // Build trade rate map + employee trade map
    const tradeRateMap = await buildTradeRateMap();
    const employeeTradeMap = await buildEmployeeTradeMap();
    const baseRates = await getBaseRates();

    // Fetch trade from SalaryRecords for Accounts-edit priority
    const allSalaryRecsForTrade = await db.salaryRecord.findMany({
      where: { isDeleted: false },
      select: { empId: true, trade: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const salaryTradeMap = new Map<string, string>();
    for (const sr of allSalaryRecsForTrade) {
      if (!salaryTradeMap.has(sr.empId) && sr.trade && sr.trade.trim()) {
        salaryTradeMap.set(sr.empId, sr.trade);
      }
    }

    // Build result
    const data = employees.map((emp) => {
      const computedHours = cumulativeHoursMap.get(emp.id) || 0;
      const manualHours = emp.currentTotalWorkingHours || 0;
      const cumulativeHours = Math.max(computedHours, manualHours);
      const hasBonus = emp.isTeamLeader || emp.isSupervisor;
      const threshold = emp.hoursThreshold || 1000;

      // ── Rate resolution via the canonical resolver ──
      // Priority: Custom > Trade(+0.5 if TL/Sup) > BaseRate
      // Healed trade: non-Helper record trades win; Employee.trade heals the
      // attendance-sync "Helper" placeholder (Mason → 7.0, not 6.0).
      const effectiveTrade = resolveEffectiveTradeName({
        savedRecordTrade: salaryTradeMap.get(emp.id) ?? null,
        employeeTrade: emp.trade ?? null,
        assignedTrade: employeeTradeMap.get(emp.id)?.trade ?? null,
      });
      const isHelper = effectiveTrade.toLowerCase() === 'helper';
      const tradeRateVal = !isHelper ? (tradeRateMap.get(effectiveTrade) ?? null) : null;

      const resolvedRate = resolveRateSync(
        emp.customHourlyRate ?? null,
        tradeRateVal,
        emp.isTeamLeader,
        emp.isSupervisor,
        baseRates,
        isHelper,
      );
      const lowRate = resolvedRate.lowRate;
      const highRate = resolvedRate.highRate;

      let effectiveRate: number;
      let rateLabel: string;
      if (resolvedRate.source === 'custom') {
        effectiveRate = emp.customHourlyRate!;
        rateLabel = 'Custom';
      } else if (resolvedRate.source === 'trade') {
        effectiveRate = resolvedRate.lowRate; // includes +0.5 bonus if TL/Sup
        rateLabel = `${effectiveTrade} (${tradeRateVal}${hasBonus ? ' +0.5' : ''})`;
      } else if (cumulativeHours >= threshold) {
        effectiveRate = highRate;
        rateLabel = `After ${threshold}h (${highRate})`;
      } else {
        effectiveRate = lowRate;
        rateLabel = `Below ${threshold}h (${lowRate})`;
      }

      // Resolve current site: prefer latest deployment, fallback to employee.currentSite
      let currentSite: string | null;
      const latestDeployment = latestSiteMap.get(emp.id);
      if (latestDeployment) {
        currentSite = latestDeployment.siteName;
      } else if (emp.currentSite) {
        currentSite = siteNameMap.get(emp.currentSite) || emp.currentSite;
      } else {
        currentSite = null;
      }

      // Threshold status
      const thresholdStatus = cumulativeHours >= threshold ? 'above' : 'below';

      return {
        id: emp.id,
        fullName: emp.fullName,
        employeeId: emp.employeeId,
        currentSite,
        trade: effectiveTrade,
        isHelper,
        isTeamLeader: emp.isTeamLeader,
        isSupervisor: emp.isSupervisor,
        customHourlyRate: emp.customHourlyRate,
        cumulativeHours: Math.round(cumulativeHours * 100) / 100,
        hoursThreshold: threshold,
        effectiveRate: Math.round(effectiveRate * 10000) / 10000,
        rateLabel,
        thresholdStatus,
      };
    });

    // Apply optional filters from query params
    let filtered = data;
    const rateFilter = searchParams.get('rate');
    const thresholdFilter = searchParams.get('threshold');

    if (rateFilter) {
      filtered = filtered.filter((emp) => {
        // Semantic rate groups (independent of the configured amounts):
        //   base          → below threshold, no custom/trade rate (baseLow)
        //   helper_premium→ after the 1000h threshold, Helper (helperHigh)
        //   trade_premium → after the 1000h threshold, other trade (tradeHigh)
        //   Custom        → any per-employee flat rate
        if (rateFilter === 'Custom') return emp.customHourlyRate != null;
        if (rateFilter === 'base') {
          return emp.customHourlyRate == null && emp.thresholdStatus === 'below';
        }
        if (rateFilter === 'helper_premium') {
          return emp.customHourlyRate == null && emp.thresholdStatus === 'above' && emp.isHelper;
        }
        if (rateFilter === 'trade_premium') {
          return emp.customHourlyRate == null && emp.thresholdStatus === 'above' && !emp.isHelper;
        }
        return true;
      });
    }

    if (thresholdFilter) {
      filtered = filtered.filter((emp) => {
        if (thresholdFilter === 'below') return emp.thresholdStatus === 'below';
        if (thresholdFilter === 'above') return emp.thresholdStatus === 'above';
        return true;
      });
    }

    const search = searchParams.get('search') || '';
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((emp) =>
        emp.fullName.toLowerCase().includes(q) ||
        emp.employeeId.toLowerCase().includes(q) ||
        // Search by trade from the response data (effectiveTrade), not emp.trade
        (data.find(d => d.id === emp.id)?.trade || '').toLowerCase().includes(q) ||
        (emp.currentSite && emp.currentSite.toLowerCase().includes(q))
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        employees: filtered,
        total: filtered.length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[hours-summary GET] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
