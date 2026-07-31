import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import * as XLSX from 'xlsx';

/**
 * GET /api/salary-records/export-excel?month=YYYY-MM&year=YYYY
 *
 * Exports the consolidated salary sheet for a given month/year as a single
 * Excel (.xlsx) file. All sites are placed on ONE sheet. Under each site's
 * name (a merged header row spanning all columns) the individual employee
 * details for that site are listed, followed by a site subtotal row. A grand
 * total row is appended at the bottom.
 */

const RATE_STANDARD_BELOW = 2.5;
const RATE_STANDARD_ABOVE = 5.0;
const RATE_TL_BELOW = 3.0;
const RATE_TL_ABOVE = 5.5;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface RawRecord {
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
  rateTier: string;
  employee?: {
    id: string;
    fullName: string;
    employeeId: string;
    currentSite: string | null;
    trade: string | null;
    nationality: string | null;
    customHourlyRate: number | null;
    isTeamLeader: boolean;
    isSupervisor: boolean;
    role: string;
  } | null;
}

interface MergedEmployee {
  empId: string;
  empName: string;
  employeeCode: string;
  nationality: string;
  trade: string;
  siteId: string;
  siteName: string;
  belowThresholdHours: number;
  aboveThresholdHours: number;
  totalHours: number;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  customHourlyRate: number | null;
  grossSalary: number;
  belowSalaryComponent: number;
  aboveSalaryComponent: number;
  deduction: number;
  advance: number;
  balanceSalary: number;
  isPaid: boolean;
  rateTier: 'standard' | 'premium' | 'split';
}

function computeGrossSalary(
  belowHours: number,
  aboveHours: number,
  isTeamLeader: boolean,
  isSupervisor: boolean,
  customHourlyRate: number | null,
): { gross: number; belowComponent: number; aboveComponent: number } {
  if (customHourlyRate !== null && customHourlyRate > 0) {
    const gross = (belowHours + aboveHours) * customHourlyRate;
    return { gross, belowComponent: belowHours * customHourlyRate, aboveComponent: aboveHours * customHourlyRate };
  }
  const isLeader = isTeamLeader || isSupervisor;
  const lowRate = isLeader ? RATE_TL_BELOW : RATE_STANDARD_BELOW;
  const highRate = isLeader ? RATE_TL_ABOVE : RATE_STANDARD_ABOVE;
  const belowComponent = belowHours * lowRate;
  const aboveComponent = aboveHours * highRate;
  return { gross: belowComponent + aboveComponent, belowComponent, aboveComponent };
}

