#!/usr/bin/env python3
"""Task 23 tests — bulk attendance marking must NEVER touch moved-out / site-less employees.

Covers:
  A. Global (all-sites) mark = agent path: total must equal the site-assigned
     workforce (181), site-less (Idle) employees reported as excludedNoSite=21,
     and NO siteId=null records written.
  B. Server-side site guard: bulk-mark with siteId + employeeIds containing a
     moved-out employee must silently drop the moved employee (only current
     members of that site get marked).
  C. Cleanup of every test date afterwards (flip to not_marked via the grid's
     own POST endpoint so salary/hour syncs recompute).
Run against a live dev server. Auth: admin@asm.com / admin123.
"""
import json
import sqlite3
import urllib.request

BASE = 'http://localhost:3000'
DB = '/home/z/my-project/db/custom.db'
COOKIE = ''
RESULTS = []


def call(method, path, payload=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if COOKIE:
        req.add_header('Cookie', COOKIE)
    data = json.dumps(payload).encode() if payload is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or '{}')
        except Exception:
            return e.code, {}


def check(name, cond, detail=''):
    RESULTS.append((name, bool(cond), detail))
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{f' — {detail}' if detail else ''}")


def db_q(sql, args=()):
    con = sqlite3.connect(DB)
    try:
        return con.execute(sql, args).fetchall()
    finally:
        con.close()


def neutralize_date(date):
    """Flip every meaningful attendance record on `date` back to not_marked via the API."""
    rows = db_q(
        "SELECT employeeId FROM Attendance WHERE date=? AND status IN ('present','absent','camp_sitting','overtime')",
        (date,),
    )
    fixed = 0
    for (emp,) in rows:
        status, data = call('POST', '/api/attendance', {'employeeId': emp, 'date': date, 'status': 'not_marked'})
        if status == 200 and data.get('success'):
            fixed += 1
    remaining = db_q(
        "SELECT COUNT(*) FROM Attendance WHERE date=? AND status IN ('present','absent','camp_sitting','overtime')",
        (date,),
    )[0][0]
    return fixed, len(rows), remaining


