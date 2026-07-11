'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Clock,
  Crown,
  ShieldCheck,
  User,
  Loader2,
  Save,
  X,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  DollarSign,
  Sparkles,
  Calendar,
  Pencil,
  TableProperties,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

// ─── Types ───────────────────────────────────────────────────────────────

interface EmployeeHoursLedgerProps {
  employeeId: string;
  onBack?: () => void;
}

/** Shape of each workLog entry returned by GET /api/employees/[id]/worklogs */
interface WorkLogEntry {
  logId: number | null;
  employeeId: string;
  siteId: string;
  siteName: string;
  year: number;
  month: number;
  monthKey: string;          // "YYYY-MM"
  hoursWorked: number;
  allowances: number;
  deductions: number;
  cumulativeBefore: number;
  cumulativeAfter: number;
  lowRate: number;
  highRate: number;
  isCustom: boolean;
  belowHours: number;
  aboveHours: number;
  belowSalary: number;
  aboveSalary: number;
  totalSalary: number;
  blendedRate: number;
  deduction: number;
  advance: number;
  balanceSalary: number;
  isPaid: boolean;
  standardRecordId: string | null;
  premiumRecordId: string | null;
  createdAt: string;
  updatedAt: string;
  isSynthetic?: boolean;    // true if entry is from SalaryRecord fallback, not a real WorkLog
}

/** employeeInfo returned alongside workLogs */
interface EmployeeInfo {
  id: string;
  fullName: string;
  employeeId: string;
  role: string;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  customHourlyRate: number | null;
  hoursThreshold: number;
  nationality: string | null;
  trade: string | null;
  lowRate: number;
  highRate: number;
  isCustom: boolean;
  totalWorkingHours: number;
  currentTier: 'standard' | 'premium';
}

interface EmployeeDetails {
  id: string;
  fullName: string;
  employeeId: string;
  nationality: string | null;
  trade: string | null;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  customHourlyRate: number | null;
  currentSite: string | null;
  currentSiteId: string | null;
  companyName: string | null;
}

// ─── Month name helper ──────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  const monthIndex = parseInt(month, 10) - 1;
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

function formatMonthShort(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  const monthIndex = parseInt(month, 10) - 1;
  return `${MONTH_NAMES[monthIndex].slice(0, 3)} ${year}`;
}

