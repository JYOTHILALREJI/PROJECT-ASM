// ---------------------------------------------------------------------------
// payroll-math.ts
// ---------------------------------------------------------------------------
// THE single source of truth for all money & hour arithmetic in the payroll
// system. Every salary calculation (server OR client) MUST use these helpers
// instead of raw `*` / `+` expressions, so that:
//
//   1. Floating-point drift is eliminated (e.g. 799.9999999999 → 800).
//   2. Money is always rounded to exactly 2 decimals.
//   3. Hours are always rounded to 2 decimals.
//   4. Balances never go negative (advance + deduction clamping).
//   5. The threshold split logic exists in exactly ONE place.
//
// This module is PURE (no db, no React) so both server routes and client
// components can import it safely.
// ---------------------------------------------------------------------------

/** Tolerance used when comparing hour/ money amounts (1 cent / 1 cent-hour). */
export const EPSILON = 0.01;

/**
 * Round a money amount to 2 decimals (halves away from zero for .005 cases).
 * Guards against NaN / Infinity / null / undefined → returns fallback (0).
 */
export function roundMoney(value: number | null | undefined, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Round working hours to 2 decimals. Guards against NaN / Infinity → 0.
 * Negative inputs are clamped to 0 (hours can never be negative).
 */
export function roundHours(value: number | null | undefined, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round((n + Number.EPSILON) * 100) / 100);
}

/**
 * Coerce any input (API body, query param, form field) into a safe finite
 * non-negative number. Returns `fallback` when the input is missing,
 * non-numeric, NaN, Infinity or negative.
 */
export function safeNonNegative(
  value: unknown,
  fallback = 0,
): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }
  return fallback;
}

/**
 * Coerce a rate (per-hour amount). Must be finite and > 0 to be usable,
 * otherwise returns the fallback.
 */
export function safeRate(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

// ---------------------------------------------------------------------------
// Threshold split — the ONE canonical implementation
// ---------------------------------------------------------------------------

export interface ThresholdSplit {
  belowHours: number; // hours paid at the base (below-threshold) rate
  aboveHours: number; // hours paid at the premium (above-threshold) rate
}

/**
 * Split a month's hours into below/above threshold portions, accounting for
 * hours already consumed by previous months (cumulative, lifetime counter).
 *
 * Rules:
 *   - The threshold is CUMULATIVE across all months (never resets).
 *   - remaining = max(0, threshold - cumulativeBefore)
 *   - below = min(monthHours, remaining); above = monthHours - below
 *   - Result is rounded to 2 decimals on BOTH parts, and both parts always
 *     sum back to roundHours(monthHours) exactly (no lost/gained fractions).
 *
 * This is used by the allocation engine, the preview endpoint, the client
 * side editable Accounts grid and the recalculation engine — do NOT write
 * this logic inline anywhere else.
 */
export function computeThresholdSplit(
  monthHours: number,
  cumulativeBefore: number,
  threshold: number,
): ThresholdSplit {
  const total = roundHours(monthHours);
  const consumedBefore = Math.max(0, roundHours(Math.min(cumulativeBefore, threshold)));
  const thresholdSafe = Math.max(0, roundHours(threshold));

  const remaining = Math.max(0, roundHours(thresholdSafe - consumedBefore));

  let belowHours = Math.min(total, remaining);
  let aboveHours = total - belowHours;

  belowHours = roundHours(belowHours);
  aboveHours = roundHours(aboveHours);

  // Guard: eliminate drift so below + above === total exactly.
  const drift = roundHours(total - belowHours - aboveHours);
  if (Math.abs(drift) >= EPSILON) {
    // Apply the (tiny) drift to whichever bucket can absorb it.
    if (aboveHours > 0) {
      aboveHours = roundHours(aboveHours + drift);
    } else {
      belowHours = roundHours(belowHours + drift);
    }
  }

  return { belowHours, aboveHours };
}

/**
 * Alias kept for readability at call sites that think in "standard/premium"
 * tiers rather than below/above the threshold.
 */
export function computeTierSplit(
  monthHours: number,
  cumulativeBefore: number,
  threshold: number,
): { lowRateHours: number; highRateHours: number } {
  const s = computeThresholdSplit(monthHours, cumulativeBefore, threshold);
  return { lowRateHours: s.belowHours, highRateHours: s.aboveHours };
}

// ---------------------------------------------------------------------------
// Salary composition
// ---------------------------------------------------------------------------

/** Salary for a block of hours at a given rate: hours × rate, rounded to 2dp. */
export function computeSalary(hours: number, rate: number): number {
  return roundMoney(roundHours(hours) * safeRate(rate, 0));
}

/**
 * Balance = total − deduction − advance, clamped so it never goes below 0
 * (an advance can never pay out more than the remaining salary).
 */
export function computeBalance(
  totalSalary: number,
  deduction: number,
  advance: number,
): number {
  const t = roundMoney(totalSalary);
  const d = Math.max(0, roundMoney(deduction));
  const a = Math.max(0, roundMoney(advance));
  return Math.max(0, roundMoney(t - d - a));
}

/**
 * Full salary block for one (employee, site, month) tier record.
 * Returns every derived field, consistently rounded.
 */
export function composeSalaryRecord(params: {
  hours: number;
  rate: number;
  deduction?: number;
  advance?: number;
}): {
  totalHours: number;
  rtPerHour: number;
  totalSalary: number;
  balanceSalary: number;
} {
  const totalHours = roundHours(params.hours);
  const rtPerHour = roundMoney(safeRate(params.rate, 0), 0);
  const totalSalary = computeSalary(totalHours, rtPerHour);
  const balanceSalary = computeBalance(
    totalSalary,
    params.deduction ?? 0,
    params.advance ?? 0,
  );
  return { totalHours, rtPerHour, totalSalary, balanceSalary };
}
