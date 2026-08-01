// ---------------------------------------------------------------------------
// client-rate-resolver.ts
// ---------------------------------------------------------------------------
// Client-side rate resolution helper. This is the CLIENT-SIDE equivalent
// of src/lib/rate-resolver.ts (which is server-side).
//
// The priority logic is IDENTICAL to the server-side resolver:
//   1. Custom rate (from changelog override or employee.customHourlyRate)
//   2. Trade rate (from EmployeeTrade.hourlyRate) + 0.5 if TL/Sup
//   3. Base rate (from BaseRate singleton, passed in from the parent)
//
// This file exists because client components can't import server-side
// modules that use `db` or `getBaseRates()`. The base rates must be
// fetched by the parent and passed in.
//
// EVERY client-side component that computes rates MUST use this function.
// Do NOT re-implement the priority logic inline.
// ---------------------------------------------------------------------------

export interface ClientBaseRates {
  standardLow: number;
  standardHigh: number;
  tlLow: number;
  tlHigh: number;
  supLow: number;
  supHigh: number;
}

export interface ClientResolvedRate {
  lowRate: number;
  highRate: number;
  isCustom: boolean;
  source: 'custom' | 'trade' | 'base';
}

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
 */
export function resolveClientRate(
  customRate: number | null,
  tradeRate: number | null,
  isTeamLeader: boolean,
  isSupervisor: boolean,
  baseRates: ClientBaseRates | null,
): ClientResolvedRate {
  const hasBonus = isTeamLeader || isSupervisor;

  // Default base rates if not yet loaded
  const br: ClientBaseRates = baseRates ?? {
    standardLow: 2.5,
    standardHigh: 5.0,
    tlLow: 3.0,
    tlHigh: 5.5,
    supLow: 3.0,
    supHigh: 5.5,
  };

  // 1. Custom rate — highest priority
  if (customRate !== null && customRate !== undefined) {
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

  // 3. Base rate from DB
  const lowRate = hasBonus
    ? (isTeamLeader ? br.tlLow : br.supLow)
    : br.standardLow;
  const highRate = hasBonus
    ? (isTeamLeader ? br.tlHigh : br.supHigh)
    : br.standardHigh;

  return {
    lowRate,
    highRate,
    isCustom: false,
    source: 'base',
  };
}
