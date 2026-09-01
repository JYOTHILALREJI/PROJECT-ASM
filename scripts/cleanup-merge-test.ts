// Revert the merge test data:
//   John Doe back to Riyadh Tower Site (current site)
//   Remove Jeddah assignment + test attendance marks + zero-hour WorkLog
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const john = await db.employee.findFirst({ where: { fullName: 'John Doe' } });
  const riyadh = await db.site.findFirst({ where: { name: 'Riyadh Tower Site' } });
  const jeddah = await db.site.findFirst({ where: { name: 'Jeddah Mall Project' } });
  if (!john || !riyadh || !jeddah) throw new Error('Missing records');

  // 1. Remove test attendance marks
  const delAtt = await db.attendance.deleteMany({
    where: { employeeId: john.id, date: { in: ['2026-09-03', '2026-09-20'] } },
  });

  // 2. Remove Jeddah assignment for 2026-09
  const delAssign = await db.empCountSitePerMonth.deleteMany({
    where: { empId: john.id, siteId: jeddah.id, month: '2026-09' },
  });

  // 3. Reactivate Riyadh assignment
  await db.empCountSitePerMonth.updateMany({
    where: { empId: john.id, siteId: riyadh.id, month: '2026-09' },
    data: { removedDate: null },
  });

  // 4. Remove zero-hour Jeddah WorkLog created by the move
  const delWl = await db.workLog.deleteMany({
    where: { employeeId: john.id, siteId: jeddah.id, year: 2026, month: 9, hoursWorked: 0 },
  });

  // 5. Restore John's global site to Riyadh
  await db.employee.update({
    where: { id: john.id },
    data: { currentSite: riyadh.name, currentSiteId: riyadh.id },
  });

  console.log({ deletedAttendance: delAtt.count, deletedAssignments: delAssign.count, deletedWorkLogs: delWl.count });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
