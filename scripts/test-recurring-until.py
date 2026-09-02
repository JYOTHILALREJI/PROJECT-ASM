#!/usr/bin/env python3
"""
Comprehensive tests for the recurring-advance "deduct until month/year" feature
and the advance add flow (readonly-db regression).

Phases:
  A. POST /api/advances validation (bulk mode, as used by the Advance page)
  B. PATCH /api/advances/[id] recurringUntil updates
  C. Eligibility + cutoff via the real consumer /api/accounts (read-only):
     uses months where John Doe HAS salary records (Feb-Jun/Aug/Sep 2026),
     so the display path exercises the exact deduction logic.
       U: recurring eff=2026-02 monthly=13.13 until=2026-04 (inclusive end)
       N: recurring eff=2026-02 monthly=13.14 no end (legacy)
       O: one_time  eff=2026-05 amount=77.77
       S: recurring eff=2026-09 monthly=50.51 until=2026-11 (start-month + window)
  D. GET /api/advances/pending-by-month recurringAdvances section
  E. GETs must be side-effect free (no repayments recorded)
  F. Cleanup: hard-delete every created row

Usage: python3 scripts/test-recurring-until.py   (server must be on :3000)
"""
import json
import sqlite3
import urllib.request
import urllib.error

BASE = 'http://localhost:3000'
DB = '/home/z/my-project/db/custom.db'
JOHN = 'cmrfz98910003pfuguu5dpx33'  # John Doe

passed, failed = [], []


def check(name, cond, detail=''):
    (passed if cond else failed).append(name)
    print(f'  {"PASS" if cond else "FAIL"}  {name}' + ('' if cond else f'  {detail}'))


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def db_q(sql, args=()):
    con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    try:
        return con.execute(sql, args).fetchall()
    finally:
        con.close()


def hard_delete(ids):
    if not ids:
        return
    con = sqlite3.connect(DB)
    con.executemany('DELETE FROM Advance WHERE id=?', [(i,) for i in ids])
    con.commit()
    con.close()


def john_advance(month, year):
    """Sum of John's merged `advance` values for a month from /api/accounts."""
    status, res = api('GET', f'/api/accounts?month={month}&year={year}')
    assert status == 200, f'/api/accounts {month} -> {status}: {str(res)[:200]}'
    found = []

    def scan(node):
        if isinstance(node, dict):
            if node.get('empId') == JOHN and isinstance(node.get('advance'), (int, float)):
                found.append(float(node['advance']))
            for v in node.values():
                scan(v)
        elif isinstance(node, list):
            for v in node:
                scan(v)
    scan(res)
    return round(sum(found), 2)


def approx(a, b, tol=0.011):
    return abs(a - b) < tol


created_ids = []

print('=== A. POST /api/advances validation ===')
st, res = api('POST', '/api/advances', {'advances': [{
    'empId': JOHN, 'amount': 100, 'effectiveMonth': '2026-09', 'effectiveYear': 2026,
    'deductionType': 'recurring', 'monthlyDeductionAmount': 10,
    'recurringUntil': '2026-08'}]})
check('A1 until < effective rejected (400)', st == 400 and not res.get('success'), f'{st} {str(res)[:120]}')

st, res = api('POST', '/api/advances', {'advances': [{
    'empId': JOHN, 'amount': 100, 'effectiveMonth': '2026-09', 'effectiveYear': 2026,
    'deductionType': 'recurring', 'monthlyDeductionAmount': 10,
    'recurringUntil': '2026/12'}]})
check('A2 invalid until format rejected (400)', st == 400 and not res.get('success'), f'{st} {str(res)[:120]}')

st, res = api('POST', '/api/advances', {'advances': [{
    'empId': JOHN, 'amount': 100, 'effectiveMonth': '09-2026', 'effectiveYear': 2026}]})
check('A3 invalid effectiveMonth rejected (400)', st == 400 and not res.get('success'), f'{st} {str(res)[:120]}')

st, res = api('POST', '/api/advances', {'advances': [{
    'empId': JOHN, 'amount': 33.33, 'effectiveMonth': '2026-09', 'effectiveYear': 2026,
    'deductionType': 'one_time', 'recurringUntil': '2026-12'}]})
