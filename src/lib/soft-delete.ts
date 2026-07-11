import { db } from '@/lib/db';

/**
 * Cascade soft-delete for the Employee Management System.
 *
 * Soft-deletion NEVER removes rows from the database. Instead it stamps every
 * affected record with a `deletedAt` timestamp (the canonical marker) AND sets
 * the legacy soft-delete flags (`status='deleted'`, `isHidden`, `isDeleted`,
 * `deletedDate`) so that existing queries which still rely on those flags keep
 * working unchanged.
 *
 * When an Employee is soft-deleted, every child record that belongs to it is
 * soft-deleted too (Attendance, Warning, Fine, LeaveRequest, CancellationRequest,
 * UniformRegistry, SalaryRecord, TotalEmployeeWorkingHours, EmpCountSitePerMonth,
 * WorkLog). The same pattern applies to Site.
 */

const now = () => new Date();

/**
 * Soft-delete an Employee AND cascade to every related child table.
 * Runs inside a single transaction so the cascade is atomic.
 */
export async function cascadeSoftDeleteEmployee(employeeId: string): Promise<void> {
  const stamp = now();

  await db.$transaction(async (tx) => {
    // 1. Attendance — set deletedAt + legacy isHidden
    await tx.attendance.updateMany({
      where: { employeeId, deletedAt: null },
      data: { deletedAt: stamp, isHidden: true },
    });

    // 2. Warnings
    await tx.warning.updateMany({
      where: { employeeId, deletedAt: null },
      data: { deletedAt: stamp, isHidden: true },
    });

    // 3. Fines
    await tx.fine.updateMany({
      where: { employeeId, deletedAt: null },
      data: { deletedAt: stamp, isHidden: true },
    });

    // 4. Leave Requests
    await tx.leaveRequest.updateMany({
      where: { employeeId, deletedAt: null },
      data: { deletedAt: stamp, isHidden: true },
    });

    // 5. Cancellation Requests
    await tx.cancellationRequest.updateMany({
      where: { employeeId, deletedAt: null },
      data: { deletedAt: stamp, isHidden: true },
    });

    // 6. Uniform Registry
    await tx.uniformRegistry.updateMany({
      where: { employeeId, deletedAt: null },
      data: { deletedAt: stamp, isDeleted: true, isHidden: true },
    });

    // 7. Salary Records
    await tx.salaryRecord.updateMany({
      where: { empId: employeeId, deletedAt: null },
      data: { deletedAt: stamp, isDeleted: true },
    });

    // 8. Total Employee Working Hours
    await tx.totalEmployeeWorkingHours.updateMany({
      where: { empId: employeeId, deletedAt: null },
      data: { deletedAt: stamp, isDeleted: true },
    });

    // 9. Emp Count Site Per Month (site history)
    await tx.empCountSitePerMonth.updateMany({
      where: { empId: employeeId, deletedAt: null },
      data: { deletedAt: stamp, deletedDate: stamp },
    });

    // 10. Work Logs
    await tx.workLog.updateMany({
      where: { employeeId, deletedAt: null },
      data: { deletedAt: stamp },
    });

    // 11. Finally, the employee itself
    await tx.employee.update({
      where: { id: employeeId },
      data: { deletedAt: stamp, status: 'deleted' },
    });
  });
}

/**
 * Restore a previously soft-deleted Employee and ALL of its child records that
 * were soft-deleted at the same time. This reverses `cascadeSoftDeleteEmployee`.
 */
export async function restoreSoftDeletedEmployee(employeeId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.attendance.updateMany({
      where: { employeeId },
      data: { deletedAt: null, isHidden: false },
    });
    await tx.warning.updateMany({
      where: { employeeId },
      data: { deletedAt: null, isHidden: false },
    });
    await tx.fine.updateMany({
      where: { employeeId },
      data: { deletedAt: null, isHidden: false },
    });
    await tx.leaveRequest.updateMany({
      where: { employeeId },
      data: { deletedAt: null, isHidden: false },
    });
    await tx.cancellationRequest.updateMany({
      where: { employeeId },
      data: { deletedAt: null, isHidden: false },
    });
    await tx.uniformRegistry.updateMany({
      where: { employeeId },
      data: { deletedAt: null, isDeleted: false, isHidden: false },
    });
    await tx.salaryRecord.updateMany({
      where: { empId: employeeId },
      data: { deletedAt: null, isDeleted: false },
    });
    await tx.totalEmployeeWorkingHours.updateMany({
      where: { empId: employeeId },
      data: { deletedAt: null, isDeleted: false },
    });
    await tx.empCountSitePerMonth.updateMany({
      where: { empId: employeeId },
      data: { deletedAt: null, deletedDate: null },
    });
    await tx.workLog.updateMany({
      where: { employeeId },
      data: { deletedAt: null },
    });
    await tx.employee.update({
      where: { id: employeeId },
      data: { deletedAt: null, status: 'active' },
    });
  });
}

/**
 * Soft-delete a Site AND cascade to every related child table.
 * Employees assigned to the site are *unassigned* (not deleted) — their
 * currentSite / currentSiteId / teamLeaderSiteId / supervisorSiteId are cleared.
 */
export async function cascadeSoftDeleteSite(siteId: string): Promise<void> {
  const stamp = now();

  await db.$transaction(async (tx) => {
    // 1. Unassign all employees currently at this site (by FK + by denormalized name)
    await tx.employee.updateMany({
      where: { currentSiteId: siteId },
      data: { currentSiteId: null, currentSite: null },
    });
    await tx.employee.updateMany({
      where: { teamLeaderSiteId: siteId },
      data: { teamLeaderSiteId: null, isTeamLeader: false },
    });
    await tx.employee.updateMany({
      where: { supervisorSiteId: siteId },
      data: { supervisorSiteId: null, isSupervisor: false },
    });

    // 2. Emp Count Site Per Month
    await tx.empCountSitePerMonth.updateMany({
      where: { siteId, deletedAt: null },
      data: { deletedAt: stamp, deletedDate: stamp },
    });

    // 3. Site Month Activation
    await tx.siteMonthActivation.updateMany({
      where: { siteId, deletedAt: null },
      data: { deletedAt: stamp },
    });

    // 4. Work Logs for this site
    await tx.workLog.updateMany({
      where: { siteId, deletedAt: null },
      data: { deletedAt: stamp },
    });

    // 5. Salary Records for this site
    await tx.salaryRecord.updateMany({
      where: { siteId, deletedAt: null },
      data: { deletedAt: stamp, isDeleted: true },
    });

    // 6. The site itself
    await tx.site.update({
      where: { id: siteId },
      data: { deletedAt: stamp, isActive: false },
    });
  });
}

/**
 * Restore a previously soft-deleted Site.
 */
export async function restoreSoftDeletedSite(siteId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.empCountSitePerMonth.updateMany({
      where: { siteId },
      data: { deletedAt: null, deletedDate: null },
    });
    await tx.siteMonthActivation.updateMany({
      where: { siteId },
      data: { deletedAt: null },
    });
    await tx.workLog.updateMany({
      where: { siteId },
      data: { deletedAt: null },
    });
    await tx.salaryRecord.updateMany({
      where: { siteId },
      data: { deletedAt: null, isDeleted: false },
    });
    await tx.site.update({
      where: { id: siteId },
      data: { deletedAt: null, isActive: true },
    });
  });
}
