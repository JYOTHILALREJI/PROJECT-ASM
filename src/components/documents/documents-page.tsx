'use client';

import React from 'react';
import { motion } from 'framer-motion';
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
  Upload,
  ChevronRight,
  ChevronDown,
  X,
  Copy,
  ArrowUpDown,
  Check,
  Pencil,
  FileCheck2,
  CalendarDays,
  Building2,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import { StaggerContainer, StaggerItem, FadeIn } from '@/components/motion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NocEmployeeRow {
  uid: string;
  employeeId?: string; // source DB employee when picked from the picker
  name: string;
  trade: string;
  company: string;
  nationality: string;
  passport: string;
}

interface NocRecord {
  id: string;
  clientName: string;
  projectName: string;
  clientAddress: string;
  nocDate: string;
  monthKey: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  stampType: string;
  employeeCount: number;
  fileName: string;
  createdBy: string | null;
  createdAt: string;
  employees: Array<{ name: string; trade: string; company: string; nationality: string; passport: string }>;
}

interface EmployeeDocRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  trade: string | null;
  companyName: string | null;
  docType: string;
  docName: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdBy: string | null;
  createdAt: string;
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeId: string;
  trade: string | null;
  companyName: string | null;
  nationality: string | null;
  passportNumber: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let uidCounter = 0;
const nextUid = () => `row-${Date.now()}-${uidCounter++}`;

function todayDMY(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  passport: 'Passport',
  id_card: 'ID Card',
  visa: 'Visa',
  other: 'Other Documents',
};

/** Print a PDF URL directly: load it into a hidden iframe and print. */
function printPdf(url: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = url;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      window.open(url, '_blank');
    }
    setTimeout(() => iframe.remove(), 60_000);
  };
  document.body.appendChild(iframe);
}

// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-slate-400">{children}</span>;
}

const inputCls = 'bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-500 focus-visible:ring-blue-500/40';

// ---------------------------------------------------------------------------
// NOC Builder — client details + editable/sortable employee table
// ---------------------------------------------------------------------------

type SortKey = 'name' | 'trade' | 'company' | 'nationality' | 'passport';
interface SortState { key: SortKey; dir: 1 | -1 }

