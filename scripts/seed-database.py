#!/usr/bin/env python3
"""Seed the ASM database with realistic test data:
- 200 workers, 5 camps (4 new + existing Yousuf), 6 sites (4 new + 2 existing), 2 branches
- Attendance (21 days x 200), salary records (2 months), working hours (3 months)
- Advances (one-time + recurring) with repayments, warnings, fines, leave requests,
  cancellation requests, uniform registry + stock, notifications, site history,
  month activations, work logs, rate changelogs, employee documents (real tiny PDFs)
All seeded rows use deterministic ids prefixed 'seed_' for easy audit + cleanup.
"""
import os
import random
import time
NOW_MS = int(time.time() * 1000)
import sqlite3
from datetime import date, timedelta

DB = '/home/z/my-project/db/custom.db'
STORAGE = '/home/z/my-project/storage/employee-documents'
random.seed(42)

con = sqlite3.connect(DB)
con.execute('PRAGMA foreign_keys = OFF')
cur = con.cursor()

ADMIN_ID = cur.execute("SELECT id FROM User WHERE email='admin@asm.com'").fetchone()[0]

# ---------------------------------------------------------------- reference data
BRANCHES = [('seed_branch_1', 'Riyadh Branch', 'RYD'), ('seed_branch_2', 'Jeddah Branch', 'JED')]
CAMPS = [
    ('seed_camp_1', 'Al Quoz Workers Camp', 'Al Quoz, Dubai', 150),
    ('seed_camp_2', 'Sonapur Camp A', 'Sonapur, Dubai', 200),
    ('seed_camp_3', 'Sonapur Camp B', 'Sonapur, Dubai', 200),
    ('seed_camp_4', 'Jebel Ali Industrial Camp', 'Jebel Ali, Dubai', 120),
]
SITES = [
    ('seed_site_1', 'Dubai Marina Towers', 'Emaar', 'Marina Residential Cluster', 'PRJ-1001', 'seed_branch_2'),
    ('seed_site_2', 'Sharjah Waterfront', 'Aldar', 'Waterfront Phase 2', 'PRJ-1002', 'seed_branch_1'),
    ('seed_site_3', 'Abu Dhabi Metro Extension', 'ADNOC', 'Metro Line Red', 'PRJ-1003', 'seed_branch_1'),
    ('seed_site_4', 'Al Ain Housing Project', 'Souq Extra', 'Housing Block C', 'PRJ-1004', 'seed_branch_2'),
]
TRADES = ['Mason', 'Electrician', 'Plumber', 'Carpenter', 'Welder', 'Helper', 'Painter', 'Steel Fixer', 'Scaffolder', 'Driver']
TRADE_RATES = [('seed_tr_1', 'Hilti', 6.5), ('seed_tr_2', 'Welder', 7.5), ('seed_tr_3', 'Electrician', 7.0), ('seed_tr_4', 'Foreman', 8.0)]
NATIONALITIES = ['Indian', 'Pakistani', 'Bangladeshi', 'Filipino', 'Nepali', 'Sri Lankan']
COMPANIES = ['Arabian Shield Manpower', 'Green & More Technical Services', 'Proscape Landscaping LLC']

today = date.today()
CUR_MONTH = today.strftime('%Y-%m')
PREV_MONTH = (today.replace(day=1) - timedelta(days=1)).strftime('%Y-%m')
PREV2_MONTH = (today.replace(day=1) - timedelta(days=1)).replace(day=1) - timedelta(days=1)
PREV2_MONTH = PREV2_MONTH.strftime('%Y-%m')
CUR_YEAR = today.year

def ins(table, cols, rows):
    cur.executemany(
        f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", rows)

def mini_pdf(tag):
    return (f"%PDF-1.4\n% ASM SEED DOC {tag}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            f"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]>>endobj\n"
            f"trailer<</Root 1 0 R>>\n%%EOF").encode()

