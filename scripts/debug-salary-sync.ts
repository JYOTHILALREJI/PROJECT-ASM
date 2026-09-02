/** Debug: minimal trace of salary sync + assignment rows after each step */
import { db } from '../src/lib/db';

const BASE = 'http://localhost:3000';
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const d = (o: number) => { const dt = new Date(); dt.setDate(dt.getDate() + o); return dt.toISOString().split('T')[0]; };

async function showState(empId: string, label: string, monthKey: string) {
  const asg = await db.empCountSitePerMonth.findMany({ where: { empId, month: monthKey } });
  const sal = await db.salaryRecord.findMany({ where: { empId, month: monthKey } });
  const att = await db.attendance.findMany({ where: { employeeId: empId } });
  console.log(`\n[${label}]`);
  console.log('  assignments:', JSON.stringify(asg.map((a) => ({ s: a.siteName, c: a.createdDate.toISOString().slice(5, 16), r: a.removedDate?.toISOString().slice(5, 16) ?? null, dd: a.deletedDate }))));
  console.log('  salary:', JSON.stringify(sal.map((s) => ({ s: s.siteName, tier: s.rateTier, h: s.totalHours, del: s.isDeleted }))));
  console.log('  attendance:', JSON.stringify(att.map((a) => ({ d: a.date, st: a.status, site: a.siteId?.slice(-4) }))));
}

async function main() {
  const D1 = d(-2), D3 = d(0);
  const monthKey = D3.substring(0, 7);

  // cleanup
  for (const code of ['TEST-DBG-1']) {
    const e = await db.employee.findFirst({ where: { employeeId: code } });
    if (e) {
      await db.attendance.deleteMany({ where: { employeeId: e.id } });
      await db.empCountSitePerMonth.deleteMany({ where: { empId: e.id } });
      await db.salaryRecord.deleteMany({ where: { empId: e.id } });
      await db.workLog.deleteMany({ where: { employeeId: e.id } });
      await db.totalEmployeeWorkingHours.deleteMany({ where: { empId: e.id } });
      await db.employee.delete({ where: { id: e.id } });
    }
  }
  for (const n of ['TEST SITE ALPHA', 'TEST SITE BETA']) await db.site.deleteMany({ where: { name: n } });

  let r = await api('POST', '/api/sites', { name: 'TEST SITE ALPHA' });
  const S1 = r.json?.data?.site ?? await db.site.findFirst({ where: { name: 'TEST SITE ALPHA' } });
  r = await api('POST', '/api/sites', { name: 'TEST SITE BETA' });
  const S2 = r.json?.data?.site ?? await db.site.findFirst({ where: { name: 'TEST SITE BETA' } });
  console.log('S1', S1.id, 'S2', S2.id);

  r = await api('POST', '/api/employees', { fullName: 'Test DBG', employeeId: 'TEST-DBG-1', trade: 'Helper', currentSite: S1.name, currentSiteId: S1.id, rating: 3, status: 'active' });
  const emp = r.json?.data?.employee ?? r.json?.data;
  console.log('emp', emp.id);
  await showState(emp.id, 'after create', monthKey);

  await api('POST', '/api/attendance', { employeeId: emp.id, date: D1, status: 'present', siteId: S1.id });
  await new Promise((res) => setTimeout(res, 2000));
  await showState(emp.id, `after mark D1 @S1`, monthKey);

  await api('PUT', `/api/employees/${emp.id}`, { currentSite: S2.name, currentSiteId: S2.id });
  await showState(emp.id, 'after move to S2', monthKey);

  await api('POST', '/api/attendance', { employeeId: emp.id, date: D3, status: 'present', siteId: S2.id });
  await new Promise((res) => setTimeout(res, 2500));
  await showState(emp.id, 'after mark D3 @S2', monthKey);

  // move back and mark again at S1
  await api('PUT', `/api/employees/${emp.id}`, { currentSite: S1.name, currentSiteId: S1.id });
  await api('POST', '/api/attendance', { employeeId: emp.id, date: d(-1), status: 'present', siteId: S1.id });
  await new Promise((res) => setTimeout(res, 2500));
  await showState(emp.id, 'after move back + mark D2 @S1', monthKey);
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; }).finally(() => process.exit(0));
