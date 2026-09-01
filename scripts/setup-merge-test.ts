// Simulate a mid-month site move to verify merged-column rendering:
//   John Doe: Riyadh Tower Site (days 1-15) -> Jeddah Mall Project (days 15-30)
//   Attendance: Sep 3 Present @ Riyadh, Sep 20 Present @ Jeddah
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const john = await db.employee.findFirst({ where: { fullName: 'John Doe' } });
  if (!john) throw new Error('John Doe not found');

  const riyadh = await db.site.findFirst({ where: { name: 'Riyadh Tower Site' } });
  const jeddah = await db.site.findFirst({ where: { name: 'Jeddah Mall Project' } });
  if (!riyadh || !jeddah) throw new Error('Sites not found');

  // 1. Riyadh assignment: created Sep 1, removed Sep 15 (mid-month move out)
  await db.empCountSitePerMonth.upsert({
    where: { empId_siteId_month: { empId: john.id, siteId: riyadh.id, month: '2026-09' } },
    update: { removedDate: new Date('2026-09-15T10:00:00.000Z'), deletedDate: null, deletedAt: null },
    create: {
      empId: john.id,
      empName: john.fullName,
      siteId: riyadh.id,
      siteName: riyadh.name,
      month: '2026-09',
      createdDate: new Date('2026-09-01T08:00:00.000Z'),
      removedDate: new Date('2026-09-15T10:00:00.000Z'),
    },
  });

  // 2. Jeddah assignment: created Sep 15 (arrived), active
  await db.empCountSitePerMonth.updateMany({
    where: { empId: john.id, siteId: jeddah.id, month: '2026-09' },
    data: { createdDate: new Date('2026-09-15T10:00:00.000Z') },
  });

  // 3. Attendance marks: Sep 3 Present @ Riyadh, Sep 20 Present @ Jeddah
  const marks = [
    { date: '2026-09-03', siteId: riyadh.id, status: 'present' as const },
    { date: '2026-09-20', siteId: jeddah.id, status: 'present' as const },
  ];
  for (const m of marks) {
    const existing = await db.attendance.findFirst({
      where: { employeeId: john.id, date: m.date, deletedAt: null },
    });
    if (existing) {
      await db.attendance.update({
        where: { id: existing.id },
        data: { status: m.status, siteId: m.siteId },
      });
    } else {
      await db.attendance.create({
        data: {
          employeeId: john.id,
          date: m.date,
          status: m.status,
          siteId: m.siteId,
        },
      });
    }
  }

  console.log('Test data ready:', {
    employee: john.fullName,
    currentSite: john.currentSite,
    riyadhRecord: 'removed 2026-09-15',
    jeddahRecord: 'created 2026-09-15',
  });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