check('A4 one_time + until accepted', st == 200 and res.get('success'), f'{st} {str(res)[:120]}')
if st == 200:
    aid = res['data']['created'][0]['id']
    created_ids.append(aid)
    row = db_q('SELECT recurringUntil, deductionType FROM Advance WHERE id=?', (aid,))[0]
    check('A4b one_time until ignored (NULL)', row['recurringUntil'] is None and row['deductionType'] == 'one_time',
          f'{dict(row)}')

st, res = api('POST', '/api/advances', {'advances': [{
    'empId': JOHN, 'amount': 40, 'effectiveMonth': '2026-09', 'effectiveYear': 2026,
    'deductionType': 'recurring', 'monthlyDeductionAmount': 40,
    'recurringUntil': '2026-09'}]})
check('A5 until == effective accepted (single month)', st == 200 and res.get('success'), f'{st} {str(res)[:120]}')
if st == 200:
    aid = res['data']['created'][0]['id']
    created_ids.append(aid)
    row = db_q('SELECT recurringUntil, status FROM Advance WHERE id=?', (aid,))[0]
    check('A5b until stored, status active', row['recurringUntil'] == '2026-09' and row['status'] == 'active',
          f'{dict(row)}')

st, res = api('POST', '/api/advances', {'advances': [
    {'empId': JOHN, 'amount': 500, 'effectiveMonth': '2026-09', 'effectiveYear': 2026,
     'deductionType': 'recurring', 'monthlyDeductionAmount': 50.51, 'recurringUntil': '2026-11'},
]})
check('A6 recurring with until accepted', st == 200 and res.get('success'), f'{st} {str(res)[:120]}')
until_id = None
if st == 200:
    aid = res['data']['created'][0]['id']
    created_ids.append(aid)
    until_id = aid
    row = db_q('SELECT recurringUntil FROM Advance WHERE id=?', (aid,))[0]
    check('A6b until stored 2026-11', row['recurringUntil'] == '2026-11', f'{dict(row)}')

print('=== B. PATCH /api/advances/[id] recurringUntil ===')
if until_id:
    st, res = api('PATCH', f'/api/advances/{until_id}', {'recurringUntil': '2027-01'})
    row = db_q('SELECT recurringUntil FROM Advance WHERE id=?', (until_id,))[0]
    check('B1 PATCH until -> 2027-01', st == 200 and row['recurringUntil'] == '2027-01', f'{st} {dict(row)}')

    st, res = api('PATCH', f'/api/advances/{until_id}', {'recurringUntil': '2026-08'})
    row = db_q('SELECT recurringUntil FROM Advance WHERE id=?', (until_id,))[0]
    check('B2 PATCH until < effective rejected, value kept', st == 400 and row['recurringUntil'] == '2027-01',
          f'{st} {dict(row)}')

    st, res = api('PATCH', f'/api/advances/{until_id}', {'recurringUntil': 'Jan2027'})
    check('B3 PATCH invalid format rejected (400)', st == 400, f'{st}')

    st, res = api('PATCH', f'/api/advances/{until_id}', {'recurringUntil': None})
    row = db_q('SELECT recurringUntil FROM Advance WHERE id=?', (until_id,))[0]
    check('B4 PATCH null clears until', st == 200 and row['recurringUntil'] is None, f'{st} {dict(row)}')

    st, res = api('PATCH', f'/api/advances/{until_id}', {'recurringUntil': '2026-11'})
    check('B5 PATCH restore 2026-11', st == 200, f'{st}')
else:
    check('B* skipped (no until advance)', False)

# --- Clean up Phase A/B rows so Phase C starts from a deterministic state ---
hard_delete(created_ids)
n = db_q('SELECT COUNT(*) c FROM Advance')[0]['c']
check('A/B cleanup: Advance table empty', n == 0, f'{n} rows left')
created_ids = []

print('=== C. Eligibility + cutoff via /api/accounts (display = deduction logic) ===')
st, res = api('POST', '/api/advances', {'advances': [
    {'empId': JOHN, 'empName': 'John Doe', 'amount': 500, 'effectiveMonth': '2026-02',
     'effectiveYear': 2026, 'deductionType': 'recurring', 'monthlyDeductionAmount': 13.13,
     'recurringUntil': '2026-04'},
    {'empId': JOHN, 'empName': 'John Doe', 'amount': 500, 'effectiveMonth': '2026-02',
     'effectiveYear': 2026, 'deductionType': 'recurring', 'monthlyDeductionAmount': 13.14},
    {'empId': JOHN, 'empName': 'John Doe', 'amount': 77.77, 'effectiveMonth': '2026-05',
     'effectiveYear': 2026, 'deductionType': 'one_time'},
    {'empId': JOHN, 'empName': 'John Doe', 'amount': 500, 'effectiveMonth': '2026-09',
     'effectiveYear': 2026, 'deductionType': 'recurring', 'monthlyDeductionAmount': 50.51,
     'recurringUntil': '2026-11'},
]})
check('C0 phase advances created', st == 200 and res.get('success') and res['data']['count'] == 4,
      f'{st} {str(res)[:150]}')
