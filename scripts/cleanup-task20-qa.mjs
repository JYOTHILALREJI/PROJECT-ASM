import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const msgs = await db.aiChatMessage.deleteMany({});
const sess = await db.aiChatSession.deleteMany({});
const notif = await db.notification.deleteMany({ where: { type: 'agent' } });
const aiName = await db.appSetting.findUnique({ where: { key: 'aiName' } });
const key = await db.appSetting.findUnique({ where: { key: 'aiApiKey' } });
console.log(JSON.stringify({
  purgedMessages: msgs.count,
  purgedSessions: sess.count,
  purgedAgentNotifs: notif.count,
  aiName: aiName?.value ?? '(default Nova)',
  savedKey: key?.value ? 'STILL SET!' : '(none)',
}));
await db.$disconnect();
