import { db } from '../src/lib/db';

const DEFAULT_PERMISSIONS = [
  { name: 'Dashboard', slug: 'dashboard', group: 'general' },
  { name: 'Employees', slug: 'employees', group: 'workforce' },
  { name: 'Sites', slug: 'sites', group: 'workforce' },
  { name: 'Attendance', slug: 'attendance', group: 'workforce' },
  { name: 'Uniform Registry', slug: 'uniform_registry', group: 'workforce' },
  { name: 'Leave Requests', slug: 'leave_requests', group: 'workforce' },
  { name: 'Cancellations', slug: 'cancellation_requests', group: 'workforce' },
  { name: 'Notifications', slug: 'notifications', group: 'general' },
  { name: 'Admin Management', slug: 'admins', group: 'admin' },
  { name: 'Settings', slug: 'settings', group: 'admin' },
  { name: 'Payroll', slug: 'payroll', group: 'workforce' },
  { name: 'Reports', slug: 'reports', group: 'general' },
];

async function seed() {
  console.log('Seeding permissions...');
  for (const perm of DEFAULT_PERMISSIONS) {
    await db.permission.upsert({
      where: { slug: perm.slug },
      update: { name: perm.name, group: perm.group },
      create: perm,
    });
  }
  console.log(`Seeded ${DEFAULT_PERMISSIONS.length} permissions.`);
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
