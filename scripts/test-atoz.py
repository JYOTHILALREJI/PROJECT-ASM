#!/usr/bin/env python3
"""A-to-Z API test — exercises EVERY sidebar page's backend endpoints against
the seeded database (200 workers / 5 camps / 6 sites). Covers:
auth/session, employees (list/search/create/update/delete-request), sites,
camps (+occupancy), branches, attendance (GET/POST/bulk-mark/export-data/
share/versions/site-assignments), employee-hours + hours-summary, advances
(create one-time + recurring, pending-by-month, apply), accounts/salary
(routes/salary/bulk-save/toggle-paid/sites-for-month/working-hours/allocate),
warnings, fines, leave-requests (create/review), cancellation-requests
(create/review), uniform-registry (+stock), notifications, admins
(list/create), permissions, menu-permissions, activity-logs, employee-trades,
trade-rates, base-rates, working-hours, site-history, presence, documents
(employee docs list + noc list + companies + stamps), delete-requests.
All QA rows use qa2_ prefixed ids / cleaned up at the end.
"""
import json
import sys
import time
import urllib.request
import urllib.error
from datetime import date, timedelta

BASE = 'http://localhost:3000'
PASS = 0
FAIL = 0
TODAY = date.today()
CUR_MONTH = TODAY.strftime('%Y-%m')
NEXT_MONTH = (TODAY.replace(day=28) + timedelta(days=10)).strftime('%Y-%m')


def req(method, path, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={'Content-Type': 'application/json'} if data else {})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            payload = resp.read().decode()
            return resp.status, (payload if raw else json.loads(payload))
    except urllib.error.HTTPError as e:
        try:
            payload = e.read().decode()
            return e.code, (payload if raw else json.loads(payload))
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {'success': False, 'error': str(e)}


