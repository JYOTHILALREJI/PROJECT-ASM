import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const rows = (await db.$queryRawUnsafe(`SELECT siteName, COUNT(*) c FROM EmpCountSitePerMonth WHERE removedDate IS NULL GROUP BY siteName`)) as { siteName: string; c: bigint }[];
  console.log('groups:', rows.map((r) => `${r.siteName}=${r.c}`).join(', ') || '(none)');
  const riyadh = (await db.$queryRawUnsafe(`SELECT empName FROM EmpCountSitePerMonth WHERE removedDate IS NULL AND siteName LIKE '%riyadh%'`)) as { empName: string }[];
  console.log('riyadh rows:', riyadh.map((r) => r.empName).join(', ') || '(none)');
}
main().finally(() => db.$disconnect());
