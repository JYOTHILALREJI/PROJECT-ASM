import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { encrypt } from '../src/lib/crypto';

// ---------------------------------------------------------------------------
// Seed script — run with: bunx tsx scripts/seed.ts
// ---------------------------------------------------------------------------
// This script:
//   1. Clears all existing users (so the signup page shows on next load)
//   2. Creates 10 realistic sites (grouped by client)
//   3. Creates 70 employees assigned across those sites with varied trades,
//      nationalities, and a few team leaders + supervisors.
//
// After running this, the app will show the signup page because no super
// admin exists. The first person to register becomes the super admin.
// ---------------------------------------------------------------------------

async function main() {
  console.log('🌱 Starting seed...\n');

  // ── 1. Clear all users ──
  console.log('1. Clearing all users...');
  await db.activityLog.deleteMany();
  await db.attendanceShare.deleteMany();
  await db.attendanceVersion.deleteMany();
  await db.advance.deleteMany();
  await db.adminPermission.deleteMany();
  await db.adminMenuPermission.deleteMany();
  await db.notification.deleteMany();
  await db.user.deleteMany();
  console.log('   ✅ All users cleared. Signup page will show on next load.\n');

  // ── 2. Clear existing sites + employees (so re-seeding is idempotent) ──
  console.log('2. Clearing existing sites and employees...');
  await db.workLog.deleteMany();
  await db.totalEmployeeWorkingHours.deleteMany();
  await db.salaryRecord.deleteMany();
  await db.empCountSitePerMonth.deleteMany();
  await db.siteMonthActivation.deleteMany();
  await db.uniformRegistry.deleteMany();
  await db.attendance.deleteMany();
  await db.warning.deleteMany();
  await db.fine.deleteMany();
  await db.leaveRequest.deleteMany();
  await db.cancellationRequest.deleteMany();
  await db.employee.deleteMany();
  await db.site.deleteMany();
  console.log('   ✅ Cleared.\n');

  // ── 3. Create 10 sites ──
  console.log('3. Creating 10 sites...');
  const siteData = [
    { name: 'Riyadh Tower Site', clientName: 'Saudi Oger', projectName: 'Riyadh Tower', projectId: 'PRJ-001' },
    { name: 'Jeddah Mall Project', clientName: 'Saudi Oger', projectName: 'Jeddah Mall', projectId: 'PRJ-002' },
    { name: 'Dammam Refinery', clientName: 'Aramco', projectName: 'Refinery Expansion', projectId: 'PRJ-003' },
    { name: 'Mecca Hotel Complex', clientName: 'Binladin Group', projectName: 'Mecca Hotel', projectId: 'PRJ-004' },
    { name: 'Medina Residential', clientName: 'Binladin Group', projectName: 'Medina Housing', projectId: 'PRJ-005' },
    { name: 'Khobar Corniche', clientName: 'Al-Falak', projectName: 'Corniche Development', projectId: 'PRJ-006' },
    { name: 'Riyadh Metro Station', clientName: 'Bechtel', projectName: 'Metro Station 4', projectId: 'PRJ-007' },
    { name: 'Yanbu Industrial', clientName: 'Aramco', projectName: 'Yanbu Petrochemical', projectId: 'PRJ-008' },
    { name: 'Abha Resort', clientName: 'Al-Falak', projectName: 'Abha Mountain Resort', projectId: 'PRJ-009' },
    { name: 'Riyadh Airport Terminal', clientName: 'Bechtel', projectName: 'Terminal 5 Expansion', projectId: 'PRJ-010' },
  ];

  const sites = [];
  for (const s of siteData) {
    const site = await db.site.create({ data: s });
    sites.push(site);
    console.log(`   ✅ ${site.name} (${site.clientName})`);
  }
  console.log();

  // ── 4. Create 70 employees ──
  console.log('4. Creating 70 employees...');

  const firstNames = [
    'Ahmed', 'Mohammed', 'Ali', 'Hassan', 'Omar', 'Khalid', 'Faisal', 'Saud',
    'Abdullah', 'Nasser', 'Ibrahim', 'Yousef', 'Rashid', 'Tariq', 'Salem',
    'Ravi', 'Sanjay', 'Vijay', 'Arun', 'Suresh', 'Rajesh', 'Anil', 'Prakash',
    'Deepak', 'Manoj', 'Srinivas', 'Venkat', 'Karthik', 'Ramesh', 'Gopal',
    'John', 'Paul', 'James', 'Michael', 'David', 'Robert', 'Mark', 'Steven',
    'Carlos', 'Juan', 'Luis', 'Miguel', 'Jorge', 'Pedro', 'Ricardo',
    'Khan', 'Bilal', 'Imran', 'Zubair', 'Fahad', 'Waleed', 'Mansoor',
    'Anwar', 'Naveed', 'Tahir', 'Yasir', 'Bashir', 'Latif', 'Majid',
    'Rahul', 'Amit', 'Nitin', 'Sachin', 'Vivek', 'Ajay', 'Rohit', 'Sandeep', 'Pradeep', 'Harish',
  ];

  const lastNames = [
    'Khan', 'Ahmed', 'Ali', 'Hassan', 'Al-Saud', 'Al-Otaibi', 'Al-Harbi',
    'Sharma', 'Patel', 'Reddy', 'Nair', 'Kumar', 'Singh', 'Gupta', 'Verma',
    'Smith', 'Brown', 'Wilson', 'Taylor', 'Anderson', 'Thomas', 'Jackson',
    'Garcia', 'Rodriguez', 'Martinez', 'Lopez', 'Hernandez', 'Gonzalez',
    'Rahman', 'Malik', 'Sheikh', 'Abbasi', 'Qureshi', 'Siddiqui', 'Butt',
    'Iqbal', 'Awan', 'Rana', 'Bhatti', 'Cheema', 'Mughal', 'Hashmi',
    'Shah', 'Khan', 'Das', 'Mehta', 'Joshi', 'Pillai', 'Menon', 'Rao',
    'Pawar', 'Deshmukh', 'Kulkarni', 'Shetty', 'Naidu', 'Reddy', 'Yadav', 'Pandey', 'Tiwari', 'Mishra',
  ];

  const trades = [
    'Mason', 'Electrician', 'Welder', 'Carpenter', 'Plumber', 'Painter',
    'Steel Fixer', 'Scaffolder', 'Heavy Equipment Operator', 'Crane Operator',
    'Foreman', 'Surveyor', 'QA/QC Inspector', 'Safety Officer', 'Rigger',
  ];

  const nationalities = [
    'Indian', 'Pakistani', 'Bangladeshi', 'Nepalese', 'Filipino',
    'Egyptian', 'Sudanese', 'Yemeni', 'Sri Lankan', 'Vietnamese',
  ];

  const companies = ['ASM Contracting', 'Arabian Shield LLC', 'Gulf Manpower Co.'];

  let employeeCounter = 0;
  for (let i = 0; i < 70; i++) {
    const site = sites[i % sites.length]; // Distribute across all 10 sites
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[i % lastNames.length];
    const fullName = `${firstName} ${lastName}`;
    const employeeId = `ASM-2026-${String(i + 1).padStart(3, '0')}`;
    const trade = trades[i % trades.length];
    const nationality = nationalities[i % nationalities.length];
    const company = companies[i % companies.length];

    // Every 7th employee is a Team Leader, every 14th is a Supervisor
    const isTeamLeader = i % 7 === 0 && i < 70;
    const isSupervisor = i % 14 === 0 && i > 0;

    await db.employee.create({
      data: {
        fullName,
        employeeId,
        nationality,
        trade,
        position: trade,
        joinDate: new Date(2024, i % 12, (i % 28) + 1),
        companyName: company,
        currentSite: site.name,
        currentSiteId: site.id,
        rating: 3.5 + (i % 3) * 0.5, // 3.5, 4.0, or 4.5
        status: 'active',
        isTeamLeader,
        isSupervisor,
        teamLeaderSiteId: isTeamLeader ? site.id : null,
        supervisorSiteId: isSupervisor ? site.id : null,
        role: isTeamLeader ? 'Team Leader' : isSupervisor ? 'Supervisor' : 'Standard',
        hoursThreshold: 1000,
        currentTotalWorkingHours: 0,
        phone: `+9715${String(10000000 + i).slice(0, 8)}`,
        // Encrypt a dummy ID number
        idNumber: encrypt(`ID${String(1000000 + i)}`),
        passportNumber: encrypt(`P${String(2000000 + i)}`),
        passportStatus: i % 3 === 0 ? 'Expired' : 'Valid',
        idStatus: i % 4 === 0 ? 'Pending' : 'Valid',
      },
    });
    employeeCounter++;
  }
  console.log(`   ✅ Created ${employeeCounter} employees across ${sites.length} sites.\n`);

  // ── 5. Seed permissions ──
  console.log('5. Seeding permissions table...');
  const permissions = [
    { name: 'Dashboard', slug: 'dashboard', group: 'general' },
    { name: 'Employees', slug: 'employees', group: 'workforce' },
    { name: 'Sites', slug: 'sites', group: 'workforce' },
    { name: 'Attendance', slug: 'attendance', group: 'workforce' },
    { name: 'Accounts', slug: 'accounts', group: 'workforce' },
    { name: 'Consolidated Salary', slug: 'consolidated_salary', group: 'workforce' },
    { name: 'Uniform Registry', slug: 'uniform_registry', group: 'workforce' },
    { name: 'Leave Requests', slug: 'leave_requests', group: 'workforce' },
    { name: 'Cancellation Requests', slug: 'cancellation_requests', group: 'workforce' },
    { name: 'Notifications', slug: 'notifications', group: 'general' },
    { name: 'Admin Management', slug: 'admins', group: 'admin' },
  ];
  for (const p of permissions) {
    await db.permission.upsert({
      where: { slug: p.slug },
      update: {},
      create: p,
    });
  }
  console.log(`   ✅ Seeded ${permissions.length} permissions.\n`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('🎉 Seed complete!\n');
  console.log('Next steps:');
  console.log('  1. Start the app: npm run dev');
  console.log('  2. Open http://localhost:3000 — you\'ll see the signup page');
  console.log('  3. Register with any email/name/password — you become super admin');
  console.log('  4. After that, signups are blocked. Create other admin accounts');
  console.log('     via Admin Management and share their credentials.\n');
  console.log('Data created:');
  console.log(`  • 0 users (signup page will show)`);
  console.log(`  • ${sites.length} sites (grouped by 4 clients)`);
  console.log(`  • ${employeeCounter} employees (with trades, nationalities, TL/Sup)`);
  console.log(`  • ${permissions.length} permissions`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
