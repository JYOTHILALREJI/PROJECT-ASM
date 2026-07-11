import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Calculate total working days in a month (excluding Fridays)
function getWorkingDaysInMonth(year: number, month: number): number {
  // month is 1-based from the year/month query param
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    // Friday = 5 in JS (0=Sunday)
    if (date.getDay() !== 5) {
      workingDays++;
    }
  }

  return workingDays;
}

// Check for consecutive absences ending on the given date
async function checkConsecutiveAbsences(
  employeeId: string,
  date: string
): Promise<string[] | null> {
  // Get the last 7 days of attendance before and including this date
  const targetDate = new Date(date);
  const absentDates: string[] = [];

  // Check backwards from the given date
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(targetDate);
    checkDate.setDate(checkDate.getDate() - i);

    // Skip Fridays
    if (checkDate.getDay() === 5) continue;

    const dateStr = checkDate.toISOString().split('T')[0];
    const record = await db.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId,
          date: dateStr,
        },
      },
    });

    if (record && record.status === 'absent') {
      absentDates.push(dateStr);
    } else {
      break; // Not consecutive anymore
    }
  }

  return absentDates.length >= 3 ? absentDates : null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employeeId');
    const monthParam = searchParams.get('month');
    const yearParam = searchParams.get('year');

    if (!monthParam || !yearParam) {
      return NextResponse.json(
        { success: false, error: 'month and year query parameters are required (month: YYYY-MM format, year: YYYY)' },
        { status: 400 }
      );
    }

    // Parse month from YYYY-MM
    const [year, month] = monthParam.split('-').map(Number);
    const queryYear = parseInt(yearParam, 10);

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json(
        { success: false, error: 'Invalid month format. Use YYYY-MM' },
        { status: 400 }
      );
    }

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

    const where: Record<string, unknown> = {
      date: {
        gte: startDate,
        lt: endDate,
      },
    };

    if (employeeId) {
      where.employeeId = employeeId;
    }

    const records = await db.attendance.findMany({
      where,
      orderBy: { date: 'asc' },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        records: records.map((r: { createdAt: Date; updatedAt: Date }) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employeeId, date, status, overtimeHours } = body;

    if (!employeeId || !date || !status) {
      return NextResponse.json(
        { success: false, error: 'employeeId, date, and status are required' },
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

    // Verify employee exists
    const employee = await db.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    // Get existing attendance record to handle overtime rating adjustment
    const existingRecord = await db.attendance.findUnique({
      where: {
        employeeId_date: { employeeId, date },
      },
    });

    // Upsert attendance record
    const attendance = await db.attendance.upsert({
      where: {
        employeeId_date: {
          employeeId,
          date,
        },
      },
      create: {
        employeeId,
        date,
        status,
        overtimeHours: overtimeHours || null,
      },
      update: {
        status,
        overtimeHours: overtimeHours || null,
      },
    });

    // Adjust rating based on overtime: +0.2 stars per overtime hour
    let rating = employee.rating;
    const oldOvertimeHours = existingRecord?.overtimeHours || 0;
    const newOvertimeHours = overtimeHours || 0;
    const wasOvertime = existingRecord?.status === 'overtime';
    const isOvertime = status === 'overtime';

    // Calculate the net change in overtime bonus
    let overtimeBonusDelta = 0;
    if (wasOvertime && !isOvertime) {
      // Removed overtime: subtract the old bonus
      overtimeBonusDelta = -(oldOvertimeHours * 0.2);
    } else if (isOvertime) {
      // Added or updated overtime: add new bonus, subtract old if existed
      overtimeBonusDelta = (newOvertimeHours * 0.2) - (wasOvertime ? oldOvertimeHours * 0.2 : 0);
    }

    if (overtimeBonusDelta !== 0) {
      rating = Math.max(0, Math.min(5, Math.round((rating + overtimeBonusDelta) * 10) / 10));
      await db.employee.update({
        where: { id: employeeId },
        data: { rating },
      });
    }

    // Check for consecutive absences (auto-warning)
    if (status === 'absent') {
      const consecutiveAbsences = await checkConsecutiveAbsences(employeeId, date);

      if (consecutiveAbsences) {
        // Get super admins for notification
        const superAdmins = await db.user.findMany({
          where: { role: 'super_admin' },
          select: { id: true },
        });

        // Create auto-generated warning
        await db.$transaction(async (tx) => {
          // Find an admin to set as createdBy - use first super admin
          const adminId = superAdmins.length > 0 ? superAdmins[0].id : '';

          // Deduct 0.5 stars for auto-generated warning
          const emp = await tx.employee.findUnique({ where: { id: employeeId }, select: { rating: true } });
          if (emp) {
            const newRating = Math.max(0, Math.round((emp.rating - 0.5) * 10) / 10);
            await tx.employee.update({
              where: { id: employeeId },
              data: { rating: newRating },
            });
          }

          const warning = await tx.warning.create({
            data: {
              employeeId,
              reason: `Auto-generated: ${consecutiveAbsences.length} consecutive absences detected (${consecutiveAbsences.join(', ')})`,
              isAutoGenerated: true,
              absentDates: JSON.stringify(consecutiveAbsences),
              createdById: adminId,
            },
          });

          // Create notifications for super admins
          for (const admin of superAdmins) {
            await tx.notification.create({
              data: {
                userId: admin.id,
                title: 'Auto-Generated Warning',
                message: `Employee ${employee.fullName} (${employee.employeeId}) has ${consecutiveAbsences.length} consecutive absences. Warning #${warning.id.slice(-6)} has been auto-generated.`,
                type: 'warning',
              },
            });
          }
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        attendance: {
          ...attendance,
          createdAt: attendance.createdAt.toISOString(),
          updatedAt: attendance.updatedAt.toISOString(),
        },
        rating,
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