# wipe previous seed data (idempotent reseed)
for t, col in [('EmployeeDocument', 'employeeId'), ('EmployeeRateChangelog', 'employeeId'),
               ('EmployeeTrade', 'employeeId'), ('Attendance', 'employeeId'),
               ('TotalEmployeeWorkingHours', 'empId'), ('SalaryRecord', 'empId'),
               ('AdvanceRepayment', 'advanceId'), ('Advance', 'empId'),
               ('Warning', 'employeeId'), ('Fine', 'employeeId'), ('LeaveRequest', 'employeeId'),
               ('CancellationRequest', 'employeeId'), ('UniformRegistry', 'employeeId'),
               ('EmpCountSitePerMonth', 'empId'), ('WorkLog', 'employeeId')]:
    cur.execute(f"DELETE FROM {t} WHERE {col} LIKE 'seed_%'" if col != 'advanceId'
                else f"DELETE FROM {t} WHERE advanceId LIKE 'seed_%'")
for t, cond in [('Employee', "id LIKE 'seed_%'"), ('Camp', "id LIKE 'seed_%'"), ('Site', "id LIKE 'seed_%'"),
                ('Branch', "id LIKE 'seed_%'"), ('TradeRate', "id LIKE 'seed_%'"),
                ('StockItem', "id LIKE 'seed_%'"), ('Notification', "id LIKE 'seed_%'"),
                ('AttendanceVersion', "id LIKE 'seed_%'"), ('AttendanceShare', "id LIKE 'seed_%'"),
                ('SiteMonthActivation', "id LIKE 'seed_%'")]:
    cur.execute(f"DELETE FROM {t} WHERE {cond}")
# remove seed doc files
import shutil
if os.path.isdir(STORAGE):
    for d in os.listdir(STORAGE):
        if d.startswith('seed_'):
            shutil.rmtree(os.path.join(STORAGE, d), ignore_errors=True)

# ---------------------------------------------------------------- branches / camps / sites
ins('Branch', ['id', 'name', 'code', 'isActive', 'createdAt', 'updatedAt'],
    [(i, n, c, 1, NOW_MS, NOW_MS) for i, n, c in BRANCHES])
ins('Camp', ['id', 'name', 'location', 'totalBedSpaces', 'isActive', 'createdAt', 'updatedAt'],
    [(i, n, loc, beds, 1, NOW_MS, NOW_MS) for i, n, loc, beds in CAMPS])
ins('Site', ['id', 'name', 'clientName', 'projectName', 'projectId', 'branchId', 'isActive', 'createdAt'],
    [(i, n, cl, pj, pid, br, 1, NOW_MS) for i, n, cl, pj, pid, br in SITES])

ALL_SITES = [r[0] for r in cur.execute("SELECT id FROM Site WHERE deletedAt IS NULL").fetchall()]
ALL_CAMPS = [r[0] for r in cur.execute("SELECT id FROM Camp WHERE deletedAt IS NULL").fetchall()]
print(f'refs: {len(ALL_SITES)} sites, {len(ALL_CAMPS)} camps')

# ---------------------------------------------------------------- trade rates
ins('TradeRate', ['id', 'trade', 'hourlyRate', 'createdAt', 'updatedAt'],
    [(i, t, r, NOW_MS, NOW_MS) for i, t, r in TRADE_RATES])

# ---------------------------------------------------------------- 200 employees
emps = []
for n in range(1, 201):
    eid = f'seed_emp_{n:03d}'
    trade = TRADES[(n - 1) % len(TRADES)]
    nat = NATIONALITIES[n % len(NATIONALITIES)]
    site_id = ALL_SITES[n % len(ALL_SITES)] if n % 10 != 0 else None   # 10% no site
    camp_id = ALL_CAMPS[n % len(ALL_CAMPS)] if n % 11 != 0 else None   # ~9% no camp
    join = today - timedelta(days=random.randint(30, 700))
    emps.append({
        'id': eid, 'employeeId': f'ASM-SEED-{n:03d}', 'fullName': f'Seed Worker {n:03d}',
        'nationality': nat, 'trade': trade, 'companyName': COMPANIES[n % 3],
        'currentSiteId': site_id, 'campId': camp_id, 'branchId': BRANCHES[n % 2][0],
        'joinDate': join.isoformat() + 'T00:00:00.000Z',
        'rating': round(random.uniform(3, 5), 1),
        'currentTotalWorkingHours': round(random.uniform(0, 1600), 1),
        'hoursThreshold': 1000, 'status': 'active', 'role': 'Standard',
    })

