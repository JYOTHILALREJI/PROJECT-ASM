import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// GET /api/attendance/export-data?month=YYYY-MM&year=YYYY
// ---------------------------------------------------------------------------
// Returns the same attendance data as the Excel export endpoint, but as
// structured JSON. Used by the attendance page's "Export Excel" preview
// dialog — the user sees a preview of the full monthly attendance as HTML
// tables, then clicks "Download Excel" to get the .xlsx file.
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // YYYY-MM
    const year = searchParams.get('year');

    if (!month) {
      return NextResponse.json(
        { success: false, error: 'month query parameter is required (YYYY-MM)' },
        { status: 400 },
      );
    }

    const yearNum = year ? parseInt(year, 10) : parseInt(month.split('-')[0], 10);
    const monthNum = parseInt(month.split('-')[1], 10);
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
    const monthLabel = `${MONTH_NAMES[monthNum - 1]} ${yearNum}`;

    // Fetch ALL attendance records for this month
    const attendanceRecords = await db.attendance.findMany({
      where: { date: { startsWith: month }, deletedAt: null },
    });

    // Build a map: employeeId -> date(YYYY-MM-DD) -> status
    const attendanceMap = new Map<string, Map<string, string>>();
    for (const rec of attendanceRecords) {
      if (!attendanceMap.has(rec.employeeId)) {
        attendanceMap.set(rec.employeeId, new Map());
      }
      attendanceMap.get(rec.employeeId)!.set(rec.date, rec.status);
    }

    // Fetch ALL salary records for this month
    const salaryRecords = await db.salaryRecord.findMany({
      where: { month, year: yearNum, isDeleted: false },
    });

    // Fetch ALL EmpCountSitePerMonth records for this month
    const siteAssignments = await db.empCountSitePerMonth.findMany({
      where: { month, deletedDate: null, deletedAt: null },
      select: { empId: true, empName: true, siteId: true, siteName: true, createdDate: true, removedDate: true },
    });

    // Fetch site details
    const sites = await db.site.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, clientName: true },
    });
    const siteMap = new Map(sites.map((s) => [s.id, s]));

    // Fetch ALL active employees
    const allEmployees = await db.employee.findMany({
      where: { status: { not: 'deleted' } },
      select: { id: true, fullName: true, employeeId: true, currentSite: true, trade: true, isTeamLeader: true, isSupervisor: true },
    });

    // Group employees by site
    const siteEmployeesMap = new Map<string, Set<string>>();
    const addToSite = (siteId: string, empId: string) => {
      if (!siteEmployeesMap.has(siteId)) siteEmployeesMap.set(siteId, new Set());
      siteEmployeesMap.get(siteId)!.add(empId);
    };

    for (const sa of siteAssignments) addToSite(sa.siteId, sa.empId);
    for (const sr of salaryRecords) addToSite(sr.siteId, sr.empId);

    const siteByNameMap = new Map(sites.map((s) => [s.name, s]));
    for (const emp of allEmployees) {
      if (emp.currentSite && emp.currentSite !== 'Idle') {
        const site = siteByNameMap.get(emp.currentSite);
        if (site) addToSite(site.id, emp.id);
      }
    }

    // Build the response
    const sortedSites = Array.from(siteEmployeesMap.entries())
      .map(([siteId, empIds]) => ({ site: siteMap.get(siteId), empIds: Array.from(empIds) }))
      .filter((s) => s.site)
      .sort((a, b) => (a.site!.name || '').localeCompare(b.site!.name || ''));

    const sitesData = sortedSites.map(({ site, empIds }) => {
      if (!site) return null;

      const employeeDetails = empIds.map((empId) => {
        const emp = allEmployees.find((e) => e.id === empId);
        const sr = salaryRecords.find((r) => r.empId === empId);
        const sa = siteAssignments.find((a) => a.empId === empId && a.siteId === site.id);
        return {
          id: empId,
          fullName: emp?.fullName || sr?.empName || sa?.empName || 'Unknown',
          employeeCode: emp?.employeeId || sr?.employeeCode || '',
          trade: emp?.trade || sr?.trade || '',
          isTeamLeader: emp?.isTeamLeader || false,
          isSupervisor: emp?.isSupervisor || false,
          movedAway: !!(sa?.removedDate),
        };
      }).sort((a, b) => {
        if (a.movedAway !== b.movedAway) return a.movedAway ? 1 : -1;
        const aRank = a.isTeamLeader ? 0 : a.isSupervisor ? 1 : 2;
        const bRank = b.isTeamLeader ? 0 : b.isSupervisor ? 1 : 2;
        if (aRank !== bRank) return aRank - bRank;
        return (a.fullName || '').localeCompare(b.fullName || '');
      });

      const employees = employeeDetails.map((emp) => {
        let presentDays = 0;
        let absentDays = 0;
        let notMarkedDays = 0;

        const days = Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dateStr = `${month}-${String(day).padStart(2, '0')}`;
          const attStatus = attendanceMap.get(emp.id)?.get(dateStr);
          if (attStatus === 'present' || attStatus === 'overtime') {
            presentDays++;
            return { day, status: 'present' as const };
          } else if (attStatus === 'absent') {
            absentDays++;
            return { day, status: 'absent' as const };
          } else {
            notMarkedDays++;
            return { day, status: 'not_marked' as const };
          }
        });

        return {
          empId: emp.id,
          fullName: emp.fullName,
          employeeCode: emp.employeeCode,
          trade: emp.trade,
          movedAway: emp.movedAway,
          days,
          totalHours: presentDays * 10,
          presentDays,
          absentDays,
          notMarkedDays,
        };
      });

      return {
        siteId: site.id,
        siteName: site.name,
        clientName: site.clientName,
        employees,
      };
    }).filter(Boolean);

    return NextResponse.json({
      success: true,
      data: {
        month,
        year: yearNum,
        monthLabel,
        daysInMonth,
        sites: sitesData,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[attendance/export-data GET] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
