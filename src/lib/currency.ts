// Global currency support — driven by the AppSetting "currency" key which the
// super admin manages from the Settings page. Every money amount in the app
// is formatted through formatMoney() so a single setting switches the whole
// system (fines, salaries, advances, rates, dashboards, exports).

export interface CurrencyDef {
  code: string;
  name: string;
  symbol: string;
  locale: string;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', locale: 'en-AE' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س', locale: 'en-SA' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق', locale: 'en-QA' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك', locale: 'en-KW' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب', locale: 'en-BH' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع.', locale: 'en-OM' },
  { code: 'USD', name: 'US Dollar', symbol: '$', locale: 'en-US' },
  { code: 'EUR', name: 'Euro', symbol: '€', locale: 'de-DE' },
  { code: 'GBP', name: 'British Pound', symbol: '£', locale: 'en-GB' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', locale: 'en-IN' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', locale: 'en-PK' },
];

export const DEFAULT_CURRENCY = 'AED';

export function getCurrencyDef(code: string | null | undefined): CurrencyDef {
  return CURRENCIES.find((c) => c.code === code) || CURRENCIES[0]; // falls back to AED
}

/**
 * Format an amount in the given currency, e.g. formatMoney(1500, 'AED')
 * → "AED 1,500.00". Amount-only formatting (digits) is shared so callers
 * can compose their own layouts like "1,500.00 AED/hr".
 */
export function formatMoney(amount: number, code?: string | null, opts?: { decimals?: number }): string {
  const def = getCurrencyDef(code);
  const decimals = opts?.decimals ?? 2;
  const digits = amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${def.code} ${digits}`;
}

/** Just the numeric part: "1,500.00" */
export function formatAmount(amount: number, decimals = 2): string {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
