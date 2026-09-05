'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Settings as SettingsIcon,
  Building2,
  Banknote,
  Check,
  Loader2,
  Crown,
  Info,
  Palette,
  Sparkles,
  Upload,
  Trash2,
  ImageIcon,
  KeyRound,
  Globe,
  Cpu,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth-store';
import { useSettingsStore, type AppSettings } from '@/store/settings-store';
import { CURRENCIES, formatMoney, getCurrencyDef } from '@/lib/currency';
import { RoboFace } from '@/components/ai/robo-face';

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
    aiName: string;
    aiBaseUrl: string;
    aiModel: string;
  } | null>(null);
  // Model-provider key handling: keyInput holds a NEWLY TYPED key (the saved
  // one is never sent back to the client — only a mask). keyRemoved marks an
  // explicit "remove the saved key" action. On Apply:
  //   keyInput non-empty → save that key; else keyRemoved → clear; else omit.
  const [keyInput, setKeyInput] = useState('');
  const [keyRemoved, setKeyRemoved] = useState(false);
  // Searchable model dropdown fed from the provider's /models endpoint.
  const [models, setModels] = useState<string[]>([]);
  const [modelsState, setModelsState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [modelsError, setModelsError] = useState('');
  const [modelsOpen, setModelsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const companyName = draft?.companyName ?? settings.companyName;
  const brandName = draft?.brandName ?? settings.brandName;
  const brandLogo = draft?.brandLogo ?? settings.brandLogo;
  const currency = draft?.currency ?? settings.currency;
  const aiName = draft?.aiName ?? settings.aiName;
  const aiBaseUrl = draft?.aiBaseUrl ?? settings.aiBaseUrl;
  const aiModel = draft?.aiModel ?? settings.aiModel;
  const patchDraft = (patch: Partial<{ companyName: string; brandName: string; brandLogo: string; currency: string; aiName: string; aiBaseUrl: string; aiModel: string }>) =>
    setDraft({
      companyName: patch.companyName ?? companyName,
      brandName: patch.brandName ?? brandName,
      brandLogo: patch.brandLogo ?? brandLogo,
      currency: patch.currency ?? currency,
      aiName: patch.aiName ?? aiName,
      aiBaseUrl: patch.aiBaseUrl ?? aiBaseUrl,
      aiModel: patch.aiModel ?? aiModel,
    });

  const keyDirty = keyInput.trim() !== '' || keyRemoved;
  // The AI Assistant card (assistant name + model provider) has its OWN save
  // button, so the super admin can apply AI changes without touching branding.
  const aiDirty =
    (draft !== null &&
      (aiName !== settings.aiName || aiBaseUrl !== settings.aiBaseUrl || aiModel !== settings.aiModel)) ||
    keyDirty;
  const brandingDirty =
    draft !== null &&
    (companyName !== settings.companyName ||
      brandName !== settings.brandName ||
      brandLogo !== settings.brandLogo ||
      currency !== settings.currency);
  const dirty = brandingDirty || aiDirty;

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

  /** Shared persistence — every save path funnels through the store call. */
  const persist = async (payload: Partial<Omit<AppSettings, 'aiApiKeyMasked'>> & { aiApiKey?: string }) => {
    if (!user?.id) return { success: false, error: 'Not signed in' };
    return updateSettings(payload, user.id);
  };

  const validateAi = (): string | null => {
    if (!aiName.trim()) return 'Assistant name cannot be empty.';
    if (aiBaseUrl.trim() && !/^https?:\/\//i.test(aiBaseUrl.trim())) return 'Base URL must start with http:// or https://';
    return null;
  };

  /** Reset ONLY the AI parts of the draft — branding edits stay untouched. */
  const resetAiDraft = () => {
    const s = useSettingsStore.getState().settings;
    setDraft((d) => (d ? { ...d, aiName: s.aiName, aiBaseUrl: s.aiBaseUrl, aiModel: s.aiModel } : null));
    setKeyInput('');
    setKeyRemoved(false);
    setModelsState('idle');
    setModels([]);
    setModelsOpen(false);
    setModelsError('');
  };

  const buildAiPayload = (): Partial<Omit<AppSettings, 'aiApiKeyMasked'>> & { aiApiKey?: string } => {
    const payload: Partial<Omit<AppSettings, 'aiApiKeyMasked'>> & { aiApiKey?: string } = {
      aiName: aiName.trim(),
      aiBaseUrl: aiBaseUrl.trim(),
      aiModel: aiModel.trim(),
    };
    // Only touch the saved key when the user typed a new one or removed it —
    // the masked value from GET must never be written back.
    if (keyInput.trim()) payload.aiApiKey = keyInput.trim();
    else if (keyRemoved) payload.aiApiKey = '';
    return payload;
  };

  /** Dedicated save for the AI Assistant card (name + model provider + key). */
  const handleSaveAi = async () => {
    const problem = validateAi();
    if (problem) {
      toast({ title: 'Validation Error', description: problem, variant: 'destructive' });
      return;
    }
    setSavingAi(true);
    const result = await persist(buildAiPayload());
    setSavingAi(false);
    if (result.success) {
      resetAiDraft();
      toast({
        title: 'AI Settings Applied',
        description: 'The assistant name and model provider are now live.',
      });
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to save AI settings', variant: 'destructive' });
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
    const aiProblem = validateAi();
    if (aiProblem) {
      toast({ title: 'Validation Error', description: aiProblem, variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      companyName: companyName.trim(),
      brandName: brandName.trim(),
      brandLogo,
      currency,
      ...buildAiPayload(),
    };
    const result = await persist(payload);
    setSaving(false);
    if (result.success) {
      setDraft(null); // re-sync the form with the persisted settings
      setKeyInput('');
      setKeyRemoved(false);
      setModelsState('idle');
      setModels([]);
      setModelsOpen(false);
      setModelsError('');
      toast({
        title: 'Settings Applied',
        description: 'Your changes are now live across every page of the app.',
      });
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to save settings', variant: 'destructive' });
    }
  };

  // Fetch the model list from the provider so the user can pick a model from
  // a searchable dropdown. Uses the key/base URL typed right now when present
  // (the saved key is masked, so it is re-entered to test a replacement).
  const handleLoadModels = async () => {
    if (!user?.id) return;
    setModelsState('loading');
    setModelsError('');
    try {
      const body: Record<string, string> = { userId: user.id };
      if (keyInput.trim()) body.apiKey = keyInput.trim();
      if (aiBaseUrl.trim()) body.baseUrl = aiBaseUrl.trim();
      const res = await fetch('/api/ai/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.models)) {
        setModels(data.data.models as string[]);
        setModelsState('loaded');
        setModelsOpen(true);
        if (data.data.models.length === 0) {
          setModelsError('The provider returned an empty model list.');
        }
      } else {
        setModels([]);
        setModelsState('error');
        setModelsError(data.error || 'Could not load the model list.');
      }
    } catch {
      setModelsState('error');
      setModelsError('Could not reach the server. Please try again.');
    }
  };

  const filteredModels = useMemo(() => {
    const q = aiModel.trim().toLowerCase();
    const list = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
    return list.slice(0, 300);
  }, [models, aiModel]);
  const keyActive = keyInput.trim() !== '' || (!!settings.aiApiKeyMasked && !keyRemoved);

  const previewDef = getCurrencyDef(currency || settings.currency);
  const previewLogo = brandLogo || '/logo_asm.png';
  const previewBrand = brandName || 'ASM';
  const previewCompany = companyName || 'Arabian Shield Manpower';
  const previewAiName = aiName || 'Nova';

  return (
    <div className="flex w-full max-w-6xl flex-col gap-6">
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
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
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

          {/* AI Assistant — full width: identity on the left, model provider on the right */}
          <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-5 xl:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-400" />
                <h3 className="text-base font-semibold text-white">AI Assistant</h3>
              </div>
              {/* Dedicated save for THIS card only — the assistant name, model
                  provider and API key can be applied without touching branding. */}
              <Button
                onClick={handleSaveAi}
                disabled={savingAi || !aiDirty || !loaded}
                className={cn(
                  'h-8 gap-1.5 text-xs',
                  aiDirty ? 'bg-cyan-600 hover:bg-cyan-700 text-white' : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                )}
              >
                {savingAi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save AI settings
              </Button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Give your floating robot companion a name — it appears in the chat header, greetings and every reply.
            </p>

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
              {/* Identity (left column) */}
              <div className="flex flex-col sm:flex-row gap-5">
                {/* Live robo preview */}
                <div className="flex flex-col items-center gap-2 shrink-0 sm:w-24">
                  <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60">
                    <RoboFace size={64} status="idle" />
                  </div>
                  <p className="text-[10px] text-slate-500">Live preview</p>
                </div>

                <div className="flex flex-1 flex-col gap-4 min-w-0">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="aiName" className="text-slate-300">
                      Assistant name
                    </Label>
                    <Input
                      id="aiName"
                      value={aiName}
                      onChange={(e) => patchDraft({ aiName: e.target.value })}
                      maxLength={24}
                      placeholder="Nova"
                      className="bg-slate-900 border-slate-700 text-white text-sm"
                    />
                    <p className="text-xs text-slate-500">
                      Something cute and personal, e.g. “Nova”, “Robi” or “Zippy”. Max 24 characters.
                    </p>
                  </div>

                  {/* Chat preview */}
                  <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Chat preview</p>
                    <div className="flex items-start gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-500/15">
                        <RoboFace size={22} status="idle" />
                      </div>
                      <div className="rounded-2xl rounded-bl-md border border-slate-600/60 bg-slate-700/50 px-3 py-1.5 text-xs text-slate-100">
                        Hi, I&apos;m <span className="font-semibold text-white">{previewAiName}</span> 👋 — we have
                        everything about the workforce covered. Ask me anything!
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Model provider (right column) */}
              <div className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-700/50 bg-slate-900/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <KeyRound className="h-4 w-4 text-cyan-400" />
                  <h4 className="text-sm font-semibold text-white">Model provider</h4>
                  <Badge variant="outline" className="border-slate-600 text-[10px] text-slate-400">
                    bring your own LLM
                  </Badge>
                </div>
                <p className="text-xs text-slate-500">
                  Connect any OpenAI-compatible provider (OpenAI, Groq, OpenRouter, DeepSeek, Ollama, LM Studio…).
                  While no key is saved, the assistant uses the built-in provider.
                </p>

                {/* API key */}
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor="aiApiKey" className="text-slate-300">API key</Label>
                    {settings.aiApiKeyMasked && !keyRemoved && !keyInput.trim() && (
                      <Badge className="border border-emerald-500/30 bg-emerald-500/15 text-[10px] text-emerald-300 gap-1">
                        <Check className="h-3 w-3" /> Saved {settings.aiApiKeyMasked}
                      </Badge>
                    )}
                    {!!keyInput.trim() && (
                      <Badge className="border border-amber-500/30 bg-amber-500/15 text-[10px] text-amber-300">
                        typed — not saved yet
                      </Badge>
                    )}
                    {keyRemoved && (
                      <Badge className="border border-red-500/30 bg-red-500/15 text-[10px] text-red-300">
                        will be removed on save
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="aiApiKey"
                      type="password"
                      autoComplete="off"
                      value={keyInput}
                      onChange={(e) => {
                        setKeyInput(e.target.value);
                        if (e.target.value) setKeyRemoved(false);
                      }}
                      placeholder={
                        settings.aiApiKeyMasked && !keyRemoved
                          ? `Saved ${settings.aiApiKeyMasked} — type to replace`
                          : 'Paste your API key'
                      }
                      className="bg-slate-900 border-slate-700 text-white text-sm"
                    />
                    {settings.aiApiKeyMasked && !keyInput && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 shrink-0 gap-1 px-2 text-[11px] text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                        onClick={() => setKeyRemoved(true)}
                        title="Remove the saved key — the assistant falls back to the built-in provider"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </Button>
                    )}
                    {keyRemoved && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 shrink-0 gap-1 px-2 text-[11px] text-amber-400 hover:text-amber-300"
                        onClick={() => setKeyRemoved(false)}
                        title="Keep the saved key after all"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Keep saved key
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Stored server-side only — shown back to you masked ({settings.aiApiKeyMasked || 'not saved yet'}).
                  </p>
                </div>

                {/* Base URL */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="aiBaseUrl" className="text-slate-300">
                    Base URL <span className="text-slate-500">(optional)</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 shrink-0 text-slate-500" />
                    <Input
                      id="aiBaseUrl"
                      value={aiBaseUrl}
                      onChange={(e) => patchDraft({ aiBaseUrl: e.target.value })}
                      maxLength={200}
                      placeholder="https://api.openai.com/v1"
                      className="bg-slate-900 border-slate-700 text-white text-sm"
                    />
                  </div>
                  <p className="text-xs text-slate-500">Empty = OpenAI default endpoint.</p>
                </div>

                {/* Model — searchable dropdown fed from the provider */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="aiModel" className="text-slate-300">Model</Label>
                  <div className="flex gap-2">
                    <Input
                      id="aiModel"
                      value={aiModel}
                      onChange={(e) => {
                        patchDraft({ aiModel: e.target.value });
                        if (models.length > 0) setModelsOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setModelsOpen(false);
                      }}
                      maxLength={120}
                      autoComplete="off"
                      placeholder="e.g. gpt-4o-mini — or search the list"
                      className="bg-slate-900 border-slate-700 text-white text-sm"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 gap-1.5 border-slate-600 bg-slate-800 text-xs text-slate-200 hover:bg-slate-700"
                      onClick={() => void handleLoadModels()}
                      disabled={modelsState === 'loading'}
                    >
                      {modelsState === 'loading' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Load models
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 shrink-0 px-2 text-slate-400 hover:text-white"
                      onClick={() => setModelsOpen((o) => !o)}
                      disabled={models.length === 0}
                      title={models.length > 0 ? 'Show the model list' : 'Load models first'}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                  {modelsState === 'error' && (
                    <p className="text-xs text-red-400">{modelsError}</p>
                  )}
                  {modelsOpen && models.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/40">
                      {filteredModels.length === 0 ? (
                        <p className="px-3 py-2.5 text-xs text-slate-500">
                          No models match “{aiModel}” — you can still Apply this name if you know it exists.
                        </p>
                      ) : (
                        filteredModels.map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => {
                              patchDraft({ aiModel: m });
                              setModelsOpen(false);
                            }}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors',
                              m === aiModel ? 'bg-blue-500/15 text-blue-200' : 'text-slate-200 hover:bg-slate-800'
                            )}
                          >
                            <span className="truncate font-mono text-xs">{m}</span>
                            {m === aiModel && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  <p className="text-xs text-slate-500">
                    {models.length > 0
                      ? `${models.length} models loaded — type above to search, click to select.`
                      : 'Load models from the provider with the pasted key, or type a model name manually.'}
                  </p>
                </div>

                {/* Effective provider status */}
                <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
                  <Cpu className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                  {keyActive ? (
                    <p className="text-xs text-slate-300">
                      Requests will use <span className="font-semibold text-white">{aiModel.trim() || 'the provider default model'}</span>
                      {' '}via <span className="font-mono text-slate-400">{aiBaseUrl.trim() || 'https://api.openai.com/v1'}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400">No key saved — the assistant uses the built-in provider.</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
