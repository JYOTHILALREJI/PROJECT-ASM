#!/usr/bin/env python3
"""ASM database integrity audit — checks EVERY foreign-key relation, duplicate
risks, business-rule consistency and orphaned files. Exits non-zero if any
error-severity finding exists."""
import os
import sqlite3
import sys

DB = '/home/z/my-project/db/custom.db'
STORAGE = '/home/z/my-project/storage'
con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
con.row_factory = sqlite3.Row
cur = con.cursor()

ERRORS, WARNINGS = [], []


def check_fk(child_table, child_col, parent_table, nullable=True, ignore_deleted_child=False):
    """Every non-null child value must reference an existing parent row."""
    where = f"WHERE c.{child_col} IS NOT NULL"
    if ignore_deleted_child:
        where += " AND c.deletedAt IS NULL"
    rows = cur.execute(f"""
        SELECT c.{child_col} AS v, COUNT(*) AS n
        FROM {child_table} c
        LEFT JOIN {parent_table} p ON p.id = c.{child_col}
        {where} AND p.id IS NULL
        GROUP BY c.{child_col} LIMIT 10""").fetchall()
    total = cur.execute(f"""
        SELECT COUNT(*) FROM {child_table} c
        LEFT JOIN {parent_table} p ON p.id = c.{child_col}
        {where} AND p.id IS NULL""").fetchone()[0]
    if total:
        ERRORS.append(f'ORPHAN FK: {child_table}.{child_col} -> {parent_table}: {total} orphan row(s), e.g. {[dict(r) for r in rows[:3]]}')


print('=' * 70)
print('1. FOREIGN KEY RELATIONS')
print('=' * 70)
fk_checks = [
    ('Employee.campId', 'Employee', 'campId', 'Camp'),
    ('Employee.currentSiteId', 'Employee', 'currentSiteId', 'Site'),
    ('Employee.branchId', 'Employee', 'branchId', 'Branch'),
    ('Employee.teamLeaderSiteId', 'Employee', 'teamLeaderSiteId', 'Site'),
    ('Employee.supervisorSiteId', 'Employee', 'supervisorSiteId', 'Site'),
    ('Attendance.employeeId', 'Attendance', 'employeeId', 'Employee'),
    ('Attendance.siteId', 'Attendance', 'siteId', 'Site'),
    ('SalaryRecord.empId', 'SalaryRecord', 'empId', 'Employee'),
    ('SalaryRecord.siteId', 'SalaryRecord', 'siteId', 'Site'),
    ('TotalEmployeeWorkingHours.empId', 'TotalEmployeeWorkingHours', 'empId', 'Employee'),
    ('Advance.empId', 'Advance', 'empId', 'Employee'),
    ('AdvanceRepayment.advanceId', 'AdvanceRepayment', 'advanceId', 'Advance'),
    ('AdvanceRepayment.empId', 'AdvanceRepayment', 'empId', 'Employee'),
    ('Warning.employeeId', 'Warning', 'employeeId', 'Employee'),
    ('Warning.createdById', 'Warning', 'createdById', 'User'),
    ('Fine.employeeId', 'Fine', 'employeeId', 'Employee'),
    ('Fine.createdById', 'Fine', 'createdById', 'User'),
    ('LeaveRequest.employeeId', 'LeaveRequest', 'employeeId', 'Employee'),
    ('LeaveRequest.createdById', 'LeaveRequest', 'createdById', 'User'),
    ('CancellationRequest.employeeId', 'CancellationRequest', 'employeeId', 'Employee'),
    ('CancellationRequest.requestedById', 'CancellationRequest', 'requestedById', 'User'),
    ('UniformRegistry.employeeId', 'UniformRegistry', 'employeeId', 'Employee'),
    ('EmpCountSitePerMonth.empId', 'EmpCountSitePerMonth', 'empId', 'Employee'),
    ('EmpCountSitePerMonth.siteId', 'EmpCountSitePerMonth', 'siteId', 'Site'),
    ('WorkLog.employeeId', 'WorkLog', 'employeeId', 'Employee'),
    ('WorkLog.siteId', 'WorkLog', 'siteId', 'Site'),
    ('EmployeeTrade.employeeId', 'EmployeeTrade', 'employeeId', 'Employee'),
    ('EmployeeTrade.tradeRateId', 'EmployeeTrade', 'tradeRateId', 'TradeRate'),
    ('EmployeeRateChangelog.employeeId', 'EmployeeRateChangelog', 'employeeId', 'Employee'),
    ('EmployeeDocument.employeeId', 'EmployeeDocument', 'employeeId', 'Employee'),
    ('Notification.userId', 'Notification', 'userId', 'User'),
    ('NocDocument.stampId', 'NocDocument', 'stampId', 'Stamp'),
    ('NocDocument.companyId', 'NocDocument', 'companyId', 'NocCompany'),
    ('NocDocumentPackage.nocId', 'NocDocumentPackage', 'nocId', 'NocDocument'),
    ('AdminPermission.adminId', 'AdminPermission', 'adminId', 'User'),
    ('AdminPermission.permissionId', 'AdminPermission', 'permissionId', 'Permission'),
    ('AdminMenuPermission.userId', 'AdminMenuPermission', 'userId', 'User'),
    ('AttendanceVersion.siteId', 'AttendanceVersion', 'siteId', 'Site'),
    ('Site.branchId', 'Site', 'branchId', 'Branch'),
    ('Stamp.companyId', 'Stamp', 'companyId', 'NocCompany'),
]
for label, t, c, p in fk_checks:
    before = len(ERRORS)
    check_fk(t, c, p)
    print(f'  {"OK " if len(ERRORS) == before else "ERR"} {label} -> {p}')

