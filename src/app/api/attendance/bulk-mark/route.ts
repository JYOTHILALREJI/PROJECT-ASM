import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { syncEmployeeSalaryFromAttendance } from '@/lib/attendance-sync';
import { captureAttendanceVersion } from '@/lib/attendance-version';
import { logActivity } from '@/lib/activity-logger';

// POST /api/attendance/bulk-mark - Mark employees as present for a specific date
// If employeeIds array is provided, only mark those employees.
// Otherwise, mark all active employees.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, status = 'present', employeeIds, actorUserId, actorDisplayName } = body;

    if (!date) {
      return NextResponse.json(
        { success: false, error: 'date is required (YYYY-MM-DD format)' },
        { status: 400 }
      );
    }

    const validStatuses = ['present', 'absent', 'no_site', 'overtime', 'camp_sitting'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Build the where clause: either specific employeeIds or all active employees
    const whereClause: Record<string, unknown> = { status: 'active' };
    if (employeeIds && Array.isArray(employeeIds) && employeeIds.length > 0) {
      whereClause.id = { in: employeeIds };
    }

    const employees = await db.employee.findMany({
      where: whereClause,
      select: { id: true, fullName: true, employeeId: true, rating: true, currentSite: true, currentSiteId: true },
    });

    if (employees.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No employees found' },
        { status: 404 }
      );
    }

    // Bulk upsert attendance records for the target employees
    const results: Array<{ employeeId: string; skipped?: boolean; reason?: string; id?: string; updated?: boolean }> = [];
    const errors: string[] = [];

    for (const emp of employees) {
      try {
        const existing = await db.attendance.findUnique({
          where: { employeeId_date: { employeeId: emp.id, date } },
        });

        // Skip if already has the target status
        if (existing && existing.status === status && !existing.overtimeHours) {
          results.push({ employeeId: emp.id, skipped: true });
          continue;
        }

        // If existing record is overtime, don't overwrite it (preserve overtime data)
        if (existing && existing.status === 'overtime' && status === 'present') {
          results.push({ employeeId: emp.id, skipped: true, reason: 'overtime' });
          continue;
        }

        const record = await db.attendance.upsert({
          where: { employeeId_date: { employeeId: emp.id, date } },
          create: {
            employeeId: emp.id,
            date,
            status,
            overtimeHours: status === 'overtime' ? (body.overtimeHours || 2) : null,
          },
          update: {
            status,
            overtimeHours: status === 'overtime' ? (body.overtimeHours || 2) : null,
          },
        });

        // Sync salary record from attendance (10 hrs per present day)
        try {
          const monthKey = date.substring(0, 7); // YYYY-MM
          await syncEmployeeSalaryFromAttendance(emp.id, monthKey);
        } catch (syncErr) {
          console.error('[bulk-mark] salary sync failed for', emp.id, syncErr);
        }

        results.push({ employeeId: emp.id, id: record.id, updated: true });
      } catch (err) {
        errors.push(`${emp.fullName}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    const updated = results.filter((r) => r.updated).length;
    const skipped = results.filter((r) => r.skipped).length;

    // ── Capture one attendance version per affected site ──
    // Bulk-mark may have touched employees across multiple sites, so group the
    // updated employees by their currentSiteId and capture one version per site.
    const updatedEmps = employees.filter((e) => results.some((r) => r.employeeId === e.id && r.updated));
    const bySite = new Map<string, { siteId: string; siteName: string }>();
    for (const emp of updatedEmps) {
      if (!emp.currentSiteId || !emp.currentSite) continue;
      if (!bySite.has(emp.currentSiteId)) {
        bySite.set(emp.currentSiteId, { siteId: emp.currentSiteId, siteName: emp.currentSite });
      }
    }
    const versionCaptures: Array<{ siteId: string; siteName: string; versionNumber: number }> = [];
    for (const [, { siteId, siteName }] of bySite) {
      try {
        const v = await captureAttendanceVersion({
          siteId,
          siteName,
          date,
          source: 'bulk_mark',
          changedByName: 'Admin (bulk mark)',
          summary: `Bulk marked ${updatedEmps.filter((e) => e.currentSiteId === siteId).length} employee(s) as ${status}`,
        });
        if (v) versionCaptures.push({ siteId, siteName, versionNumber: v.versionNumber });
      } catch (err) {
        console.error('[bulk-mark] version capture failed for', siteId, err);
      }
    }

    // ── Log the bulk-mark activity ──
    await logActivity({
      userId: actorUserId || null,
      displayName: actorDisplayName || 'Admin (bulk mark)',
      action: 'bulk_mark',
      entityType: 'attendance',
      entityId: null,
      entityName: `${updated} employee(s)`,
      description: `Bulk marked ${updated} employee(s) as ${status} for ${date}`,
      details: { date, status, employeeCount: employees.length, updated, skipped, sites: Array.from(bySite.values()).map((s) => s.siteName) },
      request,
    });

    return NextResponse.json({
      success: true,
      data: {
        date,
        status,
        total: employees.length,
        updated,
        skipped,
        errors: errors.length > 0 ? errors : undefined,
        versionCaptures,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
