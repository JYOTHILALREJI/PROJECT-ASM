import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Helper: Sync WorkLog entry from TotalEmployeeWorkingHours data.
 * When working hours are saved, we also need a WorkLog entry so the
 * Employee Hours Ledger (which reads from WorkLog) displays the data.
 */
async function syncWorkLogFromWorkingHours(
  empId: string,
  month: string, // YYYY-MM
  totalWorkingHours: number,
): Promise<void> {
  try {
    // Get the employee's current site
    const employee = await db.employee.findUnique({
      where: { id: empId },
      select: { currentSite: true },
    });

    let siteId = employee?.currentSite;
    if (!siteId) return; // Can't create WorkLog without a site

    // Try to find site by ID first, then by name as fallback
    let siteExists = await db.site.findUnique({ where: { id: siteId } });
    if (!siteExists) {
      // currentSite might be a name instead of an ID — look up by name
      const siteByName = await db.site.findFirst({ where: { name: siteId } });
      if (siteByName) {
        siteId = siteByName.id;
      } else {
        return; // Site not found by ID or name
      }
    }

    const [yearStr, monthStr] = month.split('-');
    const yearNum = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);

    if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) return;

    await db.workLog.upsert({
      where: {
        employeeId_siteId_year_month: {
          employeeId: empId,
          siteId,
          year: yearNum,
          month: monthNum,
        },
      },
      update: {
        hoursWorked: totalWorkingHours,
        deletedAt: null, // un-soft-delete if previously deleted
      },
      create: {
        employeeId: empId,
        siteId,
        year: yearNum,
        month: monthNum,
        hoursWorked: totalWorkingHours,
        allowances: 0,
        deductions: 0,
      },
    });
  } catch (error: unknown) {
    console.error('[working-hours] WorkLog sync failed:', error);
    // Don't fail the main operation if WorkLog sync fails
  }
}

// GET /api/working-hours?month=YYYY-MM&empId=...
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get('month'); // YYYY-MM
    const empId = searchParams.get('empId');

    const where: Record<string, unknown> = {
      isDeleted: false,
    };

    if (month) {
      where.month = month;
    }

    if (empId) {
      where.empId = empId;
    }

    const workingHours = await db.totalEmployeeWorkingHours.findMany({
      where,
      orderBy: [{ month: 'desc' }, { empName: 'asc' }],
    });

    return NextResponse.json({
      success: true,
      data: {
        workingHours: workingHours.map((w) => ({
          ...w,
          createdAt: w.createdAt.toISOString(),
          updatedAt: w.updatedAt.toISOString(),
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

// POST /api/working-hours — Create or update working hours record
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { empId, empName, month, totalWorkingHours, rtPerHour, isCustom } = body;

    if (!empId || !month) {
      return NextResponse.json(
        { success: false, error: 'empId and month (YYYY-MM) are required' },
        { status: 400 }
      );
    }

    // Verify employee exists
    const employee = await db.employee.findUnique({ where: { id: empId } });
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    // Check if record already exists for empId + month
    const existing = await db.totalEmployeeWorkingHours.findUnique({
      where: {
        empId_month: {
          empId,
          month,
        },
      },
    });

    if (existing && !existing.isDeleted) {
      // Update existing record
      const resolvedRtPerHour = isCustom ? (rtPerHour ?? existing.rtPerHour) : (rtPerHour ?? 2.5);

      const workingHour = await db.totalEmployeeWorkingHours.update({
        where: { id: existing.id },
        data: {
          totalWorkingHours: totalWorkingHours ?? existing.totalWorkingHours,
          rtPerHour: resolvedRtPerHour,
          isCustom: isCustom ?? existing.isCustom,
          empName: empName || existing.empName,
        },
      });

      // Sync WorkLog entry so Employee Hours Ledger shows this data
      await syncWorkLogFromWorkingHours(empId, month, workingHour.totalWorkingHours);

      return NextResponse.json({
        success: true,
        data: {
          workingHour: {
            ...workingHour,
            createdAt: workingHour.createdAt.toISOString(),
            updatedAt: workingHour.updatedAt.toISOString(),
          },
        },
      });
    } else if (existing && existing.isDeleted) {
      // Reactivate soft-deleted record
      const workingHour = await db.totalEmployeeWorkingHours.update({
        where: { id: existing.id },
        data: {
          totalWorkingHours: totalWorkingHours ?? 0,
          rtPerHour: rtPerHour ?? 2.5,
          isCustom: isCustom ?? false,
          empName: empName || existing.empName,
          isDeleted: false,
        },
      });

      // Sync WorkLog entry so Employee Hours Ledger shows this data
      await syncWorkLogFromWorkingHours(empId, month, workingHour.totalWorkingHours);

      return NextResponse.json({
        success: true,
        data: {
          workingHour: {
            ...workingHour,
            createdAt: workingHour.createdAt.toISOString(),
            updatedAt: workingHour.updatedAt.toISOString(),
          },
        },
      });
    } else {
      // Create new record
      const workingHour = await db.totalEmployeeWorkingHours.create({
        data: {
          empId,
          empName: empName || employee.fullName,
          month,
          totalWorkingHours: totalWorkingHours ?? 0,
          rtPerHour: rtPerHour ?? 2.5,
          isCustom: isCustom ?? false,
          isDeleted: false,
        },
      });

      // Sync WorkLog entry so Employee Hours Ledger shows this data
      await syncWorkLogFromWorkingHours(empId, month, workingHour.totalWorkingHours);

      return NextResponse.json(
        {
          success: true,
          data: {
            workingHour: {
              ...workingHour,
              createdAt: workingHour.createdAt.toISOString(),
              updatedAt: workingHour.updatedAt.toISOString(),
            },
          },
        },
        { status: 201 }
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
