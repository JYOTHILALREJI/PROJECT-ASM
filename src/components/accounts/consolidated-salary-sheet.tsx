'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Save,
  Loader2,
  Search,
  Pencil,
  X,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/* ───────── Constants ───────── */

const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Divisor-based formula constants
const RATE_BELOW = 2.5;
const RATE_ABOVE = 5.0;
const DIVISOR_STANDARD_BELOW = 1.0;
const DIVISOR_STANDARD_ABOVE = 1.0;
const DIVISOR_TL_BELOW = 3.0;
const DIVISOR_TL_ABOVE = 5.5;

/* ───────── Types ───────── */

interface MergedEmployeeRow {
  empId: string;
  empName: string;
  nationality: string;
  trade: string;
  employeeCode: string;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  slNo: number;

  // Hours
  totalHours: number;
  lowRateHours: number; // Below threshold hours (editable)
  highRateHours: number; // Above threshold hours (editable)
  previousCumulativeHours: number;
  hoursThreshold: number;

  // Rates (for display/calculation only)
  lowRate: number; // 2.5 or 3.0 based on TL/Supervisor
  highRate: number; // 5.0 or 5.5 based on TL/Supervisor

  // Salary (divisor-based)
  salary: number; // Gross salary using divisor formula
  deduction: number;
  advance: number;
  totalSalary: number; // salary - deduction - advance
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
  isActive: boolean;
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
  };
  employeeCount: number;
  totalHours: number;
  totalSalary: number;
  totalDeductions: number;
  totalAdvances: number;
  totalBalanceSalary: number;
  employees: ApiEmployeeEntry[];
}

