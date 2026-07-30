import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// Base Rate Helper
// ---------------------------------------------------------------------------
// Reads the singleton BaseRate record from the DB. If it doesn't exist,
// creates it with default values (2.5/5.0 for standard, 3.0/5.5 for TL/Sup).
//
// Used by all rate-calculation code paths instead of hardcoded values.
// ---------------------------------------------------------------------------

export interface BaseRates {
  standardLow: number;
  standardHigh: number;
  tlLow: number;
  tlHigh: number;
  supLow: number;
  supHigh: number;
}

const DEFAULT_RATES: BaseRates = {
  standardLow: 2.5,
  standardHigh: 5.0,
  tlLow: 3.0,
  tlHigh: 5.5,
  supLow: 3.0,
  supHigh: 5.5,
};

let cachedRates: BaseRates | null = null;

/**
 * Get the base rates from the DB. Uses an in-memory cache that is cleared
 * whenever the rates are updated via updateBaseRates().
 */
export async function getBaseRates(): Promise<BaseRates> {
  if (cachedRates) return cachedRates;

  try {
    // Check if db.baseRate exists (might not if prisma generate wasn't run)
    if (!db.baseRate) {
      return DEFAULT_RATES;
    }
    let record = await db.baseRate.findUnique({ where: { id: 'singleton' } });
    if (!record) {
      // Create with defaults
      record = await db.baseRate.create({ data: { id: 'singleton' } });
    }
    cachedRates = {
      standardLow: record.standardLow,
      standardHigh: record.standardHigh,
      tlLow: record.tlLow,
      tlHigh: record.tlHigh,
      supLow: record.supLow,
      supHigh: record.supHigh,
    };
    return cachedRates;
  } catch {
    // If BaseRate table doesn't exist yet (before prisma db push), use defaults
    return DEFAULT_RATES;
  }
}

/**
 * Update the base rates in the DB. Also clears the cache so the new values
 * are used immediately.
 */
export async function updateBaseRates(rates: BaseRates): Promise<void> {
  try {
    if (!db.baseRate) return; // BaseRate model not available
    await db.baseRate.upsert({
      where: { id: 'singleton' },
      update: {
        standardLow: rates.standardLow,
        standardHigh: rates.standardHigh,
        tlLow: rates.tlLow,
        tlHigh: rates.tlHigh,
        supLow: rates.supLow,
        supHigh: rates.supHigh,
      },
      create: {
        id: 'singleton',
        ...rates,
      },
    });
  } catch {
    // Table doesn't exist — ignore
  }
  cachedRates = rates; // Always update cache
}

/**
 * Get the low/high rates for an employee based on their role.
 * Uses BaseRate from DB (not hardcoded).
 */
export async function getRoleBasedRates(
  isTeamLeader: boolean,
  isSupervisor: boolean,
): Promise<{ lowRate: number; highRate: number }> {
  const base = await getBaseRates();
  if (isTeamLeader) return { lowRate: base.tlLow, highRate: base.tlHigh };
  if (isSupervisor) return { lowRate: base.supLow, highRate: base.supHigh };
  return { lowRate: base.standardLow, highRate: base.standardHigh };
}
