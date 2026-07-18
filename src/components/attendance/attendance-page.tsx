'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Calendar,
  List,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock,
  Search,
  MapPin,
  X,
  ChevronDown,
  Building2,
  Users,
  Crown,
  ShieldCheck,
  Share2,
  Copy,
  Loader2,
  FileSpreadsheet,
  Power,
  PowerOff,
  ExternalLink,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/* ───────── types ───────── */
interface Employee {
  id: string;
  fullName: string;
  employeeId: string;
  currentSite: string | null;
  status: string;
  trade: string | null;
  position: string | null;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  // ── Per-site-assignment fields (set when building employeesBySite) ──
  // The date the employee started at this site (clamped to month start).
  // Format: YYYY-MM-DD. Undefined for employees with no site-assignment
  // record (treated as active for the whole month).
  activeFrom?: string;
  // The date the employee left this site (clamped to month end), or null
  // if still at the site. Format: YYYY-MM-DD or null.
  activeUntil?: string | null;
  // True if the employee has been moved away from this site (removedDate
  // is set). Used to fade the row and sort it to the bottom.
  movedAway?: boolean;
  // ── Previous-site info (for the faded out-of-range cells) ──
  // When an employee moved TO this site mid-month (activeFrom > monthStart),
  // previousSite is the name of the site they were at before. Used to show
  // "← SiteName (Nd)" in the faded region of the row so the admin knows
  // where the employee was before. Null if the employee was at this site
  // for the whole month (no faded region to label).
  previousSite?: string | null;
  // Number of days the employee was at the previous site during this month
  // (for display alongside previousSite). 0 if no previous site.
  previousSiteDays?: number;
}

interface SiteOption {
  id: string;
  name: string;
  clientName?: string | null;
  projectName?: string | null;
  isActive: boolean;
}

interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  status: 'present' | 'absent' | 'no_site' | 'overtime' | 'not_marked';
  overtimeHours: number | null;
  employee?: { id: string; fullName: string; employeeId: string };
}

type StatusOption = AttendanceRecord['status'];

/* ───────── helpers ───────── */
const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;
const YEARS = Array.from({ length: 5 }, (_, i) => String(currentYear - 2 + i));

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function formatDate(day: number, monthStr: string, yearStr: string): string {
  return `${yearStr}-${monthStr}-${String(day).padStart(2, '0')}`;
}

function isFutureDate(day: number, month: number, year: number): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const check = new Date(year, month - 1, day);
  return check > today;
}

function isFriday(year: number, month: number, day: number): boolean {
  return new Date(year, month - 1, day).getDay() === 5;
}

function getRelativeDateLabel(day: number, month: number, year: number): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(year, month - 1, day);
  target.setHours(0, 0, 0, 0);
  const diffMs = today.getTime() - target.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays === 2) return '2 days ago';
  if (diffDays === 3) return '3 days ago';
  if (diffDays === 4) return '4 days ago';
  if (diffDays === 5) return '5 days ago';
  if (diffDays === 6) return '6 days ago';
  return null;
}

const STATUS_CONFIG: Record<StatusOption, { label: string; short: string; color: string; dotColor: string }> = {
  present: { label: 'Present', short: 'P', color: 'bg-green-500/20 text-green-400', dotColor: 'bg-green-500' },
  absent: { label: 'Absent', short: 'A', color: 'bg-red-500/20 text-red-400', dotColor: 'bg-red-500' },
  no_site: { label: 'No Site', short: 'NS', color: 'bg-amber-500/20 text-amber-400', dotColor: 'bg-amber-500' },
  overtime: { label: 'Overtime', short: 'O', color: 'bg-blue-500/20 text-blue-400', dotColor: 'bg-blue-500' },
  not_marked: { label: 'Not Marked', short: '-', color: 'bg-slate-600/20 text-slate-500', dotColor: 'bg-slate-600' },
};

const STATUS_OPTIONS: StatusOption[] = ['present', 'absent', 'no_site', 'overtime', 'not_marked'];

/* ───────── Status Dropdown ───────── */
interface StatusDropdownProps {
  employeeId: string;
  date: string;
  currentStatus: StatusOption;
  currentOvertimeHours: number | null;
  onClose: () => void;
  onStatusChange: (employeeId: string, date: string, status: StatusOption, overtimeHours?: number | null) => void;
  position: { top: number; left: number };
}

