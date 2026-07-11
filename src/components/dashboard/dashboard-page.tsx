'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Building2,
  CalendarDays,
  UserX,
  ArrowRight,
  Crown,
  ShieldCheck,
  DollarSign,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { format } from 'date-fns';
import { useAppStore } from '@/store/app-store';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

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

const PIE_COLORS = ['#22c55e', '#f59e0b', '#64748b'];

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

interface MergedEmployeeRow {
  empId: string;
  empName: string;
  nationality: string;
  trade: string;
  employeeCode: string;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  slNo: number;
  totalHours: number;
  lowRateHours: number;
  highRateHours: number;
  previousCumulativeHours: number;
  hoursThreshold: number;
  lowRate: number;
  highRate: number;
  totalSalary: number;
  deduction: number;
  advance: number;
  balanceSalary: number;
  isPaid: boolean;
  rateTier: 'standard' | 'premium' | 'split';
  isCustomRate: boolean;
}

interface AttendanceRecord {
  status: string;
  date: string;
}

interface EmployeeRecord {
  id: string;
  status: string;
  currentSite: string | null;
}

interface MonthlyChartData {
  name: string;
  present: number;
  absent: number;
  overtime: number;
}

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatHours(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function mergeApiEntries(entries: ApiEmployeeEntry[]): MergedEmployeeRow[] {
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

  for (const [, empEntries] of sortedGroups) {
    slNo++;
    const standardEntry = empEntries.find((e) => e.rateTier === 'standard');
    const premiumEntry = empEntries.find((e) => e.rateTier === 'premium');

    const baseEntry = standardEntry || premiumEntry || empEntries[0];
    const hasBonus = baseEntry.isTeamLeader || baseEntry.isSupervisor;
    const lowRate = hasBonus ? 3.0 : 2.5;
    const highRate = hasBonus ? 5.5 : 5.0;

    const lowRateHours = standardEntry?.salaryRecord?.totalHours ?? 0;
    const highRateHours = premiumEntry?.salaryRecord?.totalHours ?? 0;
    const totalHours = lowRateHours + highRateHours;

    const standardSalary = standardEntry?.salaryRecord?.totalSalary ?? lowRateHours * lowRate;
    const premiumSalary = premiumEntry?.salaryRecord?.totalSalary ?? highRateHours * highRate;
    const totalSalary = standardSalary + premiumSalary;

    const deduction = standardEntry?.salaryRecord?.deduction ?? 0;
    const advance = standardEntry?.salaryRecord?.advance ?? 0;
    const isPaid =
      (standardEntry?.salaryRecord?.isPaid ?? false) || (premiumEntry?.salaryRecord?.isPaid ?? false);

    let rateTier: 'standard' | 'premium' | 'split' = 'standard';
    if (standardEntry && premiumEntry) {
      rateTier = 'split';
    } else if (premiumEntry && !standardEntry) {
      rateTier = 'premium';
    }

    const previousCumulativeHours = (baseEntry.workingHours?.previousCumulativeHours as number) || 0;
    const hoursThreshold = (baseEntry.workingHours?.hoursThreshold as number) || 1000;
    const isCustomRate = (baseEntry.workingHours?.isCustom as boolean) ?? false;

    merged.push({
      empId: baseEntry.empId,
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
      lowRate: standardEntry?.salaryRecord?.rtPerHour ?? lowRate,
      highRate: premiumEntry?.salaryRecord?.rtPerHour ?? highRate,
      totalSalary,
      deduction,
      advance,
      balanceSalary: totalSalary - deduction - advance,
      isPaid,
      rateTier,
      isCustomRate,
    });
  }

  return merged;
}

function getSplitComputation(emp: MergedEmployeeRow): string {
  if (emp.isCustomRate) {
    return `${formatHours(emp.totalHours)}h @ ${emp.lowRate.toFixed(1)}`;
  }
  if (emp.rateTier === 'split') {
    return `${formatHours(emp.lowRateHours)}h @ ${emp.lowRate.toFixed(1)} + ${formatHours(emp.highRateHours)}h @ ${emp.highRate.toFixed(1)}`;
  }
  if (emp.rateTier === 'premium') {
    return `${formatHours(emp.highRateHours)}h @ ${emp.highRate.toFixed(1)}`;
  }
  return `${formatHours(emp.lowRateHours)}h @ ${emp.lowRate.toFixed(1)}`;
}

function getRateStructure(emp: MergedEmployeeRow): string {
  if (emp.isCustomRate) {
    return `Custom: ${emp.lowRate.toFixed(1)}`;
  }
  if (emp.rateTier === 'split') {
    return `${emp.lowRate.toFixed(1)} / ${emp.highRate.toFixed(1)}`;
  }
  if (emp.rateTier === 'premium') {
    return emp.highRate.toFixed(1);
  }
  return emp.lowRate.toFixed(1);
}

export function DashboardPage() {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));

  const [totalEmployees, setTotalEmployees] = useState<number | null>(null);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [idleCount, setIdleCount] = useState<number | null>(null);
  const [teamLeaderCount, setTeamLeaderCount] = useState<number>(0);
  const [supervisorCount, setSupervisorCount] = useState<number>(0);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [loadingAttendance, setLoadingAttendance] = useState(true);

  const [siteData, setSiteData] = useState<ApiSiteResult[]>([]);
  const [mergedSiteEmployees, setMergedSiteEmployees] = useState<Record<string, MergedEmployeeRow[]>>({});
  const [loadingSites, setLoadingSites] = useState(true);

  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const todayDisplay = useMemo(() => format(now, 'EEEE, MMMM d, yyyy'), []);

  const yearOptions = useMemo(() => {
    const currentYear = now.getFullYear();
    return [
      String(currentYear - 2),
      String(currentYear - 1),
      String(currentYear),
      String(currentYear + 1),
    ];
  }, []);

  const fetchEmployees = useCallback(async () => {
    try {
      setLoadingEmployees(true);
      const res = await fetch('/api/employees?limit=1000');
      const json = await res.json();
      if (json.success) {
        setTotalEmployees(json.data.total);
        setEmployees(json.data.employees || []);
        setIdleCount(json.data.idleCount ?? null);
        setTeamLeaderCount(json.data.teamLeaderCount ?? 0);
        setSupervisorCount(json.data.supervisorCount ?? 0);
      }
    } catch {
      setTotalEmployees(null);
      setEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  const fetchAttendance = useCallback(async (m: string, y: string) => {
    try {
      setLoadingAttendance(true);
      const param = `${y}-${m.padStart(2, '0')}`;
      const res = await fetch(`/api/attendance?month=${param}&year=${y}`);
      const json = await res.json();
      if (json.success) {
        setAttendanceRecords(json.data.records || []);
      } else {
        setAttendanceRecords([]);
      }
    } catch {
      setAttendanceRecords([]);
    } finally {
      setLoadingAttendance(false);
    }
  }, []);

  const fetchSiteData = useCallback(async (m: string, y: string) => {
    try {
      setLoadingSites(true);
      const monthStr = `${y}-${m.padStart(2, '0')}`;
      const res = await fetch(`/api/accounts?month=${monthStr}&year=${y}`);
      const json = await res.json();
      if (json.success) {
        const sites: ApiSiteResult[] = json.data.sites || [];
        setSiteData(sites);
        const empMap: Record<string, MergedEmployeeRow[]> = {};
        for (const s of sites) {
          empMap[s.site.id] = mergeApiEntries(s.employees);
        }
        setMergedSiteEmployees(empMap);
      } else {
        setSiteData([]);
        setMergedSiteEmployees({});
      }
    } catch {
      setSiteData([]);
      setMergedSiteEmployees({});
    } finally {
      setLoadingSites(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  useEffect(() => {
    fetchAttendance(month, year);
  }, [month, year, fetchAttendance]);

  useEffect(() => {
    fetchSiteData(month, year);
  }, [month, year, fetchSiteData]);

  const selectedDateRecords = attendanceRecords.filter((r) => r.date === format(now, 'yyyy-MM-dd'));
  const presentCount = selectedDateRecords.filter((r) => r.status === 'present').length;
  const absentCount = selectedDateRecords.filter((r) => r.status === 'absent').length;
  const overtimeCount = selectedDateRecords.filter((r) => r.status === 'overtime').length;

  const monthlyChartData: MonthlyChartData[] = useMemo(() => {
    const data: MonthlyChartData[] = [];
    const currentYearN = parseInt(year, 10);
    const currentMonthN = parseInt(month, 10);

    for (let i = 5; i >= 0; i--) {
      let m = currentMonthN - i;
      let y = currentYearN;
      while (m <= 0) {
        m += 12;
        y -= 1;
      }
      const monthStr = `${y}-${String(m).padStart(2, '0')}`;
      const monthLabel = MONTHS[m - 1]?.label.slice(0, 3) || `M${m}`;
      const monthRecords = attendanceRecords.filter((r) => r.date.startsWith(monthStr));
      data.push({
        name: `${monthLabel} ${y}`,
        present: monthRecords.filter((r) => r.status === 'present').length,
        absent: monthRecords.filter((r) => r.status === 'absent').length,
        overtime: monthRecords.filter((r) => r.status === 'overtime').length,
      });
    }
    return data;
  }, [attendanceRecords, month, year]);

  const pieData = useMemo(() => {
    const active = employees.filter((e) => e.status === 'active').length;
    const pending = employees.filter((e) => e.status === 'pending_deletion').length;
    const idle = employees.filter((e) => e.status === 'idle').length;
    const arr = [];
    if (active > 0) arr.push({ name: 'Active', value: active });
    if (pending > 0) arr.push({ name: 'Pending Deletion', value: pending });
    if (idle > 0) arr.push({ name: 'Idle', value: idle });
    if (arr.length === 0) arr.push({ name: 'No Data', value: 1 });
    return arr;
  }, [employees]);

  const grandTotals = useMemo(() => {
    let totalEmps = 0;
    let totalHrs = 0;
    let totalSal = 0;
    for (const s of siteData) {
      totalEmps += s.employeeCount;
      totalHrs += s.totalHours;
      totalSal += s.totalSalary;
    }
    return { totalEmps, totalHrs, totalSal };
  }, [siteData]);

  const idlePercent =
    totalEmployees && idleCount !== null && totalEmployees > 0
      ? ((idleCount / totalEmployees) * 100).toFixed(1)
      : null;

  const handleIdleClick = () => {
    localStorage.setItem('asm_idle_filter', '1');
    setCurrentView('employees');
  };

  const monthLabel = MONTHS.find((m) => m.value === month)?.label || '';

  const metrics = [
    {
      title: 'Total Employees',
      value: loadingEmployees ? null : (totalEmployees ?? 0),
      icon: Users,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
      subtitle: null,
      clickable: false,
    },
    {
      title: 'Present',
      value: loadingAttendance ? null : presentCount,
      icon: CheckCircle,
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
      subtitle: 'Today',
      clickable: false,
    },
    {
      title: 'Absent',
      value: loadingAttendance ? null : absentCount,
      icon: XCircle,
      color: 'text-red-400',
      bgColor: 'bg-red-500/10',
      subtitle: 'Today',
      clickable: false,
    },
    {
      title: 'Overtime',
      value: loadingAttendance ? null : overtimeCount,
      icon: Clock,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10',
      subtitle: 'Today',
      clickable: false,
    },
    {
      title: 'Idle Workers',
      value: loadingEmployees ? null : (idleCount ?? 0),
      icon: UserX,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      subtitle: idlePercent !== null ? `${idlePercent}% of workforce` : 'No site assigned',
      clickable: true,
      onClick: handleIdleClick,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          <div className="flex items-center gap-2 mt-1">
            <CalendarDays className="h-4 w-4 text-emerald-400" />
            <p className="text-emerald-400 font-medium text-sm">{todayDisplay}</p>
          </div>
          <p className="text-slate-400 mt-1">
            Overview of your workforce metrics, attendance, and site salary data.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[150px] bg-slate-800 border-slate-700 text-slate-200">
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
        </div>
      </div>

      {/* Team Leaders and Supervisors Pills */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <Crown className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs font-medium text-amber-400">Team Leaders</span>
          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px] px-1.5 py-0 h-4 min-w-[20px] justify-center">
            {loadingEmployees ? '...' : teamLeaderCount}
          </Badge>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs font-medium text-emerald-400">Supervisors</span>
          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px] px-1.5 py-0 h-4 min-w-[20px] justify-center">
            {loadingEmployees ? '...' : supervisorCount}
          </Badge>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card
              key={metric.title}
              className={`bg-slate-800/50 border-slate-700/50 transition-colors py-4 ${metric.clickable ? 'cursor-pointer hover:border-amber-500/40 hover:bg-slate-800/70' : 'hover:border-slate-600/50'}`}
              onClick={metric.clickable && metric.onClick ? metric.onClick : undefined}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2 px-4">
                <CardTitle className="text-sm font-medium text-slate-400">
                  {metric.title}
                </CardTitle>
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${metric.bgColor}`}>
                  <Icon className={`h-4 w-4 ${metric.color}`} />
                </div>
              </CardHeader>
              <CardContent className="px-4 pt-0">
                {metric.value === null ? (
                  <Skeleton className="h-8 w-16 bg-slate-700" />
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="text-2xl font-bold text-white">
                      {metric.value.toLocaleString()}
                    </div>
                    {metric.clickable && (
                      <span className="text-[10px] text-amber-400/70 font-medium flex items-center gap-0.5 hover:text-amber-400 transition-colors">
                        View All <ArrowRight className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  {metric.subtitle || `${monthLabel} ${year}`}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Site-Based Accordion View */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-slate-400" />
            <h3 className="text-lg font-semibold text-white">Sites Overview</h3>
            {!loadingSites && siteData.length > 0 && (
              <Badge className="bg-slate-700 text-slate-300 border-slate-600 text-xs">
                {siteData.length} site{siteData.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          {!loadingSites && siteData.length > 0 && (
            <div className="flex items-center gap-4 text-xs">
              <span className="text-slate-400">
                Employees: <span className="text-white font-semibold">{grandTotals.totalEmps}</span>
              </span>
              <span className="text-slate-400">
                Hours: <span className="text-white font-semibold">{formatHours(grandTotals.totalHrs)}</span>
              </span>
              <span className="text-emerald-400 font-semibold">
                {formatCurrency(grandTotals.totalSal)} AED
              </span>
            </div>
          )}
        </div>

        {loadingSites ? (
          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardContent className="p-6">
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full bg-slate-700 rounded-lg" />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : siteData.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700/50">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-700/50 mb-3">
                <Building2 className="h-7 w-7 text-slate-500" />
              </div>
              <h3 className="text-base font-semibold text-white mb-1">No sites with salary data</h3>
              <p className="text-sm text-slate-500 max-w-md">
                No sites have active hour logs for {monthLabel} {year}. Select a different month or generate salary records from the Accounts page.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Accordion type="multiple" className="space-y-2">
            {siteData.map((site) => {
              const emps = mergedSiteEmployees[site.site.id] || [];
              const siteTotalHours = emps.reduce((s, e) => s + e.totalHours, 0);
              const siteTotalSalary = emps.reduce((s, e) => s + e.totalSalary, 0);

              return (
                <AccordionItem
                  key={site.site.id}
                  value={site.site.id}
                  className="bg-slate-800/50 border border-slate-700/50 rounded-lg overflow-hidden px-0 data-[state=open]:border-slate-600/70"
                >
                  <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-slate-700/20 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 w-full pr-4">
                      <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                          <Building2 className="h-4 w-4 text-emerald-400" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">
                            {site.site.name}
                          </div>
                          {site.site.clientName && (
                            <div className="text-[11px] text-slate-500 truncate">
                              {site.site.clientName}
                              {site.site.projectName ? ` - ${site.site.projectName}` : ''}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 sm:gap-6 ml-0 sm:ml-auto flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-blue-400" />
                          <span className="text-xs text-slate-400">Employees</span>
                          <span className="text-sm font-bold text-white">{site.employeeCount}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-cyan-400" />
                          <span className="text-xs text-slate-400">Hours</span>
                          <span className="text-sm font-bold text-white">{formatHours(siteTotalHours)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-xs text-slate-400">Wages</span>
                          <span className="text-sm font-bold text-emerald-400">
                            {formatCurrency(siteTotalSalary)} AED
                          </span>
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent className="px-4 pb-4">
                    {emps.length === 0 ? (
                      <div className="py-6 text-center text-sm text-slate-500">
                        No employee records for this site.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-slate-700/30">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-slate-700/30 hover:bg-transparent bg-slate-900/50">
                              <TableHead className="text-slate-400 font-semibold text-xs w-12 text-center">Sl No</TableHead>
                              <TableHead className="text-slate-400 font-semibold text-xs min-w-[100px]">Emp ID</TableHead>
                              <TableHead className="text-slate-400 font-semibold text-xs min-w-[160px]">Name</TableHead>
                              <TableHead className="text-slate-400 font-semibold text-xs text-right min-w-[100px]">Total Hours</TableHead>
                              <TableHead className="text-slate-400 font-semibold text-xs text-center min-w-[100px]">Rate Structure</TableHead>
                              <TableHead className="text-slate-400 font-semibold text-xs min-w-[180px]">Split Computation</TableHead>
                              <TableHead className="text-slate-400 font-semibold text-xs text-right min-w-[130px]">Total Payout (AED)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {emps.map((emp) => (
                              <TableRow
                                key={emp.empId}
                                className={`border-slate-700/20 hover:bg-slate-700/20 ${emp.isPaid ? 'bg-emerald-500/5' : ''}`}
                              >
                                <TableCell className="text-slate-500 text-xs text-center font-mono">
                                  {emp.slNo}
                                </TableCell>
                                <TableCell className="text-slate-300 text-xs font-mono">
                                  <div className="flex items-center gap-1.5">
                                    {emp.employeeCode || '-'}
                                    {emp.isTeamLeader && (
                                      <Crown className="h-3 w-3 text-amber-400 shrink-0" />
                                    )}
                                    {emp.isSupervisor && (
                                      <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="text-sm text-white font-medium">{emp.empName}</div>
                                  <div className="text-[11px] text-slate-500">
                                    {emp.trade}{emp.nationality ? ` - ${emp.nationality}` : ''}
                                  </div>
                                </TableCell>
                                <TableCell className="text-slate-200 text-xs text-right font-mono font-semibold">
                                  {formatHours(emp.totalHours)}
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge
                                    className={`text-[10px] px-2 py-0.5 font-medium ${
                                      emp.isCustomRate
                                        ? 'bg-violet-500/15 text-violet-400 border-violet-500/25'
                                        : emp.rateTier === 'split'
                                          ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                                          : emp.rateTier === 'premium'
                                            ? 'bg-orange-500/15 text-orange-400 border-orange-500/25'
                                            : 'bg-slate-600/30 text-slate-300 border-slate-500/25'
                                    }`}
                                  >
                                    {getRateStructure(emp)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-slate-300 font-mono">
                                  {getSplitComputation(emp)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="text-sm font-semibold text-emerald-400">
                                    {formatCurrency(emp.totalSalary)}
                                  </div>
                                  {(emp.deduction > 0 || emp.advance > 0) && (
                                    <div className="text-[10px] text-slate-500">
                                      {emp.deduction > 0 && (
                                        <span className="text-red-400/70">
                                          Ded: {formatCurrency(emp.deduction)}
                                        </span>
                                      )}
                                      {emp.deduction > 0 && emp.advance > 0 && ' / '}
                                      {emp.advance > 0 && (
                                        <span className="text-amber-400/70">
                                          Adv: {formatCurrency(emp.advance)}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="border-slate-600/50 bg-slate-800/60 hover:bg-slate-800/60">
                              <TableCell colSpan={3} className="text-white text-xs font-bold">
                                Site Total ({emps.length} employees)
                              </TableCell>
                              <TableCell className="text-white text-xs text-right font-mono font-bold">
                                {formatHours(siteTotalHours)}
                              </TableCell>
                              <TableCell />
                              <TableCell />
                              <TableCell className="text-emerald-400 text-sm text-right font-bold">
                                {formatCurrency(siteTotalSalary)} AED
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-slate-800/50 border-slate-700/50 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base text-white">Monthly Attendance</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            {loadingAttendance ? (
              <div className="flex flex-col items-center justify-center" style={{ height: 300 }}>
                <Skeleton className="h-full w-full bg-slate-700 rounded-lg" style={{ height: 300 }} />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyChartData} barGap={4} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#334155' }} tickLine={{ stroke: '#334155' }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#334155' }} tickLine={{ stroke: '#334155' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }} itemStyle={{ color: '#e2e8f0' }} labelStyle={{ color: '#94a3b8', marginBottom: 4 }} cursor={{ fill: 'rgba(51, 65, 85, 0.3)' }} />
                  <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} iconType="circle" />
                  <Bar dataKey="present" name="Present" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="absent" name="Absent" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="overtime" name="Overtime" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700/50 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base text-white">Employee Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            {loadingEmployees ? (
              <div className="flex items-center justify-center" style={{ height: 300 }}>
                <Skeleton className="h-full w-full bg-slate-700 rounded-lg" style={{ height: 300 }} />
              </div>
            ) : employees.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center" style={{ height: 300 }}>
                <Building2 className="h-8 w-8 text-slate-600 mb-2" />
                <p className="text-sm text-slate-500">No employee data available</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="45%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value" label={({ name, percent }: { name: string; percent: number }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={{ stroke: '#64748b' }}>
                    {pieData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} iconType="circle" />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }} itemStyle={{ color: '#e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
