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
  await db.branch.deleteMany();
  console.log('   ✅ Cleared.\n');

  // ── 3. Create branches ──
  console.log('3. Creating branches...');
  const branchData = [
    { name: 'Riyadh Branch', code: 'RYD' },
    { name: 'Jeddah Branch', code: 'JED' },
    { name: 'Dammam Branch', code: 'DAM' },
  ];
  const branches = [];
  for (const b of branchData) {
    const branch = await db.branch.create({ data: b });
    branches.push(branch);
    console.log(`   ✅ ${branch.name} (${branch.code})`);
  }
  console.log();

  // ── 4. Create 10 sites (assigned to branches) ──
  console.log('4. Creating 10 sites...');
  const siteData = [
    { name: 'Riyadh Tower Site', clientName: 'Saudi Oger', projectName: 'Riyadh Tower', projectId: 'PRJ-001', branchIdx: 0 },
    { name: 'Jeddah Mall Project', clientName: 'Saudi Oger', projectName: 'Jeddah Mall', projectId: 'PRJ-002', branchIdx: 1 },
    { name: 'Dammam Refinery', clientName: 'Aramco', projectName: 'Refinery Expansion', projectId: 'PRJ-003', branchIdx: 2 },
    { name: 'Mecca Hotel Complex', clientName: 'Binladin Group', projectName: 'Mecca Hotel', projectId: 'PRJ-004', branchIdx: 1 },
    { name: 'Medina Residential', clientName: 'Binladin Group', projectName: 'Medina Housing', projectId: 'PRJ-005', branchIdx: 1 },
    { name: 'Khobar Corniche', clientName: 'Al-Falak', projectName: 'Corniche Development', projectId: 'PRJ-006', branchIdx: 2 },
    { name: 'Riyadh Metro Station', clientName: 'Bechtel', projectName: 'Metro Station 4', projectId: 'PRJ-007', branchIdx: 0 },
    { name: 'Yanbu Industrial', clientName: 'Aramco', projectName: 'Yanbu Petrochemical', projectId: 'PRJ-008', branchIdx: 1 },
    { name: 'Abha Resort', clientName: 'Al-Falak', projectName: 'Abha Mountain Resort', projectId: 'PRJ-009', branchIdx: 2 },
    { name: 'Riyadh Airport Terminal', clientName: 'Bechtel', projectName: 'Terminal 5 Expansion', projectId: 'PRJ-010', branchIdx: 0 },
  ];

  const sites = [];
  for (const s of siteData) {
    const { branchIdx, ...siteFields } = s;
    const site = await db.site.create({
      data: { ...siteFields, branchId: branches[branchIdx].id },
    });
    sites.push(site);
    console.log(`   ✅ ${site.name} (${site.clientName}) → ${branches[branchIdx].name}`);
  }
  console.log();

  // ── 4. Create employees ──
  // Distribution:
  //   Site 0 (Riyadh Tower)       → 55 employees (50+ for multi-page PDF test)
  //   Site 1 (Jeddah Mall)        → 55 employees (50+ for multi-page PDF test)
  //   Site 2 (Dammam Refinery)    → 30 employees (25+)
  //   Sites 3-9 (7 remaining)     → 8 each = 56
  //   Total: 55 + 55 + 30 + 56 = 196 employees
  console.log('4. Creating employees...');

  const firstNames = [
    'Ahmed', 'Mohammed', 'Ali', 'Hassan', 'Omar', 'Khalid', 'Faisal', 'Saud',
    'Abdullah', 'Nasser', 'Ibrahim', 'Yousef', 'Rashid', 'Tariq', 'Salem',
    'Ravi', 'Sanjay', 'Vijay', 'Arun', 'Suresh', 'Rajesh', 'Anil', 'Prakash',
    'Deepak', 'Manoj', 'Srinivas', 'Venkat', 'Karthik', 'Ramesh', 'Gopal',
    'John', 'Paul', 'James', 'Michael', 'David', 'Robert', 'Mark', 'Steven',
    'Carlos', 'Juan', 'Luis', 'Miguel', 'Jorge', 'Pedro', 'Ricardo',
    'Khan', 'Bilal', 'Imran', 'Zubair', 'Fahad', 'Waleed', 'Mansoor',
    'Anwar', 'Naveed', 'Tahir', 'Yasir', 'Bashir', 'Latif', 'Majid',
    'Rahul', 'Amit', 'Nitin', 'Sachin', 'Vivek', 'Ajay', 'Rohit', 'Sandeep',
    'Pradeep', 'Harish', 'Suresh', 'Naresh', 'Dinesh', 'Rakesh', 'Vikram',
    'Akram', 'Asad', 'Farhan', 'Hamza', 'Junaid', 'Kamran', 'Nadeem',
    'Owais', 'Saad', 'Umair', 'Waheed', 'Zaid', 'Adnan', 'Bilal',
    'George', 'Thomas', 'Charles', 'Daniel', 'Edward', 'Frank', 'Henry',
    'Ivan', 'Kevin', 'Larry', 'Martin', 'Nicholas', 'Peter', 'Richard',
    'Samuel', 'Timothy', 'Vincent', 'Walter', 'Abdul', 'Babar', 'Danish',
  ];

  const lastNames = [
    'Khan', 'Ahmed', 'Ali', 'Hassan', 'Al-Saud', 'Al-Otaibi', 'Al-Harbi',
    'Sharma', 'Patel', 'Reddy', 'Nair', 'Kumar', 'Singh', 'Gupta', 'Verma',
    'Smith', 'Brown', 'Wilson', 'Taylor', 'Anderson', 'Thomas', 'Jackson',
    'Garcia', 'Rodriguez', 'Martinez', 'Lopez', 'Hernandez', 'Gonzalez',
    'Rahman', 'Malik', 'Sheikh', 'Abbasi', 'Qureshi', 'Siddiqui', 'Butt',
    'Iqbal', 'Awan', 'Rana', 'Bhatti', 'Cheema', 'Mughal', 'Hashmi',
    'Shah', 'Das', 'Mehta', 'Joshi', 'Pillai', 'Menon', 'Rao',
    'Pawar', 'Deshmukh', 'Kulkarni', 'Shetty', 'Naidu', 'Yadav', 'Pandey',
    'Tiwari', 'Mishra', 'Agarwal', 'Bansal', 'Chopra', 'Desai', 'Gandhi',
    'Al-Ghamdi', 'Al-Qahtani', 'Al-Subaie', 'Al-Dossari', 'Al-Mutairi',
    'Al-Shehri', 'Al-Zahrani', 'Al-Amri', 'Al-Balawi', 'Al-Juhani',
    'Fernandez', 'Cruz', 'Reyes', 'Santos', 'Lim', 'Tan', 'Wong',
    'Nguyen', 'Tran', 'Le', 'Pham', 'Ho', 'Vu',
  ];

  const trades = [
    'Mason', 'Electrician', 'Welder', 'Carpenter', 'Plumber', 'Painter',
    'Steel Fixer', 'Scaffolder', 'Heavy Equipment Operator', 'Crane Operator',
    'Foreman', 'Surveyor', 'QA/QC Inspector', 'Safety Officer', 'Rigger',
    'Helper', 'Driver', 'Mechanic', 'Technician', 'Storekeeper',
  ];

  const nationalities = [
    'Indian', 'Pakistani', 'Bangladeshi', 'Nepalese', 'Filipino',
    'Egyptian', 'Sudanese', 'Yemeni', 'Sri Lankan', 'Vietnamese',
  ];

  const companies = ['ASM Contracting', 'Arabian Shield LLC', 'Gulf Manpower Co.'];

  // Site → employee count mapping
  const siteEmployeeCounts = [
    55, // Site 0: Riyadh Tower (50+ for multi-page PDF)
    55, // Site 1: Jeddah Mall (50+ for multi-page PDF)
    30, // Site 2: Dammam Refinery (25+)
    8, 8, 8, 8, 8, 8, 8, // Sites 3-9: 8 each
  ];
  const totalEmployees = siteEmployeeCounts.reduce((a, b) => a + b, 0);

  let employeeCounter = 0;
  for (let siteIdx = 0; siteIdx < sites.length; siteIdx++) {
    const site = sites[siteIdx];
    const count = siteEmployeeCounts[siteIdx] || 5;

    for (let j = 0; j < count; j++) {
      const i = employeeCounter;
      const firstName = firstNames[i % firstNames.length];
      const lastName = lastNames[(i * 3 + siteIdx) % lastNames.length];
      // Append a suffix if names repeat to keep them unique enough
      const suffix = i >= firstNames.length * lastNames.length ? ` ${Math.floor(i / (firstNames.length * lastNames.length)) + 2}` : '';
      const fullName = `${firstName} ${lastName}${suffix}`;
      const employeeId = `ASM-2026-${String(i + 1).padStart(3, '0')}`;
      const trade = trades[i % trades.length];
      const nationality = nationalities[i % nationalities.length];
      const company = companies[i % companies.length];

      // First employee at each site is Team Leader, second is Supervisor
      const isTeamLeader = j === 0;
      const isSupervisor = j === 1;

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
          branchId: site.branchId, // Employee belongs to the same branch as their site
          rating: 3.5 + (i % 3) * 0.5,
          status: 'active',
          isTeamLeader,
          isSupervisor,
          teamLeaderSiteId: isTeamLeader ? site.id : null,
          supervisorSiteId: isSupervisor ? site.id : null,
          role: isTeamLeader ? 'Team Leader' : isSupervisor ? 'Supervisor' : 'Standard',
          hoursThreshold: 1000,
          currentTotalWorkingHours: 0,
          phone: `+9715${String(10000000 + i).slice(0, 8)}`,
          idNumber: encrypt(`ID${String(1000000 + i)}`),
          passportNumber: encrypt(`P${String(2000000 + i)}`),
          passportStatus: i % 3 === 0 ? 'Expired' : 'Valid',
          idStatus: i % 4 === 0 ? 'Pending' : 'Valid',
        },
      });
      employeeCounter++;
    }
    console.log(`   ✅ ${site.name}: ${count} employees`);
  }
  console.log(`   Total: ${employeeCounter} employees across ${sites.length} sites.\n`);

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
  console.log(`  • ${branches.length} branches (Riyadh, Jeddah, Dammam)`);
  console.log(`  • ${sites.length} sites (grouped by branch → client)`);
  console.log(`  • ${employeeCounter} employees:`);
  console.log(`      - Riyadh Tower Site: 55 (50+ → multi-page PDF test)`);
  console.log(`      - Jeddah Mall Project: 55 (50+ → multi-page PDF test)`);
  console.log(`      - Dammam Refinery: 30 (25+)`);
  console.log(`      - 7 other sites: 8 each`);
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
