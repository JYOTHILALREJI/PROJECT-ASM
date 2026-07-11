'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Search,
  Plus,
  X,
  Trash2,
  Save,
  Loader2,
  Wallet,
  Users,
  ShoppingCart,
  CalendarDays,
  DollarSign,
  Info,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useAuthStore } from '@/store/auth-store';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

/* ───────── Types ───────── */

interface Employee {
  id: string;
  fullName: string;
  employeeId: string;
  currentSite: string | null;
  trade: string | null;
  nationality: string | null;
  status: string;
}

interface BucketItem {
  empId: string;
  empName: string;
  employeeCode: string;
  currentSite: string | null;
  trade: string | null;
  amount: number; // custom amount; if 0 → falls back to common amount
  useCustom: boolean;
}

interface PendingAdvance {
  id: string;
  empId: string;
  empName: string;
  employeeCode: string;
  amount: number;
  reason: string;
  effectiveMonth: string;
  effectiveYear: number;
  createdAt: string;
}

/* ───────── Helpers ───────── */

const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getMonthString(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function getNextMonth(year: number, month: number): { year: number; month: number } {
  let m = month + 1;
  let y = year;
  if (m > 11) { m = 0; y += 1; }
  return { year: y, month: m };
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ───────── Main Component ───────── */

export function AdvancePage() {
  const { user } = useAuthStore();
  const { setCurrentView } = useAppStore();

  // Default effective month = next month from today
  const now = new Date();
  const next = getNextMonth(now.getFullYear(), now.getMonth());
  const [selectedYear, setSelectedYear] = useState(next.year);
  const [selectedMonth, setSelectedMonth] = useState(next.month); // 0-indexed

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [page, setPage] = useState(1);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const pageSize = 24;

  // Bucket state — map of empId -> BucketItem
  const [bucket, setBucket] = useState<Map<string, BucketItem>>(new Map());

  // Common amount (applied to all bucket items that don't have custom amount)
  const [commonAmount, setCommonAmount] = useState<number>(100);

  // Existing pending advances for the selected month
  const [pendingAdvances, setPendingAdvances] = useState<PendingAdvance[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);

  // Saving state
  const [saving, setSaving] = useState(false);

  // Active tab: 'new' (search + bucket) or 'existing' (pending advances list)
  const [activeTab, setActiveTab] = useState<'new' | 'existing'>('new');

  const monthStr = getMonthString(selectedYear, selectedMonth);
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 4 }, (_, i) => currentYear + i - 1);
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch employees
  const fetchEmployees = useCallback(async () => {
    setLoadingEmployees(true);
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        page: String(page),
        status: 'active',
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await fetch(`/api/employees?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data.employees || []);
        setTotalEmployees(data.data.total || 0);
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load employees', variant: 'destructive' });
    } finally {
      setLoadingEmployees(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Fetch pending advances for selected month
  const fetchPendingAdvances = useCallback(async () => {
    setLoadingPending(true);
    try {
      const res = await fetch(`/api/advances/pending-by-month?month=${monthStr}&year=${selectedYear}`);
      const data = await res.json();
      if (data.success) {
        setPendingAdvances(data.data.advances || []);
      } else {
        setPendingAdvances([]);
      }
    } catch {
      setPendingAdvances([]);
    } finally {
      setLoadingPending(false);
    }
  }, [monthStr, selectedYear]);

  useEffect(() => {
    fetchPendingAdvances();
  }, [fetchPendingAdvances]);

  // ── Bucket operations ──

  const addToBucket = useCallback((emp: Employee) => {
    setBucket((prev) => {
      if (prev.has(emp.id)) return prev;
      const next = new Map(prev);
      next.set(emp.id, {
        empId: emp.id,
        empName: emp.fullName,
        employeeCode: emp.employeeId,
        currentSite: emp.currentSite,
        trade: emp.trade,
        amount: 0,
        useCustom: false,
      });
      return next;
    });
    toast({
      title: 'Added to bucket',
      description: `${emp.fullName} added to advance bucket`,
    });
  }, []);

  const removeFromBucket = useCallback((empId: string) => {
    setBucket((prev) => {
      const next = new Map(prev);
      next.delete(empId);
      return next;
    });
  }, []);

  const setItemCustomAmount = useCallback((empId: string, amount: number, useCustom: boolean) => {
    setBucket((prev) => {
      const next = new Map(prev);
      const item = next.get(empId);
      if (!item) return prev;
      next.set(empId, { ...item, amount, useCustom });
      return next;
    });
  }, []);

  const setAllToCommon = useCallback(() => {
    setBucket((prev) => {
      const next = new Map(prev);
      for (const [k, v] of next.entries()) {
        next.set(k, { ...v, useCustom: false, amount: 0 });
      }
      return next;
    });
  }, []);

  const setAllToCustom = useCallback((amount: number) => {
    setBucket((prev) => {
      const next = new Map(prev);
      for (const [k, v] of next.entries()) {
        next.set(k, { ...v, useCustom: true, amount });
      }
      return next;
    });
  }, [commonAmount]);

  const clearBucket = useCallback(() => {
    setBucket(new Map());
  }, []);

  // ── Save bucket ──

  const bucketArray = useMemo(() => Array.from(bucket.values()), [bucket]);

  const totalBucketAmount = useMemo(() => {
    let sum = 0;
    for (const item of bucketArray) {
      sum += item.useCustom ? item.amount : commonAmount;
    }
    return sum;
  }, [bucketArray, commonAmount]);

  const handleSave = useCallback(async () => {
    // Note: we no longer hard-block on missing user — the server can resolve
    // the creator by email or fall back to the first super_admin. This keeps
    // the workflow working even if the localStorage user.id is stale.
    if (bucketArray.length === 0) {
      toast({ title: 'Empty bucket', description: 'Add at least one employee to the bucket' });
      return;
    }

    // Validate amounts
    for (const item of bucketArray) {
      const amt = item.useCustom ? item.amount : commonAmount;
      if (typeof amt !== 'number' || amt <= 0) {
        toast({
          title: 'Invalid amount',
          description: `${item.empName}: amount must be greater than 0`,
          variant: 'destructive',
        });
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        advances: bucketArray.map((item) => ({
          empId: item.empId,
          empName: item.empName,
          employeeCode: item.employeeCode,
          amount: item.useCustom ? item.amount : commonAmount,
          effectiveMonth: monthStr,
          effectiveYear: selectedYear,
        })),
        // Send both id and email so the server can resolve the creator
        // even if the localStorage id is stale (e.g., after a DB reset).
        createdById: user?.id,
        creatorEmail: user?.email,
      };

      const res = await fetch('/api/advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: 'Advances saved',
          description: `${data.data.count} advance(s) saved for ${MONTH_FULL[selectedMonth]} ${selectedYear}. They will be deducted from the next salary.`,
        });
        setBucket(new Map());
        fetchPendingAdvances();
        setActiveTab('existing');
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to save advances', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save advances', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [user, bucketArray, commonAmount, monthStr, selectedYear, selectedMonth, fetchPendingAdvances]);

  // ── Delete pending advance ──
  const handleDeletePending = useCallback(async (advanceId: string, empName: string) => {
    if (!confirm(`Delete the pending advance for ${empName}?`)) return;
    try {
      const res = await fetch(`/api/advances/${advanceId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast({ title: 'Advance deleted', description: `${empName}'s advance was removed` });
        fetchPendingAdvances();
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to delete', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete advance', variant: 'destructive' });
    }
  }, [fetchPendingAdvances]);

  // ── Render ──
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCurrentView('accounts')}
            className="text-slate-400 hover:text-white hover:bg-slate-700 shrink-0"
            title="Back to Accounts"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                <Wallet className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Advance Management</h2>
                <p className="text-slate-400 mt-0.5 text-sm">
                  Distribute cash advances to employees · deducted from next salary
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Effective Month / Year selector */}
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-slate-400" />
              <Label className="text-xs text-slate-400">Effective:</Label>
            </div>
            <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v, 10))}>
              <SelectTrigger className="w-[120px] bg-slate-700/50 border-slate-600 text-white h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                {MONTH_SHORT.map((m, i) => (
                  <SelectItem key={m} value={String(i)} className="text-white focus:bg-slate-700 focus:text-white">
                    {MONTH_FULL[i]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v, 10))}>
              <SelectTrigger className="w-[90px] bg-slate-700/50 border-slate-600 text-white h-8 text-xs">
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
          </CardContent>
        </Card>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <Info className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm text-slate-300">
          <p className="font-medium text-amber-300 mb-1">How advances work</p>
          <p className="text-slate-400">
            Add employees to the bucket using the <Plus className="inline h-3 w-3" /> button.
            Set a common amount or a custom amount per employee. When saved, the advance is recorded as
            <span className="text-amber-300 font-medium"> pending</span> for <span className="text-white font-medium">{MONTH_FULL[selectedMonth]} {selectedYear}</span>.
            Once the salary sheet for that month is generated and saved, the advance amount is automatically
            deducted from the employee's salary and shown in the <span className="text-white font-medium">Advance</span> column.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center bg-slate-800 rounded-lg border border-slate-700 p-0.5 w-fit">
        <button
          onClick={() => setActiveTab('new')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            activeTab === 'new'
              ? 'bg-amber-500 text-white'
              : 'text-slate-400 hover:text-white'
          )}
        >
          <Plus className="h-4 w-4" />
          New Advance
          {bucketArray.length > 0 && (
            <Badge variant="secondary" className="ml-1 bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px] px-1.5 py-0 h-4 min-w-[20px] flex items-center justify-center">
              {bucketArray.length}
            </Badge>
          )}
        </button>
        <button
          onClick={() => setActiveTab('existing')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            activeTab === 'existing'
              ? 'bg-amber-500 text-white'
              : 'text-slate-400 hover:text-white'
          )}
        >
          <ShoppingCart className="h-4 w-4" />
          Pending for {MONTH_SHORT[selectedMonth]} {selectedYear}
          {pendingAdvances.length > 0 && (
            <Badge variant="secondary" className="ml-1 bg-slate-700 text-slate-300 text-[10px] px-1.5 py-0 h-4 min-w-[20px] flex items-center justify-center">
              {pendingAdvances.length}
            </Badge>
          )}
        </button>
      </div>

      {/* ── New Advance tab ── */}
      {activeTab === 'new' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Employee search + grid (left, 2 cols) */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <Card className="bg-slate-800/50 border-slate-700/50">
              <CardContent className="p-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    placeholder="Search by name, ID, trade, nationality..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 bg-slate-900 border-slate-600 text-white placeholder:text-slate-500"
                  />
                  {search && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-slate-500 hover:text-white"
                      onClick={() => setSearch('')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  {totalEmployees} employee{totalEmployees !== 1 ? 's' : ''} found
                  {search && <> matching &ldquo;<span className="text-amber-400">{search}</span>&rdquo;</>}
                </p>
              </CardContent>
            </Card>

            {/* Employee grid */}
            {loadingEmployees ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 bg-slate-800 rounded-lg" />
                ))}
              </div>
            ) : employees.length === 0 ? (
              <Card className="bg-slate-800/50 border-slate-700/50">
                <CardContent className="py-16 text-center">
                  <Users className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No employees found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {employees.map((emp) => {
                  const inBucket = bucket.has(emp.id);
                  return (
                    <Card
                      key={emp.id}
                      className={cn(
                        'bg-slate-800/50 border-slate-700/50 hover:border-slate-600 transition-all',
                        inBucket && 'border-amber-500/40 bg-amber-500/5'
                      )}
                    >
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-slate-300 text-xs font-semibold shrink-0">
                          {emp.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white font-medium truncate">{emp.fullName}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-slate-500 font-mono">{emp.employeeId}</span>
                            {emp.currentSite && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                                {emp.currentSite}
                              </Badge>
                            )}
                            {emp.trade && (
                              <span className="text-[10px] text-slate-500 truncate">{emp.trade}</span>
                            )}
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant={inBucket ? 'default' : 'outline'}
                          onClick={() => inBucket ? removeFromBucket(emp.id) : addToBucket(emp)}
                          className={cn(
                            'h-8 w-8 shrink-0',
                            inBucket
                              ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
                              : 'border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white'
                          )}
                          title={inBucket ? 'Remove from bucket' : 'Add to bucket'}
                        >
                          {inBucket ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {totalEmployees > pageSize && (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="text-slate-400 hover:text-white"
                >
                  ← Prev
                </Button>
                <span className="text-xs text-slate-400">
                  Page {page} of {Math.ceil(totalEmployees / pageSize)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= Math.ceil(totalEmployees / pageSize)}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-slate-400 hover:text-white"
                >
                  Next →
                </Button>
              </div>
            )}
          </div>

          {/* Bucket (right, 1 col) */}
          <Card className="bg-slate-800/50 border-slate-700/50 lg:sticky lg:top-4 h-fit">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-white flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-amber-400" />
                  Advance Bucket
                  <Badge variant="secondary" className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">
                    {bucketArray.length}
                  </Badge>
                </CardTitle>
                {bucketArray.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearBucket}
                    className="text-slate-400 hover:text-red-400 h-7 text-xs"
                  >
                    Clear all
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {bucketArray.length === 0 ? (
                <div className="py-10 text-center">
                  <ShoppingCart className="h-10 w-10 text-slate-700 mx-auto mb-3" />
                  <p className="text-sm text-slate-400 font-medium">Bucket is empty</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Click the <Plus className="inline h-3 w-3" /> button on an employee card to add them.
                  </p>
                </div>
              ) : (
                <>
                  {/* Common amount input */}
                  <div className="space-y-2 pb-3 border-b border-slate-700/50">
                    <Label className="text-xs text-slate-400">Common amount (DHS)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={commonAmount}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setCommonAmount(isNaN(v) ? 0 : v);
                        }}
                        className="bg-slate-900 border-slate-600 text-white h-8"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAllToCustom(commonAmount)}
                        className="h-8 text-xs border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white shrink-0"
                        title="Apply this amount to all bucket items"
                      >
                        Apply to all
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={setAllToCommon}
                      className="h-6 text-[10px] text-slate-500 hover:text-slate-300 p-0"
                    >
                      Reset all to common amount
                    </Button>
                  </div>

                  {/* Bucket items */}
                  <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                    {bucketArray.map((item) => (
                      <div
                        key={item.empId}
                        className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-2.5 space-y-2"
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white font-medium truncate">{item.empName}</p>
                            <p className="text-[10px] text-slate-500 font-mono">{item.employeeCode}</p>
                          </div>
                          <button
                            onClick={() => removeFromBucket(item.empId)}
                            className="text-slate-500 hover:text-red-400 transition-colors p-1"
                            title="Remove from bucket"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.useCustom ? item.amount : ''}
                            placeholder={item.useCustom ? '0.00' : `Common (${formatNumber(commonAmount)})`}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setItemCustomAmount(item.empId, isNaN(v) ? 0 : v, true);
                            }}
                            className="bg-slate-900 border-slate-600 text-white h-7 text-xs flex-1"
                          />
                          <button
                            onClick={() => setItemCustomAmount(item.empId, 0, !item.useCustom)}
                            className={cn(
                              'text-[10px] px-2 py-1 rounded border transition-colors shrink-0',
                              item.useCustom
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                : 'bg-slate-700 text-slate-400 border-slate-600'
                            )}
                            title="Toggle custom amount on/off"
                          >
                            {item.useCustom ? 'Custom' : 'Common'}
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-500 text-right">
                          Amount: <span className="text-amber-300 font-medium">
                            {formatNumber(item.useCustom ? item.amount : commonAmount)}
                          </span> DHS
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Total + Save */}
                  <div className="pt-3 border-t border-slate-700/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-400">Total advances:</span>
                      <span className="text-lg font-bold text-amber-300">{formatNumber(totalBucketAmount)} DHS</span>
                    </div>
                    <Button
                      onClick={handleSave}
                      disabled={saving || totalBucketAmount <= 0}
                      className="w-full bg-amber-600 hover:bg-amber-700 text-white gap-2"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save {bucketArray.length} Advance{bucketArray.length !== 1 ? 's' : ''}
                    </Button>
                    <p className="text-[10px] text-slate-500 text-center">
                      Effective: <span className="text-slate-300">{MONTH_FULL[selectedMonth]} {selectedYear}</span> salary
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Existing pending advances tab ── */}
      {activeTab === 'existing' && (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-amber-400" />
                Pending Advances — {MONTH_FULL[selectedMonth]} {selectedYear}
              </span>
              {pendingAdvances.length > 0 && (
                <span className="text-sm text-slate-400 font-normal">
                  Total: <span className="text-amber-300 font-bold">
                    {formatNumber(pendingAdvances.reduce((s, a) => s + a.amount, 0))}
                  </span> DHS
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingPending ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 bg-slate-700/50" />
                ))}
              </div>
            ) : pendingAdvances.length === 0 ? (
              <div className="py-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-slate-700 mx-auto mb-3" />
                <p className="text-sm text-slate-400 font-medium">No pending advances</p>
                <p className="text-xs text-slate-500 mt-1">
                  No advances have been recorded for {MONTH_FULL[selectedMonth]} {selectedYear} yet.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab('new')}
                  className="mt-4 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create new advance
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingAdvances.map((adv) => (
                  <div
                    key={adv.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-900/40 p-3"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15 text-amber-400 text-xs font-semibold shrink-0">
                      {adv.empName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{adv.empName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-slate-500 font-mono">{adv.employeeCode}</span>
                        {adv.reason && (
                          <span className="text-[10px] text-slate-400 italic truncate">— {adv.reason}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-amber-300">{formatNumber(adv.amount)} DHS</p>
                      <p className="text-[10px] text-slate-500">
                        {new Date(adv.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDeletePending(adv.id, adv.empName)}
                      className="h-7 w-7 text-slate-500 hover:text-red-400 hover:bg-red-500/10 shrink-0"
                      title="Delete advance"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}

                {/* Info banner */}
                <div className="flex items-start gap-2 mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <AlertTriangle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-400">
                    These advances will be automatically applied when salary records are saved for
                    <span className="text-white font-medium"> {MONTH_FULL[selectedMonth]} {selectedYear}</span>.
                    The amount will appear in the <span className="text-white font-medium">Advance</span> column
                    on the Accounts salary sheet and reduce the employee's balance salary accordingly.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