if st == 200:
    created_ids += [a['id'] for a in res['data']['created']]

# Cutoff window: 13.13 runs Feb..Apr INCLUSIVE, then stops.
check('C1 Feb = 13.13 + 13.14', approx(john_advance('2026-02', 2026), 26.27), f'got {john_advance("2026-02", 2026)}')
check('C2 Mar = 13.13 + 13.14', approx(john_advance('2026-03', 2026), 26.27), f'got {john_advance("2026-03", 2026)}')
check('C3 Apr (until month, inclusive) = 13.13 + 13.14', approx(john_advance('2026-04', 2026), 26.27),
      f'got {john_advance("2026-04", 2026)}')
check('C4 May: 13.13 STOPPED, 13.14 + one-time 77.77', approx(john_advance('2026-05', 2026), 90.91),
      f'got {john_advance("2026-05", 2026)}')
check('C5 Jun: only 13.14 continues', approx(john_advance('2026-06', 2026), 13.14),
      f'got {john_advance("2026-06", 2026)}')
check('C6 Aug: only 13.14 continues', approx(john_advance('2026-08', 2026), 13.14),
      f'got {john_advance("2026-08", 2026)}')
check('C7 Sep: 13.14 + 50.51 (new advance start month)', approx(john_advance('2026-09', 2026), 63.65),
      f'got {john_advance("2026-09", 2026)}')
check('C8 Oct: no salary records -> nothing displayed', john_advance('2026-10', 2026) == 0,
      f'got {john_advance("2026-10", 2026)}')
check('C9 Dec: nothing displayed (records only months show)', john_advance('2026-12', 2026) == 0,
      f'got {john_advance("2026-12", 2026)}')

print('=== D. pending-by-month recurringAdvances section ===')
st, res = api('GET', '/api/advances/pending-by-month?month=2026-09&year=2026')
rec_sep = res.get('data', {}).get('recurringAdvances', [])
check('D1 Sep: 1 active recurring listed (the 50.51 one)',
      st == 200 and len(rec_sep) == 1 and rec_sep[0].get('recurringUntil') == '2026-11',
      f"{st} n={len(rec_sep)} {str(rec_sep)[:150]}")
check('D2 Sep: pending (one-time) list empty, totalPending 0',
      len(res.get('data', {}).get('advances', [])) == 0 and res.get('data', {}).get('totalPending') == 0,
      f"{str(res.get('data', {}))[:150]}")

st, res = api('GET', '/api/advances/pending-by-month?month=2026-02&year=2026')
rec_feb = res.get('data', {}).get('recurringAdvances', [])
check('D3 Feb: 2 active recurring listed (with + without end)',
      st == 200 and len(rec_feb) == 2 and all('recurringUntil' in a for a in rec_feb),
      f"{st} n={len(rec_feb)}")

print('=== E. GETs must be side-effect free ===')
n_rep = db_q('SELECT COUNT(*) c FROM AdvanceRepayment')[0]['c']
check('E1 zero AdvanceRepayment rows after all GETs', n_rep == 0, f'{n_rep}')
bal = db_q('SELECT remainingBalance FROM Advance WHERE id=?', (created_ids[0],))[0]['remainingBalance'] if created_ids else None
check('E2 remainingBalance untouched by GETs (500)', bal is not None and abs(bal - 500.0) < 0.001, f'{bal}')

print('=== F. Cleanup ===')
hard_delete(created_ids)
n = db_q('SELECT COUNT(*) c FROM Advance')[0]['c']
check('F1 all test advances removed', n == 0, f'{n} rows left')

print(f'\n========== RESULT: {len(passed)} passed, {len(failed)} failed ==========')
if failed:
    print('FAILED:', failed)
    raise SystemExit(1)
print('ALL TESTS PASSED ✅')