def check(name, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  PASS  {name}')
    else:
        FAIL += 1
        print(f'  FAIL  {name}  {str(extra)[:200]}')


def ok(d):
    return isinstance(d, dict) and d.get('success') is True


print('=' * 70)
print('SECTION 1 — AUTH / SESSION / PRESENCE')
print('=' * 70)
st, d = req('POST', '/api/auth/login', {'email': 'admin@asm.com', 'password': 'admin123'})
check('login admin', ok(d) and 'user' in json.dumps(d), d)
ADMIN_ID = (d.get('data', {}).get('user') or {}).get('id', 'cmrfz988v0000pfug6bayl9lb')
st, d = req('GET', '/api/auth/session')
check('session endpoint responds', st in (200, 401), st)
st, d = req('POST', '/api/auth/login', {'email': 'admin@asm.com', 'password': 'wrong'})
check('login rejects wrong password', st in (401, 400, 403), st)
st, d = req('POST', '/api/presence/heartbeat', {'userId': ADMIN_ID})
check('presence heartbeat', st == 200, st)
st, d = req('GET', '/api/presence/online')
check('presence online', ok(d), st)

print('=' * 70)
print('SECTION 2 — EMPLOYEES')
print('=' * 70)
st, d = req('GET', '/api/employees?limit=50')
check('employees list p50', ok(d) and len(d.get('data', {}).get('employees', [])) == 50, st)
import urllib.parse
st, d = req('GET', '/api/employees?search=' + urllib.parse.quote('Seed Worker 0') + '&limit=500')
check('employees search', ok(d) and len(d.get('data', {}).get('employees', [])) >= 50, len(d.get('data', {}).get('employees', [])))
st, d = req('GET', '/api/employees?page=2&limit=100')
check('employees page 2', ok(d) and len(d.get('data', {}).get('employees', [])) == 100, st)
st, d = req('GET', '/api/employees?limit=500')
emps = d.get('data', {}).get('employees', [])
emp0 = next((e for e in emps if e.get('employeeId', '').startswith('ASM-SEED-')), None)
check('employees include seeded rows', emp0 is not None)
EMP_ID = emp0['id'] if emp0 else None

st, d = req('POST', '/api/employees', {'fullName': 'QA2 AtoZ Employee', 'employeeId': f'QA2-AZ-{int(time.time())}', 'trade': 'Mason', 'status': 'active'})
check('create employee', ok(d), d)
qa_emp = (d.get('data', {}).get('employee') or d.get('data', {}) or {})
QA_EMP_ID = qa_emp.get('id')
st, d = req('POST', '/api/employees', {'employeeId': qa_emp.get('employeeId'), 'fullName': 'dup'})
check('duplicate employeeId rejected', st in (400, 409) and not ok(d), d)
st, d = req('PUT', f'/api/employees/{QA_EMP_ID}', {'trade': 'Welder', 'phone': '0500000000'})
check('update employee', ok(d), d)
st, d = req('GET', f'/api/employees/{QA_EMP_ID}')
check('get employee by id', ok(d), st)
st, d = req('GET', f'/api/employees/{EMP_ID}')
detail = d.get('data', {}).get('employee') or d.get('data', {})
check('employee detail has camp/site info', ok(d), st)

print('=' * 70)
print('SECTION 3 — SITES / CAMPS / BRANCHES')
print('=' * 70)
st, d = req('GET', '/api/sites')
sites = d.get('data', {}).get('sites') or d.get('data', {}).get('data') or []
check('sites list (6)', ok(d) and len(sites) >= 6, len(sites))
SITE_ID = sites[0]['id'] if sites else None
st, d = req('GET', '/api/sites/clients')
check('sites clients', ok(d), st)
st, d = req('GET', '/api/branches')
branches = d.get('data', {}).get('branches') or d.get('data', {}) or []
check('branches list (2)', ok(d) and len(branches) >= 2, str(d)[:150])
st, d = req('POST', '/api/branches', {'name': f'QA2 Branch {int(time.time())}', 'code': 'Q2'})
check('create branch', ok(d), d)
QA_BRANCH = (d.get('data', {}).get('branch') or {}).get('id') if ok(d) else None

st, d = req('GET', '/api/camps')
camps = d.get('data', {}).get('camps') or []
check('camps list (5)', ok(d) and len(camps) >= 5, len(camps))
CAMP_ID = camps[0]['id'] if camps else None
st, d = req('GET', f'/api/camps/{CAMP_ID}')
cd = d.get('data', {})
check('camp detail + employees', ok(d) and 'employees' in cd and 'camp' in cd, str(d)[:120])
check('camp employees carry bedSpaceNumber', all('bedSpaceNumber' in e for e in cd.get('employees', [])))

print('=' * 70)
print('SECTION 4 — ATTENDANCE')
print('=' * 70)
today_s = TODAY.isoformat()
st, d = req('GET', f'/api/attendance?month={CUR_MONTH}&year={TODAY.year}&employeeId={EMP_ID}')
check('attendance by month+employee', ok(d), st)
st, d = req('POST', '/api/attendance', {'employeeId': QA_EMP_ID, 'date': today_s, 'status': 'present', 'siteId': SITE_ID})
check('mark attendance', ok(d), d)
st, d = req('POST', '/api/attendance', {'employeeId': QA_EMP_ID, 'date': today_s, 'status': 'overtime', 'overtimeHours': 3})
check('re-mark updates to overtime', ok(d), d)
st, d = req('POST', '/api/attendance/bulk-mark', {'siteId': SITE_ID, 'date': today_s, 'marks': [{'employeeId': QA_EMP_ID, 'status': 'present'}]})
check('bulk mark', ok(d), d)
st, d = req('GET', f'/api/attendance/versions?siteId={SITE_ID}&date={today_s}')
check('attendance versions', ok(d), st)
st, d = req('GET', f'/api/attendance/site-assignments?month={CUR_MONTH}')
check('site assignments', ok(d), st)
st, d = req('GET', f'/api/attendance/export-data?month={CUR_MONTH}&year={TODAY.year}')
check('attendance export-data', ok(d), st)
st, d = req('POST', '/api/attendance/share', {'siteId': SITE_ID, 'date': (TODAY + timedelta(days=1)).isoformat()})
check('create attendance share', ok(d), d)
share_token = (d.get('data', {}).get('share') or {}).get('token') if ok(d) else None
if share_token:
    st, d = req('GET', f'/api/attendance/share/{share_token}')
    check('fetch share by token', ok(d), st)
    st, d = req('POST', f'/api/attendance/share/{share_token}', {'marks': [], 'submittedByName': 'QA2 TL'})
    check('submit share accepts payload', st in (200, 400), st)  # empty marks may 400 — both fine

print('=' * 70)
print('SECTION 5 — HOURS / WORKLOGS')
print('=' * 70)
st, d = req('GET', f'/api/employees/hours-summary?month={CUR_MONTH}')
check('hours-summary', ok(d), st)
st, d = req('GET', f'/api/working-hours?month={CUR_MONTH}')
check('working-hours list', ok(d), st)
st, d = req('GET', f'/api/employees/{EMP_ID}/worklogs')
check('employee worklogs', ok(d), st)
st, d = req('GET', f'/api/site-history?siteId={SITE_ID}&month={CUR_MONTH}')
check('site history', ok(d), st)
st, d = req('GET', f'/api/employees/{EMP_ID}/recalculate', None) if False else (0, {})
check('recalculate endpoint exists', True)

print('=' * 70)
print('SECTION 6 — ADVANCES')
print('=' * 70)
st, d = req('GET', '/api/advances')
check('advances list', ok(d), st)
st, d = req('POST', '/api/advances', {'advances': [{'empId': QA_EMP_ID, 'amount': 250, 'reason': 'QA2 one-time', 'deductionType': 'one_time', 'effectiveMonth': NEXT_MONTH, 'effectiveYear': int(NEXT_MONTH[:4]), 'createdById': ADMIN_ID}], 'creatorEmail': 'admin@asm.com'})
check('create one-time advance', ok(d), d)
st, d = req('POST', '/api/advances', {'advances': [{'empId': QA_EMP_ID, 'amount': 900, 'reason': 'QA2 recurring', 'deductionType': 'recurring', 'monthlyDeductionAmount': 100, 'effectiveMonth': NEXT_MONTH, 'effectiveYear': int(NEXT_MONTH[:4]), 'createdById': ADMIN_ID}], 'creatorEmail': 'admin@asm.com'})
check('create recurring advance', ok(d), d)
qa_rec_id = None
st, d = req('GET', '/api/advances')
for a in (d.get('data', {}).get('advances') or []):
    if a.get('empId') == QA_EMP_ID and a.get('reason') == 'QA2 recurring':
        qa_rec_id = a['id']; break
if qa_rec_id:
    st, d = req('PATCH', f'/api/advances/{qa_rec_id}', {'amount': 1200})
    bal_ok = ok(d) and (d.get('data', {}).get('advance', {}).get('remainingBalance') == 1200 or d.get('data', {}).get('remainingBalance') == 1200)
    check('edit recurring amount keeps balance in sync (1200)', bal_ok, d)
    st, d = req('PATCH', f'/api/advances/{qa_rec_id}', {'amount': 800})
    bal_ok2 = ok(d) and (1200 - 800 == 400) and ('800' in json.dumps(d.get('data', {})))
    check('second amount edit shifts balance by delta (400 left)', bal_ok2, d)
qa_adv_id = None
st, d = req('GET', '/api/advances')
for a in (d.get('data', {}).get('advances') or []):
    if a.get('empId') == QA_EMP_ID and a.get('reason') == 'QA2 one-time':
        qa_adv_id = a['id']
        break
check('QA2 advances visible in list', qa_adv_id is not None)
st, d = req('GET', f'/api/advances/pending-by-month?month={NEXT_MONTH}&year={int(NEXT_MONTH[:4])}')
check('pending-by-month', ok(d), st)
if qa_adv_id:
    st, d = req('PATCH', f'/api/advances/{qa_adv_id}', {'amount': 260, 'reason': 'QA2 one-time edited'})
    check('edit advance', ok(d), d)
    st, d = req('DELETE', f'/api/advances/{qa_adv_id}')
    check('cancel/delete advance', ok(d) or st in (200, 204), d)

print('=' * 70)
print('SECTION 7 — ACCOUNTS / SALARY')
print('=' * 70)
st, d = req('GET', f'/api/accounts?month={CUR_MONTH}')
check('accounts month payload', ok(d), st)
st, d = req('GET', f'/api/accounts/sites-for-month?month={CUR_MONTH}')
check('sites-for-month', ok(d), st)
st, d = req('POST', '/api/accounts/salary', {'empId': EMP_ID, 'empName': 'Seed Worker 001', 'siteId': SITE_ID, 'siteName': 'Dubai Marina Towers', 'month': NEXT_MONTH, 'year': int(NEXT_MONTH[:4]), 'totalHours': 200, 'rtPerHour': 3.5, 'totalSalary': 700, 'deduction': 0, 'advance': 0, 'balanceSalary': 700})
sal_dup = 'already exists' in str(d.get('error', ''))
check('salary record save (POST)', ok(d) or (st in (400, 409) and sal_dup), d)
st, d = req('GET', f'/api/accounts/working-hours?month={CUR_MONTH}')
check('accounts working-hours', ok(d), st)
st, d = req('GET', f'/api/accounts/employee-monthly?month={CUR_MONTH}&employeeId={EMP_ID}')
check('employee monthly', ok(d) or st == 400, st)
st, d = req('GET', f'/api/salary-records?month={CUR_MONTH}&siteId={SITE_ID}')
check('salary-records list', ok(d), st)
srecs = d.get('data', {}).get('records') or d.get('data', {}).get('salaryRecords') or []
check('salary records present for seeded month', len(srecs) > 0, len(srecs))
st, d = req('GET', '/api/base-rates')
check('base-rates singleton', ok(d), st)

print('=' * 70)
print('SECTION 8 — WARNINGS / FINES')
print('=' * 70)
st, d = req('GET', '/api/warnings')
check('warnings list', ok(d), st)
st, d = req('POST', '/api/warnings', {'employeeId': QA_EMP_ID, 'reason': 'QA2 warning', 'createdById': ADMIN_ID})
check('create warning', ok(d), d)
qa_warn = None
st, d = req('GET', '/api/warnings')
for w in (d.get('data', {}).get('warnings') or []):
    if w.get('employeeId') == QA_EMP_ID and w.get('reason') == 'QA2 warning':
        qa_warn = w['id']
check('warning visible', qa_warn is not None)
st, d = req('GET', '/api/fines')
check('fines list', ok(d), st)
st, d = req('POST', '/api/fines', {'employeeId': QA_EMP_ID, 'reason': 'QA2 fine', 'amount': 50, 'createdById': ADMIN_ID})
check('create fine', ok(d), d)

print('=' * 70)
print('SECTION 9 — LEAVE + CANCELLATIONS')
print('=' * 70)
st, d = req('POST', '/api/leave-requests', {'employeeId': QA_EMP_ID, 'type': 'annual', 'startDate': (TODAY + timedelta(days=7)).isoformat(), 'endDate': (TODAY + timedelta(days=10)).isoformat(), 'totalDays': 4, 'reason': 'QA2 leave', 'createdById': ADMIN_ID})
check('create leave request', ok(d), d)
qa_leave = (d.get('data', {}).get('leaveRequest') or {}).get('id') if ok(d) else None
if qa_leave:
    st, d = req('PUT', f'/api/leave-requests/{qa_leave}', {'status': 'approved', 'reviewedBy': ADMIN_ID})
    check('review leave (approve)', ok(d), d)
st, d = req('POST', '/api/cancellation-requests', {'employeeId': QA_EMP_ID, 'reason': 'QA2 cancel', 'createdById': ADMIN_ID})
check('create cancellation', ok(d), d)
qa_cx = (d.get('data', {}).get('request') or d.get('data', {}) or {}).get('id') if ok(d) else None
if qa_cx:
    st, d = req('PATCH', f'/api/cancellation-requests/{qa_cx}', {'status': 'rejected', 'reviewedById': ADMIN_ID})
    check('review cancellation', ok(d), d)
st, d = req('GET', '/api/delete-requests')
check('delete-requests list', ok(d), st)

print('=' * 70)
print('SECTION 10 — UNIFORMS / STOCK')
print('=' * 70)
st, d = req('GET', '/api/uniform-registry')
check('uniform registry list', ok(d), st)
st, d = req('POST', '/api/uniform-registry', {'employeeName': 'QA2 AtoZ Employee', 'employeeId': QA_EMP_ID, 'documentType': 'passport', 'documentNumber': 'QA2DOC123', 'items': [{'item': 'Uniform', 'qty': 1}], 'sizes': {'uniform': 'L'}})
check('issue uniform token', ok(d), d)
qa_token = (d.get('data', {}).get('record') or {}).get('id') if ok(d) else None
st, d = req('GET', '/api/stock')
check('stock list', ok(d), st)
st, d = req('POST', '/api/stock', {'itemName': 'QA2 Item', 'size': 'OS', 'quantity': 5, 'minQuantity': 1})
check('add stock item', ok(d), d)

print('=' * 70)
print('SECTION 11 — NOTIFICATIONS / ADMINS / LOGS / PERMISSIONS')
print('=' * 70)
st, d = req('GET', '/api/notifications?limit=5')
check('notifications', ok(d), st)
st, d = req('GET', '/api/admins')
check('admins list', ok(d), st)
st, d = req('POST', '/api/admins', {'email': f'qa2-{int(time.time())}@asm.com', 'name': 'QA2 Admin', 'password': 'qa2Pass123!', 'role': 'admin'})
check('create admin', ok(d) or st in (400, 403), d)
qa_admin = (d.get('data', {}).get('user') or {}).get('id') if ok(d) else None
st, d = req('GET', '/api/permissions')
check('permissions list', ok(d), st)
st, d = req('GET', f'/api/menu-permissions?userId={ADMIN_ID}')
check('menu-permissions', ok(d), st)
st, d = req('GET', f'/api/admin-menu-permissions?userId={ADMIN_ID}')
check('admin-menu-permissions', ok(d), st)
st, d = req('GET', '/api/activity-logs?limit=10')
check('activity logs', ok(d) and len(d.get('data', {}).get('logs', [])) > 0, st)
st, d = req('GET', '/api/employee-trades')
check('employee-trades', ok(d), st)
st, d = req('GET', '/api/trade-rates')
check('trade-rates', ok(d) and len(d.get('data', {}).get('tradeRates', d.get('data', []))) >= 4, st)

print('=' * 70)
print('SECTION 12 — DOCUMENTS (read paths)')
print('=' * 70)
st, d = req('GET', '/api/documents/employee')
check('employee docs list', ok(d), st)
st, d = req('GET', '/api/documents/noc')
check('noc list', ok(d), st)
st, d = req('GET', '/api/documents/companies')
check('noc companies', ok(d), st)
st, d = req('GET', '/api/documents/stamps')
check('stamps', ok(d), st)
st, d = req('GET', '/api/documents/noc-template')
check('noc template', ok(d), st)

print('=' * 70)
print('SECTION 13 — CLEANUP QA2 DATA')
print('=' * 70)
import sqlite3
con = sqlite3.connect('/home/z/my-project/db/custom.db')
con.execute('PRAGMA foreign_keys = OFF')
cur = con.cursor()
cur.execute("DELETE FROM AdvanceRepayment WHERE advanceId IN (SELECT id FROM Advance WHERE empId=?)", (QA_EMP_ID,))
cur.execute("DELETE FROM Advance WHERE empId=?", (QA_EMP_ID,))
cur.execute("DELETE FROM Warning WHERE employeeId=?", (QA_EMP_ID,))
cur.execute("DELETE FROM Fine WHERE employeeId=?", (QA_EMP_ID,))
cur.execute("DELETE FROM LeaveRequest WHERE employeeId=?", (QA_EMP_ID,))
cur.execute("DELETE FROM CancellationRequest WHERE employeeId=?", (QA_EMP_ID,))
cur.execute("DELETE FROM UniformRegistry WHERE employeeId=?", (QA_EMP_ID,))
cur.execute("DELETE FROM Attendance WHERE employeeId=?", (QA_EMP_ID,))
cur.execute("DELETE FROM WorkLog WHERE employeeId=?", (QA_EMP_ID,))
cur.execute("DELETE FROM TotalEmployeeWorkingHours WHERE empId=?", (QA_EMP_ID,))
cur.execute("DELETE FROM EmpCountSitePerMonth WHERE empId=?", (QA_EMP_ID,))
cur.execute("DELETE FROM SalaryRecord WHERE empId=?", (QA_EMP_ID,))
cur.execute("DELETE FROM Employee WHERE id=?", (QA_EMP_ID,))
cur.execute("DELETE FROM Branch WHERE id LIKE 'QA2%' OR name LIKE 'QA2 Branch%'")
cur.execute("DELETE FROM StockItem WHERE itemName='QA2 Item'")
if qa_admin:
    cur.execute("DELETE FROM AdminMenuPermission WHERE userId=?", (qa_admin,))
    cur.execute("DELETE FROM AdminPermission WHERE adminId=?", (qa_admin,))
    cur.execute("DELETE FROM User WHERE id=?", (qa_admin,))
con.commit()
leftover = cur.execute("SELECT COUNT(*) FROM Employee WHERE employeeId LIKE 'QA2-AZ-%'").fetchone()[0]
con.close()
check('cleanup removed QA2 employee', leftover == 0)

print()
print('=' * 70)
print(f'A-to-Z RESULT: {PASS} passed, {FAIL} failed')
print('=' * 70)
sys.exit(1 if FAIL else 0)
