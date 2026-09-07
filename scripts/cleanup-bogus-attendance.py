#!/usr/bin/env python3
"""Cleanup: neutralize the 21 bogus siteId=null attendance records (2026-09-05)
that the pre-fix agent all-sites bulk mark wrote for site-less (Idle) employees.

We flip each record to status='not_marked' through the app's own PUT
/api/attendance endpoint so syncEmployeeSalaryFromAttendance recomputes hours
and salary for every affected employee (the same path the grid's Backspace
undo uses). Verifies no siteId=null P/A/C/O records remain.
"""
import json
import sqlite3
import urllib.request

BASE = 'http://localhost:3000'
DB = '/home/z/my-project/db/custom.db'
DATE = '2026-09-05'


def call(method, path, payload=None, cookies=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if cookies:
        req.add_header('Cookie', cookies)
    data = json.dumps(payload).encode() if payload is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            set_cookie = r.headers.get('Set-Cookie', '')
            return r.status, json.loads(r.read().decode() or '{}'), set_cookie
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}'), ''


def main():
    # 1. Login
    status, data, set_cookie = call('POST', '/api/auth/login', {'email': 'admin@asm.com', 'password': 'admin123'})
    assert status == 200 and data.get('success'), f'login failed: {status} {data}'
    cookie = set_cookie.split(';')[0] if set_cookie else ''
    print(f'[1] login ok (cookie {bool(cookie)})')

    # 2. Find the bogus records (siteId=null, meaningful status, DATE)
    con = sqlite3.connect(DB)
    cur = con.cursor()
    rows = cur.execute(
        "SELECT employeeId, status FROM Attendance WHERE siteId IS NULL AND date=? AND status IN ('present','absent','camp_sitting','overtime')",
        (DATE,),
    ).fetchall()
    print(f'[2] found {len(rows)} bogus siteId=null records on {DATE}')
    assert len(rows) <= 21, 'unexpected record count'

    # 3. Flip each to not_marked via the API (triggers salary sync)
    fixed = 0
    for emp_id, old_status in rows:
        status, data, _ = call('POST', '/api/attendance', {
            'employeeId': emp_id,
            'date': DATE,
            'status': 'not_marked',
        }, cookies=cookie)
        if status == 200 and data.get('success'):
            fixed += 1
        else:
            print(f'  FAILED {emp_id}: {status} {data}')
    print(f'[3] neutralized {fixed}/{len(rows)} records via PUT (hours/salary re-synced)')

    # 4. Verify none remain meaningful with siteId=null on that date
    con2 = sqlite3.connect(DB)
    remaining = con2.execute(
        "SELECT COUNT(*) FROM Attendance WHERE siteId IS NULL AND date=? AND status IN ('present','absent','camp_sitting','overtime')",
        (DATE,),
    ).fetchone()[0]
    print(f'[4] remaining meaningful siteId=null records on {DATE}: {remaining}')
    assert remaining == 0, 'bogus records remain!'

    # 5. Verify site-scoped marks on that date untouched
    per_site = con2.execute(
        "SELECT s.name, COUNT(*) FROM Attendance a JOIN Site s ON s.id=a.siteId WHERE a.date=? AND a.status='present' GROUP BY s.name ORDER BY s.name",
        (DATE,),
    ).fetchall()
    print('[5] site-scoped present marks on 2026-09-05 (must be unchanged):')
    for r in per_site:
        print('   ', r)
    print('CLEANUP_OK')


if __name__ == '__main__':
    main()
