import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { allocateEmployeeHours, type AllocationResult } from '@/lib/allocation-engine';
import { recalcEmployeeFromMonth } from '@/lib/recalculation';

// ---------------------------------------------------------------------------
// POST /api/accounts/salary/bulk-save
// ---------------------------------------------------------------------------
// Accepts an array of salary records to save atomically. For each record:
//   - If salaryRecordId is provided → update by id
//   - If not → check unique key (empId+siteId+month+year+rateTier):
//       - exists & soft-deleted → restore and update
//       - exists & not deleted → update
//       - not exists → create new
//
// After saving ALL records:
//   1. If runAllocation is true (default), call the allocation engine to
//      recalculate splits and update TotalEmployeeWorkingHours.
//      NOTE: When runAllocation is true, the allocation engine is the
//      single source of truth for which records should exist. It handles
//      creating/updating/soft-deleting records as needed. We do NOT
//      soft-delete records before running the engine, because the engine
//      will recalculate the split and decide which records to keep/delete.
//   2. If runAllocation is false:
//      a. Soft-delete salary records for the same employee+site+month+year
//         that are NOT in the submitted list (handles removed split rows)
//      b. Manually update TotalEmployeeWorkingHours for all affected employees
// ---------------------------------------------------------------------------

interface BulkSaveRecord {
  salaryRecordId?: string; // if exists, update; otherwise create
  empId: string;
  empName: string;
  siteId: string;
  siteName: string;
  month: string;
  year: number;
  nationality?: string;
  trade?: string;
  employeeCode?: string;
  slNo?: number;
  totalHours: number;
  rtPerHour: number;
  totalSalary: number;
  deduction: number;
  advance: number;
  balanceSalary: number;
  isPaid: boolean;
  rateTier: string;
}

interface BulkSaveRequest {
  records: BulkSaveRecord[];
  runAllocation?: boolean; // default true
}

