'use client';

/**
 * NocViewPage — dedicated full-page NOC viewer (opened instead of a modal
 * from everywhere in the app: dashboard, All NOCs list, client folders).
 *
 *  · Back button returns to Documents
 *  · Print + Download to device actions in the header
 *  · FINAL NOCs: stamp controls AFTER issue — toggle the stamp on/off and
 *    choose WHICH stamp from the library; the stored PDF is re-rendered.
 *  · DRAFT NOCs: a notice with a "Continue editing" shortcut (drafts have
 *    no issued PDF).
 */
import React from 'react';
import {
  ArrowLeft,
  Printer,
  Download,
  FileText,
  Stamp as StampIcon,
  Pencil,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/utils';

interface NocDetail {
  id: string;
  nocNumber: string;
  status: 'draft' | 'final';
  version: number;
  clientName: string;
  projectName: string;
  nocDate: string;
  employeeCount: number;
  fileName: string;
  stampEnabled: boolean;
  stampId: string | null;
  stampName?: string | null;
}

interface StampOption {
  id: string;
  name: string;
  isDefault: boolean;
}

const inputCls = 'bg-slate-900/60 border-slate-700/60 text-slate-200 focus-visible:ring-blue-500/40';

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

export function NocViewPage({
  nocId,
  onBack,
  onEditDraft,
}: {
  nocId: string;
  onBack: () => void;
  onEditDraft: (draftId: string) => void;
}) {
  const { user } = useAuthStore();
  const [noc, setNoc] = React.useState<NocDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [notFound, setNotFound] = React.useState(false);
  const [pdfKey, setPdfKey] = React.useState(() => Date.now());
  const [stamps, setStamps] = React.useState<StampOption[]>([]);
  const [stampEnabled, setStampEnabled] = React.useState(false);
  const [stampId, setStampId] = React.useState<string>('');
  const [savingStamp, setSavingStamp] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/noc/${nocId}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setNotFound(true);
        return;
      }
      const n = data.data.noc as NocDetail;
      setNoc(n);
      setStampEnabled(!!n.stampEnabled);
      setStampId(n.stampId || '');
      setPdfKey(Date.now());
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [nocId]);

  React.useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  React.useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/documents/stamps');
        const data = await res.json();
        if (data.success) setStamps(data.data.stamps || []);
      } catch {
        // silent — stamp picker simply stays empty
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const pdfUrl = `/api/documents/noc/${nocId}/pdf?mode=inline&_=${pdfKey}`;

  const applyStampChange = async (nextEnabled: boolean, nextStampId: string) => {
    if (!noc || noc.status !== 'final') return;
    setSavingStamp(true);
    try {
      const res = await fetch(`/api/documents/noc/${noc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stampUpdate: true,
          stampEnabled: nextEnabled,
          stampId: nextEnabled ? nextStampId || null : null,
          actorUserId: user?.id,
          actorDisplayName: user?.name || user?.email,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Stamp update failed');
      setNoc((prev) => (prev ? { ...prev, stampEnabled: nextEnabled, stampId: nextStampId || null } : prev));
      setPdfKey(Date.now());
      toast({
        title: nextEnabled ? 'Stamp applied' : 'Stamp removed',
        description: `${noc.nocNumber} was re-rendered ${nextEnabled ? `with ${stamps.find((s) => s.id === nextStampId)?.name || 'the selected stamp'}` : 'without a stamp'}.`,
      });
    } catch (e) {
      toast({ title: 'Stamp update failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setSavingStamp(false);
    }
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = `/api/documents/noc/${nocId}/pdf?mode=download&_=${pdfKey}`;
    a.download = noc?.fileName || 'NOC.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-slate-300 hover:bg-slate-700 hover:text-white">
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Documents
        </Button>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-16 text-center text-sm text-slate-400">Loading NOC…</div>
      </div>
    );
  }

  if (notFound || !noc) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-slate-300 hover:bg-slate-700 hover:text-white">
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Documents
        </Button>
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-10 text-center">
          <FileText className="h-8 w-8 text-red-400 mx-auto mb-3" />
          <p className="text-sm text-red-200">This NOC could not be found — it may have been deleted.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* header bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-700/50 bg-slate-800/40 px-3 py-2.5">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-slate-300 hover:bg-slate-700 hover:text-white">
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Documents
        </Button>
        <div className="h-5 w-px bg-slate-700 mx-1 hidden sm:block" />
        <FileText className="h-4 w-4 text-red-400 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-white truncate">{noc.nocNumber}</span>
            {noc.version > 1 && <Badge variant="secondary" className="bg-violet-500/15 text-violet-300 border border-violet-500/20 text-[9px] px-1">v{noc.version}</Badge>}
            <Badge variant="secondary" className={cn('text-[10px] px-1.5', noc.status === 'final' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-amber-500/15 text-amber-300 border border-amber-500/20')}>
              {noc.status === 'final' ? 'Final' : 'Draft'}
            </Badge>
          </div>
          <div className="text-[11px] text-slate-400 truncate">
            {noc.clientName}{noc.projectName ? ` · ${noc.projectName}` : ''} · {noc.nocDate} · {noc.employeeCount} employee{noc.employeeCount !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* stamp controls (final NOCs only — stamps are opt-in per NOC) */}
          {noc.status === 'final' && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-900/50 px-2.5 py-1.5">
              <StampIcon className={cn('h-3.5 w-3.5', stampEnabled ? 'text-blue-400' : 'text-slate-500')} />
              <span className="text-[11px] font-medium text-slate-300 whitespace-nowrap">Stamp</span>
              <Switch
                checked={stampEnabled}
                disabled={savingStamp}
                onCheckedChange={(checked) => {
                  setStampEnabled(checked);
                  const def = stamps.find((s) => s.isDefault) || stamps[0];
                  const nextId = checked ? (stampId || def?.id || '') : stampId;
                  if (checked) setStampId(nextId);
                  applyStampChange(checked, nextId);
                }}
              />
              {stampEnabled && (
                <Select
                  value={stampId || undefined}
                  disabled={savingStamp}
                  onValueChange={(v) => {
                    setStampId(v);
                    applyStampChange(true, v);
                  }}
                >
                  <SelectTrigger className={cn('h-7 w-36 text-[11px]', inputCls)}>
                    <SelectValue placeholder="Choose stamp" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700 text-slate-200">
                    {stamps.length === 0 && <SelectItem value="_none" disabled>No stamps in library</SelectItem>}
                    {stamps.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}{s.isDefault ? ' (default)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          <Button size="sm" variant="outline" disabled={noc.status !== 'final'} onClick={() => printPdf(pdfUrl)} className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white">
            <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
          </Button>
          <Button size="sm" variant="outline" disabled={noc.status !== 'final'} onClick={download} className="border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white">
            <Download className="h-3.5 w-3.5 mr-1.5" /> Download PDF
          </Button>
        </div>
      </div>

      {/* draft notice */}
      {noc.status === 'draft' && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <Info className="h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-xs text-amber-200 flex-1 min-w-48">
            This NOC is still a <span className="font-semibold">draft</span> — the letter PDF is generated when the NOC is finalized. Preview it in the builder instead.
          </p>
          <Button size="sm" onClick={() => onEditDraft(noc.id)} className="bg-amber-500 hover:bg-amber-400 text-slate-900">
            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Continue editing
          </Button>
        </div>
      )}

      {/* the document itself — full page */}
      {noc.status === 'final' ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
          <iframe
            key={pdfKey}
            src={pdfUrl}
            title={`NOC ${noc.nocNumber}`}
            className="w-full bg-white"
            style={{ height: 'calc(100vh - 205px)', minHeight: 520 }}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-700/70 bg-slate-800/20 p-16 text-center text-sm text-slate-500">
          No issued PDF for drafts.
        </div>
      )}
    </div>
  );
}
