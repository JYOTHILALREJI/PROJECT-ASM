'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { ArrowLeft, Download, Printer, Calendar, Loader2, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import html2canvas from 'html2canvas-pro';
import jsPDF from 'jspdf';

/* ───────── Types ───────── */
interface AttendanceSheetProps {
  site: {
    id: string;
    name: string;
    clientName?: string | null;
    projectName?: string | null;
  };
  employees: Array<{
    id: string;
    fullName: string;
    employeeId: string;
    position: string | null;
    // Trade assigned via the Sites page (EmployeeTrade junction table).
    // This takes priority over the legacy `position` / `trade` fields.
    assignedTrade?: string | null;
    // Legacy trade field from the Employee record.
    trade?: string | null;
    isTeamLeader: boolean;
    currentSite: string | null;
  }>;
  onClose: () => void;
}

/* ───────── Helpers ───────── */
// Resolve the displayed trade for an employee using the same priority as
// the rest of the app:
//   1. assignedTrade (EmployeeTrade junction — set from the Sites page)
//   2. trade (legacy Employee.trade field)
//   3. position (legacy Employee.position field)
// Returns '' when none are set.
function resolveTrade(emp: {
  position?: string | null;
  assignedTrade?: string | null;
  trade?: string | null;
}): string {
  return (emp.assignedTrade && emp.assignedTrade.trim())
    || (emp.trade && emp.trade.trim())
    || (emp.position && emp.position.trim())
    || '';
}

/* ───────── Constants ───────── */
const A4_WIDTH_MM = 210;
// Print pagination capacities (MAIN-table rows per A4 page), calibrated for
// normal-height ruled rows (32px) on a 210x297mm page with 12mm padding:
//   - page 1 carries the letterhead + info block, so it holds fewer rows
//   - continuation pages are fuller
//   - any page carrying the EXTRA EMPLOYEES block reserves room for it
const PRINT_SINGLE_PAGE_ROWS = 18; // whole list fits on one page (extras below)
const PRINT_FIRST_PAGE_ROWS = 24;  // first page of a multi-page sheet
const PRINT_MIDDLE_PAGE_ROWS = 28; // continuation pages
const PRINT_LAST_PAGE_ROWS = 21;   // final continuation page (extras below)
const EXTRA_ROWS = 5;
const HEADER_BG = '#bbbcbd';
const HEADER_TEXT = '#000';

/* ───────── Helpers ───────── */
function formatDateDisplay(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function parseDateInput(value: string): Date {
  const parts = value.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts.map(Number);
    if (day && month && year) return new Date(year, month - 1, day);
  }
  return new Date();
}

function upper(val: string): string {
  return val.toUpperCase();
}

/* ───────── Inline Editable Cell ───────── */
function EditableCell({
  value,
  onChange,
  className,
  align = 'left',
  uppercase: forceUppercase = false,
}: {
  value: string;
  onChange: (val: string) => void;
  className?: string;
  align?: 'left' | 'center';
  uppercase?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(forceUppercase ? e.target.value.toUpperCase() : e.target.value)}
      className={cn(
        'w-full bg-transparent border-none outline-none text-inherit font-inherit',
        'hover:bg-blue-50/60 focus:bg-blue-50/80 focus:outline-1 focus:outline-blue-300',
        'transition-colors rounded px-1 -mx-1 cursor-text',
        align === 'center' && 'text-center',
        forceUppercase && 'uppercase',
        className
      )}
    />
  );
}

/* ───────── Print Pagination ───────── */
// Splits the employee list into A4 page chunks for Print/PDF (the on-screen
// preview stays one long continuous page). The EXTRA EMPLOYEES block renders
// under the last page's table, so that page uses the smaller last-page
// capacity. When every row fits on the first page but exceeds the single-page
// capacity, the extras get their own continuation page.
function chunkPrintPages<T>(items: T[]): T[][] {
  if (items.length <= PRINT_SINGLE_PAGE_ROWS) return [items];

  const chunks: T[][] = [items.slice(0, PRINT_FIRST_PAGE_ROWS)];
  let i = Math.min(PRINT_FIRST_PAGE_ROWS, items.length);

  if (i >= items.length) {
    chunks.push([]); // extras-only continuation page
    return chunks;
  }

  while (i < items.length) {
    const remaining = items.length - i;
    if (remaining <= PRINT_LAST_PAGE_ROWS) {
      chunks.push(items.slice(i));
      i = items.length;
    } else {
      const take = Math.min(PRINT_MIDDLE_PAGE_ROWS, remaining - PRINT_LAST_PAGE_ROWS);
      chunks.push(items.slice(i, i + take));
      i += take;
    }
  }
  return chunks;
}

