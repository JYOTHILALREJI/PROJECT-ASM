import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Helper: Calculate RT/HR based on working hours and team leader/supervisor status
async function calculateRtPerHour(
  empId: string,
  _siteId: string
): Promise<number> {
  // Get all monthly working hours records for aggregate total
  const workingHoursRecords = await db.totalEmployeeWorkingHours.findMany({
    where: { empId, isDeleted: false },
  });
  const totalHrs = workingHoursRecords.reduce((sum, r) => sum + r.totalWorkingHours, 0);
  const hasCustom = workingHoursRecords.some(r => r.isCustom);
  const latestRt = workingHoursRecords.length > 0 ? workingHoursRecords[workingHoursRecords.length - 1].rtPerHour : 2.5;

  if (hasCustom) return latestRt;

  const employee = await db.employee.findUnique({
    where: { id: empId },
    select: { isTeamLeader: true, isSupervisor: true, hoursThreshold: true },
  });

  // Divisor-based formula: effective rate = tier rate / divisor
  const hasBonus = employee?.isTeamLeader || employee?.isSupervisor || false;
  const threshold = employee?.hoursThreshold || 1000;
  const lowDivisor = hasBonus ? 3.0 : 1.0;
  const highDivisor = hasBonus ? 5.5 : 1.0;

  if (totalHrs >= threshold) {
    return 5.0 / highDivisor;  // Standard: 5.0, TL/Sup: 0.9091
  }
  return 2.5 / lowDivisor;  // Standard: 2.5, TL/Sup: 0.8333
}

