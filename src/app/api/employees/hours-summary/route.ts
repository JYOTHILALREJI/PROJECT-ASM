import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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
      },
    });

    // Build a map of empId → cumulative hours
    const cumulativeHoursMap = new Map<string, number>();
    for (const sr of allSalaryRecords) {
      const current = cumulativeHoursMap.get(sr.empId) || 0;
      cumulativeHoursMap.set(sr.empId, current + sr.totalHours);
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

    // Build result
    const data = employees.map((emp) => {
      // Use the employee's currentTotalWorkingHours as a FLOOR — if the admin
      // manually set it to a value higher than the computed cumulative (from
      // salary records), use the manual value so the progress bar and
      // threshold status reflect it.
      const computedHours = cumulativeHoursMap.get(emp.id) || 0;
      const manualHours = emp.currentTotalWorkingHours || 0;
      const cumulativeHours = Math.max(computedHours, manualHours);
      const hasBonus = emp.isTeamLeader || emp.isSupervisor;
      const threshold = emp.hoursThreshold || 1000;

      // Direct rates (PRD v2.0 — NO divisors)
      // Standard: 2.5 below threshold, 5.0 at/above
      // TL/Supervisor: 3.0 below threshold, 5.5 at/above
      // Custom: overrides both
      const lowRate = hasBonus ? 3.0 : 2.5;
      const highRate = hasBonus ? 5.5 : 5.0;

      // Effective rate based on cumulative hours and custom rate
      let effectiveRate: number;
      let rateLabel: string;
      if (emp.customHourlyRate != null) {
        effectiveRate = emp.customHourlyRate;
        rateLabel = 'Custom';
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
