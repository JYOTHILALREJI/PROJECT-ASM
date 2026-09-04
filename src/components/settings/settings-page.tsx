'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Settings as SettingsIcon,
  Building2,
  Banknote,
  Check,
  Loader2,
  Crown,
  Info,
  Palette,
  Upload,
  Trash2,
  ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth-store';
import { useSettingsStore } from '@/store/settings-store';
import { CURRENCIES, formatMoney, getCurrencyDef } from '@/lib/currency';

const MAX_LOGO_DIMENSION = 256; // px — logos are resized client-side before upload
const MAX_LOGO_BASE64 = 500_000; // mirrors the API-side limit (~375 KB binary)

/**
 * Read an image File and produce a downscaled base64 PNG data-URL
 * (max 256×256, aspect preserved, transparency kept).
 */
async function fileToResizedDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not read that image file'));
      image.src = objectUrl;
    });
    const scale = Math.min(1, MAX_LOGO_DIMENSION / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported in this browser');
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > MAX_LOGO_BASE64) {
      throw new Error('Image is too large even after resizing — try a smaller logo');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function SettingsPage() {
  const { user } = useAuthStore();
  const { settings, loaded, fetchSettings, updateSettings } = useSettingsStore();

  // Local draft starts as null (inputs fall back to the server settings);
  // it becomes non-null the moment the user edits anything. This keeps the
  // draft in sync without setState-in-effect (lint-clean).
  const [draft, setDraft] = useState<{
    companyName: string;
    brandName: string;
    brandLogo: string;
    currency: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const companyName = draft?.companyName ?? settings.companyName;
  const brandName = draft?.brandName ?? settings.brandName;
  const brandLogo = draft?.brandLogo ?? settings.brandLogo;
  const currency = draft?.currency ?? settings.currency;
  const patchDraft = (patch: Partial<{ companyName: string; brandName: string; brandLogo: string; currency: string }>) =>
    setDraft({
      companyName: patch.companyName ?? companyName,
      brandName: patch.brandName ?? brandName,
      brandLogo: patch.brandLogo ?? brandLogo,
      currency: patch.currency ?? currency,
    });

  const dirty =
    draft !== null &&
    (companyName !== settings.companyName ||
      brandName !== settings.brandName ||
      brandLogo !== settings.brandLogo ||
      currency !== settings.currency);

  const handleLogoFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file', description: 'Please choose an image (PNG, JPG, WEBP or SVG).', variant: 'destructive' });
      return;
    }
    setLogoBusy(true);
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      patchDraft({ brandLogo: dataUrl });
    } catch (err) {
      toast({
        title: 'Logo rejected',
        description: err instanceof Error ? err.message : 'Could not process that image',
        variant: 'destructive',
      });
    } finally {
      setLogoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    if (!companyName.trim()) {
      toast({ title: 'Validation Error', description: 'Company name cannot be empty.', variant: 'destructive' });
      return;
    }
    if (!brandName.trim()) {
      toast({ title: 'Validation Error', description: 'Brand text cannot be empty.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const result = await updateSettings(
      { companyName: companyName.trim(), brandName: brandName.trim(), brandLogo, currency },
      user.id
    );
    setSaving(false);
    if (result.success) {
      setDraft(null); // re-sync the form with the persisted settings
      toast({
        title: 'Settings Applied',
        description: 'Your changes are now live across every page of the app.',
      });
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to save settings', variant: 'destructive' });
    }
  };

  const previewDef = getCurrencyDef(currency || settings.currency);
  const previewLogo = brandLogo || '/logo_asm.png';
  const previewBrand = brandName || 'ASM';
  const previewCompany = companyName || 'Arabian Shield Manpower';

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
            <SettingsIcon className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              Settings
              <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30 gap-1">
                <Crown className="h-3 w-3" /> Super Admin only
              </Badge>
            </h2>
            <p className="text-slate-400 text-sm">Manage app-wide settings. Changes apply to every page instantly.</p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving || !dirty || !loaded}
          className={cn('h-9 gap-1.5 text-sm', dirty ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-700 text-slate-400 cursor-not-allowed')}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Apply Settings
        </Button>
      </div>

      {!loaded ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl bg-slate-700/50" />
          <Skeleton className="h-56 w-full rounded-xl bg-slate-700/50" />
        </div>
      ) : (
        <>
          {/* Branding */}
          <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-5">
            <div className="flex items-center gap-2 mb-1">
              <Palette className="h-4 w-4 text-purple-400" />
              <h3 className="text-base font-semibold text-white">Branding</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Company logo, glowing brand text and company name — shown in the sidebar, login and loading screens.
            </p>

            <div className="flex flex-col sm:flex-row gap-5">
              {/* Logo upload */}
              <div className="flex flex-col gap-2 shrink-0">
                <Label className="text-slate-300">Company logo</Label>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Upload logo"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void handleLogoFile(e.dataTransfer.files?.[0]);
                  }}
                  className="group relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-600 bg-slate-900/60 transition-colors hover:border-blue-500/60"
                >
                  { }
                  <img src={previewLogo} alt="Logo preview" className="h-full w-full object-contain p-1.5" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/70 opacity-0 transition-opacity group-hover:opacity-100">
                    {logoBusy ? (
                      <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                    ) : (
                      <>
                        <Upload className="h-5 w-5 text-blue-400" />
                        <span className="text-[10px] text-slate-300">Click or drop image</span>
                      </>
                    )}
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleLogoFile(e.target.files?.[0])}
                />
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px] text-slate-400 hover:text-white hover:bg-slate-700"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={logoBusy}
                  >
                    <ImageIcon className="h-3 w-3" /> Change
                  </Button>
                  {brandLogo !== '' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-[11px] text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                      onClick={() => patchDraft({ brandLogo: '' })}
                      title="Restore the default ASM logo"
                    >
                      <Trash2 className="h-3 w-3" /> Reset
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 max-w-24 text-center">PNG / JPG / WEBP — auto-resized to 256px</p>
              </div>

              {/* Text fields */}
              <div className="flex flex-1 flex-col gap-4 min-w-0">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="brandName" className="text-slate-300">
                    Brand text <span className="text-slate-500">(glowing short name)</span>
                  </Label>
                  <Input
                    id="brandName"
                    value={brandName}
                    onChange={(e) => patchDraft({ brandName: e.target.value })}
                    maxLength={24}
                    placeholder="ASM"
                    className="bg-slate-900 border-slate-700 text-white text-sm"
                  />
                  <p className="text-xs text-slate-500">The short glowing title, e.g. “ASM”. Max 24 characters.</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="companyName" className="text-slate-300">Company name</Label>
                  <Input
                    id="companyName"
                    value={companyName}
                    onChange={(e) => patchDraft({ companyName: e.target.value })}
                    maxLength={120}
                    placeholder="Arabian Shield Manpower"
                    className="bg-slate-900 border-slate-700 text-white text-sm"
                  />
                  <p className="text-xs text-slate-500">The full company name under the brand text.</p>
                </div>
              </div>
            </div>

            {/* Live sidebar preview */}
            <div className="mt-5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Sidebar preview</p>
              <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3">
                { }
                <img src={previewLogo} alt="Logo" className="h-10 w-10 rounded-lg object-contain shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="asm-gradient-text font-bold text-lg leading-tight truncate">{previewBrand}</span>
                  <span className="text-xs text-slate-400 truncate">{previewCompany}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Currency */}
          <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-5">
            <div className="flex items-center gap-2 mb-1">
              <Banknote className="h-4 w-4 text-emerald-400" />
              <h3 className="text-base font-semibold text-white">Currency</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Used by every money amount in the app — fines, salaries, advances, rates and dashboards.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CURRENCIES.map((c) => {
                const active = c.code === currency;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => patchDraft({ currency: c.code })}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors',
                      active
                        ? 'border-blue-500/60 bg-blue-500/10'
                        : 'border-slate-700 bg-slate-900/60 hover:border-slate-600 hover:bg-slate-800'
                    )}
                  >
                    <span className="flex flex-col min-w-0">
                      <span className={cn('text-sm font-semibold', active ? 'text-blue-300' : 'text-white')}>
                        {c.code}
                      </span>
                      <span className="text-[11px] text-slate-500 truncate">{c.name}</span>
                    </span>
                    <span className={cn('text-sm shrink-0 ml-2', active ? 'text-blue-300' : 'text-slate-400')}>
                      {c.symbol}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Live preview */}
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3">
              <Info className="h-4 w-4 text-slate-500 shrink-0" />
              <div className="text-sm">
                <span className="text-slate-400">Preview — a 500 fine will display as </span>
                <span className="font-mono font-semibold text-emerald-400">{formatMoney(500, currency)}</span>
                <span className="text-slate-500"> ({previewDef.name})</span>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