function SortHeader({
  label,
  sortKey,
  sort,
  onToggle,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onToggle: (key: SortKey) => void;
}) {
  return (
    <th className="px-2 py-2">
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide transition-colors',
          sort?.key === sortKey ? 'text-blue-300 bg-blue-500/10' : 'text-slate-300 hover:text-white hover:bg-slate-700/50',
        )}
        title={`Sort by ${label}`}
      >
        {label}
        <ArrowUpDown className={cn('h-3 w-3', sort?.key === sortKey ? 'opacity-100' : 'opacity-40')} />
        {sort?.key === sortKey && <span className="text-[10px]">{sort.dir === 1 ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

function NocBuilder({
  onSaved,
  onPreviewUrl,
}: {
  onSaved: () => void;
  onPreviewUrl: (url: string | null, title: string) => void;
}) {
  const { user } = useAuthStore();
  const [clientName, setClientName] = React.useState('');
  const [projectName, setProjectName] = React.useState('');
  const [clientAddress, setClientAddress] = React.useState('');
  const [nocDate, setNocDate] = React.useState(todayDMY());
  const [contactPerson, setContactPerson] = React.useState('Ms. Mafeeda Kader');
  const [contactPhone, setContactPhone] = React.useState('050 797 4153');
  const [contactEmail, setContactEmail] = React.useState('mafeedaarabianshieldmanpower@gmail.com');
  const [stampType, setStampType] = React.useState('procurement');

  const [rows, setRows] = React.useState<NocEmployeeRow[]>([]);
  const [sort, setSort] = React.useState<SortState | null>(null);

  const [search, setSearch] = React.useState('');
  const [options, setOptions] = React.useState<EmployeeOption[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [showOptions, setShowOptions] = React.useState(false);

  const [saving, setSaving] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);

  // ── employee search (debounced; setState runs inside the timer callback) ──
  React.useEffect(() => {
    const t = setTimeout(
      async () => {
        if (!search.trim()) {
          setOptions([]);
          setSearching(false);
          return;
        }
        setSearching(true);
        try {
          const res = await fetch(`/api/employees?search=${encodeURIComponent(search.trim())}&status=active&limit=25`);
          const data = await res.json();
          if (data.success) setOptions(data.data.employees || []);
        } catch {
          // silent
        } finally {
          setSearching(false);
        }
      },
      search.trim() ? 250 : 0,
    );
    return () => clearTimeout(t);
  }, [search]);

  const addEmployee = (emp: EmployeeOption) => {
    setRows((prev) => [
      ...prev,
      {
        uid: nextUid(),
        employeeId: emp.id,
        name: (emp.fullName || '').toUpperCase(),
        trade: (emp.trade || '').toUpperCase(),
        company: (emp.companyName || '').toUpperCase(),
        nationality: (emp.nationality || '').toUpperCase(),
        passport: (emp.passportNumber || '').toUpperCase(),
      },
    ]);
    setSearch('');
    setOptions([]);
    setShowOptions(false);
    toast({ title: 'Employee added', description: `${emp.fullName} added to the NOC table.` });
  };

  const addBlankRow = () => setRows((prev) => [...prev, { uid: nextUid(), name: '', trade: '', company: '', nationality: '', passport: '' }]);

  const duplicateRow = (uid: string) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.uid === uid);
      if (idx < 0) return prev;
      const copy = { ...prev[idx], uid: nextUid(), employeeId: undefined };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  const removeRow = (uid: string) => setRows((prev) => prev.filter((r) => r.uid !== uid));

  const updateRow = (uid: string, field: keyof NocEmployeeRow, value: string) =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, [field]: value } : r)));

  // ── sorting ──
  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev && prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = (a[sort.key] || '').toString().localeCompare((b[sort.key] || '').toString(), undefined, { sensitivity: 'base' });
      return av * sort.dir;
    });
    return copy;
  }, [rows, sort]);

  const buildPayload = () => ({
    clientName,
    projectName,
    clientAddress,
    nocDate,
    contactPerson,
    contactPhone,
    contactEmail,
    stampType,
    employees: sortedRows.map(({ name, trade, company, nationality, passport }) => ({ name, trade, company, nationality, passport })),
    actorUserId: user?.id,
    actorDisplayName: user?.name || user?.email,
  });

  const validate = (): string | null => {
    if (clientName.trim().length < 2) return 'Enter the client name (e.g. M/S PROSCAPE LLC).';
    if (!/^\d{2}-\d{2}-\d{4}$/.test(nocDate.trim())) return 'Date must be DD-MM-YYYY.';
    if (rows.length === 0) return 'Add at least one employee to the NOC table.';
    const unnamed = rows.filter((r) => !r.name.trim());
    if (unnamed.length > 0) return `${unnamed.length} row(s) have no employee name — fill or remove them.`;
    return null;
  };

  const handlePreview = async () => {
    const err = validate();
    if (err) {
      toast({ title: 'Cannot preview', description: err, variant: 'destructive' });
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch('/api/documents/noc/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) throw new Error('preview failed');
      const blob = await res.blob();
      onPreviewUrl(URL.createObjectURL(blob), `NOC Preview — ${clientName}${projectName ? ` · ${projectName}` : ''}`);
    } catch {
      toast({ title: 'Preview failed', description: 'Could not generate the NOC preview.', variant: 'destructive' });
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      toast({ title: 'Cannot prepare NOC', description: err, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/documents/noc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      toast({ title: 'NOC prepared & saved', description: `Stored in Documents → NOC → ${clientName} → ${monthLabel(data.data.noc.monthKey)}.` });
      onSaved();
      // Show the saved PDF (persisted) in the viewer
      onPreviewUrl(`/api/documents/noc/${data.data.noc.id}/pdf?mode=inline&_=${Date.now()}`, data.data.noc.fileName);
    } catch (e) {
      toast({ title: 'Failed to prepare NOC', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ── Client details ── */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 md:p-5">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">Client Details</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <FieldLabel>Client Name *</FieldLabel>
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="M/S PROSCAPE LLC" className={cn('uppercase', inputCls)} />
          </div>
          <div className="space-y-1">
            <FieldLabel>Project</FieldLabel>
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="ARABIAN RANCHES" className={cn('uppercase', inputCls)} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <FieldLabel>Client Address (one line per row)</FieldLabel>
            <Textarea
              value={clientAddress}
              onChange={(e) => setClientAddress(e.target.value)}
              placeholder={'Business Bay-Bay Square\nDubai, UAE'}
              rows={2}
              className={cn('uppercase resize-y', inputCls)}
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Date on Letter *</FieldLabel>
            <Input
              value={nocDate}
              onChange={(e) => setNocDate(e.target.value)}
              placeholder="DD-MM-YYYY"
              className={inputCls}
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Stamp</FieldLabel>
            <Select value={stampType} onValueChange={setStampType}>
              <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
                <SelectItem value="procurement">Procurement stamp</SelectItem>
                <SelectItem value="signature">Signed round stamp</SelectItem>
                <SelectItem value="none">No stamp</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator className="my-4 bg-slate-700/40" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <FieldLabel>Contact Person</FieldLabel>
            <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1">
            <FieldLabel>Phone</FieldLabel>
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputCls} />
          </div>
          <div className="space-y-1">
            <FieldLabel>Email</FieldLabel>
            <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      {/* ── Employee picker ── */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">Find Employees from Database</h3>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addBlankRow} className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white">
            <Plus className="h-3.5 w-3.5 mr-1" /> Blank row
          </Button>
        </div>
        <div className="relative">
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowOptions(true); }}
            onFocus={() => setShowOptions(true)}
            placeholder="Search by name, trade or passport…"
            className={inputCls}
          />
          {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">searching…</span>}
          {showOptions && options.length > 0 && (
            <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-2xl">
              {options.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-slate-700/60 border-b border-slate-700/40 last:border-0"
                  onClick={() => addEmployee(emp)}
                >
                  <div className="text-sm text-slate-200 font-medium">{emp.fullName}</div>
                  <div className="text-xs text-slate-400">
                    {[emp.trade, emp.companyName, emp.passportNumber].filter(Boolean).join(' · ') || emp.employeeId}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Editable / sortable table ── */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">NOC Employee Table</h3>
            <Badge variant="secondary" className="bg-blue-500/15 text-blue-300 border border-blue-500/20">{rows.length}</Badge>
          </div>
          <span className="text-xs text-slate-400">Click any cell to edit · click a header to sort</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No employees yet — search above or add a blank row.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60">
                <tr className="text-left">
                  <th className="px-2 py-2 text-xs font-semibold text-slate-400 w-10">#</th>
                  <SortHeader label="Name" sortKey="name" sort={sort} onToggle={toggleSort} />
                  <SortHeader label="Trade" sortKey="trade" sort={sort} onToggle={toggleSort} />
                  <SortHeader label="Company" sortKey="company" sort={sort} onToggle={toggleSort} />
                  <SortHeader label="Nationality" sortKey="nationality" sort={sort} onToggle={toggleSort} />
                  <SortHeader label="Passport #" sortKey="passport" sort={sort} onToggle={toggleSort} />
                  <th className="px-2 py-2 text-xs font-semibold text-slate-400 w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, idx) => (
                  <tr key={row.uid} className="border-t border-slate-700/40 hover:bg-slate-700/20 transition-colors">
                    <td className="px-2 py-1 text-center text-xs text-slate-400">{idx + 1}</td>
                    {(['name', 'trade', 'company', 'nationality', 'passport'] as const).map((field) => (
                      <td key={field} className="px-1 py-1">
                        <input
                          value={row[field]}
                          onChange={(e) => updateRow(row.uid, field, e.target.value.toUpperCase())}
                          className="w-full bg-transparent px-1.5 py-1.5 rounded text-slate-200 text-[13px] outline-none border border-transparent hover:border-slate-600/60 focus:border-blue-500/60 focus:bg-slate-900/60 transition-colors"
                          placeholder={field === 'name' ? 'EMPLOYEE NAME' : field === 'passport' ? 'PASSPORT #' : field.toUpperCase()}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => duplicateRow(row.uid)}
                          title="Duplicate row (e.g. same worker listed twice)"
                          className="rounded p-1.5 text-slate-400 hover:text-blue-300 hover:bg-slate-700/60 transition-colors"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRow(row.uid)}
                          title="Remove row"
                          className="rounded p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700/60 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={handlePreview}
          disabled={previewing || saving}
          className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white"
        >
          <Eye className="h-4 w-4 mr-2" />
          {previewing ? 'Generating…' : 'Preview NOC'}
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving || previewing}
          className="bg-blue-600 hover:bg-blue-500 text-white"
        >
          <FileCheck2 className="h-4 w-4 mr-2" />
          {saving ? 'Preparing…' : 'Confirm & Prepare NOC'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NOC Archive — client folders → month/year groups → NOC entries
// ---------------------------------------------------------------------------

function NocArchive({ refreshKey, onPreviewUrl }: { refreshKey: number; onPreviewUrl: (url: string | null, title: string) => void }) {
  const [nocs, setNocs] = React.useState<NocRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [openClients, setOpenClients] = React.useState<Record<string, boolean>>({});
  const [openMonths, setOpenMonths] = React.useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = React.useState<NocRecord | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/documents/noc');
      const data = await res.json();
      if (data.success) setNocs(data.data.nocs || []);
    } catch {
      toast({ title: 'Failed to load NOC archive', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load, refreshKey]);

  // group: clientName → monthKey → records (month desc)
  const grouped = React.useMemo(() => {
    const clients = new Map<string, Map<string, NocRecord[]>>();
    for (const noc of nocs) {
      if (!clients.has(noc.clientName)) clients.set(noc.clientName, new Map());
      const months = clients.get(noc.clientName)!;
      if (!months.has(noc.monthKey)) months.set(noc.monthKey, []);
      months.get(noc.monthKey)!.push(noc);
    }
    const clientEntries = [...clients.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, months] of clientEntries) {
      const monthEntries = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0]));
      months.clear();
      for (const [k, v] of monthEntries) months.set(k, v);
    }
    return clientEntries;
  }, [nocs]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/documents/noc/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
      toast({ title: 'NOC deleted', description: deleteTarget.fileName });
      setDeleteTarget(null);
      load();
    } catch (e) {
      toast({ title: 'Failed to delete NOC', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/50">
        <FolderOpen className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">NOC Archive</h3>
        <Badge variant="secondary" className="bg-slate-700 text-slate-300">{nocs.length}</Badge>
        <span className="ml-auto text-xs text-slate-400">Grouped by client folder → month & year</span>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-400">Loading archive…</div>
      ) : grouped.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">
          No NOCs saved yet. Prepare your first NOC above — it will be archived here under its client folder.
        </div>
      ) : (
        <div className="divide-y divide-slate-700/40">
          {grouped.map(([clientName, months]) => {
            const clientOpen = openClients[clientName] ?? true;
            const total = [...months.values()].reduce((n, arr) => n + arr.length, 0);
            return (
              <div key={clientName}>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-700/30 transition-colors text-left"
                  onClick={() => setOpenClients((p) => ({ ...p, [clientName]: !clientOpen }))}
                >
                  {clientOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  <Folder className="h-4 w-4 text-amber-400" />
                  <span className="text-sm font-semibold text-white">{clientName}</span>
                  <Badge variant="secondary" className="bg-slate-700 text-slate-300 text-[10px]">{total} NOC{total !== 1 ? 's' : ''}</Badge>
                </button>

                {clientOpen && (
                  <div className="bg-slate-900/30">
                    {[...months.entries()].map(([monthKey, records]) => {
                      const mKey = `${clientName}::${monthKey}`;
                      const monthOpen = openMonths[mKey] ?? true;
                      return (
                        <div key={mKey} className="border-t border-slate-700/30">
                          <button
                            type="button"
                            className="w-full flex items-center gap-2 pl-10 pr-4 py-2.5 hover:bg-slate-700/20 transition-colors text-left"
                            onClick={() => setOpenMonths((p) => ({ ...p, [mKey]: !monthOpen }))}
                          >
                            {monthOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                            <CalendarDays className="h-3.5 w-3.5 text-blue-400" />
                            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{monthLabel(monthKey)}</span>
                            <Badge variant="secondary" className="bg-slate-700/70 text-slate-300 text-[10px]">{records.length}</Badge>
                          </button>

                          {monthOpen && (
                            <StaggerContainer className="pb-2" stagger={0.03}>
                              {records.map((noc) => (
                                <StaggerItem key={noc.id}>
                                  <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-2.5 hover:border-slate-600 transition-colors">
                                    <FileText className="h-4 w-4 shrink-0 text-red-400" />
                                    <div className="min-w-0 flex-1">
                                      <div className="text-[13px] font-medium text-slate-200 truncate">{noc.fileName}</div>
                                      <div className="text-[11px] text-slate-400">
                                        {noc.nocDate}
                                        {noc.projectName ? ` · ${noc.projectName}` : ''} · {noc.employeeCount} employee{noc.employeeCount !== 1 ? 's' : ''}
                                        {noc.createdBy ? ` · by ${noc.createdBy}` : ''}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 px-2 text-slate-300 hover:text-white hover:bg-slate-700"
                                        onClick={() => onPreviewUrl(`/api/documents/noc/${noc.id}/pdf?mode=inline&_=${Date.now()}`, noc.fileName)}
                                        title="View"
                                      >
                                        <Eye className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 px-2 text-slate-300 hover:text-white hover:bg-slate-700"
                                        onClick={async () => {
                                          try {
                                            const res = await fetch(`/api/documents/noc/${noc.id}/pdf?mode=inline&_=${Date.now()}`);
                                            const blob = await res.blob();
                                            const url = URL.createObjectURL(blob);
                                            printPdf(url);
                                          } catch {
                                            window.open(`/api/documents/noc/${noc.id}/pdf?mode=inline`, '_blank');
                                          }
                                        }}
                                        title="Print"
                                      >
                                        <Printer className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 px-2 text-slate-300 hover:text-white hover:bg-slate-700"
                                        onClick={() => {
                                          const a = document.createElement('a');
                                          a.href = `/api/documents/noc/${noc.id}/pdf?mode=download`;
                                          a.download = noc.fileName;
                                          document.body.appendChild(a);
                                          a.click();
                                          a.remove();
                                        }}
                                        title="Download PDF"
                                      >
                                        <Download className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 px-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                                        onClick={() => setDeleteTarget(noc)}
                                        title="Delete"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </div>
                                </StaggerItem>
                              ))}
                            </StaggerContainer>
                          )}
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
              {deleteTarget?.fileName} will be removed from the archive. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-slate-300 border-slate-700 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white border-0"
            >
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employee Documents — per-employee passport / ID / visa / other scans
// ---------------------------------------------------------------------------

const DOC_GROUPS: Array<{ type: string; icon: React.ElementType; accent: string }> = [
  { type: 'passport', icon: FileText, accent: 'text-blue-400' },
  { type: 'id_card', icon: FileText, accent: 'text-emerald-400' },
  { type: 'visa', icon: FileText, accent: 'text-violet-400' },
  { type: 'other', icon: FileText, accent: 'text-amber-400' },
];

function EmployeeDocuments() {
  const { user } = useAuthStore();
  const [search, setSearch] = React.useState('');
  const [options, setOptions] = React.useState<EmployeeOption[]>([]);
  const [selected, setSelected] = React.useState<EmployeeOption | null>(null);
  const [docs, setDocs] = React.useState<EmployeeDocRecord[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [uploadingType, setUploadingType] = React.useState<string | null>(null);
  const [otherName, setOtherName] = React.useState('');
  const [renameTarget, setRenameTarget] = React.useState<EmployeeDocRecord | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<EmployeeDocRecord | null>(null);

  const fileInputs = React.useRef<Record<string, HTMLInputElement | null>>({});

  // employee search (debounced; setState runs inside the timer callback)
  React.useEffect(() => {
    const t = setTimeout(
      () => {
        if (!search.trim()) {
          setOptions([]);
          return;
        }
        (async () => {
          try {
            const res = await fetch(`/api/employees?search=${encodeURIComponent(search.trim())}&status=active&limit=25`);
            const data = await res.json();
            if (data.success) setOptions(data.data.employees || []);
          } catch {
            // silent
          }
        })();
      },
      search.trim() ? 250 : 0,
    );
    return () => clearTimeout(t);
  }, [search]);

  const loadDocs = React.useCallback(async (employeeId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/employee?employeeId=${employeeId}`);
      const data = await res.json();
      if (data.success) setDocs(data.data.documents || []);
    } catch {
      toast({ title: 'Failed to load documents', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!selected) {
      const t = setTimeout(() => setDocs([]), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => loadDocs(selected.id), 0);
    return () => clearTimeout(t);
  }, [selected, loadDocs]);

  const uploadFor = async (docType: string, file: File) => {
    if (!selected) return;
    setUploadingType(docType);
    try {
      const form = new FormData();
      form.append('employeeId', selected.id);
      form.append('docType', docType);
      if (docType === 'other' && otherName.trim()) form.append('docName', otherName.trim());
      form.append('actorDisplayName', user?.name || user?.email || '');
      form.append('actorUserId', user?.id || '');
      form.append('file', file);
      const res = await fetch('/api/documents/employee', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');
      toast({ title: 'Document uploaded', description: `${file.name} stored under ${DOC_TYPE_LABELS[docType]}.` });
      if (docType === 'other') setOtherName('');
      loadDocs(selected.id);
    } catch (e) {
      toast({ title: 'Upload failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setUploadingType(null);
      if (fileInputs.current[docType]) fileInputs.current[docType]!.value = '';
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      const res = await fetch(`/api/documents/employee/${renameTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docName: renameValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Rename failed');
      toast({ title: 'Document renamed' });
      setRenameTarget(null);
      if (selected) loadDocs(selected.id);
    } catch (e) {
      toast({ title: 'Rename failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/documents/employee/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
      toast({ title: 'Document deleted', description: deleteTarget.docName });
      setDeleteTarget(null);
      if (selected) loadDocs(selected.id);
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-5">
      {/* picker */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Search className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">Select Employee</h3>
        </div>
        {!selected ? (
          <div className="relative">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee by name, trade or passport…"
              className={inputCls}
            />
            {options.length > 0 && (
              <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-2xl">
                {options.map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    className="w-full px-3 py-2 text-left hover:bg-slate-700/60 border-b border-slate-700/40 last:border-0"
                    onClick={() => { setSelected(emp); setSearch(''); setOptions([]); }}
                  >
                    <div className="text-sm text-slate-200 font-medium">{emp.fullName}</div>
                    <div className="text-xs text-slate-400">{[emp.trade, emp.companyName, emp.passportNumber].filter(Boolean).join(' · ') || emp.employeeId}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/20 text-blue-300 font-semibold text-sm">
              {selected.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white">{selected.fullName}</div>
              <div className="text-xs text-slate-400">{[selected.trade, selected.companyName, selected.passportNumber].filter(Boolean).join(' · ') || selected.employeeId}</div>
            </div>
            <Button variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-700 hover:text-white" onClick={() => setSelected(null)}>
              Change
            </Button>
          </div>
        )}
      </div>

      {!selected ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-10 text-center text-sm text-slate-400">
          Select an employee to manage their passport, ID card, visa and other scanned documents.
        </div>
      ) : loading ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-10 text-center text-sm text-slate-400">Loading documents…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {DOC_GROUPS.map(({ type, icon: Icon, accent }) => {
            const groupDocs = docs.filter((d) => d.docType === type);
            return (
              <div key={type} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={cn('h-4 w-4', accent)} />
                  <h4 className="text-sm font-semibold text-white">{DOC_TYPE_LABELS[type]}</h4>
                  <Badge variant="secondary" className="bg-slate-700 text-slate-300 text-[10px]">{groupDocs.length}</Badge>
                  <div className="ml-auto">
                    <input
                      ref={(el) => { fileInputs.current[type] = el; }}
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadFor(type, f);
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={uploadingType === type}
                      onClick={() => fileInputs.current[type]?.click()}
                      className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white h-8"
                    >
                      <Upload className="h-3.5 w-3.5 mr-1" />
                      {uploadingType === type ? 'Uploading…' : 'Upload'}
                    </Button>
                  </div>
                </div>

                {type === 'other' && (
                  <Input
                    value={otherName}
                    onChange={(e) => setOtherName(e.target.value)}
                    placeholder="Optional document name for the next upload (e.g. Labour Contract)"
                    className={cn('mb-3 h-8 text-xs', inputCls)}
                  />
                )}

                {groupDocs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700/70 px-3 py-4 text-center text-xs text-slate-500">
                    No {DOC_TYPE_LABELS[type].toLowerCase()} documents yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groupDocs.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-900/40 px-3 py-2">
                        <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-slate-200 truncate">{doc.docName}</div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {doc.fileName} · {formatBytes(doc.fileSize)} · {new Date(doc.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            title="Rename"
                            onClick={() => { setRenameTarget(doc); setRenameValue(doc.docName); }}
                            className="rounded p-1.5 text-slate-400 hover:text-blue-300 hover:bg-slate-700/60 transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="View"
                            onClick={() => window.open(`/api/documents/employee/${doc.id}/file?mode=inline&_=${Date.now()}`, '_blank')}
                            className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Download"
                            onClick={() => {
                              const a = document.createElement('a');
                              a.href = `/api/documents/employee/${doc.id}/file?mode=download`;
                              a.download = doc.fileName;
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                            }}
                            className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            onClick={() => setDeleteTarget(doc)}
                            className="rounded p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* rename dialog */}
      <AlertDialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Rename document</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Give this document a clear, correct name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Document name"
            className={inputCls}
            autoFocus
          />
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-slate-300 border-slate-700 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRename} className="bg-blue-600 hover:bg-blue-500 text-white border-0">
              <Check className="h-4 w-4 mr-2" /> Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* delete dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete this document?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {deleteTarget?.docName} ({deleteTarget?.fileName}) will be removed permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-slate-300 border-slate-700 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-500 hover:bg-red-600 text-white border-0">
              <Trash2 className="h-4 w-4 mr-2" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocumentsPage — tabs: NOC | Employee Documents
// ---------------------------------------------------------------------------

export function DocumentsPage() {
  const [tab, setTab] = React.useState<'noc' | 'employee'>('noc');
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [viewerUrl, setViewerUrl] = React.useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = React.useState('');
  const [viewerBlob, setViewerBlob] = React.useState(false);

  const handlePreviewUrl = (url: string | null, title: string) => {
    if (viewerUrl && viewerBlob) URL.revokeObjectURL(viewerUrl);
    setViewerBlob(!!url && url.startsWith('blob:'));
    setViewerUrl(url);
    setViewerTitle(title);
  };

  const tabs: Array<{ id: 'noc' | 'employee'; label: string; icon: React.ElementType }> = [
    { id: 'noc', label: 'NOC', icon: FileCheck2 },
    { id: 'employee', label: 'Employee Documents', icon: FolderOpen },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* Header */}
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Documents</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Automated NOC letters and scanned employee documents — all in one place.
            </p>
          </div>
        </div>
      </FadeIn>

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors border',
              tab === id
                ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200 hover:bg-slate-700/40',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'noc' ? (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          {/* Builder + archive */}
          <motion.div className="xl:col-span-3 space-y-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <NocBuilder onSaved={() => setRefreshKey((k) => k + 1)} onPreviewUrl={handlePreviewUrl} />
          </motion.div>

          {/* PDF viewer */}
          <motion.div
            className="xl:col-span-2"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08 }}
          >
            <div className="xl:sticky xl:top-6 rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/50">
                <FileText className="h-4 w-4 text-red-400" />
                <span className="text-sm font-semibold text-white truncate">{viewerTitle || 'NOC Viewer'}</span>
              </div>
              {viewerUrl ? (
                <>
                  <iframe src={viewerUrl} title="NOC PDF" className="w-full h-[520px] bg-white" />
                  <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-700/50">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white"
                      onClick={() => printPdf(viewerUrl)}
                    >
                      <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
                    </Button>
                    {viewerBlob && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white"
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = viewerUrl;
                          a.download = viewerTitle || 'NOC.pdf';
                          a.click();
                        }}
                      >
                        <Download className="h-3.5 w-3.5 mr-1.5" /> Download PDF
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-slate-400 hover:bg-slate-700 hover:text-white"
                      onClick={() => handlePreviewUrl(null, '')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex h-[420px] flex-col items-center justify-center gap-3 text-center px-6">
                  <FileText className="h-10 w-10 text-slate-600" />
                  <p className="text-sm text-slate-400">
                    Preview the NOC here. Use <span className="text-slate-200 font-medium">Preview NOC</span> before saving, or view any archived NOC from the archive below.
                  </p>
                </div>
              )}
            </div>
          </motion.div>

          {/* Archive spans full width below */}
          <div className="xl:col-span-5">
            <NocArchive refreshKey={refreshKey} onPreviewUrl={handlePreviewUrl} />
          </div>
        </div>
      ) : (
        <FadeIn>
          <EmployeeDocuments />
        </FadeIn>
      )}
    </div>
  );
}