print()
print('=' * 70)
print('2. UNIQUE / DUPLICATE CHECKS')
print('=' * 70)
dup_checks = [
    ('Employee.employeeId', 'SELECT employeeId, COUNT(*) n FROM Employee GROUP BY employeeId HAVING n > 1'),
    ('EmployeeTrade.employeeId (one trade row per employee)', 'SELECT employeeId, COUNT(*) n FROM EmployeeTrade GROUP BY employeeId HAVING n > 1'),
    ('Attendance (employeeId, date)', 'SELECT employeeId, date, COUNT(*) n FROM Attendance GROUP BY employeeId, date HAVING n > 1'),
    ('SalaryRecord unique tuple', "SELECT empId, siteId, month, year, rateTier, COUNT(*) n FROM SalaryRecord GROUP BY empId, siteId, month, year, rateTier HAVING n > 1"),
    ('TotalEmployeeWorkingHours (empId, month)', 'SELECT empId, month, COUNT(*) n FROM TotalEmployeeWorkingHours GROUP BY empId, month HAVING n > 1'),
    ('WorkLog (employeeId, siteId, year, month)', 'SELECT employeeId, siteId, year, month, COUNT(*) n FROM WorkLog GROUP BY employeeId, siteId, year, month HAVING n > 1'),
    ('EmpCountSitePerMonth (empId, siteId, month)', 'SELECT empId, siteId, month, COUNT(*) n FROM EmpCountSitePerMonth GROUP BY empId, siteId, month HAVING n > 1'),
    ('Camp.name', 'SELECT name, COUNT(*) n FROM Camp GROUP BY name HAVING n > 1'),
    ('Site.name', 'SELECT name, COUNT(*) n FROM Site GROUP BY name HAVING n > 1'),
    ('Branch.name', 'SELECT name, COUNT(*) n FROM Branch GROUP BY name HAVING n > 1'),
    ('NocDocument (nocNumber, version)', 'SELECT nocNumber, version, COUNT(*) n FROM NocDocument GROUP BY nocNumber, version HAVING n > 1'),
    ('AdvanceRepayment (advanceId, month)', 'SELECT advanceId, month, COUNT(*) n FROM AdvanceRepayment GROUP BY advanceId, month HAVING n > 1'),
    ('AttendanceVersion (siteId, date, versionNumber)', 'SELECT siteId, date, versionNumber, COUNT(*) n FROM AttendanceVersion GROUP BY siteId, date, versionNumber HAVING n > 1'),
    ('UniformRegistry.uniformId', 'SELECT uniformId, COUNT(*) n FROM UniformRegistry GROUP BY uniformId HAVING n > 1'),
    ('UniformRegistry.tokenNumber', 'SELECT tokenNumber, COUNT(*) n FROM UniformRegistry GROUP BY tokenNumber HAVING n > 1'),
    ('StockItem (itemName, size)', 'SELECT itemName, size, COUNT(*) n FROM StockItem GROUP BY itemName, size HAVING n > 1'),
    ('AdminPermission (adminId, permissionId)', 'SELECT adminId, permissionId, COUNT(*) n FROM AdminPermission GROUP BY adminId, permissionId HAVING n > 1'),
    ('AdminMenuPermission (userId, menuKey)', 'SELECT userId, menuKey, COUNT(*) n FROM AdminMenuPermission GROUP BY userId, menuKey HAVING n > 1'),
]
for label, sql in dup_checks:
    rows = cur.execute(sql).fetchall()
    if rows:
        ERRORS.append(f'DUPLICATE: {label}: {[dict(r) for r in rows[:3]]}')
        print(f'  ERR {label} — {len(rows)} duplicate group(s)')
    else:
        print(f'  OK  {label}')

