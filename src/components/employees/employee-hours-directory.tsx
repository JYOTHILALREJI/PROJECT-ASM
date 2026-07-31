'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Clock,
  Search,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  Users,
  TrendingUp,
  AlertTriangle,
  ChevronRight,
  Crown,
  ShieldCheck,
  User,
  Pencil,
  Save,
  X,
  TableProperties,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useAppStore } from '@/store/app-store';
import { useToast } from '@/hooks/use-toast';

// ─── Types ───────────────────────────────────────────────────────────────

interface EmployeeHoursSummary {
  id: string;
  fullName: string;
  employeeId: string;
  currentSite: string | null;
  trade: string | null;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  customHourlyRate: number | null;
  cumulativeHours: number;
  hoursThreshold: number;
  effectiveRate: number;
  rateLabel: string;
  thresholdStatus: 'below' | 'above';
}

type SortField = 'employeeId' | 'fullName' | 'currentSite' | 'trade' | 'rate' | 'cumulativeHours' | 'thresholdStatus';
type SortDirection = 'asc' | 'desc';

// ─── Editable row state ─────────────────────────────────────────────────

interface EditableEmployeeRow {
  id: string;
  employeeId: string;
  fullName: string;
  currentSite: string;
  trade: string;
  customHourlyRate: string;
  cumulativeHours: string;
  hoursThreshold: string;
  // Original values for change detection
  originalEmployeeId: string;
  originalFullName: string;
  originalCurrentSite: string;
  originalTrade: string;
  originalCustomHourlyRate: string;
  originalCumulativeHours: string;
  originalHoursThreshold: string;
}

// ─── Helper ─────────────────────────────────────────────────────────────

function formatHours(hours: number): string {
  if (hours === 0) return '0h';
  return `${hours.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`;
}

// ─── Main Component ─────────────────────────────────────────────────────

