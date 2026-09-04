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
  // ── Recurring deduction fields (optional) ──
  // If deductionType = "recurring", monthlyDeductionAmount is deducted each
  // month starting from effectiveMonth until the full amount is repaid OR
  // the inclusive recurringUntil month is reached (whichever comes first).
  deductionType?: 'one_time' | 'recurring';
  monthlyDeductionAmount?: number;
  recurringUntil?: string | null; // YYYY-MM, recurring only, inclusive end
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

/**
 * Compute the "next month" key (YYYY-MM) from today's date.
 * Advances are by default deducted from the NEXT salary cycle.
 */
function getNextMonthKey(now: Date = new Date()): { month: string; year: number } {
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { month, year: d.getFullYear() };
}

/**
 * Normalize + validate an incoming recurringUntil value.
 * Returns { ok: true, value } where value is "YYYY-MM" or null (no end),
 * or { ok: false, error } with a client-facing message.
 * Rules:
 *   - undefined/''/null            → null (no end — legacy behaviour)
 *   - invalid format               → rejected
 *   - recurring + until < start    → rejected (end must be >= effective month)
 */
function normalizeRecurringUntil(
  raw: unknown,
  effectiveMonth: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string' || !MONTH_KEY_RE.test(raw)) {
    return { ok: false, error: 'recurringUntil must be in YYYY-MM format' };
  }
  if (raw < effectiveMonth) {
    return {
      ok: false,
      error: `recurringUntil (${raw}) must not be earlier than the effective month (${effectiveMonth})`,
    };
  }
  return { ok: true, value: raw };
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

    // Defensively handle the case where the Advance table doesn't exist yet
    // (pre-migration). Return [] instead of crashing.
    let advances: Array<{
      id: string;
      empId: string;
      empName: string;
      employeeCode: string;
      amount: number;
      reason: string;
      status: string;
      effectiveMonth: string;
      effectiveYear: number;
      appliedToSalaryRecordId: string | null;
      createdById: string;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      employee: {
        id: string;
        fullName: string;
        employeeId: string;
        currentSite: string | null;
        currentSiteId: string | null;
        trade: string | null;
        nationality: string | null;
        status: string;
      } | null;
    }> = [];
    try {
      advances = await db.advance.findMany({
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
    } catch (err) {
      console.warn(
        '[advances] Advance table missing or query failed, returning [].',
        err instanceof Error ? err.message : err,
      );
      advances = [];
    }

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
      const untilValues = new Map<number, string | null>(); // item index -> normalized recurringUntil
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
        const until = normalizeRecurringUntil(it.recurringUntil, it.effectiveMonth);
        if (!until.ok) {
          return NextResponse.json(
            { success: false, error: `Item ${i} (${it.empName || it.empId}): ${until.error}` },
            { status: 400 },
          );
        }
        untilValues.set(i, until.value);
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
        items.map((it, i) => {
          const emp = empMap.get(it.empId);
          const isRecurring = it.deductionType === 'recurring';
          return db.advance.create({
            data: {
              empId: it.empId,
              empName: it.empName || emp?.fullName || '',
              employeeCode: it.employeeCode || emp?.employeeId || '',
              amount: it.amount,
              reason: it.reason || '',
              // Recurring advances start as "active" so installments begin
              // from effectiveMonth onward. One-time advances stay "pending"
              // until bulk-save / toggle-paid applies them.
              status: isRecurring ? 'active' : 'pending',
              effectiveMonth: it.effectiveMonth,
              effectiveYear: it.effectiveYear,
              createdById: resolvedCreatedById,
              // Recurring fields
              deductionType: isRecurring ? 'recurring' : 'one_time',
              monthlyDeductionAmount: isRecurring ? (it.monthlyDeductionAmount ?? null) : null,
              remainingBalance: isRecurring ? it.amount : null,
              recurringUntil: isRecurring ? (untilValues.get(i) ?? null) : null,
            },
          });
        }),
      );

      // Log the bulk advance creation
      const totalAmount = items.reduce((s, it) => s + it.amount, 0);
      // Display currency comes from the global app settings (default AED)
      const currencySetting = await db.appSetting.findUnique({ where: { key: 'currency' } });
      const currencyCode = currencySetting?.value || 'AED';
      await logActivity({
        userId: resolvedCreatedById,
        displayName: creator?.name || creator?.email || 'Admin',
        action: 'advance_create',
        entityType: 'advance',
        entityId: null,
        entityName: `${created.length} advance(s)`,
        description: `Created ${created.length} advance(s) totaling ${totalAmount.toFixed(2)} ${currencyCode} for ${items[0]?.effectiveMonth || 'N/A'}`,
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
      deductionType = 'one_time',
      monthlyDeductionAmount,
      recurringUntil,
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
    if (effectiveMonth && !MONTH_KEY_RE.test(effectiveMonth)) {
      return NextResponse.json(
        { success: false, error: 'effectiveMonth must be in YYYY-MM format' },
        { status: 400 },
      );
    }
    const normalizedUntil = normalizeRecurringUntil(
      deductionType === 'recurring' ? recurringUntil : undefined,
      effectiveMonth,
    );
    if (!normalizedUntil.ok) {
      return NextResponse.json(
        { success: false, error: normalizedUntil.error },
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

    const isRecurring = deductionType === 'recurring';
    const advance = await db.advance.create({
      data: {
        empId,
        empName: employee.fullName,
        employeeCode: employee.employeeId,
        amount,
        reason: reason || '',
        status: isRecurring ? 'active' : 'pending',
        effectiveMonth,
        effectiveYear,
        createdById: resolvedCreatedById,
        deductionType: isRecurring ? 'recurring' : 'one_time',
        monthlyDeductionAmount: isRecurring ? (typeof monthlyDeductionAmount === 'number' ? monthlyDeductionAmount : null) : null,
        remainingBalance: isRecurring ? amount : null,
        recurringUntil: isRecurring ? normalizedUntil.value : null,
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
