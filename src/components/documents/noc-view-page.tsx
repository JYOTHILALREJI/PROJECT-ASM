'use client';

/**
 * NocViewPage — dedicated full-page NOC viewer (opened instead of a modal
 * from everywhere in the app: dashboard, All NOCs list, client folders).
 *
 *  · Back button returns to Documents (restores the originating tab)
 *  · Print + Download + ZIP DOCUMENTS actions in the header
 *  · FINAL NOCs: stamp controls AFTER issue — toggle the stamp on/off and
 *    choose WHICH stamp from the library; the stored PDF is re-rendered while
 *    the original as-issued PDF is preserved. Stamping shows a confirmation
 *    dialog with the EXACT stamp image preview, then a physical stamp-drop
 *    animation that lands on the SAME normalized position the PDF renderer
 *    used (shared StampRectMeta, §36-38).
 *  · ZIP DOCUMENTS builds a server-side package: NOC PDF + one ZIP per
 *    employee with their latest valid documents (§1-27) — with a summary of
 *    included/missing documents before download.
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
  CheckCircle2,
  FileArchive,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import type { StampRectMeta } from '@/lib/noc-pdf';

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
  stampAppliedAt?: string | null;
  stampAppliedBy?: string | null;
  stampRect?: StampRectMeta | null;
  updatedAt?: string;
}

interface StampOption {
  id: string;
  name: string;
  imagePath?: string;
  companyId?: string | null;
  companyName?: string | null;
  isDefault: boolean;
}

interface PackageSummaryData {
  fileName: string;
  employeeCount: number;
  employeeZipsCreated: number;
  employeesFailed: string[];
  documentsIncluded: number;
  documentsMissing: number;
  byCategory: Record<string, { included: number; missing: number }>;
  employees: Array<{
    snapshotName: string;
    passport: string;
    matched: boolean;
    zipName: string;
    error?: string;
    docs: Array<{ type: string; label: string; included: boolean; zipName?: string; sourceName?: string }>;
  }>;
  nocPdfIncluded: boolean;
}

interface LastPackage {
  id: string;
  fileName: string;
  fileSize: number;
  employeeCount: number;
  documentsIncluded: number;
  documentsMissing: number;
  createdAt: string;
}

const inputCls = 'bg-slate-900/60 border-slate-700/60 text-slate-200 focus-visible:ring-blue-500/40';

/** Fallback target when no rendered rect is stored yet (matches the reference layout's signature area). */
const DEFAULT_STAMP_RECT: StampRectMeta = { page: 1, x: 0.665, y: 0.52, w: 0.255, h: 0.19, rotation: -8 };
/** Chrome's built-in PDF viewer reserves roughly this much toolbar height inside an <iframe>. */
const PDF_VIEWER_CHROME_PX = 40;
const A4_ASPECT = 841.89 / 595.28; // h/w

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
// Stamp animation (§34-41) — the PDF REMAINS VISIBLE throughout; the stamp
// appears above the document, travels to the target position, accelerates
// down, impacts with a small bounce, and the ink impression appears exactly
// where the renderer drew it. Purely cosmetic — never delays the operation.
// ---------------------------------------------------------------------------

const STAMP_ANIM_CSS = `
@keyframes noc-stamp-travel {
  0%   { transform: translate(-50%, -170px) rotate(-24deg) scale(1.55); opacity: 0; }
  18%  { opacity: 1; }
  62%  { transform: translate(-50%, -26px) rotate(-13deg) scale(1.06); opacity: 1; }
  78%  { transform: translate(-50%, 0px) rotate(-9deg) scale(1); opacity: 1; }
  86%  { transform: translate(-50%, 0px) rotate(-9.5deg) scale(1.045); opacity: 1; }
  93%  { transform: translate(-50%, 0px) rotate(-9deg) scale(0.985); opacity: 1; }
  100% { transform: translate(-50%, 0px) rotate(-9deg) scale(1); opacity: 1; }
}
@keyframes noc-stamp-ink {
  0%, 68% { opacity: 0; }
  84%     { opacity: 0.94; }
  100%    { opacity: 0.94; }
}
@keyframes noc-stamp-shadow {
  0%, 60% { opacity: 0; transform: translate(-50%, 0) scale(0.4); }
  78%     { opacity: 0.55; transform: translate(-50%, 0) scale(1); }
  100%    { opacity: 0.35; transform: translate(-50%, 0) scale(1); }
}
@keyframes noc-stamp-dim {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes noc-stamp-success {
  0%, 74% { opacity: 0; transform: translate(-50%, 8px); }
  100%    { opacity: 1; transform: translate(-50%, 0); }
}
`;