function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED`;
}

// ─── Rate color helper (direct rates — NO divisors) ─────────────────────

function getRateColor(rate: number, isCustomRate: boolean): 'emerald' | 'green' | 'violet' {
  if (isCustomRate) return 'violet';

  // Direct rate comparison: 2.5 or 3.0 = below threshold (emerald)
  if (Math.abs(rate - 2.5) < 0.01 || Math.abs(rate - 3.0) < 0.01) return 'emerald';

  // Direct rate comparison: 5.0 or 5.5 = above threshold (green)
  if (Math.abs(rate - 5.0) < 0.01 || Math.abs(rate - 5.5) < 0.01) return 'green';

  return 'violet';
}

// ─── Rate badge style helper ────────────────────────────────────────────

function getRateBadgeClasses(color: 'emerald' | 'green' | 'violet'): string {
  switch (color) {
    case 'emerald':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25';
    case 'green':
      return 'bg-green-500/15 text-green-400 border-green-500/25';
    case 'violet':
      return 'bg-violet-500/15 text-violet-400 border-violet-500/25';
  }
}

function getRateTextClasses(color: 'emerald' | 'green' | 'violet'): string {
  switch (color) {
    case 'emerald':
      return 'text-emerald-400';
    case 'green':
      return 'text-green-400';
    case 'violet':
      return 'text-violet-400';
  }
}

// ─── Editable row state ─────────────────────────────────────────────────

interface EditableRow {
  monthKey: string;
  siteId: string;
  year: number;
  month: number;
  totalHours: string;
  // Original for change detection
  originalTotalHours: string;
}

// ─── Main Component ─────────────────────────────────────────────────────

export function EmployeeHoursLedger({ employeeId, onBack }: EmployeeHoursLedgerProps) {
  const { toast } = useToast();

  // ── State ──
  const [employeeDetails, setEmployeeDetails] = useState<EmployeeDetails | null>(null);
  const [employeeInfo, setEmployeeInfo] = useState<EmployeeInfo | null>(null);
  const [workLogs, setWorkLogs] = useState<WorkLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [customRateInput, setCustomRateInput] = useState('');
  const [isSavingRate, setIsSavingRate] = useState(false);
  const [isEditingRate, setIsEditingRate] = useState(false);

  // ── Edit mode state ──
  const [isEditMode, setIsEditMode] = useState(false);
  const [editableRows, setEditableRows] = useState<EditableRow[]>([]);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [changedMonths, setChangedMonths] = useState<Set<string>>(new Set());

  // ── Paid-month confirmation state ──
  const [paidMonthDialog, setPaidMonthDialog] = useState<{
    open: boolean;
    monthKeys: string[];
  }>({ open: false, monthKeys: [] });

  // ── Fetch employee details ──
  const fetchEmployeeDetails = useCallback(async () => {
    try {
      const res = await fetch(`/api/employees/${employeeId}`);
      const json = await res.json();
      if (json.success) {
        const emp = json.data.employee;
        setEmployeeDetails({
          id: emp.id,
          fullName: emp.fullName,
          employeeId: emp.employeeId,
          nationality: emp.nationality,
          trade: emp.trade || emp.position,
          isTeamLeader: emp.isTeamLeader,
          isSupervisor: emp.isSupervisor,
          customHourlyRate: emp.customHourlyRate,
          currentSite: emp.currentSite,
          currentSiteId: emp.currentSiteId,
          companyName: emp.companyName,
        });
        if (emp.customHourlyRate != null) {
          setCustomRateInput(String(emp.customHourlyRate));
        }
      }
    } catch {
      // silent
    }
  }, [employeeId]);

  // ── Fetch workLog data ──
  const fetchWorkLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}/worklogs?year=${selectedYear}`);
      const json = await res.json();
      if (json.success) {
        setWorkLogs(json.data.workLogs);
        setEmployeeInfo(json.data.employeeInfo);
        if (json.data.employeeInfo.customHourlyRate != null) {
          setCustomRateInput(String(json.data.employeeInfo.customHourlyRate));
        } else {
          setCustomRateInput('');
        }
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to load work logs', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch work logs', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [employeeId, selectedYear, toast]);

  // ── Effects ──
  useEffect(() => {
    fetchEmployeeDetails();
  }, [fetchEmployeeDetails]);

  useEffect(() => {
    fetchWorkLogs();
  }, [fetchWorkLogs]);

  // ── Available years ──
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let y = currentYear + 1; y >= currentYear - 5; y--) {
      years.push(y);
    }
    return years;
  }, []);

  // ── Build a full 12-month grid for the selected year ──
  const monthlyGrid = useMemo(() => {
    const grid: Array<WorkLogEntry & { hasData: boolean }> = [];
    for (let m = 1; m <= 12; m++) {
      const monthKey = `${selectedYear}-${String(m).padStart(2, '0')}`;
      const existing = workLogs.find((w) => w.monthKey === monthKey);
      if (existing) {
        grid.push({ ...existing, hasData: true });
      } else {
        // Placeholder row for months with no data
        grid.push({
          logId: 0,
          employeeId,
          siteId: employeeDetails?.currentSiteId || '',
          siteName: '',
          year: selectedYear,
          month: m,
          monthKey,
          hoursWorked: 0,
          allowances: 0,
          deductions: 0,
          cumulativeBefore: 0,
          cumulativeAfter: 0,
          lowRate: employeeInfo?.lowRate ?? 2.5,
          highRate: employeeInfo?.highRate ?? 5.0,
          isCustom: employeeInfo?.isCustom ?? false,
          belowHours: 0,
          aboveHours: 0,
          belowSalary: 0,
          aboveSalary: 0,
          totalSalary: 0,
          blendedRate: 0,
          deduction: 0,
          advance: 0,
          balanceSalary: 0,
          isPaid: false,
          standardRecordId: null,
          premiumRecordId: null,
          createdAt: '',
          updatedAt: '',
          hasData: false,
        });
      }
    }
    return grid;
  }, [workLogs, selectedYear, employeeId, employeeDetails, employeeInfo]);

  // ── Threshold crossing detection ──
  const thresholdCrossMonth = useMemo(() => {
    if (!employeeInfo) return null;
    const threshold = employeeInfo.hoursThreshold;
    for (const row of monthlyGrid) {
      if (row.hasData && row.hoursWorked > 0) {
        if (row.cumulativeBefore < threshold && row.cumulativeAfter >= threshold) {
          return row.monthKey;
        }
      }
    }
    return null;
  }, [monthlyGrid, employeeInfo]);

  // ── Milestone progress ──
  const milestoneProgress = useMemo(() => {
    if (!employeeInfo) return { percent: 0, hoursWorked: 0, threshold: 1000, remaining: 1000, crossed: false };
    const threshold = employeeInfo.hoursThreshold;
    const hoursWorked = employeeInfo.totalWorkingHours;
    const percent = Math.min((hoursWorked / threshold) * 100, 100);
    const remaining = Math.max(threshold - hoursWorked, 0);
    const crossed = hoursWorked >= threshold;
    return { percent, hoursWorked, threshold, remaining, crossed };
  }, [employeeInfo]);

  // ── Progress color ──
  const progressColor = useMemo(() => {
    if (milestoneProgress.crossed) return 'red';
    if (milestoneProgress.percent >= 80) return 'amber';
    return 'green';
  }, [milestoneProgress]);

  // ── Yearly totals ──
  const yearlyTotals = useMemo(() => {
    const totalHours = workLogs.reduce((sum, w) => sum + w.hoursWorked, 0);
    const totalSalary = workLogs.reduce((sum, w) => sum + w.totalSalary, 0);
    return { totalHours, totalSalary };
  }, [workLogs]);

  // ── Edit mode handlers ──
  const enterEditMode = useCallback(() => {
    const rows: EditableRow[] = monthlyGrid.map((row) => ({
      monthKey: row.monthKey,
      siteId: row.siteId,
      year: row.year,
      month: row.month,
      totalHours: row.hoursWorked > 0 ? String(row.hoursWorked) : '',
      originalTotalHours: row.hoursWorked > 0 ? String(row.hoursWorked) : '',
    }));
    setEditableRows(rows);
    setChangedMonths(new Set());
    setIsEditMode(true);
  }, [monthlyGrid]);

  const cancelEditMode = useCallback(() => {
    setIsEditMode(false);
    setEditableRows([]);
    setChangedMonths(new Set());
  }, []);

  const updateEditableRow = useCallback((monthKey: string, value: string) => {
    setEditableRows((prev) =>
      prev.map((row) => {
        if (row.monthKey !== monthKey) return row;
        const updated = { ...row, totalHours: value };
        const hasChanged = updated.totalHours !== updated.originalTotalHours;
        setChangedMonths((prevSet) => {
          const newSet = new Set(prevSet);
          if (hasChanged) {
            newSet.add(monthKey);
          } else {
            newSet.delete(monthKey);
          }
          return newSet;
        });
        return updated;
      })
    );
  }, []);

  // ── Save with paid-month check ──
  const doSave = useCallback(async (force: boolean = false) => {
    setIsSavingEdits(true);
    try {
      const changedRows = editableRows.filter((r) => changedMonths.has(r.monthKey));
      const entries = changedRows.map((row) => ({
        siteId: row.siteId || employeeDetails?.currentSiteId || '',
        year: row.year,
        month: row.month,
        hoursWorked: row.totalHours ? parseFloat(row.totalHours) : 0,
      }));

      if (entries.length === 0) {
        setIsSavingEdits(false);
        return;
      }

      const res = await fetch(`/api/employees/${employeeId}/worklogs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries, force }),
      });
      const json = await res.json();

      if (!json.success && json.isPaidWarning) {
        // Show paid-month confirmation dialog
        setPaidMonthDialog({ open: true, monthKeys: [json.month] });
        setIsSavingEdits(false);
        return;
      }

      if (json.success) {
        toast({
          title: 'Changes Saved',
          description: `Updated ${json.data.updated || entries.length} month(s). Recalculation complete.`,
        });
        setIsEditMode(false);
        setEditableRows([]);
        setChangedMonths(new Set());
        await fetchWorkLogs();
        await fetchEmployeeDetails();
      } else {
        toast({
          title: 'Error',
          description: json.error || 'Failed to save changes',
          variant: 'destructive',
        });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save changes', variant: 'destructive' });
    } finally {
      setIsSavingEdits(false);
    }
  }, [editableRows, changedMonths, employeeId, employeeDetails, toast, fetchWorkLogs, fetchEmployeeDetails]);

  const saveEdits = useCallback(async () => {
    await doSave(false);
  }, [doSave]);

  const handleForceSave = useCallback(async () => {
    setPaidMonthDialog({ open: false, monthKeys: [] });
    await doSave(true);
  }, [doSave]);

  // ── Custom Rate Save ──
  const handleSaveCustomRate = async () => {
    const rateValue = customRateInput.trim();
    const numericRate = rateValue ? parseFloat(rateValue) : null;

    if (numericRate !== null && (isNaN(numericRate) || numericRate <= 0)) {
      toast({ title: 'Invalid Rate', description: 'Please enter a valid positive number.', variant: 'destructive' });
      return;
    }

    setIsSavingRate(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customHourlyRate: numericRate }),
      });
      const json = await res.json();
      if (json.success) {
        toast({
          title: numericRate ? 'Custom Rate Set' : 'Custom Rate Cleared',
          description: numericRate
            ? `Custom rate set to ${numericRate} AED/hr`
            : 'Custom rate removed. Standard tier rates will apply.',
        });
        setIsEditingRate(false);
        await fetchWorkLogs();
        await fetchEmployeeDetails();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to update rate', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save custom rate', variant: 'destructive' });
    } finally {
      setIsSavingRate(false);
    }
  };

  const handleClearCustomRate = async () => {
    setIsSavingRate(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customHourlyRate: null }),
      });
      const json = await res.json();
      if (json.success) {
        toast({ title: 'Custom Rate Cleared', description: 'Standard tier rates will now apply.' });
        setCustomRateInput('');
        setIsEditingRate(false);
        await fetchWorkLogs();
        await fetchEmployeeDetails();
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to clear rate', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to clear custom rate', variant: 'destructive' });
    } finally {
      setIsSavingRate(false);
    }
  };

  // ── Role badge ──
  const roleBadge = useMemo(() => {
    if (!employeeInfo) return null;
    if (employeeInfo.isSupervisor) {
      return (
        <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/25 hover:bg-violet-500/20 gap-1">
          <ShieldCheck className="h-3 w-3" /> Supervisor
        </Badge>
      );
    }
    if (employeeInfo.isTeamLeader) {
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/20 gap-1">
          <Crown className="h-3 w-3" /> Team Leader
        </Badge>
      );
    }
    return (
      <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/25 hover:bg-slate-500/20 gap-1">
        <User className="h-3 w-3" /> Standard
      </Badge>
    );
  }, [employeeInfo]);

  // ── Compute the direct rate to display for a row ──
  const getDirectRate = useCallback((row: WorkLogEntry): number => {
    if (row.isCustom && employeeInfo?.customHourlyRate != null) {
      return employeeInfo.customHourlyRate;
    }
    // For split months, use blended rate but display the primary rate for context
    // Show lowRate if there are belowHours, highRate if only aboveHours
    if (row.belowHours > 0 && row.aboveHours > 0) return row.blendedRate;
    if (row.aboveHours > 0) return row.highRate;
    return row.lowRate;
  }, [employeeInfo]);

  // ── Loading state ──
  if (isLoading && !employeeInfo) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-lg bg-slate-700" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48 bg-slate-700" />
            <Skeleton className="h-4 w-32 bg-slate-700" />
          </div>
        </div>
        <Skeleton className="h-32 w-full rounded-xl bg-slate-700" />
        <Skeleton className="h-96 w-full rounded-xl bg-slate-700" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Paid-Month Confirmation Dialog ──────────────────────── */}
      <AlertDialog open={paidMonthDialog.open} onOpenChange={(open) => setPaidMonthDialog({ open, monthKeys: [] })}>
        <AlertDialogContent className="bg-slate-900 border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              Paid Month Warning
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              One or more of the months you are editing ({paidMonthDialog.monthKeys.join(', ')}) have already been marked as <span className="text-amber-400 font-medium">paid</span>. 
              Editing paid months may affect already-processed salary records. Do you want to force the update?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-600 text-slate-300 hover:bg-slate-800">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForceSave}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Force Update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Header ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="shrink-0 text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h1 className="text-xl sm:text-2xl font-bold text-white truncate">
              {employeeDetails?.fullName || employeeInfo?.fullName || 'Employee'} Hours Ledger
            </h1>
            {roleBadge}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-slate-300">{employeeDetails?.employeeId || employeeId}</span>
            </span>
            {(employeeDetails?.trade || employeeInfo?.trade) && (
              <span className="flex items-center gap-1.5">
                <span>{employeeDetails?.trade || employeeInfo?.trade}</span>
              </span>
            )}
            {(employeeDetails?.nationality || employeeInfo?.nationality) && (
              <span>{employeeDetails?.nationality || employeeInfo?.nationality}</span>
            )}
            {employeeInfo && (
              <span className="flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5" />
                <span>
                  {employeeInfo.isCustom && employeeInfo.customHourlyRate != null
                    ? `${employeeInfo.customHourlyRate} AED/hr (Custom)`
                    : `${employeeInfo.lowRate} / ${employeeInfo.highRate} AED/hr`}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ─── Milestone Progress Gauge ──────────────────────────── */}
      {employeeInfo && (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Hours Milestone Progress
                  </h3>
                  <span className="text-xs text-slate-500">
                    Threshold: {milestoneProgress.threshold}h
                  </span>
                </div>

                <div className="relative h-4 bg-slate-700/50 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      progressColor === 'red'
                        ? 'bg-red-500'
                        : progressColor === 'amber'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${milestoneProgress.percent}%` }}
                  />
                  {/* Threshold marker */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white/30"
                    style={{ left: '100%' }}
                  />
                </div>

                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-slate-400">
                    {milestoneProgress.hoursWorked.toLocaleString()}h worked
                  </span>
                  {milestoneProgress.crossed ? (
                    <span className="text-xs font-medium text-red-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Threshold crossed by {(milestoneProgress.hoursWorked - milestoneProgress.threshold).toLocaleString()}h
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">
                      {milestoneProgress.remaining.toLocaleString()}h remaining
                    </span>
                  )}
                </div>
              </div>

              {/* Quick stats */}
              <div className="flex sm:flex-col gap-3 sm:gap-2 sm:pl-6 sm:border-l sm:border-slate-700/50">
                <div className="text-center">
                  <p className="text-lg font-bold text-white">{milestoneProgress.hoursWorked.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">Total Hours</p>
                </div>
                <div className="text-center">
                  <p className={`text-lg font-bold ${
                    milestoneProgress.crossed ? 'text-red-400' : 'text-emerald-400'
                  }`}>
                    {milestoneProgress.crossed ? 'Premium' : 'Standard'}
                  </p>
                  <p className="text-xs text-slate-500">Current Tier</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Year Selector + Custom Rate + Edit Button ─────────── */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-slate-400" />
          <Select
            value={String(selectedYear)}
            onValueChange={(val) => {
              if (!isEditMode) setSelectedYear(parseInt(val, 10));
            }}
            disabled={isEditMode}
          >
            <SelectTrigger className="w-[140px] bg-slate-800 border-slate-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              {availableYears.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Custom Rate Configuration */}
          <Card className="bg-slate-800/50 border-slate-700/50 w-full sm:w-auto">
            <CardContent className="p-3">
              <div className="flex items-center gap-3 flex-wrap">
                <Sparkles className="h-4 w-4 text-violet-400 shrink-0" />
                <span className="text-sm text-slate-300 whitespace-nowrap">Custom Rate:</span>

                {employeeInfo?.customHourlyRate != null && !isEditingRate && (
                  <>
                    <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/25">
                      {employeeInfo.customHourlyRate} AED/hr
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsEditingRate(true)}
                      className="h-7 text-xs text-slate-400 hover:text-white"
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearCustomRate}
                      disabled={isSavingRate}
                      className="h-7 text-xs text-red-400 hover:text-red-300"
                    >
                      {isSavingRate ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Clear'}
                    </Button>
                  </>
                )}

                {(employeeInfo?.customHourlyRate == null || isEditingRate) && (
                  <>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.5"
                        min="0"
                        placeholder="e.g. 4.0"
                        value={customRateInput}
                        onChange={(e) => setCustomRateInput(e.target.value)}
                        className="w-24 h-8 text-sm bg-slate-900 border-slate-600"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveCustomRate();
                          if (e.key === 'Escape') {
                            setIsEditingRate(false);
                            setCustomRateInput(employeeInfo?.customHourlyRate != null ? String(employeeInfo.customHourlyRate) : '');
                          }
                        }}
                      />
                      <span className="text-xs text-slate-500">AED/hr</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleSaveCustomRate}
                      disabled={isSavingRate}
                      className="h-8 text-xs bg-violet-600 hover:bg-violet-700"
                    >
                      {isSavingRate ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                      Save
                    </Button>
                    {isEditingRate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsEditingRate(false);
                          setCustomRateInput(employeeInfo?.customHourlyRate != null ? String(employeeInfo.customHourlyRate) : '');
                        }}
                        className="h-8 text-xs text-slate-400"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Prominent Edit/Save/Cancel Buttons ── */}
          {!isEditMode ? (
            <Button
              onClick={enterEditMode}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-lg shadow-emerald-900/30"
              size="default"
            >
              <Pencil className="h-4 w-4" />
              Edit Ledger
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                onClick={saveEdits}
                disabled={isSavingEdits || changedMonths.size === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-lg shadow-emerald-900/30"
              >
                {isSavingEdits ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save{changedMonths.size > 0 ? ` (${changedMonths.size})` : ''}
              </Button>
              <Button
                variant="outline"
                onClick={cancelEditMode}
                disabled={isSavingEdits}
                className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-2"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Edit Mode Banner ──────────────────────────────────── */}
      {isEditMode && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25">
          <TableProperties className="h-5 w-5 text-amber-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-300">Edit Mode Active</p>
            <p className="text-xs text-amber-400/70">
              Edit Total Hours for any month. Rates are computed automatically. Changed rows are highlighted. Save to apply &amp; trigger recalculation.
            </p>
          </div>
          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
            {changedMonths.size} change{changedMonths.size !== 1 ? 's' : ''}
          </Badge>
        </div>
      )}

      {/* ─── Historical Data Table ─────────────────────────────── */}
      <Card className="bg-slate-800/50 border-slate-700/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base font-medium text-white flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-400" />
              Monthly Hours Breakdown — {selectedYear}
            </CardTitle>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>Year Total: <span className="text-white font-medium">{yearlyTotals.totalHours.toLocaleString()}h</span></span>
              <span>Est. Salary: <span className="text-white font-medium">{formatCurrency(yearlyTotals.totalSalary)}</span></span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className={isEditMode ? 'border-collapse' : ''}>
              <TableHeader>
                <TableRow className={`border-slate-700/50 hover:bg-transparent ${isEditMode ? 'bg-slate-800/80' : ''}`}>
                  <TableHead className={`text-slate-400 font-medium ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>Month</TableHead>
                  <TableHead className={`text-slate-400 font-medium text-right ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>Total Hours</TableHead>
                  <TableHead className={`text-slate-400 font-medium text-right ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>Cumulative Hrs</TableHead>
                  <TableHead className={`text-slate-400 font-medium text-right ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>Rate/Hr</TableHead>
                  <TableHead className={`text-slate-400 font-medium text-right ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>Below Threshold Hrs</TableHead>
                  <TableHead className={`text-slate-400 font-medium text-right ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>Above Threshold Hrs</TableHead>
                  <TableHead className={`text-slate-400 font-medium text-right ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>Est. Salary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlyGrid.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-slate-500">
                      No data available for {selectedYear}
                    </TableCell>
                  </TableRow>
                ) : isEditMode ? (
                  /* ── Edit Mode Rows ── */
                  editableRows.map((editRow) => {
                    const dataRow = monthlyGrid.find((r) => r.monthKey === editRow.monthKey);
                    const isThresholdRow = thresholdCrossMonth === editRow.monthKey;
                    const isChanged = changedMonths.has(editRow.monthKey);
                    const isPaid = dataRow?.isPaid ?? false;

                    return (
                      <TableRow
                        key={editRow.monthKey}
                        className={`border-slate-700/30 transition-colors ${
                          isChanged
                            ? 'bg-emerald-500/10 hover:bg-emerald-500/15'
                            : isThresholdRow
                            ? 'bg-red-500/10 hover:bg-red-500/15'
                            : 'hover:bg-slate-700/30'
                        }`}
                      >
                        <TableCell className={`font-medium text-white whitespace-nowrap py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          <div className="flex items-center gap-2">
                            {formatMonthShort(editRow.monthKey)}
                            {isThresholdRow && (
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0 h-5">
                                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                1000h
                              </Badge>
                            )}
                            {isPaid && (
                              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px] px-1.5 py-0 h-5">
                                Paid
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className={`text-right py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            value={editRow.totalHours}
                            onChange={(e) => updateEditableRow(editRow.monthKey, e.target.value)}
                            className="w-24 h-7 text-sm text-right font-mono bg-slate-900 border-slate-600 focus:border-emerald-500 focus:ring-emerald-500/20"
                            placeholder="0"
                          />
                        </TableCell>
                        <TableCell className={`text-right font-mono text-slate-500 py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          {dataRow && dataRow.cumulativeAfter > 0
                            ? dataRow.cumulativeAfter.toFixed(1)
                            : '—'}
                        </TableCell>
                        <TableCell className={`text-right py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          {dataRow && dataRow.hoursWorked > 0 ? (
                            <Badge className={`text-xs px-2 py-0.5 h-6 font-mono ${getRateBadgeClasses(getRateColor(getDirectRate(dataRow), dataRow.isCustom))}`}>
                              {getDirectRate(dataRow).toFixed(1)}
                            </Badge>
                          ) : (
                            <span className="text-slate-600 font-mono">—</span>
                          )}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-slate-400 py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          {dataRow && dataRow.belowHours > 0 ? dataRow.belowHours.toFixed(1) : '—'}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-slate-400 py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          {dataRow && dataRow.aboveHours > 0 ? dataRow.aboveHours.toFixed(1) : '—'}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-slate-400 py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          {dataRow && dataRow.totalSalary > 0 ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="text-[9px] text-slate-500 font-mono">
                                {dataRow.isCustom ? (
                                  `${dataRow.hoursWorked.toFixed(1)} × ${dataRow.lowRate.toFixed(1)}`
                                ) : dataRow.aboveHours > 0 && dataRow.belowHours > 0 ? (
                                  <>
                                    <span className="text-emerald-500">{dataRow.belowHours.toFixed(1)} × {dataRow.lowRate.toFixed(1)}</span>
                                    {' + '}
                                    <span className="text-amber-500">{dataRow.aboveHours.toFixed(1)} × {dataRow.highRate.toFixed(1)}</span>
                                  </>
                                ) : dataRow.aboveHours > 0 ? (
                                  `${dataRow.aboveHours.toFixed(1)} × ${dataRow.highRate.toFixed(1)}`
                                ) : (
                                  `${dataRow.belowHours.toFixed(1)} × ${dataRow.lowRate.toFixed(1)}`
                                )}
                              </span>
                              <span className="text-emerald-400">
                                = {formatCurrency(dataRow.totalSalary)}
                              </span>
                            </div>
                          ) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  /* ── View Mode Rows ── */
                  monthlyGrid.map((row) => {
                    const isThresholdRow = thresholdCrossMonth === row.monthKey;
                    const isCustomRate = row.isCustom;
                    const directRate = getDirectRate(row);
                    const rateColor = getRateColor(directRate, isCustomRate);

                    return (
                      <TableRow
                        key={row.monthKey}
                        className={`border-slate-700/30 ${
                          isThresholdRow
                            ? 'bg-red-500/10 hover:bg-red-500/15'
                            : row.hasData && row.hoursWorked > 0
                            ? 'hover:bg-slate-700/30'
                            : 'opacity-50'
                        }`}
                      >
                        <TableCell className="font-medium text-white whitespace-nowrap border-r border-slate-700/20">
                          <div className="flex items-center gap-2">
                            {formatMonthShort(row.monthKey)}
                            {isThresholdRow && (
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0 h-5">
                                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                1000h
                              </Badge>
                            )}
                            {row.isPaid && (
                              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px] px-1.5 py-0 h-5">
                                Paid
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-slate-200 border-r border-slate-700/20">
                          {row.hoursWorked > 0 ? row.hoursWorked.toFixed(1) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono border-r border-slate-700/20">
                          <span className={
                            row.cumulativeAfter >= (employeeInfo?.hoursThreshold || 1000)
                              ? 'text-red-400'
                              : 'text-slate-200'
                          }>
                            {row.cumulativeAfter > 0 ? row.cumulativeAfter.toFixed(1) : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right border-r border-slate-700/20">
                          {row.hoursWorked > 0 ? (
                            <Badge className={`text-xs px-2 py-0.5 h-6 font-mono ${getRateBadgeClasses(rateColor)}`}>
                              {directRate.toFixed(1)}
                            </Badge>
                          ) : (
                            <span className="text-slate-600 font-mono">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-slate-200 border-r border-slate-700/20">
                          {row.belowHours > 0 ? row.belowHours.toFixed(1) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-slate-200 border-r border-slate-700/20">
                          {row.aboveHours > 0 ? row.aboveHours.toFixed(1) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-slate-200">
                          {row.totalSalary > 0 ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="text-[9px] text-slate-500 font-mono">
                                {row.isCustom ? (
                                  `${row.hoursWorked.toFixed(1)} × ${row.lowRate.toFixed(1)}`
                                ) : row.aboveHours > 0 && row.belowHours > 0 ? (
                                  <>
                                    <span className="text-emerald-500">{row.belowHours.toFixed(1)} × {row.lowRate.toFixed(1)}</span>
                                    {' + '}
                                    <span className="text-amber-500">{row.aboveHours.toFixed(1)} × {row.highRate.toFixed(1)}</span>
                                  </>
                                ) : row.aboveHours > 0 ? (
                                  `${row.aboveHours.toFixed(1)} × ${row.highRate.toFixed(1)}`
                                ) : (
                                  `${row.belowHours.toFixed(1)} × ${row.lowRate.toFixed(1)}`
                                )}
                              </span>
                              <span className="text-emerald-400">
                                = {formatCurrency(row.totalSalary)}
                              </span>
                            </div>
                          ) : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}

                {/* ── Yearly Total Row ── */}
                {workLogs.length > 0 && (
                  <TableRow className="border-t-2 border-slate-600 bg-slate-800/80">
                    <TableCell className={`font-bold text-white ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                      Year Total
                    </TableCell>
                    <TableCell className={`text-right font-mono font-bold text-white ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                      {yearlyTotals.totalHours.toFixed(1)}
                    </TableCell>
                    <TableCell className={`text-right text-slate-400 ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                      —
                    </TableCell>
                    <TableCell className={`text-right text-slate-400 ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                      —
                    </TableCell>
                    <TableCell className={`text-right font-mono text-slate-400 ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                      {workLogs.reduce((s, w) => s + w.belowHours, 0).toFixed(1)}
                    </TableCell>
                    <TableCell className={`text-right font-mono text-slate-400 ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                      {workLogs.reduce((s, w) => s + w.aboveHours, 0).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-white">
                      {formatCurrency(yearlyTotals.totalSalary)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ─── Summary Cards ─────────────────────────────────────── */}
      {employeeInfo && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-white">{employeeInfo.totalWorkingHours.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-1">Total Lifetime Hours</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-white">
                {employeeInfo.isCustom && employeeInfo.customHourlyRate != null
                  ? `${employeeInfo.customHourlyRate}`
                  : `${employeeInfo.lowRate} / ${employeeInfo.highRate}`}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Rate (AED/hr)
                {employeeInfo.isCustom && (
                  <span className="text-violet-400 ml-1">Custom</span>
                )}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${milestoneProgress.crossed ? 'text-red-400' : 'text-emerald-400'}`}>
                {milestoneProgress.crossed ? 'Premium' : 'Standard'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Rate Tier ({employeeInfo.hoursThreshold}h threshold)
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
