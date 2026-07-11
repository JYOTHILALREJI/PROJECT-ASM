import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ---------------------------------------------------------------------------
// /api/advances/apply
// ---------------------------------------------------------------------------
// POST — apply pending advances to salary records for a given month/year.
//
// For each pending advance with effectiveMonth === month and effectiveYear === year:
//   1. Find the employee's salary records for that month (across ALL sites).
//   2. Sum the existing `advance` field on those records.
//   3. Add the advance.amount to ONE record (preferring 'standard' tier).
//   4. Recompute balanceSalary = totalSalary − deduction − advance.
//   5. Mark the advance as "applied" with appliedToSalaryRecordId set.
//
// This is idempotent: if an advance is already "applied", it is skipped.
//
// Body: { month: "YYYY-MM", year: number, dryRun?: boolean }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { month, year, dryRun = false } = body;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, error: 'month (YYYY-MM) is required' },
        { status: 400 },
      );
    }
    if (typeof year !== 'number') {
      return NextResponse.json(
        { success: false, error: 'year (number) is required' },
        { status: 400 },
      );
    }

    // Find all pending advances for this month/year
    const pendingAdvances = await db.advance.findMany({
      where: {
        effectiveMonth: month,
        effectiveYear: year,
        status: 'pending',
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (pendingAdvances.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          appliedCount: 0,
          skippedCount: 0,
          totalApplied: 0,
          advances: [],
          dryRun,
        },
      });
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        data: {
          appliedCount: 0,
          skippedCount: 0,
          totalApplied: 0,
          dryRun: true,
          wouldApply: pendingAdvances.map((a) => ({
            id: a.id,
            empId: a.empId,
            empName: a.empName,
            amount: a.amount,
            effectiveMonth: a.effectiveMonth,
            effectiveYear: a.effectiveYear,
          })),
        },
      });
    }

    let appliedCount = 0;
    let skippedCount = 0;
    const results: Array<{
      advanceId: string;
      empId: string;
      empName: string;
      amount: number;
      salaryRecordId: string | null;
      status: 'applied' | 'skipped_no_salary';
    }> = [];

    for (const advance of pendingAdvances) {
      // Find this employee's salary records for the month (across all sites)
      const salaryRecords = await db.salaryRecord.findMany({
        where: {
          empId: advance.empId,
          month,
          year,
          isDeleted: false,
        },
        orderBy: [{ rateTier: 'asc' }], // standard first
      });

      if (salaryRecords.length === 0) {
        // No salary record exists yet — skip; advance stays pending
        skippedCount++;
        results.push({
          advanceId: advance.id,
          empId: advance.empId,
          empName: advance.empName,
          amount: advance.amount,
          salaryRecordId: null,
          status: 'skipped_no_salary',
        });
        continue;
      }

      // Prefer the 'standard' tier record; fall back to the first available
      const targetRecord =
        salaryRecords.find((r) => r.rateTier === 'standard') || salaryRecords[0];

      // Check if the pending advance has already been merged into the salary
      // record's advance field (by /api/accounts + a save). If so, just mark
      // as applied without modifying the advance field (avoids double-count).
      if (targetRecord.advance >= advance.amount - 0.01) {
        const updatedAdvance = await db.advance.update({
          where: { id: advance.id },
          data: {
            status: 'applied',
            appliedToSalaryRecordId: targetRecord.id,
          },
        });

        appliedCount++;
        results.push({
          advanceId: updatedAdvance.id,
          empId: updatedAdvance.empId,
          empName: updatedAdvance.empName,
          amount: updatedAdvance.amount,
          salaryRecordId: targetRecord.id,
          status: 'applied',
        });
      } else {
        // Not merged — add the pending amount to the advance field
        const newAdvance = targetRecord.advance + advance.amount;
        const newBalance = targetRecord.totalSalary - targetRecord.deduction - newAdvance;

        const updatedRecord = await db.salaryRecord.update({
          where: { id: targetRecord.id },
          data: {
            advance: newAdvance,
            balanceSalary: newBalance,
          },
        });

        const updatedAdvance = await db.advance.update({
          where: { id: advance.id },
          data: {
            status: 'applied',
            appliedToSalaryRecordId: updatedRecord.id,
          },
        });

        appliedCount++;
        results.push({
          advanceId: updatedAdvance.id,
          empId: updatedAdvance.empId,
          empName: updatedAdvance.empName,
          amount: updatedAdvance.amount,
          salaryRecordId: updatedRecord.id,
          status: 'applied',
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        appliedCount,
        skippedCount,
        totalApplied: pendingAdvances.length,
        advances: results,
        dryRun: false,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[advances apply POST] error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
