import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const delLeave = await prisma.leaveRequest.deleteMany({ where: { reason: 'Temp collapsed test' } });
  const delNotifs = await prisma.notification.deleteMany({ where: { read: false } });
  const emp = await prisma.employee.update({ where: { id: 'cmsd2mm4s0001u8lwm3jppjwb' }, data: { status: 'active' } });
  console.log(JSON.stringify({ deletedLeave: delLeave.count, deletedNotifications: delNotifs.count, employeeStatus: emp.status }));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
