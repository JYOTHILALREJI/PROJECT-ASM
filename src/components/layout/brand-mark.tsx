'use client';

import React from 'react';
import { useSettingsStore } from '@/store/settings-store';
import { cn } from '@/lib/utils';

/**
 * BrandMark — the app-wide branding block (logo + glowing brand text +
 * optional company name) driven entirely by the Settings page:
 *   - brandLogo (data-URL; empty → bundled /logo_asm.png)
 *   - brandName (the short glowing text, default "ASM")
 *   - companyName (the subtitle)
 *
 * Every branding surface (sidebar, login, loading screen) renders through this
 * component so a single settings change rebrands the whole app instantly.
 * Each surface calls fetchSettings() on mount — the store de-duplicates the
 * request, and GET /api/settings is public so this also works pre-login.
 */
interface BrandMarkProps {
  /** Logo box size class, e.g. "h-10 w-10" or "h-14 w-14". */
  logoClassName?: string;
  /** Brand text size class, e.g. "text-lg" or "text-2xl". */
  textClassName?: string;
  /** Show the company name subtitle below the brand text. */
  showCompany?: boolean;
  /** Render the glowing text at all (false → logo-only, e.g. collapsed rail). */
  showText?: boolean;
  /** Company subtitle size class (defaults to text-xs). */
  companyClassName?: string;
  /** Stack vertically (login / loading) instead of a row (sidebar). */
  vertical?: boolean;
  className?: string;
}

export function BrandMark({
  logoClassName = 'h-10 w-10',
  textClassName = 'text-lg',
  showCompany = false,
  showText = true,
  companyClassName = 'text-xs',
  vertical = false,
  className,
}: BrandMarkProps) {
  const brandName = useSettingsStore((s) => s.settings.brandName);
  const brandLogo = useSettingsStore((s) => s.settings.brandLogo);
  const companyName = useSettingsStore((s) => s.settings.companyName);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);

  React.useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return (
    <div
      className={cn(
        'flex min-w-0',
        vertical ? 'flex-col items-center gap-2' : 'items-center gap-3',
        className
      )}
    >
      { }
      <img
        src={brandLogo || '/logo_asm.png'}
        alt={brandName || 'ASM'}
        className={cn('rounded-lg object-contain shrink-0', logoClassName)}
      />
      {showText && (
        <div className={cn('flex min-w-0', vertical ? 'flex-col items-center gap-1' : 'flex-col')}>
          <span className={cn('asm-gradient-text font-bold leading-tight truncate', textClassName)}>
            {brandName || 'ASM'}
          </span>
          {showCompany && (
            <span className={cn('text-slate-400 truncate', companyClassName)}>
              {companyName || 'Arabian Shield Manpower'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
