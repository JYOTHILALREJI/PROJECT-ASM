// Temporarily re-save a BROKEN provider (dead endpoint) to prove the
// ai-client fallback keeps chat alive. Run with "restore" arg to clean up.
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const mode = process.argv[2] || 'break';

async function main() {
  if (mode === 'break') {
    const rows = [
      { key: 'aiApiKey', value: 'sk-mock-test' },
      { key: 'aiBaseUrl', value: 'http://127.0.0.1:9999/v1' },
      { key: 'aiModel', value: 'mock-model-1' },
    ];
    for (const r of rows) {
      await db.appSetting.upsert({ where: { key: r.key }, update: { value: r.value }, create: r });
    }
    console.log('broken provider saved');
  } else {
    const res = await db.appSetting.deleteMany({ where: { key: { in: ['aiApiKey', 'aiBaseUrl', 'aiModel'] } } });
    console.log(`restored — deleted ${res.count} row(s)`);
  }
}
main().finally(() => db.$disconnect());
