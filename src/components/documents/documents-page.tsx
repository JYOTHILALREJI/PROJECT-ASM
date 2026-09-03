'use client';

/**
 * DocumentsPage — Documents module (PRD v1.0):
 *   Dashboard · NOC (list/folders/create workspace with drafts) ·
 *   Employee Documents · NOC Template settings.
 * Fine-grained permissions: documents_noc, documents_employee_docs,
 * documents_delete (super_admin bypasses everything).
 */
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
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
  Copy,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileCheck2,
  CalendarDays,
  Building2,
  User,
  LayoutDashboard,
  Settings2,
  CheckCircle2,
  Upload,
  AlertTriangle,
  Save,
  RotateCcw,
  Pencil,
  Lock,
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
import { EmployeeDocumentsPanel } from '@/components/documents/employee-documents-panel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NocEmployeeRow {
  uid: string;
  employeeId?: string; // DB employee id when picked from the database
  source: 'database' | 'manual';
  name: string;
  trade: string;
  company: string;
  nationality: string;
  passport: string;
}

interface NocRecord {
  id: string;
  nocNumber: string;
  status: 'draft' | 'final';
  version: number;
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
  updatedAt: string;
  employees: Array<{ name: string; trade: string; company: string; nationality: string; passport: string }>;
}

