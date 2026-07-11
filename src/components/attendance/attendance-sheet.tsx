'use client';

import React, { useState, useRef, useMemo, useCallback } from 'react';
import { ArrowLeft, Download, Printer, Calendar, Loader2 } from 'lucide-react';
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
    isTeamLeader: boolean;
    currentSite: string | null;
  }>;
  onClose: () => void;
}

/* ───────── Constants ───────── */
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const ROWS_PER_PAGE = 24;
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

/* ───────── Page Chunk Helper ───────── */
function chunkRows<T>(items: T[], perPage: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    chunks.push(items.slice(i, i + perPage));
  }
  return chunks;
}

/* ───────── Table Header HTML (shared) ───────── */
function tableHeaderHtml(): string {
  return `
    <tr>
      <th style="width:40px;">SL. NO</th>
      <th style="text-align:left;">NAME</th>
      <th style="width:99px;">EMP. CODE</th>
      <th style="width:159px; text-align:left;">TRADE</th>
      <th style="width:140px;">SIGNATURE</th>
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
  sortedEmployees: Array<{ isTeamLeader: boolean; isSupervisor?: boolean; position?: string }>;
  getDisplayTrade: (emp: { isTeamLeader: boolean; isSupervisor?: boolean; position?: string }) => string;
  contentWidth: string;
  contentPadding: string;
  isFirstPage: boolean;
  isLastPage: boolean;
  serialOffset: number;
}): string {
  const { employeeRows, extraRows, pageIdx, totalPages, clientName, projectName, dateInput, strengthInput, sortedEmployees, getDisplayTrade, contentWidth, contentPadding, isFirstPage, isLastPage, serialOffset } = params;

  let html = `<div class="page" style="width:${contentWidth}; padding:${contentPadding};">`;

  // Header - Light gray bordered box
  if (isFirstPage) {
    html += `
      <div style="position:relative; border:1px solid #000; background:#E8E8E8; padding:8px 12px; margin-bottom:8px; -webkit-print-color-adjust:exact; print-color-adjust:exact; display:flex; align-items:center; justify-content:space-between; min-height:52px;">
        <div style="flex:1;"></div>
        <div style="flex:0 0 auto; text-align:center;">
          <div style="font-size:16px; font-weight:bold; text-align:center; text-transform:uppercase; letter-spacing:0.08em; color:#000;">ARABIAN SHIELD MANPOWER</div>
          <div style="background:${HEADER_BG}; color:${HEADER_TEXT}; text-align:center; padding:5px; font-size:13px; font-weight:bold; letter-spacing:0.15em; text-transform:uppercase; margin-top:6px; -webkit-print-color-adjust:exact; print-color-adjust:exact;">DAILY ATTENDANCE</div>
        </div>
        <div style="flex:1; display:flex; justify-content:flex-end; align-items:center;">
          <img src="/logo_asm.png" alt="ASM" style="height:48px; width:auto;" />
        </div>
      </div>
    `;

    // Info Section
    html += `
      <div style="font-size:12px; text-transform:uppercase; margin-bottom:8px; line-height:1.8; padding:0 4px;">
        <div style="display:flex; align-items:baseline; margin-bottom:2px;">
          <span style="font-weight:bold; width:130px; flex-shrink:0; font-family:'Times New Roman', Times, serif;">&#8226; CLIENT NAME :</span>
          <span style="flex:1; border-bottom:1px solid #555; padding:0 4px; min-height:16px; font-family:'Times New Roman', Times, serif; font-weight:bold;">${upper(clientName)}</span>
        </div>
        <div style="display:flex; align-items:baseline; margin-bottom:2px;">
          <span style="font-weight:bold; width:130px; flex-shrink:0; font-family:'Times New Roman', Times, serif;">&#8226; PROJECT NAME :</span>
          <span style="flex:1; border-bottom:1px solid #555; padding:0 4px; min-height:16px; font-family:'Times New Roman', Times, serif; font-weight:bold;">${upper(projectName)}</span>
        </div>
        <div style="display:flex; align-items:baseline; margin-bottom:2px;">
          <span style="font-weight:bold; width:130px; flex-shrink:0;">&#8226; DATE :</span>
          <span style="flex:1; border-bottom:1px solid #555; padding:0 4px; min-height:16px;">${upper(dateInput)}</span>
        </div>
        <div style="display:flex; align-items:baseline; margin-bottom:2px;">
          <span style="font-weight:bold; width:130px; flex-shrink:0;">&#8226; STRENGTH :</span>
          <span style="flex:1; border-bottom:1px solid #555; padding:0 4px; min-height:16px; font-weight:bold;">${upper(strengthInput || String(sortedEmployees.length))}</span>
        </div>
      </div>
    `;
  } else {
    html += `
      <div style="position:relative; border:1px solid #000; background:#E8E8E8; padding:6px 12px; margin-bottom:8px; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
        <div style="font-size:14px; font-weight:bold; text-align:center; text-transform:uppercase; letter-spacing:0.08em; color:#000;">ARABIAN SHIELD MANPOWER</div>
        <div style="background:${HEADER_BG}; color:${HEADER_TEXT}; text-align:center; padding:4px; font-size:13px; font-weight:bold; letter-spacing:0.15em; text-transform:uppercase; margin-top:4px; -webkit-print-color-adjust:exact; print-color-adjust:exact;">DAILY ATTENDANCE</div>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:8px; text-transform:uppercase; color:#374151;">
        <span><strong style="font-family:'Times New Roman', Times, serif;">CLIENT:</strong> <span style="font-family:'Times New Roman', Times, serif; font-weight:bold;">${upper(clientName)}</span> &nbsp;&nbsp; <strong style="font-family:'Times New Roman', Times, serif;">PROJECT:</strong> <span style="font-family:'Times New Roman', Times, serif; font-weight:bold;">${upper(projectName)}</span></span>
        <span><strong>DATE:</strong> ${upper(dateInput)}</span>
      </div>
    `;
  }

  // Main Employee Table
  html += `
    <table>
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

  html += `</tbody></table>`;

  // Extra Employees Table (only on last page)
  if (isLastPage && extraRows.length > 0) {
    const extraStartNo = sortedEmployees.length + 1;
    html += `
      <div style="margin-top:12px; margin-bottom:4px; font-size:12px; font-weight:bold; text-transform:uppercase; letter-spacing:0.05em; color:#000;">EXTRA EMPLOYEES(IF ANY)</div>
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
      position: relative;
      width: 794px;
      min-height: 1123px;
      padding: 38px;
      box-sizing: border-box;
    }
    .page:last-child {
      page-break-after: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-transform: uppercase;
    }
    thead tr {
      background: ${HEADER_BG} !important;
      color: ${HEADER_TEXT} !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    th, td {
      border: 1px solid #000;
      padding: 8px 6px;
    }
    th {
      font-weight: bold;
      text-align: center;
      font-size: 14px;
    }
    td {
      font-weight: bold;
    }
    .even-row { background: #f3f4f6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .team-leader { background: #fffbeb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .supervisor { background: #eff6ff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    .page-info { text-align: right; font-size: 10px; color: #6b7280; margin-top: 4px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;
}

/* ───────── Main Component ───────── */
export function AttendanceSheet({ site, employees, onClose }: AttendanceSheetProps) {
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [date, setDate] = useState<Date>(new Date());
  const [dateInput, setDateInput] = useState(formatDateDisplay(new Date()));
  const [isGenerating, setIsGenerating] = useState(false);

  // Editable info fields
  const [clientName, setClientName] = useState(site.clientName || '');
  const [projectName, setProjectName] = useState(site.projectName || site.name);
  const [strengthInput, setStrengthInput] = useState(String(employees.length));

  // Editable employee data
  const [employeeData, setEmployeeData] = useState(() =>
    employees.map((emp) => ({
      id: emp.id,
      fullName: emp.fullName,
      code: '',
      position: emp.position || '',
      isTeamLeader: emp.isTeamLeader,
      isSupervisor: emp.position?.toLowerCase().includes('supervisor') ?? false,
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

  // Chunk employee rows into pages
  const FIRST_PAGE_ROWS = ROWS_PER_PAGE - 6;
  const pages = useMemo(() => {
    if (employeeRows.length <= FIRST_PAGE_ROWS) return [employeeRows];
    const result: typeof employeeRows[] = [employeeRows.slice(0, FIRST_PAGE_ROWS)];
    const remaining = employeeRows.slice(FIRST_PAGE_ROWS);
    result.push(...chunkRows(remaining, ROWS_PER_PAGE));
    return result;
  }, [employeeRows]);

  // Generate HTML for all pages (shared by PDF and Print)
  const generateAllPagesHtml = useCallback(() => {
    let allHtml = '';
    pages.forEach((pageEmployeeRows, pageIdx) => {
      const isFirstPage = pageIdx === 0;
      const isLastPage = pageIdx === pages.length - 1;
      const serialOffset = pageIdx === 0 ? 0 : pages.slice(0, pageIdx).flat().length;

      allHtml += buildPageHtml({
        employeeRows: pageEmployeeRows,
        extraRows: isLastPage ? extraRowItems : [],
        pageIdx,
        totalPages: pages.length,
        clientName,
        projectName,
        dateInput,
        strengthInput,
        sortedEmployees,
        getDisplayTrade,
        contentWidth: '794px',
        contentPadding: '38px',
        isFirstPage,
        isLastPage,
        serialOffset,
      });
    });
    return allHtml;
  }, [pages, extraRowItems, clientName, projectName, dateInput, strengthInput, sortedEmployees, getDisplayTrade]);

  /* ── Download PDF directly (jsPDF + html2canvas) ── */
  const handleDownloadPDF = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);

    try {
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

      iframeDoc.open();
      iframeDoc.write(`<!DOCTYPE html><html><head><style>${getPrintCSS()}</style></head><body>`);
      iframeDoc.write(generateAllPagesHtml());
      iframeDoc.write(`</body></html>`);
      iframeDoc.close();

      await new Promise((resolve) => setTimeout(resolve, 600));

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
        });

        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
      }

      const fileName = `attendance-${site.name.replace(/\s+/g, '-')}-${date.toISOString().split('T')[0]}.pdf`;
      pdf.save(fileName);

      document.body.removeChild(iframe);
    } catch (error) {
      console.error('Error generating PDF:', error);
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, site.name, date, generateAllPagesHtml]);

  /* ── Print with @page margin:0 to suppress browser headers/footers ── */
  const handlePrint = useCallback(() => {
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

    iframeDoc.open();
    iframeDoc.write(`<!DOCTYPE html><html><head><style>${getPrintCSS()}</style></head><body>`);
    iframeDoc.write(generateAllPagesHtml());
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

          <div className="ml-auto flex items-center gap-2">
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

        {/* Sheet Container - scrollable preview */}
        <div className="flex-1 overflow-auto flex flex-col items-center py-6 px-4 gap-6">
          {pages.map((pageEmployeeRows, pageIdx) => {
            const isLastPage = pageIdx === pages.length - 1;
            const isFirstPage = pageIdx === 0;
            const serialOffset = pageIdx === 0 ? 0 : pages.slice(0, pageIdx).flat().length;

            return (
              <div
                key={pageIdx}
                id={pageIdx === 0 ? 'attendance-sheet-printable' : undefined}
                ref={(el) => { pageRefs.current[pageIdx] = el; }}
                className="bg-white shadow-xl border border-gray-300 w-full p-[10mm]"
                style={{ maxWidth: `${A4_WIDTH_MM}mm`, minHeight: `${A4_HEIGHT_MM}mm`, boxSizing: 'border-box' }}
              >
                {/* Header Section */}
                {isFirstPage ? (
                  <>
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

                    {/* Info Section */}
                    <div className="mt-4 text-[12px] uppercase">
                      <div className="flex items-baseline mb-1.5">
                        <span className="font-bold text-gray-900 w-36 shrink-0" style={{ fontFamily: "'Times New Roman', Times, serif" }}>&#8226; CLIENT NAME :</span>
                        <span className="flex-1 border-b border-gray-500" style={{ fontFamily: "'Times New Roman', Times, serif", fontWeight: 'bold' }}>
                          <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value.toUpperCase())} className="w-full bg-transparent border-none outline-none text-gray-800 text-[12px] uppercase hover:bg-blue-50/60 focus:bg-blue-50/80 focus:outline-1 focus:outline-blue-300 transition-colors rounded px-1 -mx-1 cursor-text py-0.5" style={{ fontFamily: "'Times New Roman', Times, serif", fontWeight: 'bold' }} />
                        </span>
                      </div>
                      <div className="flex items-baseline mb-1.5">
                        <span className="font-bold text-gray-900 w-36 shrink-0" style={{ fontFamily: "'Times New Roman', Times, serif" }}>&#8226; PROJECT NAME :</span>
                        <span className="flex-1 border-b border-gray-500" style={{ fontFamily: "'Times New Roman', Times, serif", fontWeight: 'bold' }}>
                          <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value.toUpperCase())} className="w-full bg-transparent border-none outline-none text-gray-800 text-[12px] uppercase hover:bg-blue-50/60 focus:bg-blue-50/80 focus:outline-1 focus:outline-blue-300 transition-colors rounded px-1 -mx-1 cursor-text py-0.5" style={{ fontFamily: "'Times New Roman', Times, serif", fontWeight: 'bold' }} />
                        </span>
                      </div>
                      <div className="flex items-baseline mb-1.5">
                        <span className="font-bold text-gray-900 w-36 shrink-0">&#8226; DATE :</span>
                        <span className="flex-1 border-b border-gray-500">
                          <input type="text" value={dateInput} onChange={(e) => handleDateChange(e.target.value.toUpperCase())} className="w-full bg-transparent border-none outline-none text-gray-800 text-[12px] font-mono uppercase hover:bg-blue-50/60 focus:bg-blue-50/80 focus:outline-1 focus:outline-blue-300 transition-colors rounded px-1 -mx-1 cursor-text py-0.5" />
                        </span>
                      </div>
                      <div className="flex items-baseline mb-1.5">
                        <span className="font-bold text-gray-900 w-36 shrink-0">&#8226; STRENGTH :</span>
                        <span className="flex-1 border-b border-gray-500">
                          <input type="text" value={strengthInput} onChange={(e) => setStrengthInput(e.target.value.toUpperCase())} className="w-full bg-transparent border-none outline-none text-gray-800 text-[12px] font-semibold uppercase hover:bg-blue-50/60 focus:bg-blue-50/80 focus:outline-1 focus:outline-blue-300 transition-colors rounded px-1 -mx-1 cursor-text py-0.5" />
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="relative border border-black bg-gray-200 p-2">
                      <h1 className="text-[14px] font-bold text-center text-black tracking-[0.08em] uppercase">
                        ARABIAN SHIELD MANPOWER
                      </h1>
                      <div className="mt-1 text-center py-1 text-[13px] font-bold tracking-[0.15em] uppercase" style={{ background: HEADER_BG, color: HEADER_TEXT }}>
                        DAILY ATTENDANCE
                      </div>
                    </div>
                    <div className="mt-3 flex justify-between text-[12px] uppercase text-gray-600">
                      <span><strong style={{ fontFamily: "'Times New Roman', Times, serif" }}>CLIENT:</strong> <span style={{ fontFamily: "'Times New Roman', Times, serif", fontWeight: 'bold' }}>{upper(clientName)}</span> &nbsp;&nbsp; <strong style={{ fontFamily: "'Times New Roman', Times, serif" }}>PROJECT:</strong> <span style={{ fontFamily: "'Times New Roman', Times, serif", fontWeight: 'bold' }}>{upper(projectName)}</span></span>
                      <span><strong>DATE:</strong> {upper(dateInput)}</span>
                    </div>
                  </>
                )}

                {/* Main Employee Table */}
                <div className="mt-4 pb-2">
                  <table className="w-full border-collapse text-[13px] uppercase">
                    <thead>
                      <tr style={{ background: HEADER_BG, color: HEADER_TEXT }}>
                        <th className="border border-black px-2 py-2 text-center font-bold w-12 text-[14px] uppercase">SL. NO</th>
                        <th className="border border-black px-2 py-2 text-left font-bold text-[14px] uppercase">NAME</th>
                        <th className="border border-black px-2 py-2 text-center font-bold w-[115px] text-[14px] uppercase">EMP. CODE</th>
                        <th className="border border-black px-2 py-2 text-left font-bold w-[179px] text-[14px] uppercase">TRADE</th>
                        <th className="border border-black px-2 py-2 text-center font-bold w-40 text-[14px] uppercase">SIGNATURE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageEmployeeRows.map((row, idx) => {
                        const serialNo = serialOffset + idx + 1;
                        const isEven = idx % 2 === 1;

                        return (
                          <tr
                            key={row.id || `emp-${idx}`}
                            className={cn(
                              isEven ? 'bg-gray-50' : 'bg-white',
                              row.isTeamLeader && 'bg-amber-50',
                              row.isSupervisor && !row.isTeamLeader && 'bg-blue-50'
                            )}
                          >
                            <td className="border border-black px-2 py-1.5 text-center text-gray-700 font-bold">{serialNo}</td>
                            <td className="border border-black px-1 py-1">
                              <EditableCell value={upper(row.fullName || '')} onChange={(val) => updateEmployee(row.id!, 'fullName', val)} className="py-0.5 text-gray-900 font-bold text-[13px] uppercase" uppercase />
                            </td>
                            <td className="border border-black px-1 py-1 text-center">
                              <EditableCell value={upper(row.code || '')} onChange={(val) => updateEmployee(row.id!, 'code', val)} className="py-0.5 text-gray-700 text-center font-mono font-bold text-[13px] uppercase" align="center" uppercase />
                            </td>
                            <td className="border border-black px-1 py-1">
                              <EditableCell value={upper(getDisplayTrade(row as typeof sortedEmployees[0] & { type: string }))} onChange={(val) => { const baseVal = val.replace(/ \/ (TL|SUPERVISOR)$/i, ''); updateEmployee(row.id!, 'position', baseVal); }} className="py-0.5 text-gray-700 uppercase font-bold text-[13px]" uppercase />
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

                {/* Extra Employees Table (only on last page) */}
                {isLastPage && (
                  <div className="mt-3 pb-4">
                    <div className="text-[13px] font-bold uppercase tracking-[0.05em] text-black mb-1">
                      EXTRA EMPLOYEES(IF ANY)
                    </div>
                    <table className="w-full border-collapse text-[13px] uppercase">
                      <thead>
                        <tr style={{ background: HEADER_BG, color: HEADER_TEXT }}>
                          <th className="border border-black px-2 py-2 text-center font-bold w-12 text-[14px] uppercase">SL. NO</th>
                          <th className="border border-black px-2 py-2 text-left font-bold text-[14px] uppercase">NAME</th>
                          <th className="border border-black px-2 py-2 text-center font-bold w-[115px] text-[14px] uppercase">EMP. CODE</th>
                          <th className="border border-black px-2 py-2 text-left font-bold w-[179px] text-[14px] uppercase">TRADE</th>
                          <th className="border border-black px-2 py-2 text-center font-bold w-40 text-[14px] uppercase">SIGNATURE</th>
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
                )}

                <div className="text-right text-[10px] text-gray-400 mt-2 pb-4 uppercase">
                  PAGE {pageIdx + 1} OF {pages.length}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
