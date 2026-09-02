/**
 * Comprehensive edge-case tests for attendance site attribution after mid-month
 * employee site transfers. Simulates the EXACT API calls the UI makes.
 *
 * Scenarios:
 *  A1. Core bug: mark D1 @S1 → move to S2 → mark D2 @S2 → D2.siteId must = S2
 *  A2. Mark with explicit siteId ≠ currentSiteId (past date at old site grid)
 *  A3. POST with NONEXISTENT siteId → must fall back to currentSiteId (no 500, no FK error)
 *  A4. POST with NO siteId → falls back to employee.currentSiteId
 *  A5. Bulk-mark WITH siteId → all records tagged the grid site
 *  A6. Bulk-mark WITHOUT siteId → currentSiteId fallback
 *  A7. Move BACK to S1 → removedDate cleared → mark D3 @S1 → siteId=S1
 *  A8. Clear (not_marked) at S2 → record status not_marked, siteId=S2
 *  A9. Salary split: S1 hours = 10 (D1), S2 hours = 10 (D2); after clearing D2 → S2 salary gone
 *  A10. Version capture: version row created for the RESOLVED site (S2), not current site mix-ups
 *  A11. site-assignments GET returns correct created/removed dates
 *  A12. Double move same month: S1 → S2 → S3; mark @S3 → siteId=S3; chain of assignments correct
 *  A13. Cross-month: Sept mark @S1 stays in Sept; Oct move + Oct mark @S2 → Oct record @S2
 *  A14. Undo simulation: mark D2 @S2, re-mark with explicit siteId=S1 (undo path) → siteId=S1
 *  A15. Employee with NO site + no siteId → 200, siteId null
 */
import { db } from '../src/lib/db';

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function d(offset: number) {
  const dt = new Date();
  dt.setDate(dt.getDate() + offset);
  return dt.toISOString().split('T')[0];
}

async function cleanup(tag: string) {
  const emps = await db.employee.findMany({ where: { employeeId: { startsWith: tag } } });
  for (const e of emps) {
    await db.attendance.deleteMany({ where: { employeeId: e.id } });
    await db.empCountSitePerMonth.deleteMany({ where: { empId: e.id } });
    await db.salaryRecord.deleteMany({ where: { empId: e.id } });
    await db.workLog.deleteMany({ where: { employeeId: e.id } });
    await db.totalEmployeeWorkingHours.deleteMany({ where: { empId: e.id } });
    await db.attendanceVersion.deleteMany({ where: { siteName: { startsWith: 'TEST' } } });
    await db.employee.delete({ where: { id: e.id } });
  }
  await db.site.deleteMany({ where: { name: { startsWith: 'TEST' } } });
}

async function ensureSite(name: string) {
  const found = await db.site.findFirst({ where: { name } });
  if (found) return found;
  const res = await api('POST', '/api/sites', { name, clientName: 'Test Client' });
  if (res.json?.data?.site?.id) return res.json.data.site;
  const again = await db.site.findFirst({ where: { name } });
  return again!;
}

async function createEmployee(code: string, site: { id: string; name: string }) {
  const res = await api('POST', '/api/employees', {
    fullName: `Test ${code}`,
    employeeId: code,
    trade: 'Helper',
    currentSite: site.name,
    currentSiteId: site.id,
    rating: 3,
    status: 'active',
  });
  return res.json?.data?.employee ?? res.json?.data;
}