# one TL + one Sup per site (assign to first two site-assigned employees of each site)
tl_done, sup_done = set(), set()
for e in emps:
    s = e['currentSiteId']
    if not s:
        continue
    if s not in tl_done:
        e['isTeamLeader'], e['role'], e['teamLeaderSiteId'] = 1, 'Team Leader', s
        tl_done.add(s)
    elif s not in sup_done:
        e['isSupervisor'], e['role'], e['supervisorSiteId'] = 1, 'Supervisor', s
        sup_done.add(s)

# denormalized currentSite NAME must stay consistent with currentSiteId
site_names = dict(cur.execute("SELECT id, name FROM Site").fetchall())
rows = []
for e in emps:
    e['currentSite'] = site_names.get(e['currentSiteId'])
    rows.append((e['id'], e['employeeId'], e['fullName'], e['nationality'], e['trade'],
                 e['companyName'], e['currentSite'], e['currentSiteId'], e['campId'], e['branchId'],
                 e['joinDate'], e['rating'], e['currentTotalWorkingHours'], e['hoursThreshold'],
                 e['status'], e['role'], e['isTeamLeader'] if 'isTeamLeader' in e else 0,
                 e.get('teamLeaderSiteId'), e['isSupervisor'] if 'isSupervisor' in e else 0,
                 e.get('supervisorSiteId'), NOW_MS, NOW_MS))
ins('Employee', ['id', 'employeeId', 'fullName', 'nationality', 'trade', 'companyName', 'currentSite',
                 'currentSiteId', 'campId', 'branchId', 'joinDate', 'rating', 'currentTotalWorkingHours',
                 'hoursThreshold', 'status', 'role', 'isTeamLeader', 'teamLeaderSiteId',
                 'isSupervisor', 'supervisorSiteId', 'createdAt', 'updatedAt'], rows)

# EmployeeTrade: match TradeRate rows for Hilti/Welder/Electrician/Foreman-ish trades
tr_by_trade = {t: i for i, t, _ in TRADE_RATES}
emp_trade_rows = []
rate_map = {t: r for _, t, r in TRADE_RATES}
mapping_trade = {'Welder': 'Welder', 'Electrician': 'Electrician', 'Scaffolder': 'Hilti', 'Steel Fixer': 'Hilti', 'Driver': 'Foreman'}
for e in emps:
    t = mapping_trade.get(e['trade'])
    if t:
        emp_trade_rows.append((f'seed_et_{e["id"]}', e['id'], tr_by_trade[t], NOW_MS, 'Seed Script'))
ins('EmployeeTrade', ['id', 'employeeId', 'tradeRateId', 'assignedAt', 'assignedBy'], emp_trade_rows)

# ~12 custom hourly rates
custom = [(f'seed_emp_{n:03d}', round(random.uniform(5, 9), 2)) for n in random.sample(range(1, 201), 12)]
cur.executemany('UPDATE Employee SET customHourlyRate=? WHERE id=?', [(r, i) for i, r in custom])

# ---------------------------------------------------------------- attendance (21 days)
att_rows = []
for d in range(21):
    day = (today - timedelta(days=d)).isoformat()
    for e in emps:
        r = random.random()
        status = 'present' if r > 0.08 else ('absent' if r > 0.03 else ('overtime' if r > 0.015 else 'camp_sitting'))
        ot = round(random.uniform(1, 4), 1) if status == 'overtime' else None
        site = e['currentSiteId'] or ALL_SITES[0]
        att_rows.append((f'seed_att_{e["id"]}_{day}', e['id'], site, day, status, ot))