interface NocTemplateData {
  bodyText: string;
  companyName: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
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

const inputCls = 'bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-500 focus-visible:ring-blue-500/40';

/** Fetch the current admin's document permissions. */
function useDocumentPermissions(): { canNoc: boolean; canEmployeeDocs: boolean; canDelete: boolean; loaded: boolean } {
  const { user } = useAuthStore();
  const [perms, setPerms] = React.useState({ canNoc: false, canEmployeeDocs: false, canDelete: false, loaded: false });
  React.useEffect(() => {
    if (!user) return;
    if (user.role === 'super_admin') {
      const t = setTimeout(() => setPerms({ canNoc: true, canEmployeeDocs: true, canDelete: true, loaded: true }), 0);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/permissions?adminId=${user.id}`);
        const data = await res.json();
        if (!cancelled && data.success) {
          const granted = new Set((data.data.permissions || []).filter((p: { granted?: boolean }) => p.granted).map((p: { slug: string }) => p.slug));
          setPerms({
            canNoc: granted.has('documents_noc'),
            canEmployeeDocs: granted.has('documents_employee_docs'),
            canDelete: granted.has('documents_delete'),
            loaded: true,
          });
        }
      } catch {
        if (!cancelled) setPerms((p) => ({ ...p, loaded: true }));
      }
    };
    const t = setTimeout(load, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [user]);
  return perms;
}

// ---------------------------------------------------------------------------
// NocWorkspace — create / edit (draft) with steps, drafts, sorting, reordering
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
    <th className="px-2 py-2 sticky top-0 bg-slate-900/95 z-10">
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

const STEPS = ['Details', 'Employees', 'Review', 'Preview', 'Complete'];

function NocWorkspace({
  editNoc,
  template,
  onClose,
  onSaved,
}: {
  editNoc: NocRecord | null; // DRAFT being edited (finals are versioned first)
  template: NocTemplateData | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuthStore();
  const [clientName, setClientName] = React.useState(editNoc?.clientName || '');
  const [address1, setAddress1] = React.useState((editNoc?.clientAddress || '').split('\n')[0] || '');
  const [address2, setAddress2] = React.useState((editNoc?.clientAddress || '').split('\n')[1] || '');
  const [city, setCity] = React.useState((editNoc?.clientAddress || '').split('\n')[2] || '');
  const [country, setCountry] = React.useState((editNoc?.clientAddress || '').split('\n')[3] || '');
  const [projectName, setProjectName] = React.useState(editNoc?.projectName || '');
  const [nocDate, setNocDate] = React.useState(editNoc?.nocDate || todayDMY());
  const [contactPerson, setContactPerson] = React.useState(editNoc?.contactPerson || template?.contactPerson || 'Ms. Mafeeda Kader');
  const [contactPhone, setContactPhone] = React.useState(editNoc?.contactPhone || template?.contactPhone || '050 797 4153');
  const [contactEmail, setContactEmail] = React.useState(editNoc?.contactEmail || template?.contactEmail || 'mafeedaarabianshieldmanpower@gmail.com');
  const [stampType, setStampType] = React.useState(editNoc?.stampType || 'procurement');

  const [rows, setRows] = React.useState<NocEmployeeRow[]>(
    (editNoc?.employees || []).map((e) => ({
      uid: nextUid(), source: 'database' as const,
      name: e.name || '', trade: e.trade || '', company: e.company || '', nationality: e.nationality || '', passport: e.passport || '',
    })),
  );
  const [originalOrder, setOriginalOrder] = React.useState<string[]>([]);
  const [sort, setSort] = React.useState<SortState | null>(null);

  const [search, setSearch] = React.useState('');
  const [options, setOptions] = React.useState<EmployeeOption[]>([]);
  const [pickedIds, setPickedIds] = React.useState<Set<string>>(new Set());
  const [replaceTargetUid, setReplaceTargetUid] = React.useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<NocEmployeeRow | null>(null);

  const [step, setStep] = React.useState(1);
  const [draftId, setDraftId] = React.useState<string | null>(editNoc?.id || null);
  const [draftNumber, setDraftNumber] = React.useState<string>(editNoc?.nocNumber || '');
  const [draftVersion, setDraftVersion] = React.useState<number>(editNoc?.version || 1);
  const [draftSavedAt, setDraftSavedAt] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [finalNoc, setFinalNoc] = React.useState<NocRecord | null>(null);
  const [generating, setGenerating] = React.useState(false);

  const clientAddress = [address1, address2, city, country].map((l) => l.trim()).filter(Boolean).join('\n');

  const buildPayload = (status: 'draft' | 'final') => ({
    clientName,
    projectName,
    clientAddress,
    nocDate,
    contactPerson,
    contactPhone,
    contactEmail,
    stampType,
    status,
    employees: rows.map(({ name, trade, company, nationality, passport }) => ({ name, trade, company, nationality, passport })),
    actorUserId: user?.id,
    actorDisplayName: user?.name || user?.email,
  });

  const hasContent = clientName.trim() || projectName.trim() || rows.length > 0;

  const saveDraft = React.useCallback(
    async (silent = true) => {
      if (!hasContent) return;
      setSavingDraft(true);
      try {
        let res: Response;
        if (draftId) {
          res = await fetch(`/api/documents/noc/${draftId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildPayload('draft')),
          });
        } else {
          res = await fetch('/api/documents/noc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildPayload('draft')),
          });
        }
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Draft save failed');
        setDraftId(data.data.noc.id);
        setDraftNumber(data.data.noc.nocNumber);
        setDraftVersion(data.data.noc.version);
        setDraftSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        setDirty(false);
        if (!silent) toast({ title: 'Draft saved', description: `${data.data.noc.nocNumber} — continue anytime from Drafts.` });
        onSaved();
      } catch (e) {
        if (!silent) toast({ title: 'Draft save failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
      } finally {
        setSavingDraft(false);
      }
    },
    [draftId, clientName, projectName, clientAddress, nocDate, contactPerson, contactPhone, contactEmail, stampType, rows, hasContent],
  );

  // auto-save (debounced) whenever the workspace is dirty
  React.useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { saveDraft(true); }, 1500);
    return () => clearTimeout(t);
  }, [dirty, rows, clientName, projectName, clientAddress, nocDate, stampType]);

  // warn before leaving with unsaved changes
  React.useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const markDirty = () => setDirty(true);

  // ── employee search (debounced) ──
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

  const addedEmployeeIds = React.useMemo(
    () => new Set(rows.map((r) => r.employeeId).filter(Boolean) as string[]),
    [rows],
  );

  const addSelected = () => {
    const chosen = options.filter((o) => pickedIds.has(o.id));
    if (chosen.length === 0) return;
    if (replaceTargetUid) {
      const first = chosen[0];
      setRows((prev) => prev.map((r) => (r.uid === replaceTargetUid ? {
        ...r,
        employeeId: first.id,
        source: 'database' as const,
        name: (first.fullName || '').toUpperCase(),
        trade: (first.trade || '').toUpperCase(),
        company: (first.companyName || '').toUpperCase(),
        nationality: (first.nationality || '').toUpperCase(),
        passport: (first.passportNumber || '').toUpperCase(),
      } : r)));
      setReplaceTargetUid(null);
    } else {
      const existing = new Set(rows.map((r) => r.employeeId));
      const fresh = chosen.filter((o) => !existing.has(o.id));
      if (fresh.length === 0) {
        toast({ title: 'Already added', description: 'Selected employees are already in the table.' });
      } else {
        setRows((prev) => [
          ...prev,
          ...fresh.map((emp) => ({
            uid: nextUid(),
            employeeId: emp.id,
            source: 'database' as const,
            name: (emp.fullName || '').toUpperCase(),
            trade: (emp.trade || '').toUpperCase(),
            company: (emp.companyName || '').toUpperCase(),
            nationality: (emp.nationality || '').toUpperCase(),
            passport: (emp.passportNumber || '').toUpperCase(),
          })),
        ]);
      }
    }
    setPickedIds(new Set());
    setSearch('');
    setOptions([]);
    setDirty(true);
  };

  const addBlankRow = () => {
    setRows((prev) => [...prev, { uid: nextUid(), source: 'manual', name: '', trade: '', company: '', nationality: '', passport: '' }]);
    setDirty(true);
  };

  const duplicateRow = (uid: string) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.uid === uid);
      if (idx < 0) return prev;
      const next = [...prev];
      next.splice(idx + 1, 0, { ...prev[idx], uid: nextUid(), employeeId: undefined, source: 'manual' as const });
      return next;
    });
    setDirty(true);
  };

  const removeRow = (uid: string) => {
    setRows((prev) => prev.filter((r) => r.uid !== uid));
    setRemoveTarget(null);
    setDirty(true);
  };

  const updateRow = (uid: string, field: keyof NocEmployeeRow, value: string) => {
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, [field]: value } : r)));
    setDirty(true);
  };

  const moveRow = (uid: string, dir: -1 | 1) => {
    if (sort) return; // manual reorder only in insertion order
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.uid === uid);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
    setDirty(true);
  };

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev && prev.key === key) {
        if (prev.dir === 1) return { key, dir: -1 as const };
        return null; // third click clears → insertion order
      }
      return { key, dir: 1 as const };
    });
  };

  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const copy = [...rows];
    copy.sort((a, b) => ((a[sort.key] || '').toString().localeCompare((b[sort.key] || '').toString(), undefined, { sensitivity: 'base' })) * sort.dir);
    return copy;
  }, [rows, sort]);

  // ── validation (PRD §17/§53) ──
  const warnings = React.useMemo(() => {
    const w: string[] = [];
    const missingPassport = rows.filter((r) => r.name.trim() && !r.passport.trim());
    if (missingPassport.length > 0) w.push(`${missingPassport.length} employee${missingPassport.length !== 1 ? 's are' : ' is'} missing a passport number.`);
    const passportSeen = new Map<string, number>();
    rows.forEach((r, i) => {
      const p = r.passport.trim();
      if (p && passportSeen.has(p)) w.push(`Passport ${p} is used by more than one employee in this NOC (rows ${passportSeen.get(p)! + 1} and ${i + 1}).`);
      else if (p) passportSeen.set(p, i);
    });
    const nameSeen = new Map<string, number>();
    rows.forEach((r, i) => {
      const n = r.name.trim();
      if (n && nameSeen.has(n)) w.push(`${n} appears twice (rows ${nameSeen.get(n)! + 1} and ${i + 1}).`);
      else if (n) nameSeen.set(n, i);
    });
    return w;
  }, [rows]);

  const blockingError = (): string | null => {
    if (clientName.trim().length < 2) return 'Enter the client name (e.g. M/S PROSCAPE LLC).';
    if (!/^\d{2}-\d{2}-\d{4}$/.test(nocDate.trim())) return 'Date must be DD-MM-YYYY.';
    if (rows.length === 0) return 'Add at least one employee to the NOC table.';
    const unnamed = rows.filter((r) => !r.name.trim());
    if (unnamed.length > 0) return `${unnamed.length} row(s) have no employee name — fill or remove them.`;
    return null;
  };

  const handlePreview = async () => {
    const err = blockingError();
    if (err) {
      toast({ title: 'Cannot preview', description: err, variant: 'destructive' });
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch('/api/documents/noc/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...buildPayload('final'),
          bodyText: template?.bodyText,
          companyName: template?.companyName,
        }),
      });
      if (!res.ok) throw new Error('preview failed');
      const blob = await res.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
      setStep(4);
    } catch {
      toast({ title: 'Preview failed', description: 'Could not generate the NOC preview.', variant: 'destructive' });
    } finally {
      setPreviewing(false);
    }
  };

  const generateFinal = async () => {
    const err = blockingError();
    if (err) {
      toast({ title: 'Cannot generate NOC', description: err, variant: 'destructive' });
      return;
    }
    setGenerating(true);
    try {
      let res: Response;
      if (draftId) {
        res = await fetch(`/api/documents/noc/${draftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload('final')),
        });
      } else {
        res = await fetch('/api/documents/noc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload('final')),
        });
      }
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Generation failed');
      setFinalNoc(data.data.noc);
      setStep(5);
      toast({ title: 'NOC generated & stored', description: `${data.data.noc.nocNumber} saved to the archive.` });
      onSaved();
    } catch (e) {
      toast({ title: 'Failed to generate NOC', description: `${e instanceof Error ? e.message : 'Unknown error'}. Your entered information has been saved as a draft.`, variant: 'destructive' });
      saveDraft(true);
    } finally {
      setGenerating(false);
    }
  };

  const stepState = React.useMemo(() => {
    const detailsOk = clientName.trim().length >= 2 && /^\d{2}-\d{2}-\d{4}$/.test(nocDate.trim());
    const employeesOk = rows.length > 0;
    const reviewOk = employeesOk && warnings.length === 0;
    return [true, detailsOk, employeesOk, reviewOk, !!finalNoc];
  }, [clientName, nocDate, rows.length, warnings.length, finalNoc]);

  return (
    <div className="space-y-5">
      {/* header + steps */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">{editNoc ? `Edit Draft ${draftNumber}` : 'Create NOC'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {draftNumber ? `NOC ${draftNumber} · Version ${draftVersion} · ` : ''}
              {draftSavedAt ? `Draft saved ${draftSavedAt}` : savingDraft ? 'Saving draft…' : dirty ? 'Unsaved changes — autosaving…' : 'Drafts save automatically while you work'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!editNoc && (
              <Button variant="outline" size="sm" onClick={() => saveDraft(false)} disabled={savingDraft || !hasContent} className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white">
                <Save className="h-3.5 w-3.5 mr-1.5" /> Save Draft
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400 hover:bg-slate-700 hover:text-white">
              <X className="h-3.5 w-3.5 mr-1" /> Close
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-4 overflow-x-auto">
          {STEPS.map((label, i) => {
            const active = step === i + 1;
            const done = stepState[i] && i + 1 !== 5 ? true : i + 1 === 5 ? !!finalNoc : false;
            return (
              <React.Fragment key={label}>
                {i > 0 && <div className={cn('h-px flex-1 min-w-4', done ? 'bg-blue-500/60' : 'bg-slate-600/60')} />}
                <button
                  type="button"
                  onClick={() => i + 1 <= Math.max(step, 3) && setStep(i + 1)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap',
                    active ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : done ? 'text-emerald-300' : 'text-slate-500',
                  )}
                >
                  <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold', active ? 'bg-blue-500 text-white' : done ? 'bg-emerald-500/30 text-emerald-200' : 'bg-slate-700 text-slate-400')}>
                    {i + 1}
                  </span>
                  {label}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* validation warnings */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-200 space-y-1">
              {warnings.map((w, i) => <div key={i}>{w}</div>)}
              <div className="text-amber-300/80">Review these before generating — duplicates are allowed only for exceptional operational cases.</div>
            </div>
          </div>
        </div>
      )}

      {step <= 3 && (
        <>
          {/* ── Recipient & project details ── */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 md:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="h-4 w-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-white">Recipient & Project Details</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Client / Company Name *</span>
                <Input value={clientName} onChange={(e) => { setClientName(e.target.value); markDirty(); }} placeholder="M/S PROSCAPE LLC" className={cn('uppercase', inputCls)} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Project Name *</span>
                <Input value={projectName} onChange={(e) => { setProjectName(e.target.value); markDirty(); }} placeholder="ARABIAN RANCHES" className={cn('uppercase', inputCls)} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Address Line 1</span>
                <Input value={address1} onChange={(e) => { setAddress1(e.target.value); markDirty(); }} placeholder="Business Bay-Bay Square" className={cn('uppercase', inputCls)} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Address Line 2</span>
                <Input value={address2} onChange={(e) => { setAddress2(e.target.value); markDirty(); }} placeholder="Building / area" className={cn('uppercase', inputCls)} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">City</span>
                <Input value={city} onChange={(e) => { setCity(e.target.value); markDirty(); }} placeholder="Dubai" className={cn('uppercase', inputCls)} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Country</span>
                <Input value={country} onChange={(e) => { setCountry(e.target.value); markDirty(); }} placeholder="UAE" className={cn('uppercase', inputCls)} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">NOC Date *</span>
                <Input value={nocDate} onChange={(e) => { setNocDate(e.target.value); markDirty(); }} placeholder="DD-MM-YYYY" className={inputCls} inputMode="numeric" />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Stamp</span>
                <Select value={stampType} onValueChange={(v) => { setStampType(v); markDirty(); }}>
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
                <span className="text-xs font-medium text-slate-400">Contact Person</span>
                <Input value={contactPerson} onChange={(e) => { setContactPerson(e.target.value); markDirty(); }} className={inputCls} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Phone</span>
                <Input value={contactPhone} onChange={(e) => { setContactPhone(e.target.value); markDirty(); }} className={inputCls} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Email</span>
                <Input value={contactEmail} onChange={(e) => { setContactEmail(e.target.value); markDirty(); }} className={inputCls} />
              </div>
            </div>
          </div>

          {/* ── Employee selection ── */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-white">Select Employees from Database</h3>
                {replaceTargetUid && <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30">Replacing a row — pick an employee</Badge>}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addBlankRow} className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add manually
              </Button>
            </div>
            <div className="relative">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} onFocus={() => replaceTargetUid && null} placeholder="Search by name / passport / employee ID…" className={inputCls} />
              {options.length > 0 && (
                <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-2xl">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/60 bg-slate-800/95 sticky top-0">
                    <span className="text-xs text-slate-400">{pickedIds.size} selected — tick the checkbox, then add</span>
                    <Button size="sm" variant="outline" disabled={pickedIds.size === 0} onClick={addSelected} className="h-7 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white">
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {replaceTargetUid ? 'Replace row' : `Add selected (${pickedIds.size})`}
                    </Button>
                  </div>
                  {options.map((emp) => {
                    const already = addedEmployeeIds.has(emp.id) && !pickedIds.has(emp.id);
                    return (
                      <label key={emp.id} className={cn('flex items-center gap-3 px-3 py-2 border-b border-slate-700/40 last:border-0 cursor-pointer hover:bg-slate-700/40', already && 'opacity-50')}>
                        <input
                          type="checkbox"
                          checked={pickedIds.has(emp.id)}
                          disabled={already}
                          onChange={(e) => {
                            const next = new Set(pickedIds);
                            if (e.target.checked) next.add(emp.id);
                            else next.delete(emp.id);
                            setPickedIds(next);
                          }}
                          className="h-4 w-4 accent-blue-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-slate-200 font-medium">{emp.fullName}</div>
                          <div className="text-xs text-slate-400">{[emp.trade, emp.companyName, emp.nationality, emp.passportNumber].filter(Boolean).join(' · ') || emp.employeeId}</div>
                        </div>
                        {already && <span className="text-[10px] text-emerald-400 uppercase">added</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Editable / sortable / reorderable table ── */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-visible">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-700/50">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-white">Review Employee Table</h3>
                <Badge variant="secondary" className="bg-blue-500/15 text-blue-300 border border-blue-500/20">{rows.length}</Badge>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">This order becomes the NOC order</span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" disabled={!sort} onClick={() => setSort(null)} className="h-7 text-slate-400 hover:bg-slate-700 hover:text-white">
                  <RotateCcw className="h-3 w-3 mr-1" /> Reset order
                </Button>
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">No employees yet — search above or add manually.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/60">
                    <tr className="text-left">
                      <th className="px-2 py-2 text-xs font-semibold text-slate-400 w-10 sticky top-0 bg-slate-900/95">#</th>
                      <SortHeader label="Name" sortKey="name" sort={sort} onToggle={toggleSort} />
                      <SortHeader label="Trade" sortKey="trade" sort={sort} onToggle={toggleSort} />
                      <SortHeader label="Company" sortKey="company" sort={sort} onToggle={toggleSort} />
                      <SortHeader label="Nationality" sortKey="nationality" sort={sort} onToggle={toggleSort} />
                      <SortHeader label="Passport #" sortKey="passport" sort={sort} onToggle={toggleSort} />
                      <th className="px-2 py-2 text-xs font-semibold text-slate-400 w-28 sticky top-0 bg-slate-900/95">Actions</th>
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
                          <div className="flex items-center gap-0.5">
                            <button type="button" onClick={() => moveRow(row.uid, -1)} disabled={!!sort || idx === 0} title="Move up" className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-700/60 disabled:opacity-25 disabled:cursor-not-allowed">
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button type="button" onClick={() => moveRow(row.uid, 1)} disabled={!!sort || idx === sortedRows.length - 1} title="Move down" className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-700/60 disabled:opacity-25 disabled:cursor-not-allowed">
                              <ArrowDown className="h-3 w-3" />
                            </button>
                            <button type="button" onClick={() => { setReplaceTargetUid(row.uid); setSearch('x'); setTimeout(() => setSearch(''), 50); }} title="Change employee (search & replace)" className="rounded p-1 text-slate-400 hover:text-blue-300 hover:bg-slate-700/60">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button type="button" onClick={() => duplicateRow(row.uid)} title="Duplicate row" className="rounded p-1 text-slate-400 hover:text-blue-300 hover:bg-slate-700/60">
                              <Copy className="h-3 w-3" />
                            </button>
                            <button type="button" onClick={() => setRemoveTarget(row)} title="Remove row" className="rounded p-1 text-slate-400 hover:text-red-400 hover:bg-slate-700/60">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-2 border-t border-slate-700/40 text-[11px] text-slate-500">
              Edits here apply to this NOC only — the master employee record is never modified (document snapshot).
            </div>
          </div>

          {/* actions */}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={handlePreview} disabled={previewing || generating} className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white">
              <Eye className="h-4 w-4 mr-2" />
              {previewing ? 'Generating…' : 'Preview NOC'}
            </Button>
            <Button type="button" onClick={generateFinal} disabled={generating || previewing} className="bg-blue-600 hover:bg-blue-500 text-white">
              <FileCheck2 className="h-4 w-4 mr-2" />
              {generating ? 'Preparing…' : 'Confirm & Generate NOC'}
            </Button>
          </div>
        </>
      )}

      {step >= 4 && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <div className="xl:col-span-3 space-y-3">
            {step === 4 && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={() => setStep(3)} className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white">
                  ← Back to Employee Table
                </Button>
                <Button onClick={generateFinal} disabled={generating} className="bg-blue-600 hover:bg-blue-500 text-white">
                  <FileCheck2 className="h-4 w-4 mr-2" /> {generating ? 'Generating…' : 'Confirm & Generate'}
                </Button>
              </div>
            )}
            {step === 5 && finalNoc && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  <h3 className="text-base font-bold text-white">NOC Generated</h3>
                </div>
                <p className="text-sm text-emerald-200">
                  {finalNoc.nocNumber} — {finalNoc.clientName}{finalNoc.projectName ? ` · ${finalNoc.projectName}` : ''} · {finalNoc.employeeCount} employees
                </p>
                <p className="text-xs text-emerald-300/80 mt-1">Automatically stored in Documents → NOC → {finalNoc.clientName} → {monthLabel(finalNoc.monthKey)}.</p>
                <div className="flex flex-wrap items-center gap-2 mt-4">
                  <Button size="sm" variant="outline" className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white" onClick={() => printPdf(`/api/documents/noc/${finalNoc.id}/pdf?mode=inline&_=${Date.now()}`)}>
                    <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
                  </Button>
                  <Button size="sm" variant="outline" className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white" onClick={() => {
                    const a = document.createElement('a');
                    a.href = `/api/documents/noc/${finalNoc.id}/pdf?mode=download`;
                    a.download = finalNoc.fileName;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  }}>
                    <Download className="h-3.5 w-3.5 mr-1.5" /> Download PDF
                  </Button>
                  <Button size="sm" variant="outline" className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white" onClick={() => { setFinalNoc(null); setPreviewUrl(null); setStep(1); setDraftId(null); setDraftNumber(''); setDraftVersion(1); setRows([]); setClientName(''); setProjectName(''); setAddress1(''); setAddress2(''); setCity(''); setCountry(''); setDirty(false); }}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> New NOC
                  </Button>
                  <Button size="sm" variant="ghost" className="text-slate-400 hover:bg-slate-700 hover:text-white" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>
          <div className="xl:col-span-2">
            <div className="xl:sticky xl:top-6 rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/50">
                <FileText className="h-4 w-4 text-red-400" />
                <span className="text-sm font-semibold text-white truncate">NOC Preview (A4)</span>
              </div>
              {previewUrl ? (
                <iframe src={previewUrl} title="NOC PDF" className="w-full h-[520px] bg-white" />
              ) : (
                <div className="flex h-[420px] flex-col items-center justify-center gap-3 text-center px-6">
                  <FileText className="h-10 w-10 text-slate-600" />
                  <p className="text-sm text-slate-400">Use <span className="text-slate-200 font-medium">Preview NOC</span> — the same engine that generates the final PDF.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* remove-row confirm */}
      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Remove this employee from the NOC?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {removeTarget?.name || 'This row'} will be removed from the current NOC only — the employee database is not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-slate-300 border-slate-700 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeTarget && removeRow(removeTarget.uid)} className="bg-red-500 hover:bg-red-600 text-white border-0">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NocList — searchable/filterable flat list (PRD §6.1)
// ---------------------------------------------------------------------------

function NocList({
  nocs,
  loading,
  canDelete,
  onCreate,
  onEdit,
  onPreviewUrl,
  onChanged,
}: {
  nocs: NocRecord[];
  loading: boolean;
  canDelete: boolean;
  onCreate: () => void;
  onEdit: (noc: NocRecord) => void;
  onPreviewUrl: (url: string | null, title: string) => void;
  onChanged: () => void;
}) {
  const { user } = useAuthStore();
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [yearFilter, setYearFilter] = React.useState('all');
  const [deleteTarget, setDeleteTarget] = React.useState<NocRecord | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const years = React.useMemo(() => {
    const ys = new Set<string>();
    for (const n of nocs) if (n.monthKey) ys.add(n.monthKey.split('-')[0]);
    return [...ys].sort().reverse();
  }, [nocs]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return nocs.filter((n) => {
      if (statusFilter !== 'all' && n.status !== statusFilter) return false;
      if (yearFilter !== 'all' && !(n.monthKey || '').startsWith(yearFilter)) return false;
      if (!q) return true;
      const haystack = [
        n.nocNumber, n.clientName, n.projectName, n.nocDate, n.createdBy || '',
        ...n.employees.flatMap((e) => [e.name, e.passport]),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [nocs, search, statusFilter, yearFilter]);

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      const res = await fetch(`/api/documents/noc/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
      toast({ title: deleteTarget.status === 'draft' ? 'Draft deleted' : 'NOC deleted', description: deleteTarget.nocNumber });
      setDeleteTarget(null);
      onChanged();
    } catch (e) {
      toast({ title: 'Failed to delete', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = async (noc: NocRecord) => {
    setBusyId(noc.id);
    try {
      if (noc.status === 'draft') {
        onEdit(noc);
      } else {
        // Final NOCs are never overwritten — create version N+1 as a draft
        const res = await fetch(`/api/documents/noc/${noc.id}/version?actorDisplayName=${encodeURIComponent(user?.name || user?.email || 'Admin')}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create version');
        onEdit({ ...noc, ...data.data.noc, employees: noc.employees });
      }
    } catch (e) {
      toast({ title: 'Edit failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (noc: NocRecord) => {
    setBusyId(noc.id);
    try {
      const res = await fetch(`/api/documents/noc/${noc.id}/duplicate?actorDisplayName=${encodeURIComponent(user?.name || user?.email || 'Admin')}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Duplicate failed');
      toast({ title: 'Duplicated as draft', description: `${data.data.noc.nocNumber} — dated today, ready to edit.` });
      onEdit({ ...noc, ...data.data.noc, employees: noc.employees });
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
        <Badge variant="secondary" className="bg-slate-700 text-slate-300">{filtered.length}</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search NOC / client / project / employee / passport…" className={cn('h-8 w-64 pl-8 text-xs', inputCls)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className={cn('h-8 w-28 text-xs', inputCls)}><SelectValue /></SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="final">Final</SelectItem>
              <SelectItem value="draft">Drafts</SelectItem>
            </SelectContent>
          </Select>
          <Select value={yearFilter} onValueChange={setYearFilter}>
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
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">
          {nocs.length === 0 ? 'No NOCs yet — create the first one.' : 'No NOCs match the current filters.'}
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
              {filtered.map((noc) => (
                <tr key={noc.id} className={cn('border-t border-slate-700/40 hover:bg-slate-700/20 transition-colors', noc.status === 'draft' && 'bg-amber-500/5')}>
                  <td className="px-4 py-2">
                    <span className="text-[13px] font-medium text-slate-200">{noc.nocNumber}</span>
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
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      {noc.status === 'final' && (
                        <>
                          <button type="button" title="View" onClick={() => onPreviewUrl(`/api/documents/noc/${noc.id}/pdf?mode=inline&_=${Date.now()}`, `${noc.nocNumber} — ${noc.clientName}`)} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Eye className="h-3.5 w-3.5" /></button>
                          <button type="button" title="Print" onClick={() => printPdf(`/api/documents/noc/${noc.id}/pdf?mode=inline&_=${Date.now()}`)} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Printer className="h-3.5 w-3.5" /></button>
                          <button type="button" title="Download PDF" onClick={() => { const a = document.createElement('a'); a.href = `/api/documents/noc/${noc.id}/pdf?mode=download`; a.download = noc.fileName || `${noc.nocNumber}.pdf`; document.body.appendChild(a); a.click(); a.remove(); }} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Download className="h-3.5 w-3.5" /></button>
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
// NocFolderView — client folder → year → month grouping (PRD §26/§27)
// ---------------------------------------------------------------------------

function NocFolderView({
  nocs,
  loading,
  canDelete,
  onPreviewUrl,
  onChanged,
}: {
  nocs: NocRecord[];
  loading: boolean;
  canDelete: boolean;
  onPreviewUrl: (url: string | null, title: string) => void;
  onChanged: () => void;
}) {
  const { user } = useAuthStore();
  const [openClients, setOpenClients] = React.useState<Record<string, boolean>>({});
  const [openYears, setOpenYears] = React.useState<Record<string, boolean>>({});
  const [openMonths, setOpenMonths] = React.useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = React.useState<NocRecord | null>(null);

  // finals only in the folder archive (drafts live in the list)
  const finals = React.useMemo(() => nocs.filter((n) => n.status === 'final'), [nocs]);

  const grouped = React.useMemo(() => {
    const clients = new Map<string, Map<string, Map<string, NocRecord[]>>>();
    for (const noc of finals) {
      const year = (noc.monthKey || '----').split('-')[0];
      const month = noc.monthKey || '----';
      if (!clients.has(noc.clientName)) clients.set(noc.clientName, new Map());
      const years = clients.get(noc.clientName)!;
      if (!years.has(year)) years.set(year, new Map());
      const months = years.get(year)!;
      if (!months.has(month)) months.set(month, []);
      months.get(month)!.push(noc);
    }
    return [...clients.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([client, years]) => [
        client,
        [...years.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, months]) => [
          year,
          [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])),
        ] as const),
      ] as const);
  }, [finals]);

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/documents/noc/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
      toast({ title: 'NOC deleted', description: deleteTarget.nocNumber });
      setDeleteTarget(null);
      onChanged();
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
      ) : grouped.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">No finalized NOCs yet. Generated NOCs are archived here automatically.</div>
      ) : (
        <div className="divide-y divide-slate-700/40">
          {grouped.map(([clientName, years]) => {
            const clientOpen = openClients[clientName] ?? true;
            const total = years.reduce((n, [, months]) => n + months.reduce((m, [, arr]) => m + arr.length, 0), 0);
            return (
              <div key={clientName}>
                <button type="button" className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-700/30 transition-colors text-left" onClick={() => setOpenClients((p) => ({ ...p, [clientName]: !clientOpen }))}>
                  {clientOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  <Folder className="h-4 w-4 text-amber-400" />
                  <span className="text-sm font-semibold text-white">{clientName}</span>
                  <Badge variant="secondary" className="bg-slate-700 text-slate-300 text-[10px]">{total} NOC{total !== 1 ? 's' : ''}</Badge>
                </button>

                {clientOpen && (
                  <div className="bg-slate-900/30">
                    {years.map(([year, months]) => {
                      const yKey = `${clientName}::${year}`;
                      const yearOpen = openYears[yKey] ?? true;
                      return (
                        <div key={yKey} className="border-t border-slate-700/30">
                          <button type="button" className="w-full flex items-center gap-2 pl-10 pr-4 py-2.5 hover:bg-slate-700/20 transition-colors text-left" onClick={() => setOpenYears((p) => ({ ...p, [yKey]: !yearOpen }))}>
                            {yearOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                            <CalendarDays className="h-3.5 w-3.5 text-blue-400" />
                            <span className="text-xs font-semibold text-slate-200 uppercase tracking-wide">{year}</span>
                          </button>
                          {yearOpen && months.map(([monthKey, records]) => {
                            const mKey = `${yKey}::${monthKey}`;
                            const monthOpen = openMonths[mKey] ?? true;
                            return (
                              <div key={mKey} className="border-t border-slate-700/20">
                                <button type="button" className="w-full flex items-center gap-2 pl-16 pr-4 py-2 hover:bg-slate-700/20 transition-colors text-left" onClick={() => setOpenMonths((p) => ({ ...p, [mKey]: !monthOpen }))}>
                                  {monthOpen ? <ChevronDown className="h-3 w-3 text-slate-500" /> : <ChevronRight className="h-3 w-3 text-slate-500" />}
                                  <span className="text-xs font-medium text-slate-300">{monthLabel(monthKey)}</span>
                                  <Badge variant="secondary" className="bg-slate-700/70 text-slate-300 text-[10px]">{records.length}</Badge>
                                </button>
                                {monthOpen && (
                                  <StaggerContainer className="pb-2" stagger={0.03}>
                                    {records.map((noc) => (
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
                                            <button type="button" title="View" onClick={() => onPreviewUrl(`/api/documents/noc/${noc.id}/pdf?mode=inline&_=${Date.now()}`, noc.nocNumber)} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Eye className="h-3.5 w-3.5" /></button>
                                            <button type="button" title="Print" onClick={() => printPdf(`/api/documents/noc/${noc.id}/pdf?mode=inline&_=${Date.now()}`)} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Printer className="h-3.5 w-3.5" /></button>
                                            <button type="button" title="Download PDF" onClick={() => { const a = document.createElement('a'); a.href = `/api/documents/noc/${noc.id}/pdf?mode=download`; a.download = noc.fileName || `${noc.nocNumber}.pdf`; document.body.appendChild(a); a.click(); a.remove(); }} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60"><Download className="h-3.5 w-3.5" /></button>
                                            {canDelete && <button type="button" title="Delete" onClick={() => setDeleteTarget(noc)} className="rounded p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /></button>}
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

// ---------------------------------------------------------------------------
// DocumentsDashboard — summary cards, quick actions, recent NOCs (PRD §5)
// ---------------------------------------------------------------------------

function DocumentsDashboard({
  nocs,
  loading,
  employeesWithDocuments,
  onCreate,
  onEmployeeDocs,
  onPreviewUrl,
}: {
  nocs: NocRecord[];
  loading: boolean;
  employeesWithDocuments: number | null;
  onCreate: () => void;
  onEmployeeDocs: () => void;
  onPreviewUrl: (url: string | null, title: string) => void;
}) {
  const nowKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const finals = nocs.filter((n) => n.status === 'final');
  const thisMonth = finals.filter((n) => n.monthKey === nowKey).length;
  const drafts = nocs.filter((n) => n.status === 'draft').length;
  const recent = [...finals].slice(0, 6);

  const cards = [
    { label: 'Total NOCs', value: loading ? '…' : finals.length, icon: FileCheck2, accent: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
    { label: 'This Month', value: loading ? '…' : thisMonth, icon: CalendarDays, accent: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
    { label: 'Draft NOCs', value: loading ? '…' : drafts, icon: Pencil, accent: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
    { label: 'Employees With Documents', value: employeesWithDocuments === null ? '…' : employeesWithDocuments, icon: FolderOpen, accent: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/30' },
  ];

  return (
    <div className="space-y-5">
      <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-3" stagger={0.06}>
        {cards.map((c) => (
          <StaggerItem key={c.label}>
            <div className={cn('rounded-xl border p-4', c.bg)}>
              <div className="flex items-center justify-between">
                <c.icon className={cn('h-5 w-5', c.accent)} />
              </div>
              <div className="mt-2 text-2xl font-bold text-white">{c.value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{c.label}</div>
            </div>
          </StaggerItem>
        ))}
      </StaggerContainer>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onCreate} className="bg-blue-600 hover:bg-blue-500 text-white">
          <Plus className="h-4 w-4 mr-2" /> Create NOC
        </Button>
        <Button variant="outline" onClick={onEmployeeDocs} className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white">
          <Upload className="h-4 w-4 mr-2" /> Upload Employee Document
        </Button>
      </div>

      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/50">
          <FileText className="h-4 w-4 text-red-400" />
          <h3 className="text-sm font-semibold text-white">Recent Documents</h3>
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-slate-400">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">No finalized NOCs yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-semibold">Document</th>
                  <th className="px-3 py-2 font-semibold">Client</th>
                  <th className="px-3 py-2 font-semibold">Project</th>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold text-center">Employees</th>
                  <th className="px-3 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((noc) => (
                  <tr key={noc.id} className="border-t border-slate-700/40 hover:bg-slate-700/20">
                    <td className="px-4 py-2 text-[13px] font-medium text-slate-200">{noc.nocNumber}</td>
                    <td className="px-3 py-2 text-[13px] text-slate-300">{noc.clientName}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{noc.projectName || '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">{noc.nocDate}</td>
                    <td className="px-3 py-2 text-xs text-slate-300 text-center">{noc.employeeCount}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-300 hover:bg-slate-700 hover:text-white" onClick={() => onPreviewUrl(`/api/documents/noc/${noc.id}/pdf?mode=inline&_=${Date.now()}`, noc.nocNumber)}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NocTemplateSettings — admin-controlled letter wording (PRD §20/§62)
// ---------------------------------------------------------------------------

function NocTemplateSettings({ template, onSaved }: { template: NocTemplateData | null; onSaved: () => void }) {
  const { user } = useAuthStore();
  const [bodyText, setBodyText] = React.useState(template?.bodyText || '');
  const [companyName, setCompanyName] = React.useState(template?.companyName || '');
  const [contactPerson, setContactPerson] = React.useState(template?.contactPerson || '');
  const [contactPhone, setContactPhone] = React.useState(template?.contactPhone || '');
  const [contactEmail, setContactEmail] = React.useState(template?.contactEmail || '');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setBodyText(template?.bodyText || '');
      setCompanyName(template?.companyName || '');
      setContactPerson(template?.contactPerson || '');
      setContactPhone(template?.contactPhone || '');
      setContactEmail(template?.contactEmail || '');
    }, 0);
    return () => clearTimeout(t);
  }, [template]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/documents/noc-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bodyText, companyName, contactPerson, contactPhone, contactEmail, actorDisplayName: user?.name || user?.email }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      toast({ title: 'NOC template saved', description: 'New NOCs will use this wording and signatory block.' });
      onSaved();
    } catch (e) {
      toast({ title: 'Save failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 md:p-5">
        <div className="flex items-center gap-2 mb-1">
          <Settings2 className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">NOC Letter Template</h3>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Controlled legal wording — only Super Admin can change it. Use <code className="text-blue-300 bg-slate-900 px-1 rounded">{'{{company}}'}</code> where the bold contractor name should appear.
          Already-issued NOCs keep their original wording; new generations use this template.
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-slate-400">Body Text</span>
            <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={5} className={cn('resize-y', inputCls)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-400">Company Name (bold in body & signature)</span>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={cn('uppercase', inputCls)} />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-400">Contact Person (signatory)</span>
              <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-400">Phone</span>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-400">Email</span>
              <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputCls} />
            </div>
          </div>
          <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-500 text-white">
            <Save className="h-4 w-4 mr-2" /> {saving ? 'Saving…' : 'Save Template'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocumentsPage — tabs + permission gating
// ---------------------------------------------------------------------------

type TabId = 'dashboard' | 'noc' | 'employee' | 'template';

export function DocumentsPage() {
  const perms = useDocumentPermissions();
  const [tab, setTab] = React.useState<TabId>('dashboard');
  const [nocMode, setNocMode] = React.useState<'list' | 'create'>('list');
  const [editNoc, setEditNoc] = React.useState<NocRecord | null>(null);
  const [nocs, setNocs] = React.useState<NocRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [employeesWithDocuments, setEmployeesWithDocuments] = React.useState<number | null>(null);
  const [template, setTemplate] = React.useState<NocTemplateData | null>(null);
  const [viewerUrl, setViewerUrl] = React.useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = React.useState('');
  const [viewerBlob, setViewerBlob] = React.useState(false);
  const { user } = useAuthStore();

  const loadNocs = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/documents/noc');
      const data = await res.json();
      if (data.success) setNocs(data.data.nocs || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStats = React.useCallback(async () => {
    try {
      const res = await fetch('/api/documents/employee?stats=1');
      const data = await res.json();
      if (data.success) setEmployeesWithDocuments(data.data.employeesWithDocuments);
    } catch {
      // silent
    }
  }, []);

  const loadTemplate = React.useCallback(async () => {
    try {
      const res = await fetch('/api/documents/noc-template');
      const data = await res.json();
      if (data.success) setTemplate(data.data.template);
    } catch {
      // silent
    }
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => { loadNocs(); loadStats(); loadTemplate(); }, 0);
    return () => clearTimeout(t);
  }, [loadNocs, loadStats, loadTemplate]);

  const handlePreviewUrl = (url: string | null, title: string) => {
    if (viewerUrl && viewerBlob) URL.revokeObjectURL(viewerUrl);
    setViewerBlob(!!url && url.startsWith('blob:'));
    setViewerUrl(url);
    setViewerTitle(title);
  };

  const refreshAll = () => { loadNocs(); loadStats(); };

  const openCreate = () => { setEditNoc(null); setNocMode('create'); setTab('noc'); };

  const tabs: Array<{ id: TabId; label: string; icon: React.ElementType; locked?: boolean }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'noc', label: 'NOC', icon: FileCheck2, locked: !perms.canNoc },
    { id: 'employee', label: 'Employee Documents', icon: FolderOpen, locked: !perms.canEmployeeDocs },
    ...(user?.role === 'super_admin' ? [{ id: 'template' as TabId, label: 'NOC Template', icon: Settings2 }] : []),
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-bold text-white">Documents</h1>
          <p className="text-sm text-slate-400 mt-0.5">Manage NOCs, employee documents and company records.</p>
        </div>
      </FadeIn>

      <div className="flex flex-wrap gap-2">
        {tabs.map(({ id, label, icon: Icon, locked }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors border',
              tab === id ? 'bg-blue-500/15 border-blue-500/40 text-blue-300' : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200 hover:bg-slate-700/40',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {locked && <Lock className="h-3 w-3 text-slate-500" />}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && (
        <FadeIn>
          <DocumentsDashboard
            nocs={nocs}
            loading={loading}
            employeesWithDocuments={employeesWithDocuments}
            onCreate={openCreate}
            onEmployeeDocs={() => setTab('employee')}
            onPreviewUrl={handlePreviewUrl}
          />
        </FadeIn>
      )}

      {tab === 'noc' && (
        perms.canNoc ? (
          nocMode === 'create' ? (
            <NocWorkspace
              editNoc={editNoc}
              template={template}
              onClose={() => { setNocMode('list'); setEditNoc(null); refreshAll(); }}
              onSaved={refreshAll}
            />
          ) : (
            <div className="space-y-5">
              <NocList
                nocs={nocs}
                loading={loading}
                canDelete={perms.canDelete}
                onCreate={openCreate}
                onEdit={(noc) => { setEditNoc(noc); setNocMode('create'); }}
                onPreviewUrl={handlePreviewUrl}
                onChanged={refreshAll}
              />
              <NocFolderView nocs={nocs} loading={loading} canDelete={perms.canDelete} onPreviewUrl={handlePreviewUrl} onChanged={refreshAll} />
            </div>
          )
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-10 text-center">
            <Lock className="h-8 w-8 text-slate-500 mx-auto mb-3" />
            <p className="text-sm text-slate-400">You do not have permission to access NOCs. Ask a Super Admin to grant <span className="text-slate-200">Documents — NOC</span> in Admin Management.</p>
          </div>
        )
      )}

      {tab === 'employee' && (
        perms.canEmployeeDocs ? (
          <FadeIn>
            <EmployeeDocumentsPanel refreshKey={nocs.length} canDelete={perms.canDelete} />
          </FadeIn>
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-10 text-center">
            <Lock className="h-8 w-8 text-slate-500 mx-auto mb-3" />
            <p className="text-sm text-slate-400">You do not have permission to access employee documents. Ask a Super Admin to grant <span className="text-slate-200">Documents — Employee Documents</span> in Admin Management.</p>
          </div>
        )
      )}

      {tab === 'template' && user?.role === 'super_admin' && (
        <FadeIn>
          <NocTemplateSettings template={template} onSaved={loadTemplate} />
        </FadeIn>
      )}

      {/* global PDF viewer dialog for quick views from lists */}
      {viewerUrl && tab !== 'noc' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => handlePreviewUrl(null, '')}>
          <div className="w-full max-w-4xl max-h-[90vh] rounded-xl border border-slate-700 bg-slate-800 overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700">
              <FileText className="h-4 w-4 text-red-400" />
              <span className="text-sm font-semibold text-white truncate">{viewerTitle}</span>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-200 hover:bg-slate-700" onClick={() => printPdf(viewerUrl)}>
                  <Printer className="h-3.5 w-3.5 mr-1" /> Print
                </Button>
                <Button size="sm" variant="ghost" className="text-slate-400 hover:bg-slate-700 hover:text-white" onClick={() => handlePreviewUrl(null, '')}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <iframe src={viewerUrl} title="NOC PDF" className="w-full flex-1 min-h-[70vh] bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}
