import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Remove the two badge-test request records
  const delLeave = await prisma.leaveRequest.deleteMany({
    where: { reason: 'Badge count test request' },
  });
  const delCancel = await prisma.cancellationRequest.deleteMany({
    where: { reason: 'Badge count test cancellation' },
  });

  // Ensure the test employee is back to active
  const emp = await prisma.employee.update({
    where: { id: 'cmsd2mm4s0001u8lwm3jppjwb' },
    data: { status: 'active' },
  });

  // Remove unread notifications created by the test requests
  // (unreadCount was 0 before the test, so every unread row is test residue)
  const delNotifs = await prisma.notification.deleteMany({
    where: { read: false },
  });

  console.log(JSON.stringify({
    deletedLeave: delLeave.count,
    deletedCancellations: delCancel.count,
    employeeStatus: emp.status,
    deletedNotifications: delNotifs.count,
  }));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