ins('Attendance', ['id', 'employeeId', 'siteId', 'date', 'status', 'overtimeHours', 'updatedAt'],
    [r + (NOW_MS,) for r in att_rows])

# ---------------------------------------------------------------- attendance versions + share
snap1 = [{'employeeId': e['id'], 'fullName': e['fullName'], 'employeeCode': e['employeeId'], 'status': 'present', 'overtimeHours': None} for e in emps[:20]]
snap2 = [{'employeeId': e['id'], 'fullName': e['fullName'], 'employeeCode': e['employeeId'], 'status': 'present', 'overtimeHours': 2.0} for e in emps[:20]]
sd = (today - timedelta(days=1)).isoformat()
site0 = ALL_SITES[0]
# pick version numbers that cannot collide with pre-existing rows
base_v = cur.execute('SELECT COALESCE(MAX(versionNumber),0) FROM AttendanceVersion WHERE siteId=? AND date=?', (site0, sd)).fetchone()[0]
ins('AttendanceVersion', ['id', 'siteId', 'siteName', 'date', 'versionNumber', 'snapshot', 'source', 'summary', 'createdAt'],
    [('seed_ver_1', site0, site_names[site0], sd, base_v + 1, repr(snap1).replace("'", '"'), 'website', 'Marked 20 present', NOW_MS),
     ('seed_ver_2', site0, site_names[site0], sd, base_v + 2, repr(snap2).replace("'", '"'), 'website', 'Marked 20 present +2h OT', NOW_MS)])
ins('AttendanceShare', ['id', 'token', 'siteId', 'siteName', 'date', 'status', 'createdAt', 'updatedAt'],
    [('seed_share_1', 'seed-share-token-open-0001', ALL_SITES[1], site_names[ALL_SITES[1]], today.isoformat(), 'open', NOW_MS, NOW_MS),
     ('seed_share_2', 'seed-share-token-subm-0002', ALL_SITES[2], site_names[ALL_SITES[2]], sd, 'submitted', NOW_MS, NOW_MS)])

# ---------------------------------------------------------------- working hours (3 months)
wh_rows = []
for m in (CUR_MONTH, PREV_MONTH, PREV2_MONTH):
    for e in emps:
        hrs = round(random.uniform(120, 300), 1)
        wh_rows.append((f'seed_wh_{e["id"]}_{m}', e['id'], e['fullName'], m, hrs, 2.5, 0))
ins('TotalEmployeeWorkingHours', ['id', 'empId', 'empName', 'month', 'totalWorkingHours', 'rtPerHour', 'isCustom', 'updatedAt'],
    [r + (NOW_MS,) for r in wh_rows])

# ---------------------------------------------------------------- salary records (2 months)
sal_rows = []
for m in (CUR_MONTH, PREV_MONTH):
    y = int(m[:4]); mo = int(m[5:7])
    for idx, e in enumerate([x for x in emps if x['currentSiteId']], 1):
        site = e['currentSiteId']
        total_h = round(random.uniform(180, 290), 1)
        tier = 'premium' if total_h > 240 or (e.get('isTeamLeader') or e.get('isSupervisor')) else 'standard'
        rate = rate_map.get(e['trade'], 3.5 if tier == 'standard' else 7.0)
        if e['trade'] in mapping_trade and e['trade'] in ('Welder', 'Electrician'):
            rate = rate_map[e['trade']]
        sal = round(total_h * rate, 2)
        ded = round(random.uniform(0, 60), 2)
        bal = round(sal - ded, 2)
        sal_rows.append((f'seed_sal_{e["id"]}_{m}', e['id'], e['fullName'], site, site_names[site], m, y,
                         e['nationality'], e['trade'], e['employeeId'], idx, total_h, rate, sal, ded, 0, bal,
                         1 if random.random() > 0.7 else 0, tier))
ins('SalaryRecord', ['id', 'empId', 'empName', 'siteId', 'siteName', 'month', 'year', 'nationality', 'trade',
                     'employeeCode', 'slNo', 'totalHours', 'rtPerHour', 'totalSalary', 'deduction', 'advance',
                     'balanceSalary', 'isPaid', 'rateTier', 'updatedAt'],
    [r + (NOW_MS,) for r in sal_rows])

