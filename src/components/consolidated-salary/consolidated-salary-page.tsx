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
  ChevronRight,
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

const RATE_STANDARD_BELOW = 2.5;
const RATE_STANDARD_ABOVE = 5.0;
const RATE_TL_BELOW = 3.0;
const RATE_TL_ABOVE = 5.5;

/* ───────── types ───────── */
interface SalaryRecord {
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
  };
}

/** Merged employee row combining standard + premium salary records */
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
  standardRecordId: string | null;
  premiumRecordId: string | null;
}

interface SiteSummary {
  siteId: string;
  siteName: string;
  clientName: string | null;
  employeeCount: number;
  totalHours: number;
  totalBelowThresholdHours: number;
  totalAboveThresholdHours: number;
  totalSalary: number;
  totalGrossSalary: number;
  totalDeductions: number;
  totalAdvances: number;
  netBalance: number;
  paidCount: number;
  totalRecords: number;
  employees: SalaryRecord[];
}

interface Totals {
  totalSites: number;
  totalEmployees: number;
  totalHours: number;
  totalBelowThresholdHours: number;
  totalAboveThresholdHours: number;
  totalSalary: number;
  totalGrossSalary: number;
  totalDeductions: number;
  totalAdvances: number;
  netBalance: number;
  paidCount: number;
  totalRecords: number;
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

/** Compute gross salary using direct hourly rates (PRD v2.0 — no divisors) */
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
  const gross = belowComponent + aboveComponent;

  return { gross, belowComponent, aboveComponent };
}