function mergeSalaryRecords(records: RawRecord[]): MergedEmployee[] {
  const empMap = new Map<string, RawRecord[]>();
  for (const record of records) {
    const key = `${record.empId}::${record.siteId}`;
    if (!empMap.has(key)) empMap.set(key, []);
    empMap.get(key)!.push(record);
  }

  const merged: MergedEmployee[] = [];
  const sortedEntries = [...empMap.entries()].sort((a, b) => {
    const nameA = a[1][0]?.empName || '';
    const nameB = b[1][0]?.empName || '';
    return nameA.localeCompare(nameB);
  });

  for (const [, empRecords] of sortedEntries) {
    const standardRecord = empRecords.find((r) => r.rateTier === 'standard');
    const premiumRecord = empRecords.find((r) => r.rateTier === 'premium');
    const baseRecord = standardRecord || premiumRecord || empRecords[0];

    const belowThresholdHours = standardRecord?.totalHours ?? 0;
    const aboveThresholdHours = premiumRecord?.totalHours ?? 0;
    const totalHours = belowThresholdHours + aboveThresholdHours;

    const isTeamLeader = baseRecord.employee?.isTeamLeader ?? false;
    const isSupervisor = baseRecord.employee?.isSupervisor ?? false;
    const customHourlyRate = baseRecord.employee?.customHourlyRate ?? null;

    const { gross: grossSalary, belowComponent, aboveComponent } = computeGrossSalary(
      belowThresholdHours,
      aboveThresholdHours,
      isTeamLeader,
      isSupervisor,
      customHourlyRate,
    );

    const deduction = standardRecord?.deduction ?? 0;
    const advance = standardRecord?.advance ?? 0;
    const isPaid = (standardRecord?.isPaid ?? false) || (premiumRecord?.isPaid ?? false);

    let rateTier: 'standard' | 'premium' | 'split' = 'standard';
    if (standardRecord && premiumRecord) rateTier = 'split';
    else if (premiumRecord && !standardRecord) rateTier = 'premium';

    merged.push({
      empId: baseRecord.empId,
      empName: baseRecord.empName,
      employeeCode: baseRecord.employeeCode || baseRecord.employee?.employeeId || '',
      nationality: baseRecord.nationality || baseRecord.employee?.nationality || '',
      trade: baseRecord.trade || baseRecord.employee?.trade || '',
      siteId: baseRecord.siteId,
      siteName: baseRecord.siteName,
      belowThresholdHours,
      aboveThresholdHours,
      totalHours,
      isTeamLeader,
      isSupervisor,
      customHourlyRate,
      grossSalary,
      belowSalaryComponent: belowComponent,
      aboveSalaryComponent: aboveComponent,
      deduction,
      advance,
      balanceSalary: grossSalary - deduction - advance,
      isPaid,
      rateTier,
    });
  }
  return merged;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // YYYY-MM
    const yearStr = searchParams.get('year');

    if (!month) {
      return NextResponse.json(
        { success: false, error: 'month query parameter is required (YYYY-MM)' },
        { status: 400 }
      );
    }

    const yearNum = yearStr ? parseInt(yearStr, 10) : parseInt(month.split('-')[0], 10);
    const monthIndex = parseInt(month.split('-')[1], 10) - 1;
    const monthLabel = MONTH_NAMES[monthIndex] || month;

    // Fetch all non-deleted salary records for the month
    const records = (await db.salaryRecord.findMany({
      where: { month, year: yearNum, isDeleted: false, deletedAt: null },
      orderBy: [{ slNo: 'asc' }, { empName: 'asc' }],
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            currentSite: true,
            trade: true,
            nationality: true,
            customHourlyRate: true,
            isTeamLeader: true,
            isSupervisor: true,
            role: true,
          },
        },
      },
    })) as unknown as RawRecord[];

    // ── Merge pending advances into the records ──
    // Same logic as /api/salary-records and /api/accounts — see those files
    // for detailed comments. This keeps the Excel export consistent with the
    // on-screen salary sheet.
    {
      const pendingAdvances = await db.advance.findMany({
        where: {
          effectiveMonth: month,
          effectiveYear: yearNum,
          status: 'pending',
          deletedAt: null,
        },
      });

      if (pendingAdvances.length > 0 && records.length > 0) {
        const pendingByEmp = new Map<string, number>();
        for (const a of pendingAdvances) {
          pendingByEmp.set(a.empId, (pendingByEmp.get(a.empId) || 0) + a.amount);
        }

        const appliedEmps = new Set<string>();
        // First pass: standard-tier records
        for (let i = 0; i < records.length; i++) {
          const r = records[i];
          const pending = pendingByEmp.get(r.empId);
          if (pending === undefined) continue;
          if (appliedEmps.has(r.empId)) continue;
          if (r.rateTier !== 'standard') continue;

          const newAdvance = r.advance + pending;
          const newBalance = r.totalSalary - r.deduction - newAdvance;
          records[i] = {
            ...r,
            advance: newAdvance,
            balanceSalary: newBalance,
          };
          appliedEmps.add(r.empId);
        }
        // Second pass: fallback for employees with no standard-tier record
        for (let i = 0; i < records.length; i++) {
          const r = records[i];
          if (appliedEmps.has(r.empId)) continue;
          const pending = pendingByEmp.get(r.empId);
          if (pending === undefined) continue;

          const newAdvance = r.advance + pending;
          const newBalance = r.totalSalary - r.deduction - newAdvance;
          records[i] = {
            ...r,
            advance: newAdvance,
            balanceSalary: newBalance,
          };
          appliedEmps.add(r.empId);
        }
      }
    }

    // Group by site
    const siteMap = new Map<string, RawRecord[]>();
    for (const record of records) {
      const key = record.siteId;
      if (!siteMap.has(key)) siteMap.set(key, []);
      siteMap.get(key)!.push(record);
    }

    const sites = await db.site.findMany({
      where: { id: { in: Array.from(siteMap.keys()) } },
      select: { id: true, name: true, clientName: true },
    });
    const siteInfoMap = new Map(sites.map((s) => [s.id, s]));

    // Build the worksheet as an array-of-arrays (AOA)
    // Columns:
    // 0:#  1:EmpCode  2:Name  3:Nationality  4:Trade  5:Role
    // 6:BelowHrs  7:AboveHrs  8:TotalHrs  9:GrossSalary
    // 10:Advance  11:Deduction  12:BalanceSalary  13:Status
    const NUM_COLS = 14;
    const aoa: (string | number)[][] = [];
    const merges: XLSX.Range[] = [];

    // Title row
    aoa.push([`CONSOLIDATED SALARY SHEET — ${monthLabel} ${yearNum}`]);
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: NUM_COLS - 1 } });

    // Blank row
    aoa.push([]);

    let cursor = 2; // current row index in the AOA (0-based)

    // Aggregate grand totals
    const grand = {
      employees: new Set<string>(),
      belowHours: 0,
      aboveHours: 0,
      totalHours: 0,
      grossSalary: 0,
      advance: 0,
      deduction: 0,
      balanceSalary: 0,
      paidCount: 0,
    };

    // Sort sites alphabetically
    const sortedSiteIds = Array.from(siteMap.keys()).sort((a, b) => {
      const na = siteInfoMap.get(a)?.name || siteMap.get(a)![0]?.siteName || '';
      const nb = siteInfoMap.get(b)?.name || siteMap.get(b)![0]?.siteName || '';
      return na.localeCompare(nb);
    });

    for (const siteId of sortedSiteIds) {
      const siteRecords = siteMap.get(siteId)!;
      const siteInfo = siteInfoMap.get(siteId);
      const siteName = siteInfo?.name || siteRecords[0]?.siteName || 'Unknown';
      const clientName = siteInfo?.clientName || '';

      // Site header row — merged across all columns
      const headerText = clientName
        ? `SITE: ${siteName}  (Client: ${clientName})`
        : `SITE: ${siteName}`;
      aoa.push([headerText]);
      merges.push({ s: { r: cursor, c: 0 }, e: { r: cursor, c: NUM_COLS - 1 } });
      cursor++;

      // Column header row
      aoa.push([
        '#',
        'Emp Code',
        'Name',
        'Nationality',
        'Trade',
        'Role',
        'Below Threshold Hrs',
        'Above Threshold Hrs',
        'Total Hrs',
        'Gross Salary (SAR)',
        'Advance',
        'Deduction',
        'Balance Salary',
        'Status',
      ]);
      cursor++;

      // Employee rows
      const mergedEmployees = mergeSalaryRecords(siteRecords);
      const siteTotals = {
        belowHours: 0,
        aboveHours: 0,
        totalHours: 0,
        grossSalary: 0,
        advance: 0,
        deduction: 0,
        balanceSalary: 0,
        paidCount: 0,
      };

      mergedEmployees.forEach((emp, idx) => {
        const role = emp.isSupervisor ? 'Supervisor' : emp.isTeamLeader ? 'Team Leader' : 'Standard';
        aoa.push([
          idx + 1,
          emp.employeeCode,
          emp.empName,
          emp.nationality,
          emp.trade,
          role,
          Math.round(emp.belowThresholdHours * 100) / 100,
          Math.round(emp.aboveThresholdHours * 100) / 100,
          Math.round(emp.totalHours * 100) / 100,
          Math.round(emp.grossSalary * 100) / 100,
          Math.round(emp.advance * 100) / 100,
          Math.round(emp.deduction * 100) / 100,
          Math.round(emp.balanceSalary * 100) / 100,
          emp.isPaid ? 'Paid' : 'Unpaid',
        ]);
        cursor++;

        siteTotals.belowHours += emp.belowThresholdHours;
        siteTotals.aboveHours += emp.aboveThresholdHours;
        siteTotals.totalHours += emp.totalHours;
        siteTotals.grossSalary += emp.grossSalary;
        siteTotals.advance += emp.advance;
        siteTotals.deduction += emp.deduction;
        siteTotals.balanceSalary += emp.balanceSalary;
        if (emp.isPaid) siteTotals.paidCount++;

        grand.employees.add(emp.empId);
        grand.belowHours += emp.belowThresholdHours;
        grand.aboveHours += emp.aboveThresholdHours;
        grand.totalHours += emp.totalHours;
        grand.grossSalary += emp.grossSalary;
        grand.advance += emp.advance;
        grand.deduction += emp.deduction;
        grand.balanceSalary += emp.balanceSalary;
        if (emp.isPaid) grand.paidCount++;
      });

      // Site subtotal row — merge the label cells (#, EmpCode, Name, Nationality, Trade, Role)
      aoa.push([
        `Site Total: ${siteName}`,
        '',
        '',
        '',
        '',
        '',
        Math.round(siteTotals.belowHours * 100) / 100,
        Math.round(siteTotals.aboveHours * 100) / 100,
        Math.round(siteTotals.totalHours * 100) / 100,
        Math.round(siteTotals.grossSalary * 100) / 100,
        Math.round(siteTotals.advance * 100) / 100,
        Math.round(siteTotals.deduction * 100) / 100,
        Math.round(siteTotals.balanceSalary * 100) / 100,
        `${siteTotals.paidCount}/${mergedEmployees.length}`,
      ]);
      merges.push({ s: { r: cursor, c: 0 }, e: { r: cursor, c: 5 } });
      cursor++;

      // Blank spacer row between sites
      aoa.push([]);
      cursor++;
    }

    // Grand total row
    aoa.push([
      `GRAND TOTAL — ${monthLabel} ${yearNum}`,
      '',
      '',
      '',
      '',
      '',
      Math.round(grand.belowHours * 100) / 100,
      Math.round(grand.aboveHours * 100) / 100,
      Math.round(grand.totalHours * 100) / 100,
      Math.round(grand.grossSalary * 100) / 100,
      Math.round(grand.advance * 100) / 100,
      Math.round(grand.deduction * 100) / 100,
      Math.round(grand.balanceSalary * 100) / 100,
      `${grand.paidCount}/${grand.employees.size}`,
    ]);
    merges.push({ s: { r: cursor, c: 0 }, e: { r: cursor, c: 5 } });

    // Build the worksheet
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;

    // Set sensible column widths
    ws['!cols'] = [
      { wch: 5 },   // #
      { wch: 16 },  // Emp Code
      { wch: 26 },  // Name
      { wch: 14 },  // Nationality
      { wch: 16 },  // Trade
      { wch: 12 },  // Role
      { wch: 14 },  // Below Hrs
      { wch: 14 },  // Above Hrs
      { wch: 10 },  // Total Hrs
      { wch: 18 },  // Gross Salary
      { wch: 12 },  // Advance
      { wch: 12 },  // Deduction
      { wch: 16 },  // Balance Salary
      { wch: 12 },  // Status
    ];

    // Create workbook with a single sheet
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Salary ${monthLabel} ${yearNum}`);

    // Write to a binary ArrayBuffer
    const wbout: ArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    const fileName = `Salary_Sheet_${month}_${yearNum}.xlsx`;
    return new NextResponse(wbout, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