def main():
    global COOKIE
    status, data = call('POST', '/api/auth/login', {'email': 'admin@asm.com', 'password': 'admin123'})
    assert status == 200 and data.get('success'), f'login failed: {status}'
    print('[0] logged in as super admin')

    # Data expectations
    active_total = db_q("SELECT COUNT(*) FROM Employee WHERE status='active'")[0][0]
    siteless = db_q("SELECT COUNT(*) FROM Employee WHERE status='active' AND currentSiteId IS NULL AND currentSite IS NULL")[0][0]
    site_assigned = active_total - siteless
    print(f'[data] active={active_total}, site-assigned={site_assigned}, site-less={siteless}')

    # ── Part A: global all-sites mark (the agent's attendance_mark path) ──
    print('[A] global bulk mark on 2026-09-30 (fresh date)')
    status, data = call('POST', '/api/attendance/bulk-mark', {'date': '2026-09-30', 'status': 'present'})
    check('A1 global mark succeeds', status == 200 and data.get('success'), str(data.get('error', '')))
    d = data.get('data', {})
    check('A2 total == site-assigned workforce (181)', d.get('total') == site_assigned, f"total={d.get('total')}")
    check('A3 site-less employees excluded (21)', d.get('excludedNoSite') == siteless, f"excludedNoSite={d.get('excludedNoSite')}")
    check('A4 updated == 181', d.get('updated') == site_assigned, f"updated={d.get('updated')}")
    null_marks = db_q("SELECT COUNT(*) FROM Attendance WHERE date='2026-09-30' AND siteId IS NULL AND status IN ('present','absent','camp_sitting','overtime')")[0][0]
    check('A5 zero siteId=null records written', null_marks == 0, f'count={null_marks}')
    per_site = dict(db_q("SELECT s.name, COUNT(*) FROM Attendance a JOIN Site s ON s.id=a.siteId WHERE a.date='2026-09-30' AND a.status='present' GROUP BY s.name"))
    riyadh = per_site.get('Riyadh Tower Site', 0)
    check('A6 Riyadh got exactly its 27 current employees', riyadh == 27, f'riyadh={riyadh}')
    john = db_q("SELECT COUNT(*) FROM Attendance a WHERE a.date='2026-09-30' AND a.status='present' AND a.employeeId=(SELECT id FROM Employee WHERE fullName='John Doe')")[0][0]
    john_site = db_q("SELECT s.name FROM Attendance a LEFT JOIN Site s ON s.id=a.siteId WHERE a.date='2026-09-30' AND a.employeeId=(SELECT id FROM Employee WHERE fullName='John Doe')")[0][0]
    check('A7 John Doe marked ONCE at his CURRENT site only', john == 1 and john_site == 'Jeddah Mall Project', f'marks={john}, site={john_site}')

    # ── Part B: server-side site guard with a moved-out employee id ──
    print('[B] site-scoped mark with employeeIds containing moved-out John Doe on 2026-09-29')
    riyadh_id = db_q("SELECT id FROM Site WHERE name='Riyadh Tower Site'")[0][0]
    john_id = db_q("SELECT id FROM Employee WHERE fullName='John Doe'")[0][0]
    riyadh_emp = db_q("SELECT id FROM Employee WHERE currentSiteId=? AND status='active' LIMIT 1", (riyadh_id,))[0][0]
    status, data = call('POST', '/api/attendance/bulk-mark', {
        'date': '2026-09-29', 'status': 'present', 'siteId': riyadh_id, 'employeeIds': [john_id, riyadh_emp],
    })
    check('B1 site-scoped mark succeeds', status == 200 and data.get('success'), str(data.get('error', '')))
    d = data.get('data', {})
    check('B2 moved-out employee dropped server-side (total=1)', d.get('total') == 1, f"total={d.get('total')}")
    john_marked = db_q("SELECT COUNT(*) FROM Attendance WHERE date='2026-09-29' AND employeeId=? AND status IN ('present','absent')", (john_id,))[0][0]
    check('B3 John has NO record for 2026-09-29', john_marked == 0, f'john records={john_marked}')
    emp_marked = db_q("SELECT siteId FROM Attendance WHERE date='2026-09-29' AND employeeId=? AND status='present'", (riyadh_emp,))[0]
    check('B4 current employee marked and tagged to Riyadh', emp_marked and emp_marked[0] == riyadh_id, f'siteId={emp_marked}')

    # ── Part B2: moved-out-only employeeIds list → clean 404, never a mark ──
    status, data = call('POST', '/api/attendance/bulk-mark', {
        'date': '2026-09-28', 'status': 'present', 'siteId': riyadh_id, 'employeeIds': [john_id],
    })
    check('B5 moved-out-only list rejected (404 No employees found)', status == 404, f'status={status}')
    john_marked = db_q("SELECT COUNT(*) FROM Attendance WHERE date='2026-09-28' AND employeeId=?", (john_id,))[0][0]
    check('B6 John still has no 2026-09-28 record', john_marked == 0, f'john records={john_marked}')

    # ── Part C: cleanup all test dates ──
    print('[C] cleanup test dates')
    for date in ('2026-09-30', '2026-09-29', '2026-09-28'):
        fixed, found, remaining = neutralize_date(date)
        check(f'C {date}: neutralized {fixed}/{found}, remaining meaningful={remaining}', remaining == 0)

    # Final: no siteId=null meaningful records anywhere in September
    nulls = db_q("SELECT COUNT(*) FROM Attendance WHERE siteId IS NULL AND date LIKE '2026-09%' AND status IN ('present','absent','camp_sitting','overtime')")[0][0]
    check('C-final zero siteId=null meaningful records in Sept', nulls == 0, f'count={nulls}')

    failed = [r for r in RESULTS if not r[1]]
    print(f"\n=== {len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed ===")
    if failed:
        for name, _, detail in failed:
            print(f"FAILED: {name} {detail}")
        raise SystemExit(1)


if __name__ == '__main__':
    main()
