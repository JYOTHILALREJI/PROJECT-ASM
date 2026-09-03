'use client';

/**
 * NocList — All NOCs (server-paginated, server-searched — the archive grows
 * unbounded so pagination is strict) and NocFolderView — the client → year →
 * month archive (lazy: each month's records are fetched when opened, with
 * in-month pagination).
 */
import React from 'react';
import {
  FileText,
  FolderOpen,
  Folder,
  Download,
  Printer,
  Trash2,
  Plus,
  Search,
  Eye,
  ChevronRight,
  ChevronDown,
  Copy,
  CalendarDays,
  Pencil,
  Stamp as StampIcon,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  ChevronsRight,
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
import { toast } from '@/hooks/use-toast';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/utils';
import { StaggerContainer, StaggerItem } from '@/components/motion';
import {
  downloadNocPdf,
  inputCls,
  monthLabel,
  printPdf,
  type NocLightRow,
} from '@/components/documents/shared';

interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
  unit: string;
}

export function PaginationBar({ page, totalPages, total, pageSize, onPage, onPageSize, unit }: PaginationBarProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = 'h-7 w-7 p-0 text-slate-300 hover:bg-slate-700 hover:text-white border-slate-600';
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-slate-700/40">
      <span className="text-[11px] text-slate-400">
        {from}–{to} of <span className="text-slate-200 font-medium">{total}</span> {unit}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="outline" size="sm" className={btn} disabled={page <= 1} onClick={() => onPage(1)} title="First page">
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="sm" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} title="Previous page">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[11px] text-slate-300 px-2">Page {page} of {totalPages}</span>
        <Button variant="outline" size="sm" className={btn} disabled={page >= totalPages} onClick={() => onPage(page + 1)} title="Next page">
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="sm" className={btn} disabled={page >= totalPages} onClick={() => onPage(totalPages)} title="Last page">
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(parseInt(v, 10))}>
          <SelectTrigger className={cn('h-7 w-[74px] text-[11px]', inputCls)}><SelectValue /></SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
            {[10, 20, 50].map((s) => <SelectItem key={s} value={String(s)}>{s} / page</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NocList — searchable/filterable flat list (server pagination)
// ---------------------------------------------------------------------------

export function NocList({
  canDelete,
  onCreate,
  onEdit,
  onViewNoc,
  onChanged,
  refreshKey,
}: {
  canDelete: boolean;
  onCreate: () => void;
  onEdit: (noc: NocLightRow & { employees?: Array<{ name: string; trade: string; company: string; nationality: string; passport: string }> }) => void;
  onViewNoc: (nocId: string) => void;
  onChanged: () => void;
  refreshKey: number;
}) {
  const { user } = useAuthStore();
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [yearFilter, setYearFilter] = React.useState('all');
  const [rows, setRows] = React.useState<NocLightRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [totalPages, setTotalPages] = React.useState(1);
  const [years, setYears] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [deleteTarget, setDeleteTarget] = React.useState<NocLightRow | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  // load years for the filter (once)
  React.useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/documents/noc?view=folders');
        const data = await res.json();
        if (data.success) {
          const ys = new Set<string>();
          for (const c of data.data.clients || []) for (const y of c.years || []) ys.add(y.year);
          setYears([...ys].sort().reverse());
        }
      } catch { /* silent */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ view: 'list', page: String(page), pageSize: String(pageSize), status: statusFilter, year: yearFilter });
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/documents/noc?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setRows(data.data.nocs || []);
        setTotal(data.data.total || 0);
        setTotalPages(data.data.totalPages || 1);
        // page-edge correction after deletes: land on the LAST valid page,
        // never jump back to page 1 (spec §24)
        if ((data.data.page || 1) > (data.data.totalPages || 1)) {
          setPage(Math.max(1, data.data.totalPages || 1));
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, yearFilter, search]);

  // debounce search; refetch on any control change
  React.useEffect(() => {
    const t = setTimeout(load, search.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search, refreshKey]);

  const doDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusyId(target.id);
    try {
      const res = await fetch(`/api/documents/noc/${target.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
      // remove from the visible dataset IMMEDIATELY (spec §22) — no stale row
      setRows((prev) => prev.filter((r) => r.id !== target.id));
      setTotal((t) => Math.max(0, t - 1));
      toast({ title: target.status === 'draft' ? 'Draft deleted' : 'NOC deleted', description: target.nocNumber });
      setDeleteTarget(null);
      onChanged();
      load();
    } catch (e) {
      toast({ title: 'Failed to delete', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = async (noc: NocLightRow) => {
    setBusyId(noc.id);
    try {
      if (noc.status === 'draft') {
        const res = await fetch(`/api/documents/noc/${noc.id}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load draft');
        onEdit(data.data.noc);
      } else {
        // Final NOCs are never overwritten — create version N+1 as a draft
        const res = await fetch(`/api/documents/noc/${noc.id}/version?actorDisplayName=${encodeURIComponent(user?.name || user?.email || 'Admin')}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create version');
        onEdit({ ...noc, ...data.data.noc });
      }
    } catch (e) {
      toast({ title: 'Edit failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (noc: NocLightRow) => {
    setBusyId(noc.id);
    try {
      const res = await fetch(`/api/documents/noc/${noc.id}/duplicate?actorDisplayName=${encodeURIComponent(user?.name || user?.email || 'Admin')}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Duplicate failed');
      toast({ title: 'Duplicated as draft', description: `${data.data.noc.nocNumber} — dated today, ready to edit.` });
      onEdit({ ...noc, ...data.data.noc });
    } catch (e) {
      toast({ title: 'Duplicate failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-700/50">
        <FolderOpen className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">All NOCs</h3>
        <Badge variant="secondary" className="bg-slate-700 text-slate-300">{total}</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search NOC / client / project / employee / passport…" className={cn('h-8 w-64 pl-8 text-xs', inputCls)} />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className={cn('h-8 w-28 text-xs', inputCls)}><SelectValue /></SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="final">Final</SelectItem>
              <SelectItem value="draft">Drafts</SelectItem>
            </SelectContent>
          </Select>
          <Select value={yearFilter} onValueChange={(v) => { setYearFilter(v); setPage(1); }}>
            <SelectTrigger className={cn('h-8 w-24 text-xs', inputCls)}><SelectValue /></SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
              <SelectItem value="all">All years</SelectItem>
              {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={onCreate} className="h-8 bg-blue-600 hover:bg-blue-500 text-white">
            <Plus className="h-3.5 w-3.5 mr-1" /> Create NOC
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-400">Loading NOCs…</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">
          {total === 0 ? 'No NOCs yet — create the first one.' : 'No NOCs match the current filters.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2 font-semibold">NOC Number</th>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Client</th>
                <th className="px-3 py-2 font-semibold">Project</th>
                <th className="px-3 py-2 font-semibold text-center">Employees</th>
                <th className="px-3 py-2 font-semibold">Created By</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((noc) => (
                <tr key={noc.id} className={cn('border-t border-slate-700/40 hover:bg-slate-700/20 transition-colors', noc.status === 'draft' && 'bg-amber-500/5')}>
                  <td className="px-4 py-2">
                    <button type="button" className="text-[13px] font-medium text-slate-200 hover:text-blue-300 transition-colors" title="Open NOC page" onClick={() => onViewNoc(noc.id)}>
                      {noc.nocNumber}
                    </button>
                    {noc.version > 1 && <Badge variant="secondary" className="ml-1.5 bg-violet-500/15 text-violet-300 border border-violet-500/20 text-[9px] px-1">v{noc.version}</Badge>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-300 whitespace-nowrap">{noc.nocDate || '—'}</td>
                  <td className="px-3 py-2 text-[13px] text-slate-200">{noc.clientName || <span className="text-slate-500">(untitled)</span>}</td>
                  <td className="px-3 py-2 text-xs text-slate-300">{noc.projectName || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-300 text-center">{noc.employeeCount}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{noc.createdBy || '—'}</td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary" className={cn('text-[10px] px-1.5', noc.status === 'final' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-amber-500/15 text-amber-300 border border-amber-500/20')}>
                      {noc.status === 'final' ? 'Final' : 'Draft'}
                    </Badge>
                    {noc.status === 'final' && (
                      <span className={cn('inline-flex items-center gap-0.5 ml-1 text-[9px]', noc.stampEnabled ? 'text-blue-300' : 'text-slate-500')} title={noc.stampEnabled ? `Stamp: ${noc.stampName || 'on'}` : 'No stamp'}>
                        <StampIcon className="h-3 w-3" />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      {noc.status === 'final' && (
                        <>
                          <button type="button" title="View — open the NOC page" onClick={() => onViewNoc(noc.id)} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Eye className="h-3.5 w-3.5" /></button>
                          <button type="button" title="Print" onClick={() => printPdf(`/api/documents/noc/${noc.id}/pdf?mode=inline&_=${Date.now()}`)} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Printer className="h-3.5 w-3.5" /></button>
                          <button type="button" title="Download PDF" onClick={() => downloadNocPdf(noc)} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Download className="h-3.5 w-3.5" /></button>
                        </>
                      )}
                      <button type="button" title="Duplicate (new NOC, today's date)" onClick={() => duplicate(noc)} disabled={busyId === noc.id} className="rounded p-1.5 text-slate-400 hover:text-blue-300 hover:bg-slate-700/60 disabled:opacity-40"><Copy className="h-3.5 w-3.5" /></button>
                      <button type="button" title={noc.status === 'draft' ? 'Continue editing draft' : 'Edit (creates a new version)'} onClick={() => startEdit(noc)} disabled={busyId === noc.id} className="rounded p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-700/60 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /></button>
                      {canDelete && (
                        <button type="button" title="Delete" onClick={() => setDeleteTarget(noc)} className="rounded p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaginationBar page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} unit="NOCs" />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">{deleteTarget?.status === 'draft' ? 'Delete this draft?' : 'Delete this NOC?'}</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {deleteTarget?.nocNumber} — {deleteTarget?.clientName || 'untitled'}{deleteTarget?.status === 'final' ? '. The stored PDF will be removed as well. This cannot be undone.' : ' Drafts are removed permanently.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-slate-300 border-slate-700 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} disabled={busyId === deleteTarget?.id} className="bg-red-500 hover:bg-red-600 text-white border-0">
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NocFolderView — client folder → year → month grouping, lazy month loads
// ---------------------------------------------------------------------------

interface FolderMeta {
  clientName: string;
  total: number;
  years: Array<{ year: string; months: Array<{ monthKey: string; count: number }> }>;
}

export function NocFolderView({
  canDelete,
  onViewNoc,
  onChanged,
  refreshKey,
}: {
  canDelete: boolean;
  onViewNoc: (nocId: string) => void;
  onChanged: () => void;
  refreshKey: number;
}) {
  const [meta, setMeta] = React.useState<FolderMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [openClients, setOpenClients] = React.useState<Record<string, boolean>>({});
  const [openYears, setOpenYears] = React.useState<Record<string, boolean>>({});
  const [openMonths, setOpenMonths] = React.useState<Record<string, boolean>>({});
  const [monthRecords, setMonthRecords] = React.useState<Record<string, { nocs: NocLightRow[]; page: number; totalPages: number; total: number; loading: boolean }>>({});
  const [deleteTarget, setDeleteTarget] = React.useState<NocLightRow | null>(null);

  const loadMeta = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/documents/noc?view=folders');
      const data = await res.json();
      if (data.success) setMeta(data.data.clients || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const t = setTimeout(loadMeta, 0);
    return () => clearTimeout(t);
  }, [loadMeta, refreshKey]);

  const MONTH_PAGE_SIZE = 20;

  const loadMonth = React.useCallback(async (client: string, monthKey: string, pageToLoad: number, append: boolean) => {
    const mKey = `${client}::${monthKey}`;
    setMonthRecords((prev) => ({
      ...prev,
      [mKey]: { nocs: append ? prev[mKey]?.nocs || [] : [], page: pageToLoad, totalPages: prev[mKey]?.totalPages || 1, total: prev[mKey]?.total || 0, loading: true },
    }));
    try {
      const params = new URLSearchParams({ view: 'month', client, month: monthKey, page: String(pageToLoad), pageSize: String(MONTH_PAGE_SIZE) });
      const res = await fetch(`/api/documents/noc?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setMonthRecords((prev) => ({
          ...prev,
          [mKey]: {
            nocs: append ? [...(prev[mKey]?.nocs || []), ...(data.data.nocs || [])] : data.data.nocs || [],
            page: data.data.page || pageToLoad,
            totalPages: data.data.totalPages || 1,
            total: data.data.total || 0,
            loading: false,
          },
        }));
      } else {
        setMonthRecords((prev) => ({ ...prev, [mKey]: { ...prev[mKey], loading: false } }));
      }
    } catch {
      setMonthRecords((prev) => ({ ...prev, [mKey]: { ...prev[mKey], loading: false } }));
    }
  }, []);

  const toggleMonth = (client: string, monthKey: string) => {
    const mKey = `${client}::${monthKey}`;
    setOpenMonths((p) => {
      const nextOpen = !p[mKey];
      if (nextOpen && !monthRecords[mKey]) loadMonth(client, monthKey, 1, false);
      return { ...p, [mKey]: nextOpen };
    });
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/documents/noc/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
      toast({ title: 'NOC deleted', description: deleteTarget.nocNumber });
      setDeleteTarget(null);
      onChanged();
      loadMeta();
      // refresh any open month listings
      Object.entries(monthRecords).forEach(([key, val]) => {
        const [client, monthKey] = key.split('::');
        if (val) loadMonth(client, monthKey, 1, false);
      });
    } catch (e) {
      toast({ title: 'Failed to delete', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/50">
        <Folder className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Client Folders</h3>
        <span className="ml-auto text-xs text-slate-400">Client → Year → Month → NOC (final documents)</span>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-400">Loading archive…</div>
      ) : meta.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">No finalized NOCs yet. Generated NOCs are archived here automatically.</div>
      ) : (
        <div className="divide-y divide-slate-700/40">
          {meta.map((clientEntry) => {
            const clientOpen = openClients[clientEntry.clientName] ?? true;
            return (
              <div key={clientEntry.clientName}>
                <button type="button" className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-700/30 transition-colors text-left" onClick={() => setOpenClients((p) => ({ ...p, [clientEntry.clientName]: !clientOpen }))}>
                  {clientOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  <Folder className="h-4 w-4 text-amber-400" />
                  <span className="text-sm font-semibold text-white">{clientEntry.clientName}</span>
                  <Badge variant="secondary" className="bg-slate-700 text-slate-300 text-[10px]">{clientEntry.total} NOC{clientEntry.total !== 1 ? 's' : ''}</Badge>
                </button>

                {clientOpen && (
                  <div className="bg-slate-900/30">
                    {clientEntry.years.map((yearEntry) => {
                      const yKey = `${clientEntry.clientName}::${yearEntry.year}`;
                      const yearOpen = openYears[yKey] ?? true;
                      return (
                        <div key={yKey} className="border-t border-slate-700/30">
                          <button type="button" className="w-full flex items-center gap-2 pl-10 pr-4 py-2.5 hover:bg-slate-700/20 transition-colors text-left" onClick={() => setOpenYears((p) => ({ ...p, [yKey]: !yearOpen }))}>
                            {yearOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                            <CalendarDays className="h-3.5 w-3.5 text-blue-400" />
                            <span className="text-xs font-semibold text-slate-200 uppercase tracking-wide">{yearEntry.year}</span>
                          </button>
                          {yearOpen && yearEntry.months.map((monthEntry) => {
                            const mKey = `${clientEntry.clientName}::${monthEntry.monthKey}`;
                            const monthOpen = openMonths[mKey] ?? false;
                            const rec = monthRecords[mKey];
                            return (
                              <div key={mKey} className="border-t border-slate-700/20">
                                <button type="button" className="w-full flex items-center gap-2 pl-16 pr-4 py-2 hover:bg-slate-700/20 transition-colors text-left" onClick={() => toggleMonth(clientEntry.clientName, monthEntry.monthKey)}>
                                  {monthOpen ? <ChevronDown className="h-3 w-3 text-slate-500" /> : <ChevronRight className="h-3 w-3 text-slate-500" />}
                                  <span className="text-xs font-medium text-slate-300">{monthLabel(monthEntry.monthKey)}</span>
                                  <Badge variant="secondary" className="bg-slate-700/70 text-slate-300 text-[10px]">{monthEntry.count}</Badge>
                                </button>
                                {monthOpen && (
                                  <StaggerContainer className="pb-2" stagger={0.03}>
                                    {(rec?.nocs || []).map((noc) => (
                                      <StaggerItem key={noc.id}>
                                        <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-2.5 hover:border-slate-600 transition-colors">
                                          <FileText className="h-4 w-4 shrink-0 text-red-400" />
                                          <div className="min-w-0 flex-1">
                                            <div className="text-[13px] font-medium text-slate-200 truncate">
                                              {noc.nocNumber}{noc.projectName ? ` — ${noc.projectName}` : ''}
                                              {noc.version > 1 && <Badge variant="secondary" className="ml-1.5 bg-violet-500/15 text-violet-300 border border-violet-500/20 text-[9px] px-1">v{noc.version}</Badge>}
                                            </div>
                                            <div className="text-[11px] text-slate-400">
                                              {noc.nocDate} · {noc.employeeCount} employee{noc.employeeCount !== 1 ? 's' : ''}{noc.createdBy ? ` · by ${noc.createdBy}` : ''}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-0.5 shrink-0">
                                            <button type="button" title="View — open the NOC page" onClick={() => onViewNoc(noc.id)} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Eye className="h-3.5 w-3.5" /></button>
                                            <button type="button" title="Print" onClick={() => printPdf(`/api/documents/noc/${noc.id}/pdf?mode=inline&_=${Date.now()}`)} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Printer className="h-3.5 w-3.5" /></button>
                                            <button type="button" title="Download PDF" onClick={() => downloadNocPdf(noc)} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Download className="h-3.5 w-3.5" /></button>
                                            {canDelete && <button type="button" title="Delete" onClick={() => setDeleteTarget(noc)} className="rounded p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /></button>}
                                          </div>
                                        </div>
                                      </StaggerItem>
                                    ))}
                                    {rec?.loading && <div className="mx-4 mb-2 rounded-lg border border-slate-700/40 bg-slate-800/40 px-3 py-2.5 text-center text-xs text-slate-400">Loading…</div>}
                                    {!rec?.loading && rec && rec.page < rec.totalPages && (
                                      <div className="mx-4 mb-2">
                                        <Button variant="outline" size="sm" className="w-full border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white" onClick={() => loadMonth(clientEntry.clientName, monthEntry.monthKey, rec.page + 1, true)}>
                                          Load more ({rec.total - rec.nocs.length} remaining)
                                        </Button>
                                      </div>
                                    )}
                                  </StaggerContainer>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete this NOC?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {deleteTarget?.nocNumber} — the stored PDF will be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-slate-300 border-slate-700 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-red-500 hover:bg-red-600 text-white border-0">
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
