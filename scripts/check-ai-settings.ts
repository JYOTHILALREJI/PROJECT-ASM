import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
async function main() {
  const rows = await db.appSetting.findMany({
    where: { key: { in: ['aiApiKey', 'aiBaseUrl', 'aiModel', 'aiName', 'brandName'] } },
    select: { key: true, value: true },
  });
  for (const r of rows) {
    const v = r.key === 'aiApiKey' ? `${r.value.slice(0, 10)}…(len ${r.value.length})` : r.value;
    console.log(`${r.key} = ${v}`);
  }
  const count = await db.appSetting.count();
  console.log(`total appSetting rows: ${count}`);
}
main().finally(() => db.$disconnect());
