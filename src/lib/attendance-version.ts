import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// Attendance version capture
// ---------------------------------------------------------------------------
// Every time attendance is written (from the website, the public share link,
// or the bulk-mark route), we capture an immutable snapshot of the entire
// site's attendance for that date. This lets the Attendance Copy page show
// a full version history per site+date, and lets admins restore any prior
// version.
//
// The snapshot includes EVERY employee currently assigned to the site (not
// just the ones whose status changed) so that switching between versions in
// the UI shows a complete picture.
// ---------------------------------------------------------------------------

export interface AttendanceSnapshotEntry {
  employeeId: string;
  fullName: string;
  employeeCode: string;
  status: 'present' | 'absent' | 'no_site' | 'overtime' | 'not_marked';
  overtimeHours: number | null;
}

export interface CaptureVersionParams {
  siteId: string;
  siteName: string;
  date: string; // YYYY-MM-DD
  source: 'website' | 'share_link' | 'bulk_mark' | 'restore';
  shareToken?: string | null;
  changedById?: string | null;
  changedByName?: string | null;
  summary?: string;
}

/**
 * Capture a new AttendanceVersion row for the given site+date.
 *
 * This reads the CURRENT live attendance for every employee at the site on
 * that date and stores it as a JSON snapshot. It's meant to be called AFTER
 * the attendance write has been committed, so the snapshot reflects the new
 * state.
 *
 * The version number is computed by counting existing versions for this
 * site+date + 1.
 *
 * This function is idempotent in the sense that calling it twice just
 * creates two versions — it never throws for "already captured".
 */
export async function captureAttendanceVersion(params: CaptureVersionParams): Promise<{
  id: string;
  versionNumber: number;
  entryCount: number;
} | null> {
  try {
    // Fetch all employees currently at this site
    const currentEmployees = await db.employee.findMany({
      where: {
        currentSite: params.siteName,
        status: { not: 'deleted' },
      },
      select: {
        id: true,
        fullName: true,
        employeeId: true,
      },
    });

    // ALSO fetch employees who have an attendance record for THIS date tagged
    // with THIS site even if they are no longer assigned here — a mid-month
    // transfer means the employee's currentSite points at the NEW site, but
    // their mark (made in this site's grid) must still appear in this site's
    // snapshot, otherwise the version history silently drops moved employees.
    const siteAttendanceForDate = await db.attendance.findMany({
      where: {
        date: params.date,
        siteId: params.siteId,
        deletedAt: null,
        isHidden: false,
      },
      select: { employeeId: true },
    });
    const extraIds = siteAttendanceForDate
      .map((r) => r.employeeId)
      .filter((id) => !currentEmployees.some((e) => e.id === id));

    let employees = currentEmployees;
    if (extraIds.length > 0) {
      const extraEmployees = await db.employee.findMany({
        where: { id: { in: extraIds }, status: { not: 'deleted' } },
        select: { id: true, fullName: true, employeeId: true },
      });
      employees = [...currentEmployees, ...extraEmployees];
    }

    if (employees.length === 0) {
      // No employees at this site — nothing to snapshot
      return null;
    }

    // Fetch live attendance for this site's employees on this date.
    // Only records that BELONG to this site (siteId match) or legacy
    // un-attributed records (siteId null) count here — a record tagged to a
    // DIFFERENT site (e.g. marked at the new site before a same-day transfer)
    // must NOT leak into this site's snapshot.
    const attendanceRecords = await db.attendance.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        date: params.date,
        deletedAt: null,
        OR: [{ siteId: params.siteId }, { siteId: null }],
      },
    });
    const attendanceMap = new Map(attendanceRecords.map((r) => [r.employeeId, r]));

    // Build the snapshot
    const snapshot: AttendanceSnapshotEntry[] = employees.map((emp) => {
      const rec = attendanceMap.get(emp.id);
      return {
        employeeId: emp.id,
        fullName: emp.fullName,
        employeeCode: emp.employeeId,
        status: (rec?.status as AttendanceSnapshotEntry['status']) || 'not_marked',
        overtimeHours: rec?.overtimeHours ?? null,
      };
    });

    // Compute the next version number for this site+date
    const existingCount = await db.attendanceVersion.count({
      where: { siteId: params.siteId, date: params.date },
    });
    const versionNumber = existingCount + 1;

    // Build a human-readable summary if one wasn't provided
    const present = snapshot.filter((s) => s.status === 'present').length;
    const absent = snapshot.filter((s) => s.status === 'absent').length;
    const unmarked = snapshot.filter((s) => s.status === 'not_marked').length;
    const sourceLabel =
      params.source === 'share_link' ? 'via share link'
        : params.source === 'bulk_mark' ? 'via bulk mark'
          : params.source === 'restore' ? 'restored'
            : 'via website';
    const summary = params.summary ||
      `${present} present, ${absent} absent${unmarked > 0 ? `, ${unmarked} unmarked` : ''} ${sourceLabel}`;

    const version = await db.attendanceVersion.create({
      data: {
        siteId: params.siteId,
        siteName: params.siteName,
        date: params.date,
        versionNumber,
        snapshot: JSON.stringify(snapshot),
        source: params.source,
        shareToken: params.shareToken ?? null,
        changedById: params.changedById ?? null,
        changedByName: params.changedByName ?? null,
        summary,
      },
    });

    return {
      id: version.id,
      versionNumber: version.versionNumber,
      entryCount: snapshot.length,
    };
  } catch (err) {
    // Version capture should never break the parent write — log and move on
    console.error('[captureAttendanceVersion] failed:', err);
    return null;
  }
}

/**
 * Restore a prior version: re-write the live attendance to match the
 * snapshot, then capture a NEW version (source='restore') so the history
 * shows the restore action.
 *
 * Returns the new version's id, or null if the restore failed.
 */
export async function restoreAttendanceVersion(versionId: string, restoredBy?: {
  id: string;
  name: string;
} | null): Promise<{ newVersionId: string; newVersionNumber: number } | null> {
  const version = await db.attendanceVersion.findUnique({
    where: { id: versionId },
  });
  if (!version) return null;

  let snapshot: AttendanceSnapshotEntry[] = [];
  try {
    snapshot = JSON.parse(version.snapshot);
  } catch {
    return null;
  }

  // Re-write the live attendance for each employee in the snapshot
  for (const entry of snapshot) {
    if (entry.status === 'not_marked') {
      // Soft-delete any existing record for this employee+date so the live
      // view shows 'not marked'.
      await db.attendance.updateMany({
        where: {
          employeeId: entry.employeeId,
          date: version.date,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      continue;
    }
    await db.attendance.upsert({
      where: {
        employeeId_date: {
          employeeId: entry.employeeId,
          date: version.date,
        },
      },
      create: {
        employeeId: entry.employeeId,
        date: version.date,
        status: entry.status,
        overtimeHours: entry.overtimeHours,
      },
      update: {
        status: entry.status,
        overtimeHours: entry.overtimeHours,
        deletedAt: null, // un-soft-delete if needed
      },
    });
  }

  // Capture a new version (source='restore')
  const newVersion = await captureAttendanceVersion({
    siteId: version.siteId,
    siteName: version.siteName,
    date: version.date,
    source: 'restore',
    changedById: restoredBy?.id ?? null,
    changedByName: restoredBy?.name ?? null,
    summary: `Restored from v${version.versionNumber}`,
  });

  return newVersion ? { newVersionId: newVersion.id, newVersionNumber: newVersion.versionNumber } : null;
}
