import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';

// ---------------------------------------------------------------------------
// /api/advances
// ---------------------------------------------------------------------------
// GET  — list advances (optionally filtered by month/year/employee/status)
// POST — create one or more advances in bulk (the "save bucket" action)
// ---------------------------------------------------------------------------

interface AdvanceCreateItem {
  empId: string;
  empName?: string;
  employeeCode?: string;
  amount: number;
  reason?: string;
  effectiveMonth: string; // YYYY-MM
  effectiveYear: number;
}

/**
 * Compute the "next month" key (YYYY-MM) from today's date.
 * Advances are by default deducted from the NEXT salary cycle.
 */
function getNextMonthKey(now: Date = new Date()): { month: string; year: number } {
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { month, year: d.getFullYear() };
}

// GET /api/advances?month=YYYY-MM&year=YYYY&empId=...&status=pending|applied|cancelled
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const month = sp.get('month'); // YYYY-MM
    const year = sp.get('year');
    const empId = sp.get('empId');
    const status = sp.get('status');

    const where: Record<string, unknown> = { deletedAt: null };
    if (month) where.effectiveMonth = month;
    if (year) where.effectiveYear = parseInt(year, 10);
    if (empId) where.empId = empId;
    if (status) where.status = status;

    const advances = await db.advance.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { empName: 'asc' }],
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            employeeId: true,
            currentSite: true,
            currentSiteId: true,
            trade: true,
            nationality: true,
            status: true,
          },
        },
      },
    });

    // Group totals for quick UI display
    const totalAmount = advances.reduce((s, a) => s + a.amount, 0);
    const byStatus = {
      pending: advances.filter((a) => a.status === 'pending').reduce((s, a) => s + a.amount, 0),
      applied: advances.filter((a) => a.status === 'applied').reduce((s, a) => s + a.amount, 0),
      cancelled: advances.filter((a) => a.status === 'cancelled').reduce((s, a) => s + a.amount, 0),
    };

    return NextResponse.json({
      success: true,
      data: {
        advances: advances.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        totals: {
          count: advances.length,
          totalAmount,
          byStatus,
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// POST /api/advances
// Body: { advances: AdvanceCreateItem[], createdById?: string, creatorEmail?: string }
// OR   { empId, amount, reason, effectiveMonth?, effectiveYear?, createdById?, creatorEmail? }
//
// When `advances` array is provided, creates one row per item atomically.
// When single-employee fields are provided, creates a single row.
//
// Creator resolution (in priority order):
//   1. createdById (if it matches a user in the DB)
//   2. creatorEmail (if it matches a user in the DB)
//   3. First super_admin in the system
//   4. First any user in the system
//   5. Fail with a clear error
//
// This fallback chain handles the common case where the user's localStorage
// contains a stale user.id from a previous DB instance (e.g., after the
// developer re-cloned the repo and ran `prisma db push`).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const createdById = body.createdById as string | undefined;
    const creatorEmail = body.creatorEmail as string | undefined;

    // Resolve the creator server-side
    let creator = null as { id: string; email: string; name: string; role: string } | null;

    if (createdById) {
      creator = await db.user.findUnique({ where: { id: createdById } });
    }
    if (!creator && creatorEmail) {
      creator = await db.user.findUnique({
        where: { email: String(creatorEmail).toLowerCase() },
      });
    }
    if (!creator) {
      // Fallback: first super_admin
      creator = await db.user.findFirst({
        where: { role: 'super_admin', deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
    }
    if (!creator) {
      // Fallback: first any user
      creator = await db.user.findFirst({
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
    }
    if (!creator) {
      return NextResponse.json(
        {
          success: false,
          error:
            'No user account exists in the database. Please sign up first, then try again.',
        },
        { status: 400 },
      );
    }

    const resolvedCreatedById = creator.id;
    const defaultMonth = getNextMonthKey();

    // ── Bulk bucket mode ──
    if (Array.isArray(body.advances) && body.advances.length > 0) {
      const items: AdvanceCreateItem[] = body.advances;

      // Validate all items first
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.empId) {
          return NextResponse.json(
            { success: false, error: `Item ${i}: empId is required` },
            { status: 400 },
          );
        }
        if (typeof it.amount !== 'number' || it.amount <= 0) {
          return NextResponse.json(
            { success: false, error: `Item ${i}: amount must be a positive number` },
            { status: 400 },
          );
        }
        if (!it.effectiveMonth || !/^\d{4}-\d{2}$/.test(it.effectiveMonth)) {
          return NextResponse.json(
            { success: false, error: `Item ${i}: effectiveMonth must be YYYY-MM` },
            { status: 400 },
          );
        }
        if (!it.effectiveYear || typeof it.effectiveYear !== 'number') {
          return NextResponse.json(
            { success: false, error: `Item ${i}: effectiveYear is required` },
            { status: 400 },
          );
        }
      }

      // Fetch employees to denormalize names
      const empIds = [...new Set(items.map((i) => i.empId))];
      const employees = await db.employee.findMany({
        where: { id: { in: empIds } },
        select: { id: true, fullName: true, employeeId: true },
      });
      const empMap = new Map(employees.map((e) => [e.id, e]));

      // Create all rows in a transaction
      const created = await db.$transaction(
        items.map((it) => {
          const emp = empMap.get(it.empId);
          return db.advance.create({
            data: {
              empId: it.empId,
              empName: it.empName || emp?.fullName || '',
              employeeCode: it.employeeCode || emp?.employeeId || '',
              amount: it.amount,
              reason: it.reason || '',
              status: 'pending',
              effectiveMonth: it.effectiveMonth,
              effectiveYear: it.effectiveYear,
              createdById: resolvedCreatedById,
            },
          });
        }),
      );

      // Log the bulk advance creation
      const totalAmount = items.reduce((s, it) => s + it.amount, 0);
      await logActivity({
        userId: resolvedCreatedById,
        displayName: creator?.name || creator?.email || 'Admin',
        action: 'advance_create',
        entityType: 'advance',
        entityId: null,
        entityName: `${created.length} advance(s)`,
        description: `Created ${created.length} advance(s) totaling ${totalAmount.toFixed(2)} DHS for ${items[0]?.effectiveMonth || 'N/A'}`,
        details: {
          count: created.length,
          totalAmount,
          effectiveMonth: items[0]?.effectiveMonth,
          effectiveYear: items[0]?.effectiveYear,
          employees: items.map((it) => ({ empId: it.empId, empName: it.empName, amount: it.amount })),
        },
        request,
      });

      return NextResponse.json({
        success: true,
        data: {
          created: created.map((a) => ({
            ...a,
            createdAt: a.createdAt.toISOString(),
            updatedAt: a.updatedAt.toISOString(),
          })),
          count: created.length,
        },
      });
    }

    // ── Single-advance mode ──
    const {
      empId,
      amount,
      reason,
      effectiveMonth = defaultMonth.month,
      effectiveYear = defaultMonth.year,
    } = body;

    if (!empId) {
      return NextResponse.json(
        { success: false, error: 'empId is required (or provide advances array)' },
        { status: 400 },
      );
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'amount must be a positive number' },
        { status: 400 },
      );
    }

    const employee = await db.employee.findUnique({
      where: { id: empId },
      select: { id: true, fullName: true, employeeId: true },
    });
    if (!employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found' },
        { status: 404 },
      );
    }

    const advance = await db.advance.create({
      data: {
        empId,
        empName: employee.fullName,
        employeeCode: employee.employeeId,
        amount,
        reason: reason || '',
        status: 'pending',
        effectiveMonth,
        effectiveYear,
        createdById: resolvedCreatedById,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...advance,
        createdAt: advance.createdAt.toISOString(),
        updatedAt: advance.updatedAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[advances POST] error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