# ---------------------------------------------------------------- advances + repayments
months_ahead = [(today.replace(day=28) + timedelta(days=10)).strftime('%Y-%m')]
adv_rows, rep_rows = [], []
one_time = [('seed_adv_001', emps[0], 500, 'Family emergency', 'pending'),
            ('seed_adv_002', emps[1], 300, 'Rent deposit', 'pending'),
            ('seed_adv_003', emps[2], 750, 'Medical', 'pending'),
            ('seed_adv_004', emps[3], 200, 'Travel', 'pending'),
            ('seed_adv_005', emps[4], 400, 'Visa fees', 'pending')]
for aid, e, amt, reason, st in one_time:
    adv_rows.append((aid, e['id'], e['fullName'], e['employeeId'], amt, reason, st, PREV_MONTH, int(PREV_MONTH[:4]), None,
                     'one_time', None, None, None, ADMIN_ID))
recurring = [('seed_adv_101', emps[10], 1200, 'Loan repayment', 100, 8),
             ('seed_adv_102', emps[11], 600, 'Bike loan', 150, 4),
             ('seed_adv_103', emps[12], 900, 'Family support', 75, 12)]
for aid, e, total, reason, monthly, installments in recurring:
    until = (today.replace(day=28) + timedelta(days=30 * installments)).strftime('%Y-%m')
    adv_rows.append((aid, e['id'], e['fullName'], e['employeeId'], total, reason, 'active', CUR_MONTH, CUR_YEAR, None,
                     'recurring', monthly, total, until, ADMIN_ID))
    for k in range(min(2, installments)):
        m = (today.replace(day=1) + timedelta(days=30 * k)).strftime('%Y-%m')
        rep_rows.append((f'seed_rep_{aid}_{k}', aid, e['id'], None, m, int(m[:4]), monthly))
ins('Advance', ['id', 'empId', 'empName', 'employeeCode', 'amount', 'reason', 'status', 'effectiveMonth',
                'effectiveYear', 'appliedToSalaryRecordId', 'deductionType', 'monthlyDeductionAmount',
                'remainingBalance', 'recurringUntil', 'createdById', 'updatedAt'],
    [r + (NOW_MS,) for r in adv_rows])
ins('AdvanceRepayment', ['id', 'advanceId', 'empId', 'salaryRecordId', 'month', 'year', 'amount'], rep_rows)

# ---------------------------------------------------------------- warnings / fines / leave / cancellations
warn_rows, fine_rows = [], []
for k in range(10):
    e = emps[20 + k]
    warn_rows.append((f'seed_warn_{k:02d}', e['id'], 'Absence without notice', 0, None,
                      (today - timedelta(days=random.randint(1, 40))).isoformat() + 'T00:00:00.000Z', ADMIN_ID))
for k in range(8):
    e = emps[40 + k]
    fine_rows.append((f'seed_fine_{k:02d}', e['id'], 'Safety violation', round(random.uniform(25, 150), 2),
                      (today - timedelta(days=random.randint(1, 40))).isoformat() + 'T00:00:00.000Z', ADMIN_ID))
ins('Warning', ['id', 'employeeId', 'reason', 'isAutoGenerated', 'absentDates', 'customDate', 'createdById', 'updatedAt'],
    [r + (NOW_MS,) for r in warn_rows])
ins('Fine', ['id', 'employeeId', 'reason', 'amount', 'customDate', 'createdById', 'updatedAt'],
    [r + (NOW_MS,) for r in fine_rows])

lv_rows = []
for k in range(12):
    e = emps[60 + k]
    start = today + timedelta(days=random.randint(-30, 30))
    days = random.randint(1, 10)
    st = ['pending', 'approved', 'rejected'][k % 3]
    lv_rows.append((f'seed_leave_{k:02d}', e['id'], ['casual', 'sick', 'annual', 'emergency'][k % 4],
                    start.isoformat() + 'T00:00:00.000Z', (start + timedelta(days=days)).isoformat() + 'T00:00:00.000Z',
                    days, 'Personal reason', st, ADMIN_ID, (today - timedelta(days=random.randint(1, 20))).isoformat() + 'T00:00:00.000Z' if st != 'pending' else None,
                    ADMIN_ID if st != 'pending' else None))
