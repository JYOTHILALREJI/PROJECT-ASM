'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DollarSign,
  Search,
  X,
  Loader2,
  Building2,
  CalendarDays,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  ArrowDownToLine,
  Pencil,
  Save,
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Users,
  Wallet,
  GitBranch,
  Wrench,
  Plus,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { useSearchNavigation } from '@/lib/use-search-navigation';

/* ───────── Types ───────── */

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
  slNo: number;

  // Hours
  totalHours: number;
  lowRateHours: number;
  highRateHours: number;
  previousCumulativeHours: number;
  hoursThreshold: number;

  // Rates
  lowRate: number;
  highRate: number;

  // Salary
  totalSalary: number;
  deduction: number;
  advance: number;
  balanceSalary: number;
  isPaid: boolean;

  // Record IDs for save
  standardRecordId: string | null;
  premiumRecordId: string | null;

  // Rate tier info
  rateTier: 'standard' | 'premium' | 'split';

  // Custom rate flag
  isCustomRate: boolean;
  customHourlyRate: number | null;

  // Site info for save
  siteId: string;
  siteName: string;
}

interface SiteData {
  id: string;
  name: string;
  clientName?: string | null;
  projectName?: string | null;
  branchId?: string | null;
  branch?: { id: string; name: string; code: string | null } | null;
  employeeCount: number;
  totalHours: number;
  totalSalary: number;
  totalDeductions: number;
  totalAdvances: number;
  totalBalanceSalary: number;
}

/** Raw employee entry from the API (one per rateTier per employee per site) */
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
  rateTier: 'standard' | 'premium';
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

/* ───────── Constants ───────── */

const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SITE_HEADER_COLORS = [
  { bg: 'bg-emerald-600/20', border: 'border-emerald-500/30', text: 'text-emerald-300', accent: 'text-emerald-400' },
  { bg: 'bg-teal-600/20', border: 'border-teal-500/30', text: 'text-teal-300', accent: 'text-teal-400' },
  { bg: 'bg-cyan-600/20', border: 'border-cyan-500/30', text: 'text-cyan-300', accent: 'text-cyan-400' },
  { bg: 'bg-sky-600/20', border: 'border-sky-500/30', text: 'text-sky-300', accent: 'text-sky-400' },
  { bg: 'bg-violet-600/20', border: 'border-violet-500/30', text: 'text-violet-300', accent: 'text-violet-400' },
  { bg: 'bg-rose-600/20', border: 'border-rose-500/30', text: 'text-rose-300', accent: 'text-rose-400' },
  { bg: 'bg-amber-600/20', border: 'border-amber-500/30', text: 'text-amber-300', accent: 'text-amber-400' },
  { bg: 'bg-lime-600/20', border: 'border-lime-500/30', text: 'text-lime-300', accent: 'text-lime-400' },
];