print()
print('=' * 70)
print('3. BUSINESS-RULE CONSISTENCY')
print('=' * 70)

# currentSite denormalized name must match the Site row
rows = cur.execute("""
    SELECT e.id, e.employeeId, e.currentSite, s.name AS siteName
    FROM Employee e JOIN Site s ON s.id = e.currentSiteId
    WHERE e.currentSite IS NULL OR e.currentSite != s.name""").fetchall()
if rows:
    ERRORS.append(f'INCONSISTENT denormalized currentSite name vs Site.name: {len(rows)} rows, e.g. {[dict(r) for r in rows[:3]]}')
print(f'  {"OK " if not rows else "ERR"} Employee.currentSite name matches Site.name ({cur.execute("SELECT COUNT(*) FROM Employee WHERE currentSiteId IS NOT NULL").fetchone()[0]} assigned)')

# employees pointing at soft-deleted camps/sites/branches
for label, sql in [
    ('Employee -> deleted Camp', "SELECT COUNT(*) FROM Employee e JOIN Camp c ON c.id=e.campId WHERE c.deletedAt IS NOT NULL"),
    ('Employee -> deleted Site', "SELECT COUNT(*) FROM Employee e JOIN Site s ON s.id=e.currentSiteId WHERE s.deletedAt IS NOT NULL"),
    ('Employee -> deleted Branch', "SELECT COUNT(*) FROM Employee e JOIN Branch b ON b.id=e.branchId WHERE b.deletedAt IS NOT NULL"),
    ('ACTIVE NOC -> deleted stamp/company', "SELECT COUNT(*) FROM NocDocument n LEFT JOIN Stamp s ON s.id=n.stampId LEFT JOIN NocCompany c ON c.id=n.companyId WHERE n.deletedAt IS NULL AND ((n.stampId IS NOT NULL AND (s.id IS NULL OR s.deletedAt IS NOT NULL)) OR (n.companyId IS NOT NULL AND (c.id IS NULL OR c.deletedAt IS NOT NULL)))"),
    ('Recurring advance remainingBalance <= 0 but active', "SELECT COUNT(*) FROM Advance WHERE deductionType='recurring' AND status='active' AND remainingBalance IS NOT NULL AND remainingBalance <= 0"),
    ('Recurring advance remainingBalance > amount', "SELECT COUNT(*) FROM Advance WHERE deductionType='recurring' AND remainingBalance IS NOT NULL AND remainingBalance > amount"),
]:
    n = cur.execute(sql).fetchone()[0]
    if n:
        ERRORS.append(f'{label}: {n} row(s)')
        print(f'  ERR {label} — {n}')
    else:
        print(f'  OK  {label}')

# business rule: at most one Team Leader / Supervisor per site
for flag, site_col, label in [('isTeamLeader', 'teamLeaderSiteId', 'Team Leader'), ('isSupervisor', 'supervisorSiteId', 'Supervisor')]:
    rows = cur.execute(f"""
        SELECT {site_col} AS siteId, COUNT(*) n FROM Employee
        WHERE {flag}=1 AND {site_col} IS NOT NULL AND status='active'
        GROUP BY {site_col} HAVING n > 1""").fetchall()
    if rows:
        WARNINGS.append(f'{label}: multiple per site: {[dict(r) for r in rows[:3]]}')
        print(f'  WARN {label} duplicated on site(s): {[dict(r) for r in rows[:3]]}')
    else:
        print(f'  OK  max one {label} per site')

# role vs flags consistency
rows = cur.execute("""SELECT id, role, isTeamLeader, isSupervisor FROM Employee
    WHERE (isTeamLeader=1 AND role != 'Team Leader')
       OR (isSupervisor=1 AND role != 'Supervisor')
       OR (isTeamLeader=0 AND isSupervisor=0 AND role IN ('Team Leader','Supervisor'))""").fetchall()
if rows:
    WARNINGS.append(f'role/flags mismatch: {len(rows)} rows, e.g. {[dict(r) for r in rows[:3]]}')
    print(f'  WARN role vs isTeamLeader/isSupervisor mismatch — {len(rows)} rows')
