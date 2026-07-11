import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/salary-records/bulk-update — Bulk update multiple salary records
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { records } = body as {
      records: Array<{
        id: string;
        totalHours?: number;
        rtPerHour?: number;
        deduction?: number;
        advance?: number;
      }>;
    };

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        { success: false, error: 'records array is required and must not be empty' },
        { status: 400 }
      );
    }

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const rec of records) {
      try {
        if (!rec.id) {
          results.push({ id: rec.id || 'missing', success: false, error: 'Missing record id' });
          continue;
        }

        const existing = await db.salaryRecord.findUnique({ where: { id: rec.id } });
        if (!existing || existing.isDeleted) {
          results.push({ id: rec.id, success: false, error: 'Record not found or deleted' });
          continue;
        }

        const updateData: Record<string, unknown> = {};

        if (typeof rec.totalHours === 'number') {
          updateData.totalHours = Math.max(0, rec.totalHours);
        }
        if (typeof rec.rtPerHour === 'number') {
          updateData.rtPerHour = Math.max(0, rec.rtPerHour);
        }
        if (typeof rec.deduction === 'number') {
          updateData.deduction = Math.max(0, rec.deduction);
        }
        if (typeof rec.advance === 'number') {
          updateData.advance = Math.max(0, rec.advance);
        }

        // Recalculate totals
        const newTotalHours = typeof rec.totalHours === 'number' ? Math.max(0, rec.totalHours) : existing.totalHours;
        const newRtPerHour = typeof rec.rtPerHour === 'number' ? Math.max(0, rec.rtPerHour) : existing.rtPerHour;
        const newDeduction = typeof rec.deduction === 'number' ? Math.max(0, rec.deduction) : existing.deduction;
        const newAdvance = typeof rec.advance === 'number' ? Math.max(0, rec.advance) : existing.advance;

        updateData.totalSalary = newTotalHours * newRtPerHour;
        updateData.balanceSalary = newTotalHours * newRtPerHour - newDeduction - newAdvance;

        await db.salaryRecord.update({
          where: { id: rec.id },
          data: updateData,
        });

        results.push({ id: rec.id, success: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        results.push({ id: rec.id, success: false, error: msg });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: true,
      data: {
        updated: successCount,
        failed: failCount,
        results,
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