export function EmployeeHoursDirectory() {
  const { setSelectedEmployeeId, setCurrentView } = useAppStore();
  const { toast } = useToast();

  // ── State ──
  const [employees, setEmployees] = useState<EmployeeHoursSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [rateFilter, setRateFilter] = useState<string>('all');
  const [thresholdFilter, setThresholdFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('fullName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // ── Edit mode state ──
  const [isEditMode, setIsEditMode] = useState(false);
  const [editableRows, setEditableRows] = useState<EditableEmployeeRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [changedRowIds, setChangedRowIds] = useState<Set<string>>(new Set());

  // ── Fetch data ──
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (rateFilter && rateFilter !== 'all') params.set('rate', rateFilter);
      if (thresholdFilter && thresholdFilter !== 'all') params.set('threshold', thresholdFilter);

      const res = await fetch(`/api/employees/hours-summary?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setEmployees(json.data.employees);
      }
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, [search, rateFilter, thresholdFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Sorting ──
  const sortedEmployees = useMemo(() => {
    const sorted = [...employees].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'employeeId':
          comparison = a.employeeId.localeCompare(b.employeeId);
          break;
        case 'fullName':
          comparison = a.fullName.localeCompare(b.fullName);
          break;
        case 'currentSite':
          comparison = (a.currentSite || '').localeCompare(b.currentSite || '');
          break;
        case 'trade':
          comparison = (a.trade || '').localeCompare(b.trade || '');
          break;
        case 'rate':
          comparison = a.effectiveRate - b.effectiveRate;
          break;
        case 'cumulativeHours':
          comparison = a.cumulativeHours - b.cumulativeHours;
          break;
        case 'thresholdStatus':
          comparison = a.thresholdStatus.localeCompare(b.thresholdStatus);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [employees, sortField, sortDirection]);

  // ── Sort handler ──
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // ── Employee click ──
  const handleEmployeeClick = (empId: string) => {
    if (isEditMode) return; // Don't navigate while editing
    setSelectedEmployeeId(empId);
    setCurrentView('employee_hours_ledger');
  };

  // ── Sort icon helper ──
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1 text-blue-400" />
      : <ArrowDown className="h-3 w-3 ml-1 text-blue-400" />;
  };

  // ── Summary stats ──
  const stats = useMemo(() => {
    const total = employees.length;
    const aboveThreshold = employees.filter(e => e.thresholdStatus === 'above').length;
    const belowThreshold = total - aboveThreshold;
    const customRate = employees.filter(e => e.customHourlyRate != null).length;
    const customThreshold = employees.filter(e => e.hoursThreshold !== 1000).length;
    const totalHours = employees.reduce((sum, e) => sum + e.cumulativeHours, 0);
    return { total, aboveThreshold, belowThreshold, customRate, customThreshold, totalHours };
  }, [employees]);

  // ── Edit mode handlers ──
  const enterEditMode = useCallback(() => {
    const rows: EditableEmployeeRow[] = sortedEmployees.map((emp) => ({
      id: emp.id,
      employeeId: emp.employeeId,
      fullName: emp.fullName,
      currentSite: emp.currentSite || '',
      trade: emp.trade || '',
      customHourlyRate: emp.customHourlyRate != null ? String(emp.customHourlyRate) : '',
      cumulativeHours: String(emp.cumulativeHours),
      hoursThreshold: String(emp.hoursThreshold),
      originalEmployeeId: emp.employeeId,
      originalFullName: emp.fullName,
      originalCurrentSite: emp.currentSite || '',
      originalTrade: emp.trade || '',
      originalCustomHourlyRate: emp.customHourlyRate != null ? String(emp.customHourlyRate) : '',
      originalCumulativeHours: String(emp.cumulativeHours),
      originalHoursThreshold: String(emp.hoursThreshold),
    }));
    setEditableRows(rows);
    setChangedRowIds(new Set());
    setIsEditMode(true);
  }, [sortedEmployees]);

  const cancelEditMode = useCallback(() => {
    setIsEditMode(false);
    setEditableRows([]);
    setChangedRowIds(new Set());
  }, []);

  const updateEditableRow = useCallback((id: string, field: keyof EditableEmployeeRow, value: string) => {
    setEditableRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, [field]: value };
        // Check if this row has changed from original
        const hasChanged =
          updated.employeeId !== updated.originalEmployeeId ||
          updated.fullName !== updated.originalFullName ||
          updated.currentSite !== updated.originalCurrentSite ||
          updated.trade !== updated.originalTrade ||
          updated.customHourlyRate !== updated.originalCustomHourlyRate ||
          updated.cumulativeHours !== updated.originalCumulativeHours ||
          updated.hoursThreshold !== updated.originalHoursThreshold;
        setChangedRowIds((prevSet) => {
          const newSet = new Set(prevSet);
          if (hasChanged) {
            newSet.add(id);
          } else {
            newSet.delete(id);
          }
          return newSet;
        });
        return updated;
      })
    );
  }, []);

  const saveEdits = useCallback(async () => {
    if (changedRowIds.size === 0) {
      toast({ title: 'No Changes', description: 'No changes to save.' });
      return;
    }

    setIsSaving(true);
    let successCount = 0;
    let errorCount = 0;

    for (const rowId of changedRowIds) {
      const row = editableRows.find((r) => r.id === rowId);
      if (!row) continue;

      const payload: Record<string, unknown> = {};

      if (row.employeeId !== row.originalEmployeeId) {
        payload.employeeId = row.employeeId;
      }
      if (row.fullName !== row.originalFullName) {
        payload.fullName = row.fullName;
      }
      if (row.currentSite !== row.originalCurrentSite) {
        payload.currentSite = row.currentSite || null;
      }
      if (row.trade !== row.originalTrade) {
        payload.trade = row.trade || null;
      }
      if (row.customHourlyRate !== row.originalCustomHourlyRate) {
        const rateVal = row.customHourlyRate.trim();
        payload.customHourlyRate = rateVal ? parseFloat(rateVal) : null;
      }
      // Note: cumulativeHours and hoursThreshold are typically computed/read-only
      // but we allow editing hoursThreshold as it affects rate calculations
      if (row.hoursThreshold !== row.originalHoursThreshold) {
        const thresholdVal = parseFloat(row.hoursThreshold);
        if (!isNaN(thresholdVal) && thresholdVal > 0) {
          payload.hoursThreshold = thresholdVal;
        }
      }

      if (Object.keys(payload).length === 0) continue;

      try {
        const res = await fetch(`/api/employees/${rowId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.success) {
          successCount++;
        } else {
          errorCount++;
          toast({
            title: `Error updating ${row.fullName}`,
            description: json.error || 'Unknown error',
            variant: 'destructive',
          });
        }
      } catch {
        errorCount++;
      }
    }

    setIsSaving(false);

    if (successCount > 0) {
      toast({
        title: 'Changes Saved',
        description: `Successfully updated ${successCount} employee${successCount !== 1 ? 's' : ''}.${errorCount > 0 ? ` ${errorCount} failed.` : ''}`,
      });
      setIsEditMode(false);
      setEditableRows([]);
      setChangedRowIds(new Set());
      await fetchData();
    } else if (errorCount > 0) {
      toast({
        title: 'Save Failed',
        description: `Failed to update ${errorCount} employee${errorCount !== 1 ? 's' : ''}.`,
        variant: 'destructive',
      });
    }
  }, [changedRowIds, editableRows, toast, fetchData]);

  // ── Compute effective rate from direct rate table (PRD v2.0) ──
  const getEffectiveRate = (emp: EmployeeHoursSummary): number => {
    if (emp.customHourlyRate != null) return emp.customHourlyRate;
    const hasBonus = emp.isTeamLeader || emp.isSupervisor;
    const lowRate = hasBonus ? 3.0 : 2.5;
    const highRate = hasBonus ? 5.5 : 5.0;
    return emp.thresholdStatus === 'above' ? highRate : lowRate;
  };

  // ── Rate badge ──
  const RateBadge = ({ emp }: { emp: EmployeeHoursSummary }) => {
    const rate = getEffectiveRate(emp);
    const display = emp.customHourlyRate != null
      ? `Custom (${emp.customHourlyRate})`
      : String(rate);

    // Color coding: 2.5/3.0 = emerald (below threshold), 5.0/5.5 = amber (above threshold), custom = violet
    let badgeClass: string;
    if (emp.customHourlyRate != null) {
      badgeClass = 'bg-violet-500/15 text-violet-400 border-violet-500/25';
    } else if (emp.thresholdStatus === 'above') {
      badgeClass = 'bg-amber-500/15 text-amber-400 border-amber-500/25';
    } else {
      badgeClass = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25';
    }

    return (
      <Badge className={`text-[10px] px-1.5 py-0 h-5 font-mono ${badgeClass}`}>
        {display}
      </Badge>
    );
  };

  // ── Role badge ──
  const RoleBadge = ({ emp }: { emp: EmployeeHoursSummary }) => {
    if (emp.isSupervisor) {
      return (
        <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20 text-[9px] px-1 py-0 h-4 gap-0.5">
          <ShieldCheck className="h-2.5 w-2.5" /> SUP
        </Badge>
      );
    }
    if (emp.isTeamLeader) {
      return (
        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[9px] px-1 py-0 h-4 gap-0.5">
          <Crown className="h-2.5 w-2.5" /> TL
        </Badge>
      );
    }
    return (
      <Badge className="bg-slate-500/10 text-slate-500 border-slate-500/20 text-[9px] px-1 py-0 h-4 gap-0.5">
        <User className="h-2.5 w-2.5" /> STD
      </Badge>
    );
  };

  // ── Get editable row data ──
  const getEditableRow = (empId: string): EditableEmployeeRow | undefined => {
    return editableRows.find((r) => r.id === empId);
  };

  // ── Loading state ──
  if (isLoading && employees.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg bg-slate-700" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48 bg-slate-700" />
            <Skeleton className="h-4 w-32 bg-slate-700" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24 rounded-xl bg-slate-700" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-xl bg-slate-700" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Header ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/15 border border-blue-500/25">
            <Clock className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">
              Employee Hours Directory
            </h1>
            <p className="text-sm text-slate-400">
              Master directory of all employee hours and rates
            </p>
          </div>
        </div>

        {/* ── Edit/Save/Cancel Buttons ── */}
        {!isEditMode ? (
          <Button
            onClick={enterEditMode}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-lg shadow-emerald-900/30"
            size="default"
          >
            <Pencil className="h-4 w-4" />
            Edit Directory
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              onClick={saveEdits}
              disabled={isSaving || changedRowIds.size === 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-lg shadow-emerald-900/30"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes{changedRowIds.size > 0 ? ` (${changedRowIds.size})` : ''}
            </Button>
            <Button
              variant="outline"
              onClick={cancelEditMode}
              disabled={isSaving}
              className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-2"
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* ─── Edit Mode Banner ──────────────────────────────────── */}
      {isEditMode && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25">
          <TableProperties className="h-5 w-5 text-amber-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-300">Edit Mode Active</p>
            <p className="text-xs text-amber-400/70">
              Click any cell to edit. Changed rows are highlighted. Save to apply changes or Cancel to revert.
            </p>
          </div>
          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
            {changedRowIds.size} change{changedRowIds.size !== 1 ? 's' : ''}
          </Badge>
        </div>
      )}

      {/* ─── Summary Cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Users className="h-4 w-4 text-slate-400" />
              <p className="text-xs text-slate-500">Total Employees</p>
            </div>
            <p className="text-2xl font-bold text-white">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <p className="text-xs text-slate-500">Above Threshold</p>
            </div>
            <p className="text-2xl font-bold text-emerald-400">{stats.aboveThreshold}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <p className="text-xs text-slate-500">Below Threshold</p>
            </div>
            <p className="text-2xl font-bold text-amber-400">{stats.belowThreshold}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-violet-400" />
              <p className="text-xs text-slate-500">Custom Rates</p>
            </div>
            <p className="text-2xl font-bold text-violet-400">{stats.customRate}</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-orange-400" />
              <p className="text-xs text-slate-500">Custom Threshold</p>
            </div>
            <p className="text-2xl font-bold text-orange-400">{stats.customThreshold}</p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Filters ───────────────────────────────────────────── */}
      <Card className="bg-slate-800/50 border-slate-700/50">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            {/* Search */}
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name, ID, trade, or site..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-slate-900 border-slate-700 h-9"
                disabled={isEditMode}
              />
            </div>

            {/* Rate Filter */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400 shrink-0" />
              <Select value={rateFilter} onValueChange={setRateFilter} disabled={isEditMode}>
                <SelectTrigger className="w-[140px] bg-slate-900 border-slate-700 h-9 text-sm">
                  <SelectValue placeholder="Filter by Rate" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="all">All Rates</SelectItem>
                  <SelectItem value="2.5">2.5 (Std Below)</SelectItem>
                  <SelectItem value="3.0">3.0 (TL Below)</SelectItem>
                  <SelectItem value="5.0">5.0 (Std Above)</SelectItem>
                  <SelectItem value="5.5">5.5 (TL Above)</SelectItem>
                  <SelectItem value="Custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Threshold Filter */}
            <Select value={thresholdFilter} onValueChange={setThresholdFilter} disabled={isEditMode}>
              <SelectTrigger className="w-[140px] bg-slate-900 border-slate-700 h-9 text-sm">
                <SelectValue placeholder="Threshold" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">All Thresholds</SelectItem>
                <SelectItem value="below">&lt; 1000h</SelectItem>
                <SelectItem value="above">&ge; 1000h</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ─── Directory Table ───────────────────────────────────── */}
      <Card className="bg-slate-800/50 border-slate-700/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium text-white flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-400" />
              Employee Directory
            </CardTitle>
            <span className="text-xs text-slate-400">
              {sortedEmployees.length} employee{sortedEmployees.length !== 1 ? 's' : ''}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className={isEditMode ? 'border-collapse' : ''}>
              <TableHeader>
                <TableRow className={`border-slate-700/50 hover:bg-transparent ${isEditMode ? 'bg-slate-800/80' : ''}`}>
                  <TableHead className={`text-slate-400 font-medium ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                    <button
                      className="flex items-center hover:text-white transition-colors"
                      onClick={() => !isEditMode && handleSort('employeeId')}
                      disabled={isEditMode}
                    >
                      Employee ID <SortIcon field="employeeId" />
                    </button>
                  </TableHead>
                  <TableHead className={`text-slate-400 font-medium ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                    <button
                      className="flex items-center hover:text-white transition-colors"
                      onClick={() => !isEditMode && handleSort('fullName')}
                      disabled={isEditMode}
                    >
                      Name <SortIcon field="fullName" />
                    </button>
                  </TableHead>
                  <TableHead className={`text-slate-400 font-medium ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                    <button
                      className="flex items-center hover:text-white transition-colors"
                      onClick={() => !isEditMode && handleSort('currentSite')}
                      disabled={isEditMode}
                    >
                      Current Site <SortIcon field="currentSite" />
                    </button>
                  </TableHead>
                  <TableHead className={`text-slate-400 font-medium ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                    <button
                      className="flex items-center hover:text-white transition-colors"
                      onClick={() => !isEditMode && handleSort('trade')}
                      disabled={isEditMode}
                    >
                      Trade <SortIcon field="trade" />
                    </button>
                  </TableHead>
                  <TableHead className={`text-slate-400 font-medium ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                    <button
                      className="flex items-center hover:text-white transition-colors"
                      onClick={() => !isEditMode && handleSort('rate')}
                      disabled={isEditMode}
                    >
                      Effective Rate <SortIcon field="rate" />
                    </button>
                  </TableHead>
                  <TableHead className={`text-slate-400 font-medium text-right ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                    <button
                      className="flex items-center justify-end hover:text-white transition-colors"
                      onClick={() => !isEditMode && handleSort('cumulativeHours')}
                      disabled={isEditMode}
                    >
                      Cumulative Hours <SortIcon field="cumulativeHours" />
                    </button>
                  </TableHead>
                  <TableHead className={`text-slate-400 font-medium text-center ${isEditMode ? 'border-r border-slate-700/30' : ''}`}>
                    <button
                      className="flex items-center justify-center hover:text-white transition-colors"
                      onClick={() => !isEditMode && handleSort('thresholdStatus')}
                      disabled={isEditMode}
                    >
                      Threshold <SortIcon field="thresholdStatus" />
                    </button>
                  </TableHead>
                  {!isEditMode && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-slate-500">
                      {isLoading ? (
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading...
                        </div>
                      ) : (
                        'No employees found matching filters'
                      )}
                    </TableCell>
                  </TableRow>
                ) : isEditMode ? (
                  /* ── Edit Mode Rows ── */
                  sortedEmployees.map((emp) => {
                    const editRow = getEditableRow(emp.id);
                    if (!editRow) return null;
                    const isChanged = changedRowIds.has(emp.id);

                    return (
                      <TableRow
                        key={emp.id}
                        className={`border-slate-700/30 transition-colors ${
                          isChanged
                            ? 'bg-emerald-500/10 hover:bg-emerald-500/15'
                            : 'hover:bg-slate-700/30'
                        }`}
                      >
                        {/* Employee ID */}
                        <TableCell className={`font-mono text-sm whitespace-nowrap py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          <Input
                            type="text"
                            value={editRow.employeeId}
                            onChange={(e) => updateEditableRow(emp.id, 'employeeId', e.target.value)}
                            className="h-7 text-xs font-mono bg-slate-900 border-slate-600 focus:border-emerald-500 focus:ring-emerald-500/20 w-24"
                            placeholder="Emp ID"
                          />
                        </TableCell>
                        {/* Full Name */}
                        <TableCell className={`whitespace-nowrap py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          <div className="flex items-center gap-2">
                            <Input
                              type="text"
                              value={editRow.fullName}
                              onChange={(e) => updateEditableRow(emp.id, 'fullName', e.target.value)}
                              className="h-7 text-xs bg-slate-900 border-slate-600 focus:border-emerald-500 focus:ring-emerald-500/20 w-40"
                              placeholder="Full Name"
                            />
                            <RoleBadge emp={emp} />
                          </div>
                        </TableCell>
                        {/* Current Site */}
                        <TableCell className={`whitespace-nowrap py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          <Input
                            type="text"
                            value={editRow.currentSite}
                            onChange={(e) => updateEditableRow(emp.id, 'currentSite', e.target.value)}
                            className="h-7 text-xs bg-slate-900 border-slate-600 focus:border-emerald-500 focus:ring-emerald-500/20 w-32"
                            placeholder="Site"
                          />
                        </TableCell>
                        {/* Trade */}
                        <TableCell className={`whitespace-nowrap py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          <Input
                            type="text"
                            value={editRow.trade}
                            onChange={(e) => updateEditableRow(emp.id, 'trade', e.target.value)}
                            className="h-7 text-xs bg-slate-900 border-slate-600 focus:border-emerald-500 focus:ring-emerald-500/20 w-28"
                            placeholder="Trade"
                          />
                        </TableCell>
                        {/* Rate (Custom Rate) */}
                        <TableCell className={`whitespace-nowrap py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              step="0.5"
                              min="0"
                              value={editRow.customHourlyRate}
                              onChange={(e) => updateEditableRow(emp.id, 'customHourlyRate', e.target.value)}
                              className="h-7 text-xs font-mono bg-slate-900 border-slate-600 focus:border-emerald-500 focus:ring-emerald-500/20 w-20"
                              placeholder="—"
                            />
                            <span className="text-[10px] text-slate-500">AED/hr</span>
                          </div>
                        </TableCell>
                        {/* Cumulative Hours */}
                        <TableCell className={`text-right py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            value={editRow.cumulativeHours}
                            onChange={(e) => updateEditableRow(emp.id, 'cumulativeHours', e.target.value)}
                            className="h-7 text-xs font-mono bg-slate-900 border-slate-600 focus:border-emerald-500 focus:ring-emerald-500/20 w-24 text-right"
                            placeholder="0"
                          />
                        </TableCell>
                        {/* Threshold */}
                        <TableCell className={`text-center py-1.5 px-3 ${isChanged ? 'border-r border-emerald-500/20' : 'border-r border-slate-700/30'}`}>
                          <div className="flex items-center justify-center gap-1.5">
                            <Input
                              type="number"
                              step="100"
                              min="0"
                              value={editRow.hoursThreshold}
                              onChange={(e) => updateEditableRow(emp.id, 'hoursThreshold', e.target.value)}
                              className="h-7 text-xs font-mono bg-slate-900 border-slate-600 focus:border-emerald-500 focus:ring-emerald-500/20 w-20 text-center"
                              placeholder="1000"
                            />
                            <span className="text-[10px] text-slate-500">h</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  /* ── View Mode Rows ── */
                  sortedEmployees.map((emp) => (
                    <TableRow
                      key={emp.id}
                      className="border-slate-700/30 hover:bg-slate-700/30 cursor-pointer transition-colors"
                      onClick={() => handleEmployeeClick(emp.id)}
                    >
                      <TableCell className="font-mono text-sm text-slate-300 whitespace-nowrap">
                        {emp.employeeId}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{emp.fullName}</span>
                          <RoleBadge emp={emp} />
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-300 whitespace-nowrap">
                        {emp.currentSite || <span className="text-slate-600">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-slate-300 whitespace-nowrap">
                        {emp.trade || <span className="text-slate-600">—</span>}
                      </TableCell>
                      <TableCell>
                        <RateBadge emp={emp} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm whitespace-nowrap">
                        <span className={
                          emp.cumulativeHours >= emp.hoursThreshold
                            ? 'text-red-400'
                            : 'text-slate-200'
                        }>
                          {formatHours(emp.cumulativeHours)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center min-w-[140px]">
                        <div className="flex flex-col items-center gap-1">
                          {emp.thresholdStatus === 'above' ? (
                            <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px] px-1.5 py-0 h-5">
                              &ge; {emp.hoursThreshold}h
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-[10px] px-1.5 py-0 h-5">
                              &lt; {emp.hoursThreshold}h
                            </Badge>
                          )}
                          {/* Progress bar toward threshold */}
                          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                emp.thresholdStatus === 'above'
                                  ? 'bg-amber-400'
                                  : 'bg-emerald-400'
                              }`}
                              style={{
                                width: `${Math.min(100, (emp.cumulativeHours / emp.hoursThreshold) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className="text-[9px] text-slate-500">
                            {Math.min(100, Math.round((emp.cumulativeHours / emp.hoursThreshold) * 100))}% of {emp.hoursThreshold}h
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-slate-500" />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
