import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { db } from '@/lib/db';
import { permanentlyDeleteEmployee } from '@/lib/soft-delete';
import { resolveStoragePath } from '@/lib/document-storage';
import { logActivity } from '@/lib/activity-logger';

/**
 * Recycle Bin — soft-deleted employees (isDeleted flag / deletedAt marker).
 *
 * GET    /api/recycle-bin    → list every employee sitting in the bin
 * DELETE /api/recycle-bin    → EMPTY the bin: permanently delete every
 *                              soft-deleted employee (irreversible).
 */

/** Child-record counts for the given employee ids (grouped, few queries). */
async function buildRelatedCounts(employeeIds: string[]) {
  const [attendance, salaries, documents, uniforms, warnings, fines, advances] = await Promise.all([
    db.attendance.groupBy({ by: ['employeeId'], where: { employeeId: { in: employeeIds } }, _count: { id: true } }),
    db.salaryRecord.groupBy({ by: ['empId'], where: { empId: { in: employeeIds } }, _count: { id: true } }),
    db.employeeDocument.groupBy({ by: ['employeeId'], where: { employeeId: { in: employeeIds } }, _count: { id: true } }),
    db.uniformRegistry.groupBy({ by: ['employeeId'], where: { employeeId: { in: employeeIds } }, _count: { id: true } }),
    db.warning.groupBy({ by: ['employeeId'], where: { employeeId: { in: employeeIds } }, _count: { id: true } }),
    db.fine.groupBy({ by: ['employeeId'], where: { employeeId: { in: employeeIds } }, _count: { id: true } }),
    db.advance.groupBy({ by: ['empId'], where: { empId: { in: employeeIds } }, _count: { id: true } }),
  ]);

  const byEmployee = <T extends { _count: { id: number } }>(
    rows: Array<{ employeeId?: string; empId?: string } & T>
  ) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = r.employeeId || r.empId;
      if (key) map.set(key, r._count.id);
    }
    return map;
  };

  const a = byEmployee(attendance);
  const s = byEmployee(salaries);
  const d = byEmployee(documents);
  const u = byEmployee(uniforms);
  const w = byEmployee(warnings);
  const f = byEmployee(fines);
  const av = byEmployee(advances);

  const get = (m: Map<string, number>, id: string) => m.get(id) ?? 0;

  return employeeIds.map((id) => ({
    employeeId: id,
    attendance: get(a, id),
    salaryRecords: get(s, id),
    documents: get(d, id),
    uniforms: get(u, id),
    warnings: get(w, id),
    fines: get(f, id),
    advances: get(av, id),
  }));
}

export async function GET() {
  try {
    const employees = await db.employee.findMany({
      where: {
        OR: [{ isDeleted: true }, { deletedAt: { not: null } }, { status: 'deleted' }],
      },
      select: {
        id: true,
        employeeId: true,
        fullName: true,
        position: true,
        trade: true,
        nationality: true,
        currentSite: true,
        status: true,
        isDeleted: true,
        deletedAt: true,
        createdAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });

    const ids = employees.map((e) => e.id);
    const countsById = ids.length ? await buildRelatedCounts(ids) : [];

    // Latest cancellation reason (if the employee was cancelled through the flow)
    const cancellations = ids.length
      ? await db.cancellationRequest.findMany({
          where: { employeeId: { in: ids } },
          select: { employeeId: true, reason: true },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const reasonByEmployee = new Map<string, string | null>();
    for (const c of cancellations) {
      if (!reasonByEmployee.has(c.employeeId)) {
        reasonByEmployee.set(c.employeeId, c.reason || null);
      }
    }

    const countsMap = new Map(countsById.map((c) => [c.employeeId, c]));

    return NextResponse.json({
      success: true,
      data: {
        employees: employees.map((e) => ({
          ...e,
          deletedAt: e.deletedAt?.toISOString() || null,
          createdAt: e.createdAt.toISOString(),
          cancellationReason: reasonByEmployee.get(e.id) || null,
          relatedCounts: countsMap.get(e.id) || {
            attendance: 0,
            salaryRecords: 0,
            documents: 0,
            uniforms: 0,
            warnings: 0,
            fines: 0,
            advances: 0,
          },
        })),
        total: employees.length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/** Remove the employee's document files off disk (best effort). */
function cleanupFiles(filePaths: string[]) {
  for (const rel of filePaths) {
    try {
      const abs = resolveStoragePath(rel);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {
      // best effort — never block the deletion on file cleanup
    }
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = typeof body.userId === 'string' ? body.userId : null;
    const actorDisplayName = typeof body.actorDisplayName === 'string' ? body.actorDisplayName : null;

    const binEmployees = await db.employee.findMany({
      where: {
        OR: [{ isDeleted: true }, { deletedAt: { not: null } }, { status: 'deleted' }],
      },
      select: { id: true, fullName: true, employeeId: true },
    });

    if (binEmployees.length === 0) {
      return NextResponse.json({ success: true, data: { deletedCount: 0 } });
    }

    let deletedCount = 0;
    const failures: Array<{ employee: string; error: string }> = [];
    const allFilePaths: string[] = [];

    for (const emp of binEmployees) {
      try {
        const { filePaths } = await permanentlyDeleteEmployee(emp.id);
        allFilePaths.push(...filePaths);
        deletedCount += 1;
      } catch (err) {
        failures.push({
          employee: `${emp.fullName} (${emp.employeeId})`,
          error: err instanceof Error ? err.message : 'unknown error',
        });
      }
    }

    cleanupFiles(allFilePaths);

    // Log the activity (best effort)
    try {
      await logActivity({
        userId,
        displayName: actorDisplayName || 'Admin',
        action: 'recycle_bin_emptied',
        entityType: 'employee',
        entityId: null,
        entityName: null,
        description: `Emptied the Recycle Bin — ${deletedCount} employee record(s) permanently deleted`,
        details: { deletedCount, failures },
        request,
      });
    } catch {
      // logging must never break the operation
    }

    return NextResponse.json({
      success: true,
      data: { deletedCount, failures },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
