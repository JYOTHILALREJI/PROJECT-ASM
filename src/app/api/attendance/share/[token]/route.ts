import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { syncEmployeeSalaryFromAttendance } from '@/lib/attendance-sync';

// ---------------------------------------------------------------------------
// /api/attendance/share/[token]
// ---------------------------------------------------------------------------
// GET    — load the share + the employees of the site (TL/Supervisors first).
//          Returns 410 if already submitted, 404 if token doesn't exist.
//
// POST   — submit attendance for the share. Body:
//            { entries: [{ employeeId, status: 'present' | 'absent' }],
//              submittedByName?: string }
//          Writes attendance records for each entry via the same logic as the
//          main attendance API (including the 10-hour salary sync), then marks
//          the share as 'submitted' with a JSON snapshot. Subsequent POSTs are
//          rejected (410).
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    const share = await db.attendanceShare.findUnique({
      where: { token },
      include: { site: true },
    });

    if (!share) {
      return NextResponse.json(
        { success: false, error: 'Share link not found' },
        { status: 404 },
      );
    }

    // Fetch employees currently at this site, sorted with TL/Supervisors first.
    const employees = await db.employee.findMany({
      where: {
        currentSite: share.siteName,
        status: { not: 'deleted' },
      },
      select: {
        id: true,
        fullName: true,
        employeeId: true,
        trade: true,
        position: true,
        isTeamLeader: true,
        isSupervisor: true,
      },
    });

    // Sort: Team Leaders first, then Supervisors, then everyone else
    // alphabetically by name within each group.
    const sortedEmployees = [...employees].sort((a, b) => {
      const aRank = a.isTeamLeader ? 0 : a.isSupervisor ? 1 : 2;
      const bRank = b.isTeamLeader ? 0 : b.isSupervisor ? 1 : 2;
      if (aRank !== bRank) return aRank - bRank;
      return (a.fullName || '').localeCompare(b.fullName || '');
    });

    // If the share is submitted, also parse the snapshot for re-display.
    let submittedEntries: Array<{ employeeId: string; status: string }> | null = null;
    if (share.status === 'submitted' && share.submittedSnapshot) {
      try {
        submittedEntries = JSON.parse(share.submittedSnapshot);
      } catch {
        submittedEntries = null;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        share: {
          id: share.id,
          token: share.token,
          siteId: share.siteId,
          siteName: share.siteName,
          clientName: share.clientName,
          projectName: share.projectName,
          date: share.date,
          status: share.status,
          submittedByName: share.submittedByName,
          submittedAt: share.updatedAt.toISOString(),
          createdAt: share.createdAt.toISOString(),
        },
        employees: sortedEmployees.map((e) => ({
          id: e.id,
          fullName: e.fullName,
          employeeId: e.employeeId,
          trade: e.trade,
          position: e.position,
          isTeamLeader: e.isTeamLeader,
          isSupervisor: e.isSupervisor,
        })),
        submittedEntries,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[attendance/share/[token] GET] error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const body = await request.json();
    const { entries, submittedByName } = body as {
      entries?: Array<{ employeeId: string; status: 'present' | 'absent' }>;
      submittedByName?: string;
    };

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { success: false, error: 'entries must be a non-empty array' },
        { status: 400 },
      );
    }

    // Validate each entry
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.employeeId || typeof e.employeeId !== 'string') {
        return NextResponse.json(
          { success: false, error: `Entry ${i}: employeeId is required` },
          { status: 400 },
        );
      }
      if (e.status !== 'present' && e.status !== 'absent') {
        return NextResponse.json(
          { success: false, error: `Entry ${i}: status must be 'present' or 'absent'` },
          { status: 400 },
        );
      }
    }

    const share = await db.attendanceShare.findUnique({ where: { token } });
    if (!share) {
      return NextResponse.json(
        { success: false, error: 'Share link not found' },
        { status: 404 },
      );
    }

    if (share.status === 'submitted') {
      return NextResponse.json(
        {
          success: false,
          error: 'Attendance has already been submitted via this link. The link cannot be reused.',
          alreadySubmitted: true,
        },
        { status: 410 },
      );
    }
    if (share.status === 'expired') {
      return NextResponse.json(
        { success: false, error: 'This share link has expired.' },
        { status: 410 },
      );
    }

    // Write attendance records. We do this directly against db.attendance
    // (same model the main attendance API uses) so the data flows through the
    // same path. After writing, we trigger the salary sync (10 hrs per
    // present day) for each employee — same as the main attendance POST.
    const date = share.date;
    const written: Array<{ employeeId: string; status: string; ok: boolean; error?: string }> = [];

    for (const entry of entries) {
      try {
        await db.attendance.upsert({
          where: {
            employeeId_date: {
              employeeId: entry.employeeId,
              date,
            },
          },
          create: {
            employeeId: entry.employeeId,
            date,
            status: entry.status,
          },
          update: {
            status: entry.status,
            overtimeHours: null,
          },
        });
        written.push({ employeeId: entry.employeeId, status: entry.status, ok: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        written.push({ employeeId: entry.employeeId, status: entry.status, ok: false, error: msg });
      }
    }

    // Trigger salary sync for each employee (10 hrs per present day).
    // The sync runs inside its own try/catch so a sync failure doesn't roll
    // back the attendance writes.
    const monthKey = date.substring(0, 7); // YYYY-MM
    for (const entry of entries) {
      if (entry.status === 'present') {
        try {
          await syncEmployeeSalaryFromAttendance(entry.employeeId, monthKey);
        } catch (syncErr) {
          console.error('[share submit] salary sync failed for', entry.employeeId, syncErr);
        }
      }
    }

    // Mark the share as submitted and store the snapshot.
    const snapshot = JSON.stringify(
      entries.map((e) => ({ employeeId: e.employeeId, status: e.status })),
    );
    const updated = await db.attendanceShare.update({
      where: { token },
      data: {
        status: 'submitted',
        submittedSnapshot: snapshot,
        submittedByName: typeof submittedByName === 'string' ? submittedByName : null,
      },
    });

    const successCount = written.filter((w) => w.ok).length;
    const failedCount = written.length - successCount;

    return NextResponse.json({
      success: true,
      data: {
        shareId: updated.id,
        status: updated.status,
        submittedAt: updated.updatedAt.toISOString(),
        submittedByName: updated.submittedByName,
        attendance: {
          total: written.length,
          succeeded: successCount,
          failed: failedCount,
          details: written,
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[attendance/share/[token] POST] error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
