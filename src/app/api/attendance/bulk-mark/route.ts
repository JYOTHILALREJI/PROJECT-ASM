import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { syncEmployeeSalaryFromAttendance } from '@/lib/attendance-sync';

// POST /api/attendance/bulk-mark - Mark employees as present for a specific date
// If employeeIds array is provided, only mark those employees.
// Otherwise, mark all active employees.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, status = 'present', employeeIds } = body;

    if (!date) {
      return NextResponse.json(
        { success: false, error: 'date is required (YYYY-MM-DD format)' },
        { status: 400 }
      );
    }

    const validStatuses = ['present', 'absent', 'no_site', 'overtime'];
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
      select: { id: true, fullName: true, employeeId: true, rating: true },
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

    return NextResponse.json({
      success: true,
      data: {
        date,
        status,
        total: employees.length,
        updated,
        skipped,
        errors: errors.length > 0 ? errors : undefined,
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