ins('LeaveRequest', ['id', 'employeeId', 'leaveType', 'startDate', 'endDate', 'totalDays', 'reason', 'status',
                     'createdById', 'reviewedAt', 'reviewedById', 'updatedAt'],
    [r + (NOW_MS,) for r in lv_rows])

cx_rows = []
for k in range(5):
    e = emps[90 + k]
    cx_rows.append((f'seed_cx_{k:02d}', e['id'], 'Contract completed', ['pending', 'approved', 'rejected'][k % 3],
                    (today - timedelta(days=random.randint(1, 30))).isoformat() + 'T00:00:00.000Z', ADMIN_ID))
ins('CancellationRequest', ['id', 'employeeId', 'reason', 'status', 'customDate', 'requestedById', 'updatedAt'],
    [r + (NOW_MS,) for r in cx_rows])

# ---------------------------------------------------------------- uniforms + stock
stock = [('seed_stk_1', 'Uniform', 'M', 120, 20), ('seed_stk_2', 'Uniform', 'L', 90, 20),
         ('seed_stk_3', 'Uniform', 'XL', 45, 15), ('seed_stk_4', 'Shoes', '42', 60, 10),
         ('seed_stk_5', 'Shoes', '43', 55, 10), ('seed_stk_6', 'Helmet', 'One Size', 200, 30),
         ('seed_stk_7', 'Water Bottle', 'One Size', 150, 25), ('seed_stk_8', 'Safety Vest', 'L', 8, 20)]
ins('StockItem', ['id', 'itemName', 'size', 'quantity', 'minQuantity', 'updatedAt'],
    [r + (NOW_MS,) for r in stock])

uni_rows = []
for k in range(10):
    e = emps[100 + k]
    uni_rows.append((f'seed_uni_{k:02d}', 9001 + k, 7000 + k, e['fullName'], e['id'],
                     'passport' if k % 2 else 'id', f'encrypted-seed-doc-{k}',
                     '[{"item":"Uniform","qty":1},{"item":"Shoes","qty":1}]', '{"uniform":"L","shoes":"42"}',
                     e['currentSite'], None, 0, (today + timedelta(days=180)).isoformat() + 'T00:00:00.000Z'))
ins('UniformRegistry', ['id', 'uniformId', 'tokenNumber', 'employeeName', 'employeeId', 'documentType',
                        'documentNumber', 'items', 'sizes', 'siteName', 'teamLeaderName', 'isRenewal', 'renewalDate'], uni_rows)

# ---------------------------------------------------------------- notifications
notif = [('seed_ntf_1', 'New leave request', 'Seed Worker 061 requested annual leave', 'request'),
         ('seed_ntf_2', 'Warning issued', 'Warning issued to Seed Worker 021', 'warning'),
         ('seed_ntf_3', 'Fine recorded', 'Fine of AED 80 recorded for Seed Worker 041', 'fine'),
         ('seed_ntf_4', 'Advance request', 'Seed Worker 001 requested AED 500 advance', 'request'),
         ('seed_ntf_5', 'Cancellation request', 'Cancellation requested for Seed Worker 091', 'request'),
         ('seed_ntf_6', 'Passport expiring', 'Passport of Seed Worker 111 expires soon', 'request')]
ins('Notification', ['id', 'userId', 'title', 'message', 'type', 'updatedAt'],
    [(i, ADMIN_ID, t, m, ty, NOW_MS) for i, t, m, ty in notif])

# ---------------------------------------------------------------- site history / activations / worklogs
hist = []
for e in [x for x in emps if x['currentSiteId']]:
    hist.append((f'seed_hist_{e["id"]}', e['id'], e['fullName'], e['currentSiteId'], e['currentSite'], CUR_MONTH))