// POST: Create a new salary record
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      empId,
      empName,
      siteId,
      siteName,
      month,
      year,
      nationality,
      trade,
      employeeCode,
      slNo,
      totalHours,
      rtPerHour,
      totalSalary,
      deduction,
      advance,
      balanceSalary,
      isPaid,
      rateTier, // "standard" or "premium"
      totalWorkingHours, // optional: to update TotalEmployeeWorkingHours
      updateWorkingHours, // bidirectional sync flag
    } = body;

    const effectiveRateTier = rateTier || 'standard';

    // Validate required fields
    if (!empId || !empName || !siteId || !siteName || !month || !year) {
      return NextResponse.json(
        { success: false, error: 'empId, empName, siteId, siteName, month, and year are required' },
        { status: 400 }
      );
    }

    // Validate month format
    const monthRegex = /^\d{4}-\d{2}$/;
    if (!monthRegex.test(month)) {
      return NextResponse.json(
        { success: false, error: 'month must be in YYYY-MM format' },
        { status: 400 }
      );
    }

    // Check for unique constraint: empId + siteId + month + year + rateTier
    const existing = await db.salaryRecord.findUnique({
      where: {
        empId_siteId_month_year_rateTier: {
          empId,
          siteId,
          month,
          year: parseInt(String(year), 10),
          rateTier: effectiveRateTier,
        },
      },
    });

    if (existing && !existing.isDeleted) {
      return NextResponse.json(
        { success: false, error: `Salary record already exists for this employee, site, month, and rate tier (${effectiveRateTier})` },
        { status: 409 }
      );
    }

    // If there's a soft-deleted record, we can restore/update it
    if (existing && existing.isDeleted) {
      const updated = await db.salaryRecord.update({
        where: { id: existing.id },
        data: {
          empName,
          siteName,
          nationality: nationality || '',
          trade: trade || '',
          employeeCode: employeeCode || '',
          slNo: typeof slNo === 'number' ? slNo : 0,
          totalHours: typeof totalHours === 'number' ? totalHours : 0,
          rtPerHour: typeof rtPerHour === 'number' ? rtPerHour : 2.5,
          totalSalary: typeof totalSalary === 'number' ? totalSalary : 0,
          deduction: typeof deduction === 'number' ? deduction : 0,
          advance: typeof advance === 'number' ? advance : 0,
          balanceSalary: typeof balanceSalary === 'number' ? balanceSalary : 0,
          isPaid: typeof isPaid === 'boolean' ? isPaid : false,
          rateTier: effectiveRateTier,
          isDeleted: false,
        },
      });

      // Bidirectional sync: update TotalEmployeeWorkingHours for the month
      // Sum ALL salary records for this employee+month (both standard and premium)
      if (updateWorkingHours || typeof totalWorkingHours === 'number') {
        const allSalaryRecords = await db.salaryRecord.findMany({
          where: { empId, month, isDeleted: false },
        });
        const totalHoursFromSalary = allSalaryRecords.reduce((sum, sr) => sum + sr.totalHours, 0);

        await db.totalEmployeeWorkingHours.upsert({
          where: { empId_month: { empId, month } },
          update: {
            totalWorkingHours: totalHoursFromSalary,
            empName,
            isDeleted: false,
          },
          create: {
            empId,
            empName,
            month,
            totalWorkingHours: totalHoursFromSalary,
            rtPerHour: 2.5,
            isCustom: false,
          },
        });
      }

      return NextResponse.json({
        success: true,
        data: {
          salaryRecord: {
            ...updated,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          },
        },
      });
    }

    // Create new salary record
    const salaryRecord = await db.salaryRecord.create({
      data: {
        empId,
        empName,
        siteId,
        siteName,
        month,
        year: parseInt(String(year), 10),
        nationality: nationality || '',
        trade: trade || '',
        employeeCode: employeeCode || '',
        slNo: typeof slNo === 'number' ? slNo : 0,
        totalHours: typeof totalHours === 'number' ? totalHours : 0,
        rtPerHour: typeof rtPerHour === 'number' ? rtPerHour : 2.5,
        totalSalary: typeof totalSalary === 'number' ? totalSalary : 0,
        deduction: typeof deduction === 'number' ? deduction : 0,
        advance: typeof advance === 'number' ? advance : 0,
        balanceSalary: typeof balanceSalary === 'number' ? balanceSalary : 0,
        isPaid: typeof isPaid === 'boolean' ? isPaid : false,
        rateTier: effectiveRateTier,
      },
    });

    // Bidirectional sync: update TotalEmployeeWorkingHours for the month
    // Sum ALL salary records for this employee+month (both standard and premium)
    if (updateWorkingHours || typeof totalWorkingHours === 'number') {
      const allSalaryRecords = await db.salaryRecord.findMany({
        where: { empId, month, isDeleted: false },
      });
      const totalHoursFromSalary = allSalaryRecords.reduce((sum, sr) => sum + sr.totalHours, 0);

      await db.totalEmployeeWorkingHours.upsert({
        where: { empId_month: { empId, month } },
        update: {
          totalWorkingHours: totalHoursFromSalary,
          empName,
          isDeleted: false,
        },
        create: {
          empId,
          empName,
          month,
          totalWorkingHours: totalHoursFromSalary,
          rtPerHour: 2.5,
          isCustom: false,
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          salaryRecord: {
            ...salaryRecord,
            createdAt: salaryRecord.createdAt.toISOString(),
            updatedAt: salaryRecord.updatedAt.toISOString(),
          },
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// PUT: Update a salary record (by id)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      id,
      totalHours,
      rtPerHour,
      totalSalary,
      deduction,
      advance,
      balanceSalary,
      isPaid,
      rateTier,
      employeeCode,
      empName,
      nationality,
      trade,
      totalWorkingHours, // optional: to update TotalEmployeeWorkingHours
      updateWorkingHours, // bidirectional sync flag
    } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Salary record id is required' },
        { status: 400 }
      );
    }

    // Check the salary record exists
    const existing = await db.salaryRecord.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Salary record not found' },
        { status: 404 }
      );
    }

    if (existing.isDeleted) {
      return NextResponse.json(
        { success: false, error: 'Cannot update a deleted salary record' },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (typeof totalHours === 'number') updateData.totalHours = totalHours;
    if (typeof rtPerHour === 'number') updateData.rtPerHour = rtPerHour;
    if (typeof totalSalary === 'number') updateData.totalSalary = totalSalary;
    if (typeof deduction === 'number') updateData.deduction = deduction;
    if (typeof advance === 'number') updateData.advance = advance;
    if (typeof balanceSalary === 'number') updateData.balanceSalary = balanceSalary;
    if (typeof isPaid === 'boolean') updateData.isPaid = isPaid;
    if (typeof rateTier === 'string' && rateTier) updateData.rateTier = rateTier;
    if (typeof employeeCode === 'string') updateData.employeeCode = employeeCode;
    if (typeof empName === 'string' && empName) updateData.empName = empName;
    if (typeof nationality === 'string') updateData.nationality = nationality;
    if (typeof trade === 'string') updateData.trade = trade;

    const updated = await db.salaryRecord.update({
      where: { id },
      data: updateData,
    });

    // ── Cascade employee info changes back to Employee table and related tables ──
    const empId = existing.empId;

    // Cascade empName change
    if (typeof empName === 'string' && empName && empName !== existing.empName) {
      // Update Employee table
      await db.employee.update({ where: { id: empId }, data: { fullName: empName } });
      // Update all other SalaryRecords for this employee
      await db.salaryRecord.updateMany({
        where: { empId, id: { not: id }, isDeleted: false },
        data: { empName },
      });
      // Update TotalEmployeeWorkingHours
      await db.totalEmployeeWorkingHours.updateMany({
        where: { empId },
        data: { empName },
      });
      // Update EmpCountSitePerMonth
      await db.empCountSitePerMonth.updateMany({
        where: { empId },
        data: { empName },
      });
      // Update UniformRegistry
      await db.uniformRegistry.updateMany({
        where: { employeeId: empId },
        data: { employeeName: empName },
      });
    }

    // Cascade employeeCode change
    if (typeof employeeCode === 'string' && employeeCode !== existing.employeeCode) {
      // Check uniqueness before updating Employee.employeeId
      const currentEmp = await db.employee.findUnique({ where: { id: empId } });
      if (currentEmp && currentEmp.employeeId !== employeeCode) {
        const duplicate = await db.employee.findUnique({ where: { employeeId: employeeCode } });
        if (duplicate && duplicate.id !== empId) {
          // Don't fail, just skip Employee update but still update other SalaryRecords
        } else {
          await db.employee.update({ where: { id: empId }, data: { employeeId: employeeCode } });
        }
      }
      // Update all other SalaryRecords for this employee
      await db.salaryRecord.updateMany({
        where: { empId, id: { not: id }, isDeleted: false },
        data: { employeeCode },
      });
    }

    // Cascade trade change
    if (typeof trade === 'string' && trade !== existing.trade) {
      await db.employee.update({ where: { id: empId }, data: { trade, position: trade } });
      // Update all other SalaryRecords for this employee
      await db.salaryRecord.updateMany({
        where: { empId, id: { not: id }, isDeleted: false },
        data: { trade },
      });
    }

    // Cascade nationality change
    if (typeof nationality === 'string' && nationality !== existing.nationality) {
      await db.employee.update({ where: { id: empId }, data: { nationality: nationality || null } });
      // Update all other SalaryRecords for this employee
      await db.salaryRecord.updateMany({
        where: { empId, id: { not: id }, isDeleted: false },
        data: { nationality },
      });
    }

    // Bidirectional sync: update TotalEmployeeWorkingHours for the month
    // Sum ALL salary records for this employee+month (both standard and premium)
    if (updateWorkingHours || typeof totalWorkingHours === 'number') {
      const allSalaryRecords = await db.salaryRecord.findMany({
        where: { empId: existing.empId, month: existing.month, isDeleted: false },
      });
      const totalHoursFromSalary = allSalaryRecords.reduce((sum, sr) => sum + sr.totalHours, 0);

      const latestEmpName = typeof empName === 'string' && empName ? empName : existing.empName;

      await db.totalEmployeeWorkingHours.upsert({
        where: { empId_month: { empId: existing.empId, month: existing.month } },
        update: {
          totalWorkingHours: totalHoursFromSalary,
          isDeleted: false,
          empName: latestEmpName,
        },
        create: {
          empId: existing.empId,
          empName: latestEmpName,
          month: existing.month,
          totalWorkingHours: totalHoursFromSalary,
          rtPerHour: 2.5,
          isCustom: false,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        salaryRecord: {
          ...updated,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
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

// DELETE: Soft-delete a salary record (set isDeleted=true)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Salary record id is required' },
        { status: 400 }
      );
    }

    // Check the salary record exists
    const existing = await db.salaryRecord.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Salary record not found' },
        { status: 404 }
      );
    }

    if (existing.isDeleted) {
      return NextResponse.json(
        { success: false, error: 'Salary record is already deleted' },
        { status: 400 }
      );
    }

    // Soft delete
    const updated = await db.salaryRecord.update({
      where: { id },
      data: { isDeleted: true },
    });

    return NextResponse.json({
      success: true,
      data: {
        salaryRecord: {
          ...updated,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
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
