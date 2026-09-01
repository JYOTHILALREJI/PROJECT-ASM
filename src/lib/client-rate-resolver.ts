// ---------------------------------------------------------------------------
// client-rate-resolver.ts
// ---------------------------------------------------------------------------
// Client-side rate resolution helper. This is the CLIENT-SIDE equivalent
// of src/lib/rate-resolver.ts (which is server-side).
//
// The priority logic is IDENTICAL to the server-side resolver:
//   1. Custom rate (from changelog override or employee.customHourlyRate)
//   2. Trade rate (from EmployeeTrade.hourlyRate) + 0.5 if TL/Sup
//   3. Base rate (from BaseRate singleton, passed in from the parent):
//      baseLow below threshold; helperHigh above threshold for Helpers,
//      tradeHigh above threshold for other trades.
//
// This file exists because client components can't import server-side
// modules that use `db` or `getBaseRates()`. The base rates must be
// fetched by the parent and passed in.
//
// EVERY client-side component that computes rates MUST use this function.
// Do NOT re-implement the priority logic inline.
// ---------------------------------------------------------------------------

import { isHelperTrade } from '@/lib/trade-utils';

export interface ClientBaseRates {
  /** Below-threshold base rate — applies to every employee */
  baseLow: number;
  /** Above-threshold premium rate for Helpers */
  helperHigh: number;
  /** Above-threshold premium rate for other trades */
  tradeHigh: number;
}

export interface ClientResolvedRate {
  lowRate: number;
  highRate: number;
  isCustom: boolean;
  source: 'custom' | 'trade' | 'base';
}

/** Default base rates — mirrors DEFAULT_RATES in src/lib/base-rates.ts */
export const DEFAULT_CLIENT_BASE_RATES: ClientBaseRates = {
  baseLow: 3.5,
  helperHigh: 6.0,
  tradeHigh: 7.0,
};

/**
 * Resolve the rate for an employee on the client side.
 *
 * Priority: Custom > Trade(+0.5 if TL/Sup) > BaseRate
 *
 * @param customRate   - The employee's customHourlyRate (or changelog override
 *                       if the server already resolved it into this field)
 * @param tradeRate    - The employee's trade hourly rate (from EmployeeTrade)
 * @param isTeamLeader - Whether the employee is a Team Leader
 * @param isSupervisor - Whether the employee is a Supervisor
 * @param baseRates    - The DB-configured base rates (fetched via /api/base-rates)
 * @param trade        - The employee's effective trade name (used to decide
 *                       helper vs trade premium above the threshold)
 */
export function resolveClientRate(
  customRate: number | null,
  tradeRate: number | null,
  isTeamLeader: boolean,
  isSupervisor: boolean,
  baseRates: ClientBaseRates | null,
  trade: string | null | undefined,
): ClientResolvedRate {
  const hasBonus = isTeamLeader || isSupervisor;

  // Default base rates if not yet loaded
  const br: ClientBaseRates = baseRates ?? DEFAULT_CLIENT_BASE_RATES;

  // 1. Custom rate — highest priority
  if (customRate !== null && customRate !== undefined && Number.isFinite(customRate)) {
    return {
      lowRate: customRate,
      highRate: customRate,
      isCustom: true,
      source: 'custom',
    };
  }

  // 2. Trade rate (+0.5 if TL/Sup)
  if (tradeRate !== null && tradeRate > 0) {
    const effectiveRate = hasBonus ? tradeRate + 0.5 : tradeRate;
    return {
      lowRate: effectiveRate,
      highRate: effectiveRate,
      isCustom: true,
      source: 'trade',
    };
  }

  // 3. Base rate from DB — below threshold: baseLow for everyone.
  //    Above threshold: helperHigh for Helpers, tradeHigh for other trades.
  const isHelper = isHelperTrade(trade);
  return {
    lowRate: br.baseLow,
    highRate: isHelper ? br.helperHigh : br.tradeHigh,
    isCustom: false,
    source: 'base',
  };
}
