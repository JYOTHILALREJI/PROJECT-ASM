// ---------------------------------------------------------------------------
// safe-site.ts
// ---------------------------------------------------------------------------
// Defensive wrapper for fetching Site records that may include the `branchId`
// column and `branch` relation.
//
// WHY: The `Site` table in the user's local SQLite database may not have the
// `branchId` column yet (pre-migration), and the `Branch` table itself may
// not exist. In those cases, `db.site.findMany({ select: { branchId: true,
// branch: {...} } })` throws:
//
//   "The table `main.Branch` does not exist in the current database."
//   OR
//   "no such column: Site_branchId" / similar
//
// This crashes the entire API route (e.g. /api/accounts), so the Accounts
// page and Consolidated Salary page show no data at all.
//
// FIX: try the full query first; if it fails, fall back to a simpler query
// that omits `branchId` and `branch`, and synthesize null values for them.
//
// Once the user runs `npx prisma db push`, both the column and the table
// will exist and the full query will succeed.
// ---------------------------------------------------------------------------

import { db } from '@/lib/db';

export interface SiteWithBranch {
  id: string;
  name: string;
  clientName: string | null;
  projectName: string | null;
  branchId: string | null;
  branch: { id: string; name: string; code: string | null } | null;
}

/**
 * Safely fetch sites (optionally filtered by `where.id IN (...)`) with
 * branch info. Falls back to a branch-less query if the Branch table or
 * Site.branchId column doesn't exist yet.
 */
export async function safeFetchSitesWithBranch(
  where?: { id?: { in: string[] } }
): Promise<SiteWithBranch[]> {
  // First try the full query (branchId column + branch relation)
  try {
    const sites = await db.site.findMany({
      ...(where ? { where } : {}),
      select: {
        id: true,
        name: true,
        clientName: true,
        projectName: true,
        branchId: true,
        branch: { select: { id: true, name: true, code: true } },
      },
    });
    // Normalize: ensure branchId and branch are present (Prisma will return
    // them, but be defensive in case of partial migration states).
    return sites.map((s: any) => ({
      id: s.id,
      name: s.name,
      clientName: s.clientName ?? null,
      projectName: s.projectName ?? null,
      branchId: s.branchId ?? null,
      branch: s.branch ?? null,
    }));
  } catch (err) {
    // Fall back to a simpler query without branchId / branch
    console.warn(
      '[safe-site] Full site query failed (Branch table or Site.branchId missing?). Falling back to branch-less query.',
      err instanceof Error ? err.message : err,
    );
    try {
      const sites = await db.site.findMany({
        ...(where ? { where } : {}),
        select: {
          id: true,
          name: true,
          clientName: true,
          projectName: true,
        },
      });
      // Synthesize null branchId / branch
      return sites.map((s: any) => ({
        id: s.id,
        name: s.name,
        clientName: s.clientName ?? null,
        projectName: s.projectName ?? null,
        branchId: null,
        branch: null,
      }));
    } catch (err2) {
      // Even the simple query failed — try the absolute minimum
      console.warn(
        '[safe-site] Even the simple site query failed. Returning empty array.',
        err2 instanceof Error ? err2.message : err2,
      );
      return [];
    }
  }
}
