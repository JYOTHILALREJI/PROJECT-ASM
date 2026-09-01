// ---------------------------------------------------------------------------
// rate-changelog.ts
// ---------------------------------------------------------------------------
// Helper library for the EmployeeRateChangelog table.
//
// This table stores per-month rate overrides for employees. When an admin
// sets a custom rate effective from month M, a changelog entry is created.
// The rate applies to month M and all future months until the next changelog
// entry's effectiveMonth.
//
// Resolution at query time:
//   For a given (employeeId, monthKey), find the changelog entry with the
//   LARGEST effectiveMonth that is <= monthKey. If found, that entry's
//   `rate` overrides the employee's customHourlyRate for that month.
//
// This makes past months "frozen" at their old rate while future months
// use the new rate — the recalculation engine reads from this table
// per-month instead of using a single global rate for all months.
// ---------------------------------------------------------------------------

import { db } from '@/lib/db';

export interface RateChangelogEntry {
  id: string;
  employeeId: string;
  rate: number;
  effectiveMonth: string; // YYYY-MM
  reason: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedRate {
  rate: number | null; // null = no changelog override, use default resolution
  changelogId: string | null;
  effectiveMonth: string | null; // the effectiveMonth of the matched entry
}

/**
 * Get the rate override for a single employee in a single month.
 *
 * Returns { rate: null } if no changelog entry exists with effectiveMonth <= monthKey,
 * in which case the caller should fall back to the default rate resolution
 * (Employee.customHourlyRate, trade rate, or base rate).
 *
 * If a changelog entry exists, returns its rate.
 */
export async function getRateForMonth(
  employeeId: string,
  monthKey: string,
): Promise<ResolvedRate> {
  try {
    // Find the LATEST changelog entry whose effectiveMonth is <= monthKey.
    // We use a lexicographic string comparison because YYYY-MM sorts correctly.
    const entry = await (db as any).employeeRateChangelog.findFirst({
      where: {
        employeeId,
        effectiveMonth: { lte: monthKey },
      },
      orderBy: { effectiveMonth: 'desc' },
    });
    if (!entry) {
      return { rate: null, changelogId: null, effectiveMonth: null };
    }
    return {
      rate: entry.rate,
      changelogId: entry.id,
      effectiveMonth: entry.effectiveMonth,
    };
  } catch {
    // Table might not exist yet (before migration) — return null so the
    // caller falls back to the default rate resolution.
    return { rate: null, changelogId: null, effectiveMonth: null };
  }
}

/**
 * Bulk variant: get rate overrides for multiple employees in a single month.
 *
 * Returns a Map<employeeId, number | null> where:
 *   - number = the changelog override rate for that employee in that month
 *   - null = no override, use default resolution
 */
export async function getRateMapForMonth(
  employeeIds: string[],
  monthKey: string,
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (employeeIds.length === 0) return result;

  try {
    // Fetch ALL changelog entries for these employees with effectiveMonth <= monthKey.
    const entries = await (db as any).employeeRateChangelog.findMany({
      where: {
        employeeId: { in: employeeIds },
        effectiveMonth: { lte: monthKey },
      },
      orderBy: [{ employeeId: 'asc' }, { effectiveMonth: 'desc' }],
    });

    // For each employee, pick the entry with the LARGEST effectiveMonth.
    // Since results are ordered by effectiveMonth DESC, the FIRST entry
    // per employee is the one we want.
    for (const entry of entries) {
      if (!result.has(entry.employeeId)) {
        result.set(entry.employeeId, entry.rate);
      }
    }

    // Ensure all requested employeeIds are in the map (null if no entry)
    for (const empId of employeeIds) {
      if (!result.has(empId)) {
        result.set(empId, null);
      }
    }
  } catch {
    // Table might not exist — return all nulls
    for (const empId of employeeIds) {
      result.set(empId, null);
    }
  }

  return result;
}

/**
 * Get ALL changelog entries for an employee, ordered by effectiveMonth DESC.
 * Used by the UI to display the rate history.
 */
export async function getRateChangelog(
  employeeId: string,
): Promise<RateChangelogEntry[]> {
  try {
    const entries = await (db as any).employeeRateChangelog.findMany({
      where: { employeeId },
      orderBy: { effectiveMonth: 'desc' },
    });
    return entries as RateChangelogEntry[];
  } catch {
    return [];
  }
}

/**
 * Create or update a changelog entry.
 *
 * If an entry already exists for (employeeId, effectiveMonth), update its rate.
 * Otherwise, insert a new entry.
 */
export async function upsertRateChangelog(
  employeeId: string,
  rate: number,
  effectiveMonth: string,
  reason: string = '',
  createdBy: string | null = null,
): Promise<RateChangelogEntry> {
  const entry = await (db as any).employeeRateChangelog.upsert({
    where: {
      employeeId_effectiveMonth: { employeeId, effectiveMonth },
    },
    update: {
      rate,
      reason,
      createdBy,
    },
    create: {
      employeeId,
      rate,
      effectiveMonth,
      reason,
      createdBy,
    },
  });
  return entry as RateChangelogEntry;
}

/**
 * Delete a changelog entry by id.
 * After deletion, months from that effectiveMonth onward will fall back to
 * the previous changelog entry (or the default rate resolution if no earlier
 * entry exists).
 */
export async function deleteRateChangelog(id: string): Promise<void> {
  try {
    await (db as any).employeeRateChangelog.delete({ where: { id } });
  } catch {
    // Ignore — entry may not exist or table may not exist
  }
}

/**
 * Get the LATEST (most recent) changelog entry for an employee.
 * This is the rate that should apply to the current and future months.
 *
 * Returns null if no changelog entries exist.
 */
export async function getLatestRate(
  employeeId: string,
): Promise<RateChangelogEntry | null> {
  try {
    const entry = await (db as any).employeeRateChangelog.findFirst({
      where: { employeeId },
      orderBy: { effectiveMonth: 'desc' },
    });
    return entry as RateChangelogEntry | null;
  } catch {
    return null;
  }
}
