import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Calculate total working days in a month (excluding Fridays)
function getWorkingDaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    if (date.getDay() !== 5) {
      workingDays++;
    }
  }

  return workingDays;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, overtimeHours } = body;

    if (!status) {
      return NextResponse.json(
        { success: false, error: 'status is required' },
        { status: 400 }
      );
    }

    const validStatuses = ['present', 'absent', 'no_site', 'overtime', 'not_marked'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    const existing = await db.attendance.findUnique({ where: { id } });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Attendance record not found' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = { status };

    if (overtimeHours !== undefined) {
      updateData.overtimeHours = overtimeHours;
    }

    const attendance = await db.attendance.update({
      where: { id },
      data: updateData as Parameters<typeof db.attendance.update>[0]['data'],
    });

    // Recalculate star rating
    const [yearStr, monthStr] = existing.date.split('-').map(Number);
    const totalWorkingDays = getWorkingDaysInMonth(yearStr, monthStr);

    if (totalWorkingDays > 0) {
      const records = await db.attendance.findMany({
        where: {
          employeeId: existing.employeeId,
          date: {
            gte: `${yearStr}-${String(monthStr).padStart(2, '0')}-01`,
            lt: `${yearStr}-${String(monthStr).padStart(2, '0')}-31`,
          },
        },
      });

      const goodDays = records.filter(
        (r) => r.status === 'present' || r.status === 'overtime'
      ).length;

      const rating = Math.round(Math.max(0, Math.min(5, (goodDays / totalWorkingDays) * 5.0)) * 10) / 10;

      await db.employee.update({
        where: { id: existing.employeeId },
        data: { rating },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        attendance: {
          ...attendance,
          createdAt: attendance.createdAt.toISOString(),
          updatedAt: attendance.updatedAt.toISOString(),
        },
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
