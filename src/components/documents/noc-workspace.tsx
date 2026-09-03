'use client';

/**
 * NocWorkspace — create / edit (draft) workspace with the 5-step flow:
 * ① Details (company, stamp toggle, recipient) ② Employees ③ Review
 * ④ Preview ⑤ Complete. Drafts auto-save. Stamps are opt-in per NOC
 * (toggle + which stamp), and the issuing company is picked from the
 * company list (multiple company names supported).
 */
import React from 'react';
import {
  FileText,
  Download,
  Printer,
  Plus,
  Search,
  Eye,
  X,
  Copy,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileCheck2,
  Building2,
  User,
  CheckCircle2,
  AlertTriangle,
  Save,
  RotateCcw,
  Pencil,
  Stamp as StampIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
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
import {
  downloadNocPdf,
  inputCls,
  monthLabel,
  nextUid,
  printPdf,
  todayDMY,
  type CompanyOption,
  type NocEmployeeRow,
  type NocLightRow,
  type NocTemplateData,
  type StampOption,
} from '@/components/documents/shared';

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

const LOCAL_BACKUP_KEY = 'noc-draft-local-backup';

/** Shape of the offline localStorage backup (spec §29 — local resilience). */
interface LocalBackup {
  draftId: string | null;
  clientName: string;
  projectName: string;
  address1: string;
  address2: string;
  city: string;
  country: string;
  nocDate: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  companyId: string | null;
  stampEnabled: boolean;
  stampId: string | null;
  currentStep: number;
  employees: Array<{ name: string; trade: string; company: string; nationality: string; passport: string }>;
  savedAt: string;
}

function readLocalBackup(): LocalBackup | null {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalBackup;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** NocRecord used when editing — either a full draft detail or a list row + employees. */
export interface NocEditSource extends Partial<NocLightRow> {
  currentStep?: number; // exact resume point — the workspace step the draft was left at
  employees?: Array<{ name: string; trade: string; company: string; nationality: string; passport: string }>;
}

export function NocWorkspace({
  editNoc,
  companies,
  stamps,
  onClose,
  onSaved,
  onOpenNoc,
}: {
  editNoc: NocEditSource | null; // DRAFT being edited (finals are versioned first)
  companies: CompanyOption[];
  stamps: StampOption[];
  onClose: () => void;
  onSaved: () => void;
  onOpenNoc: (nocId: string) => void;
}) {
  const { user } = useAuthStore();
  const defaultCompany = React.useMemo(() => companies[0] || null, [companies]);
  const defaultStamp = React.useMemo(() => stamps.find((s) => s.isDefault) || stamps[0] || null, [stamps]);

  const [companyId, setCompanyId] = React.useState<string>(editNoc?.companyId || defaultCompany?.id || '');
  const [clientName, setClientName] = React.useState(editNoc?.clientName || '');
  const [address1, setAddress1] = React.useState(((editNoc as { clientAddress?: string })?.clientAddress || '').split('\n')[0] || '');
  const [address2, setAddress2] = React.useState(((editNoc as { clientAddress?: string })?.clientAddress || '').split('\n')[1] || '');
  const [city, setCity] = React.useState(((editNoc as { clientAddress?: string })?.clientAddress || '').split('\n')[2] || '');
  const [country, setCountry] = React.useState(((editNoc as { clientAddress?: string })?.clientAddress || '').split('\n')[3] || '');
  const [projectName, setProjectName] = React.useState(editNoc?.projectName || '');
  const [nocDate, setNocDate] = React.useState(editNoc?.nocDate || todayDMY());
  const [contactPerson, setContactPerson] = React.useState('');
  const [contactPhone, setContactPhone] = React.useState('');
  const [contactEmail, setContactEmail] = React.useState('');
  const [stampEnabled, setStampEnabled] = React.useState<boolean>(editNoc ? !!editNoc.stampEnabled : false); // stamps are opt-in
  const [stampId, setStampId] = React.useState<string>(editNoc?.stampId || defaultStamp?.id || '');

  // seed the manager block from the chosen company when creating fresh
  React.useEffect(() => {
    if (editNoc) return;
    const t = setTimeout(() => {
      const c = companies.find((x) => x.id === companyId) || defaultCompany;
      setContactPerson(c?.contactPerson || 'Ms. Mafeeda Kader');
      setContactPhone(c?.contactPhone || '050 797 4153');
      setContactEmail(c?.contactEmail || 'mafeedaarabianshieldmanpower@gmail.com');
    }, 0);
    return () => clearTimeout(t);
  }, [companyId, editNoc]);

  const [rows, setRows] = React.useState<NocEmployeeRow[]>(
    (editNoc?.employees || []).map((e) => ({
      uid: nextUid(), source: 'database' as const,
      name: e.name || '', trade: e.trade || '', company: e.company || '', nationality: e.nationality || '', passport: e.passport || '',
    })),
  );
  const [sort, setSort] = React.useState<SortState | null>(null);

  const [search, setSearch] = React.useState('');
  const [options, setOptions] = React.useState<Array<{ id: string; fullName: string; employeeId: string; trade: string | null; companyName: string | null; nationality: string | null; passportNumber: string | null }>>([]);
  const [pickedIds, setPickedIds] = React.useState<Set<string>>(new Set());
  const [replaceTargetUid, setReplaceTargetUid] = React.useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<NocEmployeeRow | null>(null);

  // exact resume point (§28) — reopen at the step the draft was left at
  const resumeStep = Math.min(Math.max(editNoc?.currentStep ?? 1, 1), 3);
  const [step, setStep] = React.useState(resumeStep);
  const [draftId, setDraftId] = React.useState<string | null>(editNoc?.id || null);
  const [draftNumber, setDraftNumber] = React.useState<string>(editNoc?.nocNumber || '');
  const [draftVersion, setDraftVersion] = React.useState<number>(editNoc?.version || 1);
  const [draftSavedAt, setDraftSavedAt] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [savingDraft, setSavingDraft] = React.useState(false);
  // offline resilience (spec §29-30)
  const [online, setOnline] = React.useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [syncingBack, setSyncingBack] = React.useState(false);
  const [localSavedAt, setLocalSavedAt] = React.useState<string | null>(null); // time of the latest unsynced local copy
  const [pendingRestore, setPendingRestore] = React.useState<LocalBackup | null>(null); // unsynced copy found on open
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [finalNoc, setFinalNoc] = React.useState<{ id: string; nocNumber: string; clientName: string; projectName: string; employeeCount: number; monthKey: string; fileName: string } | null>(null);
  const [generating, setGenerating] = React.useState(false);

  const clientAddress = [address1, address2, city, country].map((l) => l.trim()).filter(Boolean).join('\n');

  // refs mirror the latest step/dirty so callbacks and event listeners never act on stale values
  const stepRef = React.useRef(step);
  React.useEffect(() => { stepRef.current = step; }, [step]);
  const dirtyRef = React.useRef(dirty);
  React.useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const buildPayload = (status: 'draft' | 'final') => ({
    clientName,
    projectName,
    clientAddress,
    nocDate,
    contactPerson,
    contactPhone,
    contactEmail,
    companyId: companyId || null,
    stampEnabled,
    stampId: stampEnabled ? stampId || null : null,
    status,
    employees: rows.map(({ name, trade, company, nationality, passport }) => ({ name, trade, company, nationality, passport })),
    currentStep: Math.min(stepRef.current, 3), // exact resume point (§28)
    actorUserId: user?.id,
    actorDisplayName: user?.name || user?.email,
  });

  const hasContent = clientName.trim() || projectName.trim() || rows.length > 0;
  const hasContentRef = React.useRef(hasContent);
  React.useEffect(() => { hasContentRef.current = hasContent; }, [hasContent]);

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
        // server has everything now — the local resilience copy is no longer needed
        try { localStorage.removeItem(LOCAL_BACKUP_KEY); } catch { /* ignore */ }
        setLocalSavedAt(null);
        setPendingRestore(null);
        if (!silent) toast({ title: 'Draft saved', description: `${data.data.noc.nocNumber} — continue anytime from Drafts.` });
        onSaved();
      } catch (e) {
        if (!silent) toast({ title: 'Draft save failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
      } finally {
        setSavingDraft(false);
      }
    },
    [draftId, clientName, projectName, clientAddress, nocDate, contactPerson, contactPhone, contactEmail, companyId, stampEnabled, stampId, rows, hasContent],
  );

  // auto-save (debounced server save) whenever the workspace is dirty.
  // Every change is ALSO mirrored to localStorage immediately (§29: local
  // draft first, API auto-save second) — a crash or drop of connectivity
  // never loses more than the current field.
  React.useEffect(() => {
    if (!dirty) return;
    if (hasContent) {
      try {
        const backup: LocalBackup = {
          draftId,
          clientName,
          projectName,
          address1, address2, city, country,
          nocDate,
          contactPerson, contactPhone, contactEmail,
          companyId: companyId || null,
          stampEnabled,
          stampId: stampId || null,
          currentStep: Math.min(stepRef.current, 3),
          employees: rows.map(({ name, trade, company, nationality, passport }) => ({ name, trade, company, nationality, passport })),
          savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        };
        localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(backup));
        setLocalSavedAt(backup.savedAt);
      } catch { /* storage full/blocked — server autosave still applies */ }
    }
    const t = setTimeout(() => { saveDraft(true); }, 1500);
    return () => clearTimeout(t);
  }, [dirty, rows, clientName, projectName, clientAddress, nocDate, companyId, stampEnabled, stampId, saveDraft]);

  // online/offline indicator + automatic re-sync when the connection returns (§30)
  React.useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // when back online (a real offline→online transition): flush the unsynced local copy (§30)
  const onlinePrev = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (!online) {
      onlinePrev.current = false;
      return;
    }
    const wasOffline = onlinePrev.current === false;
    onlinePrev.current = true;
    if (!wasOffline) return; // initial mount — nothing to re-sync yet
    const hasLocal = !!readLocalBackup();
    if (!dirtyRef.current && !hasLocal) return;
    let cancelled = false;
    (async () => {
      setSyncingBack(true);
      try {
        await saveDraft(true);
        if (!cancelled) toast({ title: 'Draft synchronized', description: 'The changes saved on this device were pushed to the server.' });
      } finally {
        if (!cancelled) setSyncingBack(false);
      }
    })();
    return () => { cancelled = true; };
  }, [online]);

  // on open: detect an unsynced local copy from a previous session (crash / offline close)
  React.useEffect(() => {
    const t = setTimeout(() => {
      const backup = readLocalBackup();
      if (!backup) return;
      const sameDraft = (backup.draftId || null) === (editNoc?.id || null);
      if (sameDraft && (backup.clientName || (backup.employees || []).length > 0)) {
        setPendingRestore(backup);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const restoreLocalBackup = () => {
    if (!pendingRestore) return;
    const b = pendingRestore;
    setCompanyId(b.companyId || defaultCompany?.id || '');
    setClientName(b.clientName || '');
    setAddress1(b.address1 || '');
    setAddress2(b.address2 || '');
    setCity(b.city || '');
    setCountry(b.country || '');
    setProjectName(b.projectName || '');
    setNocDate(b.nocDate || todayDMY());
    setContactPerson(b.contactPerson || '');
    setContactPhone(b.contactPhone || '');
    setContactEmail(b.contactEmail || '');
    setStampEnabled(!!b.stampEnabled);
    setStampId(b.stampId || defaultStamp?.id || '');
    setRows((b.employees || []).map((e) => ({
      uid: nextUid(), source: 'manual' as const,
      name: e.name || '', trade: e.trade || '', company: e.company || '', nationality: e.nationality || '', passport: e.passport || '',
    })));
    const target = Math.min(Math.max(b.currentStep || 1, 1), 3);
    setStep(target);
    stepRef.current = target;
    setPendingRestore(null);
    setDirty(true);
    toast({ title: 'Draft restored', description: `Unsaved changes from ${b.savedAt} were restored. They will sync to the server automatically.` });
  };

  const discardLocalBackup = () => {
    try { localStorage.removeItem(LOCAL_BACKUP_KEY); } catch { /* ignore */ }
    setPendingRestore(null);
    setLocalSavedAt(null);
  };

  /** Step navigation — step transitions are significant actions and save immediately (§33). */
  const goToStep = (n: number) => {
    setStep(n);
    stepRef.current = n;
    if (hasContentRef.current) {
      if (draftId) saveDraft(true); // immediate server save on step change
      else setDirty(true); // first save happens via the debounced autosave
    }
  };

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

  // ── validation ──
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
          bodyText: undefined, // template wording comes from the server
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
      const n = data.data.noc;
      setFinalNoc({
        id: n.id,
        nocNumber: n.nocNumber,
        clientName: n.clientName,
        projectName: n.projectName,
        employeeCount: n.employeeCount,
        monthKey: n.monthKey,
        fileName: n.fileName,
      });
      setStep(5);
      toast({ title: 'NOC generated & stored', description: `${n.nocNumber} saved to the archive.` });
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
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
              {draftNumber ? `NOC ${draftNumber} · Version ${draftVersion} · ` : ''}
              {!online ? (
                <span className="text-amber-300 font-medium">⚠ Offline — changes saved locally on this device</span>
              ) : syncingBack ? (
                <span className="text-blue-300 font-medium">↻ Syncing draft…</span>
              ) : savingDraft ? (
                <span>Saving draft…</span>
              ) : dirty ? (
                <span>Unsaved changes — autosaving…</span>
              ) : draftSavedAt ? (
                <span className="text-emerald-300">✓ Draft saved {draftSavedAt}</span>
              ) : (
                <span>Drafts save automatically while you work</span>
              )}
              {localSavedAt && !online && <span className="text-amber-400/80">(local copy {localSavedAt})</span>}
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
                  onClick={() => i + 1 <= Math.max(step, 3) && goToStep(i + 1)}
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

      {/* unsynced local copy found on open (browser crash / offline close) — §29 */}
      {pendingRestore && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-200 flex-1 min-w-48">
            <span className="font-semibold">Unsynced changes found</span> — saved on this device at {pendingRestore.savedAt} before they could reach the server.
            Restore them to continue exactly where you left off.
          </p>
          <Button size="sm" onClick={restoreLocalBackup} className="bg-amber-500 hover:bg-amber-400 text-slate-900">Restore changes</Button>
          <Button size="sm" variant="ghost" onClick={discardLocalBackup} className="text-slate-400 hover:bg-slate-700 hover:text-white">Discard</Button>
        </div>
      )}

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
                <span className="text-xs font-medium text-slate-400">Issuing Company *</span>
                <Select value={companyId || undefined} onValueChange={(v) => { setCompanyId(v); markDirty(); }}>
                  <SelectTrigger className={inputCls}><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
                    {companies.length === 0 && <SelectItem value="_none" disabled>No companies configured</SelectItem>}
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-[10px] text-slate-500">Sets the letterhead, signature name and the manager footer block.</span>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Client / Company Name *</span>
                <Input value={clientName} onChange={(e) => { setClientName(e.target.value); markDirty(); }} placeholder="M/S PROSCAPE LLC" className={cn('uppercase', inputCls)} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Project Name *</span>
                <Input value={projectName} onChange={(e) => { setProjectName(e.target.value); markDirty(); }} placeholder="ARABIAN RANCHES" className={cn('uppercase', inputCls)} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">NOC Date *</span>
                <Input value={nocDate} onChange={(e) => { setNocDate(e.target.value); markDirty(); }} placeholder="DD-MM-YYYY" className={inputCls} inputMode="numeric" />
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
            </div>

            {/* stamp decision — opt-in per NOC */}
            <Separator className="my-4 bg-slate-700/40" />
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-3">
              <StampIcon className={cn('h-4 w-4', stampEnabled ? 'text-blue-400' : 'text-slate-500')} />
              <div className="min-w-44">
                <div className="text-xs font-semibold text-slate-200">Apply stamp</div>
                <div className="text-[10px] text-slate-500">Off by default — you can also add or change it after issue from the NOC page.</div>
              </div>
              <Switch
                checked={stampEnabled}
                onCheckedChange={(checked) => {
                  setStampEnabled(checked);
                  if (checked && !stampId && defaultStamp) setStampId(defaultStamp.id);
                  markDirty();
                }}
              />
              {stampEnabled && (
                <div className="flex items-center gap-2">
                  <Select value={stampId || undefined} onValueChange={(v) => { setStampId(v); markDirty(); }}>
                    <SelectTrigger className={cn('h-9 w-44', inputCls)}>
                      <SelectValue placeholder="Choose stamp" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
                      {stamps.length === 0 && <SelectItem value="_none" disabled>No stamps in library</SelectItem>}
                      {stamps.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}{s.isDefault ? ' (default)' : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Separator className="my-4 bg-slate-700/40" />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Contact Person (footer)</span>
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
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name / passport / employee ID…" className={inputCls} />
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
                <Button variant="outline" onClick={() => goToStep(3)} className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white">
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
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => onOpenNoc(finalNoc.id)}>
                    <Eye className="h-3.5 w-3.5 mr-1.5" /> Open NOC Page
                  </Button>
                  <Button size="sm" variant="outline" className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white" onClick={() => printPdf(`/api/documents/noc/${finalNoc.id}/pdf?mode=inline&_=${Date.now()}`)}>
                    <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
                  </Button>
                  <Button size="sm" variant="outline" className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white" onClick={() => downloadNocPdf(finalNoc)}>
                    <Download className="h-3.5 w-3.5 mr-1.5" /> Download PDF
                  </Button>
                  <Button size="sm" variant="outline" className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white" onClick={() => { setFinalNoc(null); setPreviewUrl(null); setStep(1); stepRef.current = 1; setDraftId(null); setDraftNumber(''); setDraftVersion(1); setRows([]); setClientName(''); setProjectName(''); setAddress1(''); setAddress2(''); setCity(''); setCountry(''); setDirty(false); }}>
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
