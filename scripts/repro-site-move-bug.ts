/**
 * Reproduce: employee moved Site1 -> Site2 mid-month; marking Date2 at Site2
 * saves the record with the WRONG siteId (Site1).
 *
 * Simulates the exact flow the UI performs:
 *  1. PUT  /api/employees/[id]  (create employee at Site 1)
 *  2. POST /api/attendance      (mark Date1 with siteId = Site1)
 *  3. PUT  /api/employees/[id]  (move to Site 2 — body exactly like the UI sends)
 *  4. POST /api/attendance      (mark Date2 with siteId = Site2)
 *  5. Inspect DB rows + EmpCountSitePerMonth assignments
 */
import { db } from '../src/lib/db';

const BASE = 'http://localhost:3000';

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const today = new Date();
  const d = (offset: number) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() + offset);
    return dt.toISOString().split('T')[0];
  };
  const date1 = d(-1);
  const date2 = d(0);
  const monthKey = date2.substring(0, 7);

  // 0. Clean any previous run
  const oldEmp = await db.employee.findFirst({ where: { employeeId: 'TEST-MOVE-1' } });
  if (oldEmp) {
    await db.attendance.deleteMany({ where: { employeeId: oldEmp.id } });
    await db.empCountSitePerMonth.deleteMany({ where: { empId: oldEmp.id } });
    await db.salaryRecord.deleteMany({ where: { empId: oldEmp.id } });
    await db.workLog.deleteMany({ where: { employeeId: oldEmp.id } });
    await db.employee.delete({ where: { id: oldEmp.id } });
  }

  // 1. Create two sites
  const site1Res = await api('POST', '/api/sites', { name: 'TEST SITE ALPHA', clientName: 'Client A' });
  const site2Res = await api('POST', '/api/sites', { name: 'TEST SITE BETA', clientName: 'Client B' });
  // may already exist
  const sites = await db.site.findMany({ where: { name: { in: ['TEST SITE ALPHA', 'TEST SITE BETA'] } } });
  const site1 = sites.find((s) => s.name === 'TEST SITE ALPHA')!;
  const site2 = sites.find((s) => s.name === 'TEST SITE BETA')!;
  console.log('site1:', site1.id, 'site2:', site2.id);

  // 2. Create employee at Site 1 (same shape as employee-page create)
  const empRes = await api('POST', '/api/employees', {
    fullName: 'TEST Move Employee',
    employeeId: 'TEST-MOVE-1',
    trade: 'Helper',
    currentSite: site1.name,
    currentSiteId: site1.id,
    rating: 3,
    status: 'active',
  });
  console.log('create employee:', empRes.status, empRes.json?.success);
  const empId = empRes.json?.data?.employee?.id ?? empRes.json?.data?.id;
  if (!empId) {
    console.log('employee create response:', JSON.stringify(empRes.json).slice(0, 500));
    return;
  }

  // 3. Mark Date1 at Site 1 (UI sends siteId of the grid)
  const mark1 = await api('POST', '/api/attendance', {
    employeeId: empId, date: date1, status: 'present', siteId: site1.id,
  });
  console.log(`mark1 (${date1} @site1):`, mark1.status, JSON.stringify(mark1.json?.data?.attendance ?? mark1.json).slice(0, 200));

  // 4. Move employee to Site 2 — exactly what employee edit dialog sends
  const moveRes = await api('PUT', `/api/employees/${empId}`, {
    currentSite: site2.name,
    currentSiteId: site2.id,
  });
  console.log('move to site2:', moveRes.status, moveRes.json?.success);

  // 5. Mark Date2 at Site 2 (UI sends siteId of the grid = site2)
  const mark2 = await api('POST', '/api/attendance', {
    employeeId: empId, date: date2, status: 'present', siteId: site2.id,
  });
  console.log(`mark2 (${date2} @site2):`, mark2.status, JSON.stringify(mark2.json?.data?.attendance ?? mark2.json).slice(0, 200));

  // 6. Inspect DB
  const records = await db.attendance.findMany({ where: { employeeId: empId }, orderBy: { date: 'asc' } });
  console.log('\n=== ATTENDANCE RECORDS IN DB ===');
  for (const r of records) {
    console.log(`  date=${r.date} status=${r.status} siteId=${r.siteId} ${r.siteId === site1.id ? '(SITE 1 ✓)' : r.siteId === site2.id ? '(SITE 2 ✓)' : '(UNKNOWN/NULL ✗)'}`);
  }
  const wrong = records.find((r) => r.date === date2 && r.siteId !== site2.id);
  console.log(wrong ? `\n❌ BUG REPRODUCED: Date2 record has siteId=${wrong.siteId} (expected ${site2.id})` : `\n✅ Date2 record saved with correct siteId=${site2.id}`);

  // 7. Site assignments for the month
  const assignments = await db.empCountSitePerMonth.findMany({ where: { empId, month: monthKey } });
  console.log('\n=== EmpCountSitePerMonth ===');
  for (const a of assignments) {
    console.log(`  site=${a.siteName} created=${a.createdDate.toISOString()} removed=${a.removedDate?.toISOString() ?? 'null'}`);
  }

  // 8. Salary records — where did the hours go?
  const salary = await db.salaryRecord.findMany({ where: { empId: empId, month: monthKey } });
  console.log('\n=== SALARY RECORDS ===');
  for (const s of salary) {
    console.log(`  siteId=${s.siteId} ${s.siteId === site1.id ? '(SITE 1)' : s.siteId === site2.id ? '(SITE 2)' : '(?)'} totalHours=${s.totalHours} standardHours=${s.standardHours} premiumHours=${s.premiumHours}`);
  }

  // 9. What does the attendance GET return (what the grid loads)?
  const year = monthKey.split('-')[0];
  const getRes = await api('GET', `/api/attendance?month=${monthKey}&year=${year}`);
  const recs = (getRes.json?.data?.records ?? []).filter((r: { employeeId: string }) => r.employeeId === empId);
  console.log('\n=== GET /api/attendance (grid view) ===');
  for (const r of recs) {
    console.log(`  date=${r.date} status=${r.status} siteId=${r.siteId}`);
  }

  console.log('\nEMP_ID_FOR_CLEANUP=' + empId);
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exit(1); })
  .finally(() => process.exit(0));
