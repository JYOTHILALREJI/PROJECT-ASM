import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const byExact = await db.$queryRawUnsafe(`SELECT COUNT(*) c FROM Employee WHERE currentSite = 'Riyadh Tower Site' AND deletedAt IS NULL AND status='active'`);
  const byLike = await db.$queryRawUnsafe(`SELECT COUNT(*) c FROM Employee WHERE currentSite LIKE '%riyadh%' AND deletedAt IS NULL AND status='active'`);
  const byId = await db.$queryRawUnsafe(`SELECT COUNT(*) c FROM Employee e JOIN Site s ON e.currentSiteId = s.id WHERE s.name = 'Riyadh Tower Site' AND e.deletedAt IS NULL AND e.status='active'`);
  console.log('exact name =', Number((byExact as { c: bigint }[])[0].c));
  console.log('LIKE %riyadh% =', Number((byLike as { c: bigint }[])[0].c));
  console.log('via currentSiteId =', Number((byId as { c: bigint }[])[0].c));
}
main().finally(() => db.$disconnect());
