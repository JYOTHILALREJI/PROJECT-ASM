// ---------------------------------------------------------------------------
// rate-resolver.ts
// ---------------------------------------------------------------------------
// THE single source of truth for employee rate resolution.
//
// Hierarchy (applied in this order):
//   1. Rate changelog override (per-month) — if a changelog entry exists
//      with effectiveMonth <= the requested month, its rate wins.
//   2. Employee.customHourlyRate — if set, this is the ONLY rate used.
//   3. Trade rate (from EmployeeTrade → TradeRate.hourlyRate) + 0.5 bonus
//      if the employee is a Team Leader or Supervisor.
//   4. Base rate (from BaseRate singleton in DB: baseLow below threshold;
//      helperHigh above threshold for Helpers, tradeHigh for other trades)
//      — fallback for employees with no custom rate and no trade rate.
//
// Every page and every calculation involving rates MUST call one of the
// functions in this file. Do NOT re-implement the priority logic inline.
// ---------------------------------------------------------------------------

import { db } from '@/lib/db';
import { getBaseRates, getTradeBasedRates, type BaseRates } from '@/lib/base-rates';
import { buildTradeRateMap } from '@/lib/recalculation';
import { buildEmployeeTradeMap, type EmployeeTradeInfo } from '@/lib/employee-trade';
import { getRateForMonth, getRateMapForMonth } from '@/lib/rate-changelog';
import { isHelperTrade } from '@/lib/trade-utils';

export interface ResolvedRate {
  lowRate: number;
  highRate: number;
  isCustom: boolean;
  source: 'changelog' | 'custom' | 'trade' | 'base';
}

export interface EmployeeRateInput {
  id: string;
  customHourlyRate: number | null;
  isTeamLeader: boolean;
  isSupervisor: boolean;
  trade?: string | null;
}

// ─── Internal helper: apply the 3-tier priority (no changelog) ───────────

function applyPriority(
  customRate: number | null,
  tradeRate: number | null,
  isTeamLeader: boolean,
  isSupervisor: boolean,
  baseRates: BaseRates,
  isHelper: boolean,
): ResolvedRate {
  const hasBonus = isTeamLeader || isSupervisor;

  // 2. Custom rate
  if (customRate !== null && customRate !== undefined && Number.isFinite(customRate)) {
    return {
      lowRate: customRate,
      highRate: customRate,
      isCustom: true,
      source: 'custom',
    };
  }

  // 3. Trade rate (+0.5 if TL/Sup)
  if (tradeRate !== null && tradeRate > 0) {
    const effectiveRate = hasBonus ? tradeRate + 0.5 : tradeRate;
    return {
      lowRate: effectiveRate,
      highRate: effectiveRate,
      isCustom: true,
      source: 'trade',
    };
  }

  // 4. Base rate from DB — below threshold: baseLow for everyone.
  //    Above threshold: helperHigh for Helpers, tradeHigh for other trades.
  const { lowRate, highRate } = getTradeBasedRates(isHelper, baseRates);
  return {
    lowRate,
    highRate,
    isCustom: false,
    source: 'base',
  };
}

// ─── Single-employee, single-month resolver (async, includes changelog) ──

/**
 * Resolve the rate for ONE employee in ONE month.
 *
 * This is the canonical resolver. It:
 *   1. Checks the rate changelog for a per-month override
 *   2. Falls back to Employee.customHourlyRate
 *   3. Falls back to TradeRate (+0.5 if TL/Sup)
 *   4. Falls back to BaseRate from DB (baseLow / helperHigh / tradeHigh)
 *
 * Use this when you need the rate for a single employee+month.
 * For bulk lookups (e.g. /api/accounts), use resolveRateMapForMonth instead.
 */
export async function resolveEmployeeRate(
  employee: EmployeeRateInput,
  monthKey: string,
  options?: {
    tradeRateMap?: Map<string, number>;
    employeeTradeMap?: Map<string, EmployeeTradeInfo>;
    baseRates?: BaseRates;
    /** Override the custom rate (e.g. from a pre-fetched changelog map) */
    customRateOverride?: number | null;
    /** Override the trade rate (e.g. from a pre-fetched map) */
    tradeRateOverride?: number | null;
  },
): Promise<ResolvedRate> {
  const baseRates = options?.baseRates ?? await getBaseRates();

  // Determine the effective custom rate (changelog override > employee.customHourlyRate)
  let effectiveCustomRate = employee.customHourlyRate;

  // If a changelog override is provided, use it; otherwise look it up
  if (options?.customRateOverride !== undefined) {
    effectiveCustomRate = options.customRateOverride;
  } else {
    const changelogRate = await getRateForMonth(employee.id, monthKey);
    if (changelogRate.rate !== null) {
      effectiveCustomRate = changelogRate.rate;
    }
  }

  // If changelog overrode the custom rate, it wins immediately
  if (effectiveCustomRate !== null && effectiveCustomRate !== employee.customHourlyRate) {
    return {
      lowRate: effectiveCustomRate,
      highRate: effectiveCustomRate,
      isCustom: true,
      source: 'changelog',
    };
  }

  // Determine the trade rate
  let tradeRate: number | null = null;
  let effectiveTrade = employee.trade ?? null;
  if (options?.tradeRateOverride !== undefined) {
    tradeRate = options.tradeRateOverride;
  } else {
    // Use the employee's trade if provided, or look it up from EmployeeTradeMap
    if (!effectiveTrade && options?.employeeTradeMap) {
      const tradeInfo = options.employeeTradeMap.get(employee.id);
      if (tradeInfo) {
        effectiveTrade = tradeInfo.trade;
        tradeRate = tradeInfo.hourlyRate;
      }
    }
    if (effectiveTrade && tradeRate === null && options?.tradeRateMap) {
      tradeRate = options.tradeRateMap.get(effectiveTrade) ?? null;
    }
    // If trade is "Helper", tradeRate stays null (falls through to base rate)
    if (isHelperTrade(effectiveTrade)) {
      tradeRate = null;
    }
  }

  return applyPriority(
    effectiveCustomRate,
    tradeRate,
    employee.isTeamLeader,
    employee.isSupervisor,
    baseRates,
    isHelperTrade(effectiveTrade),
  );
}

