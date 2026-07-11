import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/crypto';
import { recalcEmployeeFull } from '@/lib/recalculation';
import { cascadeSoftDeleteEmployee } from '@/lib/soft-delete';

function decryptEmployee(employee: Record<string, unknown>) {
  if (employee.passportNumber) {
    employee.passportNumber = decrypt(employee.passportNumber as string);
  }
  if (employee.idNumber) {
    employee.idNumber = decrypt(employee.idNumber as string);
  }
  return employee;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const employee = await db.employee.findUnique({
      where: { id },
      include: {
        attendance: {
          orderBy: { date: 'desc' },
        },
        warnings: {
          orderBy: { createdAt: 'desc' },
        },
        fines: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    const decrypted = decryptEmployee({
      ...employee,
      dateOfBirth: employee.dateOfBirth?.toISOString() || null,
      joinDate: employee.joinDate?.toISOString() || null,
      createdAt: employee.createdAt.toISOString(),
      updatedAt: employee.updatedAt.toISOString(),
      attendance: employee.attendance.map((a: { createdAt: Date; updatedAt: Date }) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      warnings: employee.warnings.map((w: { createdAt: Date; updatedAt: Date }) => ({
        ...w,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
      })),
      fines: employee.fines.map((f: { createdAt: Date; updatedAt: Date }) => ({
        ...f,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
    });

    return NextResponse.json({
      success: true,
      data: { employee: decrypted },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await db.employee.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    const data: Record<string, unknown> = {};

    const updatableFields = [
      'fullName', 'nationality', 'phone', 'email', 'address',
      'emergencyContact', 'position', 'trade', 'companyName', 'passportStatus',
      'idStatus', 'currentSite', 'photo', 'status', 'employeeId', 'hoursThreshold',
      'currentSiteId', 'currentTotalWorkingHours',
    ];

    for (const field of updatableFields) {
      if (body[field] !== undefined) {
        data[field] = body[field];
      }
    }

    // Custom current total working hours — coerce to a non-negative float so it
    // can be set (or corrected) at any point in time.
    if (body.currentTotalWorkingHours !== undefined) {
      const parsed = parseFloat(body.currentTotalWorkingHours);
      data.currentTotalWorkingHours = isNaN(parsed) ? 0 : Math.max(0, parsed);
    }

    // Keep currentSiteId in sync with currentSite (site name) so the FK
    // relation stays valid even when legacy code updates by name only.
    if (body.currentSite !== undefined) {
      if (body.currentSite) {
        const matchedSite = await db.site.findFirst({
          where: { name: body.currentSite, deletedAt: null },
          select: { id: true },
        });
        data.currentSiteId = matchedSite?.id ?? null;
      } else {
        data.currentSiteId = null;
      }
    }

    // Validate employeeId uniqueness if being updated
    if (body.employeeId !== undefined) {
      if (!body.employeeId || !String(body.employeeId).trim()) {
        return NextResponse.json(
          { success: false, error: 'Employee ID cannot be empty' },
          { status: 400 }
        );
      }
      if (body.employeeId !== existing.employeeId) {
        const duplicateEmployee = await db.employee.findUnique({
          where: { employeeId: body.employeeId },
        });
        if (duplicateEmployee) {
          return NextResponse.json(
            { success: false, error: `Employee ID "${body.employeeId}" already exists. Please choose a different ID.` },
            { status: 409 }
          );
        }
      }
    }

    // Sync trade to position for backward compat
    if (body.trade !== undefined) {
      data.trade = body.trade;
      data.position = body.trade; // Keep position in sync
    }

    if (body.dateOfBirth) {
      data.dateOfBirth = new Date(body.dateOfBirth);
    }
    if (body.joinDate) {
      data.joinDate = new Date(body.joinDate);
    }
    if (body.rating !== undefined) {
      data.rating = body.rating;
    }

    // Handle team leader fields
    if (body.isTeamLeader !== undefined) {
      if (body.isTeamLeader === true) {
        const teamLeaderSiteId = body.teamLeaderSiteId || null;
        if (teamLeaderSiteId) {
          // Check if another employee is already team leader of this site
          const existingLeader = await db.employee.findFirst({
            where: {
              isTeamLeader: true,
              teamLeaderSiteId,
              id: { not: id },
              status: { not: 'deleted' },
            },
          });
          if (existingLeader) {
            return NextResponse.json(
              { success: false, error: `Another employee (${existingLeader.fullName}) is already team leader of this site.`, existingLeader: { id: existingLeader.id, fullName: existingLeader.fullName } },
              { status: 409 }
            );
          }
        }
        data.isTeamLeader = true;
        data.teamLeaderSiteId = teamLeaderSiteId;
      } else {
        data.isTeamLeader = false;
        data.teamLeaderSiteId = null;
      }
    } else if (body.teamLeaderSiteId !== undefined) {
      data.teamLeaderSiteId = body.teamLeaderSiteId || null;
    }

    // Handle supervisor fields
    if (body.isSupervisor !== undefined) {
      if (body.isSupervisor === true) {
        const supervisorSiteId = body.supervisorSiteId || null;
        if (supervisorSiteId) {
          // Check if another employee is already supervisor of this site
          const existingSupervisor = await db.employee.findFirst({
            where: {
              isSupervisor: true,
              supervisorSiteId,
              id: { not: id },
              status: { not: 'deleted' },
            },
          });
          if (existingSupervisor) {
            return NextResponse.json(
              { success: false, error: `Another employee (${existingSupervisor.fullName}) is already supervisor of this site.`, existingSupervisor: { id: existingSupervisor.id, fullName: existingSupervisor.fullName } },
              { status: 409 }
            );
          }
        }
        data.isSupervisor = true;
        data.supervisorSiteId = supervisorSiteId;
      } else {
        data.isSupervisor = false;
        data.supervisorSiteId = null;
      }
    } else if (body.supervisorSiteId !== undefined) {
      data.supervisorSiteId = body.supervisorSiteId || null;
    }

    // Handle force replace for team leader
    if (body.forceReplaceTeamLeader && body.teamLeaderSiteId) {
      // Remove existing team leader of this site
      await db.employee.updateMany({
        where: {
          isTeamLeader: true,
          teamLeaderSiteId: body.teamLeaderSiteId,
          id: { not: id },
        },
        data: {
          isTeamLeader: false,
          teamLeaderSiteId: null,
        },
      });
      data.isTeamLeader = true;
      data.teamLeaderSiteId = body.teamLeaderSiteId;
    }

    // Handle force replace for supervisor
    if (body.forceReplaceSupervisor && body.supervisorSiteId) {
      // Remove existing supervisor of this site
      await db.employee.updateMany({
        where: {
          isSupervisor: true,
          supervisorSiteId: body.supervisorSiteId,
          id: { not: id },
        },
        data: {
          isSupervisor: false,
          supervisorSiteId: null,
        },
      });
      data.isSupervisor = true;
      data.supervisorSiteId = body.supervisorSiteId;
    }

    // Handle role and customHourlyRate fields
    if (body.role !== undefined) {
      data.role = body.role;
    } else if (body.isTeamLeader !== undefined || body.isSupervisor !== undefined) {
      // Auto-derive role from isTeamLeader/isSupervisor
      const isTL = body.isTeamLeader !== undefined ? body.isTeamLeader : existing.isTeamLeader;
      const isSup = body.isSupervisor !== undefined ? body.isSupervisor : existing.isSupervisor;
      data.role = isSup ? 'Supervisor' : (isTL ? 'Team Leader' : 'Standard');
    }

    if (body.customHourlyRate !== undefined) {
      data.customHourlyRate = body.customHourlyRate;
    }

    // Encrypt sensitive fields
    if (body.passportNumber !== undefined) {
      data.passportNumber = body.passportNumber ? encrypt(body.passportNumber) : null;
    }
    if (body.idNumber !== undefined) {
      data.idNumber = body.idNumber ? encrypt(body.idNumber) : null;
    }

    const employee = await db.employee.update({
      where: { id },
      data: data as Parameters<typeof db.employee.update>[0]['data'],
    });

    // ── When currentSite changes, create/update EmpCountSitePerMonth for the current month ──
    if (body.currentSite !== undefined && body.currentSite !== existing.currentSite) {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // If employee was removed from a site (currentSite set to null)
      if (!body.currentSite && existing.currentSite) {
        // Find the old site and set removedDate on EmpCountSitePerMonth
        const oldSite = await db.site.findFirst({
          where: { name: existing.currentSite },
          select: { id: true, name: true },
        });
        if (oldSite) {
          // Set removedDate on any active records for this employee at the old site
          await db.empCountSitePerMonth.updateMany({
            where: {
              empId: id,
              siteId: oldSite.id,
              removedDate: null,
              deletedDate: null,
            },
            data: { removedDate: now },
          });
        }
      }

      // If employee is assigned to a new site
      if (body.currentSite) {
        const newSite = await db.site.findFirst({
          where: { name: body.currentSite },
          select: { id: true, name: true },
        });
        if (newSite) {
          // Check if there's already an active record for this employee at this site for this month
          const existingRecord = await db.empCountSitePerMonth.findUnique({
            where: {
              empId_siteId_month: {
                empId: id,
                siteId: newSite.id,
                month: currentMonth,
              },
            },
          });

          if (existingRecord) {
            // Update existing record - clear removedDate if it was set
            await db.empCountSitePerMonth.update({
              where: { id: existingRecord.id },
              data: {
                removedDate: null,
                deletedDate: null,
                empName: employee.fullName,
                siteName: newSite.name,
              },
            });
          } else {
            // Create new record
            await db.empCountSitePerMonth.create({
              data: {
                empId: id,
                empName: employee.fullName,
                siteId: newSite.id,
                siteName: newSite.name,
                month: currentMonth,
              },
            });
          }

          // Also create a WorkLog entry with 0 hours if none exists for this month
          // This ensures the employee shows up in the hours ledger
          const existingWorkLog = await db.workLog.findUnique({
            where: {
              employeeId_siteId_year_month: {
                employeeId: id,
                siteId: newSite.id,
                year: now.getFullYear(),
                month: now.getMonth() + 1,
              },
            },
          });

          if (!existingWorkLog) {
            await db.workLog.create({
              data: {
                employeeId: id,
                siteId: newSite.id,
                year: now.getFullYear(),
                month: now.getMonth() + 1,
                hoursWorked: 0,
                allowances: 0,
                deductions: 0,
              },
            });
          } else if (existingWorkLog.deletedAt) {
            // Un-soft-delete if it was previously deleted
            await db.workLog.update({
              where: { logId: existingWorkLog.logId },
              data: { deletedAt: null },
            });
          }
        }
      }
    }

    // If employeeId was updated, also update employeeCode in salary records
    if (body.employeeId && body.employeeId !== existing.employeeId) {
      await db.salaryRecord.updateMany({
        where: { empId: id },
        data: { employeeCode: body.employeeId },
      });
    }

    // Trigger full recalculation if role, customHourlyRate, hoursThreshold, isTeamLeader, or isSupervisor changed
    const needsRecalc =
      (body.role !== undefined && body.role !== existing.role) ||
      (body.customHourlyRate !== undefined && body.customHourlyRate !== existing.customHourlyRate) ||
      (body.hoursThreshold !== undefined && body.hoursThreshold !== existing.hoursThreshold) ||
      (body.isTeamLeader !== undefined && body.isTeamLeader !== existing.isTeamLeader) ||
      (body.isSupervisor !== undefined && body.isSupervisor !== existing.isSupervisor);

    let recalcResult = null;
    if (needsRecalc) {
      try {
        recalcResult = await recalcEmployeeFull(id);
      } catch (recalcError: unknown) {
        console.error('[employee PUT] Recalculation failed:', recalcError);
        // Don't fail the main update if recalc fails
      }
    }

    const decrypted = decryptEmployee({
      ...employee,
      dateOfBirth: employee.dateOfBirth?.toISOString() || null,
      joinDate: employee.joinDate?.toISOString() || null,
      createdAt: employee.createdAt.toISOString(),
      updatedAt: employee.updatedAt.toISOString(),
    });

    return NextResponse.json({
      success: true,
      data: { employee: decrypted },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const existing = await db.employee.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 }
      );
    }

    if (existing.status === 'pending_deletion') {
      return NextResponse.json(
        { success: false, error: 'Employee is pending deletion. Please use the delete request approval workflow.' },
        { status: 400 }
      );
    }

    // Cascade soft-delete: marks the employee and ALL related child records
    // (attendance, warnings, fines, leave requests, cancellation requests,
    // uniform registry, salary records, working hours, site history, work logs)
    // with deletedAt. No rows are ever hard-deleted.
    await cascadeSoftDeleteEmployee(id);

    return NextResponse.json({
      success: true,
      data: { employee: { id: existing.id, status: 'deleted' } },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
