// ---------------------------------------------------------------------------
// advance-deduction.ts
// ---------------------------------------------------------------------------
// Helper library for recurring advance deductions.
//
// An advance can be:
//   - "one_time"  — the full amount is deducted in one month (effectiveMonth)
//   - "recurring" — monthlyDeductionAmount is deducted each month starting
//                   from effectiveMonth until remainingBalance reaches 0
//
// For recurring advances, this module computes the deduction amount for a
// given month, checks if a repayment already exists, and records repayments
// when salary records are saved/paid.
// ---------------------------------------------------------------------------

import { db } from '@/lib/db';

export interface RecurringAdvance {
  id: string;
  empId: string;
  empName: string;
  amount: number;
  monthlyDeductionAmount: number | null;
  remainingBalance: number | null;
  deductionType: string;
  status: string;
  effectiveMonth: string;
  effectiveYear: number;
  /** Optional inclusive END month "YYYY-MM" — deduction stops AFTER this month. */
  recurringUntil: string | null;
  reason: string;
}

export interface DeductionResult {
  totalDeduction: number;
  advances: Array<{
    advanceId: string;
    amount: number;
    isFinal: boolean;
  }>;
}

/**
 * Get all active recurring advances for a set of employees that should be
 * deducted in the given month.
 *
 * An advance is eligible for deduction in `monthKey` if:
 *   - deductionType = "recurring"
 *   - status = "active"
 *   - effectiveMonth <= monthKey
 *   - recurringUntil is null OR recurringUntil >= monthKey (inclusive end:
 *     the deduction still happens IN the until-month, then stops)
 *   - remainingBalance > 0
 *   - no repayment exists for (advanceId, monthKey) yet
 */
export async function getEligibleRecurringAdvances(
  employeeIds: string[],
  monthKey: string,
): Promise<Map<string, RecurringAdvance[]>> {
  const result = new Map<string, RecurringAdvance[]>();
  if (employeeIds.length === 0) return result;

  try {
    // Fetch all active recurring advances for these employees
    const advances = await (db as any).advance.findMany({
      where: {
        empId: { in: employeeIds },
        deductionType: 'recurring',
        status: 'active',
        deletedAt: null,
        effectiveMonth: { lte: monthKey },
      },
    });

    // Fetch existing repayments for this month to avoid double-deduction
    const repayments = await (db as any).advanceRepayment.findMany({
      where: {
        empId: { in: employeeIds },
        month: monthKey,
      },
      select: { advanceId: true },
    });
    const repaidAdvanceIds = new Set(repayments.map((r: any) => r.advanceId));

    for (const adv of advances) {
      const remaining = adv.remainingBalance ?? adv.amount;
      if (remaining <= 0) continue;
      if (repaidAdvanceIds.has(adv.id)) continue; // already deducted this month
      // Inclusive end month: once monthKey is past recurringUntil, stop.
      // ("YYYY-MM" strings compare correctly with < > operators.)
      if (adv.recurringUntil && adv.recurringUntil < monthKey) continue;

      const empId = adv.empId;
      if (!result.has(empId)) result.set(empId, []);
      result.get(empId)!.push({
        id: adv.id,
        empId: adv.empId,
        empName: adv.empName,
        amount: adv.amount,
        monthlyDeductionAmount: adv.monthlyDeductionAmount,
        remainingBalance: remaining,
        deductionType: adv.deductionType,
        status: adv.status,
        effectiveMonth: adv.effectiveMonth,
        effectiveYear: adv.effectiveYear,
        recurringUntil: adv.recurringUntil ?? null,
        reason: adv.reason,
      });
    }
  } catch {
    // Tables might not exist yet (pre-migration) — return empty map
  }

  return result;
}

/**
 * Compute the total recurring deduction for an employee in a given month.
 *
 * For each eligible advance, the deduction is:
 *   min(monthlyDeductionAmount, remainingBalance)
 *
 * Returns the total deduction amount and a breakdown per advance.
 */
export function computeMonthlyDeduction(
  advances: RecurringAdvance[],
): DeductionResult {
  let totalDeduction = 0;
  const breakdown: DeductionResult['advances'] = [];

  for (const adv of advances) {
    const monthlyAmount = adv.monthlyDeductionAmount ?? 0;
    if (monthlyAmount <= 0) continue;
    const remaining = adv.remainingBalance ?? adv.amount;
    if (remaining <= 0) continue;

    // Deduct the smaller of monthlyAmount or remainingBalance
    const deduction = Math.min(monthlyAmount, remaining);
    totalDeduction += deduction;
    breakdown.push({
      advanceId: adv.id,
      amount: deduction,
      isFinal: deduction >= remaining - 0.01,
    });
  }

  return { totalDeduction, advances: breakdown };
}

/**
 * Record repayments for the given deductions and update the advance's
 * remainingBalance. If remainingBalance reaches 0, mark the advance as
 * "completed".
 *
 * This should be called when salary records are saved (bulk-save) or marked
 * as paid (toggle-paid).
 */
export async function recordRepayments(
  deductions: DeductionResult['advances'],
  empId: string,
  monthKey: string,
  year: number,
  salaryRecordId: string | null,
): Promise<void> {
  for (const ded of deductions) {
    try {
      // Create the repayment record (unique on advanceId+month)
      await (db as any).advanceRepayment.upsert({
        where: {
          advanceId_month: { advanceId: ded.advanceId, month: monthKey },
        },
        update: {
          salaryRecordId,
          amount: ded.amount,
        },
        create: {
          advanceId: ded.advanceId,
          empId,
          salaryRecordId,
          month: monthKey,
          year,
          amount: ded.amount,
        },
      });

      // Decrement remainingBalance on the advance
      const advance = await (db as any).advance.findUnique({
        where: { id: ded.advanceId },
        select: { remainingBalance: true, amount: true },
      });
      if (advance) {
        const currentRemaining = advance.remainingBalance ?? advance.amount;
        const newRemaining = Math.max(0, currentRemaining - ded.amount);

        // If this is the final installment, mark as completed
        const newStatus = ded.isFinal ? 'completed' : 'active';

        await (db as any).advance.update({
          where: { id: ded.advanceId },
          data: {
            remainingBalance: newRemaining,
            status: newStatus,
            appliedToSalaryRecordId: ded.isFinal ? salaryRecordId : undefined,
          },
        });
      }
    } catch (err) {
      console.warn(
        `[advance-deduction] Failed to record repayment for advance ${ded.advanceId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Update the monthly deduction amount for a recurring advance.
 * This changes how much is deducted from the NEXT month onward — previous
 * repayments are not affected.
 *
 * If the new amount is 0 or null, the advance is effectively paused (no
 * future deductions until changed again).
 */
export async function updateMonthlyDeductionAmount(
  advanceId: string,
  newMonthlyAmount: number,
): Promise<void> {
  try {
    await (db as any).advance.update({
      where: { id: advanceId },
      data: {
        monthlyDeductionAmount: newMonthlyAmount,
        // If the advance was completed and the amount is changed, reactivate it
        status: 'active',
      },
    });
  } catch (err) {
    console.warn(
      `[advance-deduction] Failed to update monthly amount for advance ${advanceId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Get the repayment history for an advance (for UI display).
 */
export async function getRepaymentHistory(
  advanceId: string,
): Promise<Array<{
  id: string;
  month: string;
  year: number;
  amount: number;
  salaryRecordId: string | null;
  createdAt: Date;
}>> {
  try {
    const repayments = await (db as any).advanceRepayment.findMany({
      where: { advanceId },
      orderBy: { month: 'asc' },
    });
    return repayments;
  } catch {
    return [];
  }
}