else:
    print('  OK  role matches TL/Sup flags')

# camp occupancy within capacity
rows = cur.execute("""
    SELECT c.id, c.name, c.totalBedSpaces, COUNT(e.id) n
    FROM Camp c JOIN Employee e ON e.campId = c.id AND e.status != 'deleted'
    WHERE c.deletedAt IS NULL
    GROUP BY c.id HAVING n > c.totalBedSpaces""").fetchall()
if rows:
    WARNINGS.append(f'Camp over capacity: {[dict(r) for r in rows]}')
    print(f'  WARN camp over capacity: {[dict(r) for r in rows]}')
else:
    print('  OK  all camps within bed capacity')

# attendance statuses valid
rows = cur.execute("""SELECT DISTINCT status FROM Attendance
    WHERE status NOT IN ('present','absent','no_site','overtime','camp_sitting','not_marked')""").fetchall()
print(f'  {"OK " if not rows else "ERR"} attendance status vocabulary {"" if not rows else str([r[0] for r in rows])}')
if rows:
    ERRORS.append(f'Unknown attendance status values: {[r[0] for r in rows]}')

print()
print('=' * 70)
print('4. SOFT-DELETE HYGIENE')
print('=' * 70)
hygiene = [
    ('Attendance of deleted employees without isHidden',
     "SELECT COUNT(*) FROM Attendance a JOIN Employee e ON e.id=a.employeeId WHERE e.status='deleted' AND a.isHidden=0"),
    ('Notifications of deleted users visible',
     "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.deletedAt IS NOT NULL AND n.isHidden=0"),
]
for label, sql in hygiene:
    n = cur.execute(sql).fetchone()[0]
    print(f'  INFO {label}: {n}')

print()
print('=' * 70)
print('5. ORPHAN FILES ON DISK')
print('=' * 70)
doc_rows = cur.execute("SELECT filePath FROM EmployeeDocument WHERE deletedAt IS NULL AND status='ACTIVE'").fetchall()
missing_files = [r['filePath'] for r in doc_rows if not os.path.isfile(os.path.join('/home/z/my-project', r['filePath']))]
if missing_files:
    ERRORS.append(f'EmployeeDocument rows whose file is MISSING on disk: {len(missing_files)}, e.g. {missing_files[:3]}')
    print(f'  ERR doc rows missing files: {len(missing_files)}')
else:
    print(f'  OK  all {len(doc_rows)} document files exist on disk')

on_disk = set()
for d in os.listdir(os.path.join(STORAGE, 'employee-documents')):
    p = os.path.join(STORAGE, 'employee-documents', d)
    if os.path.isdir(p):
        for f in os.listdir(p):
            on_disk.add(f'storage/employee-documents/{d}/{f}')
db_paths = {r['filePath'] for r in doc_rows}
extra = on_disk - db_paths
if extra:
    WARNINGS.append(f'Files on disk not referenced by any ACTIVE row: {len(extra)}, e.g. {sorted(extra)[:3]}')
    print(f'  INFO unreferenced files on disk: {len(extra)} (REPLACED history keeps files — expected)')
else:
    print('  OK  no unreferenced files')

print()
print('=' * 70)
print('6. INDEX COVERAGE (hot query paths)')
print('=' * 70)
expected_indexes = [
    ('Employee', ['campId', 'currentSiteId', 'fullName', 'employeeId', 'trade', 'status']),
    ('Attendance', ['employeeId', 'date', 'siteId']),
    ('SalaryRecord', ['empId', 'siteId', 'month']),
    ('EmployeeDocument', ['employeeId', 'docType', 'status']),
]
for table, cols in expected_indexes:
    idx_cols = set()
    for r in cur.execute(f'PRAGMA index_list({table})').fetchall():
        cols_i = [x['name'] for x in cur.execute(f'PRAGMA index_info({r["name"]})').fetchall()]
        idx_cols.update(cols_i)
    missing = [c for c in cols if c not in idx_cols]
    if missing:
        ERRORS.append(f'MISSING INDEX on {table}: {missing}')
        print(f'  ERR {table} missing indexes: {missing}')
    else:
        print(f'  OK  {table} indexed on {cols}')

con.close()
print()
print('=' * 70)
print(f'AUDIT RESULT: {len(ERRORS)} error(s), {len(WARNINGS)} warning(s)')
print('=' * 70)
for e in ERRORS:
    print('ERROR:', e)
for w in WARNINGS:
    print('WARN :', w)
sys.exit(1 if ERRORS else 0)
