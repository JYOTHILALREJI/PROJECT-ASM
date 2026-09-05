'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Ban,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  Search,
  X,
  Loader2,
  Filter,
  AlertCircle,
  User,
  RotateCcw,
  Archive,
  ArchiveRestore,
  Trash2,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/utils';

/* ───────── Types ───────── */
interface Employee {
  id: string;
  fullName: string;
  employeeId: string;
  position: string | null;
  phone: string | null;
  nationality: string | null;
  status: string;
}

interface CancellationRequest {
  id: string;
  employeeId: string;
  employee: Employee;
  reason: string;
  status: string;
  requestedBy: { id: string; name: string; email: string };
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ───────── Constants ───────── */
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: 'Pending', color: 'bg-amber-500/15 text-amber-400 border-amber-500/25', icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-500/15 text-green-400 border-green-500/25', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-500/15 text-red-400 border-red-500/25', icon: XCircle },
};

const EMPLOYEE_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'bg-green-500/15 text-green-400 border-green-500/25' },
  pending_deletion: { label: 'Pending Deletion', color: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
  deleted: { label: 'Deleted', color: 'bg-red-500/15 text-red-400 border-red-500/25' },
};

/* ───────── Recycle Bin types ───────── */
interface RecycleBinEmployee {
  id: string;
  employeeId: string;
  fullName: string;
  position: string | null;
  trade: string | null;
  nationality: string | null;
  currentSite: string | null;
  status: string;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  cancellationReason: string | null;
  relatedCounts: {
    attendance: number;
    salaryRecords: number;
    documents: number;
    uniforms: number;
    warnings: number;
    fines: number;
    advances: number;
  };
}

/* ───────── Searchable Employee Dropdown ───────── */
interface SearchableEmployeeSelectProps {
  employees: Employee[];
  value: string;
  onChange: (id: string) => void;
}

function SearchableEmployeeSelect({ employees, value, onChange }: SearchableEmployeeSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = employees.find((e) => e.id === value);

  const filtered = search
    ? employees.filter(
        (e) =>
          e.fullName.toLowerCase().includes(search.toLowerCase()) ||
          e.employeeId.toLowerCase().includes(search.toLowerCase())
      )
    : employees;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full h-10 rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm text-white hover:bg-slate-800 transition-colors text-left"
      >
        <User className="h-4 w-4 text-slate-500 shrink-0" />
        <span className="truncate flex-1">
          {selected ? `${selected.fullName} (${selected.employeeId})` : 'Select employee...'}
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl shadow-black/40 overflow-hidden">
          <div className="p-2 border-b border-slate-700">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or ID..."
                className="w-full h-8 pl-8 pr-3 bg-slate-900 border border-slate-600 rounded-md text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500/50"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-500">No employees found</div>
            ) : (
              filtered.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => {
                    onChange(emp.id);
                    setOpen(false);
                    setSearch('');
                  }}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-slate-700/50',
                    emp.id === value ? 'bg-slate-700/70 text-white' : 'text-slate-300'
                  )}
                >
                  <span className="truncate flex-1">{emp.fullName}</span>
                  <span className="text-slate-500 text-xs shrink-0">({emp.employeeId})</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── Status Badge ───────── */
function CancellationStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <Badge className={cn('gap-1', cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

function EmployeeStatusBadge({ status }: { status: string }) {
  const cfg = EMPLOYEE_STATUS_CONFIG[status] || { label: status, color: 'bg-slate-500/15 text-slate-400 border-slate-500/25' };
  return (
    <Badge className={cfg.color}>
      {cfg.label}
    </Badge>
  );
}

/* ───────── Empty State ───────── */
function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-700/50 mb-4">
        <Ban className="h-8 w-8 text-slate-500" />
      </div>
      <h3 className="text-base font-semibold text-white mb-1">
        {hasFilters ? 'No cancellation requests found' : 'No cancellation requests yet'}
      </h3>
      <p className="text-sm text-slate-500 max-w-sm">
        {hasFilters
          ? 'Try adjusting your filters to find what you\'re looking for.'
          : 'Create a new cancellation request to remove an employee.'}
      </p>
    </div>
  );
}

