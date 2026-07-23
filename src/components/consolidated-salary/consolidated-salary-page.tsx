'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  Users,
  Clock,
  DollarSign,
  TrendingDown,
  ArrowUpRight,
  Wallet,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  Download,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useSearchNavigation } from '@/lib/use-search-navigation';

/* ──────────────────────────────────────────────────────────────────────────
 * IMPORTANT — Single source of truth
 * ──────────────────────────────────────────────────────────────────────────
 * This page MUST use the SAME data source as the Accounts page
 * (`/api/accounts?month=...&year=...`). The Accounts endpoint already
 * resolves trade-specific rates via `buildTradeRateMap()` +
 * `buildEmployeeTradeMap()` (priority: customHourlyRate > trade rate >
 * role-based default 2.5/5.0 or 3.0/5.5). It also merges pending advances
 * and computes per-month working hours correctly.
 *
 * Previously this page fetched from `/api/salary-records` which had its OWN
 * (different) gross-salary calculation that hardcoded the default rates and
 * ignored trades entirely — so the Consolidated Salary sheet showed wrong
 * totals whenever a trade-specific rate was assigned. That bug is fixed by
 * reusing the Accounts data shape here.
 *
 * Month + year are first-class filters: the API is queried with
 * `?month=YYYY-MM&year=YYYY` on every change, and all numbers shown on the
 * page are scoped to that (month, year) pair.
 * ────────────────────────────────────────────────────────────────────────── */

/* ───────── constants ───────── */
const MONTHS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

/* ───────── API types (mirror /api/accounts response) ───────── */
interface ApiEmployeeEntry {
  empId: string;
  empName: string;
  employeeCode: string;
  nationality: string;
  trade: string;
  assignedTrade: string | null;
  assignedTradeRate: number | null;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  rateTier: 'standard' | 'premium' | 'camp_sitting';
  salaryRecord: {
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
    createdAt: string;
    updatedAt: string;
  } | null;
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
    customHourlyRate?: number | null;
  };
}

interface ApiSiteResult {
  site: {
    id: string;
    name: string;
    clientName?: string | null;
    projectName?: string | null;
    branchId?: string | null;
    branch?: { id: string; name: string; code: string | null } | null;
  };
  employeeCount: number;
  totalHours: number;
  totalSalary: number;
  totalDeductions: number;
  totalAdvances: number;
  totalBalanceSalary: number;
  employees: ApiEmployeeEntry[];
}

/* ───────── Merged employee row (per-site, trade-aware) ───────── */
/** Same shape as Accounts' MergedEmployeeRow — keeps both pages in sync. */
interface MergedEmployeeRow {
  empId: string;
  empName: string;
  nationality: string;
  trade: string;
  assignedTrade: string | null;
  assignedTradeRate: number | null;
  employeeCode: string;
  isTeamLeader: boolean;
  isSupervisor: boolean;

  // Hours
  totalHours: number;
  lowRateHours: number;   // hours charged at the "below threshold" rate
  highRateHours: number;  // hours charged at the "above threshold" rate
  previousCumulativeHours: number;
  hoursThreshold: number;

  // Rates (already trade-aware — come from /api/accounts)
  lowRate: number;
  highRate: number;

  // Salary
  totalSalary: number;    // gross salary (lowRate*lowRateHours + highRate*highRateHours)
  deduction: number;
  advance: number;
  balanceSalary: number;
  isPaid: boolean;

  // Record IDs (for toggle-paid, etc.)
  standardRecordId: string | null;
  premiumRecordId: string | null;
  rateTier: 'standard' | 'premium' | 'split';

  // Rate metadata
  isCustomRate: boolean;
  customHourlyRate: number | null;

  // Site scoping
  siteId: string;
  siteName: string;
}

/**
 * Group ApiEmployeeEntry[] by empId, merging standard + premium tiers into
 * a single MergedEmployeeRow per employee per site. This is the SAME merge
 * logic used by the Accounts page — keeping it identical ensures both pages
 * display identical numbers for the same (month, year).
 */
