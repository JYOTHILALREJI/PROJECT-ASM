'use client';

import React, { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Building2,
  Banknote,
  Check,
  Loader2,
  Crown,
  Info,
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

export function SettingsPage() {
  const { user } = useAuthStore();
  const { settings, loaded, fetchSettings, updateSettings } = useSettingsStore();

  // Local draft starts as null (inputs fall back to the server settings);
  // it becomes non-null the moment the user edits anything. This keeps the
  // draft in sync without setState-in-effect (lint-clean).
  const [draft, setDraft] = useState<{ companyName: string; currency: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const companyName = draft?.companyName ?? settings.companyName;
  const currency = draft?.currency ?? settings.currency;
  const setCompanyName = (v: string) => setDraft({ companyName: v, currency });
  const setCurrency = (v: string) => setDraft({ companyName, currency: v });

  const dirty = draft !== null && (companyName !== settings.companyName || currency !== settings.currency);

  const handleSave = async () => {
    if (!user?.id) return;
    if (!companyName.trim()) {
      toast({ title: 'Validation Error', description: 'Company name cannot be empty.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const result = await updateSettings({ companyName: companyName.trim(), currency }, user.id);
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
          {/* General */}
          <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="h-4 w-4 text-blue-400" />
              <h3 className="text-base font-semibold text-white">General</h3>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="companyName" className="text-slate-300">Company name</Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                maxLength={120}
                placeholder="Arabian Shield Manpower"
                className="bg-slate-900 border-slate-700 text-white text-sm"
              />
              <p className="text-xs text-slate-500">Shown in the sidebar branding across the app.</p>
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
                    onClick={() => setCurrency(c.code)}
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