/* ───────── Table Skeleton ───────── */
function TableSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-full bg-slate-700" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40 bg-slate-700" />
            <Skeleton className="h-3 w-24 bg-slate-700" />
          </div>
          <Skeleton className="h-5 w-20 bg-slate-700" />
          <Skeleton className="h-5 w-16 bg-slate-700" />
        </div>
      ))}
    </div>
  );
}

/* ───────── Main Component ───────── */
export function CancellationRequestPage() {
  const { user } = useAuthStore();
  const { toast } = useToast();

  // Data state
  const [cancellationRequests, setCancellationRequests] = useState<CancellationRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewingRequest, setReviewingRequest] = useState<CancellationRequest | null>(null);
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected'>('approved');
  // On approval: "soft" moves the employee to the Recycle Bin (restorable),
  // "permanent" deletes the record and everything related to it forever.
  const [deletionMode, setDeletionMode] = useState<'soft' | 'permanent'>('soft');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);

  // Tabs: requests | recycle_bin
  const [activeTab, setActiveTab] = useState<'requests' | 'recycle_bin'>('requests');

  // Recycle Bin state
  const [binEmployees, setBinEmployees] = useState<RecycleBinEmployee[]>([]);
  const [binLoading, setBinLoading] = useState(false);
  const [binLoaded, setBinLoaded] = useState(false);
  const [restoringTarget, setRestoringTarget] = useState<RecycleBinEmployee | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecycleBinEmployee | null>(null);
  const [emptyBinOpen, setEmptyBinOpen] = useState(false);
  const [isBinActioning, setIsBinActioning] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    employeeId: '',
    reason: '',
  });

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [searchQuery]);

  // Fetch cancellation requests
  const fetchCancellationRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/cancellation-requests?${params}`);
      const json = await res.json();
      if (json.success) {
        setCancellationRequests(json.data.cancellationRequests || []);
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to fetch cancellation requests', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, toast]);

  // Fetch employees for the form dropdown (only active ones, not already pending deletion)
  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/employees?limit=1000&status=active');
      const json = await res.json();
      if (json.success) {
        setEmployees(json.data.employees || []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchCancellationRequests();
  }, [fetchCancellationRequests]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Filter by search
  const filteredRequests = useMemo(() => {
    if (!debouncedSearch) return cancellationRequests;
    const q = debouncedSearch.toLowerCase();
    return cancellationRequests.filter(
      (r) =>
        r.employee.fullName.toLowerCase().includes(q) ||
        r.employee.employeeId.toLowerCase().includes(q) ||
        (r.reason || '').toLowerCase().includes(q)
    );
  }, [cancellationRequests, debouncedSearch]);

  // Stats
  const stats = useMemo(() => ({
    total: cancellationRequests.length,
    pending: cancellationRequests.filter((r) => r.status === 'pending').length,
    approved: cancellationRequests.filter((r) => r.status === 'approved').length,
    rejected: cancellationRequests.filter((r) => r.status === 'rejected').length,
  }), [cancellationRequests]);

  // Handle create cancellation request
  const handleCreate = async () => {
    if (!formData.employeeId) {
      toast({ title: 'Validation Error', description: 'Please select an employee', variant: 'destructive' });
      return;
    }
    if (!user) {
      toast({ title: 'Error', description: 'You must be logged in', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/cancellation-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: formData.employeeId,
          reason: formData.reason || undefined,
          createdById: user.id,
          actorDisplayName: user.name || user.email,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast({ title: 'Success', description: 'Cancellation request submitted successfully' });
        setCreateDialogOpen(false);
        resetForm();
        fetchCancellationRequests();
        fetchEmployees(); // Refresh employees as status may have changed
        window.dispatchEvent(new Event('asm:refresh-badge-counts'));
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to create cancellation request', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Something went wrong', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle review (approve/reject)
  const handleReview = async () => {
    if (!reviewingRequest || !user) return;
    setIsReviewing(true);
    try {
      const res = await fetch(`/api/cancellation-requests/${reviewingRequest.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: reviewAction,
          reviewedBy: user.id,
          actorDisplayName: user.name || user.email,
          deletionMode,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast({
          title: reviewAction === 'approved' ? 'Cancellation Approved' : 'Cancellation Rejected',
          description: reviewAction === 'approved'
            ? deletionMode === 'permanent'
              ? 'The employee record has been permanently deleted.'
              : 'The employee has been moved to the Recycle Bin and can be restored later.'
            : 'The employee status has been restored to active.',
        });
        setReviewDialogOpen(false);
        setReviewingRequest(null);
        fetchCancellationRequests();
        fetchEmployees();
        setBinLoaded(false); // recycle bin contents changed — refetch when opened
        window.dispatchEvent(new Event('asm:refresh-badge-counts'));
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to review request', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Something went wrong', variant: 'destructive' });
    } finally {
      setIsReviewing(false);
    }
  };

  const resetForm = () => {
    setFormData({ employeeId: '', reason: '' });
  };

  const openCreateDialog = () => {
    resetForm();
    setCreateDialogOpen(true);
  };

  const openReviewDialog = (request: CancellationRequest, action: 'approved' | 'rejected') => {
    setReviewingRequest(request);
    setReviewAction(action);
    setDeletionMode('soft'); // default to the safe (restorable) option
    setReviewDialogOpen(true);
  };

  /* ── Recycle Bin ── */
  const fetchRecycleBin = useCallback(async () => {
    setBinLoading(true);
    try {
      const res = await fetch('/api/recycle-bin');
      const json = await res.json();
      if (json.success) {
        setBinEmployees(json.data.employees || []);
        setBinLoaded(true);
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load the Recycle Bin', variant: 'destructive' });
    } finally {
      setBinLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (activeTab === 'recycle_bin' && !binLoaded && !binLoading) {
      fetchRecycleBin();
    }
  }, [activeTab, binLoaded, binLoading, fetchRecycleBin]);

  const handleRestore = async () => {
    if (!restoringTarget || !user) return;
    setIsBinActioning(true);
    try {
      const res = await fetch(`/api/recycle-bin/${restoringTarget.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, actorDisplayName: user.name || user.email }),
      });
      const json = await res.json();
      if (json.success) {
        toast({
          title: 'Employee Restored',
          description: `${restoringTarget.fullName} has been restored to active status.`,
        });
        setRestoringTarget(null);
        fetchRecycleBin();
        fetchCancellationRequests();
        fetchEmployees();
        window.dispatchEvent(new Event('asm:refresh-badge-counts'));
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to restore employee', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Something went wrong', variant: 'destructive' });
    } finally {
      setIsBinActioning(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!deleteTarget || !user) return;
    setIsBinActioning(true);
    try {
      const res = await fetch(`/api/recycle-bin/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, actorDisplayName: user.name || user.email }),
      });
      const json = await res.json();
      if (json.success) {
        toast({
          title: 'Employee Permanently Deleted',
          description: `${deleteTarget.fullName} and all related records have been permanently deleted.`,
        });
        setDeleteTarget(null);
        fetchRecycleBin();
        fetchCancellationRequests();
        window.dispatchEvent(new Event('asm:refresh-badge-counts'));
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to delete employee', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Something went wrong', variant: 'destructive' });
    } finally {
      setIsBinActioning(false);
    }
  };

  const handleEmptyBin = async () => {
    if (!user) return;
    setIsBinActioning(true);
    try {
      const res = await fetch('/api/recycle-bin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, actorDisplayName: user.name || user.email }),
      });
      const json = await res.json();
      if (json.success) {
        const count = json.data?.deletedCount ?? 0;
        toast({
          title: 'Recycle Bin Emptied',
          description: count === 0
            ? 'The Recycle Bin is already empty.'
            : `${count} employee record(s) permanently deleted.`,
        });
        setEmptyBinOpen(false);
        fetchRecycleBin();
        fetchCancellationRequests();
        window.dispatchEvent(new Event('asm:refresh-badge-counts'));
      } else {
        toast({ title: 'Error', description: json.error || 'Failed to empty the Recycle Bin', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Something went wrong', variant: 'destructive' });
    } finally {
      setIsBinActioning(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const isSuperAdmin = user?.role === 'super_admin';

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">
            {activeTab === 'requests' ? 'Cancellation Requests' : 'Recycle Bin'}
          </h2>
          <p className="text-slate-400 mt-1">
            {activeTab === 'requests'
              ? 'Manage employee cancellation and deletion requests.'
              : 'Soft-deleted employees restorable at any time — or remove them forever.'}
          </p>
        </div>
        {activeTab === 'requests' ? (
          <Button
            onClick={openCreateDialog}
            className="bg-blue-500 hover:bg-blue-600 text-white gap-2 self-start"
          >
            <Plus className="h-4 w-4" />
            New Cancellation Request
          </Button>
        ) : (
          <Button
            onClick={() => setEmptyBinOpen(true)}
            disabled={binEmployees.length === 0 || isBinActioning}
            className="bg-red-500/90 hover:bg-red-600 text-white gap-2 self-start"
          >
            <Trash2 className="h-4 w-4" />
            Empty Recycle Bin
            {binEmployees.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-md bg-black/25 text-[11px] font-semibold">
                {binEmployees.length}
              </span>
            )}
          </Button>
        )}
      </div>

      {/* Tabs: Requests | Recycle Bin */}
      <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/60 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('requests')}
          data-asm-tab="requests"
          aria-pressed={activeTab === 'requests'}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeTab === 'requests'
              ? 'bg-slate-700 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
          )}
        >
          <Ban className="h-4 w-4" />
          Requests
          {stats.pending > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-semibold">
              {stats.pending}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('recycle_bin')}
          data-asm-tab="recycle_bin"
          aria-pressed={activeTab === 'recycle_bin'}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            activeTab === 'recycle_bin'
              ? 'bg-slate-700 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
          )}
        >
          <Archive className="h-4 w-4" />
          Recycle Bin
          {binEmployees.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300 text-[10px] font-semibold">
              {binEmployees.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'requests' && (
      <>
      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { title: 'Total', value: stats.total, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
          { title: 'Pending', value: stats.pending, color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
          { title: 'Approved', value: stats.approved, color: 'text-green-400', bgColor: 'bg-green-500/10' },
          { title: 'Rejected', value: stats.rejected, color: 'text-red-400', bgColor: 'bg-red-500/10' },
        ].map((stat) => (
          <Card key={stat.title} className="bg-slate-800/50 border-slate-700/50 py-3">
            <CardContent className="px-4 py-0">
              <p className="text-xs text-slate-400 font-medium">{stat.title}</p>
              <p className={cn('text-2xl font-bold', stat.color)}>{isLoading ? '...' : stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search & Filters */}
      <Card className="bg-slate-800 border-slate-700 rounded-xl">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name, ID, reason..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 h-9"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px] bg-slate-900 border-slate-600 text-white h-9">
                <Filter className="h-4 w-4 mr-2 text-slate-400" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Cancellation Requests Table */}
      <Card className="bg-slate-800 border-slate-700 rounded-xl overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : filteredRequests.length === 0 ? (
          <EmptyState hasFilters={!!debouncedSearch || statusFilter !== 'all'} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/50 hover:bg-transparent">
                  <TableHead className="text-slate-400 font-medium">Employee</TableHead>
                  <TableHead className="text-slate-400 font-medium">Employee Status</TableHead>
                  <TableHead className="text-slate-400 font-medium">Reason</TableHead>
                  <TableHead className="text-slate-400 font-medium">Request Status</TableHead>
                  <TableHead className="text-slate-400 font-medium">Requested By</TableHead>
                  <TableHead className="text-slate-400 font-medium">Created</TableHead>
                  {isSuperAdmin && (
                    <TableHead className="text-slate-400 font-medium text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRequests.map((request) => (
                  <TableRow
                    key={request.id}
                    className="border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                  >
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-white">{request.employee.fullName}</p>
                        <p className="text-xs text-slate-500">{request.employee.employeeId}</p>
                        {request.employee.position && (
                          <p className="text-xs text-slate-600">{request.employee.position}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <EmployeeStatusBadge status={request.employee.status} />
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-slate-300 max-w-[200px] truncate" title={request.reason || ''}>
                        {request.reason || <span className="text-slate-600 italic">No reason provided</span>}
                      </p>
                    </TableCell>
                    <TableCell>
                      <CancellationStatusBadge status={request.status} />
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-slate-300">{request.requestedBy.name}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-xs text-slate-500">{formatDate(request.createdAt)}</p>
                    </TableCell>
                    {isSuperAdmin && (
                      <TableCell>
                        {request.status === 'pending' ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-green-400 hover:text-green-300 hover:bg-green-500/10 gap-1"
                              onClick={() => openReviewDialog(request, 'approved')}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1"
                              onClick={() => openReviewDialog(request, 'rejected')}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <div className="text-right">
                            {request.reviewedBy && (
                              <p className="text-xs text-slate-500">by {request.reviewedBy}</p>
                            )}
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      </>
      )}

      {activeTab === 'recycle_bin' && (
        <RecycleBinTab
          employees={binEmployees}
          loading={binLoading}
          isSuperAdmin={isSuperAdmin}
          isActioning={isBinActioning}
          onRestore={(emp) => setRestoringTarget(emp)}
          onDelete={(emp) => setDeleteTarget(emp)}
        />
      )}

      {/* Create Cancellation Request Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">New Cancellation Request</DialogTitle>
            <DialogDescription className="text-slate-400">
              Submit a request to cancel/remove an employee. Super admin approval is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Warning */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-amber-200 font-medium">Important Notice</p>
                <p className="text-xs text-amber-400/80 mt-1">
                  Upon submission, the employee will be marked as &quot;Pending Deletion&quot; until a super admin
                  approves or rejects this request. If approved, the employee will be permanently deleted.
                </p>
              </div>
            </div>

            {/* Employee Select */}
            <div className="space-y-2">
              <Label className="text-slate-300">Employee *</Label>
              <SearchableEmployeeSelect
                employees={employees}
                value={formData.employeeId}
                onChange={(id) => setFormData((prev) => ({ ...prev, employeeId: id }))}
              />
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label className="text-slate-300">Reason (optional)</Label>
              <Textarea
                value={formData.reason}
                onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="Enter the reason for cancellation..."
                className="bg-slate-900 border-slate-600 text-white min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateDialogOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isSubmitting}
              className="bg-red-500 hover:bg-red-600 text-white gap-2"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Confirmation Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              {reviewAction === 'approved' ? 'Approve Cancellation' : 'Reject Cancellation'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {reviewingRequest && (
                <>
                  You are about to {reviewAction === 'approved' ? 'approve' : 'reject'} the cancellation request
                  for <span className="text-white font-medium">{reviewingRequest.employee.fullName}</span>{' '}
                  ({reviewingRequest.employee.employeeId}).
                  {reviewAction === 'rejected' && (
                    <span className="block mt-2 text-green-400">
                      The employee will be restored to active status.
                    </span>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {reviewAction === 'approved' && reviewingRequest && (
            <div className="space-y-2 py-1">
              <Label className="text-slate-300 text-sm">On approval, what should happen to the employee?</Label>

              {/* Option 1 — Recycle Bin (soft delete) */}
              <button
                type="button"
                onClick={() => setDeletionMode('soft')}
                className={cn(
                  'w-full text-left p-3 rounded-lg border transition-colors',
                  deletionMode === 'soft'
                    ? 'border-amber-500/60 bg-amber-500/10'
                    : 'border-slate-600 bg-slate-900/60 hover:border-slate-500'
                )}
              >
                <div className="flex items-start gap-3">
                  <ArchiveRestore className={cn('h-5 w-5 mt-0.5 shrink-0', deletionMode === 'soft' ? 'text-amber-400' : 'text-slate-500')} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn('text-sm font-medium', deletionMode === 'soft' ? 'text-amber-200' : 'text-slate-300')}>
                        Move to Recycle Bin
                      </p>
                      <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25 text-[10px] px-1.5 py-0">
                        Restorable
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      The record is soft-deleted (is_deleted flag) with all its history — attendance, salaries,
                      documents — and can be restored any time from the Recycle Bin.
                    </p>
                  </div>
                  <span className={cn('h-4 w-4 rounded-full border-2 mt-0.5 shrink-0', deletionMode === 'soft' ? 'border-amber-400 bg-amber-400' : 'border-slate-500')} />
                </div>
              </button>

              {/* Option 2 — Permanent delete */}
              <button
                type="button"
                onClick={() => setDeletionMode('permanent')}
                className={cn(
                  'w-full text-left p-3 rounded-lg border transition-colors',
                  deletionMode === 'permanent'
                    ? 'border-red-500/60 bg-red-500/10'
                    : 'border-slate-600 bg-slate-900/60 hover:border-slate-500'
                )}
              >
                <div className="flex items-start gap-3">
                  <ShieldAlert className={cn('h-5 w-5 mt-0.5 shrink-0', deletionMode === 'permanent' ? 'text-red-400' : 'text-slate-500')} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn('text-sm font-medium', deletionMode === 'permanent' ? 'text-red-300' : 'text-slate-300')}>
                        Delete Permanently
                      </p>
                      <Badge className="bg-red-500/15 text-red-400 border-red-500/25 text-[10px] px-1.5 py-0">
                        Irreversible
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      The employee record and ALL related data (attendance, salaries, advances, documents,
                      warnings, fines…) are removed from the database forever. This cannot be undone.
                    </p>
                  </div>
                  <span className={cn('h-4 w-4 rounded-full border-2 mt-0.5 shrink-0', deletionMode === 'permanent' ? 'border-red-400 bg-red-400' : 'border-slate-500')} />
                </div>
              </button>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setReviewDialogOpen(false)}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleReview}
              disabled={isReviewing}
              className={cn(
                'gap-2 text-white',
                reviewAction === 'approved'
                  ? deletionMode === 'permanent'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-amber-500 hover:bg-amber-600 text-slate-900'
                  : 'bg-green-500 hover:bg-green-600'
              )}
            >
              {isReviewing && <Loader2 className="h-4 w-4 animate-spin" />}
              {reviewAction === 'approved'
                ? deletionMode === 'permanent'
                  ? 'Approve & Delete Permanently'
                  : 'Approve & Move to Recycle Bin'
                : 'Reject & Restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore confirmation */}
      <AlertDialog open={!!restoringTarget} onOpenChange={(open) => !open && setRestoringTarget(null)}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Restore employee?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {restoringTarget && (
                <>
                  <span className="text-white font-medium">{restoringTarget.fullName}</span> ({restoringTarget.employeeId})
                  will be restored to active status together with all related records — attendance, salaries,
                  documents and history. You can cancel the employee again later if needed.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-700 text-white border-slate-600 hover:bg-slate-600">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRestore}
              disabled={isBinActioning}
              className="bg-green-500 hover:bg-green-600 text-white font-medium"
            >
              {isBinActioning && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Permanent delete confirmation (single) */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete permanently?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {deleteTarget && (
                <>
                  <span className="text-white font-medium">{deleteTarget.fullName}</span> ({deleteTarget.employeeId})
                  and every related record — attendance, salary records, advances, documents, warnings, fines —
                  will be <span className="text-red-400 font-medium">permanently deleted</span>. This action
                  cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-700 text-white border-slate-600 hover:bg-slate-600">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePermanentDelete}
              disabled={isBinActioning}
              className="bg-red-500 hover:bg-red-600 text-white font-medium"
            >
              {isBinActioning && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Delete Forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Empty recycle bin confirmation */}
      <AlertDialog open={emptyBinOpen} onOpenChange={setEmptyBinOpen}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Empty the Recycle Bin?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              All {binEmployees.length} employee record{binEmployees.length === 1 ? '' : 's'} in the Recycle Bin —
              together with every related record — will be{' '}
              <span className="text-red-400 font-medium">permanently deleted</span>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-700 text-white border-slate-600 hover:bg-slate-600">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEmptyBin}
              disabled={isBinActioning}
              className="bg-red-500 hover:bg-red-600 text-white font-medium"
            >
              {isBinActioning && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Empty Bin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ───────── Recycle Bin Tab ───────── */

function RecycleBinTab({
  employees,
  loading,
  isSuperAdmin,
  isActioning,
  onRestore,
  onDelete,
}: {
  employees: RecycleBinEmployee[];
  loading: boolean;
  isSuperAdmin: boolean;
  isActioning: boolean;
  onRestore: (emp: RecycleBinEmployee) => void;
  onDelete: (emp: RecycleBinEmployee) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full bg-slate-700/50" />
        ))}
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <Card className="bg-slate-800 border-slate-700 rounded-xl">
        <CardContent className="py-16 flex flex-col items-center justify-center text-center gap-3">
          <div className="h-14 w-14 rounded-full bg-slate-700/50 flex items-center justify-center">
            <Archive className="h-7 w-7 text-slate-500" />
          </div>
          <p className="text-lg font-medium text-white">The Recycle Bin is empty</p>
          <p className="text-sm text-slate-400 max-w-md">
            When a cancellation is approved with the &quot;Move to Recycle Bin&quot; option (or an employee is
            deleted elsewhere in the app), the record lands here — restorable any time.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-800 border-slate-700 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-700/50 hover:bg-transparent">
              <TableHead className="text-slate-400 font-medium">Employee</TableHead>
              <TableHead className="text-slate-400 font-medium">Last Site</TableHead>
              <TableHead className="text-slate-400 font-medium">Related Records</TableHead>
              <TableHead className="text-slate-400 font-medium">Reason</TableHead>
              <TableHead className="text-slate-400 font-medium">Deleted</TableHead>
              {isSuperAdmin && (
                <TableHead className="text-slate-400 font-medium text-right">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((emp) => {
              const c = emp.relatedCounts;
              const totalRelated = c.attendance + c.salaryRecords + c.documents + c.uniforms + c.warnings + c.fines + c.advances;
              return (
                <TableRow key={emp.id} className="border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium text-white">{emp.fullName}</p>
                      <p className="text-xs text-slate-500">{emp.employeeId}</p>
                      {(emp.position || emp.trade) && (
                        <p className="text-xs text-slate-600">{emp.trade || emp.position}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm text-slate-300">{emp.currentSite || <span className="text-slate-600">—</span>}</p>
                    {emp.nationality && <p className="text-xs text-slate-600">{emp.nationality}</p>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      <Badge className="bg-slate-700/60 text-slate-300 border-slate-600 text-[10px] px-1.5 py-0">
                        {totalRelated} total
                      </Badge>
                      {c.attendance > 0 && <Badge className="bg-blue-500/10 text-blue-300 border-blue-500/20 text-[10px] px-1.5 py-0">{c.attendance} att.</Badge>}
                      {c.salaryRecords > 0 && <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/20 text-[10px] px-1.5 py-0">{c.salaryRecords} salary</Badge>}
                      {c.documents > 0 && <Badge className="bg-violet-500/10 text-violet-300 border-violet-500/20 text-[10px] px-1.5 py-0">{c.documents} docs</Badge>}
                      {(c.warnings > 0 || c.fines > 0) && <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/20 text-[10px] px-1.5 py-0">{c.warnings + c.fines} warn/fine</Badge>}
                      {c.advances > 0 && <Badge className="bg-cyan-500/10 text-cyan-300 border-cyan-500/20 text-[10px] px-1.5 py-0">{c.advances} adv.</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm text-slate-300 max-w-[180px] truncate" title={emp.cancellationReason || ''}>
                      {emp.cancellationReason || <span className="text-slate-600 italic">—</span>}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="text-xs text-slate-500">
                      {emp.deletedAt ? new Date(emp.deletedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                    </p>
                    {emp.deletedAt && (
                      <p className="text-[10px] text-slate-600">
                        {new Date(emp.deletedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </TableCell>
                  {isSuperAdmin && (
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isActioning}
                          className="h-7 text-green-400 hover:text-green-300 hover:bg-green-500/10 gap-1"
                          onClick={() => onRestore(emp)}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                          Restore
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isActioning}
                          className="h-7 text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1"
                          onClick={() => onDelete(emp)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete Forever
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