/* ───────── Helpers ───────── */

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getMonthString(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function isMonthAvailable(year: number, month: number): boolean {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  if (year < currentYear) return true;
  if (year === currentYear) return month <= currentMonth;
  return false;
}

/** Merge split API entries into a single MergedEmployeeRow per (empId, siteId) */
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
  let slNo = 0;

  const sortedGroups = [...grouped.entries()].sort((a, b) =>
    a[1][0].empName.localeCompare(b[1][0].empName),
  );

  for (const [empId, empEntries] of sortedGroups) {
    slNo++;
    const standardEntry = empEntries.find((e) => e.rateTier === 'standard');
    const premiumEntry = empEntries.find((e) => e.rateTier === 'premium');

    const baseEntry = standardEntry || premiumEntry || empEntries[0];
    const hasBonus = baseEntry.isTeamLeader || baseEntry.isSupervisor;

    // Extract custom rate info BEFORE computing rates (PRD v2.0 — direct hourly rates)
    const previousCumulativeHours = (baseEntry.workingHours?.previousCumulativeHours as number) || 0;
    const hoursThreshold = (baseEntry.workingHours?.hoursThreshold as number) || 1000;
    const isCustomRate = (baseEntry.workingHours?.isCustom as boolean) ?? false;
    const customHourlyRate: number | null =
      (baseEntry.workingHours?.customHourlyRate as number | null | undefined) ?? null;

    // Direct hourly rates — custom overrides both tiers
    const lowRate = customHourlyRate ?? (hasBonus ? 3.0 : 2.5);
    const highRate = customHourlyRate ?? (hasBonus ? 5.5 : 5.0);

    const lowRateHours = standardEntry?.salaryRecord?.totalHours ?? 0;
    const highRateHours = premiumEntry?.salaryRecord?.totalHours ?? 0;
    const totalHours = lowRateHours + highRateHours;

    const standardSalary = standardEntry?.salaryRecord?.totalSalary ?? lowRateHours * lowRate;
    const premiumSalary = premiumEntry?.salaryRecord?.totalSalary ?? highRateHours * highRate;
    const totalSalary = standardSalary + premiumSalary;

    const deduction = standardEntry?.salaryRecord?.deduction ?? 0;
    const advance = standardEntry?.salaryRecord?.advance ?? 0;
    const isPaid = (standardEntry?.salaryRecord?.isPaid ?? false) || (premiumEntry?.salaryRecord?.isPaid ?? false);

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
      slNo,
      totalHours,
      lowRateHours,
      highRateHours,
      previousCumulativeHours,
      hoursThreshold,
      lowRate: customHourlyRate ?? standardEntry?.salaryRecord?.rtPerHour ?? lowRate,
      highRate: customHourlyRate ?? premiumEntry?.salaryRecord?.rtPerHour ?? highRate,
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

/* ───────── EditableCell (module-scope component) ───────── */
//
// IMPORTANT: This component MUST be defined at module scope, NOT inside
// the AccountsPage function body. If it were defined inside AccountsPage,
// every keystroke would trigger a re-render of AccountsPage, which would
// create a NEW EditableCell function reference. React's reconciler would
// then see <EditableCell /> as a different component type on each render
// and unmount+remount the <Input> — causing the input to lose focus after
// every single keystroke. The user would have to click the field again
// to type each digit.
//
// By defining it at module scope, the function reference is stable across
// re-renders, React reuses the same <Input> DOM node, and focus is
// preserved while typing.
//
// Props:
//   - editMode: when false, renders a read-only <span>; when true, renders
//     an <Input>. The parent decides this.
//   - value, onChange, className, type: standard input props.
//
// The number onChange handler preserves the raw string value when the
// input is empty (so the user can clear the field and type a new number
// without it snapping to 0 mid-edit).
interface EditableCellProps {
  value: number | string;
  onChange: (val: number | string) => void;
  className?: string;
  type?: 'number' | 'text';
  editMode: boolean;
}

const EditableCell = React.memo(function EditableCell({
  value,
  onChange,
  className,
  type = 'number',
  editMode,
}: EditableCellProps) {
  if (!editMode) {
    return (
      <span className={className}>
        {typeof value === 'number'
          ? value === 0
            ? '-'
            : formatNumber(value)
          : value || '-'}
      </span>
    );
  }
  return (
    <Input
      type={type}
      min="0"
      step={type === 'number' ? '0.01' : undefined}
      value={value}
      onChange={(e) => {
        if (type === 'number') {
          const raw = e.target.value;
          if (raw === '') {
            // Allow clearing the field temporarily — don't force 0 mid-edit
            onChange(0);
          } else {
            const v = parseFloat(raw);
            onChange(isNaN(v) ? 0 : v);
          }
        } else {
          onChange(e.target.value);
        }
      }}
      className="h-6 text-[11px] bg-slate-900/80 border-slate-600/50 text-white w-full py-0 px-1.5 font-mono"
    />
  );
});

/* ───────── Main Component ───────── */

export function AccountsPage() {
  const { setCurrentView } = useAppStore();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [sites, setSites] = useState<SiteData[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedSites, setCollapsedSites] = useState<Set<string>>(new Set());
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set());

  // ── Trade Rates dialog state ──
  const [tradeRatesOpen, setTradeRatesOpen] = useState(false);
  const [tradeRates, setTradeRates] = useState<Array<{ id: string; trade: string; hourlyRate: number }>>([]);
  const [tradeRatesLoading, setTradeRatesLoading] = useState(false);
  const [newTradeName, setNewTradeName] = useState('');
  const [newTradeRate, setNewTradeRate] = useState('');

  // Mutable merged employee rows per site (keyed by siteId)
  const [siteEmployees, setSiteEmployees] = useState<Record<string, MergedEmployeeRow[]>>({});

  // Original data for reverting
  const [originalSiteEmployees, setOriginalSiteEmployees] = useState<Record<string, MergedEmployeeRow[]>>({});

  // Total pending advances for the current month — used only for the badge on
  // the "Advance" button. Individual advance amounts are merged into the salary
  // records server-side by /api/accounts.
  const [totalPendingAdvances, setTotalPendingAdvances] = useState(0);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => currentYear - i);
  }, []);

  const monthStr = getMonthString(selectedYear, selectedMonth);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/accounts?month=${monthStr}&year=${selectedYear}`);
      const json = await res.json();
      if (json.success) {
        const siteResults: ApiSiteResult[] = json.data.sites || [];
        const mappedSites: SiteData[] = siteResults.map((s) => ({
          id: s.site.id,
          name: s.site.name,
          clientName: s.site.clientName,
          projectName: s.site.projectName,
          branchId: s.site.branchId || null,
          branch: s.site.branch || null,
          employeeCount: s.employeeCount,
          totalHours: s.totalHours,
          totalSalary: s.totalSalary,
          totalDeductions: s.totalDeductions,
          totalAdvances: s.totalAdvances,
          totalBalanceSalary: s.totalBalanceSalary,
        }));
        setSites(mappedSites);

        // Merge split entries into single rows per employee per site
        const empMap: Record<string, MergedEmployeeRow[]> = {};
        for (const s of siteResults) {
          empMap[s.site.id] = mergeApiEntries(s.employees, s.site.id, s.site.name);
        }
        setSiteEmployees(empMap);
        setOriginalSiteEmployees(JSON.parse(JSON.stringify(empMap)));
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to load data', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load salary data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [monthStr, selectedYear]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch the total pending advances count for the badge on the "Advance" button.
  // The actual advance amounts are already merged into the salary records by the
  // /api/accounts route (server-side), so we don't overlay them client-side anymore —
  // this avoids the edit-mode bug where the overlay was lost when entering edit mode.
  useEffect(() => {
    const fetchPendingAdvances = async () => {
      try {
        const res = await fetch(`/api/advances/pending-by-month?month=${monthStr}&year=${selectedYear}`);
        const data = await res.json();
        if (data.success) {
          setTotalPendingAdvances(data.data.totalPending || 0);
        } else {
          setTotalPendingAdvances(0);
        }
      } catch {
        setTotalPendingAdvances(0);
      }
    };
    fetchPendingAdvances();
  }, [monthStr, selectedYear]);

  // Reset edit mode when month/year changes
  useEffect(() => {
    setEditMode(false);
  }, [selectedMonth, selectedYear]);

  // Toggle site collapse
  const toggleSiteCollapse = useCallback((siteId: string) => {
    setCollapsedSites((prev) => {
      const next = new Set(prev);
      if (next.has(siteId)) {
        next.delete(siteId);
      } else {
        next.add(siteId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setCollapsedSites(new Set());
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedSites(new Set(sites.map((s) => s.id)));
  }, [sites]);

  // ── Cell change handler ──
  const handleCellChange = useCallback((
    siteId: string,
    index: number,
    field: keyof MergedEmployeeRow | string,
    value: number | boolean | string,
  ) => {
    setSiteEmployees((prev) => {
      const employees = prev[siteId] || [];
      const updated = employees.map((emp, i) => {
        if (i !== index) return emp;
        const u = { ...emp, [field]: value };

        // Recalculate salary fields when relevant fields change
        if (field === 'totalHours') {
          if (u.isCustomRate) {
            u.lowRateHours = u.totalHours;
            u.highRateHours = 0;
            u.totalSalary = u.lowRateHours * u.lowRate;
            u.balanceSalary = u.totalSalary - u.deduction - u.advance;
            u.rateTier = 'standard';
          } else {
            const threshold = u.hoursThreshold || 1000;
            const cumulativeBefore = u.previousCumulativeHours;
            const remainingThreshold = threshold - cumulativeBefore;
            const totalHrs = u.totalHours;

            if (remainingThreshold <= 0) {
              u.lowRateHours = 0;
              u.highRateHours = totalHrs;
            } else if (remainingThreshold >= totalHrs) {
              u.lowRateHours = totalHrs;
              u.highRateHours = 0;
            } else {
              u.lowRateHours = remainingThreshold;
              u.highRateHours = totalHrs - remainingThreshold;
            }

            u.totalSalary = u.lowRateHours * u.lowRate + u.highRateHours * u.highRate;
            u.balanceSalary = u.totalSalary - u.deduction - u.advance;
            u.rateTier = u.highRateHours > 0 ? (u.lowRateHours > 0 ? 'split' : 'premium') : 'standard';
          }
        }

        if (field === 'deduction' || field === 'advance') {
          u.totalSalary = u.lowRateHours * u.lowRate + u.highRateHours * u.highRate;
          u.balanceSalary = u.totalSalary - u.deduction - u.advance;
        }

        if (field === 'lowRateHours') {
          u.totalHours = u.lowRateHours + u.highRateHours;
          u.totalSalary = u.lowRateHours * u.lowRate + u.highRateHours * u.highRate;
          u.balanceSalary = u.totalSalary - u.deduction - u.advance;
          u.rateTier = u.highRateHours > 0 ? (u.lowRateHours > 0 ? 'split' : 'premium') : 'standard';
        }

        if (field === 'highRateHours') {
          u.totalHours = u.lowRateHours + u.highRateHours;
          u.totalSalary = u.lowRateHours * u.lowRate + u.highRateHours * u.highRate;
          u.balanceSalary = u.totalSalary - u.deduction - u.advance;
          u.rateTier = u.highRateHours > 0 ? (u.lowRateHours > 0 ? 'split' : 'premium') : 'standard';
        }

        if (field === 'lowRate') {
          u.totalSalary = u.lowRateHours * u.lowRate + u.highRateHours * u.highRate;
          u.balanceSalary = u.totalSalary - u.deduction - u.advance;
        }

        if (field === 'highRate') {
          u.totalSalary = u.lowRateHours * u.lowRate + u.highRateHours * u.highRate;
          u.balanceSalary = u.totalSalary - u.deduction - u.advance;
        }

        return u;
      });

      return { ...prev, [siteId]: updated };
    });
  }, []);

  // ── Paid toggle handler ──
  const handlePaidToggle = useCallback(async (siteId: string, index: number, currentIsPaid: boolean) => {
    const newIsPaid = !currentIsPaid;

    // Optimistic UI update
    handleCellChange(siteId, index, 'isPaid', newIsPaid);

    const employees = siteEmployees[siteId] || [];
    const emp = employees[index];
    if (!emp) return;

    try {
      const res = await fetch('/api/accounts/salary/toggle-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empId: emp.empId,
          siteId: emp.siteId || siteId,
          month: monthStr,
          year: selectedYear,
          isPaid: newIsPaid,
        }),
      });
      const json = await res.json();
      if (!json.success || !json.data || json.data.updatedCount === 0) {
        // Revert optimistic update — the DB was not changed
        handleCellChange(siteId, index, 'isPaid', currentIsPaid);
        toast({
          title: 'Error',
          description: json.error || `No salary records found for ${emp.empName} (${monthStr}/${selectedYear}). Cannot toggle paid status.`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: newIsPaid ? 'Marked as Paid' : 'Marked as Unpaid',
          description: `${emp.empName} — ${json.data.updatedCount} record(s) updated`,
        });
      }
    } catch {
      handleCellChange(siteId, index, 'isPaid', currentIsPaid);
      toast({ title: 'Error', description: 'Failed to update payment status', variant: 'destructive' });
    }
  }, [siteEmployees, monthStr, selectedYear, handleCellChange]);

  // ── Soft delete handler ──
  const handleSoftDelete = useCallback(async (siteId: string, index: number) => {
    const employees = siteEmployees[siteId] || [];
    const emp = employees[index];
    if (!emp) return;

    // Need at least one record ID to delete
    const recordId = emp.standardRecordId || emp.premiumRecordId;
    if (!recordId) {
      // Just remove from local state if it's a new unsaved row
      setSiteEmployees((prev) => {
        const emps = prev[siteId] || [];
        const updated = emps.filter((_, i) => i !== index);
        return { ...prev, [siteId]: updated.map((e, i) => ({ ...e, slNo: i + 1 })) };
      });
      return;
    }

    // Optimistically remove from local state
    setSiteEmployees((prev) => {
      const emps = prev[siteId] || [];
      const updated = emps.filter((_, i) => i !== index);
      return { ...prev, [siteId]: updated.map((e, i) => ({ ...e, slNo: i + 1 })) };
    });

    try {
      const res = await fetch(`/api/salary-records/${recordId}`, { method: 'DELETE' });
      const data = await res.json();

      if (data.success) {
        const { dismiss } = toast({
          title: 'Record Deleted',
          description: `${emp.empName} salary record removed`,
          action: (
            <Button
              variant="outline"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
              onClick={async () => {
                try {
                  const undoRes = await fetch(`/api/salary-records/${recordId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isDeleted: false }),
                  });
                  const undoData = await undoRes.json();
                  if (undoData.success) {
                    toast({ title: 'Record Restored', description: `${emp.empName} salary record has been restored` });
                    fetchData();
                  } else {
                    toast({ title: 'Undo Failed', description: 'Could not restore the record', variant: 'destructive' });
                  }
                } catch {
                  toast({ title: 'Undo Failed', description: 'Could not restore the record', variant: 'destructive' });
                }
                dismiss();
              }}
            >
              Undo
            </Button>
          ),
          duration: 5000,
        });
      } else {
        // Revert on failure by re-fetching
        fetchData();
        toast({ title: 'Error', description: data.error || 'Failed to delete record', variant: 'destructive' });
      }
    } catch {
      fetchData();
      toast({ title: 'Error', description: 'Failed to delete record', variant: 'destructive' });
    }
  }, [siteEmployees, fetchData]);

  // ── Add row handler ──
  const handleAddRow = useCallback((siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    setSiteEmployees((prev) => {
      const employees = prev[siteId] || [];
      const newSlNo = employees.length + 1;
      return {
        ...prev,
        [siteId]: [
          ...employees,
          {
            empId: `new-${Date.now()}-${newSlNo}`,
            empName: '',
            nationality: '',
            trade: '',
            employeeCode: '',
            isTeamLeader: false,
            isSupervisor: false,
            slNo: newSlNo,
            totalHours: 0,
            lowRateHours: 0,
            highRateHours: 0,
            previousCumulativeHours: 0,
            hoursThreshold: 1000,
            lowRate: 2.5,
            highRate: 5.0,
            totalSalary: 0,
            deduction: 0,
            advance: 0,
            balanceSalary: 0,
            isPaid: false,
            standardRecordId: null,
            premiumRecordId: null,
            rateTier: 'standard' as const,
            isCustomRate: false,
            customHourlyRate: null,
            siteId,
            siteName: site?.name || '',
          },
        ],
      };
    });
  }, [sites]);

  // ── Save all changes using bulk-save API ──
  const handleSave = useCallback(async () => {
    try {
      setSaving(true);

      const allRecords: Array<{
        salaryRecordId?: string;
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
      }> = [];

      const submittedRecordIds = new Set<string>();

      for (const site of sites) {
        const employees = siteEmployees[site.id] || [];
        for (const emp of employees) {
          // Send standard record if lowRateHours > 0 or record exists
          if (emp.lowRateHours > 0 || emp.standardRecordId) {
            const standardRecord = {
              salaryRecordId: emp.standardRecordId || undefined,
              empId: emp.empId,
              empName: emp.empName,
              siteId: emp.siteId || site.id,
              siteName: emp.siteName || site.name,
              month: monthStr,
              year: selectedYear,
              nationality: emp.nationality,
              trade: emp.trade,
              employeeCode: emp.employeeCode,
              slNo: emp.slNo,
              totalHours: emp.lowRateHours,
              rtPerHour: emp.lowRate,
              totalSalary: emp.lowRateHours * emp.lowRate,
              deduction: emp.deduction,
              advance: emp.advance,
              balanceSalary: (emp.lowRateHours * emp.lowRate) - emp.deduction - emp.advance,
              isPaid: emp.isPaid,
              rateTier: 'standard',
            };
            allRecords.push(standardRecord);
            if (emp.standardRecordId) {
              submittedRecordIds.add(emp.standardRecordId);
            }
          }

          // Send premium record if highRateHours > 0 or record exists
          if (emp.highRateHours > 0 || emp.premiumRecordId) {
            const premiumRecord = {
              salaryRecordId: emp.premiumRecordId || undefined,
              empId: emp.empId,
              empName: emp.empName,
              siteId: emp.siteId || site.id,
              siteName: emp.siteName || site.name,
              month: monthStr,
              year: selectedYear,
              nationality: emp.nationality,
              trade: emp.trade,
              employeeCode: emp.employeeCode,
              slNo: emp.slNo,
              totalHours: emp.highRateHours,
              rtPerHour: emp.highRate,
              totalSalary: emp.highRateHours * emp.highRate,
              deduction: 0,
              advance: 0,
              balanceSalary: emp.highRateHours * emp.highRate,
              isPaid: emp.isPaid,
              rateTier: 'premium',
            };
            allRecords.push(premiumRecord);
            if (emp.premiumRecordId) {
              submittedRecordIds.add(emp.premiumRecordId);
            }
          }
        }
      }

      if (allRecords.length === 0) {
        toast({ title: 'No Data', description: 'No records to save.' });
        setSaving(false);
        return;
      }

      const res = await fetch('/api/accounts/salary/bulk-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: allRecords,
          runAllocation: true,
        }),
      });

      const json = await res.json();
      if (json.success) {
        const savedCount = json.data?.savedCount ?? allRecords.length;
        const softDeleted = json.data?.softDeletedCount ?? 0;
        const advancesApplied = json.data?.advancesApplied ?? 0;
        const advancesSkipped = json.data?.advancesSkipped ?? 0;
        toast({
          title: 'Saved',
          description: `${savedCount} record(s) saved successfully.${softDeleted > 0 ? ` ${softDeleted} removed.` : ''}${advancesApplied > 0 ? ` ${advancesApplied} advance(s) applied.` : ''}${advancesSkipped > 0 ? ` ${advancesSkipped} advance(s) skipped (no salary record).` : ''}`,
        });
        setEditMode(false);
        fetchData();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to save records', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save salary records', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [sites, siteEmployees, monthStr, selectedYear, fetchData]);

  // ── Trade Rates handlers ──
  const fetchTradeRates = useCallback(async () => {
    setTradeRatesLoading(true);
    try {
      const res = await fetch('/api/trade-rates');
      const json = await res.json();
      if (json.success) {
        setTradeRates(json.data.tradeRates || []);
      }
    } catch {
      // silent
    } finally {
      setTradeRatesLoading(false);
    }
  }, []);

  // Fetch trade rates on mount so the trade dropdown in edit mode is populated
  useEffect(() => {
    fetchTradeRates();
  }, [fetchTradeRates]);

  const openTradeRates = useCallback(() => {
    setTradeRatesOpen(true);
    setNewTradeName('');
    setNewTradeRate('');
    fetchTradeRates();
  }, [fetchTradeRates]);

  const handleAddTradeRate = useCallback(async () => {
    const trade = newTradeName.trim();
    const rate = parseFloat(newTradeRate);
    if (!trade) {
      toast({ title: 'Error', description: 'Trade name is required', variant: 'destructive' });
      return;
    }
    if (isNaN(rate) || rate <= 0) {
      toast({ title: 'Error', description: 'Rate must be a positive number', variant: 'destructive' });
      return;
    }
    try {
      const res = await fetch('/api/trade-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade, hourlyRate: rate }),
      });
      const json = await res.json();
      if (json.success) {
        toast({ title: 'Trade Rate Saved', description: `${trade}: ${rate} AED/hr` });
        setNewTradeName('');
        setNewTradeRate('');
        fetchTradeRates();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to save', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save trade rate', variant: 'destructive' });
    }
  }, [newTradeName, newTradeRate, fetchTradeRates]);

  const handleDeleteTradeRate = useCallback(async (trade: string) => {
    try {
      await fetch(`/api/trade-rates?trade=${encodeURIComponent(trade)}`, { method: 'DELETE' });
      toast({ title: 'Deleted', description: `Trade rate for "${trade}" removed` });
      fetchTradeRates();
    } catch {
      toast({ title: 'Error', description: 'Failed to delete', variant: 'destructive' });
    }
  }, [fetchTradeRates]);

  const tradeDisplay = (emp: MergedEmployeeRow) => {
    let trade = emp.trade;
    if (emp.isCustomRate) trade = `${trade}/CR`;
    if (emp.isSupervisor) trade = `${trade}/SUPV`;
    if (emp.isTeamLeader) trade = `${trade}/TL`;
    return trade;
  };

  // ── Grand totals ──
  const grandTotals = useMemo(() => {
    let totalHours = 0;
    let totalSalary = 0;
    let totalDeductions = 0;
    let totalAdvances = 0;
    let totalBalance = 0; // sum of ALL employees' balanceSalary (paid + unpaid)
    let balanceDue = 0;   // sum of balanceSalary for UNPAID employees only
    let totalEmployees = 0;
    let paidCount = 0;
    let unpaidCount = 0;

    for (const site of sites) {
      const employees = siteEmployees[site.id] || [];
      totalHours += employees.reduce((s, e) => s + e.totalHours, 0);
      totalSalary += employees.reduce((s, e) => s + e.totalSalary, 0);
      totalDeductions += employees.reduce((s, e) => s + e.deduction, 0);
      totalAdvances += employees.reduce((s, e) => s + e.advance, 0);
      totalBalance += employees.reduce((s, e) => s + e.balanceSalary, 0);
      // Balance Due = amount still to be paid = sum of balanceSalary for
      // UNPAID employees only. Paid employees have already received their
      // balance, so they don't contribute to "what's still owed".
      balanceDue += employees
        .filter((e) => !e.isPaid)
        .reduce((s, e) => s + e.balanceSalary, 0);
      totalEmployees += employees.length;
      paidCount += employees.filter((e) => e.isPaid).length;
      unpaidCount += employees.filter((e) => !e.isPaid).length;
    }

    return { totalHours, totalSalary, totalDeductions, totalAdvances, totalBalance, balanceDue, totalEmployees, paidCount, unpaidCount };
  }, [sites, siteEmployees]);

  // Group sites by branch
  const groupedByBranch = useMemo(() => {
    const branchMap = new Map<string, { branchId: string; branchName: string; branchCode: string | null; sites: SiteData[] }>();
    const unassignedKey = '__unassigned_branch__';

    for (const site of sites) {
      const bKey = site.branchId || unassignedKey;
      const bName = site.branch?.name || 'Unassigned Branch';
      const bCode = site.branch?.code || null;

      if (!branchMap.has(bKey)) {
        branchMap.set(bKey, { branchId: bKey, branchName: bName, branchCode: bCode, sites: [] });
      }
      branchMap.get(bKey)!.sites.push(site);
    }

    return Array.from(branchMap.values())
      .sort((a, b) => {
        if (a.branchId === unassignedKey) return 1;
        if (b.branchId === unassignedKey) return -1;
        return a.branchName.localeCompare(b.branchName);
      });
  }, [sites]);

  // ── Search highlight + jump-to-match logic ──
  //
  // MUST come after groupedByBranch is defined (we iterate it to build the
  // flat list in DOM order). rowId is globally unique: `${site.id}::${index}`.
  // We use this same string as the React key on <tr> and as the ref-registration
  // key, so the hook's rowRefs map lines up with the actual DOM rows.
  interface SearchableEmployee {
    rowId: string;
    siteId: string;
    branchId: string | null;
    emp: MergedEmployeeRow;
  }

  const allSearchableEmployees = useMemo<SearchableEmployee[]>(() => {
    // CRITICAL: iterate in the SAME order the DOM renders rows, otherwise the
    // hook's 'first match' would correspond to a row near the bottom of the
    // page instead of the top. The DOM renders groupedByBranch → sites within
    // each branch → employees within each site. So we must iterate in that
    // exact order here, NOT the raw `sites` array (which is in API order and
    // ignores the branch grouping/sorting done in groupedByBranch).
    const out: SearchableEmployee[] = [];
    for (const branchGroup of groupedByBranch) {
      for (const site of branchGroup.sites) {
        const emps = siteEmployees[site.id] || [];
        for (let i = 0; i < emps.length; i++) {
          out.push({
            rowId: `${site.id}::${i}`,
            siteId: site.id,
            branchId: site.branchId || null,
            emp: emps[i],
          });
        }
      }
    }
    return out;
  }, [groupedByBranch, siteEmployees]);

  // When the current match changes, auto-expand any collapsed branch / site
  // that contains the matching row. Without this, the row would stay hidden
  // inside a collapsed section and scrollIntoView would be a no-op.
  const handleCurrentMatchChange = useCallback(
    (rowId: string | null) => {
      if (!rowId) return;
      const found = allSearchableEmployees.find((se) => se.rowId === rowId);
      if (!found) return;
      setCollapsedBranches((prev) => {
        if (!found.branchId || !prev.has(found.branchId)) return prev;
        const next = new Set(prev);
        next.delete(found.branchId);
        return next;
      });
      setCollapsedSites((prev) => {
        if (!prev.has(found.siteId)) return prev;
        const next = new Set(prev);
        next.delete(found.siteId);
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

  // Helper: returns true if the (site, indexWithinSite) tuple is the current
  // match or one of the matches. Used inside the row render below.
  const isRowCurrent = useCallback(
    (siteId: string, index: number) => {
      const rowId = `${siteId}::${index}`;
      return isCurrent({ rowId, siteId, branchId: null, emp: {} as MergedEmployeeRow });
    },
    [isCurrent],
  );
  const isRowMatched = useCallback(
    (siteId: string, index: number) => {
      const rowId = `${siteId}::${index}`;
      return isMatch({ rowId, siteId, branchId: null, emp: {} as MergedEmployeeRow });
    },
    [isMatch],
  );

  const toggleBranchCollapse = useCallback((branchId: string) => {
    setCollapsedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  }, []);

  // ── Column headers ──
  const lowRateHeader = 'Rate 2.5/3.0';
  const highRateHeader = 'Rate 5.0/5.5';

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">
                Accounts
                {!loading && sites.length > 0 && (
                  <span className="text-slate-400 font-normal text-lg"> ({sites.length} Site{sites.length !== 1 ? 's' : ''})</span>
                )}
              </h2>
              <p className="text-slate-400 mt-0.5">
                Manage salary records &bull; {MONTH_FULL[selectedMonth]} {selectedYear}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons rendered into the global app header via React portal.
          They appear in the header's right section (after the search bar,
          before the notification bell) so they're always visible while
          scrolling — same sticky-header pattern as the search bar.
          Only the Accounts page populates this slot. */}
      {typeof document !== 'undefined' && (() => {
        const slot = document.getElementById('header-actions-slot');
        if (!slot) return null;
        return createPortal(
          <div className="flex items-center gap-2">
            {/* Trade Rates button — manage per-trade hourly rates */}
            <Button
              onClick={openTradeRates}
              className="bg-violet-600 hover:bg-violet-700 text-white gap-2"
              title="Manage trade-specific hourly rates"
            >
              <Wrench className="h-4 w-4" />
              <span className="hidden sm:inline">Trade Rates</span>
            </Button>
            {/* Advance button — opens the Advance management page */}
            <Button
              onClick={() => setCurrentView('advance')}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-2 shadow-lg shadow-amber-600/20"
              title="Manage employee cash advances"
            >
              <Wallet className="h-4 w-4" />
              <span className="hidden sm:inline">Advance</span>
              {totalPendingAdvances > 0 && (
                <Badge variant="secondary" className="ml-1 bg-amber-300 text-amber-900 text-[10px] px-1.5 py-0 h-4 min-w-[20px] flex items-center justify-center">
                  {totalPendingAdvances > 999 ? '999+' : Math.round(totalPendingAdvances)}
                </Badge>
              )}
            </Button>

            {/* Edit / Save / Cancel buttons (only when there's data) */}
            {sites.length > 0 && (
              <>
                {editMode ? (
                  <>
                    <Button
                      onClick={handleSave}
                      disabled={saving}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-lg shadow-emerald-600/20"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      <span className="hidden sm:inline">{saving ? 'Saving...' : 'Save All'}</span>
                    </Button>
                    <Button
                      onClick={() => {
                        setSiteEmployees(JSON.parse(JSON.stringify(originalSiteEmployees)));
                        setEditMode(false);
                      }}
                      className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
                    >
                      <X className="h-4 w-4" />
                      <span className="hidden sm:inline">Cancel</span>
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => setEditMode(true)}
                    className="bg-slate-700 hover:bg-slate-600 text-slate-200 gap-2"
                  >
                    <Pencil className="h-4 w-4" />
                    <span className="hidden sm:inline">Edit</span>
                  </Button>
                )}
              </>
            )}
          </div>,
          slot,
        );
      })()}

      {/* Year Selector, Month Buttons, and Search */}
      <Card className="bg-slate-800/50 border-slate-700/50">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              {/* Year Selector */}
              <div className="flex items-center gap-2 shrink-0">
                <Label className="text-sm text-slate-400">Year:</Label>
                <Select
                  value={String(selectedYear)}
                  onValueChange={(v) => setSelectedYear(parseInt(v, 10))}
                >
                  <SelectTrigger className="w-[140px] bg-slate-700/50 border-slate-600 text-white">
                    <CalendarDays className="h-4 w-4 mr-2 text-slate-400" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-600">
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)} className="text-white focus:bg-slate-700 focus:text-white">
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator orientation="vertical" className="hidden sm:block h-8 bg-slate-700/50" />

              {/* Month Buttons */}
              <div className="flex flex-wrap gap-1.5">
                {MONTH_SHORT.map((m, i) => {
                  const available = isMonthAvailable(selectedYear, i);
                  return (
                    <Button
                      key={m}
                      variant="ghost"
                      size="sm"
                      onClick={() => available && setSelectedMonth(i)}
                      disabled={!available}
                      className={cn(
                        'h-8 px-3 text-xs font-semibold rounded-md transition-all',
                        selectedMonth === i
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-500/20'
                          : available
                            ? 'bg-slate-700/30 text-slate-400 hover:bg-slate-700/50 hover:text-white'
                            : 'bg-slate-800/20 text-slate-600 cursor-not-allowed opacity-50',
                      )}
                    >
                      {m}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Expand/Collapse (search input moved to its own sticky bar below) */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              {sites.length > 0 && (
                <div className="flex items-center gap-2 shrink-0 ml-auto">
                  <Button variant="ghost" size="sm" onClick={expandAll} className="text-slate-400 hover:text-white text-xs h-7">
                    Expand All
                  </Button>
                  <Button variant="ghost" size="sm" onClick={collapseAll} className="text-slate-400 hover:text-white text-xs h-7">
                    Collapse All
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {!loading && sites.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Total Salary</CardTitle>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                <DollarSign className="h-4 w-4 text-emerald-400" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-white">{formatNumber(grandTotals.totalSalary)}</p>
              <p className="text-xs text-slate-500 mt-0.5">DHS</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Balance Due</CardTitle>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
                <ArrowDownToLine className="h-4 w-4 text-amber-400" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-white">{formatNumber(grandTotals.balanceDue)}</p>
              <p className="text-xs text-slate-500 mt-0.5">DHS (unpaid only)</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Paid</CardTitle>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-green-400">{grandTotals.paidCount}</p>
              <p className="text-xs text-slate-500 mt-0.5">of {grandTotals.totalEmployees} employees</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-4">
              <CardTitle className="text-xs font-medium text-slate-400">Unpaid</CardTitle>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10">
                <XCircle className="h-4 w-4 text-red-400" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pt-0">
              <p className="text-xl font-bold text-red-400">{grandTotals.unpaidCount}</p>
              <p className="text-xs text-slate-500 mt-0.5">of {grandTotals.totalEmployees} employees</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search bar rendered into the global app header via React portal.
          The header is already sticky, so the search bar stays visible while
          scrolling the table — same UX as Google Sheets' find bar. Only
          renders when there's data to search. */}
      {!loading && sites.length > 0 && typeof document !== 'undefined' && (() => {
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
              className="pl-10 pr-[120px] bg-slate-950 border-slate-600 text-white placeholder:text-slate-500 h-9 w-full"
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

      {/* Content */}
      {loading ? (
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-10 bg-slate-800 w-full rounded-lg" />
              <Skeleton className="h-48 bg-slate-800 rounded-lg" />
            </div>
          ))}
        </div>
      ) : sites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-700/50 mb-4">
            <Building2 className="h-8 w-8 text-slate-500" />
          </div>
          <h3 className="text-base font-semibold text-white mb-1">No sites found</h3>
          <p className="text-sm text-slate-500 max-w-sm">
            No sites with salary records for {MONTH_FULL[selectedMonth]} {selectedYear}.
            Try selecting a different month or year, or generate salary records first.
          </p>
        </div>
      ) : (
        /* ── Site Sections ── */
        <div className="space-y-6">
          {groupedByBranch.map((branchGroup) => {
            const isBranchCollapsed = collapsedBranches.has(branchGroup.branchId);
            const branchSites = branchGroup.sites;
            const branchTotalSalary = branchSites.reduce((s, site) => {
              const emps = siteEmployees[site.id] || [];
              return s + emps.reduce((sum, e) => sum + e.totalSalary, 0);
            }, 0);
            const branchTotalEmployees = branchSites.reduce((s, site) => {
              const emps = siteEmployees[site.id] || [];
              return s + emps.length;
            }, 0);

            return (
              <div key={branchGroup.branchId} className="space-y-3">
                {/* Branch header */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleBranchCollapse(branchGroup.branchId)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBranchCollapse(branchGroup.branchId); } }}
                  className="flex items-center gap-3 px-4 py-3 bg-slate-900/60 border border-emerald-600/30 rounded-lg cursor-pointer hover:bg-slate-900/80 transition-colors"
                >
                  {isBranchCollapsed ? <ChevronRight className="h-5 w-5 text-emerald-400" /> : <ChevronDown className="h-5 w-5 text-emerald-400" />}
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                    <GitBranch className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white">{branchGroup.branchName}</h3>
                      {branchGroup.branchCode && (
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0 h-4">
                          {branchGroup.branchCode}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {branchSites.length} site{branchSites.length !== 1 ? 's' : ''} · {branchTotalEmployees} employee{branchTotalEmployees !== 1 ? 's' : ''}
                      {' · '}<span className="text-emerald-400 font-medium">{formatNumber(branchTotalSalary)} DHS</span>
                    </p>
                  </div>
                </div>

                {/* Sites within this branch */}
                {!isBranchCollapsed && (
                  <div className="space-y-4 pl-2 sm:pl-4 border-l-2 border-slate-700/30 ml-4">
                    {branchSites.map((site, siteIndex) => {
                      const employees = siteEmployees[site.id] || [];
                      const isCollapsed = collapsedSites.has(site.id);
                      const colorScheme = SITE_HEADER_COLORS[siteIndex % SITE_HEADER_COLORS.length];

                      // Site totals
                      const siteTotalHours = employees.reduce((s, e) => s + e.totalHours, 0);
                      const siteTotalLowRateHours = employees.reduce((s, e) => s + e.lowRateHours, 0);
                      const siteTotalHighRateHours = employees.reduce((s, e) => s + e.highRateHours, 0);
            const siteTotalSalary = employees.reduce((s, e) => s + e.totalSalary, 0);
            const siteTotalDeduction = employees.reduce((s, e) => s + e.deduction, 0);
            const siteTotalAdvance = employees.reduce((s, e) => s + e.advance, 0);
            const siteTotalBalance = employees.reduce((s, e) => s + e.balanceSalary, 0);

            return (
              <div key={site.id} className="border border-slate-700/50 rounded-xl overflow-hidden shadow-lg shadow-black/20">
                {/* Site Header - Clickable to expand/collapse */}
                <button
                  type="button"
                  onClick={() => toggleSiteCollapse(site.id)}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-3 transition-colors text-left',
                    colorScheme.bg,
                    `border-b ${colorScheme.border}`,
                    'hover:brightness-110'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {isCollapsed ? (
                      <ChevronRight className={cn('h-5 w-5', colorScheme.text)} />
                    ) : (
                      <ChevronDown className={cn('h-5 w-5', colorScheme.text)} />
                    )}
                    <div className="flex items-center gap-2">
                      <Building2 className={cn('h-4 w-4', colorScheme.text)} />
                      <span className={cn('text-sm font-bold', colorScheme.text)}>{site.name}</span>
                      {site.clientName && (
                        <span className="text-xs text-slate-400">({site.clientName})</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-slate-400">
                      <Users className="h-3 w-3 inline mr-1" />
                      <span className="text-white font-semibold">{employees.length}</span>
                    </span>
                    <span className="text-slate-400">
                      Hrs: <span className="text-white font-semibold">{formatNumber(siteTotalHours)}</span>
                    </span>
                    <span className={cn('font-semibold', colorScheme.accent)}>
                      {formatNumber(siteTotalSalary)} DHS
                    </span>
                  </div>
                </button>

                {/* Table - Collapsible */}
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse min-w-[1200px]">
                      {/* Sticky Header */}
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-800/95 backdrop-blur-sm border-b-2 border-slate-600/50">
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-center whitespace-nowrap w-[40px]">SL No.</th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-left whitespace-nowrap min-w-[140px]">Name</th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-left whitespace-nowrap min-w-[90px]">Emp Code</th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-left whitespace-nowrap min-w-[100px]">Trade</th>
                          <th className="text-slate-300 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap min-w-[80px]">Total Hrs</th>
                          <th className="text-cyan-300 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap min-w-[85px] bg-cyan-900/15">{lowRateHeader}</th>
                          <th className="text-amber-300 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap min-w-[85px] bg-amber-900/15">{highRateHeader}</th>
                          <th className="text-slate-300 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap min-w-[110px] bg-emerald-900/10">Salary (DHS)</th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap min-w-[90px]">Advance</th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap min-w-[90px]">Deduction</th>
                          <th className="text-slate-300 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap min-w-[110px] bg-emerald-900/10">Total Salary</th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-center whitespace-nowrap w-[70px]">Status</th>
                          {editMode && <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 w-[36px]"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {employees.length === 0 ? (
                          <tr>
                            <td colSpan={editMode ? 13 : 12} className="text-center text-slate-500 py-8 text-xs">
                              No employees for this site.
                            </td>
                          </tr>
                        ) : (
                          employees.map((emp, index) => {
                            const rowId = `${site.id}::${index}`;
                            const isCurrentRow = isRowCurrent(site.id, index);
                            const isMatchedRow = !isCurrentRow && isRowMatched(site.id, index);
                            const hasSplit = emp.rateTier === 'split';
                            return (
                              <tr
                                key={rowId}
                                ref={(el) => registerRowRef(rowId, el)}
                                className={cn(
                                  'border-b border-slate-700/30 transition-colors',
                                  // scroll-mt-20 (80px) tells scrollIntoView to leave
                                  // 80px of space above the matched row when scrolling
                                  // it into view. This clears the sticky app header
                                  // (~56px) so the row is fully visible below it
                                  // instead of being occluded. Only needed on the
                                  // current match since that's the only row we
                                  // scrollIntoView.
                                  isCurrentRow && 'scroll-mt-20',
                                  // Current match: strong yellow background + ring.
                                  isCurrentRow && 'bg-yellow-500/30 ring-2 ring-inset ring-yellow-400',
                                  // Other matches (not current): subtle yellow tint.
                                  isMatchedRow && 'bg-yellow-500/10 ring-1 ring-inset ring-yellow-500/20',
                                  // Non-match states (only when not highlighted).
                                  !isCurrentRow && !isMatchedRow && emp.isPaid && 'bg-emerald-500/5',
                                  !isCurrentRow && !isMatchedRow && !emp.isPaid && hasSplit && 'bg-amber-500/5',
                                  !isCurrentRow && !isMatchedRow && !emp.isPaid && !hasSplit && 'bg-slate-900/30',
                                  editMode && !isCurrentRow && !isMatchedRow && 'hover:bg-slate-700/30',
                                )}
                              >
                                {/* SL No. */}
                                <td className="text-slate-500 text-[11px] text-center font-mono py-1.5 px-2">
                                  {emp.slNo}
                                </td>

                                {/* Name */}
                                <td className="py-1.5 px-2">
                                  {editMode ? (
                                    <Input
                                      value={emp.empName}
                                      onChange={(e) => handleCellChange(site.id, index, 'empName', e.target.value)}
                                      className="h-6 text-[11px] bg-slate-900/80 border-slate-600/50 text-white w-full py-0 px-1.5"
                                    />
                                  ) : (
                                    <span className={cn(
                                      'text-[11px] font-medium',
                                      isCurrentRow ? 'text-yellow-200' : isMatchedRow ? 'text-yellow-300' : 'text-white'
                                    )}>
                                      {emp.empName || '-'}
                                    </span>
                                  )}
                                </td>

                                {/* Emp Code */}
                                <td className="py-1.5 px-2">
                                  {editMode ? (
                                    <Input
                                      value={emp.employeeCode}
                                      onChange={(e) => handleCellChange(site.id, index, 'employeeCode', e.target.value)}
                                      className="h-6 text-[11px] bg-slate-900/80 border-slate-600/50 text-white w-full py-0 px-1.5 font-mono"
                                    />
                                  ) : (
                                    <span className={cn(
                                      'text-[11px] font-mono',
                                      isCurrentRow ? 'text-yellow-200' : isMatchedRow ? 'text-yellow-300' : 'text-slate-300'
                                    )}>
                                      {emp.employeeCode || '-'}
                                    </span>
                                  )}
                                </td>

                                {/* Trade */}
                                <td className="py-1.5 px-2">
                                  {editMode ? (
                                    <select
                                      value={emp.trade}
                                      onChange={(e) => {
                                        const newTrade = e.target.value;
                                        handleCellChange(site.id, index, 'trade', newTrade);
                                        // Auto-update the rate if a trade rate exists
                                        const tr = tradeRates.find(t => t.trade === newTrade);
                                        if (tr) {
                                          handleCellChange(site.id, index, 'lowRate', tr.hourlyRate);
                                          handleCellChange(site.id, index, 'highRate', tr.hourlyRate);
                                        } else {
                                          // Reset to standard rates if no trade rate
                                          const hasBonus = emp.isTeamLeader || emp.isSupervisor;
                                          handleCellChange(site.id, index, 'lowRate', hasBonus ? 3.0 : 2.5);
                                          handleCellChange(site.id, index, 'highRate', hasBonus ? 5.5 : 5.0);
                                        }
                                      }}
                                      className="h-6 text-[11px] bg-slate-900/80 border-slate-600/50 text-white w-full py-0 px-1.5 rounded"
                                    >
                                      <option value="">— Select Trade —</option>
                                      {tradeRates.map((tr) => (
                                        <option key={tr.id} value={tr.trade}>
                                          {tr.trade} ({tr.hourlyRate} AED/hr)
                                        </option>
                                      ))}
                                      {/* Include the current trade if it's not in the tradeRates list */}
                                      {emp.trade && !tradeRates.some(tr => tr.trade === emp.trade) && (
                                        <option value={emp.trade}>{emp.trade} (no custom rate)</option>
                                      )}
                                    </select>
                                  ) : (
                                    <span className="text-[11px] text-slate-300">
                                      {emp.assignedTrade ? (
                                        <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 text-[9px] px-1 py-0">
                                          {emp.assignedTrade}{emp.assignedTradeRate ? ` (${emp.assignedTradeRate})` : ''}
                                        </Badge>
                                      ) : tradeDisplay(emp)}
                                      {emp.isCustomRate && (
                                        <span className="ml-1 text-violet-400 text-[10px]">(custom)</span>
                                      )}
                                    </span>
                                  )}
                                </td>

                                {/* Total Hrs */}
                                <td className="py-1.5 px-2 text-right">
                                  <EditableCell
                                    value={emp.totalHours}
                                    onChange={(v) => handleCellChange(site.id, index, 'totalHours', v as number)}
                                    className="text-[11px] text-slate-200 font-mono"
                                    editMode={editMode}
                                  />
                                </td>

                                {/* Rate 2.5/3.0 - Low Rate Hours */}
                                <td className="py-1.5 px-2 text-right bg-cyan-900/5">
                                  {emp.isCustomRate ? (
                                    <span className="text-[11px] text-violet-300 font-mono">
                                      {emp.totalHours > 0 ? formatNumber(emp.totalHours) : '-'}
                                    </span>
                                  ) : (
                                    <EditableCell
                                      value={emp.lowRateHours}
                                      onChange={(v) => handleCellChange(site.id, index, 'lowRateHours', v as number)}
                                      className={cn(
                                        'text-[11px] font-mono',
                                        emp.lowRateHours > 0 ? 'text-cyan-300' : 'text-slate-600'
                                      )}
                                      editMode={editMode}
                                    />
                                  )}
                                </td>

                                {/* Rate 5.0/5.5 - High Rate Hours */}
                                <td className="py-1.5 px-2 text-right bg-amber-900/5">
                                  {emp.isCustomRate ? (
                                    <span className="text-[11px] text-slate-600 font-mono">-</span>
                                  ) : (
                                    <EditableCell
                                      value={emp.highRateHours}
                                      onChange={(v) => handleCellChange(site.id, index, 'highRateHours', v as number)}
                                      className={cn(
                                        'text-[11px] font-mono',
                                        emp.highRateHours > 0 ? 'text-amber-300' : 'text-slate-600'
                                      )}
                                      editMode={editMode}
                                    />
                                  )}
                                </td>

                                {/* Salary (DHS) - hours × rate = salary format */}
                                <td className="py-1.5 px-2 text-right bg-emerald-900/5">
                                  <div className="flex flex-col items-end gap-0.5">
                                    <span className="text-[9px] text-slate-500 font-mono">
                                      {emp.isCustomRate ? (
                                        `${formatNumber(emp.totalHours)} × ${formatNumber(emp.lowRate)}`
                                      ) : emp.rateTier === 'split' ? (
                                        <>
                                          <span className="text-emerald-500">{formatNumber(emp.lowRateHours)} × {formatNumber(emp.lowRate)}</span>
                                          {' + '}
                                          <span className="text-amber-500">{formatNumber(emp.highRateHours)} × {formatNumber(emp.highRate)}</span>
                                        </>
                                      ) : emp.rateTier === 'premium' ? (
                                        `${formatNumber(emp.highRateHours)} × ${formatNumber(emp.highRate)}`
                                      ) : (
                                        `${formatNumber(emp.lowRateHours)} × ${formatNumber(emp.lowRate)}`
                                      )}
                                    </span>
                                    <span className="text-[11px] text-emerald-300 font-mono font-semibold">
                                      = {formatNumber(emp.totalSalary)}
                                    </span>
                                  </div>
                                </td>

                                {/* Advance */}
                                <td className="py-1.5 px-2 text-right">
                                  <EditableCell
                                    value={emp.advance}
                                    onChange={(v) => handleCellChange(site.id, index, 'advance', v as number)}
                                    className="text-[11px] text-slate-300 font-mono"
                                    editMode={editMode}
                                  />
                                </td>

                                {/* Deduction */}
                                <td className="py-1.5 px-2 text-right">
                                  <EditableCell
                                    value={emp.deduction}
                                    onChange={(v) => handleCellChange(site.id, index, 'deduction', v as number)}
                                    className="text-[11px] text-slate-300 font-mono"
                                    editMode={editMode}
                                  />
                                </td>

                                {/* Total Salary (Salary - Advance - Deduction = Balance) */}
                                <td className="py-1.5 px-2 text-right bg-emerald-900/5">
                                  <span className={cn(
                                    'text-[11px] font-mono font-semibold',
                                    emp.balanceSalary < 0 ? 'text-red-400' : 'text-emerald-400'
                                  )}>
                                    {formatNumber(emp.balanceSalary)}
                                  </span>
                                </td>

                                {/* Status */}
                                <td className="py-1.5 px-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handlePaidToggle(site.id, index, emp.isPaid)}
                                    className="focus:outline-none"
                                    title={emp.isPaid ? 'Click to mark as unpaid' : 'Click to mark as paid'}
                                  >
                                    {emp.isPaid ? (
                                      <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px] px-2 py-0.5 hover:bg-green-500/25 cursor-pointer transition-colors">
                                        Paid
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-red-500/15 text-red-400 border-red-500/30 text-[10px] px-2 py-0.5 hover:bg-red-500/25 cursor-pointer transition-colors">
                                        Unpaid
                                      </Badge>
                                    )}
                                  </button>
                                </td>

                                {/* Delete button (edit mode only) */}
                                {editMode && (
                                  <td className="py-1.5 px-2 text-center">
                                    <button
                                      type="button"
                                      onClick={() => handleSoftDelete(site.id, index)}
                                      className="text-slate-500 hover:text-red-400 transition-colors"
                                      title="Delete row"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            );
                          })
                        )}
                      </tbody>

                      {/* Site Totals Row */}
                      {employees.length > 0 && (
                        <tfoot>
                          <tr className="bg-slate-800/60 border-t-2 border-slate-600/50">
                            <td className="text-[11px] text-slate-400 font-semibold py-2 px-2 text-center" colSpan={4}>
                              Site Total
                            </td>
                            <td className="text-[11px] text-white font-semibold py-2 px-2 text-right font-mono">
                              {formatNumber(siteTotalHours)}
                            </td>
                            <td className="text-[11px] text-cyan-300 font-semibold py-2 px-2 text-right font-mono bg-cyan-900/5">
                              {formatNumber(siteTotalLowRateHours)}
                            </td>
                            <td className="text-[11px] text-amber-300 font-semibold py-2 px-2 text-right font-mono bg-amber-900/5">
                              {formatNumber(siteTotalHighRateHours)}
                            </td>
                            <td className="text-[11px] text-emerald-300 font-semibold py-2 px-2 text-right font-mono bg-emerald-900/5">
                              {formatNumber(siteTotalSalary)}
                            </td>
                            <td className="text-[11px] text-white font-semibold py-2 px-2 text-right font-mono">
                              {formatNumber(siteTotalAdvance)}
                            </td>
                            <td className="text-[11px] text-white font-semibold py-2 px-2 text-right font-mono">
                              {formatNumber(siteTotalDeduction)}
                            </td>
                            <td className="text-[11px] text-emerald-400 font-semibold py-2 px-2 text-right font-mono bg-emerald-900/5">
                              {formatNumber(siteTotalBalance)}
                            </td>
                            <td colSpan={editMode ? 2 : 1}></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>

                    {/* Add Row button in edit mode */}
                    {editMode && (
                      <div className="px-4 py-2 border-t border-slate-700/30 bg-slate-800/30">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAddRow(site.id)}
                          className="text-slate-400 hover:text-white text-xs gap-1"
                        >
                          + Add Row
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Grand Totals Card ── */}
          {sites.length > 0 && (
            <Card className="bg-slate-800/70 border-2 border-emerald-500/30 shadow-lg shadow-emerald-500/5">
              <CardHeader className="px-4 py-3">
                <CardTitle className="text-base text-white flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                  Grand Totals - All Sites
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total Hours</p>
                    <p className="text-sm font-bold text-white font-mono">{formatNumber(grandTotals.totalHours)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total Salary</p>
                    <p className="text-sm font-bold text-emerald-300 font-mono">{formatNumber(grandTotals.totalSalary)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total Advances</p>
                    <p className="text-sm font-bold text-white font-mono">{formatNumber(grandTotals.totalAdvances)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total Deductions</p>
                    <p className="text-sm font-bold text-white font-mono">{formatNumber(grandTotals.totalDeductions)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Balance Due</p>
                    <p className="text-sm font-bold text-amber-300 font-mono">{formatNumber(grandTotals.balanceDue)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Paid</p>
                    <p className="text-sm font-bold text-green-400 font-mono">{grandTotals.paidCount}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Unpaid</p>
                    <p className="text-sm font-bold text-red-400 font-mono">{grandTotals.unpaidCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Trade Rates Dialog ── */}
      <Dialog open={tradeRatesOpen} onOpenChange={setTradeRatesOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Wrench className="h-5 w-5 text-violet-400" />
              Trade Rates
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Set custom hourly rates per trade. Employees with a matching trade
              will automatically use this rate instead of the standard 2.5/5.0 rates.
              Priority: Custom Employee Rate &gt; Trade Rate &gt; Standard Rate.
            </DialogDescription>
          </DialogHeader>

          {/* Add new trade rate */}
          <div className="flex gap-2 py-2">
            <Input
              placeholder="Trade name (e.g. Hilti)"
              value={newTradeName}
              onChange={(e) => setNewTradeName(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 flex-1"
            />
            <Input
              type="number"
              step="0.5"
              placeholder="Rate"
              value={newTradeRate}
              onChange={(e) => setNewTradeRate(e.target.value)}
              className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 w-24"
            />
            <Button
              onClick={handleAddTradeRate}
              className="bg-violet-600 hover:bg-violet-700 text-white gap-1 shrink-0"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* List of trade rates */}
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-700/50 divide-y divide-slate-700/30">
            {tradeRatesLoading ? (
              <div className="py-8 text-center">
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-500" />
              </div>
            ) : tradeRates.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                No trade rates set. Add one above.
              </div>
            ) : (
              tradeRates.map((tr) => (
                <div key={tr.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-700/30">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-3.5 w-3.5 text-violet-400" />
                    <span className="text-sm font-medium text-white">{tr.trade}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/30 text-xs font-mono">
                      {tr.hourlyRate} AED/hr
                    </Badge>
                    <button
                      onClick={() => handleDeleteTradeRate(tr.trade)}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setTradeRatesOpen(false)} className="text-slate-400 hover:text-white">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
