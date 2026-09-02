// Temporary test data for attendance-sheet pagination verification.
// Creates N employees assigned to the given site via the app API (session cookie).
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const SITE_ID = process.argv[2] || 'cmrfz988y0001pfugc8xpibao'; // Riyadh Tower Site
const COUNT = Number(process.argv[3] || 30);

const trades = ['Mason', 'Helper', 'Carpenter', 'Steel Fixer', 'Plaster', 'Electrician'];

async function main() {
  const created = [];
  for (let i = 1; i <= COUNT; i++) {
    const emp = await db.employee.create({
      data: {
        fullName: `TEST PRINT WORKER ${String(i).padStart(2, '0')}`,
        employeeId: `ASM-2026-9${String(i).padStart(2, '0')}`,
        position: trades[i % trades.length],
        currentSite: 'Riyadh Tower Site',
        currentSiteId: SITE_ID,
      },
    });
    await db.empCountSitePerMonth.create({
      data: {
        employeeId: emp.id,
        siteId: SITE_ID,
        month: new Date().toISOString().slice(0, 7) + '-01',
      },
    }).catch(() => {});
    created.push(emp.id);
  }
  console.log(JSON.stringify({ created: created.length, ids: created }));
}

main().finally(() => db.$disconnect());