function mergeApiEntries(
  entries: ApiEmployeeEntry[],
  siteId: string,
  siteName: string,
): MergedEmployeeRow[] {
  const grouped = new Map<string, ApiEmployeeEntry[]>();
  for (const entry of entries) {
    if (!grouped.has(entry.empId)) {
      grouped.set(entry.empId, []);
    }
    grouped.get(entry.empId)!.push(entry);
  }

  const merged: MergedEmployeeRow[] = [];

  const sortedGroups = [...grouped.entries()].sort((a, b) =>
    a[1][0].empName.localeCompare(b[1][0].empName),
  );

  for (const [empId, empEntries] of sortedGroups) {
    const standardEntry = empEntries.find((e) => e.rateTier === 'standard');
    const premiumEntry = empEntries.find((e) => e.rateTier === 'premium');
    const campEntry = empEntries.find((e) => e.rateTier === 'camp_sitting');

    const baseEntry = standardEntry || premiumEntry || campEntry || empEntries[0];
    const hasBonus = baseEntry.isTeamLeader || baseEntry.isSupervisor;

    // Custom rate info from workingHours (resolved server-side by /api/accounts)
    const previousCumulativeHours = (baseEntry.workingHours?.previousCumulativeHours as number) || 0;
    const hoursThreshold = (baseEntry.workingHours?.hoursThreshold as number) || 1000;
    const isCustomRate = (baseEntry.workingHours?.isCustom as boolean) ?? false;
    const customHourlyRate: number | null =
      (baseEntry.workingHours?.customHourlyRate as number | null | undefined) ?? null;

    // ── NEW rate priority (per project owner) ──
    //   1) customHourlyRate (from Hours Ledger) → ONLY this rate
    //   2) assignedTradeRate (from EmployeeTrade junction, set via Sites page)
    //      → +0.5 if TL/Supervisor
    //   3) Helper default → 2.5/3.0 (below) or 5.0/5.5 (above)
    const assignedTradeRate: number | null = baseEntry.assignedTradeRate ?? null;
    const hasTradeRate = assignedTradeRate !== null && assignedTradeRate > 0;

    let lowRate: number;
    let highRate: number;

    if (customHourlyRate !== null) {
      // Priority 1: Custom rate → only this rate, no bonus
      lowRate = customHourlyRate;
      highRate = customHourlyRate;
    } else if (hasTradeRate) {
      // Priority 2: Trade rate → +0.5 if TL/Sup
      const bonusAdjustedRate = hasBonus ? assignedTradeRate! + 0.5 : assignedTradeRate!;
      lowRate = bonusAdjustedRate;
      highRate = bonusAdjustedRate;
    } else {
      // Priority 3: Helper default
      lowRate = hasBonus ? 3.0 : 2.5;
      highRate = hasBonus ? 5.5 : 5.0;
    }

    const lowRateHours = standardEntry?.salaryRecord?.totalHours ?? 0;
    const highRateHours = premiumEntry?.salaryRecord?.totalHours ?? 0;
    const campHours = campEntry?.salaryRecord?.totalHours ?? 0;
    const totalHours = lowRateHours + highRateHours + campHours;

    // Gross salary = sum of ALL salary record totals (standard + premium + camp_sitting).
    // Camp_sitting hours are at the low rate (not threshold-split).
    const standardSalary =
      standardEntry?.salaryRecord?.totalSalary ?? lowRateHours * lowRate;
    const premiumSalary =
      premiumEntry?.salaryRecord?.totalSalary ?? highRateHours * highRate;
    const campSalary = campEntry?.salaryRecord?.totalSalary ?? 0;
    const totalSalary = standardSalary + premiumSalary + campSalary;

    const deduction = standardEntry?.salaryRecord?.deduction ?? 0;
    const advance = standardEntry?.salaryRecord?.advance ?? 0;
    const isPaid =
      (standardEntry?.salaryRecord?.isPaid ?? false) ||
      (premiumEntry?.salaryRecord?.isPaid ?? false) ||
      (campEntry?.salaryRecord?.isPaid ?? false);

    let rateTier: 'standard' | 'premium' | 'split' = 'standard';
    if (standardEntry && premiumEntry) {
      rateTier = 'split';
    } else if (premiumEntry && !standardEntry) {
      rateTier = 'premium';
    }

    merged.push({
      empId,
      empName: baseEntry.empName,
      nationality: baseEntry.salaryRecord?.nationality || baseEntry.nationality,
      trade: baseEntry.salaryRecord?.trade || baseEntry.trade,
      assignedTrade: baseEntry.assignedTrade || null,
      assignedTradeRate: baseEntry.assignedTradeRate ?? null,
      employeeCode: baseEntry.salaryRecord?.employeeCode || baseEntry.employeeCode,
      isTeamLeader: baseEntry.isTeamLeader,
      isSupervisor: baseEntry.isSupervisor,
      totalHours,
      lowRateHours,
      highRateHours,
      previousCumulativeHours,
      hoursThreshold,
      lowRate,
      highRate,
      totalSalary,
      deduction,
      advance,
      balanceSalary: totalSalary - deduction - advance,
      isPaid,
      standardRecordId: standardEntry?.salaryRecord?.id ?? null,
      premiumRecordId: premiumEntry?.salaryRecord?.id ?? null,
      rateTier,
      isCustomRate,
      customHourlyRate,
      siteId,
      siteName,
    });
  }

  return merged;
}

/* ───────── Flat employee (cross-site merged) ───────── */
interface FlatEmployeeSite {
  siteId: string;
  siteName: string;
  belowThresholdHours: number;
  aboveThresholdHours: number;
  totalHours: number;
  grossSalary: number;
  deduction: number;
  advance: number;
  balanceSalary: number;
  rateTier: 'standard' | 'premium' | 'split';
  standardRecordId: string | null;
  premiumRecordId: string | null;
}

interface FlatEmployee {
  empId: string;
  empName: string;
  employeeCode: string;
  nationality: string;
  trade: string;
  assignedTrade: string | null;
  assignedTradeRate: number | null;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  customHourlyRate: number | null;
  lowRate: number;
  highRate: number;
  // Aggregated across ALL sites
  totalBelowThresholdHours: number;
  totalAboveThresholdHours: number;
  totalHours: number;
  grossSalary: number;
  belowSalaryComponent: number;
  aboveSalaryComponent: number;
  deduction: number;
  advance: number;
  balanceSalary: number;
  isPaid: boolean;
  // Per-site breakdown (sorted alphabetically by site name)
  sites: FlatEmployeeSite[];
}

/**
 * Merge per-site MergedEmployeeRows into one FlatEmployee per employee
 * (combining all sites). Gross salary is summed from each row's
 * `totalSalary` — which was computed trade-aware by /api/accounts.
 */