// ─── Bulk resolver: many employees, one month ────────────────────────────

/**
 * Resolve rates for MULTIPLE employees in a SINGLE month.
 *
 * More efficient than calling resolveEmployeeRate N times because it
 * bulk-fetches the changelog map and reuses the trade/base rate maps.
 *
 * Returns a Map<employeeId, ResolvedRate>.
 */
export async function resolveRateMapForMonth(
  employees: EmployeeRateInput[],
  monthKey: string,
  options?: {
    tradeRateMap?: Map<string, number>;
    employeeTradeMap?: Map<string, EmployeeTradeInfo>;
    baseRates?: BaseRates;
    /** Pre-fetched changelog map (employeeId → rate|null) for the month */
    changelogRateMap?: Map<string, number | null>;
  },
): Promise<Map<string, ResolvedRate>> {
  const result = new Map<string, ResolvedRate>();
  if (employees.length === 0) return result;

  const baseRates = options?.baseRates ?? await getBaseRates();
  const employeeIds = employees.map((e) => e.id);

  // Bulk-fetch changelog rates if not provided
  let changelogRateMap = options?.changelogRateMap;
  if (!changelogRateMap) {
    changelogRateMap = await getRateMapForMonth(employeeIds, monthKey);
  }

  for (const emp of employees) {
    const changelogRate = changelogRateMap.get(emp.id) ?? null;

    // If changelog has a rate, it overrides everything
    if (changelogRate !== null) {
      result.set(emp.id, {
        lowRate: changelogRate,
        highRate: changelogRate,
        isCustom: true,
        source: 'changelog',
      });
      continue;
    }

    // Resolve trade rate
    let tradeRate: number | null = null;
    let effectiveTrade = emp.trade ?? null;
    if (!effectiveTrade && options?.employeeTradeMap) {
      const tradeInfo = options.employeeTradeMap.get(emp.id);
      if (tradeInfo) {
        effectiveTrade = tradeInfo.trade;
        tradeRate = tradeInfo.hourlyRate;
      }
    }
    if (effectiveTrade && tradeRate === null && options?.tradeRateMap) {
      tradeRate = options.tradeRateMap.get(effectiveTrade) ?? null;
    }
    if (isHelperTrade(effectiveTrade)) {
      tradeRate = null;
    }

    result.set(
      emp.id,
      applyPriority(
        emp.customHourlyRate,
        tradeRate,
        emp.isTeamLeader,
        emp.isSupervisor,
        baseRates,
        isHelperTrade(effectiveTrade),
      ),
    );
  }

  return result;
}

// ─── Synchronous resolver (no changelog, no DB calls) ────────────────────

/**
 * Resolve the rate WITHOUT any DB calls or changelog lookup.
 *
 * Use this when:
 *   - You already have the custom rate, trade rate, and base rates
 *   - The changelog override has already been applied (the caller already
 *     resolved the effective custom rate)
 *   - You're in a client-side component that received all data from the API
 *
 * This is the pure priority function:
 *   Custom > Trade(+0.5) > BaseRate (baseLow below; helperHigh/tradeHigh above)
 *
 * @param isHelper Whether the employee's effective trade is "Helper".
 *                 Determines the above-threshold premium (6.0 vs 7.0).
 */
export function resolveRateSync(
  customRate: number | null,
  tradeRate: number | null,
  isTeamLeader: boolean,
  isSupervisor: boolean,
  baseRates: BaseRates,
  isHelper: boolean,
): ResolvedRate {
  return applyPriority(
    customRate,
    tradeRate,
    isTeamLeader,
    isSupervisor,
    baseRates,
    isHelper,
  );
}

// ─── Re-export the helpers so callers can import everything from here ─────

export { getBaseRates, getTradeBasedRates, buildTradeRateMap, buildEmployeeTradeMap, getRateForMonth, getRateMapForMonth };
export type { BaseRates, EmployeeTradeInfo };
