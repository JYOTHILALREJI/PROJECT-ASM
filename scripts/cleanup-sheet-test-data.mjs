// Removes the temporary attendance-sheet print-test employees.
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const del = await db.employee.deleteMany({
    where: { employeeId: { startsWith: 'ASM-2026-9' } },
  });
  const cleanupMonths = await db.empCountSitePerMonth.deleteMany({
    where: { empId: { startsWith: 'cmtjp4s' } },
  });
  console.log(JSON.stringify({ deletedEmployees: del.count, deletedMonthRecords: cleanupMonths.count }));
}

main().finally(() => db.$disconnect());
