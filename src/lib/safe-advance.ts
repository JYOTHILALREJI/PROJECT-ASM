// ---------------------------------------------------------------------------
// safe-advance.ts
// ---------------------------------------------------------------------------
// Defensive wrapper around `db.advance.*` queries.
//
// WHY: The `Advance` table was added to the Prisma schema, but if the user's
// local SQLite database hasn't been migrated yet (i.e. they haven't run
// `npx prisma db push`), every `db.advance.findMany()` call will throw:
//
//   "The table `main.Advance` does not exist in the current database."
//
// This crashes the entire API route (e.g. /api/accounts), which means the
// Accounts page shows nothing. To avoid this, we wrap the read paths in a
// try-catch that returns an empty array on failure. The write paths
// (create/update) are NOT wrapped here because they only run when the user
// explicitly takes an action, and by then they should have run the migration.
//
// Once the user runs `npx prisma db push`, the table will exist and these
// wrappers become no-ops (the try succeeds and returns the real data).
// ---------------------------------------------------------------------------

import { db } from '@/lib/db';

export interface AdvanceRow {
  id: string;
  empId: string;
  empName: string;
  employeeCode: string;
  amount: number;
  reason: string;
  status: string;
  effectiveMonth: string;
  effectiveYear: number;
  appliedToSalaryRecordId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Safely query pending advances. Returns [] if the Advance table doesn't
 * exist yet (pre-migration), instead of throwing.
 */
export async function safeFindPendingAdvances(
  month: string,
  year: number
): Promise<AdvanceRow[]> {
  try {
    const rows = await db.advance.findMany({
      where: {
        effectiveMonth: month,
        effectiveYear: year,
        status: 'pending',
        deletedAt: null,
      },
    });
    return rows as AdvanceRow[];
  } catch (err) {
    // Table doesn't exist yet — return empty so the page still renders.
    console.warn(
      '[safe-advance] Advance table missing or query failed, returning [].',
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Safely query ALL advances for a given month/year (any status).
 * Returns [] if the Advance table doesn't exist yet.
 */
export async function safeFindAdvancesByMonth(
  month: string,
  year: number
): Promise<AdvanceRow[]> {
  try {
    const rows = await db.advance.findMany({
      where: {
        effectiveMonth: month,
        effectiveYear: year,
        deletedAt: null,
      },
    });
    return rows as AdvanceRow[];
  } catch (err) {
    console.warn(
      '[safe-advance] Advance table missing or query failed, returning [].',
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