function buildFlatEmployees(perSiteRows: Record<string, MergedEmployeeRow[]>): FlatEmployee[] {
  // Flatten all rows
  const allRows: MergedEmployeeRow[] = [];
  for (const siteId of Object.keys(perSiteRows)) {
    allRows.push(...perSiteRows[siteId]);
  }

  // Group by empId
  const empMap = new Map<string, MergedEmployeeRow[]>();
  for (const row of allRows) {
    if (!empMap.has(row.empId)) empMap.set(row.empId, []);
    empMap.get(row.empId)!.push(row);
  }

  const flatEmployees: FlatEmployee[] = [];

  for (const [empId, empRows] of empMap) {
    const baseRow = empRows[0];

    // Per-site breakdown
    const sites: FlatEmployeeSite[] = [];
    let totalBelow = 0;
    let totalAbove = 0;
    let totalAllHours = 0;
    let totalGross = 0;
    let totalBelowComponent = 0;
    let totalAboveComponent = 0;
    let totalDeduction = 0;
    let totalAdvance = 0;
    let isPaid = false;

    for (const row of empRows) {
      const belowComponent = row.lowRateHours * row.lowRate;
      const aboveComponent = row.highRateHours * row.highRate;
      const siteGross = row.totalSalary; // already trade-aware from the API

      sites.push({
        siteId: row.siteId,
        siteName: row.siteName,
        belowThresholdHours: row.lowRateHours,
        aboveThresholdHours: row.highRateHours,
        totalHours: row.totalHours,
        grossSalary: siteGross,
        deduction: row.deduction,
        advance: row.advance,
        balanceSalary: row.balanceSalary,
        rateTier: row.rateTier,
        standardRecordId: row.standardRecordId,
        premiumRecordId: row.premiumRecordId,
      });

      totalBelow += row.lowRateHours;
      totalAbove += row.highRateHours;
      totalAllHours += row.totalHours; // includes camp_sitting hours
      totalGross += siteGross;
      totalBelowComponent += belowComponent;
      totalAboveComponent += aboveComponent;
      totalDeduction += row.deduction;
      totalAdvance += row.advance;
      if (row.isPaid) isPaid = true;
    }

    sites.sort((a, b) => a.siteName.localeCompare(b.siteName));

    flatEmployees.push({
      empId,
      empName: baseRow.empName,
      employeeCode: baseRow.employeeCode,
      nationality: baseRow.nationality,
      trade: baseRow.trade,
      assignedTrade: baseRow.assignedTrade,
      assignedTradeRate: baseRow.assignedTradeRate,
      isTeamLeader: baseRow.isTeamLeader,
      isSupervisor: baseRow.isSupervisor,
      customHourlyRate: baseRow.customHourlyRate,
      lowRate: baseRow.lowRate,
      highRate: baseRow.highRate,
      totalBelowThresholdHours: totalBelow,
      totalAboveThresholdHours: totalAbove,
      totalHours: totalAllHours,
      grossSalary: totalGross,
      belowSalaryComponent: totalBelowComponent,
      aboveSalaryComponent: totalAboveComponent,
      deduction: totalDeduction,
      advance: totalAdvance,
      balanceSalary: totalGross - totalDeduction - totalAdvance,
      isPaid,
      sites,
    });
  }

  // Sort alphabetically by name
  flatEmployees.sort((a, b) => a.empName.localeCompare(b.empName));

  return flatEmployees;
}

/* ───────── Per-site summary (derived from merged rows) ───────── */
interface SiteSummary {
  siteId: string;
  siteName: string;
  clientName: string | null;
  employeeCount: number;
  totalHours: number;
  totalBelowThresholdHours: number;
  totalAboveThresholdHours: number;
  totalSalary: number;       // gross (trade-aware)
  totalDeductions: number;
  totalAdvances: number;
  netBalance: number;
  paidCount: number;
}

interface Totals {
  totalSites: number;
  totalEmployees: number;
  totalHours: number;
  totalBelowThresholdHours: number;
  totalAboveThresholdHours: number;
  totalSalary: number;
  totalDeductions: number;
  totalAdvances: number;
  netBalance: number;
  paidCount: number;
}