/** Merge salary records by employee, combining standard + premium tiers */
function mergeSalaryRecords(records: SalaryRecord[]): MergedEmployee[] {
  const empMap = new Map<string, SalaryRecord[]>();
  for (const record of records) {
    const key = `${record.empId}::${record.siteId}`;
    if (!empMap.has(key)) {
      empMap.set(key, []);
    }
    empMap.get(key)!.push(record);
  }

  const merged: MergedEmployee[] = [];

  const sortedEntries = [...empMap.entries()].sort((a, b) => {
    const nameA = a[1][0]?.empName || '';
    const nameB = b[1][0]?.empName || '';
    return nameA.localeCompare(nameB);
  });

  for (const [, empRecords] of sortedEntries) {
    const standardRecord = empRecords.find(r => r.rateTier === 'standard');
    const premiumRecord = empRecords.find(r => r.rateTier === 'premium');
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
    if (standardRecord && premiumRecord) {
      rateTier = 'split';
    } else if (premiumRecord && !standardRecord) {
      rateTier = 'premium';
    }

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
      standardRecordId: standardRecord?.id ?? null,
      premiumRecordId: premiumRecord?.id ?? null,
    });
  }

  return merged;
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
  const [siteSummaries, setSiteSummaries] = useState<SiteSummary[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [hasData, setHasData] = useState(true);
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
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

  /* ── Fetch salary data with DB-first invalidation ── */
  const fetchSalaryData = useCallback(async (m: string, y: string) => {
    try {
      setLoading(true);
      const monthStr = `${y}-${m.padStart(2, '0')}`;
      // Add cache-busting timestamp to ensure fresh DB data
      const cacheBuster = `&_t=${Date.now()}`;
      const res = await fetch(`/api/salary-records?month=${monthStr}&year=${y}${cacheBuster}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
      });
      const json = await res.json();
      if (json.success) {
        setSiteSummaries(json.data.siteSummaries || []);
        setTotals(json.data.totals || null);
        setHasData((json.data.records || []).length > 0);
      } else {
        setSiteSummaries([]);
        setTotals(null);
        setHasData(false);
      }
    } catch {
      setSiteSummaries([]);
      setTotals(null);
      setHasData(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSalaryData(month, year);
  }, [month, year, fetchSalaryData, fetchKey]);

  /* ── Toggle site expansion ── */
  const toggleSiteExpand = useCallback((siteId: string) => {
    setExpandedSites((prev) => {
      const next = new Set(prev);
      if (next.has(siteId)) {
        next.delete(siteId);
      } else {
        next.add(siteId);
      }
      return next;
    });
  }, []);

  /* ── Refresh data (DB-first invalidation) ── */
  const refreshData = useCallback(() => {
    setFetchKey(k => k + 1);
  }, []);

  /* ── Export consolidated salary sheet to Excel ── */
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
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Salary_Sheet_${monthStr}_${year}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Export Excel] failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to export Excel file');
    } finally {
      setExporting(false);
    }
  }, [month, year]);

  /* ── Month/Year display label ── */
  const monthLabel = MONTHS.find((m) => m.value === month)?.label || '';

  /* ── Merge employees for expanded view ── */
  const mergedEmployeesBySite = useMemo(() => {
    const result: Record<string, MergedEmployee[]> = {};
    for (const site of siteSummaries) {
      result[site.siteId] = mergeSalaryRecords(site.employees);
    }
    return result;
  }, [siteSummaries]);

  /* ── Search & jump-to-match ── */
  //
  // The page groups employees by site, and each site is collapsed by default.
  // We flatten all merged employees into a single list (in DOM order) so the
  // shared useSearchNavigation hook can track matches and scroll to them.
  //
  // rowId is globally unique: `${siteId}::${empId}::${idx}`. We use this same
  // string as the React key on <TableRow> and as the ref-registration key so
  // the hook's rowRefs map lines up with the actual DOM rows.
  const [searchQuery, setSearchQuery] = useState('');

  interface SearchableEmployee {
    rowId: string;
    siteId: string;
    emp: MergedEmployee;
  }

  const allSearchableEmployees = useMemo<SearchableEmployee[]>(() => {
    const out: SearchableEmployee[] = [];
    for (const site of siteSummaries) {
      const emps = mergedEmployeesBySite[site.siteId] || [];
      for (let i = 0; i < emps.length; i++) {
        out.push({
          rowId: `${site.siteId}::${emps[i].empId}::${i}`,
          siteId: site.siteId,
          emp: emps[i],
        });
      }
    }
    return out;
  }, [siteSummaries, mergedEmployeesBySite]);

  // When the current match changes, auto-expand the site that contains the
  // matching employee so the row is actually visible for scrollIntoView.
  const handleCurrentMatchChange = useCallback(
    (rowId: string | null) => {
      if (!rowId) return;
      const found = allSearchableEmployees.find((se) => se.rowId === rowId);
      if (!found) return;
      setExpandedSites((prev) => {
        if (prev.has(found.siteId)) return prev;
        const next = new Set(prev);
        next.add(found.siteId);
        return next;
      });
    },
    [allSearchableEmployees],
  );

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
    onCurrentMatchChange: handleCurrentMatchChange,
  });

  // Helper: returns true if the (site, empId, idx) tuple is the current match
  // or one of the matches. Used inside the row render below.
  const isRowCurrent = useCallback(
    (siteId: string, empId: string, idx: number) => {
      const rowId = `${siteId}::${empId}::${idx}`;
      return isCurrent({ rowId, siteId, emp: {} as MergedEmployee });
    },
    [isCurrent],
  );
  const isRowMatched = useCallback(
    (siteId: string, empId: string, idx: number) => {
      const rowId = `${siteId}::${empId}::${idx}`;
      return isMatch({ rowId, siteId, emp: {} as MergedEmployee });
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
      value: totals?.totalGrossSalary ?? null,
      icon: DollarSign,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      format: 'currency',
      loading,
      subtitle: `Direct rates`,
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

  /* ── Role badge for employee ── */
  const RoleBadge = ({ emp }: { emp: MergedEmployee }) => {
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
            Aggregated salary overview with threshold split &bull; Direct rate formula
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
                <SelectItem
                  key={m.value}
                  value={m.value}
                  className="text-slate-200 focus:bg-slate-700 focus:text-white"
                >
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
                <SelectItem
                  key={y}
                  value={y}
                  className="text-slate-200 focus:bg-slate-700 focus:text-white"
                >
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleExportExcel}
            disabled={exporting || loading || !hasData}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
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
            <p className="text-slate-400 text-lg font-medium">No salary data for this month</p>
            <p className="text-slate-500 text-sm mt-1">
              Generate salary records from the Accounts page first.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Search bar rendered into the global app header via React portal.
          The header is already sticky, so the search bar stays visible while
          scrolling the table — same UX as Google Sheets' find bar. Only
          renders when there's data to search. */}
      {!loading && hasData && siteSummaries.length > 0 && typeof document !== 'undefined' && (() => {
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
              <Button
                variant="ghost"
                size="icon"
                type="button"
                disabled={matchCount === 0}
                onClick={goToPrev}
                title="Previous match (Shift+Enter)"
                className="h-7 w-7 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                disabled={matchCount === 0}
                onClick={goToNext}
                title="Next match (Enter)"
                className="h-7 w-7 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-slate-500 hover:text-white"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>,
          slot,
        );
      })()}

      {/* Main Table */}
      {!loading && hasData && siteSummaries.length > 0 && (
        <Card className="bg-slate-800/50 border-slate-700/50 py-4">
          <CardHeader className="px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Building2 className="h-4 w-4 text-slate-400" />
              Site-wise Salary Summary
            </CardTitle>
            <button
              onClick={refreshData}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Refresh from DB
            </button>
          </CardHeader>
          <CardContent className="px-4">
            <div className="overflow-x-auto rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-transparent">
                    <TableHead className="text-slate-400 font-semibold w-8"></TableHead>
                    <TableHead className="text-slate-400 font-semibold">Site Name</TableHead>
                    <TableHead className="text-slate-400 font-semibold">Client</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-center">Employees</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right bg-cyan-900/10">Below Threshold Hrs</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right bg-amber-900/10">Above Threshold Hrs</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right">Total Hours</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right bg-emerald-900/10">Gross Salary</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right">Deductions</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right">Advances</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-right">Net Balance</TableHead>
                    <TableHead className="text-slate-400 font-semibold text-center">Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {siteSummaries.map((site) => {
                    const isExpanded = expandedSites.has(site.siteId);
                    return (
                      <React.Fragment key={site.siteId}>
                        {/* Site Summary Row */}
                        <TableRow
                          className={cn(
                            'border-slate-700/50 cursor-pointer transition-colors',
                            isExpanded
                              ? 'bg-slate-700/30 hover:bg-slate-700/40'
                              : 'hover:bg-slate-700/20'
                          )}
                          onClick={() => toggleSiteExpand(site.siteId)}
                        >
                          <TableCell className="w-8 px-2">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-slate-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            )}
                          </TableCell>
                          <TableCell className="text-slate-200 font-medium">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-slate-500" />
                              {site.siteName}
                            </div>
                          </TableCell>
                          <TableCell className="text-slate-400">
                            {site.clientName || '\u2014'}
                          </TableCell>
                          <TableCell className="text-slate-200 text-center font-semibold">
                            {site.employeeCount}
                          </TableCell>
                          <TableCell className="text-cyan-400 text-right font-medium bg-cyan-900/5">
                            {formatHours(site.totalBelowThresholdHours)}
                          </TableCell>
                          <TableCell className="text-amber-400 text-right font-medium bg-amber-900/5">
                            {formatHours(site.totalAboveThresholdHours)}
                          </TableCell>
                          <TableCell className="text-slate-200 text-right">
                            {formatHours(site.totalHours)}
                          </TableCell>
                          <TableCell className="text-emerald-400 text-right font-medium bg-emerald-900/5">
                            {formatCurrency(site.totalGrossSalary)}
                          </TableCell>
                          <TableCell className="text-red-400 text-right">
                            {formatCurrency(site.totalDeductions)}
                          </TableCell>
                          <TableCell className="text-amber-400 text-right">
                            {formatCurrency(site.totalAdvances)}
                          </TableCell>
                          <TableCell className={cn(
                            'text-right font-semibold',
                            site.netBalance >= 0 ? 'text-purple-400' : 'text-red-400'
                          )}>
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

                        {/* Expanded Employee Details */}
                        {isExpanded && (
                          <TableRow className="border-slate-700/30 bg-slate-900/50 hover:bg-transparent">
                            <TableCell colSpan={12} className="p-0">
                              <div className="px-8 py-3">
                                <div className="overflow-x-auto rounded-lg border border-slate-700/30">
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="border-slate-700/30 hover:bg-transparent">
                                        <TableHead className="text-slate-500 font-medium text-xs">#</TableHead>
                                        <TableHead className="text-slate-500 font-medium text-xs">Emp Code</TableHead>
                                        <TableHead className="text-slate-500 font-medium text-xs">Name</TableHead>
                                        <TableHead className="text-slate-500 font-medium text-xs">Trade</TableHead>
                                        <TableHead className="text-slate-500 font-medium text-xs text-right">Total Hrs</TableHead>
                                        <TableHead className="text-slate-500 font-medium text-xs text-right bg-cyan-900/10">Rate 2.5/3.0</TableHead>
                                        <TableHead className="text-slate-500 font-medium text-xs text-right bg-amber-900/10">Rate 5.0/5.5</TableHead>
                                        <TableHead className="text-slate-500 font-medium text-xs text-right bg-emerald-900/10">Salary (DHS)</TableHead>
                                        <TableHead className="text-slate-500 font-medium text-xs text-right">Advance</TableHead>
                                        <TableHead className="text-slate-500 font-medium text-xs text-right">Deduction</TableHead>
                                        <TableHead className="text-slate-500 font-medium text-xs text-right">Total Salary</TableHead>
                                        <TableHead className="text-slate-500 font-medium text-xs text-center">Status</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {(mergedEmployeesBySite[site.siteId] || []).map((emp, idx) => {
                                        const rowId = `${site.siteId}::${emp.empId}::${idx}`;
                                        const isCurrentRow = isRowCurrent(site.siteId, emp.empId, idx);
                                        const isMatchedRow = !isCurrentRow && isRowMatched(site.siteId, emp.empId, idx);
                                        return (
                                        <TableRow
                                          key={rowId}
                                          ref={(el) => registerRowRef(rowId, el)}
                                          className={cn(
                                            'border-slate-700/20',
                                            // scroll-mt-20 (80px) tells scrollIntoView to leave
                                            // 80px of space above the matched row when scrolling
                                            // it into view. This clears the sticky app header
                                            // (~56px) so the row is fully visible below it
                                            // instead of being occluded. Only needed on the
                                            // current match since that's the only row we
                                            // scrollIntoView.
                                            isCurrentRow && 'scroll-mt-20',
                                            // Current match: strong yellow + ring.
                                            isCurrentRow && 'bg-yellow-500/30 ring-2 ring-inset ring-yellow-400',
                                            // Other matches: subtle yellow tint.
                                            isMatchedRow && 'bg-yellow-500/10 ring-1 ring-inset ring-yellow-500/20',
                                            // Non-match defaults (only when not highlighted).
                                            !isCurrentRow && !isMatchedRow && 'hover:bg-slate-800/30',
                                            !isCurrentRow && !isMatchedRow && emp.rateTier === 'split' && 'bg-amber-500/5',
                                            !isCurrentRow && !isMatchedRow && emp.isPaid && emp.rateTier !== 'split' && 'bg-emerald-500/5',
                                          )}
                                        >
                                          <TableCell className="text-slate-500 text-xs">{idx + 1}</TableCell>
                                          <TableCell className="text-slate-400 text-xs font-mono">
                                            {emp.employeeCode}
                                          </TableCell>
                                          <TableCell className={cn(
                                            'text-sm font-medium',
                                            isCurrentRow ? 'text-yellow-200' : isMatchedRow ? 'text-yellow-300' : 'text-slate-300'
                                          )}>
                                            <div className="flex items-center gap-1.5">
                                              {emp.empName}
                                              <RoleBadge emp={emp} />
                                              {emp.customHourlyRate !== null && emp.customHourlyRate > 0 && (
                                                <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20 text-[9px] px-1 py-0">
                                                  CR
                                                </Badge>
                                              )}
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-slate-400 text-xs">
                                            {emp.trade}
                                          </TableCell>
                                          <TableCell className="text-slate-300 text-xs text-right font-medium">
                                            {formatHours(emp.totalHours)}
                                          </TableCell>
                                          <TableCell className="text-cyan-400/80 text-xs text-right bg-cyan-900/5">
                                            {formatHours(emp.belowThresholdHours)}
                                          </TableCell>
                                          <TableCell className="text-amber-400/80 text-xs text-right bg-amber-900/5">
                                            {formatHours(emp.aboveThresholdHours)}
                                          </TableCell>
                                          <TableCell className="text-emerald-400/80 text-xs text-right font-medium bg-emerald-900/5">
                                            <div className="flex flex-col items-end gap-0.5">
                                              <span className="text-[9px] text-slate-500 font-mono">
                                                {emp.customHourlyRate !== null && emp.customHourlyRate > 0 ? (
                                                  `${formatHours(emp.totalHours)} × ${emp.customHourlyRate}`
                                                ) : emp.rateTier === 'split' ? (
                                                  <>
                                                    <span className="text-emerald-500">{formatHours(emp.belowThresholdHours)} × {(emp.isTeamLeader || emp.isSupervisor) ? '3.0' : '2.5'}</span>
                                                    {' + '}
                                                    <span className="text-amber-500">{formatHours(emp.aboveThresholdHours)} × {(emp.isTeamLeader || emp.isSupervisor) ? '5.5' : '5.0'}</span>
                                                  </>
                                                ) : emp.rateTier === 'premium' ? (
                                                  `${formatHours(emp.aboveThresholdHours)} × ${(emp.isTeamLeader || emp.isSupervisor) ? '5.5' : '5.0'}`
                                                ) : (
                                                  `${formatHours(emp.belowThresholdHours)} × ${(emp.isTeamLeader || emp.isSupervisor) ? '3.0' : '2.5'}`
                                                )}
                                              </span>
                                              <span className="font-mono">
                                                = {formatCurrency(emp.grossSalary)}
                                              </span>
                                            </div>
                                          </TableCell>
                                          <TableCell className="text-amber-400/80 text-xs text-right">
                                            {formatCurrency(emp.advance)}
                                          </TableCell>
                                          <TableCell className="text-red-400/80 text-xs text-right">
                                            {formatCurrency(emp.deduction)}
                                          </TableCell>
                                          <TableCell className={cn(
                                            'text-xs text-right font-medium',
                                            emp.balanceSalary >= 0 ? 'text-slate-200' : 'text-red-400'
                                          )}>
                                            {formatCurrency(emp.balanceSalary)}
                                          </TableCell>
                                          <TableCell className="text-center">
                                            {emp.isPaid ? (
                                              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 text-[10px] gap-1">
                                                <CheckCircle2 className="h-3 w-3" />
                                                Paid
                                              </Badge>
                                            ) : (
                                              <Badge className="bg-slate-600/20 text-slate-400 border-slate-600/30 hover:bg-slate-600/30 text-[10px] gap-1">
                                                <XCircle className="h-3 w-3" />
                                                Unpaid
                                              </Badge>
                                            )}
                                          </TableCell>
                                        </TableRow>
                                        );
                                      })}

                                      {/* Site employee totals */}
                                      {(mergedEmployeesBySite[site.siteId] || []).length > 0 && (
                                        <TableRow className="border-slate-600/50 bg-slate-800/40 hover:bg-slate-800/40">
                                          <TableCell colSpan={4} className="text-slate-300 text-xs font-bold text-right pr-4">
                                            Site Employee Total
                                          </TableCell>
                                          <TableCell className="text-slate-200 text-xs text-right font-bold">
                                            {formatHours(
                                              (mergedEmployeesBySite[site.siteId] || []).reduce((s, e) => s + e.totalHours, 0)
                                            )}
                                          </TableCell>
                                          <TableCell className="text-cyan-400 text-xs text-right font-bold bg-cyan-900/5">
                                            {formatHours(
                                              (mergedEmployeesBySite[site.siteId] || []).reduce((s, e) => s + e.belowThresholdHours, 0)
                                            )}
                                          </TableCell>
                                          <TableCell className="text-amber-400 text-xs text-right font-bold bg-amber-900/5">
                                            {formatHours(
                                              (mergedEmployeesBySite[site.siteId] || []).reduce((s, e) => s + e.aboveThresholdHours, 0)
                                            )}
                                          </TableCell>
                                          <TableCell className="text-emerald-400 text-xs text-right font-bold bg-emerald-900/5">
                                            {formatCurrency(
                                              (mergedEmployeesBySite[site.siteId] || []).reduce((s, e) => s + e.grossSalary, 0)
                                            )}
                                          </TableCell>
                                          <TableCell className="text-amber-400 text-xs text-right font-bold">
                                            {formatCurrency(
                                              (mergedEmployeesBySite[site.siteId] || []).reduce((s, e) => s + e.advance, 0)
                                            )}
                                          </TableCell>
                                          <TableCell className="text-red-400 text-xs text-right font-bold">
                                            {formatCurrency(
                                              (mergedEmployeesBySite[site.siteId] || []).reduce((s, e) => s + e.deduction, 0)
                                            )}
                                          </TableCell>
                                          <TableCell className={cn(
                                            'text-xs text-right font-bold',
                                            (mergedEmployeesBySite[site.siteId] || []).reduce((s, e) => s + e.balanceSalary, 0) >= 0
                                              ? 'text-purple-400'
                                              : 'text-red-400'
                                          )}>
                                            {formatCurrency(
                                              (mergedEmployeesBySite[site.siteId] || []).reduce((s, e) => s + e.balanceSalary, 0)
                                            )}
                                          </TableCell>
                                          <TableCell></TableCell>
                                        </TableRow>
                                      )}
                                    </TableBody>
                                  </Table>
                                </div>

                                {/* Direct rate formula reference */}
                                <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500">
                                  <span className="bg-slate-800/50 px-2 py-1 rounded border border-slate-700/30">
                                    Standard: below_hrs × 2.5 + above_hrs × 5.0
                                  </span>
                                  <span className="bg-slate-800/50 px-2 py-1 rounded border border-slate-700/30">
                                    TL/Supervisor: below_hrs × 3.0 + above_hrs × 5.5
                                  </span>
                                  <span className="bg-violet-900/20 px-2 py-1 rounded border border-violet-700/30 text-violet-400">
                                    CR = Custom Rate override
                                  </span>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* Grand Total Row */}
                  {totals && (
                    <TableRow className="border-slate-600/50 bg-slate-800/60 hover:bg-slate-800/60">
                      <TableCell className="w-8 px-2"></TableCell>
                      <TableCell className="text-white font-bold">
                        Grand Total
                      </TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-white text-center font-bold">
                        {totals.totalEmployees}
                      </TableCell>
                      <TableCell className="text-cyan-400 text-right font-bold bg-cyan-900/5">
                        {formatHours(totals.totalBelowThresholdHours)}
                      </TableCell>
                      <TableCell className="text-amber-400 text-right font-bold bg-amber-900/5">
                        {formatHours(totals.totalAboveThresholdHours)}
                      </TableCell>
                      <TableCell className="text-white text-right font-bold">
                        {formatHours(totals.totalHours)}
                      </TableCell>
                      <TableCell className="text-emerald-400 text-right font-bold bg-emerald-900/5">
                        {formatCurrency(totals.totalGrossSalary)}
                      </TableCell>
                      <TableCell className="text-red-400 text-right font-bold">
                        {formatCurrency(totals.totalDeductions)}
                      </TableCell>
                      <TableCell className="text-amber-400 text-right font-bold">
                        {formatCurrency(totals.totalAdvances)}
                      </TableCell>
                      <TableCell className={cn(
                        'text-right font-bold',
                        totals.netBalance >= 0 ? 'text-purple-400' : 'text-red-400'
                      )}>
                        {formatCurrency(totals.netBalance)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-emerald-400 font-bold">{totals.paidCount}</span>
                          <span className="text-slate-400">/</span>
                          <span className="text-white font-bold">{totals.totalRecords}</span>
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
              <Building2 className="h-4 w-4 text-slate-400" />
              Site-wise Salary Summary
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