ins('EmpCountSitePerMonth', ['id', 'empId', 'empName', 'siteId', 'siteName', 'month', 'updatedDate'],
    [r + (NOW_MS,) for r in hist])

ins('SiteMonthActivation', ['id', 'siteId', 'month', 'year'],
    [(f'seed_act_{s}_{CUR_MONTH}', s, CUR_MONTH, CUR_YEAR) for s in ALL_SITES])

wl_rows = []
for k, e in enumerate([x for x in emps if x['currentSiteId']][:100]):
    wl_rows.append((f'seed_wl_{k:03d}', e['id'], e['currentSiteId'], CUR_YEAR, int(CUR_MONTH[5:7]),
                    round(random.uniform(150, 280), 1), round(random.uniform(0, 100), 2), 0))
ins('WorkLog', ['logId', 'employeeId', 'siteId', 'year', 'month', 'hoursWorked', 'allowances', 'deductions'], [])
cur.executemany("INSERT INTO WorkLog (employeeId, siteId, year, month, hoursWorked, allowances, deductions, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)",
                [(r[1], r[2], r[3], r[4], r[5], r[6], r[7], NOW_MS, NOW_MS) for r in wl_rows])

# ---------------------------------------------------------------- rate changelogs
rc_rows = []
for k, (eid, rate) in enumerate(custom[:10]):
    rc_rows.append((f'seed_rc_{k:02d}', eid, rate, CUR_MONTH, 'Seed initial rate', 'Seed Script'))
ins('EmployeeRateChangelog', ['id', 'employeeId', 'rate', 'effectiveMonth', 'reason', 'createdBy', 'updatedAt'],
    [r + (NOW_MS,) for r in rc_rows])

# ---------------------------------------------------------------- employee documents (real tiny PDFs)
doc_rows = []
for e in emps[:60]:
    n_docs = random.randint(1, 3)
    types = random.sample(['passport', 'id_card', 'visa', 'other'], n_docs)
    folder = os.path.join(STORAGE, e['id'])
    os.makedirs(folder, exist_ok=True)
    for k, t in enumerate(types):
        fname = f'{t.upper().replace("_", "_")}_SEED_{e["employeeId"]}.pdf'
        rel = f'storage/employee-documents/{e["id"]}/{fname}'
        with open(os.path.join(folder, fname), 'wb') as f:
            f.write(mini_pdf(f'{e["employeeId"]} {t}'))
        expiry = (today + timedelta(days=random.randint(30, 900))).isoformat() if t in ('passport', 'id_card', 'visa') else None
        doc_rows.append((f'seed_doc_{e["id"]}_{t}', e['id'], t, f'{t.replace("_", " ").title()} (seed)',
                         fname, rel, 'application/pdf', len(mini_pdf(t)), 'ACTIVE', expiry, None, 'Seed Script'))
ins('EmployeeDocument', ['id', 'employeeId', 'docType', 'docName', 'fileName', 'filePath', 'mimeType',
                         'fileSize', 'status', 'expiryDate', 'notes', 'createdBy', 'createdAt', 'updatedAt'],
    [r + (NOW_MS, NOW_MS) for r in doc_rows])

con.commit()

# ---------------------------------------------------------------- summary
counts = {}
for t in ['Branch', 'Camp', 'Site', 'Employee', 'TradeRate', 'EmployeeTrade', 'Attendance', 'AttendanceVersion',
          'AttendanceShare', 'TotalEmployeeWorkingHours', 'SalaryRecord', 'Advance', 'AdvanceRepayment',
          'Warning', 'Fine', 'LeaveRequest', 'CancellationRequest', 'StockItem', 'UniformRegistry',
          'Notification', 'EmpCountSitePerMonth', 'SiteMonthActivation', 'WorkLog',
          'EmployeeRateChangelog', 'EmployeeDocument']:
    counts[t] = cur.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
con.close()
for k, v in counts.items():
    print(f'{k}: {v}')
print('SEED COMPLETE')