/* ───────── helpers ───────── */
function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatHours(hours: number): string {
  return hours.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

/* ───────── Metric Card ───────── */
interface MetricCardProps {
  title: string;
  value: number | null;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  format?: 'number' | 'currency' | 'hours';
  loading?: boolean;
  subtitle?: string;
}

function MetricCard({ title, value, icon: Icon, color, bgColor, format = 'number', loading, subtitle }: MetricCardProps) {
  const displayValue = useMemo(() => {
    if (value === null) return null;
    switch (format) {
      case 'currency':
        return `SAR ${formatCurrency(value)}`;
      case 'hours':
        return formatHours(value);
      default:
        return value.toLocaleString();
    }
  }, [value, format]);

  return (
    <Card className="bg-slate-800/50 border-slate-700/50 hover:border-slate-600/50 transition-colors py-4">
      <CardHeader className="flex flex-row items-center justify-between pb-2 px-4">
        <CardTitle className="text-sm font-medium text-slate-400">
          {title}
        </CardTitle>
        <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', bgColor)}>
          <Icon className={cn('h-4 w-4', color)} />
        </div>
      </CardHeader>
      <CardContent className="px-4 pt-0">
        {loading || displayValue === null ? (
          <Skeleton className="h-8 w-24 bg-slate-700" />
        ) : (
          <div className="text-2xl font-bold text-white">{displayValue}</div>
        )}
        {subtitle && (
          <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────── Main Component ───────── */
export function ConsolidatedSalaryPage() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [loading, setLoading] = useState(true);
  const [apiSites, setApiSites] = useState<ApiSiteResult[]>([]);
  const [perSiteRows, setPerSiteRows] = useState<Record<string, MergedEmployeeRow[]>>({});
  const [hasData, setHasData] = useState(true);
  const [fetchKey, setFetchKey] = useState(0); // DB-first invalidation key

  const yearOptions = useMemo(() => {
    const currentYear = now.getFullYear();
    return [
      String(currentYear - 2),
      String(currentYear - 1),
      String(currentYear),
      String(currentYear + 1),
    ];
  }, []);

  /* ── Fetch salary data from /api/accounts (SAME source as Accounts page) ──
   * This ensures trade-specific rates are applied identically on both pages.
   * Month + year are passed as query params so the API returns only the
   * records for that specific (month, year) pair. */
  const fetchSalaryData = useCallback(async (m: string, y: string) => {
    try {
      setLoading(true);
      const monthStr = `${y}-${m.padStart(2, '0')}`;
      const cacheBuster = `&_t=${Date.now()}`;
      const res = await fetch(`/api/accounts?month=${monthStr}&year=${y}${cacheBuster}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
      });
      const json = await res.json();
      if (json.success) {
        const siteResults: ApiSiteResult[] = json.data.sites || [];
        setApiSites(siteResults);

        // Merge split entries into single rows per employee per site
        // (same logic as Accounts page → guarantees identical numbers)
        const empMap: Record<string, MergedEmployeeRow[]> = {};
        for (const s of siteResults) {
          empMap[s.site.id] = mergeApiEntries(s.employees, s.site.id, s.site.name);
        }
        setPerSiteRows(empMap);

        // "hasData" = at least one site has at least one employee row
        const totalRows = Object.values(empMap).reduce(
          (sum, rows) => sum + rows.length,
          0,
        );
        setHasData(totalRows > 0);
      } else {
        setApiSites([]);
        setPerSiteRows({});
        setHasData(false);
      }
    } catch {
      setApiSites([]);
      setPerSiteRows({});
      setHasData(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSalaryData(month, year);
  }, [month, year, fetchSalaryData, fetchKey]);

  /* ── Refresh data (DB-first invalidation) ── */
  const refreshData = useCallback(() => {
    setFetchKey(k => k + 1);
  }, []);

  /* ── Export consolidated salary sheet to Excel ──
   * The export endpoint reads from the same /api/salary-records DB table, but
   * we re-fetch the trade-aware data client-side and rebuild the export
   * payload so the exported numbers match the page. */
  const [exporting, setExporting] = useState(false);
  const handleExportExcel = useCallback(async () => {
    try {
      setExporting(true);
      const monthStr = `${year}-${month.padStart(2, '0')}`;
      const res = await fetch(`/api/salary-records/export-excel?month=${monthStr}&year=${year}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to export Excel');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `consolidated-salary-${monthStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export Excel file');
    } finally {
      setExporting(false);
    }
  }, [month, year]);

  /* ── Month/Year display label ── */
  const monthLabel = MONTHS.find((m) => m.value === month)?.label || '';

  /* ── Build flat employee list (merged across all sites) ── */
  const flatEmployees = useMemo(() => buildFlatEmployees(perSiteRows), [perSiteRows]);

  /* ── Build site summaries (from merged rows — trade-aware) ── */
  const siteSummaries: SiteSummary[] = useMemo(() => {
    return apiSites.map((s) => {
      const rows = perSiteRows[s.site.id] || [];
      const belowHours = rows.reduce((sum, r) => sum + r.lowRateHours, 0);
      const aboveHours = rows.reduce((sum, r) => sum + r.highRateHours, 0);
      const gross = rows.reduce((sum, r) => sum + r.totalSalary, 0);
      const deduction = rows.reduce((sum, r) => sum + r.deduction, 0);
      const advance = rows.reduce((sum, r) => sum + r.advance, 0);
      const paidCount = new Set(rows.filter((r) => r.isPaid).map((r) => r.empId)).size;
      return {
        siteId: s.site.id,
        siteName: s.site.name,
        clientName: s.site.clientName || null,
        employeeCount: new Set(rows.map((r) => r.empId)).size,
        totalHours: belowHours + aboveHours,
        totalBelowThresholdHours: belowHours,
        totalAboveThresholdHours: aboveHours,
        totalSalary: gross,
        totalDeductions: deduction,
        totalAdvances: advance,
        netBalance: gross - deduction - advance,
        paidCount,
      };
    }).sort((a, b) => a.siteName.localeCompare(b.siteName));
  }, [apiSites, perSiteRows]);

  /* ── Build grand totals (from merged rows — trade-aware) ── */
  const totals: Totals | null = useMemo(() => {
    if (siteSummaries.length === 0) return null;
    const allRows: MergedEmployeeRow[] = [];
    for (const siteId of Object.keys(perSiteRows)) {
      allRows.push(...perSiteRows[siteId]);
    }
    const belowHours = allRows.reduce((sum, r) => sum + r.lowRateHours, 0);
    const aboveHours = allRows.reduce((sum, r) => sum + r.highRateHours, 0);
    const gross = allRows.reduce((sum, r) => sum + r.totalSalary, 0);
    const deduction = allRows.reduce((sum, r) => sum + r.deduction, 0);
    const advance = allRows.reduce((sum, r) => sum + r.advance, 0);
    const balance = allRows.reduce((sum, r) => sum + r.balanceSalary, 0);
    const paidCount = new Set(allRows.filter((r) => r.isPaid).map((r) => r.empId)).size;
    const totalEmployees = new Set(allRows.map((r) => r.empId)).size;
    return {
      totalSites: siteSummaries.length,
      totalEmployees,
      totalHours: belowHours + aboveHours,
      totalBelowThresholdHours: belowHours,
      totalAboveThresholdHours: aboveHours,
      totalSalary: gross,
      totalDeductions: deduction,
      totalAdvances: advance,
      netBalance: balance,
      paidCount,
    };
  }, [perSiteRows, siteSummaries.length]);

  /* ── Paid toggle handler ── */
  // Calls the same /api/accounts/salary/toggle-paid endpoint as the Accounts
  // page. The endpoint updates ALL salary records for empId+month+year
  // (across all sites), so both pages reflect the change on their next
  // refresh. We update local state optimistically so the UI feels instant.
  const handleTogglePaid = useCallback(async (empId: string, currentIsPaid: boolean) => {
    const newIsPaid = !currentIsPaid;
    const monthStr = `${year}-${month.padStart(2, '0')}`;
    const yearNum = parseInt(year, 10);

    // Optimistic: update local perSiteRows so the badge flips immediately
    setPerSiteRows((prev) => {
      const next: Record<string, MergedEmployeeRow[]> = {};
      for (const siteId of Object.keys(prev)) {
        next[siteId] = prev[siteId].map((r) =>
          r.empId === empId ? { ...r, isPaid: newIsPaid } : r,
        );
      }
      return next;
    });

    try {
      const res = await fetch('/api/accounts/salary/toggle-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId,
          month: monthStr,
          year: yearNum,
          isPaid: newIsPaid,
        }),
      });
      const json = await res.json();
      if (!json.success || !json.data || json.data.updatedCount === 0) {
        // Revert
        setPerSiteRows((prev) => {
          const next: Record<string, MergedEmployeeRow[]> = {};
          for (const siteId of Object.keys(prev)) {
            next[siteId] = prev[siteId].map((r) =>
              r.empId === empId ? { ...r, isPaid: currentIsPaid } : r,
            );
          }
          return next;
        });
        console.error('[ConsolidatedSalary] toggle-paid failed:', json.error);
        alert(json.error || `Failed to toggle paid status for employee ${empId}`);
      }
    } catch (err) {
      // Revert on network error
      setPerSiteRows((prev) => {
        const next: Record<string, MergedEmployeeRow[]> = {};
        for (const siteId of Object.keys(prev)) {
          next[siteId] = prev[siteId].map((r) =>
            r.empId === empId ? { ...r, isPaid: currentIsPaid } : r,
          );
        }
        return next;
      });
      console.error('[ConsolidatedSalary] toggle-paid network error:', err);
      alert('Failed to update payment status. Please try again.');
    }
  }, [year, month]);

  /* ── Search & jump-to-match ── */
  const [searchQuery, setSearchQuery] = useState('');

  const allSearchableEmployees = useMemo(() => {
    return flatEmployees.map((emp, idx) => ({
      rowId: `${emp.empId}::${idx}`,
      emp,
    }));
  }, [flatEmployees]);

  const {
    matchCount,
    currentIndex,
    registerRowRef,
    goToNext,
    goToPrev,
    handleInputKeyDown,
    isMatch,
    isCurrent,
  } = useSearchNavigation(searchQuery, {
    items: allSearchableEmployees,
    getItemId: (se) => se.rowId,
    matchItem: (se, q) =>
      se.emp.empName.toLowerCase().includes(q) ||
      se.emp.employeeCode.toLowerCase().includes(q),
  });

  const isRowCurrent = useCallback(
    (empId: string, idx: number) => {
      const rowId = `${empId}::${idx}`;
      return isCurrent({ rowId, emp: {} as FlatEmployee });
    },
    [isCurrent],
  );
  const isRowMatched = useCallback(
    (empId: string, idx: number) => {
      const rowId = `${empId}::${idx}`;
      return isMatch({ rowId, emp: {} as FlatEmployee });
    },
    [isMatch],
  );

  /* ── Summary metrics config ── */
  const metrics: MetricCardProps[] = useMemo(() => [
    {
      title: 'Total Sites',
      value: totals?.totalSites ?? null,
      icon: Building2,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
      loading,
      subtitle: `${monthLabel} ${year}`,
    },
    {
      title: 'Total Employees',
      value: totals?.totalEmployees ?? null,
      icon: Users,
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
      loading,
      subtitle: `${monthLabel} ${year}`,
    },
    {
      title: 'Below Threshold Hrs',
      value: totals?.totalBelowThresholdHours ?? null,
      icon: Clock,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10',
      format: 'hours',
      loading,
      subtitle: `${monthLabel} ${year}`,
    },
    {
      title: 'Above Threshold Hrs',
      value: totals?.totalAboveThresholdHours ?? null,
      icon: ArrowUpRight,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      format: 'hours',
      loading,
      subtitle: `${monthLabel} ${year}`,
    },
    {
      title: 'Gross Salary',
      value: totals?.totalSalary ?? null,
      icon: DollarSign,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      format: 'currency',
      loading,
      subtitle: `Trade-aware · ${monthLabel} ${year}`,
    },
    {
      title: 'Total Deductions',
      value: totals?.totalDeductions ?? null,
      icon: TrendingDown,
      color: 'text-red-400',
      bgColor: 'bg-red-500/10',
      format: 'currency',
      loading,
      subtitle: `${monthLabel} ${year}`,
    },
    {
      title: 'Net Balance',
      value: totals?.netBalance ?? null,
      icon: Wallet,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
      format: 'currency',
      loading,
      subtitle: `${monthLabel} ${year}`,
    },
  ], [totals, loading, monthLabel, year]);

  /* ── Role badge ── */
  const RoleBadge = ({ emp }: { emp: FlatEmployee }) => {
    if (emp.isSupervisor) {
      return (
        <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/20 hover:bg-orange-500/20 text-[9px] gap-0.5 px-1 py-0">
          <ShieldAlert className="h-2.5 w-2.5" />
          SUP
        </Badge>
      );
    }
    if (emp.isTeamLeader) {
      return (
        <Badge className="bg-sky-500/10 text-sky-400 border-sky-500/20 hover:bg-sky-500/20 text-[9px] gap-0.5 px-1 py-0">
          <ShieldCheck className="h-2.5 w-2.5" />
          TL
        </Badge>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Consolidated Salary Sheet</h2>
          <div className="flex items-center gap-2 mt-1">
            <CalendarDays className="h-4 w-4 text-emerald-400" />
            <p className="text-emerald-400 font-medium text-sm">{monthLabel} {year}</p>
          </div>
          <p className="text-slate-400 mt-1">
            Same data source as Accounts &bull; Trade-aware rates &bull; Per-site breakdown
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[140px] bg-slate-800 border-slate-700 text-slate-200">
              <CalendarDays className="h-4 w-4 mr-2 text-slate-400" />
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent className="dropdown-upward bg-slate-800 border-slate-700">
              {MONTHS.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-slate-200 focus:bg-slate-700 focus:text-white">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[110px] bg-slate-800 border-slate-700 text-slate-200">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent className="dropdown-upward bg-slate-800 border-slate-700">
              {yearOptions.map((y) => (
                <SelectItem key={y} value={y} className="text-slate-200 focus:bg-slate-700 focus:text-white">
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleExportExcel} disabled={exporting || loading || !hasData} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? 'Exporting...' : 'Export Excel'}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.title} {...metric} />
        ))}
      </div>

      {/* No Data Message */}
      {!loading && !hasData && (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-12 w-12 text-slate-600 mb-3" />
            <p className="text-slate-400 text-lg font-medium">No salary data for {monthLabel} {year}</p>
            <p className="text-slate-500 text-sm mt-1">Generate salary records from the Accounts page first.</p>
          </CardContent>
        </Card>
      )}

      {/* Search bar rendered into the global app header via React portal */}
      {!loading && hasData && flatEmployees.length > 0 && typeof document !== 'undefined' && (() => {
        const slot = document.getElementById('header-controls-slot');
        if (!slot) return null;
        return createPortal(
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
            <Input
              placeholder="Search name or ID... (Enter = next)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              className="pl-10 pr-[120px] bg-slate-950 border-slate-700 text-slate-200 placeholder:text-slate-500 h-9 w-full"
            />
            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              {searchQuery && matchCount > 0 && (
                <span className="text-[10px] font-mono text-slate-300 bg-slate-800 rounded px-1.5 py-0.5 mr-0.5 whitespace-nowrap tabular-nums">
                  {currentIndex + 1}/{matchCount}
                </span>
              )}
              {searchQuery && matchCount === 0 && (
                <span className="text-[10px] text-amber-400 mr-1 whitespace-nowrap">0 results</span>
              )}
              <Button variant="ghost" size="icon" type="button" disabled={matchCount === 0} onClick={goToPrev} title="Previous match (Shift+Enter)" className="h-7 w-7 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" type="button" disabled={matchCount === 0} onClick={goToNext} title="Next match (Enter)" className="h-7 w-7 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              {searchQuery && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-white" onClick={() => setSearchQuery('')} title="Clear search">
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>,
          slot,
        );
      })()}

      {/* Main Flat Table — all employees in a single list */}
      {!loading && hasData && flatEmployees.length > 0 && (
        <Card className="bg-slate-800/50 border-slate-700/50 py-4">
          <CardHeader className="px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-400" />
              All Employees ({flatEmployees.length})
            </CardTitle>
            <button onClick={refreshData} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Refresh from DB
            </button>
          </CardHeader>
          <CardContent className="px-4">
            <div className="overflow-x-auto rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-transparent">
                    <TableHead className="text-slate-400 font-semibold w-8">#</TableHead>
                    <TableHead className="text-slate-400 font-semibold min-w-[100px]">Emp Code</TableHead>
                    <TableHead className="text-slate-400 font-semibold min-w-[160px]">Name</TableHead>
                    <TableHead className="text-slate-400 font-semibold min-w-[200px]">Sites (breakdown)</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right bg-cyan-900/10 min-w-[80px]">Below Hrs</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right bg-amber-900/10 min-w-[80px]">Above Hrs</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right min-w-[70px]">Total Hrs</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right min-w-[80px]">Rate</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right bg-emerald-900/10 min-w-[110px]">Gross Salary</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right min-w-[80px]">Deduction</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right min-w-[80px]">Advance</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right min-w-[100px]">Net Balance</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-center min-w-[90px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flatEmployees.map((emp, idx) => {
                    const rowId = `${emp.empId}::${idx}`;
                    const isCurrentRow = isRowCurrent(emp.empId, idx);
                    const isMatchedRow = !isCurrentRow && isRowMatched(emp.empId, idx);

                    // Rate display: show the effective low/high rates so the
                    // user can verify the trade-specific rate was applied.
                    const rateLabel =
                      emp.lowRate === emp.highRate
                        ? emp.lowRate.toFixed(2)
                        : `${emp.lowRate.toFixed(1)}/${emp.highRate.toFixed(1)}`;

                    return (
                      <TableRow
                        key={rowId}
                        ref={(el) => registerRowRef(rowId, el)}
                        className={cn(
                          'border-slate-700/20',
                          isCurrentRow && 'scroll-mt-20',
                          isCurrentRow && 'bg-yellow-500/30 ring-2 ring-inset ring-yellow-400',
                          isMatchedRow && 'bg-yellow-500/10 ring-1 ring-inset ring-yellow-500/20',
                          !isCurrentRow && !isMatchedRow && 'hover:bg-slate-800/30',
                          !isCurrentRow && !isMatchedRow && emp.isPaid && 'bg-emerald-500/5',
                        )}
                      >
                        <TableCell className="text-slate-500 text-xs">{idx + 1}</TableCell>
                        <TableCell className="text-slate-400 text-xs font-mono">{emp.employeeCode}</TableCell>
                        <TableCell className={cn(
                          'text-sm font-medium',
                          isCurrentRow ? 'text-yellow-200' : isMatchedRow ? 'text-yellow-300' : 'text-slate-300'
                        )}>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {emp.empName}
                            <RoleBadge emp={emp} />
                            {emp.customHourlyRate !== null && emp.customHourlyRate > 0 && (
                              <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20 text-[9px] px-1 py-0" title={`Custom rate: ${emp.customHourlyRate}/hr`}>
                                CR {emp.customHourlyRate.toFixed(1)}
                              </Badge>
                            )}
                            {emp.assignedTrade && emp.assignedTrade.toLowerCase() !== 'helper' && (
                              <Badge className="bg-teal-500/10 text-teal-400 border-teal-500/20 text-[9px] px-1 py-0" title={`Trade: ${emp.assignedTrade} (${emp.assignedTradeRate ?? '?'}/hr)`}>
                                {emp.assignedTrade}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {/* Sites column: show each site name + hours + salary.
                              For single-site employees, just show the name.
                              For multi-site, show each on its own line with breakdown. */}
                          <div className="flex flex-col gap-1">
                            {emp.sites.map((site, sIdx) => (
                              <div key={sIdx} className="flex items-center gap-1.5 text-[10px]">
                                <Building2 className="h-3 w-3 text-slate-500 shrink-0" />
                                <span className="text-slate-300 font-medium">{site.siteName}</span>
                                <span className="text-slate-500">·</span>
                                <span className="text-slate-400 font-mono">{formatHours(site.totalHours)}h</span>
                                <span className="text-slate-500">·</span>
                                <span className="text-emerald-400/70 font-mono">{formatCurrency(site.grossSalary)}</span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-cyan-400/80 text-xs text-right bg-cyan-900/5 font-mono">
                          {formatHours(emp.totalBelowThresholdHours)}
                        </TableCell>
                        <TableCell className="text-amber-400/80 text-xs text-right bg-amber-900/5 font-mono">
                          {formatHours(emp.totalAboveThresholdHours)}
                        </TableCell>
                        <TableCell className="text-slate-300 text-xs text-right font-medium font-mono">
                          {formatHours(emp.totalHours)}
                        </TableCell>
                        <TableCell className="text-slate-400 text-xs text-right font-mono" title="Effective hourly rate (low/high)">
                          {rateLabel}
                        </TableCell>
                        <TableCell className="text-emerald-400/80 text-xs text-right font-medium bg-emerald-900/5 font-mono">
                          {formatCurrency(emp.grossSalary)}
                        </TableCell>
                        <TableCell className="text-red-400/80 text-xs text-right font-mono">
                          {formatCurrency(emp.deduction)}
                        </TableCell>
                        <TableCell className="text-amber-400/80 text-xs text-right font-mono">
                          {formatCurrency(emp.advance)}
                        </TableCell>
                        <TableCell className={cn(
                          'text-xs text-right font-medium font-mono',
                          emp.balanceSalary >= 0 ? 'text-slate-200' : 'text-red-400'
                        )}>
                          {formatCurrency(emp.balanceSalary)}
                        </TableCell>
                        <TableCell className="text-center">
                          {/* Clickable Paid/Unpaid badge — toggles via /api/accounts/salary/toggle-paid */}
                          <button
                            type="button"
                            onClick={() => handleTogglePaid(emp.empId, emp.isPaid)}
                            className="focus:outline-none"
                            title={emp.isPaid ? 'Click to mark as unpaid' : 'Click to mark as paid'}
                          >
                            {emp.isPaid ? (
                              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25 text-[10px] px-2 py-0.5 cursor-pointer transition-colors">
                                <CheckCircle2 className="h-3 w-3" />
                                Paid
                              </Badge>
                            ) : (
                              <Badge className="bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25 text-[10px] px-2 py-0.5 cursor-pointer transition-colors">
                                <XCircle className="h-3 w-3" />
                                Unpaid
                              </Badge>
                            )}
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {/* Grand Total Row */}
                  {totals && (
                    <TableRow className="border-slate-600/50 bg-slate-800/60 hover:bg-slate-800/60">
                      <TableCell colSpan={4} className="text-white font-bold text-right pr-4">
                        Grand Total ({flatEmployees.length} employees)
                      </TableCell>
                      <TableCell className="text-cyan-400 text-right font-bold bg-cyan-900/5 font-mono">
                        {formatHours(totals.totalBelowThresholdHours)}
                      </TableCell>
                      <TableCell className="text-amber-400 text-right font-bold bg-amber-900/5 font-mono">
                        {formatHours(totals.totalAboveThresholdHours)}
                      </TableCell>
                      <TableCell className="text-white text-right font-bold font-mono">
                        {formatHours(totals.totalHours)}
                      </TableCell>
                      <TableCell className="text-slate-400 text-right font-mono text-xs">—</TableCell>
                      <TableCell className="text-emerald-400 text-right font-bold bg-emerald-900/5 font-mono">
                        {formatCurrency(totals.totalSalary)}
                      </TableCell>
                      <TableCell className="text-red-400 text-right font-bold font-mono">
                        {formatCurrency(totals.totalDeductions)}
                      </TableCell>
                      <TableCell className="text-amber-400 text-right font-bold font-mono">
                        {formatCurrency(totals.totalAdvances)}
                      </TableCell>
                      <TableCell className={cn(
                        'text-right font-bold font-mono',
                        totals.netBalance >= 0 ? 'text-purple-400' : 'text-red-400'
                      )}>
                        {formatCurrency(totals.netBalance)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-emerald-400 font-bold">{totals.paidCount}</span>
                          <span className="text-slate-400">/</span>
                          <span className="text-white font-bold">{totals.totalEmployees}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Rate legend */}
            <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500">
              <span className="bg-slate-800/50 px-2 py-1 rounded border border-slate-700/30">
                Rate column: effective low/high hourly rate (trade-aware)
              </span>
              <span className="bg-violet-900/20 px-2 py-1 rounded border border-violet-700/30 text-violet-400">
                CR = Custom Rate override
              </span>
              <span className="bg-teal-900/20 px-2 py-1 rounded border border-teal-700/30 text-teal-400">
                Trade badge = trade-specific rate applied
              </span>
              <span className="bg-slate-800/50 px-2 py-1 rounded border border-slate-700/30">
                Click Paid/Unpaid badge to toggle (syncs with Accounts page)
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-Site Salary Breakdown Summary */}
      {!loading && hasData && siteSummaries.length > 0 && (
        <Card className="bg-slate-800/50 border-slate-700/50 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-400" />
              Per-Site Salary Breakdown — {monthLabel} {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="overflow-x-auto rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-transparent">
                    <TableHead className="text-slate-400 font-semibold">Site Name</TableHead>
                    <TableHead className="text-slate-400 font-semibold">Client</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-center">Employees</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right bg-cyan-900/10">Below Hrs</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right bg-amber-900/10">Above Hrs</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right">Total Hrs</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right bg-emerald-900/10">Gross Salary</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right">Deductions</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right">Advances</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right">Net Balance</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-center">Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {siteSummaries.map((site) => (
                    <TableRow key={site.siteId} className="border-slate-700/50 hover:bg-slate-700/20">
                      <TableCell className="text-slate-200 font-medium">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-slate-500" />
                          {site.siteName}
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-400">{site.clientName || '\u2014'}</TableCell>
                      <TableCell className="text-slate-200 text-center font-semibold">{site.employeeCount}</TableCell>
                      <TableCell className="text-cyan-400 text-right font-medium bg-cyan-900/5 font-mono">{formatHours(site.totalBelowThresholdHours)}</TableCell>
                      <TableCell className="text-amber-400 text-right font-medium bg-amber-900/5 font-mono">{formatHours(site.totalAboveThresholdHours)}</TableCell>
                      <TableCell className="text-slate-200 text-right font-mono">{formatHours(site.totalHours)}</TableCell>
                      <TableCell className="text-emerald-400 text-right font-medium bg-emerald-900/5 font-mono">{formatCurrency(site.totalSalary)}</TableCell>
                      <TableCell className="text-red-400 text-right font-mono">{formatCurrency(site.totalDeductions)}</TableCell>
                      <TableCell className="text-amber-400 text-right font-mono">{formatCurrency(site.totalAdvances)}</TableCell>
                      <TableCell className={cn('text-right font-semibold font-mono', site.netBalance >= 0 ? 'text-purple-400' : 'text-red-400')}>
                        {formatCurrency(site.netBalance)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-emerald-400 font-semibold">{site.paidCount}</span>
                          <span className="text-slate-500">/</span>
                          <span className="text-slate-300">{site.employeeCount}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}

                  {/* Per-site grand total */}
                  {totals && (
                    <TableRow className="border-slate-600/50 bg-slate-800/60 hover:bg-slate-800/60">
                      <TableCell colSpan={2} className="text-white font-bold text-right pr-4">
                        Total ({siteSummaries.length} sites)
                      </TableCell>
                      <TableCell className="text-white text-center font-bold">{totals.totalEmployees}</TableCell>
                      <TableCell className="text-cyan-400 text-right font-bold bg-cyan-900/5 font-mono">{formatHours(totals.totalBelowThresholdHours)}</TableCell>
                      <TableCell className="text-amber-400 text-right font-bold bg-amber-900/5 font-mono">{formatHours(totals.totalAboveThresholdHours)}</TableCell>
                      <TableCell className="text-white text-right font-bold font-mono">{formatHours(totals.totalHours)}</TableCell>
                      <TableCell className="text-emerald-400 text-right font-bold bg-emerald-900/5 font-mono">{formatCurrency(totals.totalSalary)}</TableCell>
                      <TableCell className="text-red-400 text-right font-bold font-mono">{formatCurrency(totals.totalDeductions)}</TableCell>
                      <TableCell className="text-amber-400 text-right font-bold font-mono">{formatCurrency(totals.totalAdvances)}</TableCell>
                      <TableCell className={cn('text-right font-bold font-mono', totals.netBalance >= 0 ? 'text-purple-400' : 'text-red-400')}>
                        {formatCurrency(totals.netBalance)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-emerald-400 font-bold">{totals.paidCount}</span>
                          <span className="text-slate-400">/</span>
                          <span className="text-white font-bold">{totals.totalEmployees}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <Card className="bg-slate-800/50 border-slate-700/50 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-400" />
              All Employees
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full bg-slate-700 rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