async function main() {
  const D1 = d(-2), D2 = d(-1), D3 = d(0);
  const monthKey = D3.substring(0, 7);
  const yearNum = parseInt(monthKey.split('-')[0], 10);
  const inMonth = (dateStr: string) => dateStr.startsWith(monthKey);
  // dynamic salary expectations (marks may fall in the previous month)
  const expS1Hours = (inMonth(D1) ? 10 : 0) + (inMonth(D3) ? 10 : 0);
  const expS2Hours = inMonth(D2) ? 10 : 0;

  console.log('── cleanup ──');
  await cleanup('TEST-MV-');
  // remove previous repro leftovers
  await cleanup('TEST-MOVE-');

  console.log('── setup: 3 sites + employee at S1 ──');
  const S1 = await ensureSite('TEST SITE ALPHA');
  const S2 = await ensureSite('TEST SITE BETA');
  const S3 = await ensureSite('TEST SITE GAMMA');
  const emp = await createEmployee('TEST-MV-1', S1);
  check('employee created at S1', !!emp?.id && emp.currentSiteId === S1.id, JSON.stringify(emp).slice(0, 120));

  // ── A1: core scenario ──
  console.log('── A1: mark D1 @S1 → move → S2 → mark D2 @S2 ──');
  const m1 = await api('POST', '/api/attendance', { employeeId: emp.id, date: D1, status: 'present', siteId: S1.id });
  check('A1: mark D1 @S1 → 200', m1.status === 200 && m1.json?.data?.attendance?.siteId === S1.id, JSON.stringify(m1.json).slice(0, 150));

  const move1 = await api('PUT', `/api/employees/${emp.id}`, { currentSite: S2.name, currentSiteId: S2.id });
  check('A1: moved to S2', move1.status === 200 && move1.json?.data?.employee?.currentSiteId === S2.id, JSON.stringify(move1.json).slice(0, 200));

  const m2 = await api('POST', '/api/attendance', { employeeId: emp.id, date: D2, status: 'present', siteId: S2.id });
  check('A1: mark D2 @S2 → record.siteId = S2 (THE BUG)', m2.status === 200 && m2.json?.data?.attendance?.siteId === S2.id, `got ${m2.json?.data?.attendance?.siteId}`);

  const recD1 = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: D1 } } });
  const recD2 = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: D2 } } });
  check('A1: D1 record still @S1', recD1?.siteId === S1.id, `got ${recD1?.siteId}`);
  check('A1: D2 record @S2 in DB', recD2?.siteId === S2.id, `got ${recD2?.siteId}`);

  // ── A2: mark PAST date at OLD site grid (siteId=S1 while current=S2) ──
  console.log('── A2: mark another past date @S1 grid while employee currently at S2 ──');
  const D0 = d(-3);
  const m0 = await api('POST', '/api/attendance', { employeeId: emp.id, date: D0, status: 'present', siteId: S1.id });
  check('A2: past-date mark @S1 → siteId=S1 (not current site S2)', m0.status === 200 && m0.json?.data?.attendance?.siteId === S1.id, `got ${m0.json?.data?.attendance?.siteId}`);
  await db.attendance.delete({ where: { employeeId_date: { employeeId: emp.id, date: D0 } } });

  // ── A3: nonexistent siteId → fallback, no 500 ──
  console.log('── A3: POST with bogus siteId ──');
  const m3 = await api('POST', '/api/attendance', { employeeId: emp.id, date: D0, status: 'present', siteId: 'nonexistent-site-id-xyz' });
  check('A3: bogus siteId → 200 (fallback to currentSiteId=S2)', m3.status === 200 && m3.json?.data?.attendance?.siteId === S2.id, `status=${m3.status} siteId=${m3.json?.data?.attendance?.siteId}`);
  await db.attendance.delete({ where: { employeeId_date: { employeeId: emp.id, date: D0 } } }).catch(() => {});

  // ── A4: NO siteId → currentSiteId fallback ──
  console.log('── A4: POST without siteId ──');
  const m4 = await api('POST', '/api/attendance', { employeeId: emp.id, date: D0, status: 'present' });
  check('A4: no siteId → falls back to currentSite=S2', m4.status === 200 && m4.json?.data?.attendance?.siteId === S2.id, `got ${m4.json?.data?.attendance?.siteId}`);
  await db.attendance.delete({ where: { employeeId_date: { employeeId: emp.id, date: D0 } } });

  // ── A5: bulk-mark WITH siteId (S1 grid, employee currently at S2) ──
  console.log('── A5: bulk-mark @S1 grid with employee currently at S2 ──');
  const b1 = await api('POST', '/api/attendance/bulk-mark', { date: D0, status: 'present', employeeIds: [emp.id], siteId: S1.id });
  const recD0 = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: D0 } } });
  check('A5: bulk-mark @S1 → record tagged S1 (not S2)', b1.status === 200 && recD0?.siteId === S1.id, `got ${recD0?.siteId}`);
  await db.attendance.delete({ where: { employeeId_date: { employeeId: emp.id, date: D0 } } });

  // ── A6: bulk-mark WITHOUT siteId → currentSiteId ──
  console.log('── A6: bulk-mark without siteId ──');
  await api('POST', '/api/attendance/bulk-mark', { date: D0, status: 'present', employeeIds: [emp.id] });
  const recD0b = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: D0 } } });
  check('A6: bulk-mark no siteId → currentSite=S2', recD0b?.siteId === S2.id, `got ${recD0b?.siteId}`);
  await db.attendance.delete({ where: { employeeId_date: { employeeId: emp.id, date: D0 } } });

  // ── A7: move BACK to S1 → removedDate cleared → mark D3 @S1 ──
  console.log('── A7: move back to S1 + mark today @S1 ──');
  const moveBack = await api('PUT', `/api/employees/${emp.id}`, { currentSite: S1.name, currentSiteId: S1.id });
  check('A7: moved back to S1', moveBack.status === 200 && moveBack.json?.data?.employee?.currentSiteId === S1.id);
  const m7 = await api('POST', '/api/attendance', { employeeId: emp.id, date: D3, status: 'present', siteId: S1.id });
  check('A7: mark D3 @S1 → siteId=S1', m7.status === 200 && m7.json?.data?.attendance?.siteId === S1.id, `got ${m7.json?.data?.attendance?.siteId}`);

  const asg7 = await db.empCountSitePerMonth.findMany({ where: { empId: emp.id, month: monthKey } });
  const s1Asg = asg7.find((a) => a.siteId === S1.id);
  const s2Asg = asg7.find((a) => a.siteId === S2.id);
  check('A7: S1 assignment removedDate cleared (active)', !!s1Asg && s1Asg.removedDate === null, JSON.stringify(s1Asg?.removedDate));
  check('A7: S2 assignment has removedDate set', !!s2Asg && s2Asg.removedDate !== null);

  // ── A14: undo simulation — re-mark D2 with explicit siteId=S2 again after clearing ──
  console.log('── A14: undo path — explicit siteId re-writes at original site ──');
  // clear D2 (as handleClear does)
  await api('POST', '/api/attendance', { employeeId: emp.id, date: D2, status: 'not_marked', siteId: S2.id });
  // undo restores 'present' with the recorded siteId S2 (employee currently at S1!)
  const m14 = await api('POST', '/api/attendance', { employeeId: emp.id, date: D2, status: 'present', siteId: S2.id });
  const recD2b = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: D2 } } });
  check('A14: undo-restore @S2 while employee at S1 → siteId=S2', m14.status === 200 && recD2b?.siteId === S2.id, `got ${recD2b?.siteId}`);

  // ── A8/A9: salary split + clear behavior ──
  console.log('── A8/A9: salary per site + clearing D2 removes S2 salary ──');
  await new Promise((r) => setTimeout(r, 1500)); // let sync finish
  const sal = await db.salaryRecord.findMany({ where: { empId: emp.id, month: monthKey, isDeleted: false } });
  const s1Sal = sal.find((s) => s.siteId === S1.id && s.rateTier === 'standard');
  const s2Sal = sal.find((s) => s.siteId === S2.id && s.rateTier === 'standard');
  check(`A9: S1 salary = ${expS1Hours}h (marks @S1 in ${monthKey})`, !!s1Sal && s1Sal.totalHours === expS1Hours, `got ${s1Sal?.totalHours}`);
  check(`A9: S2 salary = ${expS2Hours}h (D2)`, expS2Hours === 0 || (!!s2Sal && s2Sal.totalHours === expS2Hours), `got ${s2Sal?.totalHours}`);

  const clearD2 = await api('POST', '/api/attendance', { employeeId: emp.id, date: D2, status: 'not_marked', siteId: S2.id });
  check('A8: clear D2 @S2 → 200', clearD2.status === 200);
  await new Promise((r) => setTimeout(r, 1500));
  const salAfter = await db.salaryRecord.findMany({ where: { empId: emp.id, month: monthKey, isDeleted: false } });
  const s2SalAfter = salAfter.find((s) => s.siteId === S2.id && s.rateTier === 'standard');
  check('A9: S2 salary removed after clearing D2', !s2SalAfter || s2SalAfter.totalHours === 0, `got ${s2SalAfter?.totalHours}`);
  const s1SalAfter = salAfter.find((s) => s.siteId === S1.id && s.rateTier === 'standard');
  check(`A9: S1 salary intact (${expS1Hours}h)`, !!s1SalAfter && s1SalAfter.totalHours === expS1Hours, `got ${s1SalAfter?.totalHours}`);

  // ── A10: version capture attributed to resolved site ──
  console.log('── A10: version capture @resolved site ──');
  const versions = await db.attendanceVersion.findMany({ where: { date: D2 }, orderBy: { versionNumber: 'desc' } });
  check('A10: a version exists for D2 tagged S2 (where mark was made)', versions.some((v) => v.siteId === S2.id), JSON.stringify(versions.map((v) => v.siteId)));
  const latestS2 = versions.find((v) => v.siteId === S2.id);
  if (latestS2) {
    const snap = JSON.parse(latestS2.snapshot) as Array<{ employeeId: string; status: string }>;
    const entry = snap.find((s) => s.employeeId === emp.id);
    // last capture was the clear (not_marked) — employee must APPEAR in the snapshot (moved-away inclusion fix)
    check('A10: moved employee present in S2 snapshot', !!entry, 'employee missing from snapshot');
  }

  // ── A11: site-assignments GET ──
  console.log('── A11: site-assignments API ──');
  const saRes = await api('GET', `/api/attendance/site-assignments?month=${monthKey}`);
  const sa = (saRes.json?.data?.assignments ?? []).filter((a: { empId: string }) => a.empId === emp.id);
  check('A11: two assignments returned (S1 + S2)', sa.length === 2, `got ${sa.length}`);
  const saS1 = sa.find((a: { siteId: string }) => a.siteId === S1.id);
  const saS2 = sa.find((a: { siteId: string }) => a.siteId === S2.id);
  check('A11: S1 active (removedDate null)', saS1 && saS1.removedDate === null);
  check('A11: S2 removed (removedDate set)', saS2 && saS2.removedDate !== null);

  // ── A12: double move S1 → S2 → S3 in the same month ──
  console.log('── A12: double move in one month ──');
  const emp2 = await createEmployee('TEST-MV-2', S1);
  await api('POST', '/api/attendance', { employeeId: emp2.id, date: D1, status: 'present', siteId: S1.id });
  await api('PUT', `/api/employees/${emp2.id}`, { currentSite: S2.name, currentSiteId: S2.id });
  await api('POST', '/api/attendance', { employeeId: emp2.id, date: D2, status: 'present', siteId: S2.id });
  await api('PUT', `/api/employees/${emp2.id}`, { currentSite: S3.name, currentSiteId: S3.id });
  const m12 = await api('POST', '/api/attendance', { employeeId: emp2.id, date: D3, status: 'present', siteId: S3.id });
  check('A12: mark D3 @S3 → siteId=S3', m12.status === 200 && m12.json?.data?.attendance?.siteId === S3.id, `got ${m12.json?.data?.attendance?.siteId}`);
  const asg12 = await db.empCountSitePerMonth.findMany({ where: { empId: emp2.id, month: monthKey } });
  check('A12: three assignment rows (S1 backfilled+removed, S2 removed, S3 active)',
    asg12.length === 3 &&
    asg12.find((a) => a.siteId === S1.id)?.removedDate !== null &&
    asg12.find((a) => a.siteId === S2.id)?.removedDate !== null &&
    asg12.find((a) => a.siteId === S3.id)?.removedDate === null,
    JSON.stringify(asg12.map((a) => ({ s: a.siteName, r: a.removedDate }))));
  const recs12 = await db.attendance.findMany({ where: { employeeId: emp2.id }, orderBy: { date: 'asc' } });
  check('A12: D1@S1, D2@S2, D3@S3', recs12[0]?.siteId === S1.id && recs12[1]?.siteId === S2.id && recs12[2]?.siteId === S3.id,
    JSON.stringify(recs12.map((r) => r.siteId)));

  // ── A13: cross-month isolation ──
  console.log('── A13: cross-month — prior month records untouched ──');
  const prevMonthDate = (() => {
    const dt = new Date();
    dt.setDate(1);
    dt.setMonth(dt.getMonth() - 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-15`;
  })();
  const emp3 = await createEmployee('TEST-MV-3', S1);
  await api('POST', '/api/attendance', { employeeId: emp3.id, date: prevMonthDate, status: 'present', siteId: S1.id });
  await api('PUT', `/api/employees/${emp3.id}`, { currentSite: S2.name, currentSiteId: S2.id });
  const m13 = await api('POST', '/api/attendance', { employeeId: emp3.id, date: D3, status: 'present', siteId: S2.id });
  const prevRec = await db.attendance.findUnique({ where: { employeeId_date: { employeeId: emp3.id, date: prevMonthDate } } });
  check('A13: prior-month record still @S1', prevRec?.siteId === S1.id, `got ${prevRec?.siteId}`);
  check('A13: this-month mark @S2', m13.status === 200 && m13.json?.data?.attendance?.siteId === S2.id);

  // ── A15: employee with no site ──
  console.log('── A15: employee with no site ──');
  const emp4Res = await api('POST', '/api/employees', {
    fullName: 'Test TEST-MV-4', employeeId: 'TEST-MV-4', trade: 'Helper', rating: 3, status: 'active',
  });
  const emp4 = emp4Res.json?.data?.employee ?? emp4Res.json?.data;
  const m15 = await api('POST', '/api/attendance', { employeeId: emp4.id, date: D3, status: 'no_site' });
  check('A15: mark for siteless employee → 200, siteId null', m15.status === 200 && m15.json?.data?.attendance?.siteId === null, `status=${m15.status} siteId=${m15.json?.data?.attendance?.siteId}`);

  // ── A16: move WITHOUT any prior marks — old-site row must be backfilled ──
  console.log('── A16: move employee with no marks/rows this month ──');
  const emp5 = await createEmployee('TEST-MV-5', S1);
  // no attendance marks at all — move immediately
  const mv5 = await api('PUT', `/api/employees/${emp5.id}`, { currentSite: S2.name, currentSiteId: S2.id });
  check('A16: move succeeded', mv5.status === 200);
  const asg16 = await db.empCountSitePerMonth.findMany({ where: { empId: emp5.id, month: monthKey } });
  const s1Row16 = asg16.find((a) => a.siteId === S1.id);
  check('A16: old-site row backfilled with removedDate', !!s1Row16 && s1Row16.removedDate !== null, JSON.stringify(asg16.map((a) => ({ s: a.siteName, r: a.removedDate }))));
  check('A16: new-site row active', asg16.find((a) => a.siteId === S2.id)?.removedDate === null);

  // ── Summary ──
  console.log(`\n════════ RESULT: ${pass} passed, ${fail} failed ════════`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach((f) => console.log('  - ' + f)); }
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => {
    // keep test data for browser verification of the core scenario; clean rest? clean all:
    await cleanup('TEST-MV-').catch(() => {});
    const left = await db.site.findMany({ where: { name: { startsWith: 'TEST' } } });
    await db.site.deleteMany({ where: { name: { startsWith: 'TEST' } } }).catch(() => {});
    console.log('cleaned. sites removed:', left.length);
    process.exit(0);
  });
