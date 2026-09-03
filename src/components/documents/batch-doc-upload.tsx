'use client';

/**
 * BatchDocUploadDialog — drag & drop MANY document files at once, one per
 * employee scan (e.g. "ASM-2026-001 Passport.pdf", "John Doe - Visa.pdf").
 *
 * Flow: drop files → server auto-detects the doc type + best employee match
 * from the file name → review grid (change type / change employee / remove) →
 * upload all → per-file summary. Files with no confident match are marked
 * "needs review" and MUST be assigned before upload; anything that slips
 * through can be fixed later via the per-document "Move" (reassign) action.
 */
import React from 'react';
import {
  UploadCloud,
  FileText,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Search,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/documents/shared';

interface EmployeeLite {
  id: string;
  fullName: string;
  employeeId: string;
  trade?: string | null;
}

interface BatchItem {
  key: string; // unique per dropped file
  file: File;
  docType: string;
  employeeId: string; // '' = unassigned
  matchedName: string; // for display
  confidence: 'exact' | 'name' | 'fuzzy' | 'none' | 'manual';
}

const DOC_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'id_card', label: 'ID Card' },
  { value: 'visa', label: 'Visa' },
  { value: 'other', label: 'Other' },
];

const ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx'];
const MAX_FILES = 100;

function confidenceBadge(c: BatchItem['confidence']) {
  switch (c) {
    case 'exact':
      return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/25 text-[9px]">Auto · ID</Badge>;
    case 'name':
      return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/25 text-[9px]">Auto · Name</Badge>;
    case 'fuzzy':
      return <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/25 text-[9px]">Likely</Badge>;
    case 'manual':
      return <Badge className="bg-blue-500/15 text-blue-300 border-blue-500/25 text-[9px]">Picked</Badge>;
    default:
      return <Badge className="bg-red-500/15 text-red-300 border-red-500/25 text-[9px]">Needs review</Badge>;
  }
}

