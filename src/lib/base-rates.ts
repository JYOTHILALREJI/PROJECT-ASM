import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// Base Rate Helper
// ---------------------------------------------------------------------------
// Reads the singleton BaseRate record from the DB. If it doesn't exist,
// creates it with default values:
//   baseLow    = 3.5  → below-threshold rate for EVERY employee
//   helperHigh = 6.0  → above-threshold rate for Helpers
//   tradeHigh  = 7.0  → above-threshold rate for other trades
//
// Used by all rate-calculation code paths instead of hardcoded values.
// ---------------------------------------------------------------------------

export interface BaseRates {
  /** Below-threshold base rate — applies to every employee */
  baseLow: number;
  /** Above-threshold premium rate for Helpers */
  helperHigh: number;
  /** Above-threshold premium rate for other trades */
  tradeHigh: number;
}

export const DEFAULT_RATES: BaseRates = {
  baseLow: 3.5,
  helperHigh: 6.0,
  tradeHigh: 7.0,
};

let cachedRates: BaseRates | null = null;

/**
 * Get the base rates from the DB. Uses an in-memory cache that is cleared
 * whenever the rates are updated via updateBaseRates().
 */
export async function getBaseRates(): Promise<BaseRates> {
  if (cachedRates) return cachedRates;

  try {
    let record = await db.baseRate.findUnique({ where: { id: 'singleton' } });
    if (!record) {
      // Create with defaults
      record = await db.baseRate.create({ data: { id: 'singleton' } });
    }
    cachedRates = {
      baseLow: Number(record.baseLow) || DEFAULT_RATES.baseLow,
      helperHigh: Number(record.helperHigh) || DEFAULT_RATES.helperHigh,
      tradeHigh: Number(record.tradeHigh) || DEFAULT_RATES.tradeHigh,
    };
    return cachedRates;
  } catch {
    // If BaseRate table doesn't exist yet (before prisma db push), use defaults
    return { ...DEFAULT_RATES };
  }
}

/**
 * Update the base rates in the DB. Also clears the cache so the new values
 * are used immediately.
 */
export async function updateBaseRates(rates: BaseRates): Promise<void> {
  const safeRates: BaseRates = {
    baseLow: Number(rates.baseLow) || DEFAULT_RATES.baseLow,
    helperHigh: Number(rates.helperHigh) || DEFAULT_RATES.helperHigh,
    tradeHigh: Number(rates.tradeHigh) || DEFAULT_RATES.tradeHigh,
  };
  try {
    await db.baseRate.upsert({
      where: { id: 'singleton' },
      update: {
        baseLow: safeRates.baseLow,
        helperHigh: safeRates.helperHigh,
        tradeHigh: safeRates.tradeHigh,
      },
      create: {
        id: 'singleton',
        ...safeRates,
      },
    });
  } catch {
    // Table doesn't exist — ignore
  }
  cachedRates = safeRates; // Always update cache
}

/**
 * Get the low/high rates for an employee based on their trade.
 *   - Below threshold: baseLow (same for everyone)
 *   - Above threshold: helperHigh for Helpers, tradeHigh for other trades
 */
export function getTradeBasedRates(
  isHelper: boolean,
  baseRates: BaseRates,
): { lowRate: number; highRate: number } {
  return {
    lowRate: baseRates.baseLow,
    highRate: isHelper ? baseRates.helperHigh : baseRates.tradeHigh,
  };
}
