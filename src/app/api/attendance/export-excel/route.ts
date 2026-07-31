import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// GET /api/attendance/export-excel?month=YYYY-MM&year=YYYY
// ---------------------------------------------------------------------------
// Exports the FULL monthly attendance for ALL sites as a single Excel file.
// Each site gets its own sheet. The sheet has:
//   - Header rows: Site Name, Month/Year, Client
//   - Column headers: SL#, Employee Name, Emp Code, Trade, Day 1..Day 31,
//     Total Hours, Present Days, Absent Days, Not Marked Days
//   - One row per employee (including moved-away employees who worked at
//     the site during the month)
//   - Cell values: "10" for present, "A" for absent (red background),
//     blank for not marked
//   - Total hours = present days × 10 (each present day = 10 hours)
//
// The file is downloadable as Attendance_<month>_<year>.xlsx
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

    // Fetch ALL attendance records for this month
    const attendanceRecords = await db.attendance.findMany({
      where: {
        date: { startsWith: month },
        deletedAt: null,
      },
    });

    // Build a map: employeeId -> date(YYYY-MM-DD) -> status
    const attendanceMap = new Map<string, Map<string, string>>();
    for (const rec of attendanceRecords) {
      if (!attendanceMap.has(rec.employeeId)) {
        attendanceMap.set(rec.employeeId, new Map());
      }
      attendanceMap.get(rec.employeeId)!.set(rec.date, rec.status);
    }

    // Fetch ALL salary records for this month (to find which employees were
    // at which sites during the month, including moved-away employees)
    const salaryRecords = await db.salaryRecord.findMany({
      where: {
        month,
        year: yearNum,
        isDeleted: false,
      },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            trade: true,
            isTeamLeader: true,
            isSupervisor: true,
          },
        },
      },
    });

    // Fetch ALL EmpCountSitePerMonth records for this month (includes
    // moved-away employees with removedDate set)
    const siteAssignments = await db.empCountSitePerMonth.findMany({
      where: {
        month,
        deletedDate: null,
        deletedAt: null,
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

    // Fetch site details
    const sites = await db.site.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, clientName: true },
    });
    const siteMap = new Map(sites.map((s) => [s.id, s]));

    // Fetch ALL active employees (for those not in salary records but
    // assigned via currentSite)
    const allEmployees = await db.employee.findMany({
      where: { status: { not: 'deleted' } },
      select: {
        id: true,
        fullName: true,
        employeeId: true,
        currentSite: true,
        trade: true,
        isTeamLeader: true,
        isSupervisor: true,
      },
    });

    // ── Group employees by site ──
    // Use EmpCountSitePerMonth as the source of truth for who was at which
    // site during the month. Also include employees from salary records
    // and currentSite as fallbacks.
    const siteEmployeesMap = new Map<string, Set<string>>(); // siteId -> Set<empId>

    // Helper to add an employee to a site
    const addToSite = (siteId: string, empId: string) => {
      if (!siteEmployeesMap.has(siteId)) {
        siteEmployeesMap.set(siteId, new Set());
      }
      siteEmployeesMap.get(siteId)!.add(empId);
    };

    // 1. From site assignments (most accurate — includes moved-away)
    for (const sa of siteAssignments) {
      addToSite(sa.siteId, sa.empId);
    }

    // 2. From salary records
    for (const sr of salaryRecords) {
      addToSite(sr.siteId, sr.empId);
    }

    // 3. From currentSite (fallback for employees not in the above)
    const siteByNameMap = new Map(sites.map((s) => [s.name, s]));
    for (const emp of allEmployees) {
      if (emp.currentSite && emp.currentSite !== 'Idle') {
        const site = siteByNameMap.get(emp.currentSite);
        if (site) {
          addToSite(site.id, emp.id);
        }
      }
    }

    // ── Build the Excel workbook ──
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ASM System';
    workbook.created = new Date();

    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
    const monthLabel = `${MONTH_NAMES[monthNum - 1]} ${yearNum}`;

    // Sort sites alphabetically
    const sortedSites = Array.from(siteEmployeesMap.entries())
      .map(([siteId, empIds]) => ({
        site: siteMap.get(siteId),
        empIds: Array.from(empIds),
      }))
      .filter((s) => s.site)
      .sort((a, b) => (a.site!.name || '').localeCompare(b.site!.name || ''));

    for (const { site, empIds } of sortedSites) {
      if (!site) continue;

      // Sanitize sheet name (Excel: max 31 chars, no special chars)
      const sheetName = site.name.substring(0, 31).replace(/[\\/?*[\]:]/g, '_');
      const worksheet = workbook.addWorksheet(sheetName);

      // ── Header rows ──
      // Row 1: Site Name (merged)
      // Row 2: Month/Year + Client (merged)
      // Row 3: (blank spacer)
      // Row 4: Column headers

      const totalColumns = 4 + daysInMonth + 4; // SL, Name, Code, Trade, Days 1-N, Hours, Present, Absent, NotMarked

      // Row 1: Site name
      worksheet.mergeCells(1, 1, 1, totalColumns);
      const cellA1 = worksheet.getCell(1, 1);
      cellA1.value = site.name;
      cellA1.font = { bold: true, size: 14 };
      cellA1.alignment = { horizontal: 'center' };
      cellA1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      cellA1.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };

      // Row 2: Month + Client
      worksheet.mergeCells(2, 1, 2, totalColumns);
      const cellA2 = worksheet.getCell(2, 1);
      cellA2.value = `${monthLabel}${site.clientName ? `  ·  Client: ${site.clientName}` : ''}`;
      cellA2.font = { bold: true, size: 11 };
      cellA2.alignment = { horizontal: 'center' };
      cellA2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

      // Row 3: spacer (leave blank)

      // Row 4: Column headers
      const headerRow = worksheet.getRow(4);
      headerRow.getCell(1).value = 'SL#';
      headerRow.getCell(2).value = 'Employee Name';
      headerRow.getCell(3).value = 'Emp Code';
      headerRow.getCell(4).value = 'Trade';
      for (let d = 1; d <= daysInMonth; d++) {
        headerRow.getCell(4 + d).value = d;
      }
      headerRow.getCell(4 + daysInMonth + 1).value = 'Total Hours';
      headerRow.getCell(4 + daysInMonth + 2).value = 'Present';
      headerRow.getCell(4 + daysInMonth + 3).value = 'Absent';
      headerRow.getCell(4 + daysInMonth + 4).value = 'Not Marked';

      // Style header row
      for (let c = 1; c <= totalColumns; c++) {
        const cell = headerRow.getCell(c);
        cell.font = { bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      }

      // ── Employee rows ──
      // Get employee details for each empId, sort by name
      const employeeDetails = empIds.map((empId) => {
        const emp = allEmployees.find((e) => e.id === empId);
        // Also check salary records for employee details (in case the employee
        // is deleted but has salary records)
        const sr = salaryRecords.find((r) => r.empId === empId);
        const sa = siteAssignments.find((a) => a.empId === empId && a.siteId === site.id);
        return {
          id: empId,
          fullName: emp?.fullName || sr?.empName || sa?.empName || 'Unknown',
          employeeId: emp?.employeeId || sr?.employeeCode || '',
          trade: emp?.trade || sr?.trade || '',
          isTeamLeader: emp?.isTeamLeader || false,
          isSupervisor: emp?.isSupervisor || false,
          movedAway: !!(sa?.removedDate),
        };
      }).sort((a, b) => {
        // Moved-away employees last
        if (a.movedAway !== b.movedAway) return a.movedAway ? 1 : -1;
        // TL first, then SUP, then others
        const aRank = a.isTeamLeader ? 0 : a.isSupervisor ? 1 : 2;
        const bRank = b.isTeamLeader ? 0 : b.isSupervisor ? 1 : 2;
        if (aRank !== bRank) return aRank - bRank;
        return (a.fullName || '').localeCompare(b.fullName || '');
      });

      let rowIdx = 5;
      for (let i = 0; i < employeeDetails.length; i++) {
        const emp = employeeDetails[i];
        const row = worksheet.getRow(rowIdx);

        row.getCell(1).value = i + 1; // SL#
        row.getCell(2).value = emp.fullName + (emp.movedAway ? ' (moved)' : '');
        row.getCell(3).value = emp.employeeId;
        row.getCell(4).value = emp.trade || '';

        let presentDays = 0;
        let absentDays = 0;
        let notMarkedDays = 0;

        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${month}-${String(d).padStart(2, '0')}`;
          const empAttendance = attendanceMap.get(emp.id);
          const attStatus = empAttendance?.get(dateStr);

          const col = 4 + d;
          const cell = row.getCell(col);

          if (attStatus === 'present' || attStatus === 'overtime') {
            cell.value = 10;
            cell.alignment = { horizontal: 'center' };
            cell.font = { size: 9, color: { argb: 'FF059669' } };
            presentDays++;
          } else if (attStatus === 'absent') {
            cell.value = 'A';
            cell.alignment = { horizontal: 'center' };
            cell.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
            absentDays++;
          } else {
            // Not marked — leave blank
            notMarkedDays++;
          }

          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          };
        }

        // Totals
        const totalHours = presentDays * 10; // each present day = 10 hours
        row.getCell(4 + daysInMonth + 1).value = totalHours;
        row.getCell(4 + daysInMonth + 2).value = presentDays;
        row.getCell(4 + daysInMonth + 3).value = absentDays;
        row.getCell(4 + daysInMonth + 4).value = notMarkedDays;

        // Style totals columns
        for (let c = 4 + daysInMonth + 1; c <= totalColumns; c++) {
          const cell = row.getCell(c);
          cell.font = { bold: true, size: 10 };
          cell.alignment = { horizontal: 'center' };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
        }

        // Fade moved-away employees
        if (emp.movedAway) {
          for (let c = 1; c <= 4; c++) {
            row.getCell(c).font = { size: 10, color: { argb: 'FF94A3B8' } };
          }
        }

        // Style the first 4 columns
        for (let c = 1; c <= 4; c++) {
          const cell = row.getCell(c);
          if (!emp.movedAway) {
            cell.font = { size: 10 };
          }
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          };
        }

        rowIdx++;
      }

      // ── Column widths ──
      worksheet.getColumn(1).width = 5;  // SL#
      worksheet.getColumn(2).width = 28; // Name
      worksheet.getColumn(3).width = 12; // Code
      worksheet.getColumn(4).width = 14; // Trade
      for (let d = 1; d <= daysInMonth; d++) {
        worksheet.getColumn(4 + d).width = 4;
      }
      worksheet.getColumn(4 + daysInMonth + 1).width = 10; // Total Hours
      worksheet.getColumn(4 + daysInMonth + 2).width = 8;  // Present
      worksheet.getColumn(4 + daysInMonth + 3).width = 8;  // Absent
      worksheet.getColumn(4 + daysInMonth + 4).width = 10; // Not Marked

      // Freeze panes: freeze the header rows and the first 4 columns
      worksheet.views = [{ state: 'frozen', xSplit: 4, ySplit: 4 }];
    }

    // If no sites had employees, add a placeholder sheet
    if (sortedSites.length === 0) {
      const ws = workbook.addWorksheet('No Data');
      ws.getCell(1, 1).value = 'No attendance data found for this month.';
    }

    // ── Generate buffer and return ──
    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Attendance_${month}_${yearNum}.xlsx"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[attendance/export-excel GET] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
