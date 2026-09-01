/**
 * migrate-rates.mjs
 * ---------------------------------------------------------------------------
 * One-off data migration for the new pay structure:
 *   - base rate (below threshold): 3.5 for everyone
 *   - above threshold: 6.0 for Helpers, 7.0 for other trades
 *
 * Steps:
 *   1. Upsert the BaseRate singleton with the new values.
 *   2. Re-run the allocation engine for every (month, year) that has salary
 *      records, so existing rows are re-split/re-priced with the new rates.
 *   3. Print a before/after summary for verification.
 * ---------------------------------------------------------------------------
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  // 1. BaseRate singleton
  const br = await db.baseRate.upsert({
    where: { id: 'singleton' },
    update: { baseLow: 3.5, helperHigh: 6.0, tradeHigh: 7.0 },
    create: { id: 'singleton', baseLow: 3.5, helperHigh: 6.0, tradeHigh: 7.0 },
  });
  console.log('BaseRate singleton:', JSON.stringify(br));

  // 2. Distinct months from salary records
  const records = await db.salaryRecord.findMany({
    where: { isDeleted: false },
    select: { month: true, year: true },
    distinct: ['month', 'year'],
  });
  const monthYears = records
    .map((r) => ({ month: r.month, year: r.year }))
    .sort((a, b) => (a.year - b.year) || a.month.localeCompare(b.month));
  console.log(`Months to re-allocate: ${monthYears.map((m) => `${m.month}/${m.year}`).join(', ') || '(none)'}`);

  if (monthYears.length === 0) {
    console.log('Nothing to re-allocate.');
    return;
  }

  // 3. Before snapshot
  const before = await db.salaryRecord.findMany({
    where: { isDeleted: false },
    select: { empName: true, totalHours: true, rtPerHour: true, totalSalary: true, rateTier: true },
  });
  const beforeTotal = before.reduce((s, r) => s + r.totalSalary, 0);
  const beforeHours = before.reduce((s, r) => s + r.totalHours, 0);

  // 4. Re-run the allocation engine per month (dynamic import of TS is not
  // possible here, so re-implement the split inline using the same rules).
  let processedMonths = 0;
  for (const { month, year } of monthYears) {
    const monthRecords = await db.salaryRecord.findMany({
      where: { month, year, isDeleted: false },
    });
    if (monthRecords.length === 0) continue;

    // Group by employee
    const byEmp = new Map();
    for (const r of monthRecords) {
      if (r.rateTier === 'camp_sitting') continue;
      if (!byEmp.has(r.empId)) byEmp.set(r.empId, []);
      byEmp.get(r.empId).push(r);
    }

    for (const [empId, recs] of byEmp) {
      const employee = await db.employee.findUnique({
        where: { id: empId },
        select: {
          id: true, fullName: true, employeeId: true, isTeamLeader: true,
          isSupervisor: true, hoursThreshold: true, nationality: true,
          trade: true, customHourlyRate: true,
        },
      });
      if (!employee) continue;
      const threshold = employee.hoursThreshold || 1000;
      const isCustom = employee.customHourlyRate !== null && employee.customHourlyRate !== undefined;
      const trade = (recs.find((r) => r.trade && r.trade.trim())?.trade) || employee.trade || 'Helper';
      const isHelper = trade.trim().toLowerCase() === 'helper';
      const lowRate = isCustom ? employee.customHourlyRate : 3.5;
      const highRate = isCustom ? employee.customHourlyRate : (isHelper ? 6.0 : 7.0);

      // Previous cumulative (all prior months, standard+premium only)
      const prevRecs = await db.salaryRecord.findMany({
        where: { empId, month: { lt: month }, isDeleted: false, rateTier: { in: ['standard', 'premium'] } },
        select: { totalHours: true },
      });
      let consumed = Math.min(prevRecs.reduce((s, r) => s + r.totalHours, 0), threshold);

      // Group by site (alphabetical, deterministic — same as engine)
      const siteMap = new Map();
      for (const r of recs) {
        if (r.rateTier === 'camp_sitting') continue;
        if (!siteMap.has(r.siteId)) {
          siteMap.set(r.siteId, {
            siteId: r.siteId,
            siteName: r.siteName,
            rawHours: 0,
            existingStandard: undefined,
            existingPremium: undefined,
          });
        }
        const s = siteMap.get(r.siteId);
        s.rawHours = Math.round((s.rawHours + r.totalHours) * 100) / 100;
        if (r.rateTier === 'standard') s.existingStandard = r;
        if (r.rateTier === 'premium') s.existingPremium = r;
      }
      const sites = [...siteMap.values()].sort((a, b) => a.siteName.localeCompare(b.siteName));

      for (const site of sites) {
        const remaining = Math.max(0, threshold - consumed);
        const raw = site.rawHours;
        let lowHours = 0;
        let highHours = 0;
        if (isCustom) {
          lowHours = raw;
        } else if (raw <= 0) {
          lowHours = 0; highHours = 0;
        } else if (remaining >= raw) {
          lowHours = raw;
          consumed += raw;
        } else if (remaining > 0) {
          lowHours = remaining;
          highHours = raw - remaining;
          consumed = threshold;
        } else {
          highHours = raw;
        }
        lowHours = Math.round(lowHours * 100) / 100;
        highHours = Math.round(highHours * 100) / 100;

        const carryIsPaid = site.existingStandard?.isPaid || site.existingPremium?.isPaid || false;

        // --- standard record ---
        if (lowHours > 0) {
          const existingStdRate = site.existingStandard?.rtPerHour;
          // Re-price rates that match the OLD defaults (2.5 / 3.0) — they are
          // system defaults, not deliberate user edits. Genuinely custom
          // rates (any other value) are preserved.
          const wasOldDefault = existingStdRate != null && (Math.abs(existingStdRate - 2.5) < 0.01 || Math.abs(existingStdRate - 3.0) < 0.01);
          const effLow = isCustom ? customRateVal(lowRate) : (wasOldDefault || existingStdRate == null ? lowRate : existingStdRate);
          const totalSalary = Math.round(lowHours * effLow * 100) / 100;
          const deduction = site.existingStandard?.deduction ?? 0;
          const advance = site.existingStandard?.advance ?? 0;
          const balance = Math.max(0, Math.round((totalSalary - deduction - advance) * 100) / 100);
          await db.salaryRecord.upsert({
            where: {
              empId_siteId_month_year_rateTier: { empId, siteId: site.siteId, month, year, rateTier: 'standard' },
            },
            update: {
              empName: employee.fullName, siteName: site.siteName,
              nationality: employee.nationality || '', trade,
              employeeCode: employee.employeeId || '',
              totalHours: lowHours, rtPerHour: effLow, totalSalary,
              deduction, advance, balanceSalary: balance,
              isPaid: carryIsPaid, isDeleted: false,
            },
            create: {
              empId, empName: employee.fullName, siteId: site.siteId, siteName: site.siteName,
              month, year, nationality: employee.nationality || '', trade,
              employeeCode: employee.employeeId || '', slNo: 0,
              totalHours: lowHours, rtPerHour: effLow, totalSalary,
              deduction, advance, balanceSalary: balance,
              isPaid: carryIsPaid, rateTier: 'standard',
            },
          });
        } else if (site.existingStandard && !site.existingStandard.isDeleted) {
          await db.salaryRecord.update({ where: { id: site.existingStandard.id }, data: { isDeleted: true } });
        }

        // --- premium record ---
        if (highHours > 0) {
          const existingPremRate = site.existingPremium?.rtPerHour;
          // Re-price rates that match the OLD defaults (5.0 / 5.5) to the new
          // trade-aware premium (6.0 helper / 7.0 trade). Custom rates kept.
          const wasOldPremDefault = existingPremRate != null && (Math.abs(existingPremRate - 5.0) < 0.01 || Math.abs(existingPremRate - 5.5) < 0.01);
          const effHigh = isCustom ? customRateVal(highRate) : (wasOldPremDefault || existingPremRate == null ? highRate : existingPremRate);
          const totalSalary = Math.round(highHours * effHigh * 100) / 100;
          const deduction = site.existingPremium?.deduction ?? 0;
          const advance = site.existingPremium?.advance ?? 0;
          const balance = Math.max(0, Math.round((totalSalary - deduction - advance) * 100) / 100);
          await db.salaryRecord.upsert({
            where: {
              empId_siteId_month_year_rateTier: { empId, siteId: site.siteId, month, year, rateTier: 'premium' },
            },
            update: {
              empName: employee.fullName, siteName: site.siteName,
              nationality: employee.nationality || '', trade,
              employeeCode: employee.employeeId || '',
              totalHours: highHours, rtPerHour: effHigh, totalSalary,
              deduction, advance, balanceSalary: balance,
              isPaid: carryIsPaid, isDeleted: false,
            },
            create: {
              empId, empName: employee.fullName, siteId: site.siteId, siteName: site.siteName,
              month, year, nationality: employee.nationality || '', trade,
              employeeCode: employee.employeeId || '', slNo: 0,
              totalHours: highHours, rtPerHour: effHigh, totalSalary,
              deduction, advance, balanceSalary: balance,
              isPaid: carryIsPaid, rateTier: 'premium',
            },
          });
        } else if (site.existingPremium && !site.existingPremium.isDeleted) {
          await db.salaryRecord.update({ where: { id: site.existingPremium.id }, data: { isDeleted: true } });
        }
      }
    }
    processedMonths++;
  }

  // 5. After snapshot
  const after = await db.salaryRecord.findMany({
    where: { isDeleted: false },
    select: { totalHours: true, rtPerHour: true, totalSalary: true, rateTier: true },
  });
  const afterTotal = after.reduce((s, r) => s + r.totalSalary, 0);
  const afterHours = after.reduce((s, r) => s + r.totalHours, 0);

  console.log(`Processed ${processedMonths} month(s).`);
  console.log(`Hours:  before=${beforeHours.toFixed(2)}  after=${afterHours.toFixed(2)}  (must match)`);
  console.log(`Salary: before=${beforeTotal.toFixed(2)}  after=${afterTotal.toFixed(2)}  (expected to change with new rates)`);

  // Rate distribution
  const dist = new Map();
  for (const r of after) {
    const k = `${r.rateTier}@${r.rtPerHour}`;
    dist.set(k, (dist.get(k) || 0) + 1);
  }
  console.log('Rate distribution:', JSON.stringify(Object.fromEntries(dist)));
}

function customRateVal(v) { return v; }

main()
  .catch((e) => { console.error('Migration failed:', e); process.exit(1); })
  .finally(() => db.$disconnect());
