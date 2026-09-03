'use client';

/**
 * EmployeeDocumentsPanel — the employee document repository UI (passport,
 * ID card, visa, other), shared by the Documents page (with employee picker)
 * and the employee detail page (fixed employee, compact mode).
 * PRD §29–§36: categories, upload modal (type/name/expiry/notes/file),
 * preview, download, rename, replace, delete, availability status.
 */
import React from 'react';
import {
  FileText,
  Download,
  Trash2,
  Upload,
  Eye,
  Pencil,
  Replace,
  AlertTriangle,
  CheckCircle2,
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
import { DocumentPreviewModal, type PreviewDoc } from '@/components/documents/document-preview-modal';

export interface EmployeeDocRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  docType: string;
  docName: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  expiryDate?: string | null;
  notes?: string | null;
  createdAt: string;
}

export const DOC_TYPE_LABELS: Record<string, string> = {
  passport: 'Passport',
  id_card: 'ID Card',
  visa: 'Visa',
  other: 'Other Documents',
};

const DOC_GROUPS: Array<{ type: string; accent: string }> = [
  { type: 'passport', accent: 'text-blue-400' },
  { type: 'id_card', accent: 'text-emerald-400' },
  { type: 'visa', accent: 'text-violet-400' },
  { type: 'other', accent: 'text-amber-400' },
];

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const inputCls = 'bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-500 focus-visible:ring-blue-500/40';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function expiryInfo(expiry?: string | null): { label: string; tone: 'ok' | 'warn' | 'danger' } | null {
  if (!expiry) return null;
  const exp = new Date(`${expiry}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return null;
  const days = Math.ceil((exp.getTime() - Date.now()) / 86_400_000);
  const fmt = `${String(exp.getDate()).padStart(2, '0')}-${String(exp.getMonth() + 1).padStart(2, '0')}-${exp.getFullYear()}`;
  if (days < 0) return { label: `Expired ${fmt}`, tone: 'danger' };
  if (days <= 30) return { label: `Expires in ${days}d · ${fmt}`, tone: 'danger' };
  if (days <= 180) return { label: `Expires in ${Math.round(days / 30)}mo · ${fmt}`, tone: 'warn' };
  return { label: `Valid until ${fmt}`, tone: 'ok' };
}

export function EmployeeDocumentsPanel({
  employeeId,
  employeeName,
  compact = false,
  canDelete = true,
  refreshKey = 0,
}: {
  /** Fixed employee (detail page). Omit to enable the in-panel employee picker. */
  employeeId?: string;
  employeeName?: string;
  /** Compact mode for embedding inside the employee detail page. */
  compact?: boolean;
  canDelete?: boolean;
  refreshKey?: number;
}) {
  const { user } = useAuthStore();
  const [docs, setDocs] = React.useState<EmployeeDocRecord[]>([]);
  const [loading, setLoading] = React.useState(false);

  // picker mode state
  const [search, setSearch] = React.useState('');
  const [options, setOptions] = React.useState<Array<{ id: string; fullName: string; trade?: string | null; companyName?: string | null; passportNumber?: string | null; employeeId?: string }>>([]);
  const [selectedEmployee, setSelectedEmployee] = React.useState<{ id: string; fullName: string } | null>(
    employeeId ? { id: employeeId, fullName: employeeName || '' } : null,
  );

  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploadType, setUploadType] = React.useState('passport');
  const [uploadName, setUploadName] = React.useState('');
  const [uploadExpiry, setUploadExpiry] = React.useState('');
  const [uploadNotes, setUploadNotes] = React.useState('');
  const [uploadFile, setUploadFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);

  const [renameTarget, setRenameTarget] = React.useState<EmployeeDocRecord | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [renameExpiry, setRenameExpiry] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<EmployeeDocRecord | null>(null);
  const replaceInputRef = React.useRef<HTMLInputElement | null>(null);
  const [replaceTarget, setReplaceTarget] = React.useState<EmployeeDocRecord | null>(null);
  // §7 — in-app preview (PDF viewer / image with zoom)
  const [previewDoc, setPreviewDoc] = React.useState<PreviewDoc | null>(null);
  // §8 — "older documents" expanders per category
  const [expandedCats, setExpandedCats] = React.useState<Record<string, boolean>>({});

  const openPreview = (doc: EmployeeDocRecord) => {
    setPreviewDoc({
      url: `/api/documents/employee/${doc.id}/file?mode=inline&_=${Date.now()}`,
      downloadableUrl: `/api/documents/employee/${doc.id}/file?mode=download&_=${Date.now()}`,
      name: doc.docName || doc.fileName,
      mimeType: doc.mimeType,
    });
  };

  const effectiveEmployeeId = employeeId || selectedEmployee?.id;

  const loadDocs = React.useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/employee?employeeId=${id}`);
      const data = await res.json();
      if (data.success) setDocs(data.data.documents || []);
    } catch {
      toast({ title: 'Failed to load documents', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!effectiveEmployeeId) {
      const t = setTimeout(() => setDocs([]), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => loadDocs(effectiveEmployeeId), 0);
    return () => clearTimeout(t);
  }, [effectiveEmployeeId, loadDocs, refreshKey]);

  // debounced employee search (picker mode only)
  React.useEffect(() => {
    if (employeeId || !search.trim()) {
      const t = setTimeout(() => setOptions([]), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/employees?search=${encodeURIComponent(search.trim())}&status=active&limit=25`);
        const data = await res.json();
        if (data.success) setOptions(data.data.employees || []);
      } catch {
        // silent
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, employeeId]);

  const openUpload = (docType: string) => {
    setUploadType(docType);
    setUploadName('');
    setUploadExpiry('');
    setUploadNotes('');
    setUploadFile(null);
    setUploadOpen(true);
  };

  const submitUpload = async () => {
    if (!effectiveEmployeeId) return;
    if (!uploadFile) {
      toast({ title: 'Choose a file', description: 'Select the scanned PDF or image to upload.', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('employeeId', effectiveEmployeeId);
      form.append('docType', uploadType);
      if (uploadName.trim()) form.append('docName', uploadName.trim());
      if (uploadExpiry) form.append('expiryDate', uploadExpiry);
      if (uploadNotes.trim()) form.append('notes', uploadNotes.trim());
      form.append('actorDisplayName', user?.name || user?.email || '');
      form.append('actorUserId', user?.id || '');
      form.append('file', uploadFile);
      const res = await fetch('/api/documents/employee', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');
      toast({ title: 'Document uploaded', description: `${uploadFile.name} stored under ${DOC_TYPE_LABELS[uploadType]}.` });
      setUploadOpen(false);
      loadDocs(effectiveEmployeeId);
    } catch (e) {
      toast({ title: 'Upload failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const submitRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      const res = await fetch(`/api/documents/employee/${renameTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docName: renameValue.trim(), expiryDate: renameExpiry || null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Rename failed');
      toast({ title: 'Document updated' });
      setRenameTarget(null);
      if (effectiveEmployeeId) loadDocs(effectiveEmployeeId);
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
      if (effectiveEmployeeId) loadDocs(effectiveEmployeeId);
    } catch (e) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const handleReplaceFile = async (file: File) => {
    if (!replaceTarget) return;
    try {
      const form = new FormData();
      form.append('actorDisplayName', user?.name || user?.email || '');
      form.append('actorUserId', user?.id || '');
      form.append('file', file);
      const res = await fetch(`/api/documents/employee/${replaceTarget.id}/replace`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Replace failed');
      toast({ title: 'File replaced', description: `${replaceTarget.docName} now points to the new scan.` });
      setReplaceTarget(null);
      if (effectiveEmployeeId) loadDocs(effectiveEmployeeId);
    } catch (e) {
      toast({ title: 'Replace failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const renderDocActions = (doc: EmployeeDocRecord) => (
    <div className="flex items-center gap-0.5 shrink-0">
      <button type="button" title="Rename / edit expiry" onClick={() => { setRenameTarget(doc); setRenameValue(doc.docName); setRenameExpiry(doc.expiryDate || ''); }} className="rounded p-1.5 text-slate-400 hover:text-blue-300 hover:bg-slate-700/60 transition-colors">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button type="button" title="Replace file" onClick={() => { setReplaceTarget(doc); setTimeout(() => replaceInputRef.current?.click(), 50); }} className="rounded p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors">
        <Replace className="h-3.5 w-3.5" />
      </button>
      {canDelete && (
        <button type="button" title="Delete" onClick={() => setDeleteTarget(doc)} className="rounded p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className={compact ? 'space-y-4' : 'space-y-5'}>
      <input
        ref={replaceInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && replaceTarget) handleReplaceFile(f);
          e.target.value = '';
        }}
      />

      {/* employee picker (only when no fixed employee) */}
      {!employeeId && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 md:p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Select Employee</h3>
          {!selectedEmployee ? (
            <div className="relative">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee by name, trade or passport…" className={inputCls} />
              {options.length > 0 && (
                <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-2xl">
                  {options.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-slate-700/60 border-b border-slate-700/40 last:border-0"
                      onClick={() => { setSelectedEmployee({ id: emp.id, fullName: emp.fullName }); setSearch(''); setOptions([]); }}
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
                {selectedEmployee.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 text-sm font-semibold text-white">{selectedEmployee.fullName}</div>
              <Button variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-700 hover:text-white" onClick={() => setSelectedEmployee(null)}>
                Change
              </Button>
            </div>
          )}
        </div>
      )}

      {!effectiveEmployeeId ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-10 text-center text-sm text-slate-400">
          Select an employee to manage their passport, ID card, visa and other scanned documents.
        </div>
      ) : loading ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-10 text-center text-sm text-slate-400">Loading documents…</div>
      ) : (
        /* §8 — TWO documents per row, fixed order:
           Row 1: Passport | Emirates ID · Row 2: Visa | Medical / Other (§66) */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {DOC_GROUPS.map(({ type, accent }) => {
            const groupDocs = [...docs.filter((d) => d.docType === type)].sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            );
            const latest = groupDocs[0] || null;
            const older = groupDocs.slice(1);
            const expanded = !!expandedCats[type];
            const latestExp = latest ? expiryInfo(latest.expiryDate) : null;
            const isImage = latest ? IMAGE_MIMES.includes(latest.mimeType) : false;
            return (
              <div key={type} className={cn('rounded-xl border bg-slate-800/40 p-4', latest ? 'border-slate-700/50' : 'border-dashed border-slate-700/70')}>
                {/* card header — category + availability (§8/§9) */}
                <div className="flex items-center gap-2 mb-3">
                  <FileText className={cn('h-4 w-4', accent)} />
                  <h4 className="text-sm font-semibold text-white">{DOC_TYPE_LABELS[type]}</h4>
                  {latest ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-md px-1.5 py-0.5">
                      <CheckCircle2 className="h-3 w-3" /> Available
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md px-1.5 py-0.5">
                      <AlertTriangle className="h-3 w-3" /> Not Available
                    </span>
                  )}
                  {groupDocs.length > 0 && <Badge variant="secondary" className="bg-slate-700 text-slate-300 text-[10px] ml-auto">{groupDocs.length}</Badge>}
                </div>

                {latest ? (
                  <>
                    {/* latest document — the card's primary content */}
                    <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
                      <div className="flex items-start gap-2">
                        {isImage ? (
                          <div className="h-10 w-10 shrink-0 rounded-md overflow-hidden border border-slate-700 bg-slate-800">
                            <img src={`/api/documents/employee/${latest.id}/file?mode=inline&_=${Date.now()}`} alt={latest.docName} className="h-full w-full object-cover" />
                          </div>
                        ) : (
                          <FileText className="h-5 w-5 shrink-0 text-slate-400 mt-0.5" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[13px] font-medium text-slate-200 truncate">{latest.docName}</span>
                            {latestExp && (
                              <Badge variant="secondary" className={cn(
                                'text-[9px] px-1.5 py-0 h-4',
                                latestExp.tone === 'ok' && 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20',
                                latestExp.tone === 'warn' && 'bg-amber-500/15 text-amber-300 border border-amber-500/20',
                                latestExp.tone === 'danger' && 'bg-red-500/15 text-red-300 border border-red-500/20',
                              )}>
                                {latestExp.label}
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            {formatBytes(latest.fileSize)} · uploaded {new Date(latest.createdAt).toLocaleDateString()}
                            {latest.notes ? ` · ${latest.notes}` : ''}
                          </div>
                        </div>
                      </div>
                      {/* §8 — [Preview] [Download] always visible on the card */}
                      <div className="flex items-center gap-2 mt-3">
                        <Button size="sm" variant="outline" onClick={() => openPreview(latest)} className="h-7 flex-1 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white">
                          <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const a = document.createElement('a');
                            a.href = `/api/documents/employee/${latest.id}/file?mode=download&_=${Date.now()}`;
                            a.download = latest.fileName;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                          }}
                          className="h-7 flex-1 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white"
                        >
                          <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                        </Button>
                        {renderDocActions(latest)}
                      </div>
                    </div>

                    {/* older documents — collapsed by default */}
                    {older.length > 0 && (
                      <div className="mt-2">
                        <button
                          type="button"
                          className="text-[11px] text-blue-300 hover:text-blue-200 underline underline-offset-2"
                          onClick={() => setExpandedCats((p) => ({ ...p, [type]: !p[type] }))}
                        >
                          {expanded ? 'Hide' : `+${older.length} older document${older.length !== 1 ? 's' : ''}`}
                        </button>
                        {expanded && (
                          <div className="mt-2 space-y-1.5">
                            {older.map((doc) => {
                              const exp = expiryInfo(doc.expiryDate);
                              return (
                                <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-slate-700/40 bg-slate-900/30 px-2.5 py-1.5">
                                  <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[12px] text-slate-300 truncate">{doc.docName}</div>
                                    <div className="text-[10px] text-slate-500 truncate">
                                      {formatBytes(doc.fileSize)} · {new Date(doc.createdAt).toLocaleDateString()}
                                      {exp ? ` · ${exp.label}` : ''}
                                    </div>
                                  </div>
                                  <button type="button" title="Preview" onClick={() => openPreview(doc)} className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-700/60">
                                    <Eye className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Download"
                                    onClick={() => {
                                      const a = document.createElement('a');
                                      a.href = `/api/documents/employee/${doc.id}/file?mode=download&_=${Date.now()}`;
                                      a.download = doc.fileName;
                                      document.body.appendChild(a);
                                      a.click();
                                      a.remove();
                                    }}
                                    className="rounded p-1 text-slate-400 hover:text-white hover:bg-slate-700/60"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                  </button>
                                  {renderDocActions(doc)}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  /* §9 — missing: never hidden, with a direct upload action */
                  <div className="rounded-lg border border-dashed border-slate-700/70 px-3 py-4 text-center">
                    <div className="text-xs text-slate-500 mb-2.5">No {DOC_TYPE_LABELS[type].toLowerCase()} on file yet.</div>
                    <Button size="sm" variant="outline" onClick={() => openUpload(type)} className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white h-8">
                      <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* §7 — in-app document preview (PDF viewer / image zoom) */}
      <DocumentPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />

      {/* upload modal */}
      <AlertDialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200 max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Upload Employee Document</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              The file is stored under the employee&apos;s {DOC_TYPE_LABELS[uploadType]} records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-400">Document Type *</span>
              <Select value={uploadType} onValueChange={setUploadType}>
                <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
                  <SelectItem value="passport">Passport</SelectItem>
                  <SelectItem value="id_card">ID Card</SelectItem>
                  <SelectItem value="visa">Visa</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-400">Document Name {uploadType === 'other' ? '*' : '(optional)'}</span>
              <Input value={uploadName} onChange={(e) => setUploadName(e.target.value)} placeholder={uploadType === 'other' ? 'e.g. Labour Contract' : 'Passport'} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Expiry Date</span>
                <Input type="date" value={uploadExpiry} onChange={(e) => setUploadExpiry(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium text-slate-400">Notes</span>
                <Input value={uploadNotes} onChange={(e) => setUploadNotes(e.target.value)} placeholder="Optional" className={inputCls} />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-400">File * (PDF, image or Word · max 20 MB)</span>
              <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} className={inputCls} />
            </div>
          </div>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-slate-300 border-slate-700 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={submitUpload} disabled={uploading} className="bg-blue-600 hover:bg-blue-500 text-white border-0">
              <Upload className="h-4 w-4 mr-2" /> {uploading ? 'Uploading…' : 'Upload'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* rename / expiry modal */}
      <AlertDialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <AlertDialogContent className="bg-slate-800 border-slate-700 text-slate-200 max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Rename document</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Give this document a clear, correct name and keep its expiry up to date.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="Document name" className={inputCls} autoFocus />
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-400">Expiry Date</span>
              <Input type="date" value={renameExpiry} onChange={(e) => setRenameExpiry(e.target.value)} className={inputCls} />
            </div>
          </div>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="text-slate-300 border-slate-700 hover:bg-slate-700">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={submitRename} className="bg-blue-600 hover:bg-blue-500 text-white border-0">
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* delete confirm */}
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