export function BatchDocUploadDialog({
  open,
  onClose,
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = React.useState<BatchItem[]>([]);
  const [employees, setEmployees] = React.useState<EmployeeLite[]>([]);
  const [loadingEmployees, setLoadingEmployees] = React.useState(false);
  const [inspecting, setInspecting] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [results, setResults] = React.useState<Array<{ fileName: string; success: boolean; error?: string; employeeName?: string }> | null>(null);
  const [empQuery, setEmpQuery] = React.useState('');
  const [pickerFor, setPickerFor] = React.useState<string | null>(null); // item key with open employee picker
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const keyCounter = React.useRef(0);

  // load the employee roster once per open
  React.useEffect(() => {
    if (!open) return;
    setItems([]);
    setResults(null);
    setEmpQuery('');
    setPickerFor(null);
    setLoadingEmployees(true);
    (async () => {
      try {
        const res = await fetch('/api/employees?limit=1000');
        const data = await res.json();
        if (data.success) setEmployees(data.data?.employees || []);
      } catch { /* silent */ } finally { setLoadingEmployees(false); }
    })();
  }, [open]);

  const addFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter((f) => {
      const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
      return ALLOWED_EXT.includes(ext);
    });
    if (incoming.length === 0) {
      toast({ title: 'Unsupported files', description: 'Allowed: PDF, PNG, JPG, WEBP, DOC, DOCX', variant: 'destructive' });
      return;
    }
    setResults(null);
    const room = Math.max(0, MAX_FILES - items.length);
    const accepted = incoming.slice(0, room);
    if (accepted.length < incoming.length) {
      toast({ title: `Only the first ${MAX_FILES} files were added` });
    }
    const staged: BatchItem[] = accepted.map((f) => ({
      key: `f${++keyCounter.current}`,
      file: f,
      docType: 'other',
      employeeId: '',
      matchedName: '',
      confidence: 'none',
    }));
    setItems((prev) => [...prev, ...staged]);

    // ask the server for doc-type + employee suggestions
    setInspecting(true);
    try {
      const res = await fetch('/api/documents/employee/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: accepted.map((f) => ({ name: f.name })) }),
      });
      const data = await res.json();
      if (data.success) {
        const suggestions: Array<{ fileName: string; docType: string; employee: { id: string; fullName: string; employeeId: string; confidence: number } | null }> = data.data.results || [];
        setItems((prev) => prev.map((it) => {
          const idx = accepted.findIndex((f) => f.name === it.file.name && staged.some((s) => s.key === it.key));
          const byName = suggestions.find((s) => s.fileName === it.file.name);
          if (!byName) return it;
          const emp = byName.employee;
          let confidence: BatchItem['confidence'] = 'none';
          if (emp) {
            confidence = emp.confidence >= 1 ? 'exact' : emp.confidence >= 0.9 ? 'name' : 'fuzzy';
          }
          return {
            ...it,
            docType: DOC_TYPES.some((t) => t.value === byName.docType) ? byName.docType : 'other',
            employeeId: confidence === 'fuzzy' ? '' : (emp?.id ?? ''), // fuzzy suggestions need explicit confirmation
            matchedName: emp ? `${emp.fullName} (${emp.employeeId})` : '',
            confidence,
          };
        }));
      }
    } catch { /* silent — files stay unassigned */ } finally {
      setInspecting(false);
    }
  };

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  const assignEmployee = (key: string, emp: EmployeeLite | null) => {
    setItems((prev) => prev.map((i) => i.key === key
      ? {
          ...i,
          employeeId: emp?.id ?? '',
          matchedName: emp ? `${emp.fullName} (${emp.employeeId})` : '',
          confidence: emp ? 'manual' : 'none',
        }
      : i));
    setPickerFor(null);
    setEmpQuery('');
  };

  const unassignedCount = items.filter((i) => !i.employeeId).length;

  const doUpload = async () => {
    if (unassignedCount > 0 || items.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const it of items) form.append('files', it.file);
      form.append('mappings', JSON.stringify(items.map((it) => ({
        employeeId: it.employeeId,
        docType: it.docType,
      }))));
      const res = await fetch('/api/documents/employee/batch', { method: 'POST', body: form });
      const data = await res.json();
      if (data.success) {
        setResults(data.data.results || []);
        toast({
          title: `Batch complete — ${data.data.created} uploaded${data.data.failed ? `, ${data.data.failed} failed` : ''}`,
          variant: data.data.failed ? 'destructive' : 'default',
        });
        onCompleted();
        setItems([]);
      } else {
        toast({ title: 'Batch upload failed', description: data.error || 'Unknown error', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Batch upload failed', description: 'Network error', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const filteredEmployees = employees.filter((e) => {
    const q = empQuery.trim().toLowerCase();
    if (!q) return true;
    return e.fullName.toLowerCase().includes(q) || e.employeeId.toLowerCase().includes(q);
  }).slice(0, 12);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !uploading) onClose(); }}>
      <DialogContent className="bg-slate-800 border-slate-700 max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Batch Upload Employee Documents</DialogTitle>
          <DialogDescription className="text-slate-400">
            Drag & drop scans for MANY employees at once. File names should include the employee ID or full name —
            e.g. <span className="text-slate-200 font-mono text-xs">ASM-2026-001 Passport.pdf</span> — and we match them automatically.
            Anything mismatched can be reassigned later from the document&apos;s <span className="text-slate-200">Move</span> action.
          </DialogDescription>
        </DialogHeader>

        {/* drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors',
            dragOver ? 'border-blue-400 bg-blue-500/10' : 'border-slate-600 bg-slate-900/40 hover:border-slate-500',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ALLOWED_EXT.join(',')}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <UploadCloud className={cn('h-8 w-8 mx-auto mb-2', dragOver ? 'text-blue-300' : 'text-slate-500')} />
          <p className="text-sm text-slate-300">
            Drag &amp; drop document files here, or <span className="text-blue-400 underline">browse</span>
          </p>
          <p className="text-[11px] text-slate-500 mt-1">PDF · PNG · JPG · WEBP · DOC · DOCX — up to {MAX_FILES} files per batch (20 MB each)</p>
        </div>

        {/* review grid */}
        {items.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                Review matches ({items.length} file{items.length !== 1 ? 's' : ''})
              </h4>
              {inspecting && <span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Matching…</span>}
              {unassignedCount > 0 && !inspecting && (
                <span className="text-[11px] text-amber-300 inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> {unassignedCount} file{unassignedCount !== 1 ? 's' : ''} need an employee
                </span>
              )}
            </div>

            <div className="max-h-[320px] overflow-y-auto space-y-1.5 pr-1">
              {items.map((it) => (
                <div
                  key={it.key}
                  className={cn(
                    'rounded-lg border p-2.5 flex flex-wrap items-center gap-2',
                    it.employeeId ? 'border-slate-700/60 bg-slate-900/50' : 'border-amber-500/30 bg-amber-500/5',
                  )}
                >
                  <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-xs font-medium text-slate-200 truncate" title={it.file.name}>{it.file.name}</p>
                    <p className="text-[10px] text-slate-500">{(it.file.size / 1024).toFixed(0)} KB</p>
                  </div>

                  {/* doc type */}
                  <Select value={it.docType} onValueChange={(v) => setItems((prev) => prev.map((i) => (i.key === it.key ? { ...i, docType: v } : i)))}>
                    <SelectTrigger className="h-7 w-[110px] text-[11px] bg-slate-900 border-slate-700 text-slate-200"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
                      {DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>

                  {/* employee assignment */}
                  {it.employeeId ? (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[11px] text-slate-300 truncate max-w-[170px]" title={it.matchedName}>{it.matchedName}</span>
                      {confidenceBadge(it.confidence)}
                      <button
                        type="button"
                        className="text-[10px] text-blue-400 hover:text-blue-300 underline"
                        onClick={() => setPickerFor(pickerFor === it.key ? null : it.key)}
                      >
                        change
                      </button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                      onClick={() => setPickerFor(pickerFor === it.key ? null : it.key)}
                    >
                      <Search className="h-3 w-3 mr-1" /> Pick employee
                    </Button>
                  )}

                  <button
                    type="button"
                    onClick={() => removeItem(it.key)}
                    className="rounded p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors ml-auto"
                    title="Remove from batch"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>

                  {/* inline employee picker */}
                  {pickerFor === it.key && (
                    <div className="w-full rounded-lg border border-slate-600 bg-slate-900 p-2 space-y-2">
                      <Input
                        autoFocus
                        value={empQuery}
                        onChange={(e) => setEmpQuery(e.target.value)}
                        placeholder="Search by name or employee ID…"
                        className={cn('h-8 text-xs', inputCls)}
                      />
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {loadingEmployees ? (
                          <p className="text-[11px] text-slate-500 text-center py-2">Loading employees…</p>
                        ) : filteredEmployees.length === 0 ? (
                          <p className="text-[11px] text-slate-500 text-center py-2">No employees match</p>
                        ) : (
                          filteredEmployees.map((e) => (
                            <button
                              key={e.id}
                              type="button"
                              className="w-full text-left rounded-md px-2 py-1.5 hover:bg-slate-700/50 transition-colors"
                              onClick={() => assignEmployee(it.key, e)}
                            >
                              <span className="text-xs text-slate-200">{e.fullName}</span>
                              <span className="text-[10px] text-slate-500 font-mono ml-2">{e.employeeId}</span>
                              {e.trade && <span className="text-[10px] text-slate-500 ml-2">· {e.trade}</span>}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* upload result summary */}
        {results && results.length > 0 && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-1 max-h-40 overflow-y-auto">
            <p className="text-xs font-semibold text-slate-300 mb-1">Upload results</p>
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                {r.success ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <AlertTriangle className="h-3 w-3 text-red-400" />}
                <span className="text-slate-300 truncate flex-1" title={r.fileName}>{r.fileName}</span>
                {r.success ? (
                  <span className="text-emerald-300">→ {r.employeeName}</span>
                ) : (
                  <span className="text-red-300">{r.error}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* footer actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-700/60">
          <Button variant="outline" onClick={() => { if (!uploading) { onClose(); } }} className="border-slate-600 text-slate-300 hover:bg-slate-700">
            {results ? 'Done' : 'Cancel'}
          </Button>
          <Button
            onClick={doUpload}
            disabled={uploading || inspecting || items.length === 0 || unassignedCount > 0}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UploadCloud className="h-4 w-4 mr-2" />}
            Upload {items.length > 0 ? `${items.length} document${items.length !== 1 ? 's' : ''}` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