// Ruled-filler slot count for a printed page (keeps every page a complete,
// evenly ruled grid at normal row height).
function printPageCapacity(pageIdx: number, totalPages: number): number {
  if (totalPages === 1) return PRINT_SINGLE_PAGE_ROWS;
  if (pageIdx === 0) return PRINT_FIRST_PAGE_ROWS;
  if (pageIdx === totalPages - 1) return PRINT_LAST_PAGE_ROWS;
  return PRINT_MIDDLE_PAGE_ROWS;
}

/* ───────── Table Header HTML (shared) ───────── */
function tableHeaderHtml(): string {
  return `
    <tr>
      <th style="width:7%;">SL. NO</th>
      <th style="text-align:left; width:37%;">NAME</th>
      <th style="width:16%;">EMP. CODE</th>
      <th style="width:17%; text-align:left;">TRADE</th>
      <th style="width:23%;">SIGNATURE</th>
    </tr>
  `;
}

/* ───────── Build page HTML (shared by Print & PDF) ───────── */
function buildPageHtml(params: {
  employeeRows: Array<{ type: string; id?: string; fullName?: string; code?: string; position?: string; isTeamLeader?: boolean; isSupervisor?: boolean }>;
  extraRows: Array<{ type: string }>;
  pageIdx: number;
  totalPages: number;
  clientName: string;
  projectName: string;
  dateInput: string;
  strengthInput: string;
  presentInput: string;
  absentInput: string;
  sortedEmployees: Array<{ isTeamLeader: boolean; isSupervisor?: boolean; position?: string }>;
  getDisplayTrade: (emp: { isTeamLeader: boolean; isSupervisor?: boolean; position?: string }) => string;
  contentWidth: string;
  contentPadding: string;
  isFirstPage: boolean;
  isLastPage: boolean;
  serialOffset: number;
  fillerCount: number;
}): string {
  const { employeeRows, extraRows, pageIdx, totalPages, clientName, projectName, dateInput, strengthInput, presentInput, absentInput, sortedEmployees, getDisplayTrade, contentWidth, contentPadding, isFirstPage, isLastPage, serialOffset, fillerCount } = params;

  let html = `<div class="page" style="width:${contentWidth}; padding:${contentPadding};">`;

  // Header - Light gray bordered box
  if (isFirstPage) {
    html += `
      <div style="position:relative; border:1px solid #000; background:#E8E8E8; padding:6px 10px; margin-bottom:6px; -webkit-print-color-adjust:exact; print-color-adjust:exact; display:flex; align-items:center; justify-content:space-between; min-height:44px;">
        <div style="flex:1;"></div>
        <div style="flex:0 0 auto; text-align:center;">
          <div style="font-size:14px; font-weight:bold; text-align:center; text-transform:uppercase; letter-spacing:0.08em; color:#000;">ARABIAN SHIELD MANPOWER</div>
          <div style="background:${HEADER_BG}; color:${HEADER_TEXT}; text-align:center; padding:4px; font-size:11px; font-weight:bold; letter-spacing:0.15em; text-transform:uppercase; margin-top:4px; -webkit-print-color-adjust:exact; print-color-adjust:exact;">DAILY ATTENDANCE</div>
        </div>
        <div style="flex:1; display:flex; justify-content:flex-end; align-items:center;">
          <img src="/logo_asm.png" alt="ASM" style="height:40px; width:auto;" />
        </div>
      </div>
    `;

    // Info Section — partitioned into 2 columns:
    //   Column 1: CLIENT NAME / PROJECT NAME / DATE
    //   Column 2: STRENGTH / TOTAL PRESENT / TOTAL ABSENT
    const infoRow = (label: string, value: string, serifLabel = false) => `
      <div style="display:flex; align-items:baseline;">
        <span style="font-weight:bold; width:150px; flex-shrink:0;${serifLabel ? " font-family:'Times New Roman', Times, serif;" : ''}">&#8226; ${label} :</span>
        <span style="flex:1; border-bottom:1px solid #555; padding:0 4px; min-height:18px;${serifLabel ? " font-family:'Times New Roman', Times, serif;" : ''} font-weight:bold;">${value}</span>
      </div>
    `;

    html += `
      <table style="width:100%; border-collapse:collapse; margin-bottom:6px; font-size:14px; text-transform:uppercase; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        <tr>
          <td style="width:50%; border:1px solid #000; padding:6px 10px; vertical-align:top;">
            <div style="display:flex; flex-direction:column; gap:4px;">
              ${infoRow('CLIENT NAME', upper(clientName), true)}
              ${infoRow('PROJECT NAME', upper(projectName), true)}
              ${infoRow('DATE', upper(dateInput))}
            </div>
          </td>
          <td style="width:50%; border:1px solid #000; border-left:none; padding:6px 10px; vertical-align:top;">
            <div style="display:flex; flex-direction:column; gap:4px;">
              ${infoRow('STRENGTH', upper(strengthInput || String(sortedEmployees.length)))}
              ${infoRow('TOTAL PRESENT', upper(presentInput))}
              ${infoRow('TOTAL ABSENT', upper(absentInput))}
            </div>
          </td>
        </tr>
      </table>
    `;
  } else {
    // Subsequent pages: just the date at the top, then the table continues
    html += `
      <div style="display:flex; justify-content:flex-end; font-size:14px; margin-bottom:4px; text-transform:uppercase; color:#374151;">
        <span><strong>DATE:</strong> ${upper(dateInput)}</span>
      </div>
    `;
  }

  // Main Employee Table — wrapped in a flex container so it fills the page
  html += `
    <div class="main-table-wrapper">
    <table class="main-table">
      <thead>
        ${tableHeaderHtml()}
      </thead>
      <tbody>
  `;

  employeeRows.forEach((row, idx) => {
    const serialNo = serialOffset + idx + 1;
    const isEven = idx % 2 === 1;

    if (row.type === 'employee') {
      const trade = getDisplayTrade(row as { isTeamLeader: boolean; isSupervisor?: boolean; position?: string });
      const rowClass = row.isTeamLeader
        ? 'team-leader'
        : row.isSupervisor
        ? 'supervisor'
        : isEven ? 'even-row' : '';

      html += `
        <tr class="${rowClass}">
          <td style="text-align:center; font-weight:bold;">${serialNo}</td>
          <td style="font-weight:bold;">${upper(row.fullName || '')}</td>
          <td style="text-align:center; font-weight:bold;">${upper(row.code || '')}</td>
          <td style="font-weight:bold;">${upper(trade)}</td>
          <td style="text-align:center;"></td>
        </tr>
      `;
    }
  });

  // Blank ruled rows complete the page grid. The table renders at its natural
  // height (no page-height stretching), so every row — filled or blank — keeps
  // the same normal height instead of stretching to fill the sheet.
  for (let i = 0; i < fillerCount; i++) {
    html += `
      <tr class="filler-row">
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
        <td>&nbsp;</td>
      </tr>
    `;
  }

  html += `</tbody></table></div>`;

  // Extra Employees Table (only on last page)
  if (isLastPage && extraRows.length > 0) {
    const extraStartNo = sortedEmployees.length + 1;
    html += `
      <div style="margin-top:8px; margin-bottom:3px; font-size:10px; font-weight:bold; text-transform:uppercase; letter-spacing:0.05em; color:#000;">EXTRA EMPLOYEES(IF ANY)</div>
      <table>
        <thead>
          ${tableHeaderHtml()}
        </thead>
        <tbody>
    `;

    extraRows.forEach((_, idx) => {
      const serialNo = extraStartNo + idx;
      html += `
        <tr>
          <td style="text-align:center; color:#9ca3af; font-weight:bold;">${serialNo}</td>
          <td style="font-weight:bold;"></td>
          <td style="text-align:center; font-weight:bold;"></td>
          <td style="font-weight:bold;"></td>
          <td style="text-align:center;"></td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
  }

  html += `<div class="page-info">PAGE ${pageIdx + 1} OF ${totalPages}</div>`;
  html += `</div>`;

  return html;
}

/* ───────── Shared CSS for print/iframe ───────── */
function getPrintCSS(): string {
  return `
    @page {
      size: A4 portrait;
      margin: 0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; background: white; }
    .page {
      page-break-after: always;
      page-break-inside: avoid;
      width: 210mm;
      /* Slightly under 297mm — guards against sub-pixel rounding overflow
         that would otherwise emit a blank page after every sheet. */
      height: 296.5mm;
      padding: 12mm;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
    }
    .page:last-child {
      page-break-after: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      text-transform: uppercase;
    }
    /* Main table renders at its NATURAL height — rows are never stretched to
       fill the page. Blank ruled rows (filler-row) complete each page grid at
       the same normal height instead. */
    .main-table-wrapper {
      flex: 1 1 auto;
      min-height: 0;
    }
    tbody tr {
      height: 32px;
      page-break-inside: avoid;
    }
    thead tr {
      background: ${HEADER_BG} !important;
      color: ${HEADER_TEXT} !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    th, td {
      border: 1px solid #000;
    }
    th {
      padding: 8px 6px;
      font-weight: bold;
      text-align: center;
      font-size: 13px;
    }
    td {
      padding: 7px 6px;
      font-weight: bold;
      font-size: 12px;
    }
    /* Name column: bigger font, left-aligned */
    td:nth-child(2), th:nth-child(2) {
      font-size: 13px;
      text-align: left;
    }
    /* Emp code: center */
    td:nth-child(3), th:nth-child(3) {
      text-align: center;
    }
    .even-row { background: #f3f4f6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    /* Blank ruled rows that complete the page grid */
    .filler-row td { color: #9ca3af; }
    .team-leader { background: #fffbeb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .supervisor { background: #eff6ff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    .page-info { text-align: right; font-size: 9px; color: #6b7280; margin-top: 4px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;
}

/* ───────── Main Component ───────── */
export function AttendanceSheet({ site, employees, onClose }: AttendanceSheetProps) {
  const [date, setDate] = useState<Date>(new Date());
  const [dateInput, setDateInput] = useState(formatDateDisplay(new Date()));
  const [isGenerating, setIsGenerating] = useState(false);

  // Editable info fields
  const [clientName, setClientName] = useState(site.clientName || '');
  const [projectName, setProjectName] = useState(site.projectName || site.name);
  const [strengthInput, setStrengthInput] = useState(String(employees.length));
  // Totals filled by hand (or pre-filled before printing): how many attended /
  // were absent on the printed date. Kept editable like the other info fields.
  const [presentInput, setPresentInput] = useState('');
  const [absentInput, setAbsentInput] = useState('');

  // Editable employee data
  const [employeeData, setEmployeeData] = useState(() =>
    employees.map((emp) => ({
      id: emp.id,
      fullName: emp.fullName,
      // Pre-fill the EMP. CODE column with the employee's employeeId from the DB
      // (e.g. ASM-2026-001). The cell remains editable so the user can override
      // for print/PDF if needed.
      code: emp.employeeId || '',
      // Resolve the trade via priority: assignedTrade (Sites page) → trade
      // (legacy Employee.trade) → position (legacy Employee.position). This
      // matches how trades are displayed everywhere else in the app.
      position: resolveTrade(emp),
      isTeamLeader: emp.isTeamLeader,
      isSupervisor: resolveTrade(emp).toLowerCase().includes('supervisor') ?? false,
    }))
  );

  // Sort
  const sortedEmployees = useMemo(() => {
    return [...employeeData].sort((a, b) => {
      if (a.isTeamLeader && !b.isTeamLeader) return -1;
      if (!a.isTeamLeader && b.isTeamLeader) return 1;
      if (a.isSupervisor && !b.isSupervisor) return -1;
      if (!a.isSupervisor && b.isSupervisor) return 1;
      return a.fullName.localeCompare(b.fullName);
    });
  }, [employeeData]);

  const updateEmployee = useCallback(
    (id: string, field: 'fullName' | 'code' | 'position' | 'serialNo', value: string) => {
      setEmployeeData((prev) =>
        prev.map((emp) =>
          emp.id === id
            ? { ...emp, [field]: value, isSupervisor: field === 'position' ? value.toLowerCase().includes('supervisor') : emp.isSupervisor }
            : emp
        )
      );
    },
    []
  );

  const handleDateChange = useCallback((value: string) => {
    setDateInput(value);
    const parsed = parseDateInput(value);
    if (!isNaN(parsed.getTime())) setDate(parsed);
  }, []);

  const getDisplayTrade = useCallback((emp: { isTeamLeader: boolean; isSupervisor?: boolean; position?: string }) => {
    const pos = emp.position || '';
    if (emp.isTeamLeader) return pos ? `${pos} / TL` : 'TL';
    if (emp.isSupervisor) return pos ? `${pos} / SUPERVISOR` : 'SUPERVISOR';
    return pos;
  }, []);

  // Build rows: only employees (extras are separate table now)
  const employeeRows = useMemo(() => {
    return sortedEmployees.map((emp) => ({
      type: 'employee' as const,
      ...emp,
    }));
  }, [sortedEmployees]);

  const extraRowItems = useMemo(() => {
    return Array.from({ length: EXTRA_ROWS }, () => ({ type: 'extra' as const }));
  }, []);

  // A4 pagination for PRINT/PDF only — the on-screen preview is one long
  // continuous page and never uses these chunks.
  const printPages = useMemo(() => chunkPrintPages(employeeRows), [employeeRows]);

  // Generate HTML for all printed pages (shared by PDF and Print). Every page
  // is a complete A4 sheet: letterhead on page 1, normal-height ruled blank
  // rows completing the grid, extras block under the last page's table.
  const generateAllPagesHtml = useCallback(() => {
    let allHtml = '';
    printPages.forEach((pageEmployeeRows, pageIdx) => {
      const isFirstPage = pageIdx === 0;
      const isLastPage = pageIdx === printPages.length - 1;
      const serialOffset = pageIdx === 0 ? 0 : printPages.slice(0, pageIdx).reduce((sum, p) => sum + p.length, 0);
      const fillerCount = Math.max(0, printPageCapacity(pageIdx, printPages.length) - pageEmployeeRows.length);

      allHtml += buildPageHtml({
        employeeRows: pageEmployeeRows,
        extraRows: isLastPage ? extraRowItems : [],
        pageIdx,
        totalPages: printPages.length,
        clientName,
        projectName,
        dateInput,
        strengthInput,
        presentInput,
        absentInput,
        sortedEmployees,
        getDisplayTrade,
        contentWidth: '210mm',
        contentPadding: '12mm',
        isFirstPage,
        isLastPage,
        serialOffset,
        fillerCount,
      });
    });
    return allHtml;
  }, [printPages, extraRowItems, clientName, projectName, dateInput, strengthInput, presentInput, absentInput, sortedEmployees, getDisplayTrade]);

  /* ── Download PDF directly (jsPDF + html2canvas) ── */
  const handleDownloadPDF = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);

    try {
      // Pre-fetch the logo as a data URL so html2canvas doesn't choke on
      // cross-origin images. The logo is served from the same origin so this
      // is safe and reliable.
      let logoDataUrl = '';
      try {
        const logoResp = await fetch('/logo_asm.png');
        const logoBlob = await logoResp.blob();
        logoDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve('');
          reader.readAsDataURL(logoBlob);
        });
      } catch {
        // Non-fatal — the PDF will just render without the logo
      }

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.left = '-9999px';
      iframe.style.top = '-9999px';
      iframe.style.width = '794px';
      iframe.style.height = '1123px';
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        document.body.removeChild(iframe);
        setIsGenerating(false);
        return;
      }

      // Inline the logo as a data URL so html2canvas can render it without
      // cross-origin taint issues.
      const html = generateAllPagesHtml().replace(
        /src="\/logo_asm\.png"/g,
        `src="${logoDataUrl}"`,
      );

      iframeDoc.open();
      iframeDoc.write(`<!DOCTYPE html><html><head><style>${getPrintCSS()}</style></head><body>`);
      iframeDoc.write(html);
      iframeDoc.write(`</body></html>`);
      iframeDoc.close();

      // Wait for the DOM + any remaining image to settle. 800ms is enough
      // for the inlined data URL logo to render.
      await new Promise((resolve) => setTimeout(resolve, 800));

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const pageDivs = iframeDoc.querySelectorAll('.page');

      for (let i = 0; i < pageDivs.length; i++) {
        if (i > 0) pdf.addPage();

        const canvas = await html2canvas(pageDivs[i] as HTMLElement, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          imageTimeout: 0, // Don't wait for external images (we inlined them)
        });

        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
      }

      const fileName = `attendance-${site.name.replace(/\s+/g, '-')}-${date.toISOString().split('T')[0]}.pdf`;
      pdf.save(fileName);

      document.body.removeChild(iframe);
    } catch (error) {
      console.error('Error generating PDF:', error);
      // Surface the error to the user so they know the snapshot failed
      alert('Failed to generate PDF snapshot. Please try the Print option instead.');
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, site.name, date, generateAllPagesHtml]);

  /* ── Snapshot (download PNG of the first page) ── */
  // Captures the first page of the attendance sheet as a PNG image. Useful
  // for sharing via chat apps where PDF isn't ideal.
  const handleSnapshot = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      let logoDataUrl = '';
      try {
        const logoResp = await fetch('/logo_asm.png');
        const logoBlob = await logoResp.blob();
        logoDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve('');
          reader.readAsDataURL(logoBlob);
        });
      } catch {
        // ignore
      }

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.left = '-9999px';
      iframe.style.top = '-9999px';
      iframe.style.width = '794px';
      iframe.style.height = '1123px';
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        document.body.removeChild(iframe);
        return;
      }

      const html = generateAllPagesHtml().replace(
        /src="\/logo_asm\.png"/g,
        `src="${logoDataUrl}"`,
      );

      iframeDoc.open();
      iframeDoc.write(`<!DOCTYPE html><html><head><style>${getPrintCSS()}</style></head><body>`);
      iframeDoc.write(html);
      iframeDoc.write(`</body></html>`);
      iframeDoc.close();

      await new Promise((resolve) => setTimeout(resolve, 800));

      const pageDiv = iframeDoc.querySelector('.page') as HTMLElement | null;
      if (!pageDiv) {
        document.body.removeChild(iframe);
        return;
      }

      const canvas = await html2canvas(pageDiv, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        imageTimeout: 0,
      });

      const fileName = `attendance-${site.name.replace(/\s+/g, '-')}-${date.toISOString().split('T')[0]}.png`;
      const link = document.createElement('a');
      link.download = fileName;
      link.href = canvas.toDataURL('image/png');
      link.click();

      document.body.removeChild(iframe);
    } catch (error) {
      console.error('Error generating snapshot:', error);
      alert('Failed to generate snapshot. Please try Print instead.');
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, site.name, date, generateAllPagesHtml]);

  /* ── Print with @page margin:0 to suppress browser headers/footers ── */
  const handlePrint = useCallback(async () => {
    // Inline the logo as a data URL so the print output renders it reliably
    // (some browsers block relative image refs inside print iframes).
    let logoDataUrl = '';
    try {
      const logoResp = await fetch('/logo_asm.png');
      const logoBlob = await logoResp.blob();
      logoDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(logoBlob);
      });
    } catch {
      // ignore
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '-9999px';
    iframe.style.width = '794px';
    iframe.style.height = '1123px';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      document.body.removeChild(iframe);
      return;
    }

    const html = generateAllPagesHtml().replace(
      /src="\/logo_asm\.png"/g,
      `src="${logoDataUrl}"`,
    );

    iframeDoc.open();
    iframeDoc.write(`<!DOCTYPE html><html><head><style>${getPrintCSS()}</style></head><body>`);
    iframeDoc.write(html);
    iframeDoc.write(`</body></html>`);
    iframeDoc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 2000);
    }, 600);
  }, [generateAllPagesHtml]);

  return (
    <>
      {/* Global print styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          body * {
            visibility: hidden;
          }
          #attendance-sheet-printable,
          #attendance-sheet-printable * {
            visibility: visible;
          }
          #attendance-sheet-printable {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 10mm;
            margin: 0;
            background: white;
            box-sizing: border-box;
          }
          #attendance-toolbar {
            display: none !important;
          }
          /* Continuous preview: keep rows whole and repeat the header row on
             every printed page when the browser paginates the long sheet. */
          #attendance-sheet-printable tr {
            page-break-inside: avoid;
          }
          #attendance-sheet-printable thead {
            display: table-header-group;
          }
        }
      `}</style>

      <div className="fixed inset-0 z-50 bg-gray-200 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div
          id="attendance-toolbar"
          className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-300 shadow-sm shrink-0 print:hidden"
        >
          <Button
            variant="default"
            size="sm"
            onClick={onClose}
            className="gap-1.5 bg-black text-white hover:bg-gray-800 border-none shadow-md font-semibold"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </Button>

          <div className="h-5 w-px bg-gray-300 mx-1" />

          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-500" />
            <Input
              type="text"
              value={dateInput}
              onChange={(e) => handleDateChange(e.target.value)}
              className="h-8 w-32 text-sm font-mono uppercase"
              placeholder="DD/MM/YYYY"
            />
          </div>

          <span className="hidden lg:inline ml-2 text-[11px] italic text-gray-400">
            Continuous preview — Print / PDF splits it into A4 pages automatically
          </span>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSnapshot}
              disabled={isGenerating}
              className="gap-1.5"
              title="Save first page as PNG image"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Snapshot</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPDF}
              disabled={isGenerating}
              className="gap-1.5"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">Download PDF</span>
            </Button>

            <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1.5">
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Print</span>
            </Button>
          </div>
        </div>

        {/* Sheet Container — ONE long continuous preview page.
            A4 pagination happens only at print/PDF time. */}
        <div className="flex-1 overflow-auto flex flex-col items-center py-6 px-4">
          <div
            id="attendance-sheet-printable"
            className="bg-white shadow-xl border border-gray-300 w-full p-[12mm]"
            style={{ maxWidth: `${A4_WIDTH_MM}mm`, boxSizing: 'border-box' }}
          >
                {/* Header Section */}
                    <div className="relative border border-black bg-gray-200 px-3 py-2 flex items-center justify-between" style={{ minHeight: '52px' }}>
                      {/* Left spacer for centering */}
                      <div className="flex-1" />
                      {/* Center content */}
                      <div className="flex-1 text-center">
                        <h1 className="text-[16px] font-bold text-black tracking-[0.08em] uppercase">
                          ARABIAN SHIELD MANPOWER
                        </h1>
                        <div className="mt-1.5 text-center py-1.5 text-[13px] font-bold tracking-[0.15em] uppercase" style={{ background: HEADER_BG, color: HEADER_TEXT }}>
                          DAILY ATTENDANCE
                        </div>
                      </div>
                      {/* Right logo */}
                      <div className="flex-1 flex justify-end items-center">
                        <img
                          src="/logo_asm.png"
                          alt="ASM Logo"
                          className="h-12 w-auto object-contain"
                          crossOrigin="anonymous"
                        />
                      </div>
                    </div>

                    {/* Info Section — partitioned into 2 columns:
                          Col 1: CLIENT NAME / PROJECT NAME / DATE
                          Col 2: STRENGTH / TOTAL PRESENT / TOTAL ABSENT */}
                    <table className="mt-3 w-full border-collapse text-[14px] uppercase">
                      <tbody>
                        <tr>
                          <td className="w-1/2 border border-black px-3 py-2 align-top">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-baseline">
                                <span className="w-40 shrink-0 text-[14px] font-bold text-gray-900" style={{ fontFamily: "'Times New Roman', Times, serif" }}>&#8226; CLIENT NAME :</span>
                                <span className="flex-1 border-b border-gray-500">
                                  <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value.toUpperCase())} className="w-full cursor-text rounded border-none bg-transparent px-1 -mx-1 py-0.5 text-[14px] uppercase text-gray-800 transition-colors hover:bg-blue-50/60 focus:bg-blue-50/80 focus:outline-1 focus:outline-blue-300" style={{ fontFamily: "'Times New Roman', Times, serif", fontWeight: 'bold' }} />
                                </span>
                              </div>
                              <div className="flex items-baseline">
                                <span className="w-40 shrink-0 text-[14px] font-bold text-gray-900" style={{ fontFamily: "'Times New Roman', Times, serif" }}>&#8226; PROJECT NAME :</span>
                                <span className="flex-1 border-b border-gray-500">
                                  <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value.toUpperCase())} className="w-full cursor-text rounded border-none bg-transparent px-1 -mx-1 py-0.5 text-[14px] uppercase text-gray-800 transition-colors hover:bg-blue-50/60 focus:bg-blue-50/80 focus:outline-1 focus:outline-blue-300" style={{ fontFamily: "'Times New Roman', Times, serif", fontWeight: 'bold' }} />
                                </span>
                              </div>
                              <div className="flex items-baseline">
                                <span className="w-40 shrink-0 text-[14px] font-bold text-gray-900">&#8226; DATE :</span>
                                <span className="flex-1 border-b border-gray-500">
                                  <input type="text" value={dateInput} onChange={(e) => handleDateChange(e.target.value.toUpperCase())} className="w-full cursor-text rounded border-none bg-transparent px-1 -mx-1 py-0.5 text-[14px] font-mono uppercase text-gray-800 transition-colors hover:bg-blue-50/60 focus:bg-blue-50/80 focus:outline-1 focus:outline-blue-300" />
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="w-1/2 border border-black border-l-0 px-3 py-2 align-top">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-baseline">
                                <span className="w-40 shrink-0 text-[14px] font-bold text-gray-900">&#8226; STRENGTH :</span>
                                <span className="flex-1 border-b border-gray-500">
                                  <input type="text" value={strengthInput} onChange={(e) => setStrengthInput(e.target.value.toUpperCase())} className="w-full cursor-text rounded border-none bg-transparent px-1 -mx-1 py-0.5 text-[14px] font-semibold uppercase text-gray-800 transition-colors hover:bg-blue-50/60 focus:bg-blue-50/80 focus:outline-1 focus:outline-blue-300" />
                                </span>
                              </div>
                              <div className="flex items-baseline">
                                <span className="w-40 shrink-0 text-[14px] font-bold text-gray-900">&#8226; TOTAL PRESENT :</span>
                                <span className="flex-1 border-b border-gray-500">
                                  <input type="text" value={presentInput} onChange={(e) => setPresentInput(e.target.value.toUpperCase())} className="w-full cursor-text rounded border-none bg-transparent px-1 -mx-1 py-0.5 text-[14px] font-semibold uppercase text-gray-800 transition-colors hover:bg-blue-50/60 focus:bg-blue-50/80 focus:outline-1 focus:outline-blue-300" />
                                </span>
                              </div>
                              <div className="flex items-baseline">
                                <span className="w-40 shrink-0 text-[14px] font-bold text-gray-900">&#8226; TOTAL ABSENT :</span>
                                <span className="flex-1 border-b border-gray-500">
                                  <input type="text" value={absentInput} onChange={(e) => setAbsentInput(e.target.value.toUpperCase())} className="w-full cursor-text rounded border-none bg-transparent px-1 -mx-1 py-0.5 text-[14px] font-semibold uppercase text-gray-800 transition-colors hover:bg-blue-50/60 focus:bg-blue-50/80 focus:outline-1 focus:outline-blue-300" />
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                {/* Main Employee Table — continuous: every employee in one
                    long table (printed pages are chunked from this list). */}
                <div className="mt-3">
                  <table className="w-full border-collapse text-[13px] uppercase" style={{ tableLayout: 'auto' }}>
                    <thead>
                      <tr style={{ background: HEADER_BG, color: HEADER_TEXT }}>
                        <th className="sticky top-0 z-10 border border-black px-2 py-2 text-center font-bold text-[14px] uppercase" style={{ width: '7%', boxShadow: 'inset 0 0 0 1px #000' }}>SL. NO</th>
                        <th className="sticky top-0 z-10 border border-black px-2 py-2 text-left font-bold text-[14px] uppercase" style={{ width: '37%', boxShadow: 'inset 0 0 0 1px #000' }}>NAME</th>
                        <th className="sticky top-0 z-10 border border-black px-2 py-2 text-center font-bold text-[14px] uppercase" style={{ width: '16%', boxShadow: 'inset 0 0 0 1px #000' }}>EMP. CODE</th>
                        <th className="sticky top-0 z-10 border border-black px-2 py-2 text-left font-bold text-[14px] uppercase" style={{ width: '17%', boxShadow: 'inset 0 0 0 1px #000' }}>TRADE</th>
                        <th className="sticky top-0 z-10 border border-black px-2 py-2 text-center font-bold text-[14px] uppercase" style={{ width: '23%', boxShadow: 'inset 0 0 0 1px #000' }}>SIGNATURE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedEmployees.map((emp, idx) => {
                        const serialNo = idx + 1;
                        const isEven = idx % 2 === 1;

                        return (
                          <tr
                            key={emp.id}
                            className={cn(
                              isEven ? 'bg-gray-50' : 'bg-white',
                              emp.isTeamLeader && 'bg-amber-50',
                              emp.isSupervisor && !emp.isTeamLeader && 'bg-blue-50'
                            )}
                          >
                            <td className="border border-black px-2 py-1.5 text-center text-gray-700 font-bold">{serialNo}</td>
                            <td className="border border-black px-1 py-1">
                              <EditableCell value={upper(emp.fullName || '')} onChange={(val) => updateEmployee(emp.id, 'fullName', val)} className="py-0.5 text-gray-900 font-bold text-[13px] uppercase" uppercase />
                            </td>
                            <td className="border border-black px-1 py-1 text-center">
                              <EditableCell value={upper(emp.code || '')} onChange={(val) => updateEmployee(emp.id, 'code', val)} className="py-0.5 text-gray-700 text-center font-mono font-bold text-[13px] uppercase" align="center" uppercase />
                            </td>
                            <td className="border border-black px-1 py-1">
                              <EditableCell value={upper(getDisplayTrade(emp))} onChange={(val) => { const baseVal = val.replace(/ \/ (TL|SUPERVISOR)$/i, ''); updateEmployee(emp.id, 'position', baseVal); }} className="py-0.5 text-gray-700 uppercase font-bold text-[13px]" uppercase />
                            </td>
                            <td className="border border-black px-2 py-1.5 text-center">
                              <EditableCell value="" onChange={() => {}} className="py-0.5 text-[13px]" align="center" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Extra Employees Table — always at the end of the sheet */}
                <div className="mt-3 pb-4">
                  <div className="text-[13px] font-bold uppercase tracking-[0.05em] text-black mb-1">
                    EXTRA EMPLOYEES(IF ANY)
                  </div>
                  <table className="w-full border-collapse text-[13px] uppercase">
                    <thead>
                      <tr style={{ background: HEADER_BG, color: HEADER_TEXT }}>
                        <th className="border border-black px-2 py-2 text-center font-bold text-[14px] uppercase" style={{ width: '7%' }}>SL. NO</th>
                        <th className="border border-black px-2 py-2 text-left font-bold text-[14px] uppercase" style={{ width: '37%' }}>NAME</th>
                        <th className="border border-black px-2 py-2 text-center font-bold text-[14px] uppercase" style={{ width: '16%' }}>EMP. CODE</th>
                        <th className="border border-black px-2 py-2 text-left font-bold text-[14px] uppercase" style={{ width: '17%' }}>TRADE</th>
                        <th className="border border-black px-2 py-2 text-center font-bold text-[14px] uppercase" style={{ width: '23%' }}>SIGNATURE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extraRowItems.map((_, idx) => {
                        const serialNo = sortedEmployees.length + idx + 1;
                        return (
                          <tr key={`extra-${idx}`} className="bg-white">
                            <td className="border border-black px-2 py-1.5 text-center text-gray-400 text-[13px] font-bold">{serialNo}</td>
                            <td className="border border-black px-1 py-1"><EditableCell value="" onChange={() => {}} className="py-0.5 text-[13px] font-bold" /></td>
                            <td className="border border-black px-1 py-1 text-center"><EditableCell value="" onChange={() => {}} className="py-0.5 text-[13px] font-bold" align="center" /></td>
                            <td className="border border-black px-1 py-1"><EditableCell value="" onChange={() => {}} className="py-0.5 text-[13px] font-bold" /></td>
                            <td className="border border-black px-2 py-1.5 text-center"><EditableCell value="" onChange={() => {}} className="py-0.5 text-[13px]" align="center" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
          </div>
        </div>
      </div>
    </>
  );
}
