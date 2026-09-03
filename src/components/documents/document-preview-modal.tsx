'use client';

/**
 * DocumentPreviewModal — in-app document viewer (PRD §7):
 *   · PDF  → embedded viewer inside the modal
 *   · image → zoom in/out, fit to screen
 *   · Download + Close always available.
 * The user never needs to download a file just to inspect it.
 */
import React from 'react';
import { ZoomIn, ZoomOut, Maximize2, Download, X, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface PreviewDoc {
  url: string; // file serving URL (inline mode)
  name: string;
  mimeType: string;
  downloadableUrl?: string; // defaults to url with ?mode=download appended by the caller
}

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function DocumentPreviewModal({ doc, onClose }: { doc: PreviewDoc | null; onClose: () => void }) {
  const [zoom, setZoom] = React.useState(1); // 1 = fit to screen
  const isImage = !!doc && IMAGE_MIMES.includes(doc.mimeType);

  const download = () => {
    if (!doc) return;
    const a = document.createElement('a');
    a.href = doc.downloadableUrl || doc.url;
    a.download = doc.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Dialog open={!!doc} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] bg-slate-900 border-slate-700 p-0 overflow-hidden">
        <DialogHeader className="flex flex-row items-center justify-between gap-2 px-4 py-3 border-b border-slate-700/60 bg-slate-800/60">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 text-red-400 shrink-0" />
            <DialogTitle className="text-sm text-white truncate">{doc?.name || 'Document preview'}</DialogTitle>
            <DialogDescription className="sr-only">In-app document preview</DialogDescription>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isImage && (
              <>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-300 hover:bg-slate-700 hover:text-white" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-[11px] text-slate-400 w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-300 hover:bg-slate-700 hover:text-white" title="Zoom in" onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-300 hover:bg-slate-700 hover:text-white" title="Fit to screen" onClick={() => setZoom(1)}>
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" onClick={download} className="h-7 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Download
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:bg-slate-700 hover:text-white" title="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="bg-slate-950/80 overflow-auto" style={{ height: 'calc(85vh - 60px)' }}>
          {!doc ? null : isImage ? (
            <div className="min-h-full min-w-full flex items-center justify-center p-4">
              { }
              <img
                src={doc.url}
                alt={doc.name}
                className={cn('origin-center transition-transform', zoom === 1 && 'max-w-full max-h-[78vh] object-contain')}
                style={zoom === 1 ? undefined : { transform: `scale(${zoom})` }}
              />
            </div>
          ) : (
            <iframe src={doc.url} title={doc.name} className="w-full h-full bg-white" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
