// One-off cleanup: the Task 21-d E2E run left a MOCK model provider saved in
// AppSetting (aiBaseUrl=http://127.0.0.1:9999/v1, sk-mock-te…, mock-model-1).
// Once scripts/mock-llm.py stopped running, every assistant request died with
// "fetch failed" and — while the mock was briefly alive — replies were canned
// test JSON (the "mangled/garbled" responses). Remove the three rows so the
// built-in provider takes over again. Resilience fallback in ai-client.ts
// additionally guarantees a dead custom provider can never brick chat again.
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const keys = ['aiApiKey', 'aiBaseUrl', 'aiModel'];
  const before = await db.appSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  console.log('before:', before.map((r) => `${r.key}=${r.key === 'aiApiKey' ? r.value.slice(0, 6) + '…' : r.value}`).join(', ') || '(none)');
  const res = await db.appSetting.deleteMany({ where: { key: { in: keys } } });
  console.log(`deleted ${res.count} stale mock-provider row(s)`);
  const after = await db.appSetting.findMany({ where: { key: { in: keys } } });
  console.log('after:', after.length === 0 ? '(clean — built-in provider active)' : JSON.stringify(after));
}

main().finally(() => db.$disconnect());
