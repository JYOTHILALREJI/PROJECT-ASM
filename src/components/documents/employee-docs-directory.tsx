'use client';

/**
 * EmployeeDocsDirectory — the Employee Documents tab:
 * a PAGINATED, server-searched list of every employee in the system.
 * Clicking an employee card expands (accordion) to show that employee's
 * documents via the shared EmployeeDocumentsPanel (upload / view / download
 * / rename / replace / delete). Strict server-side pagination keeps the
 * page light even with thousands of employees and documents.
 */
import React from 'react';
import {
  ChevronDown,
  ChevronRight,
  Search,
  Users,
  FileText,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  ChevronsRight,
  IdCard,
  Plane,
  FolderOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/documents/shared';
import { EmployeeDocumentsPanel } from '@/components/documents/employee-documents-panel';

interface DirectoryEmployee {
  id: string;
  fullName: string;
  employeeId: string;
  trade: string | null;
  companyName: string | null;
  nationality: string | null;
  passportNumber: string | null;
  docCounts: { passport: number; id_card: number; visa: number; other: number; total: number };
}

function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function CountPill({ icon: Icon, count, label }: { icon: React.ElementType; count: number; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium border',
        count > 0 ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' : 'bg-slate-800 text-slate-500 border-slate-700/60',
      )}
      title={`${label}: ${count}`}
    >
      <Icon className="h-3 w-3" /> {count}
    </span>
  );
}

export function EmployeeDocsDirectory({ refreshKey = 0 }: { refreshKey?: number }) {
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | 'with_docs'>('all');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(12);
  const [employees, setEmployees] = React.useState<DirectoryEmployee[]>([]);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [expandedNonce, setExpandedNonce] = React.useState(0);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ view: 'employees', page: String(page), pageSize: String(pageSize), filter });
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/documents/employee?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data.employees || []);
        setTotal(data.data.total || 0);
        setTotalPages(data.data.totalPages || 1);
        // page-edge correction: land on the last valid page, never page 1 (spec §24)
        if ((data.data.page || 1) > (data.data.totalPages || 1)) {
          setPage(Math.max(1, data.data.totalPages || 1));
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filter, search]);

  // debounced search + any dependency change
  React.useEffect(() => {
    const t = setTimeout(load, search.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search, refreshKey]);

  const changePage = (p: number) => { setPage(p); setExpandedId(null); };
  const changePageSize = (s: number) => { setPageSize(s); setPage(1); setExpandedId(null); };
  const changeFilter = (f: 'all' | 'with_docs') => { setFilter(f); setPage(1); setExpandedId(null); };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const navBtn = 'h-7 w-7 p-0 text-slate-300 hover:bg-slate-700 hover:text-white border-slate-600';

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">Employees</h3>
          <Badge variant="secondary" className="bg-slate-700 text-slate-300">{total}</Badge>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); changePage(1); setExpandedId(null); }}
                placeholder="Search by name, employee ID, passport, trade…"
                className={cn('h-8 w-72 pl-8 text-xs', inputCls)}
              />
            </div>
            <Select value={filter} onValueChange={(v) => changeFilter(v as 'all' | 'with_docs')}>
              <SelectTrigger className={cn('h-8 w-40 text-xs', inputCls)}><SelectValue /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
                <SelectItem value="all">All employees</SelectItem>
                <SelectItem value="with_docs">With documents</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* list */}
      {loading ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-10 text-center text-sm text-slate-400">Loading employees…</div>
      ) : employees.length === 0 ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-10 text-center text-sm text-slate-400">
          {total === 0 ? 'No employees match the current search.' : 'No employees found.'}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 divide-y divide-slate-700/40 overflow-hidden">
          {employees.map((emp) => {
            const open = expandedId === emp.id;
            return (
              <div key={emp.id}>
                {/* employee card */}
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/25 transition-colors text-left"
                  onClick={() => {
                    setExpandedId(open ? null : emp.id);
                    setExpandedNonce((n) => n + 1);
                  }}
                >
                  {open ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
                  <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-semibold text-sm', emp.docCounts.total > 0 ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-700 text-slate-400')}>
                    {initials(emp.fullName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200 truncate">{emp.fullName}</span>
                      {emp.docCounts.total > 0 ? (
                        <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 text-[9px] px-1.5">
                          {emp.docCounts.total} document{emp.docCounts.total !== 1 ? 's' : ''}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[9px] px-1.5">No documents</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {[emp.employeeId, emp.trade, emp.companyName, emp.passportNumber].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="hidden md:flex items-center gap-1.5 shrink-0">
                    <CountPill icon={FileText} count={emp.docCounts.passport} label="Passport" />
                    <CountPill icon={IdCard} count={emp.docCounts.id_card} label="ID Card" />
                    <CountPill icon={Plane} count={emp.docCounts.visa} label="Visa" />
                    <CountPill icon={FolderOpen} count={emp.docCounts.other} label="Other" />
                  </div>
                </button>

                {/* expanded: the employee's documents */}
                {open && (
                  <div className="bg-slate-900/40 px-4 pb-4 pt-1">
                    <EmployeeDocumentsPanel
                      key={`${emp.id}-${expandedNonce}`}
                      employeeId={emp.id}
                      employeeName={emp.fullName}
                      compact
                      canDelete
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* pagination */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-[11px] text-slate-400">
          {from}–{to} of <span className="text-slate-200 font-medium">{total}</span> employees
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" className={navBtn} disabled={page <= 1} onClick={() => changePage(1)} title="First page">
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className={navBtn} disabled={page <= 1} onClick={() => changePage(page - 1)} title="Previous page">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-[11px] text-slate-300 px-2">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" className={navBtn} disabled={page >= totalPages} onClick={() => changePage(page + 1)} title="Next page">
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className={navBtn} disabled={page >= totalPages} onClick={() => changePage(totalPages)} title="Last page">
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
          <Select value={String(pageSize)} onValueChange={(v) => changePageSize(parseInt(v, 10))}>
            <SelectTrigger className={cn('h-7 w-[74px] text-[11px]', inputCls)}><SelectValue /></SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
              {[12, 24, 48].map((s) => <SelectItem key={s} value={String(s)}>{s} / page</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