function StampAnimationOverlay({ rect, stampName, stampImageSrc }: {
  rect: StampRectMeta;
  stampName: string;
  stampImageSrc: string | null;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [target, setTarget] = React.useState<{ left: number; top: number; w: number; h: number } | null>(null);

  // Map the normalized PDF rect onto the container using the same geometry the
  // browser viewer uses for a fit-width continuous view.
  React.useEffect(() => {
    const compute = () => {
      const el = containerRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const pageW = box.width;
      const pageH = pageW * A4_ASPECT;
      const pageTop = PDF_VIEWER_CHROME_PX + (rect.page - 1) * pageH;
      setTarget({
        left: rect.x * pageW,
        top: pageTop + rect.y * pageH,
        w: rect.w * pageW,
        h: rect.h * pageH,
      });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [rect]);

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-xl">
      <style>{STAMP_ANIM_CSS}</style>
      {/* subtle focus backdrop — the document stays fully visible (§35) */}
      <div className="absolute inset-0 bg-slate-950/25" style={{ animation: 'noc-stamp-dim 220ms ease-out both' }} />
      {target && (
        <>
          {/* landing shadow */}
          <div
            className="absolute rounded-full bg-black/45 blur-md"
            style={{
              left: target.left + target.w / 2,
              top: target.top + target.h,
              width: target.w * 0.9,
              height: 14,
              animation: 'noc-stamp-shadow 1100ms ease-out both',
            }}
          />
          {/* the travelling stamp */}
          <div
            className="absolute"
            style={{
              left: target.left + target.w / 2,
              top: target.top,
              width: target.w,
              height: target.h,
              animation: 'noc-stamp-travel 1100ms cubic-bezier(.3,.9,.3,1) both',
            }}
          >
            {stampImageSrc ? (
              <img
                src={stampImageSrc}
                alt={stampName}
                className="h-full w-full object-contain drop-shadow-[0_18px_22px_rgba(0,0,0,0.5)]"
              />
            ) : (
              <StampIcon className="h-full w-full text-red-500/90 drop-shadow-[0_18px_22px_rgba(0,0,0,0.5)]" />
            )}
          </div>
          {/* ink impression appearing at the final position */}
          <div
            className="absolute"
            style={{
              left: target.left,
              top: target.top,
              width: target.w,
              height: target.h,
              transform: `rotate(${rect.rotation}deg)`,
              animation: 'noc-stamp-ink 1100ms ease-out both',
            }}
          >
            {stampImageSrc ? (
              <img src={stampImageSrc} alt="" className="h-full w-full object-contain opacity-90" />
            ) : (
              <StampIcon className="h-full w-full text-red-600/80" />
            )}
          </div>
        </>
      )}
      {/* success chip */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-1.5 backdrop-blur-sm"
        style={{ animation: 'noc-stamp-success 1250ms ease-out both' }}
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" /> NOC Stamped — {stampName}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Package dialog (§15-19, §55-56)
// ---------------------------------------------------------------------------

function PackageDialog({ noc, onClose, onDone }: {
  noc: NocDetail;
  onClose: () => void;
  onDone: (pkg: LastPackage) => void;
}) {
  const { user } = useAuthStore();
  const [phase, setPhase] = React.useState<'working' | 'ready' | 'error'>('working');
  const [summary, setSummary] = React.useState<PackageSummaryData | null>(null);
  const [downloadUrl, setDownloadUrl] = React.useState('');
  const [error, setError] = React.useState('');
  const [detailOpen, setDetailOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/noc/${noc.id}/package`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorUserId: user?.id, actorDisplayName: user?.name || user?.email }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) throw new Error(data.error || 'Package generation failed');
        setSummary(data.data.summary);
        setDownloadUrl(data.data.downloadUrl);
        setPhase('ready');
        onDone({ ...data.data.package, employeeCount: data.data.summary.employeeCount, documentsIncluded: data.data.summary.documentsIncluded, documentsMissing: data.data.summary.documentsMissing });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unknown error');
          setPhase('error');
        }
      }
    })();
    return () => { cancelled = true; };
     
  }, [noc.id]);

  const download = () => {
    const a = document.createElement('a');
    a.href = `${downloadUrl}&actorDisplayName=${encodeURIComponent(user?.name || user?.email || 'Admin')}`;
    a.download = summary?.fileName || 'NOC-package.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl bg-slate-900 border-slate-700 text-slate-200">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <FileArchive className="h-5 w-5 text-amber-400" /> Prepare NOC Documents
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {noc.clientName}{noc.projectName ? ` — ${noc.projectName}` : ''} · {noc.employeeCount} employee{noc.employeeCount !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        {phase === 'working' && (
          <div className="py-8 text-center">
            <Loader2 className="h-8 w-8 text-blue-400 animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-300">Documents are being collected…</p>
            <p className="text-xs text-slate-500 mt-1">The NOC PDF and the latest valid documents of every employee are packaged on the server.</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            <div className="flex items-center gap-2 mb-1 font-semibold"><AlertTriangle className="h-4 w-4" /> Package failed</div>
            {error}
          </div>
        )}

        {phase === 'ready' && summary && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <div className="text-sm text-emerald-200">
                Package Ready — <span className="font-semibold">{summary.fileName}</span>
                <span className="text-emerald-300/70"> · {summary.employeeZipsCreated} employee ZIP{summary.employeeZipsCreated !== 1 ? 's' : ''} · {summary.documentsIncluded} document{summary.documentsIncluded !== 1 ? 's' : ''} included</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {['passport', 'id_card', 'visa', 'other'].map((type) => {
                const cat = summary.byCategory[type] || { included: 0, missing: 0 };
                const label = type === 'passport' ? 'Passport' : type === 'id_card' ? 'Emirates ID' : type === 'visa' ? 'Visa' : 'Medical / Other';
                return (
                  <div key={type} className="rounded-lg border border-slate-700/60 bg-slate-800/50 px-3 py-2">
                    <div className="font-semibold text-slate-200">{label}</div>
                    <div className="text-slate-400 mt-0.5">
                      <span className="text-emerald-300">{cat.included}</span> included
                      {cat.missing > 0 && <span className="text-amber-300"> · {cat.missing} missing</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {summary.employeesFailed.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Failed employee ZIPs ({summary.employeesFailed.length}): {summary.employeesFailed.join(', ')} — the rest of the package is complete.
              </div>
            )}

            <button type="button" className="text-[11px] text-blue-300 hover:text-blue-200 underline underline-offset-2" onClick={() => setDetailOpen((v) => !v)}>
              {detailOpen ? 'Hide' : 'Show'} per-employee detail
            </button>
            {detailOpen && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-700/60 divide-y divide-slate-700/40 text-[11px]">
                {summary.employees.map((e) => (
                  <div key={e.zipName || e.snapshotName} className="px-3 py-1.5 flex items-center gap-2">
                    <span className="font-medium text-slate-200 truncate flex-1">{e.snapshotName}</span>
                    {!e.matched && <Badge variant="secondary" className="bg-slate-700 text-slate-400 text-[9px]">no profile</Badge>}
                    {e.error ? (
                      <Badge variant="secondary" className="bg-red-500/15 text-red-300 text-[9px]">failed</Badge>
                    ) : (
                      <span className="text-slate-400">{e.docs.filter((d) => d.included).map((d) => d.label.split(' ')[0]).join(' · ') || 'no documents'}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white">Close</Button>
          {phase === 'ready' && (
            <Button onClick={download} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              <Download className="h-4 w-4 mr-2" /> Download ZIP
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

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
  const [stampAnim, setStampAnim] = React.useState<{ rect: StampRectMeta; name: string; imageSrc: string | null; nonce: number } | null>(null);
  // §33 — confirm dialog with the exact stamp image before applying
  const [pendingStamp, setPendingStamp] = React.useState<{ enabled: boolean; stampId: string } | null>(null);
  // §15 — ZIP DOCUMENTS
  const [packageOpen, setPackageOpen] = React.useState(false);
  const [lastPackage, setLastPackage] = React.useState<LastPackage | null>(null);
  const [packageStale, setPackageStale] = React.useState(false);

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

  // last completed package (§26 — "Last Package Generated" + staleness)
  React.useEffect(() => {
    if (!noc || noc.status !== 'final') return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/documents/noc/${noc.id}/package?view=latest`);
        const data = await res.json();
        if (data.success) {
          setLastPackage(data.data.package || null);
          setPackageStale(!!data.data.stale);
        }
      } catch { /* silent */ }
    }, 0);
    return () => clearTimeout(t);
  }, [noc?.id, noc?.status, noc?.updatedAt]);

  const pdfUrl = `/api/documents/noc/${nocId}/pdf?mode=inline&_=${pdfKey}`;

  /** §31 — the request carries ONLY the stampId; the backend loads the exact record. */
  const applyStampChange = async (nextEnabled: boolean, nextStampId: string) => {
    if (!noc || noc.status !== 'final') return;
    setSavingStamp(true);
    // cosmetic animation fires immediately — the operation runs in parallel (§39)
    if (nextEnabled) {
      const stamp = stamps.find((s) => s.id === nextStampId);
      const rect = noc.stampRect || DEFAULT_STAMP_RECT;
      setStampAnim({
        rect,
        name: stamp?.name || 'Stamp',
        imageSrc: stamp && nextStampId ? `/api/documents/stamps/${nextStampId}/image` : null,
        nonce: Date.now(),
      });
      window.setTimeout(() => setStampAnim(null), 1300);
    } else {
      setStampAnim(null);
    }
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
      const updated = data.data.noc as { stampRect?: string | null; stampAppliedAt?: string | null };
      let nextRect: StampRectMeta | null = null;
      try { nextRect = updated.stampRect ? (JSON.parse(updated.stampRect) as StampRectMeta) : null; } catch { nextRect = null; }
      setNoc((prev) => (prev ? {
        ...prev,
        stampEnabled: nextEnabled,
        stampId: nextEnabled ? nextStampId : null,
        stampName: nextEnabled ? stamps.find((s) => s.id === nextStampId)?.name || prev.stampName : null,
        stampAppliedAt: nextEnabled ? (updated.stampAppliedAt || new Date().toISOString()) : null,
        stampAppliedBy: nextEnabled ? (user?.name || user?.email || 'Admin') : null,
        stampRect: nextRect,
      } : prev));
      setPdfKey(Date.now());
      toast({
        title: nextEnabled ? 'Stamp applied' : 'Stamp removed',
        description: nextEnabled
          ? `${noc.nocNumber} was re-rendered with ${stamps.find((s) => s.id === nextStampId)?.name || 'the selected stamp'} — the original unstamped NOC remains preserved.`
          : `${noc.nocNumber} reverted to the original unstamped PDF.`,
      });
    } catch (e) {
      toast({ title: 'Stamp update failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setSavingStamp(false);
    }
  };

  /** §33 — open the confirmation dialog with the exact stamp preview. */
  const requestStampChange = (enabled: boolean, id: string) => setPendingStamp({ enabled, stampId: id });

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

  const animStampSrc = stampAnim?.imageSrc || null;
  const stampLabel = noc.stampEnabled ? (noc.stampName || 'Applied') : 'Not Applied';

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
            {/* §42 — explicit stamp state */}
            {noc.status === 'final' && (
              <span className={cn('inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border', noc.stampEnabled ? 'bg-blue-500/10 text-blue-300 border-blue-500/25' : 'bg-slate-800 text-slate-500 border-slate-700/60')}>
                <StampIcon className="h-3 w-3" /> Stamp: {stampLabel}
              </span>
            )}
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
                  const def = stamps.find((s) => s.isDefault) || stamps[0];
                  const nextId = checked ? (stampId || def?.id || '') : stampId;
                  if (checked) setStampId(nextId);
                  requestStampChange(checked, nextId);
                }}
              />
              {stampEnabled && (
                <Select
                  value={stampId || undefined}
                  disabled={savingStamp}
                  onValueChange={(v) => {
                    setStampId(v);
                    requestStampChange(true, v);
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
          {/* §15 — ZIP DOCUMENTS on finalized NOCs */}
          <Button size="sm" disabled={noc.status !== 'final' || packageOpen} onClick={() => setPackageOpen(true)} className="bg-amber-600 hover:bg-amber-500 text-white">
            <FileArchive className="h-3.5 w-3.5 mr-1.5" /> ZIP Documents
          </Button>
        </div>
      </div>

      {/* last package info (§26) */}
      {noc.status === 'final' && lastPackage && !packageOpen && (
        <div className={cn('flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[11px]', packageStale ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-slate-700/50 bg-slate-800/40 text-slate-400')}>
          <FileArchive className="h-3.5 w-3.5 shrink-0" />
          <span>
            Last package: <span className="text-slate-200">{lastPackage.fileName}</span> — generated {new Date(lastPackage.createdAt).toLocaleString()} · {lastPackage.documentsIncluded} documents included{lastPackage.documentsMissing > 0 ? `, ${lastPackage.documentsMissing} missing` : ''}
          </span>
          {packageStale && <span className="font-semibold text-amber-300">Documents or the NOC changed since then — generate a fresh package.</span>}
        </div>
      )}

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
        <div className="relative rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
          {stampAnim && <StampAnimationOverlay key={stampAnim.nonce} rect={stampAnim.rect} stampName={stampAnim.name} stampImageSrc={animStampSrc} />}
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

      {/* §33 — stamp confirmation dialog with the EXACT stamp image */}
      <Dialog open={!!pendingStamp} onOpenChange={(open) => !open && setPendingStamp(null)}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-700 text-slate-200">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <StampIcon className="h-5 w-5 text-blue-400" />
              {pendingStamp?.enabled ? (noc.stampEnabled ? 'Change stamp' : 'Stamp NOC') : 'Remove stamp'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {pendingStamp?.enabled
                ? `NOC ${noc.nocNumber} will be re-rendered with the selected stamp. The original unstamped NOC remains preserved.`
                : `NOC ${noc.nocNumber} will revert to the original unstamped PDF.`}
            </DialogDescription>
          </DialogHeader>

          {pendingStamp?.enabled && (
            <>
              {/* §43 — replacing an existing stamp warns first */}
              {noc.stampEnabled && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  This NOC already has a stamp{noc.stampName ? ` (${noc.stampName})` : ''}. Applying a different stamp will replace the existing stamped PDF — the original unstamped NOC will remain preserved.
                </div>
              )}
              <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/50 p-4">
                <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed border-slate-600 bg-slate-900/60 p-2">
                  {pendingStamp.stampId ? (
                    <img
                      src={`/api/documents/stamps/${pendingStamp.stampId}/image`}
                      alt="Selected stamp"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <StampIcon className="h-10 w-10 text-slate-600" />
                  )}
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold text-white">{stamps.find((s) => s.id === pendingStamp.stampId)?.name || 'Default stamp'}</div>
                  {stamps.find((s) => s.id === pendingStamp.stampId)?.companyName && (
                    <div className="text-[11px] text-slate-400">{stamps.find((s) => s.id === pendingStamp.stampId)?.companyName}</div>
                  )}
                </div>
              </div>
            </>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setPendingStamp(null)} className="border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white">Cancel</Button>
            <Button
              onClick={() => {
                const p = pendingStamp;
                setPendingStamp(null);
                if (p) applyStampChange(p.enabled, p.stampId);
              }}
              disabled={savingStamp}
              className={cn('text-white', pendingStamp?.enabled ? 'bg-blue-600 hover:bg-blue-500' : 'bg-red-600 hover:bg-red-500')}
            >
              {savingStamp ? 'Working…' : pendingStamp?.enabled ? 'Apply Stamp' : 'Remove Stamp'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* §15-19 — package dialog */}
      {packageOpen && (
        <PackageDialog
          noc={noc}
          onClose={() => setPackageOpen(false)}
          onDone={(pkg) => { setLastPackage(pkg); setPackageStale(false); }}
        />
      )}
    </div>
  );
}