export async function POST(request: NextRequest) {
  try {
    const body: BulkSaveRequest = await request.json();
    const { records, runAllocation = true } = body;

    // ------------------------------------------------------------------
    // 1. Validate inputs
    // ------------------------------------------------------------------
    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        { success: false, error: 'records must be a non-empty array' },
        { status: 400 },
      );
    }

    const monthRegex = /^\d{4}-\d{2}$/;
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (!r.empId || !r.empName || !r.siteId || !r.siteName || !r.month || !r.year) {
        return NextResponse.json(
          { success: false, error: `Record at index ${i}: empId, empName, siteId, siteName, month, and year are required` },
          { status: 400 },
        );
      }
      if (!monthRegex.test(r.month)) {
        return NextResponse.json(
          { success: false, error: `Record at index ${i}: month must be in YYYY-MM format` },
          { status: 400 },
        );
      }
      if (r.rateTier && r.rateTier !== 'standard' && r.rateTier !== 'premium') {
        return NextResponse.json(
          { success: false, error: `Record at index ${i}: rateTier must be "standard" or "premium"` },
          { status: 400 },
        );
      }
    }

    // ------------------------------------------------------------------
    // 2. Save each record
    // ------------------------------------------------------------------
    const savedRecords: Array<{
      id: string;
      empId: string;
      siteId: string;
      month: string;
      year: number;
      rateTier: string;
      action: 'created' | 'updated' | 'restored';
      totalHours: number;
      empName: string;
      siteName: string;
      rtPerHour: number;
    }> = [];

    for (const record of records) {
      const effectiveRateTier = record.rateTier || 'standard';
      const yearNum = typeof record.year === 'number' ? record.year : parseInt(String(record.year), 10);

      if (record.salaryRecordId) {
        // ── Update by id ──
        const existing = await db.salaryRecord.findUnique({
          where: { id: record.salaryRecordId },
        });

        if (!existing) {
          return NextResponse.json(
            { success: false, error: `Salary record with id "${record.salaryRecordId}" not found` },
            { status: 404 },
          );
        }

        const updated = await db.salaryRecord.update({
          where: { id: record.salaryRecordId },
          data: {
            empName: record.empName,
            siteName: record.siteName,
            nationality: record.nationality ?? existing.nationality,
            trade: record.trade ?? existing.trade,
            employeeCode: record.employeeCode ?? existing.employeeCode,
            slNo: typeof record.slNo === 'number' ? record.slNo : existing.slNo,
            totalHours: typeof record.totalHours === 'number' ? record.totalHours : existing.totalHours,
            rtPerHour: typeof record.rtPerHour === 'number' ? record.rtPerHour : existing.rtPerHour,
            totalSalary: typeof record.totalSalary === 'number' ? record.totalSalary : existing.totalSalary,
            deduction: typeof record.deduction === 'number' ? record.deduction : existing.deduction,
            advance: typeof record.advance === 'number' ? record.advance : existing.advance,
            balanceSalary: typeof record.balanceSalary === 'number' ? record.balanceSalary : existing.balanceSalary,
            isPaid: typeof record.isPaid === 'boolean' ? record.isPaid : existing.isPaid,
            rateTier: effectiveRateTier,
            isDeleted: false, // restore if soft-deleted
          },
        });

        savedRecords.push({
          id: updated.id,
          empId: updated.empId,
          siteId: updated.siteId,
          month: updated.month,
          year: updated.year,
          rateTier: updated.rateTier,
          action: existing.isDeleted ? 'restored' : 'updated',
          totalHours: updated.totalHours,
          empName: updated.empName,
          siteName: updated.siteName,
          rtPerHour: updated.rtPerHour,
        });
      } else {
        // ── No id provided: check unique key ──
        const existingByKey = await db.salaryRecord.findUnique({
          where: {
            empId_siteId_month_year_rateTier: {
              empId: record.empId,
              siteId: record.siteId,
              month: record.month,
              year: yearNum,
              rateTier: effectiveRateTier,
            },
          },
        });

        if (existingByKey) {
          // Update (whether soft-deleted or not)
          const updated = await db.salaryRecord.update({
            where: { id: existingByKey.id },
            data: {
              empName: record.empName,
              siteName: record.siteName,
              nationality: record.nationality ?? existingByKey.nationality,
              trade: record.trade ?? existingByKey.trade,
              employeeCode: record.employeeCode ?? existingByKey.employeeCode,
              slNo: typeof record.slNo === 'number' ? record.slNo : existingByKey.slNo,
              totalHours: typeof record.totalHours === 'number' ? record.totalHours : existingByKey.totalHours,
              rtPerHour: typeof record.rtPerHour === 'number' ? record.rtPerHour : existingByKey.rtPerHour,
              totalSalary: typeof record.totalSalary === 'number' ? record.totalSalary : existingByKey.totalSalary,
              deduction: typeof record.deduction === 'number' ? record.deduction : existingByKey.deduction,
              advance: typeof record.advance === 'number' ? record.advance : existingByKey.advance,
              balanceSalary: typeof record.balanceSalary === 'number' ? record.balanceSalary : existingByKey.balanceSalary,
              isPaid: typeof record.isPaid === 'boolean' ? record.isPaid : existingByKey.isPaid,
              rateTier: effectiveRateTier,
              isDeleted: false, // restore if soft-deleted
            },
          });

          savedRecords.push({
            id: updated.id,
            empId: updated.empId,
            siteId: updated.siteId,
            month: updated.month,
            year: updated.year,
            rateTier: updated.rateTier,
            action: existingByKey.isDeleted ? 'restored' : 'updated',
            totalHours: updated.totalHours,
            empName: updated.empName,
            siteName: updated.siteName,
            rtPerHour: updated.rtPerHour,
          });
        } else {
          // Create new
          const created = await db.salaryRecord.create({
            data: {
              empId: record.empId,
              empName: record.empName,
              siteId: record.siteId,
              siteName: record.siteName,
              month: record.month,
              year: yearNum,
              nationality: record.nationality || '',
              trade: record.trade || '',
              employeeCode: record.employeeCode || '',
              slNo: typeof record.slNo === 'number' ? record.slNo : 0,
              totalHours: typeof record.totalHours === 'number' ? record.totalHours : 0,
              rtPerHour: typeof record.rtPerHour === 'number' ? record.rtPerHour : 2.5,
              totalSalary: typeof record.totalSalary === 'number' ? record.totalSalary : 0,
              deduction: typeof record.deduction === 'number' ? record.deduction : 0,
              advance: typeof record.advance === 'number' ? record.advance : 0,
              balanceSalary: typeof record.balanceSalary === 'number' ? record.balanceSalary : 0,
              isPaid: typeof record.isPaid === 'boolean' ? record.isPaid : false,
              rateTier: effectiveRateTier,
            },
          });

          savedRecords.push({
            id: created.id,
            empId: created.empId,
            siteId: created.siteId,
            month: created.month,
            year: created.year,
            rateTier: created.rateTier,
            action: 'created',
            totalHours: created.totalHours,
            empName: created.empName,
            siteName: created.siteName,
            rtPerHour: created.rtPerHour,
          });
        }
      }
    }

    // ------------------------------------------------------------------
    // 3. Handle orphan record cleanup + allocation or manual update
    // ------------------------------------------------------------------
    let softDeletedCount = 0;

    if (runAllocation) {
      // ── When allocation engine runs, it is the source of truth ──
      // The allocation engine will:
      //   - Read all salary records for the month
      //   - Recalculate the correct split for each employee
      //   - Upsert standard/premium records as needed
      //   - Soft-delete records that should no longer exist
      //
      // We do NOT do pre-emptive soft-deletes here because:
      //   1. The user may have edited totalHours but the UI still shows
      //      the old split (lowRateHours/highRateHours). The allocation
      //      engine will recalculate the split based on cumulative hours.
      //   2. Pre-emptively deleting a premium record that the allocation
      //      engine would want to keep causes data loss (the deletion bug).

      // Get unique (month, year) combinations from saved records
      const monthYearCombos = new Map<string, number>();
      for (const r of savedRecords) {
        if (!monthYearCombos.has(r.month)) {
          monthYearCombos.set(r.month, r.year);
        }
      }

      // Run allocation for each unique month+year
      const allocationResults: AllocationResult[] = [];
      for (const [month, year] of monthYearCombos) {
        const result = await allocateEmployeeHours(month, year);
        allocationResults.push(result);
      }

      const allocationResult = allocationResults.length === 1 ? allocationResults[0] : allocationResults;

      // Ensure all employees with new salary records have:
      // 1. TotalEmployeeWorkingHours entries (for monthly tracking)
      // 2. EmpCountSitePerMonth entries (so they show up in the dropdown)
      for (const record of savedRecords) {
        const existingWh = await db.totalEmployeeWorkingHours.findUnique({
          where: { empId_month: { empId: record.empId, month: record.month } },
        });

        if (!existingWh) {
          // Create a new working hours entry for this employee+month
          const totalHoursForMonth = await db.salaryRecord.findMany({
            where: {
              empId: record.empId,
              month: record.month,
              isDeleted: false,
            },
          });

          const totalHours = totalHoursForMonth.reduce((sum, sr) => sum + sr.totalHours, 0);

          await db.totalEmployeeWorkingHours.create({
            data: {
              empId: record.empId,
              empName: record.empName,
              month: record.month,
              totalWorkingHours: totalHours,
              rtPerHour: record.rtPerHour,
              isCustom: false,
            },
          });
        }

        // Also ensure the employee is in empCountSitePerMonth so they show up in dropdowns
        const existingEmpCount = await db.empCountSitePerMonth.findUnique({
          where: {
            empId_siteId_month: {
              empId: record.empId,
              siteId: record.siteId,
              month: record.month,
            },
          },
        });

        if (!existingEmpCount) {
          await db.empCountSitePerMonth.create({
            data: {
              empId: record.empId,
              empName: record.empName,
              siteId: record.siteId,
              siteName: record.siteName,
              month: record.month,
              deletedDate: null,
            },
          });
        }
      }

      // ── Sync WorkLog entries so the employee hours ledger reflects accounts data ──
      // IMPORTANT: Use post-allocation salary records (not savedRecords) because
      // the allocation engine may have changed the split, created new records,
      // or soft-deleted existing ones. The WorkLog must reflect the final state.
      const affectedEmpIdsForWorkLog = new Set(savedRecords.map((r) => r.empId));
      const affectedMonthsForWorkLog = new Set(savedRecords.map((r) => r.month));
      const postAllocationRecords = await db.salaryRecord.findMany({
        where: {
          empId: { in: Array.from(affectedEmpIdsForWorkLog) },
          month: { in: Array.from(affectedMonthsForWorkLog) },
          isDeleted: false,
        },
      });

      // ── Apply pending advances to the saved salary records ──
      // For each unique (month, year) in the saved records, find pending advances
      // and add their amount to the corresponding salary record's `advance` field.
      const monthYearCombosForAdvances = new Set(
        savedRecords.map((r) => `${r.month}|${r.year}`),
      );
      let advancesApplied = 0;
      let advancesSkipped = 0;
      for (const combo of monthYearCombosForAdvances) {
        const [advMonth, advYearStr] = combo.split('|');
        const advYear = parseInt(advYearStr, 10);

        const pendingAdvances = await db.advance.findMany({
          where: {
            effectiveMonth: advMonth,
            effectiveYear: advYear,
            status: 'pending',
            deletedAt: null,
          },
          orderBy: { createdAt: 'asc' },
        });

        for (const advance of pendingAdvances) {
          // Find this employee's salary records for this month/year (across all sites)
          const empSalaryRecords = await db.salaryRecord.findMany({
            where: {
              empId: advance.empId,
              month: advMonth,
              year: advYear,
              isDeleted: false,
            },
            orderBy: [{ rateTier: 'asc' }], // standard first
          });

          if (empSalaryRecords.length === 0) {
            // No salary record exists yet — skip; advance stays pending
            advancesSkipped++;
            continue;
          }

          // Prefer the 'standard' tier record; fall back to the first
          const targetRecord =
            empSalaryRecords.find((r) => r.rateTier === 'standard') || empSalaryRecords[0];

          const newAdvance = targetRecord.advance + advance.amount;
          const newBalance = targetRecord.totalSalary - targetRecord.deduction - newAdvance;

          const updatedSalaryRecord = await db.salaryRecord.update({
            where: { id: targetRecord.id },
            data: {
              advance: newAdvance,
              balanceSalary: newBalance,
            },
          });

          // Mark the advance as applied
          await db.advance.update({
            where: { id: advance.id },
            data: {
              status: 'applied',
              appliedToSalaryRecordId: updatedSalaryRecord.id,
            },
          });
          advancesApplied++;
        }
      }

      // Group post-allocation records by (empId, siteId, month, year) to compute total hours per employee-site-month
      const workLogSyncMap = new Map<string, { empId: string; siteId: string; year: number; month: number; totalHours: number }>();
      for (const record of postAllocationRecords) {
        const key = `${record.empId}|${record.siteId}|${record.month}|${record.year}`;
        const existing = workLogSyncMap.get(key);
        if (existing) {
          existing.totalHours += record.totalHours;
        } else {
          workLogSyncMap.set(key, {
            empId: record.empId,
            siteId: record.siteId,
            year: record.year,
            month: parseInt(record.month.split('-')[1], 10),
            totalHours: record.totalHours,
          });
        }
      }

      // Upsert WorkLog entries for each employee-site-month combination
      for (const [, syncEntry] of workLogSyncMap) {
        try {
          await db.workLog.upsert({
            where: {
              employeeId_siteId_year_month: {
                employeeId: syncEntry.empId,
                siteId: syncEntry.siteId,
                year: syncEntry.year,
                month: syncEntry.month,
              },
            },
            update: {
              hoursWorked: syncEntry.totalHours,
              deletedAt: null, // un-soft-delete if previously deleted
            },
            create: {
              employeeId: syncEntry.empId,
              siteId: syncEntry.siteId,
              year: syncEntry.year,
              month: syncEntry.month,
              hoursWorked: syncEntry.totalHours,
              allowances: 0,
              deductions: 0,
            },
          });
        } catch (workLogError: unknown) {
          console.error('[bulk-save] WorkLog sync failed for employee:', syncEntry.empId, workLogError);
          // Don't fail the whole operation if WorkLog sync fails
        }
      }

      // Also trigger recalculation for all affected employees so ledger data stays consistent
      const affectedEmpIdsForRecalc = new Set(savedRecords.map((r) => r.empId));
      for (const empId of affectedEmpIdsForRecalc) {
        try {
          // Get earliest month for this employee from saved records
          const empRecords = savedRecords.filter((r) => r.empId === empId);
          const earliestRecord = empRecords.reduce((earliest, r) => {
            const rDate = r.month + '-' + r.year;
            const eDate = earliest.month + '-' + earliest.year;
            return rDate < eDate ? r : earliest;
          }, empRecords[0]);

          if (earliestRecord) {
            await recalcEmployeeFromMonth(empId, earliestRecord.year, parseInt(earliestRecord.month.split('-')[1], 10));
          }
        } catch (recalcError: unknown) {
          console.error('[bulk-save] Recalculation failed for employee:', empId, recalcError);
          // Don't fail the whole operation if recalc fails
        }
      }

      // After allocation, count soft-deleted records for reporting
      // (the allocation engine handles soft-deletes internally)
      const affectedEmpIds = new Set(savedRecords.map((r) => r.empId));
      const affectedMonths = new Set(savedRecords.map((r) => r.month));
      for (const empId of affectedEmpIds) {
        for (const m of affectedMonths) {
          const deletedRecords = await db.salaryRecord.findMany({
            where: { empId, month: m, isDeleted: true },
            select: { id: true },
          });
          // Don't double-count — just note the count for reporting
        }
      }

      // ------------------------------------------------------------------
      // 4. Return results
      // ------------------------------------------------------------------
      // Fetch the final state of all saved records (after allocation may have
      // modified them) to return to the caller.
      const affectedEmployeeIds = new Set(savedRecords.map((r) => r.empId));
      const affectedMonthStrs = new Set(savedRecords.map((r) => r.month));
      const affectedYearNums = new Set(savedRecords.map((r) => r.year));

      // Get ALL non-deleted records for the affected employees+months
      // This ensures we return the complete picture after allocation
      const finalRecords = await db.salaryRecord.findMany({
        where: {
          empId: { in: Array.from(affectedEmployeeIds) },
          month: { in: Array.from(affectedMonthStrs) },
          isDeleted: false,
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          savedCount: savedRecords.length,
          softDeletedCount: 0, // Allocation engine handles deletes internally
          advancesApplied,
          advancesSkipped,
          records: finalRecords.map((r) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })),
          allocation: allocationResult,
        },
      });
    } else {
      // ── Manual mode (runAllocation = false) ──
      // In manual mode, we soft-delete records NOT in the submitted list
      // to handle removed split rows.

      const submittedKeys = new Set(
        savedRecords.map((r) => `${r.empId}|${r.siteId}|${r.month}|${r.year}|${r.rateTier}`),
      );

      // Unique (empId, siteId, month, year) combos from submitted records
      const empSiteMonthYearCombos = new Set(
        savedRecords.map((r) => `${r.empId}|${r.siteId}|${r.month}|${r.year}`),
      );

      for (const combo of empSiteMonthYearCombos) {
        const [empId, siteId, month, yearStr] = combo.split('|');
        const yearNum = parseInt(yearStr, 10);

        // Find all non-deleted salary records for this employee+site+month+year
        const existingRecords = await db.salaryRecord.findMany({
          where: {
            empId,
            siteId,
            month,
            year: yearNum,
            isDeleted: false,
          },
        });

        for (const existing of existingRecords) {
          const key = `${empId}|${siteId}|${month}|${yearNum}|${existing.rateTier}`;
          if (!submittedKeys.has(key)) {
            // This record is NOT in the submitted list — soft-delete it
            await db.salaryRecord.update({
              where: { id: existing.id },
              data: { isDeleted: true },
            });
            softDeletedCount++;
          }
        }
      }

      // Manually update TotalEmployeeWorkingHours for all affected employees
      const affectedEmpMonthCombos = new Set(
        savedRecords.map((r) => `${r.empId}|${r.month}`),
      );

      for (const combo of affectedEmpMonthCombos) {
        const [empId, month] = combo.split('|');

        // Sum all non-deleted salary records for this employee+month
        const allSalaryRecords = await db.salaryRecord.findMany({
          where: { empId, month, isDeleted: false },
        });
        const totalHoursFromSalary = allSalaryRecords.reduce(
          (sum, sr) => sum + sr.totalHours,
          0,
        );

        // Get employee name from the first record
        const empName = allSalaryRecords[0]?.empName || '';

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

      // ------------------------------------------------------------------
      // 5. Return results
      // ------------------------------------------------------------------
      const finalRecordIds = savedRecords.map((r) => r.id);
      const finalRecords = await db.salaryRecord.findMany({
        where: { id: { in: finalRecordIds } },
      });

      // Apply pending advances in manual mode too
      const manualMonthYearCombos = new Set(
        savedRecords.map((r) => `${r.month}|${r.year}`),
      );
      let manualAdvancesApplied = 0;
      let manualAdvancesSkipped = 0;
      for (const combo of manualMonthYearCombos) {
        const [advMonth, advYearStr] = combo.split('|');
        const advYear = parseInt(advYearStr, 10);
        const pendingAdvances = await db.advance.findMany({
          where: {
            effectiveMonth: advMonth,
            effectiveYear: advYear,
            status: 'pending',
            deletedAt: null,
          },
        });
        for (const advance of pendingAdvances) {
          const empSalaryRecords = await db.salaryRecord.findMany({
            where: { empId: advance.empId, month: advMonth, year: advYear, isDeleted: false },
            orderBy: [{ rateTier: 'asc' }],
          });
          if (empSalaryRecords.length === 0) {
            manualAdvancesSkipped++;
            continue;
          }
          const target = empSalaryRecords.find((r) => r.rateTier === 'standard') || empSalaryRecords[0];
          const newAdvance = target.advance + advance.amount;
          const newBalance = target.totalSalary - target.deduction - newAdvance;
          const updated = await db.salaryRecord.update({
            where: { id: target.id },
            data: { advance: newAdvance, balanceSalary: newBalance },
          });
          await db.advance.update({
            where: { id: advance.id },
            data: { status: 'applied', appliedToSalaryRecordId: updated.id },
          });
          manualAdvancesApplied++;
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          savedCount: savedRecords.length,
          softDeletedCount,
          advancesApplied: manualAdvancesApplied,
          advancesSkipped: manualAdvancesSkipped,
          records: finalRecords.map((r) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })),
          allocation: null,
        },
      });
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('[salary bulk-save POST] Error:', message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
