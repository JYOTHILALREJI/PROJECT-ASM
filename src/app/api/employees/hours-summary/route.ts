import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildTradeRateMap } from '@/lib/recalculation';

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

    // Build trade rate map for trade-based custom rates
    const tradeRateMap = await buildTradeRateMap();

    // Build result
    const data = employees.map((emp) => {
      // Use the employee's currentTotalWorkingHours as a FLOOR
      const computedHours = cumulativeHoursMap.get(emp.id) || 0;
      const manualHours = emp.currentTotalWorkingHours || 0;
      const cumulativeHours = Math.max(computedHours, manualHours);
      const hasBonus = emp.isTeamLeader || emp.isSupervisor;
      const threshold = emp.hoursThreshold || 1000;

      // Rate priority: 1) customHourlyRate 2) trade rate 3) role-based
      const tradeRate = emp.trade ? tradeRateMap.get(emp.trade) : undefined;
      const hasTradeRate = tradeRate !== undefined && tradeRate > 0;
      const lowRate = hasBonus ? 3.0 : 2.5;
      const highRate = hasBonus ? 5.5 : 5.0;

      let effectiveRate: number;
      let rateLabel: string;
      if (emp.customHourlyRate != null) {
        effectiveRate = emp.customHourlyRate;
        rateLabel = 'Custom';
      } else if (hasTradeRate) {
        effectiveRate = tradeRate!;
        rateLabel = `${emp.trade} (${tradeRate})`;
      } else if (cumulativeHours >= threshold) {
        effectiveRate = highRate;
        rateLabel = String(highRate);
      } else {
        effectiveRate = lowRate;
        rateLabel = String(lowRate);
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
        trade: emp.trade || null,
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
        if (rateFilter === 'Custom') return emp.customHourlyRate != null;
        if (rateFilter === '2.5') return emp.customHourlyRate == null && !emp.isTeamLeader && !emp.isSupervisor && emp.thresholdStatus === 'below';
        if (rateFilter === '5.0') return emp.customHourlyRate == null && !emp.isTeamLeader && !emp.isSupervisor && emp.thresholdStatus === 'above';
        if (rateFilter === '3.0') return emp.customHourlyRate == null && (emp.isTeamLeader || emp.isSupervisor) && emp.thresholdStatus === 'below';
        if (rateFilter === '5.5') return emp.customHourlyRate == null && (emp.isTeamLeader || emp.isSupervisor) && emp.thresholdStatus === 'above';
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
        (emp.trade && emp.trade.toLowerCase().includes(q)) ||
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
