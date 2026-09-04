'use client';

import { create } from 'zustand';
import { DEFAULT_CURRENCY } from '@/lib/currency';

export interface AppSettings {
  /** Display currency used by every money amount in the app (fines, salaries, advances, rates). */
  currency: string;
  /** Company name shown in the sidebar / branding. */
  companyName: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  currency: DEFAULT_CURRENCY, // AED — dirhams by default
  companyName: 'Arabian Shield Manpower',
};

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  loading: boolean;
  /** Load settings from the server (no-op once loaded, unless force). */
  fetchSettings: (force?: boolean) => Promise<void>;
  /** Super-admin only: persist new settings and apply them instantly. */
  updateSettings: (patch: Partial<AppSettings>, userId: string) => Promise<{ success: boolean; error?: string }>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  loading: false,

  fetchSettings: async (force = false) => {
    if (get().loading || (get().loaded && !force)) return;
    set({ loading: true });
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      const data = await res.json();
      if (data.success && data.data?.settings) {
        set({ settings: { ...DEFAULT_SETTINGS, ...data.data.settings }, loaded: true });
      }
    } catch {
      // keep defaults on failure — the app remains fully usable
    } finally {
      set({ loading: false });
    }
  },

  updateSettings: async (patch, userId) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, settings: patch }),
      });
      const data = await res.json();
      if (data.success && data.data?.settings) {
        set({ settings: { ...DEFAULT_SETTINGS, ...data.data.settings }, loaded: true });
        // Let every open page re-read money formatting instantly.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('asm:settings-updated'));
        }
        return { success: true };
      }
      return { success: false, error: data.error || 'Failed to save settings' };
    } catch {
      return { success: false, error: 'Failed to save settings' };
    }
  },
}));