/* ───────── Helpers ───────── */

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatHours(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
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

/** Compute salary using the divisor-based formula */
function computeSalary(
  lowRateHours: number,
  highRateHours: number,
  isTeamLeader: boolean,
  isSupervisor: boolean,
  isCustomRate: boolean,
  customHourlyRate: number | null,
): number {
  if (isCustomRate && customHourlyRate !== null && customHourlyRate > 0) {
    return (lowRateHours + highRateHours) * customHourlyRate;
  }

  const hasBonus = isTeamLeader || isSupervisor;
  const lowDivisor = hasBonus ? DIVISOR_TL_BELOW : DIVISOR_STANDARD_BELOW;
  const highDivisor = hasBonus ? DIVISOR_TL_ABOVE : DIVISOR_STANDARD_ABOVE;

  const lowComponent = (lowRateHours * RATE_BELOW) / lowDivisor;
  const highComponent = (highRateHours * RATE_ABOVE) / highDivisor;

  return lowComponent + highComponent;
}

/** Merge split API entries into a single MergedEmployeeRow per (empId, siteId) */
function mergeApiEntries(
  entries: ApiEmployeeEntry[],
  siteId: string,
  siteName: string,
): MergedEmployeeRow[] {
  // Group by empId
  const grouped = new Map<string, ApiEmployeeEntry[]>();
  for (const entry of entries) {
    if (!grouped.has(entry.empId)) {
      grouped.set(entry.empId, []);
    }
    grouped.get(entry.empId)!.push(entry);
  }

  const merged: MergedEmployeeRow[] = [];
  let slNo = 0;

  // Sort entries by name for consistent ordering
  const sortedGroups = [...grouped.entries()].sort((a, b) =>
    a[1][0].empName.localeCompare(b[1][0].empName),
  );

  for (const [empId, empEntries] of sortedGroups) {
    slNo++;
    const standardEntry = empEntries.find((e) => e.rateTier === 'standard');
    const premiumEntry = empEntries.find((e) => e.rateTier === 'premium');

    // Use the first entry for base info (prefer standard)
    const baseEntry = standardEntry || premiumEntry || empEntries[0];
    const hasBonus = baseEntry.isTeamLeader || baseEntry.isSupervisor;
    const lowRate = hasBonus ? 3.0 : 2.5;
    const highRate = hasBonus ? 5.5 : 5.0;

    const lowRateHours = standardEntry?.salaryRecord?.totalHours ?? 0;
    const highRateHours = premiumEntry?.salaryRecord?.totalHours ?? 0;
    const totalHours = lowRateHours + highRateHours;

    // Detect custom rate
    const isCustomRate = (baseEntry.workingHours?.isCustom as boolean) ?? false;
    const customHourlyRate: number | null =
      (baseEntry.workingHours?.customHourlyRate as number | null | undefined) ?? null;

    // Compute salary using divisor-based formula
    const salary = computeSalary(
      lowRateHours,
      highRateHours,
      baseEntry.isTeamLeader,
      baseEntry.isSupervisor,
      isCustomRate,
      customHourlyRate,
    );

    const deduction = standardEntry?.salaryRecord?.deduction ?? 0;
    const advance = standardEntry?.salaryRecord?.advance ?? 0;
    const isPaid = (standardEntry?.salaryRecord?.isPaid ?? false) || (premiumEntry?.salaryRecord?.isPaid ?? false);

    let rateTier: 'standard' | 'premium' | 'split' = 'standard';
    if (standardEntry && premiumEntry) {
      rateTier = 'split';
    } else if (premiumEntry && !standardEntry) {
      rateTier = 'premium';
    }

    const previousCumulativeHours = (baseEntry.workingHours?.previousCumulativeHours as number) || 0;
    const hoursThreshold = (baseEntry.workingHours?.hoursThreshold as number) || 1000;

    merged.push({
      empId,
      empName: baseEntry.empName,
      nationality: baseEntry.salaryRecord?.nationality || baseEntry.nationality,
      trade: baseEntry.salaryRecord?.trade || baseEntry.trade,
      employeeCode: baseEntry.salaryRecord?.employeeCode || baseEntry.employeeCode,
      isTeamLeader: baseEntry.isTeamLeader,
      isSupervisor: baseEntry.isSupervisor,
      slNo,
      totalHours,
      lowRateHours,
      highRateHours,
      previousCumulativeHours,
      hoursThreshold,
      lowRate,
      highRate,
      salary,
      deduction,
      advance,
      totalSalary: salary - deduction - advance,
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

/* ───────── Main Component ───────── */

export function ConsolidatedSalarySheet() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [sites, setSites] = useState<SiteData[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Mutable merged employee rows per site (keyed by siteId)
  const [siteEmployees, setSiteEmployees] = useState<Record<string, MergedEmployeeRow[]>>({});

  // Original data for reverting
  const [originalSiteEmployees, setOriginalSiteEmployees] = useState<Record<string, MergedEmployeeRow[]>>({});

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
          isActive: true,
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
      toast({ title: 'Error', description: 'Failed to load consolidated salary data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [monthStr, selectedYear]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset edit mode when month/year changes
  useEffect(() => {
    setEditMode(false);
  }, [selectedMonth, selectedYear]);

  // ── Cell change handler ──
  const handleCellChange = (
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
            u.salary = computeSalary(u.lowRateHours, u.highRateHours, u.isTeamLeader, u.isSupervisor, u.isCustomRate, u.customHourlyRate);
            u.totalSalary = u.salary - u.deduction - u.advance;
            u.rateTier = 'standard';
          } else {
            // Recalculate the split based on cumulative threshold
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

            u.salary = computeSalary(u.lowRateHours, u.highRateHours, u.isTeamLeader, u.isSupervisor, u.isCustomRate, u.customHourlyRate);
            u.totalSalary = u.salary - u.deduction - u.advance;
            u.rateTier = u.highRateHours > 0 ? (u.lowRateHours > 0 ? 'split' : 'premium') : 'standard';
          }
        }

        if (field === 'deduction' || field === 'advance') {
          u.totalSalary = u.salary - u.deduction - u.advance;
        }

        if (field === 'lowRateHours') {
          u.totalHours = u.lowRateHours + u.highRateHours;
          u.salary = computeSalary(u.lowRateHours, u.highRateHours, u.isTeamLeader, u.isSupervisor, u.isCustomRate, u.customHourlyRate);
          u.totalSalary = u.salary - u.deduction - u.advance;
          u.rateTier = u.highRateHours > 0 ? (u.lowRateHours > 0 ? 'split' : 'premium') : 'standard';
        }

        if (field === 'highRateHours') {
          u.totalHours = u.lowRateHours + u.highRateHours;
          u.salary = computeSalary(u.lowRateHours, u.highRateHours, u.isTeamLeader, u.isSupervisor, u.isCustomRate, u.customHourlyRate);
          u.totalSalary = u.salary - u.deduction - u.advance;
          u.rateTier = u.highRateHours > 0 ? (u.lowRateHours > 0 ? 'split' : 'premium') : 'standard';
        }

        return u;
      });

      return { ...prev, [siteId]: updated };
    });
  };

  const handlePaidToggle = async (siteId: string, index: number, currentIsPaid: boolean) => {
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
      if (!json.success) {
        handleCellChange(siteId, index, 'isPaid', currentIsPaid);
        toast({ title: 'Error', description: json.error || 'Failed to update payment status', variant: 'destructive' });
      } else {
        toast({
          title: newIsPaid ? 'Marked as Paid' : 'Marked as Unpaid',
          description: `${emp.empName} - ${emp.siteName}`,
        });
      }
    } catch {
      handleCellChange(siteId, index, 'isPaid', currentIsPaid);
      toast({ title: 'Error', description: 'Failed to update payment status', variant: 'destructive' });
    }
  };

  const handleAddRow = (siteId: string) => {
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
            salary: 0,
            deduction: 0,
            advance: 0,
            totalSalary: 0,
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
  };

  const handleDeleteRow = (siteId: string, index: number) => {
    setSiteEmployees((prev) => {
      const employees = prev[siteId] || [];
      const updated = employees.filter((_, i) => i !== index);
      return { ...prev, [siteId]: updated.map((emp, i) => ({ ...emp, slNo: i + 1 })) };
    });
  };

  // ── Save all changes using bulk-save API ──
  const handleSave = async () => {
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

      for (const site of sites) {
        const employees = siteEmployees[site.id] || [];
        for (const emp of employees) {
          // Send standard record if lowRateHours > 0 or record exists
          if (emp.lowRateHours > 0 || emp.standardRecordId) {
            const lowSalary = emp.isCustomRate && emp.customHourlyRate
              ? emp.lowRateHours * emp.customHourlyRate
              : (emp.lowRateHours * RATE_BELOW) / (emp.isTeamLeader || emp.isSupervisor ? DIVISOR_TL_BELOW : DIVISOR_STANDARD_BELOW);

            allRecords.push({
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
              rtPerHour: emp.isCustomRate && emp.customHourlyRate ? emp.customHourlyRate : emp.lowRate,
              totalSalary: lowSalary,
              deduction: emp.deduction,
              advance: emp.advance,
              balanceSalary: lowSalary - emp.deduction - emp.advance,
              isPaid: emp.isPaid,
              rateTier: 'standard',
            });
          }

          // Send premium record if highRateHours > 0 or record exists
          if (emp.highRateHours > 0 || emp.premiumRecordId) {
            const highSalary = emp.isCustomRate && emp.customHourlyRate
              ? emp.highRateHours * emp.customHourlyRate
              : (emp.highRateHours * RATE_ABOVE) / (emp.isTeamLeader || emp.isSupervisor ? DIVISOR_TL_ABOVE : DIVISOR_STANDARD_ABOVE);

            allRecords.push({
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
              rtPerHour: emp.isCustomRate && emp.customHourlyRate ? emp.customHourlyRate : emp.highRate,
              totalSalary: highSalary,
              deduction: 0,
              advance: 0,
              balanceSalary: highSalary,
              isPaid: emp.isPaid,
              rateTier: 'premium',
            });
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
        toast({
          title: 'Saved',
          description: `${savedCount} record(s) saved successfully.${softDeleted > 0 ? ` ${softDeleted} removed.` : ''}`,
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
  };

  // ── Search highlight logic ──
  const searchLower = searchQuery.toLowerCase().trim();

  const isRowHighlighted = (emp: MergedEmployeeRow): boolean => {
    if (!searchLower) return false;
    return (
      emp.empName.toLowerCase().includes(searchLower) ||
      emp.employeeCode.toLowerCase().includes(searchLower)
    );
  };

  // Grand totals
  const grandTotals = useMemo(() => {
    let totalHours = 0;
    let totalLowRateHours = 0;
    let totalHighRateHours = 0;
    let totalSalary = 0;
    let totalDeductions = 0;
    let totalAdvances = 0;
    let totalBalance = 0;
    let totalEmployees = 0;
    let paidCount = 0;
    let unpaidCount = 0;

    for (const site of sites) {
      const employees = siteEmployees[site.id] || [];
      totalHours += employees.reduce((s, e) => s + e.totalHours, 0);
      totalLowRateHours += employees.reduce((s, e) => s + e.lowRateHours, 0);
      totalHighRateHours += employees.reduce((s, e) => s + e.highRateHours, 0);
      totalSalary += employees.reduce((s, e) => s + e.salary, 0);
      totalDeductions += employees.reduce((s, e) => s + e.deduction, 0);
      totalAdvances += employees.reduce((s, e) => s + e.advance, 0);
      totalBalance += employees.reduce((s, e) => s + e.totalSalary, 0);
      totalEmployees += employees.length;
      paidCount += employees.filter((e) => e.isPaid).length;
      unpaidCount += employees.filter((e) => !e.isPaid).length;
    }

    return {
      totalHours, totalLowRateHours, totalHighRateHours,
      totalSalary, totalDeductions, totalAdvances, totalBalance,
      totalEmployees, paidCount, unpaidCount,
    };
  }, [sites, siteEmployees]);

  return (
    <div className="min-h-screen bg-slate-900 p-4 sm:p-6">
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">
                  Consolidated Salary Sheet
                  {!loading && sites.length > 0 && (
                    <span className="text-slate-400 font-normal"> ({sites.length} Site{sites.length !== 1 ? 's' : ''})</span>
                  )}
                </h1>
                <p className="text-slate-500 text-sm mt-0.5">
                  All sites salary data &bull; {MONTH_FULL[selectedMonth]} {selectedYear}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Grand Total Badge */}
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-sm px-3 py-1.5 font-semibold">
              Grand Total: {formatNumber(grandTotals.totalSalary)} DHS
            </Badge>
            {editMode && (
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save All
              </Button>
            )}
            <Button
              onClick={() => {
                if (editMode) {
                  setSiteEmployees(JSON.parse(JSON.stringify(originalSiteEmployees)));
                }
                setEditMode(!editMode);
              }}
              className={cn(
                'gap-2',
                editMode
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-200',
              )}
            >
              {editMode ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {editMode ? 'Cancel Edit' : 'Edit'}
            </Button>
          </div>
        </div>

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
                    <SelectTrigger className="w-[100px] bg-slate-700/50 border-slate-600 text-white">
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

              {/* Global Search */}
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  placeholder="Search employee name or ID to highlight..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-slate-900 border-slate-600 text-white placeholder:text-slate-500"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-slate-500 hover:text-white"
                    onClick={() => setSearchQuery('')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Grand Totals Bar */}
        {!loading && sites.length > 0 && (
          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Employees:</span>
                  <span className="text-white font-semibold">{grandTotals.totalEmployees}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Total Hrs:</span>
                  <span className="text-white font-semibold">{formatHours(grandTotals.totalHours)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-cyan-400/70">Rate 2.5/3 Hrs:</span>
                  <span className="text-cyan-400 font-semibold">{formatHours(grandTotals.totalLowRateHours)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-400/70">Rate 5/5.5 Hrs:</span>
                  <span className="text-amber-400 font-semibold">{formatHours(grandTotals.totalHighRateHours)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Salary:</span>
                  <span className="text-emerald-400 font-semibold">{formatNumber(grandTotals.totalSalary)} DHS</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Deduction:</span>
                  <span className="text-red-400 font-semibold">{formatNumber(grandTotals.totalDeductions)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Advance:</span>
                  <span className="text-amber-400 font-semibold">{formatNumber(grandTotals.totalAdvances)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Net:</span>
                  <span className={cn(
                    'font-bold',
                    grandTotals.totalBalance >= 0 ? 'text-emerald-400' : 'text-red-400'
                  )}>
                    {formatNumber(grandTotals.totalBalance)} DHS
                  </span>
                </div>
                <Separator orientation="vertical" className="hidden sm:block h-4 bg-slate-700/50" />
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">{grandTotals.paidCount} Paid</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5 text-red-400" />
                  <span className="text-red-400 font-semibold">{grandTotals.unpaidCount} Unpaid</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Content */}
        {loading ? (
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-8 bg-slate-800 w-48" />
                <Skeleton className="h-40 bg-slate-800 rounded-lg" />
              </div>
            ))}
          </div>
        ) : sites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-700/50 mb-4">
              <FileSpreadsheet className="h-8 w-8 text-slate-500" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1">No sites found</h3>
            <p className="text-sm text-slate-500 max-w-sm">
              No sites with employees for {MONTH_FULL[selectedMonth]} {selectedYear}.
            </p>
          </div>
        ) : (
          /* ── Consolidated Table ── */
          <div className="space-y-0">
            {sites.map((site) => {
              const employees = siteEmployees[site.id] || [];
              const siteTotalHours = employees.reduce((s, e) => s + e.totalHours, 0);
              const siteTotalLowRateHours = employees.reduce((s, e) => s + e.lowRateHours, 0);
              const siteTotalHighRateHours = employees.reduce((s, e) => s + e.highRateHours, 0);
              const siteTotalSalary = employees.reduce((s, e) => s + e.salary, 0);
              const siteTotalDeduction = employees.reduce((s, e) => s + e.deduction, 0);
              const siteTotalAdvance = employees.reduce((s, e) => s + e.advance, 0);
              const siteTotalBalance = employees.reduce((s, e) => s + e.totalSalary, 0);
              const sitePaidCount = employees.filter((e) => e.isPaid).length;

              return (
                <div key={site.id} className="mb-1">
                  {/* Site Header Row */}
                  <div className="bg-emerald-600/20 border border-emerald-500/30 rounded-t-lg px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-emerald-300">{site.name}</span>
                      {site.clientName && (
                        <span className="text-xs text-slate-400">({site.clientName})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-slate-400">
                        Employees: <span className="text-white font-semibold">{employees.length}</span>
                      </span>
                      <span className="text-slate-400">
                        Hours: <span className="text-white font-semibold">{formatHours(siteTotalHours)}</span>
                      </span>
                      <span className="text-slate-400">
                        Paid: <span className="text-emerald-400 font-semibold">{sitePaidCount}/{employees.length}</span>
                      </span>
                      <span className="text-emerald-400 font-semibold">
                        {formatNumber(siteTotalSalary)} DHS
                      </span>
                    </div>
                  </div>

                  {/* Salary Table */}
                  <div className="overflow-x-auto border border-t-0 border-slate-700/50 rounded-b-lg">
                    <table className="w-full border-collapse min-w-[1300px]">
                      <thead>
                        <tr className="bg-slate-800/90 border-b border-slate-700/50">
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-center whitespace-nowrap" style={{width: '40px'}}>SL</th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-left whitespace-nowrap" style={{minWidth: '130px'}}>NAME</th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-left whitespace-nowrap" style={{minWidth: '80px'}}>EMP CODE</th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-left whitespace-nowrap" style={{minWidth: '100px'}}>TRADE</th>
                          <th className="text-slate-300 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap" style={{minWidth: '80px'}}>TOTAL HRS</th>
                          <th className="text-cyan-400 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap bg-cyan-900/10" style={{minWidth: '90px'}}>
                            RATE 2.5/3 HRS
                          </th>
                          <th className="text-amber-400 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap bg-amber-900/10" style={{minWidth: '95px'}}>
                            RATE 5/5.5 HRS
                          </th>
                          <th className="text-emerald-400 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap bg-emerald-900/10" style={{minWidth: '100px'}}>
                            SALARY (DHS)
                          </th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap" style={{minWidth: '90px'}}>ADVANCE</th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap" style={{minWidth: '90px'}}>DEDUCTION</th>
                          <th className="text-slate-300 font-semibold text-[11px] py-2.5 px-2 text-right whitespace-nowrap" style={{minWidth: '110px'}}>TOTAL SALARY</th>
                          <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2 text-center whitespace-nowrap" style={{width: '70px'}}>STATUS</th>
                          {editMode && <th className="text-slate-400 font-semibold text-[11px] py-2.5 px-2" style={{width: '36px'}}></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {employees.length === 0 ? (
                          <tr>
                            <td colSpan={editMode ? 13 : 12} className="text-center text-slate-500 py-6 text-xs">
                              No employees for this site.
                            </td>
                          </tr>
                        ) : (
                          employees.map((emp, index) => {
                            const highlighted = isRowHighlighted(emp);
                            return (
                              <tr
                                key={`${emp.empId}-${index}`}
                                className={cn(
                                  'border-b border-slate-700/30 transition-colors',
                                  highlighted && 'bg-yellow-500/15 ring-1 ring-yellow-500/30',
                                  !highlighted && emp.isPaid && 'bg-emerald-500/5',
                                  !highlighted && !emp.isPaid && emp.rateTier === 'split' && 'bg-amber-500/5',
                                  editMode && !highlighted && 'hover:bg-slate-700/20',
                                )}
                              >
                                {/* SL */}
                                <td className="text-slate-500 text-[11px] text-center font-mono py-1.5 px-2">
                                  {emp.slNo}
                                </td>

                                {/* NAME */}
                                <td className="py-1.5 px-2">
                                  {editMode ? (
                                    <Input
                                      value={emp.empName}
                                      onChange={(e) => handleCellChange(site.id, index, 'empName', e.target.value)}
                                      className="h-7 text-xs bg-slate-900/80 border-slate-600/50 text-white w-full py-0 px-1.5"
                                    />
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <span className={cn('text-[11px] font-medium', highlighted ? 'text-yellow-300' : 'text-white')}>
                                        {emp.empName || '-'}
                                      </span>
                                      {emp.isSupervisor && (
                                        <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/20 text-[9px] gap-0.5 px-1 py-0 ml-0.5">
                                          <ShieldAlert className="h-2.5 w-2.5" />SUP
                                        </Badge>
                                      )}
                                      {emp.isTeamLeader && !emp.isSupervisor && (
                                        <Badge className="bg-sky-500/10 text-sky-400 border-sky-500/20 text-[9px] gap-0.5 px-1 py-0 ml-0.5">
                                          <ShieldCheck className="h-2.5 w-2.5" />TL
                                        </Badge>
                                      )}
                                      {emp.isCustomRate && (
                                        <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20 text-[9px] px-1 py-0 ml-0.5">
                                          CR
                                        </Badge>
                                      )}
                                    </div>
                                  )}
                                </td>

                                {/* EMP CODE */}
                                <td className="py-1.5 px-2">
                                  {editMode ? (
                                    <Input
                                      value={emp.employeeCode}
                                      onChange={(e) => handleCellChange(site.id, index, 'employeeCode', e.target.value)}
                                      className="h-7 text-xs bg-slate-900/80 border-slate-600/50 text-white w-full py-0 px-1.5 font-mono"
                                    />
                                  ) : (
                                    <span className="text-[11px] text-slate-300 font-mono">{emp.employeeCode || '-'}</span>
                                  )}
                                </td>

                                {/* TRADE */}
                                <td className="py-1.5 px-2">
                                  {editMode ? (
                                    <Input
                                      value={emp.trade}
                                      onChange={(e) => handleCellChange(site.id, index, 'trade', e.target.value)}
                                      className="h-7 text-xs bg-slate-900/80 border-slate-600/50 text-white w-full py-0 px-1.5"
                                    />
                                  ) : (
                                    <span className="text-[11px] text-slate-300">
                                      {emp.trade}
                                      {emp.isSupervisor && '/SUP'}
                                      {emp.isTeamLeader && !emp.isSupervisor && '/TL'}
                                    </span>
                                  )}
                                </td>

                                {/* TOTAL HRS */}
                                <td className="py-1.5 px-2 text-right">
                                  {editMode ? (
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.5"
                                      value={emp.totalHours || ''}
                                      onChange={(e) => handleCellChange(site.id, index, 'totalHours', parseFloat(e.target.value) || 0)}
                                      className="h-7 text-xs bg-slate-900/80 border-slate-600/50 text-white w-20 py-0 px-1.5 text-right ml-auto"
                                    />
                                  ) : (
                                    <span className="text-[11px] text-white font-medium">{formatHours(emp.totalHours)}</span>
                                  )}
                                </td>

                                {/* RATE 2.5/3 HRS - Low rate hours */}
                                <td className="py-1.5 px-2 text-right bg-cyan-900/5">
                                  {editMode ? (
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.5"
                                      value={emp.lowRateHours || ''}
                                      onChange={(e) => handleCellChange(site.id, index, 'lowRateHours', parseFloat(e.target.value) || 0)}
                                      className="h-7 text-xs bg-slate-900/80 border-cyan-500/30 text-cyan-300 w-20 py-0 px-1.5 text-right ml-auto"
                                    />
                                  ) : (
                                    <span className="text-[11px] text-cyan-400 font-medium">{formatHours(emp.lowRateHours)}</span>
                                  )}
                                </td>

                                {/* RATE 5/5.5 HRS - High rate hours */}
                                <td className="py-1.5 px-2 text-right bg-amber-900/5">
                                  {editMode ? (
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.5"
                                      value={emp.highRateHours || ''}
                                      onChange={(e) => handleCellChange(site.id, index, 'highRateHours', parseFloat(e.target.value) || 0)}
                                      className="h-7 text-xs bg-slate-900/80 border-amber-500/30 text-amber-300 w-20 py-0 px-1.5 text-right ml-auto"
                                    />
                                  ) : (
                                    <span className="text-[11px] text-amber-400 font-medium">{formatHours(emp.highRateHours)}</span>
                                  )}
                                </td>

                                {/* SALARY (DHS) - Divisor-based gross salary */}
                                <td className="py-1.5 px-2 text-right bg-emerald-900/5">
                                  <span className="text-[11px] text-emerald-400 font-semibold">
                                    {formatNumber(emp.salary)}
                                  </span>
                                </td>

                                {/* ADVANCE */}
                                <td className="py-1.5 px-2 text-right">
                                  {editMode ? (
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={emp.advance || ''}
                                      onChange={(e) => handleCellChange(site.id, index, 'advance', parseFloat(e.target.value) || 0)}
                                      className="h-7 text-xs bg-slate-900/80 border-slate-600/50 text-white w-20 py-0 px-1.5 text-right ml-auto"
                                    />
                                  ) : (
                                    <span className="text-[11px] text-amber-400">{formatNumber(emp.advance)}</span>
                                  )}
                                </td>

                                {/* DEDUCTION */}
                                <td className="py-1.5 px-2 text-right">
                                  {editMode ? (
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={emp.deduction || ''}
                                      onChange={(e) => handleCellChange(site.id, index, 'deduction', parseFloat(e.target.value) || 0)}
                                      className="h-7 text-xs bg-slate-900/80 border-slate-600/50 text-white w-20 py-0 px-1.5 text-right ml-auto"
                                    />
                                  ) : (
                                    <span className="text-[11px] text-red-400">{formatNumber(emp.deduction)}</span>
                                  )}
                                </td>

                                {/* TOTAL SALARY (Salary - Advance - Deduction) */}
                                <td className="py-1.5 px-2 text-right">
                                  <span className={cn(
                                    'text-[11px] font-semibold',
                                    emp.totalSalary >= 0 ? 'text-white' : 'text-red-400',
                                  )}>
                                    {formatNumber(emp.totalSalary)}
                                  </span>
                                </td>

                                {/* STATUS */}
                                <td className="py-1.5 px-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handlePaidToggle(site.id, index, emp.isPaid)}
                                    className="focus:outline-none"
                                    title={emp.isPaid ? 'Click to mark as unpaid' : 'Click to mark as paid'}
                                  >
                                    {emp.isPaid ? (
                                      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 text-[10px] gap-1 cursor-pointer">
                                        <CheckCircle2 className="h-3 w-3" />
                                        Paid
                                      </Badge>
                                    ) : (
                                      <Badge className="bg-slate-600/20 text-slate-400 border-slate-600/30 hover:bg-slate-600/30 text-[10px] gap-1 cursor-pointer">
                                        <XCircle className="h-3 w-3" />
                                        Unpaid
                                      </Badge>
                                    )}
                                  </button>
                                </td>

                                {/* Delete button (edit mode only) */}
                                {editMode && (
                                  <td className="py-1.5 px-2 text-center">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-slate-500 hover:text-red-400"
                                      onClick={() => handleDeleteRow(site.id, index)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </td>
                                )}
                              </tr>
                            );
                          })
                        )}

                        {/* Site Totals Row */}
                        {employees.length > 0 && (
                          <tr className="bg-slate-800/60 border-t border-slate-600/50">
                            <td colSpan={4} className="text-right text-[11px] font-bold text-slate-300 py-2 px-2 pr-4">
                              Site Total
                            </td>
                            <td className="text-right text-[11px] font-bold text-white py-2 px-2">
                              {formatHours(siteTotalHours)}
                            </td>
                            <td className="text-right text-[11px] font-bold text-cyan-400 py-2 px-2 bg-cyan-900/5">
                              {formatHours(siteTotalLowRateHours)}
                            </td>
                            <td className="text-right text-[11px] font-bold text-amber-400 py-2 px-2 bg-amber-900/5">
                              {formatHours(siteTotalHighRateHours)}
                            </td>
                            <td className="text-right text-[11px] font-bold text-emerald-400 py-2 px-2 bg-emerald-900/5">
                              {formatNumber(siteTotalSalary)}
                            </td>
                            <td className="text-right text-[11px] font-bold text-amber-400 py-2 px-2">
                              {formatNumber(siteTotalAdvance)}
                            </td>
                            <td className="text-right text-[11px] font-bold text-red-400 py-2 px-2">
                              {formatNumber(siteTotalDeduction)}
                            </td>
                            <td className={cn(
                              'text-right text-[11px] font-bold py-2 px-2',
                              siteTotalBalance >= 0 ? 'text-white' : 'text-red-400',
                            )}>
                              {formatNumber(siteTotalBalance)}
                            </td>
                            <td colSpan={editMode ? 2 : 1} />
                          </tr>
                        )}
                      </tbody>
                    </table>

                    {/* Add Row Button (edit mode only) */}
                    {editMode && (
                      <div className="border-t border-slate-700/30 px-4 py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAddRow(site.id)}
                          className="text-xs text-slate-400 hover:text-emerald-400 gap-1"
                        >
                          + Add Employee
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Formula Reference */}
            {!loading && sites.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3 text-[10px] text-slate-500">
                <span className="bg-slate-800/50 px-2 py-1 rounded border border-slate-700/30">
                  Standard: (below_hrs &times; 2.5)/1.0 + (above_hrs &times; 5.0)/1.0
                </span>
                <span className="bg-slate-800/50 px-2 py-1 rounded border border-slate-700/30">
                  TL/Supervisor: (below_hrs &times; 2.5)/3.0 + (above_hrs &times; 5.0)/5.5
                </span>
                <span className="bg-violet-900/20 px-2 py-1 rounded border border-violet-700/30 text-violet-400">
                  CR = Custom Rate override (all hours at custom rate)
                </span>
                <span className="bg-emerald-900/20 px-2 py-1 rounded border border-emerald-700/30 text-emerald-400">
                  Total Salary = Salary - Advance - Deduction
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