function StatusDropdown({
  employeeId,
  date,
  currentStatus,
  currentOvertimeHours,
  onClose,
  onStatusChange,
  position,
}: StatusDropdownProps) {
  const [selectedStatus, setSelectedStatus] = useState<StatusOption>(currentStatus);
  const [overtimeHours, setOvertimeHours] = useState<string>(
    currentOvertimeHours ? String(currentOvertimeHours) : '2'
  );
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleConfirm = () => {
    const hours = selectedStatus === 'overtime' ? parseFloat(overtimeHours) || 0 : null;
    onStatusChange(employeeId, date, selectedStatus, hours);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="fixed z-[100] w-52 rounded-xl border border-slate-600 bg-slate-800 p-2 shadow-xl shadow-black/40"
      style={{ top: Math.max(8, position.top - 240), left: Math.min(position.left, window.innerWidth - 220) }}
    >
      <div className="mb-2 px-2 py-1.5 text-xs font-medium text-slate-400 border-b border-slate-700">
        {date}
      </div>
      <div className="flex flex-col gap-0.5">
        {STATUS_OPTIONS.map((status) => {
          const cfg = STATUS_CONFIG[status];
          return (
            <button
              key={status}
              onClick={() => setSelectedStatus(status)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors text-left w-full',
                selectedStatus === status ? 'bg-slate-700/80 text-white' : 'text-slate-300 hover:bg-slate-700/50'
              )}
            >
              <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', cfg.dotColor)} />
              <span>{cfg.label}</span>
              {selectedStatus === status && (
                <Check className="ml-auto h-3.5 w-3.5 text-blue-400" />
              )}
            </button>
          );
        })}
      </div>
      {selectedStatus === 'overtime' && (
        <div className="mt-2 px-2">
          <label className="text-xs text-slate-400 mb-1 block">Overtime Hours</label>
          <Input
            type="number"
            min="0"
            max="24"
            step="0.5"
            value={overtimeHours}
            onChange={(e) => setOvertimeHours(e.target.value)}
            className="h-8 bg-slate-900 border-slate-600 text-white text-sm"
          />
        </div>
      )}
      <div className="mt-2 pt-2 border-t border-slate-700">
        <Button
          onClick={handleConfirm}
          size="sm"
          className="w-full h-8 bg-blue-500 hover:bg-blue-600 text-white text-xs"
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/* ───────── Site List View (per-site collapsible table) ───────── */
interface SiteListViewProps {
  site: SiteOption;
  employees: Employee[];
  attendanceMap: Map<string, AttendanceRecord>;
  daysInMonth: number;
  monthStr: string;
  yearStr: string;
  month: number;
  year: number;
  isCurrentMonthView: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onStatusChange: (employeeId: string, date: string, status: StatusOption, overtimeHours?: number | null) => void;
  onBulkMark: (siteId: string, siteName: string, date: string, status: 'present' | 'absent', employeeIds: string[]) => Promise<void>;
  onShare: () => void;
  onAttendanceSheet: () => void;
}

function SiteListView({
  site,
  employees,
  attendanceMap,
  daysInMonth,
  monthStr,
  yearStr,
  month,
  year,
  isCurrentMonthView,
  isCollapsed,
  onToggleCollapse,
  onStatusChange,
  onBulkMark,
  onShare,
  onAttendanceSheet,
}: SiteListViewProps) {
  const [dropdown, setDropdown] = useState<{
    employeeId: string;
    date: string;
    status: StatusOption;
    overtimeHours: number | null;
    position: { top: number; left: number };
  } | null>(null);

  // ── Bulk-mark state ──
  // Defaults to today's date (in YYYY-MM-DD) so the admin can mark "today"
  // with one click. The date input is constrained to the current month
  // being viewed (the parent passes monthStr/yearStr).
  const todayStr = new Date().toISOString().split('T')[0];
  const [bulkMarkDate, setBulkMarkDate] = useState<string>(todayStr);
  const [bulkMarkStatus, setBulkMarkStatus] = useState<'present' | 'absent'>('present');
  const [bulkMarkLoading, setBulkMarkLoading] = useState(false);

  // Sort:
  //   1. Active employees (movedAway !== true) first — Team Leaders, then
  //      Supervisors, then everyone else, alphabetically by name.
  //   2. Moved-away employees (movedAway === true) at the VERY BOTTOM,
  //      alphabetically by name. These are employees who were at this site
  //      during the month but have since been moved to another site. We
  //      keep them visible (with a faded row) so the site's history is
  //      preserved — you can still see who worked here and for how many
  //      days — but they sink to the bottom so the active roster is at top.
  const sortedEmployees = useMemo(() => {
    return [...employees].sort((a, b) => {
      // Moved-away employees always sort after active employees
      const aMoved = a.movedAway ? 1 : 0;
      const bMoved = b.movedAway ? 1 : 0;
      if (aMoved !== bMoved) return aMoved - bMoved;
      // Within the same moved/active group: TL first, then SUP, then others
      const aRank = a.isTeamLeader ? 0 : a.isSupervisor ? 1 : 2;
      const bRank = b.isTeamLeader ? 0 : b.isSupervisor ? 1 : 2;
      if (aRank !== bRank) return aRank - bRank;
      return (a.fullName || '').localeCompare(b.fullName || '');
    });
  }, [employees]);

  // For current month: today on the left, all previous dates to the right
  const displayDays = useMemo(() => {
    if (isCurrentMonthView) {
      const today = new Date();
      const currentDay = today.getDate();
      return Array.from({ length: currentDay }, (_, i) => currentDay - i);
    }
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }, [daysInMonth, isCurrentMonthView]);

  const getDayLabel = useCallback(
    (day: number): string => {
      if (!isCurrentMonthView) return String(day);
      const relLabel = getRelativeDateLabel(day, month, year);
      return relLabel || String(day);
    },
    [isCurrentMonthView, month, year]
  );

  const isRecentDay = useCallback(
    (day: number): boolean => {
      if (!isCurrentMonthView) return false;
      return getRelativeDateLabel(day, month, year) !== null;
    },
    [isCurrentMonthView, month, year]
  );

  // Site-level stats for the header.
  // Only counts employees who are IN RANGE for today (i.e. not moved-away
  // employees whose active range doesn't include today). This keeps the
  // "present/absent/unmarked" counts accurate for the current active roster.
  const siteStats = useMemo(() => {
    let present = 0;
    let absent = 0;
    let unmarked = 0;
    let activeCount = 0;
    const today = new Date();
    const todayStr = isCurrentMonthView
      ? formatDate(today.getDate(), monthStr, yearStr)
      : null;
    if (todayStr) {
      for (const emp of employees) {
        // Skip employees who are out of range today (moved away before today
        // or haven't started yet). They shouldn't count toward the site's
        // present/absent/unmarked stats.
        if (emp.activeFrom && todayStr < emp.activeFrom) continue;
        if (emp.activeUntil && todayStr > emp.activeUntil) continue;
        activeCount++;
        const rec = attendanceMap.get(`${emp.id}-${todayStr}`);
        if (!rec || rec.status === 'not_marked') unmarked++;
        else if (rec.status === 'present' || rec.status === 'overtime') present++;
        else absent++;
      }
    }
    return { present, absent, unmarked, total: activeCount };
  }, [employees, attendanceMap, isCurrentMonthView, monthStr, yearStr]);

  // Handle bulk mark for this site.
  // Only includes employees who were actually at this site on the selected
  // date (i.e. the date falls within their activeFrom–activeUntil range).
  // Moved-away employees whose range doesn't include the selected date are
  // excluded — we can't mark attendance for a date they weren't at the site.
  const handleBulkMark = useCallback(async () => {
    if (employees.length === 0) return;
    if (!bulkMarkDate) {
      toast({ title: 'Date required', description: 'Please pick a date first.', variant: 'destructive' });
      return;
    }
    // Filter to employees in range for the selected date
    const eligibleEmps = employees.filter((emp) => {
      if (emp.activeFrom && bulkMarkDate < emp.activeFrom) return false;
      if (emp.activeUntil && bulkMarkDate > emp.activeUntil) return false;
      return true;
    });
    if (eligibleEmps.length === 0) {
      toast({
        title: 'No eligible employees',
        description: 'No employees were at this site on the selected date.',
        variant: 'destructive',
      });
      return;
    }
    setBulkMarkLoading(true);
    try {
      await onBulkMark(site.id, site.name, bulkMarkDate, bulkMarkStatus, eligibleEmps.map((e) => e.id));
    } finally {
      setBulkMarkLoading(false);
    }
  }, [employees, bulkMarkDate, bulkMarkStatus, onBulkMark, site.id, site.name]);

  return (
    <Card className="bg-slate-800/50 border-slate-700/50 overflow-hidden">
      {/* Site header (clickable to collapse/expand).
          Note: this is a <div> with role="button" rather than a real <button>
          because it contains action buttons (Share / Sheet) as children, and
          HTML forbids nesting <button> inside <button>. Using a div keeps the
          action buttons as real buttons for accessibility while still
          allowing the whole header to be clickable for collapse/expand. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleCollapse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapse();
          }
        }}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-900/40 hover:bg-slate-900/60 transition-colors text-left border-b border-slate-700/50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        <div className="flex items-center gap-3 min-w-0">
          {isCollapsed ? (
            <ChevronRight className="h-5 w-5 text-slate-400 shrink-0" />
          ) : (
            <ChevronDown className="h-5 w-5 text-slate-400 shrink-0" />
          )}
          <div className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg shrink-0',
            site.isActive ? 'bg-emerald-500/10' : 'bg-slate-600/20',
          )}>
            <Building2 className={cn(
              'h-4 w-4',
              site.isActive ? 'text-emerald-400' : 'text-slate-500',
            )} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white truncate">{site.name}</span>
              {site.clientName && (
                <span className="text-[11px] text-slate-400 truncate hidden sm:inline">· {site.clientName}</span>
              )}
              {!site.isActive && (
                <Badge className="bg-slate-700 text-slate-300 text-[9px] px-1.5 py-0 h-4">Inactive</Badge>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              <Users className="h-2.5 w-2.5 inline mr-0.5" />
              {employees.length} employee{employees.length !== 1 ? 's' : ''}
              {isCurrentMonthView && siteStats.total > 0 && (
                <>
                  <span className="mx-1.5">·</span>
                  <span className="text-emerald-400">{siteStats.present} present</span>
                  <span className="mx-1">·</span>
                  <span className="text-red-400">{siteStats.absent} absent</span>
                  {siteStats.unmarked > 0 && (
                    <>
                      <span className="mx-1">·</span>
                      <span className="text-slate-400">{siteStats.unmarked} unmarked</span>
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* Share button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onShare}
            disabled={employees.length === 0}
            className="h-7 text-[11px] text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 gap-1"
            title="Generate shareable attendance link"
          >
            <Share2 className="h-3 w-3" />
            <span className="hidden sm:inline">Share</span>
          </Button>
          {/* Attendance Sheet button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onAttendanceSheet}
            disabled={employees.length === 0}
            className="h-7 text-[11px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 gap-1"
            title="Open printable attendance sheet"
          >
            <FileSpreadsheet className="h-3 w-3" />
            <span className="hidden sm:inline">Sheet</span>
          </Button>
        </div>
      </div>

      {/* Bulk-mark bar (only when site is expanded) */}
      {!isCollapsed && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-slate-900/30 border-b border-slate-700/50">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 uppercase tracking-wide font-medium">
            <Calendar className="h-3 w-3" />
            Mark all
          </div>
          <input
            type="date"
            value={bulkMarkDate}
            onChange={(e) => setBulkMarkDate(e.target.value)}
            className="h-7 px-2 text-xs bg-slate-900 border border-slate-600 rounded text-white focus:outline-none focus:border-emerald-500/50"
            // Constrain to the month currently being viewed
            min={`${yearStr}-${monthStr}-01`}
            max={`${yearStr}-${monthStr}-${String(daysInMonth).padStart(2, '0')}`}
            title="Date to mark all employees"
          />
          <div className="flex items-center bg-slate-800 rounded-md border border-slate-700 p-0.5">
            <button
              type="button"
              onClick={() => setBulkMarkStatus('present')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
                bulkMarkStatus === 'present'
                  ? 'bg-emerald-500 text-white'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              <Check className="h-3 w-3" />
              Present
            </button>
            <button
              type="button"
              onClick={() => setBulkMarkStatus('absent')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
                bulkMarkStatus === 'absent'
                  ? 'bg-red-500 text-white'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              <X className="h-3 w-3" />
              Absent
            </button>
          </div>
          <Button
            size="sm"
            onClick={handleBulkMark}
            disabled={bulkMarkLoading || employees.length === 0 || !bulkMarkDate}
            className={cn(
              'h-7 text-[11px] gap-1.5',
              bulkMarkStatus === 'present'
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-red-600 hover:bg-red-700 text-white',
            )}
            title={`Mark all ${employees.length} employee(s) as ${bulkMarkStatus} on ${bulkMarkDate}`}
          >
            {bulkMarkLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Mark all {employees.length} as {bulkMarkStatus === 'present' ? 'Present' : 'Absent'}
          </Button>
          <p className="text-[10px] text-slate-500 ml-auto hidden md:block">
            Overtime records are preserved when marking Present.
          </p>
        </div>
      )}

      {/* Collapsible table */}
      {!isCollapsed && (
        <ScrollArea className="w-full">
          <div className="min-w-[1000px]">
            {/* Header row */}
            <div className="flex items-center bg-slate-900/80 border-b border-slate-700 text-xs font-medium text-slate-400 sticky top-0 z-10">
              <div className="w-52 shrink-0 px-4 py-3">Employee</div>
              <div className="w-28 shrink-0 px-3 py-3">Emp. Code</div>
              <div className="w-28 shrink-0 px-3 py-3">Trade</div>
              <div className="flex-1 flex">
                {displayDays.map((day) => {
                  const isFri = isFriday(year, month, day);
                  const label = getDayLabel(day);
                  const recent = isRecentDay(day);
                  return (
                    <div
                      key={day}
                      className={cn(
                        'w-16 shrink-0 text-center py-3 leading-tight',
                        isFri && 'text-red-400/50',
                        recent && 'text-emerald-400 font-semibold'
                      )}
                    >
                      <span className={cn(recent && 'text-[10px] block')}>{label}</span>
                    </div>
                  );
                })}
              </div>
              <div className="w-16 shrink-0 text-center py-3 px-2">OT</div>
            </div>

            {/* Employee rows */}
            <div className="divide-y divide-slate-700/50">
              {sortedEmployees.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  No active employees assigned to this site.
                </div>
              ) : (
                sortedEmployees.map((emp) => {
                  const totalOT = Array.from(attendanceMap.values())
                    .filter((r) => r.employeeId === emp.id && r.status === 'overtime')
                    .reduce((sum, r) => sum + (r.overtimeHours || 0), 0);

                  // Determine if this employee has been moved away from this
                  // site (removedDate is set on their site-assignment record).
                  // Moved-away employees get a faded row effect and sink to
                  // the bottom of the list (handled by sortedEmployees above).
                  const isMovedAway = !!emp.movedAway;

                  return (
                    <div
                      key={`${emp.id}-${emp.activeFrom || 'active'}`}
                      className={cn(
                        'flex items-center transition-colors',
                        // Faded effect for moved-away employees — the whole
                        // row is dimmed so it's visually clear they're no
                        // longer at this site, but still visible for history.
                        isMovedAway && 'opacity-40',
                        !isMovedAway && 'hover:bg-slate-700/20',
                        emp.isTeamLeader && !isMovedAway && 'bg-amber-500/5',
                        emp.isSupervisor && !emp.isTeamLeader && !isMovedAway && 'bg-blue-500/5',
                      )}
                    >
                      <div className="w-52 shrink-0 px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            'text-sm font-medium truncate block',
                            isMovedAway ? 'text-slate-400' : 'text-white'
                          )}>
                            {emp.fullName}
                          </span>
                          {emp.isTeamLeader && (
                            <Crown className="h-3 w-3 text-amber-400 shrink-0" />
                          )}
                          {emp.isSupervisor && !emp.isTeamLeader && (
                            <ShieldCheck className="h-3 w-3 text-blue-400 shrink-0" />
                          )}
                          {isMovedAway && (
                            <span className="text-[9px] text-slate-500 bg-slate-700/50 px-1 py-0.5 rounded shrink-0">
                              moved
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="w-28 shrink-0 px-3 py-2.5">
                        <span className="text-xs text-slate-400 font-mono">{emp.employeeId}</span>
                      </div>
                      <div className="w-28 shrink-0 px-3 py-2.5">
                        <span className="text-xs text-slate-400 truncate block">
                          {emp.trade || emp.position || '—'}
                          {emp.isTeamLeader && <span className="text-amber-400"> / TL</span>}
                          {emp.isSupervisor && !emp.isTeamLeader && <span className="text-blue-400"> / SUP</span>}
                        </span>
                      </div>
                      <div className="flex-1 flex">
                        {displayDays.map((day, dayIdx) => {
                          const dateStr = formatDate(day, monthStr, yearStr);
                          const record = attendanceMap.get(`${emp.id}-${dateStr}`);
                          const status = record?.status || 'not_marked';
                          const cfg = STATUS_CONFIG[status];
                          const isFri = isFriday(year, month, day);
                          const recent = isRecentDay(day);

                          // ── Date-range check ──
                          // If the employee has an activeFrom/activeUntil
                          // range (from EmpCountSitePerMonth), check whether
                          // this day falls within it. Days outside the range
                          // are rendered as faded non-interactive cells —
                          // the user can see the cell exists but can't mark
                          // it, because the employee wasn't at this site on
                          // that day.
                          //
                          // activeFrom is inclusive (employee started this day).
                          // activeUntil is inclusive (employee's last day at site).
                          // activeUntil === null means still at the site.
                          let isInRange = true;
                          if (emp.activeFrom && dateStr < emp.activeFrom) {
                            isInRange = false;
                          }
                          if (emp.activeUntil && dateStr > emp.activeUntil) {
                            isInRange = false;
                          }

                          // Out-of-range cell: faded, non-interactive, no
                          // attendance status shown (the attendance record
                          // belongs to a different site for this date).
                          if (!isInRange) {
                            // Determine if this is the FIRST faded cell of a
                            // contiguous faded region. We show the previous-site
                            // label on the first faded cell so the admin can see
                            // where the employee was before (or after) this site.
                            //
                            // "First faded cell" = either the very first cell
                            // (dayIdx === 0) OR the previous cell was in-range.
                            // We compute prevDateStr for the previous displayDay.
                            let isFirstFaded = dayIdx === 0;
                            if (dayIdx > 0) {
                              const prevDay = displayDays[dayIdx - 1];
                              const prevDateStr = formatDate(prevDay, monthStr, yearStr);
                              let prevInRange = true;
                              if (emp.activeFrom && prevDateStr < emp.activeFrom) prevInRange = false;
                              if (emp.activeUntil && prevDateStr > emp.activeUntil) prevInRange = false;
                              if (prevInRange) isFirstFaded = true;
                            }

                            // Build the tooltip text: shows where the employee
                            // was on this date (previous site or "not yet at
                            // this site").
                            const tooltipText = emp.previousSite
                              ? `Was at ${emp.previousSite} (${emp.previousSiteDays ?? 0}d) — not at this site on this date`
                              : 'Employee was not at this site on this date';

                            return (
                              <div
                                key={day}
                                className={cn(
                                  'w-16 shrink-0 flex items-center justify-center py-1.5 relative',
                                  isFri && 'bg-red-500/5',
                                )}
                              >
                                {/* Previous-site label — shown once at the start
                                    of the faded region. Overlays the faded cells
                                    with a small "← SiteName (Nd)" badge so the
                                    admin knows where the employee was before. */}
                                {isFirstFaded && emp.previousSite && (
                                  <div
                                    className="absolute left-1 top-1/2 -translate-y-1/2 z-10 flex items-center gap-0.5 px-1 py-0.5 rounded bg-slate-800/80 border border-slate-700/50 pointer-events-none whitespace-nowrap"
                                    title={tooltipText}
                                  >
                                    <span className="text-[8px] text-slate-500">←</span>
                                    <span className="text-[8px] text-slate-400 font-medium truncate max-w-[60px]">
                                      {emp.previousSite}
                                    </span>
                                    {(emp.previousSiteDays ?? 0) > 0 && (
                                      <span className="text-[8px] text-slate-500 font-mono">
                                        {emp.previousSiteDays ?? 0}d
                                      </span>
                                    )}
                                  </div>
                                )}
                                <span
                                  className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-slate-800/40 text-slate-700 cursor-not-allowed"
                                  title={tooltipText}
                                >
                                  ·
                                </span>
                              </div>
                            );
                          }

                          // In-range cell: normal interactive button
                          return (
                            <div
                              key={day}
                              className={cn(
                                'w-16 shrink-0 flex items-center justify-center py-1.5',
                                isFri && 'bg-red-500/5',
                                recent && 'bg-emerald-500/5'
                              )}
                            >
                              <button
                                onClick={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setDropdown({
                                    employeeId: emp.id,
                                    date: dateStr,
                                    status,
                                    overtimeHours: record?.overtimeHours || null,
                                    position: { top: rect.top, left: rect.left },
                                  });
                                }}
                                className={cn(
                                  'h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all hover:ring-2 hover:ring-slate-500/50',
                                  cfg.color
                                )}
                                title={`${cfg.label}${status === 'overtime' && record?.overtimeHours ? ` (${record.overtimeHours}h)` : ''}`}
                              >
                                {cfg.short}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div className="w-16 shrink-0 text-center py-2.5 px-2">
                        {totalOT > 0 ? (
                          <span className="text-xs font-medium text-blue-400">{totalOT}h</span>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}

      {/* Legend */}
      {!isCollapsed && (
        <div className="flex flex-wrap gap-3 px-4 py-3 border-t border-slate-700/50">
          {STATUS_OPTIONS.map((s) => {
            const cfg = STATUS_CONFIG[s];
            return (
              <div key={s} className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', cfg.dotColor)} />
                <span className="text-[11px] text-slate-400">{cfg.label}</span>
              </div>
            );
          })}
          <div className="flex items-center gap-1.5">
            <Crown className="h-2.5 w-2.5 text-amber-400" />
            <span className="text-[11px] text-slate-400">Team Leader</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-2.5 w-2.5 text-blue-400" />
            <span className="text-[11px] text-slate-400">Supervisor</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-400/40" />
            <span className="text-[11px] text-slate-400">Friday</span>
          </div>
        </div>
      )}

      {/* Status Dropdown */}
      {dropdown && (
        <StatusDropdown
          employeeId={dropdown.employeeId}
          date={dropdown.date}
          currentStatus={dropdown.status}
          currentOvertimeHours={dropdown.overtimeHours}
          onStatusChange={onStatusChange}
          onClose={() => setDropdown(null)}
          position={dropdown.position}
        />
      )}
    </Card>
  );
}

/* ───────── Main Page ───────── */
export function AttendancePage() {
  const [selectedMonth, setSelectedMonth] = useState<string>(String(currentMonth).padStart(2, '0'));
  const [selectedYear, setSelectedYear] = useState<string>(String(currentYear));

  // Sites + employees (ALL active employees, grouped client-side by site)
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  // Site assignments (EmpCountSitePerMonth) for the viewed month. Each record
  // tells us when an employee started (createdDate) and left (removedDate) a
  // site, so we can show moved-away employees at their old site with faded
  // out-of-range cells, and at their new site only from the move date.
  const [siteAssignments, setSiteAssignments] = useState<Array<{
    empId: string;
    empName: string;
    siteId: string;
    siteName: string;
    createdDate: string;
    removedDate: string | null;
  }>>([]);
  const [loadingSites, setLoadingSites] = useState(true);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [loadingAttendance, setLoadingAttendance] = useState(true);

  const [search, setSearch] = useState('');
  const [searchDebounce, setSearchDebounce] = useState('');
  const [collapsedSites, setCollapsedSites] = useState<Set<string>>(new Set());

  // Share dialog state
  const [shareDialogSite, setShareDialogSite] = useState<SiteOption | null>(null);
  const [shareDate, setShareDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Attendance sheet (existing component) state
  const [attendanceSheetSite, setAttendanceSheetSite] = useState<SiteOption | null>(null);

  const month = parseInt(selectedMonth, 10);
  const year = parseInt(selectedYear, 10);
  const monthStr = selectedMonth;
  const yearStr = selectedYear;
  const daysInMonth = getDaysInMonth(year, month);

  const isCurrentMonthView = month === currentMonth && year === currentYear;

  // Build attendance map: key = "employeeId-date"
  const attendanceMap = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of attendanceRecords) {
      map.set(`${r.employeeId}-${r.date}`, r);
    }
    return map;
  }, [attendanceRecords]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchDebounce(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch sites
  useEffect(() => {
    const fetchSites = async () => {
      try {
        const res = await fetch('/api/sites');
        const data = await res.json();
        if (data.success) {
          const s: SiteOption[] = (data.data.sites || []).map((s: Record<string, unknown>) => ({
            id: s.id as string,
            name: s.name as string,
            clientName: (s.clientName as string | null | undefined) || null,
            projectName: (s.projectName as string | null | undefined) || null,
            isActive: s.isActive as boolean,
          }));
          // Show only active sites first, then inactive — both alphabetical
          s.sort((a, b) => {
            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          setSites(s);
        }
      } catch {
        // silent
      } finally {
        setLoadingSites(false);
      }
    };
    fetchSites();
  }, []);

  // Fetch ALL active employees (we'll group them by site client-side)
  useEffect(() => {
    let cancelled = false;
    const fetchEmployees = async () => {
      setLoadingEmployees(true);
      try {
        // Pull up to 1000 active employees — covers most installations.
        // We fetch all and group client-side so the page can render all
        // sites in one shot without per-site fetches.
        const res = await fetch(`/api/employees?limit=1000&status=active`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          // Exclude 'Idle' (no currentSite) employees from the attendance grid
          const emps: Employee[] = (data.data.employees || [])
            .filter((e: Employee) => e.currentSite && e.currentSite !== 'Idle')
            .map((e: Employee) => ({
              id: e.id,
              fullName: e.fullName,
              employeeId: e.employeeId,
              currentSite: e.currentSite,
              status: e.status,
              trade: e.trade || null,
              position: (e as { position?: string | null }).position || null,
              isTeamLeader: (e as { isTeamLeader?: boolean }).isTeamLeader || false,
              isSupervisor: (e as { isSupervisor?: boolean }).isSupervisor || false,
            }));
          setEmployees(emps);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoadingEmployees(false);
      }
    };
    fetchEmployees();
    return () => { cancelled = true; };
  }, []);

  // Fetch attendance
  useEffect(() => {
    let cancelled = false;
    const fetchAttendance = async () => {
      setLoadingAttendance(true);
      try {
        const monthParam = `${yearStr}-${monthStr}`;
        const res = await fetch(`/api/attendance?month=${monthParam}&year=${yearStr}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setAttendanceRecords(data.data.records || []);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoadingAttendance(false);
      }
    };
    fetchAttendance();
    return () => { cancelled = true; };
  }, [yearStr, monthStr]);

  // Fetch site assignments (EmpCountSitePerMonth) for the viewed month.
  // This tells us which employees were at which site when, including
  // employees who have since moved to another site (removedDate is set).
  // Without this, moved-away employees would disappear from their old
  // site's attendance grid entirely, losing the history of who worked
  // where and for how many days.
  useEffect(() => {
    let cancelled = false;
    const fetchSiteAssignments = async () => {
      try {
        const monthParam = `${yearStr}-${monthStr}`;
        const res = await fetch(`/api/attendance/site-assignments?month=${monthParam}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setSiteAssignments(data.data.assignments || []);
        }
      } catch {
        // silent — site assignments are optional, the page still works
        // without them (falls back to currentSite-only grouping)
      }
    };
    fetchSiteAssignments();
    return () => { cancelled = true; };
  }, [yearStr, monthStr]);

  // Group employees by site name.
  //
  // We merge TWO sources:
  //   1. Current active employees grouped by their currentSite — these are
  //      employees who are at the site RIGHT NOW (no removedDate).
  //   2. Site assignments from EmpCountSitePerMonth — these include
  //      employees who were at the site during the month but have since
  //      moved away (removedDate is set). We add them to the site's list
  //      with their date range (activeFrom/activeUntil) and movedAway=true.
  //
  // For employees who are at their current site AND have a site-assignment
  // record, we use the record's createdDate/removedDate to set the date
  // range (so the grid knows exactly which days they were active).
  //
  // Employees with movedAway=true are sorted to the bottom of the list by
  // SiteListView's sortedEmployees, and their rows get a faded effect.
  const employeesBySite = useMemo(() => {
    const map = new Map<string, Employee[]>();
    const monthPrefix = `${yearStr}-${monthStr}-`; // e.g. "2026-07-"
    const daysInMonthNum = new Date(parseInt(yearStr), parseInt(monthStr), 0).getDate();
    const monthStartStr = `${monthPrefix}01`;
    const monthEndStr = `${monthPrefix}${String(daysInMonthNum).padStart(2, '0')}`;

    // Helper: clamp a date string to [monthStart, monthEnd].
    const clampToMonth = (dateStr: string): string => {
      if (dateStr < monthStartStr) return monthStartStr;
      if (dateStr > monthEndStr) return monthEndStr;
      return dateStr;
    };

    // Track which (empId, siteName) pairs we've already added so we don't
    // duplicate. An employee can appear at multiple sites (old + new).
    const added = new Set<string>();

    // Helper: compute the number of days between two YYYY-MM-DD strings
    // (inclusive of both endpoints). Returns 0 if either is empty.
    const daysBetween = (startStr: string, endStr: string): number => {
      if (!startStr || !endStr || endStr < startStr) return 0;
      const start = new Date(startStr + 'T00:00:00');
      const end = new Date(endStr + 'T00:00:00');
      return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    };

    // 1. Add employees from site-assignments FIRST (so we can set date ranges).
    //    This includes both active and moved-away employees.
    //
    //    CRITICAL: an employee's currentSite (from the Employee record) is the
    //    source of truth for "where are they RIGHT NOW". If a site-assignment
    //    record has removedDate set BUT the employee's currentSite matches
    //    that site, the removedDate is stale (e.g. the employee left and came
    //    back, or the API didn't clear it). In that case we treat the employee
    //    as ACTIVE at that site (movedAway=false, activeUntil=null) — NOT
    //    moved-away. Without this, an employee who moved A→B would show as
    //    inactive at BOTH sites (stale removedDate on B's record + real
    //    removedDate on A's record), which is the bug we're fixing.
    for (const assignment of siteAssignments) {
      const emp = employees.find((e) => e.id === assignment.empId);
      if (!emp) continue; // employee not in active list — skip

      const siteName = assignment.siteName;
      if (!added.has(`${emp.id}::${siteName}`)) {
        added.add(`${emp.id}::${siteName}`);
        if (!map.has(siteName)) map.set(siteName, []);

        // Is this site the employee's CURRENT site? If so, the employee is
        // active here regardless of what removedDate says.
        const isCurrentSite = emp.currentSite === siteName;

        // createdDate is when the EmpCountSitePerMonth record was created,
        // which could be a previous month if the employee was assigned
        // before this month. Clamp to month start.
        const activeFrom = clampToMonth(assignment.createdDate.split('T')[0]);

        // removedDate is when the employee left the site. Clamp to month end.
        // If null, the employee is still at the site (activeUntil = null).
        // If this is the employee's current site, ignore removedDate (stale).
        const activeUntil = !isCurrentSite && assignment.removedDate
          ? clampToMonth(assignment.removedDate.split('T')[0])
          : null;

        // movedAway = true only if removedDate is set AND this is NOT the
        // employee's current site. If it IS the current site, the employee
        // is active here (the removedDate is stale).
        const movedAway = !isCurrentSite && !!assignment.removedDate;

        // ── Compute previousSite info ──
        // If the employee moved TO this site mid-month (activeFrom > monthStart),
        // there should be another site-assignment record for this employee at
        // a DIFFERENT site where removedDate ≈ this site's activeFrom. That
        // other site is the "previous site" — we show its name + days in the
        // faded region of this row so the admin knows where the employee was.
        //
        // We look for any other assignment for this employee (same empId,
        // different siteName) where removedDate is set and removedDate is on
        // or before this assignment's createdDate (they left the old site
        // before/when they started here). If found, that's the previous site.
        let previousSite: string | null = null;
        let previousSiteDays = 0;
        if (activeFrom > monthStartStr) {
          // Employee started here after month start — they were somewhere else
          // before. Find the previous-site assignment.
          for (const other of siteAssignments) {
            if (other.empId !== assignment.empId) continue;
            if (other.siteName === siteName) continue; // same site — skip
            if (!other.removedDate) continue; // still there — not a "previous" site
            const otherRemovedStr = clampToMonth(other.removedDate.split('T')[0]);
            // The other site's removedDate should be on or after this site's
            // activeFrom (they left the old site when/before starting here).
            // Use a small window (±1 day) to handle same-day moves.
            if (otherRemovedStr <= activeFrom) {
              const otherCreatedStr = clampToMonth(other.createdDate.split('T')[0]);
              previousSite = other.siteName;
              previousSiteDays = daysBetween(otherCreatedStr, otherRemovedStr);
              break; // take the first match (closest by createdDate)
            }
          }
        }

        map.get(siteName)!.push({
          ...emp,
          activeFrom,
          activeUntil,
          movedAway,
          previousSite,
          previousSiteDays,
        });
      }
    }

    // 2. Add current employees at their currentSite IF not already added
    //    via site-assignments (fallback for employees with no assignment
    //    record — e.g. if the month's records haven't been created yet).
    for (const emp of employees) {
      const siteName = emp.currentSite || '';
      if (!siteName || siteName === 'Idle') continue;
      if (!added.has(`${emp.id}::${siteName}`)) {
        added.add(`${emp.id}::${siteName}`);
        if (!map.has(siteName)) map.set(siteName, []);
        // No assignment record — treat as active for the whole month
        map.get(siteName)!.push({
          ...emp,
          activeFrom: monthStartStr,
          activeUntil: null,
          movedAway: false,
        });
      }
    }

    return map;
  }, [employees, siteAssignments, yearStr, monthStr]);

  // Apply search filter (matches employee name/ID/trade)
  const filteredEmployeesBySite = useMemo(() => {
    if (!searchDebounce.trim()) return employeesBySite;
    const q = searchDebounce.toLowerCase();
    const map = new Map<string, Employee[]>();
    for (const [siteName, emps] of employeesBySite.entries()) {
      const filtered = emps.filter((e) =>
        e.fullName.toLowerCase().includes(q) ||
        e.employeeId.toLowerCase().includes(q) ||
        (e.trade || '').toLowerCase().includes(q)
      );
      if (filtered.length > 0) map.set(siteName, filtered);
    }
    return map;
  }, [employeesBySite, searchDebounce]);

  // Handle status change
  const handleStatusChange = useCallback(
    async (employeeId: string, date: string, status: StatusOption, overtimeHours?: number | null) => {
      try {
        const body: Record<string, unknown> = { employeeId, date, status };
        if (status === 'overtime' && overtimeHours !== undefined && overtimeHours !== null) {
          body.overtimeHours = overtimeHours;
        }
        const res = await fetch('/api/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.success) {
          setAttendanceRecords((prev) => {
            const exists = prev.find(
              (r) => r.employeeId === employeeId && r.date === date
            );
            if (exists) {
              return prev.map((r) =>
                r.employeeId === employeeId && r.date === date
                  ? { ...r, status, overtimeHours: status === 'overtime' ? (overtimeHours ?? null) : null }
                  : r
              );
            }
            return [
              ...prev,
              {
                id: data.data.attendance.id,
                employeeId,
                date,
                status,
                overtimeHours: status === 'overtime' ? (overtimeHours ?? null) : null,
              },
            ];
          });
          toast({ title: 'Updated', description: `Attendance marked as ${STATUS_CONFIG[status].label}` });
        } else {
          toast({ title: 'Error', description: data.error || 'Failed to update attendance', variant: 'destructive' });
        }
      } catch {
        toast({ title: 'Error', description: 'Failed to update attendance', variant: 'destructive' });
      }
    },
    []
  );

  // Bulk-mark all employees at a site as present/absent for a given date.
  // Calls the existing /api/attendance/bulk-mark endpoint (which already
  // accepts a custom status + employeeIds array, preserves overtime records
  // when marking present, captures a version snapshot per site, and runs the
  // 10-hour salary sync for each present mark).
  const handleBulkMark = useCallback(
    async (siteId: string, siteName: string, date: string, status: 'present' | 'absent', employeeIds: string[]) => {
      if (employeeIds.length === 0) return;
      try {
        const res = await fetch('/api/attendance/bulk-mark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, status, employeeIds }),
        });
        const data = await res.json();
        if (data.success) {
          // Refetch all attendance records for the current month so the grid
          // reflects the bulk-marked statuses immediately. This is simpler
          // than hand-updating N records in local state and guarantees
          // consistency with what the server wrote (including the overtime
          // preservation logic).
          const monthParam = `${yearStr}-${monthStr}`;
          const attRes = await fetch(`/api/attendance?month=${monthParam}&year=${yearStr}`);
          const attData = await attRes.json();
          if (attData.success) {
            setAttendanceRecords(attData.data.records || []);
          }
          const updated = data.data.updated || 0;
          const skipped = data.data.skipped || 0;
          toast({
            title: 'Bulk mark complete',
            description: `${updated} employee(s) marked as ${status} for ${siteName} on ${date}${skipped > 0 ? `. ${skipped} skipped (already ${status === 'present' ? 'overtime' : 'marked'}).` : ''}`,
          });
        } else {
          toast({ title: 'Error', description: data.error || 'Failed to bulk mark attendance', variant: 'destructive' });
        }
      } catch {
        toast({ title: 'Error', description: 'Failed to bulk mark attendance', variant: 'destructive' });
      }
    },
    [yearStr, monthStr]
  );

  // Navigation handlers
  const goToPrevMonth = () => {
    let m = month - 1;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    setSelectedMonth(String(m).padStart(2, '0'));
    setSelectedYear(String(y));
  };

  const goToNextMonth = () => {
    let m = month + 1;
    let y = year;
    if (m > 12) { m = 1; y += 1; }
    setSelectedMonth(String(m).padStart(2, '0'));
    setSelectedYear(String(y));
  };

  const isCurrentMonth = month === currentMonth && year === currentYear;
  const monthLabel = MONTHS.find((m) => m.value === monthStr)?.label || '';

  // Toggle site collapse
  const toggleSiteCollapse = useCallback((siteName: string) => {
    setCollapsedSites((prev) => {
      const next = new Set(prev);
      if (next.has(siteName)) next.delete(siteName);
      else next.add(siteName);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedSites(new Set(sites.map((s) => s.name)));
  }, [sites]);

  const expandAll = useCallback(() => {
    setCollapsedSites(new Set());
  }, []);

  // ── Share handlers ──
  const openShareDialog = useCallback((site: SiteOption) => {
    setShareDialogSite(site);
    setShareUrl(null);
    setShareDate(new Date().toISOString().split('T')[0]);
  }, []);

  const closeShareDialog = useCallback(() => {
    setShareDialogSite(null);
    setShareUrl(null);
  }, []);

  const handleGenerateShare = useCallback(async () => {
    if (!shareDialogSite || !shareDate) return;
    setShareLoading(true);
    try {
      const res = await fetch('/api/attendance/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: shareDialogSite.id, date: shareDate }),
      });
      const data = await res.json();
      if (data.success) {
        // Build absolute URL so it can be opened from anywhere
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        setShareUrl(`${origin}${data.data.url}`);
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to generate share link', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to generate share link', variant: 'destructive' });
    } finally {
      setShareLoading(false);
    }
  }, [shareDialogSite, shareDate]);

  const handleCopyShareUrl = useCallback(() => {
    if (!shareUrl) return;

    // Try the modern Clipboard API first (requires HTTPS or localhost)
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(shareUrl).then(() => {
        toast({ title: 'Copied', description: 'Share link copied to clipboard' });
      }).catch(() => {
        // Clipboard API failed — fall back to the textarea method
        copyToClipboardFallback(shareUrl);
      });
    } else {
      // Clipboard API not available (non-secure context like http://IP:port)
      copyToClipboardFallback(shareUrl);
    }
  }, [shareUrl]);

  const copyToClipboardFallback = (text: string) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      // Position it off-screen so it's not visible
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      // execCommand is deprecated but still works in all browsers
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        toast({ title: 'Copied', description: 'Share link copied to clipboard' });
      } else {
        // Last resort — open the URL in a new window so the user can manually copy
        toast({ title: 'Copy failed', description: 'Please copy the URL manually from the text box', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Copy failed', description: 'Please copy the URL manually from the text box', variant: 'destructive' });
    }
  };

  // ── Attendance Sheet handlers ──
  const openAttendanceSheet = useCallback((site: SiteOption) => {
    setAttendanceSheetSite(site);
  }, []);

  const closeAttendanceSheet = useCallback(() => {
    setAttendanceSheetSite(null);
  }, []);

  // Employees for the currently-open attendance sheet site
  const attendanceSheetEmployees = useMemo(() => {
    if (!attendanceSheetSite) return [];
    return (employeesBySite.get(attendanceSheetSite.name) || []).map((e) => ({
      id: e.id,
      fullName: e.fullName,
      employeeId: e.employeeId,
      position: e.position || e.trade || '',
      isTeamLeader: e.isTeamLeader,
      currentSite: e.currentSite,
    }));
  }, [attendanceSheetSite, employeesBySite]);

  // Loading state
  const isLoading = loadingSites || loadingEmployees || loadingAttendance;

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Attendance Management</h2>
          <p className="text-slate-400 mt-1 text-sm">
            Site-wise daily attendance · TL/Supervisors shown first
          </p>
        </div>
      </div>

      {/* Month/Year Navigation + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {/* Month Navigation */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPrevMonth}
            className="h-9 w-9 text-slate-400 hover:text-white hover:bg-slate-700"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 bg-slate-800 rounded-lg border border-slate-700 px-3 py-1.5 min-w-[220px]">
            <span className="text-sm font-semibold text-white">{monthLabel}</span>
            <span className="text-slate-500">&bull;</span>
            <span className="text-sm text-slate-300">{yearStr}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToNextMonth}
            disabled={isCurrentMonth}
            className="h-9 w-9 text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Year Select */}
        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="w-28 bg-slate-800 border-slate-700 text-sm text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="dropdown-upward bg-slate-800 border-slate-600">
            {YEARS.map((y) => (
              <SelectItem key={y} value={y} className="text-slate-200 focus:bg-slate-700 focus:text-white">
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Month Select */}
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-36 bg-slate-800 border-slate-700 text-sm text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="dropdown-upward bg-slate-800 border-slate-600 max-h-64">
            {MONTHS.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-slate-200 focus:bg-slate-700 focus:text-white">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 bg-slate-800 border-slate-700 text-sm text-white placeholder:text-slate-500 focus-visible:border-emerald-500/50 focus-visible:ring-emerald-500/20"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-slate-400 hover:text-white"
              onClick={() => setSearch('')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Expand/Collapse all */}
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

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 bg-slate-800 rounded-lg" />
          ))}
        </div>
      ) : sites.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700/50">
          <CardContent className="py-16 text-center">
            <Building2 className="h-10 w-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400">No sites found</p>
            <p className="text-xs text-slate-500 mt-1">
              Create sites first to manage attendance per site.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sites.map((site) => {
            const siteEmployees = filteredEmployeesBySite.get(site.name) || [];
            // Skip sites with no employees when searching
            if (searchDebounce && siteEmployees.length === 0) return null;
            return (
              <SiteListView
                key={site.id}
                site={site}
                employees={siteEmployees}
                attendanceMap={attendanceMap}
                daysInMonth={daysInMonth}
                monthStr={monthStr}
                yearStr={yearStr}
                month={month}
                year={year}
                isCurrentMonthView={isCurrentMonthView}
                isCollapsed={collapsedSites.has(site.name)}
                onToggleCollapse={() => toggleSiteCollapse(site.name)}
                onStatusChange={handleStatusChange}
                onBulkMark={handleBulkMark}
                onShare={() => openShareDialog(site)}
                onAttendanceSheet={() => openAttendanceSheet(site)}
              />
            );
          })}
        </div>
      )}

      {/* Share Dialog */}
      <Dialog open={!!shareDialogSite} onOpenChange={(open) => { if (!open) closeShareDialog(); }}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Share2 className="h-5 w-5 text-amber-400" />
              Share Attendance Link
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Generate a shareable link for <span className="text-white font-medium">{shareDialogSite?.name}</span>.
              The Team Leader / Supervisor can open the link on their phone, mark each employee as
              Present or Absent, and submit. The link becomes read-only after submission.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-300 uppercase tracking-wide">
                Date for attendance
              </label>
              <Input
                type="date"
                value={shareDate}
                onChange={(e) => setShareDate(e.target.value)}
                className="bg-slate-900 border-slate-600 text-white"
              />
              <p className="text-[11px] text-slate-500">
                The link records attendance for this specific date only.
              </p>
            </div>

            {shareUrl && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-300 uppercase tracking-wide">
                  Share link (read-only after submission)
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="bg-slate-900 border-slate-600 text-white text-xs font-mono"
                  />
                  <Button
                    onClick={handleCopyShareUrl}
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 shrink-0"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </Button>
                </div>
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 mt-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open link in new tab
                </a>
                <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[11px] text-amber-300">
                  Send this link to the Team Leader or Supervisor. They can mark attendance
                  without logging in. Once submitted, the same link shows a read-only summary.
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={closeShareDialog} className="text-slate-400 hover:text-white">
              {shareUrl ? 'Close' : 'Cancel'}
            </Button>
            {!shareUrl && (
              <Button
                onClick={handleGenerateShare}
                disabled={shareLoading || !shareDate}
                className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
              >
                {shareLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
                Generate Link
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attendance Sheet (full-screen overlay) */}
      {attendanceSheetSite && (
        <AttendanceSheetLazy
          site={attendanceSheetSite}
          employees={attendanceSheetEmployees}
          onClose={closeAttendanceSheet}
        />
      )}
    </div>
  );
}

/* ───────── Attendance Sheet (lazy wrapper around the existing component) ───────── */
// We lazy-load the attendance sheet so its heavy deps (html2canvas, jsPDF)
// don't bloat the main attendance page bundle.
import { AttendanceSheet } from '@/components/attendance/attendance-sheet';

function AttendanceSheetLazy({
  site,
  employees,
  onClose,
}: {
  site: SiteOption;
  employees: Array<{
    id: string;
    fullName: string;
    employeeId: string;
    position: string;
    isTeamLeader: boolean;
    currentSite: string | null;
  }>;
  onClose: () => void;
}) {
  return (
    <AttendanceSheet
      site={{
        id: site.id,
        name: site.name,
        clientName: site.clientName,
        projectName: site.projectName,
      }}
      employees={employees}
      onClose={onClose}
    />
  );
}
