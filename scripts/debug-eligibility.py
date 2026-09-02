#!/usr/bin/env python3
"""Debug why getEligibleRecurringAdvances merge doesn't show in /api/accounts."""
import json
import sqlite3
import urllib.request

BASE = 'http://localhost:3000'
DB = '/home/z/my-project/db/custom.db'
JOHN = 'cmrfz98910003pfuguu5dpx33'


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read().decode())


# 1. Create the two recurring advances (bulk, as the UI does)
res = api('POST', '/api/advances', {'advances': [
    {'empId': JOHN, 'empName': 'John Doe', 'amount': 500, 'effectiveMonth': '2026-09',
     'effectiveYear': 2026, 'deductionType': 'recurring', 'monthlyDeductionAmount': 50.51,
     'recurringUntil': '2026-11'},
    {'empId': JOHN, 'empName': 'John Doe', 'amount': 500, 'effectiveMonth': '2026-09',
     'effectiveYear': 2026, 'deductionType': 'recurring', 'monthlyDeductionAmount': 50.52},
]})
print('create:', res.get('success'))
ids = [a['id'] for a in res['data']['created']]

# 2. Replicate the getEligibleRecurringAdvances WHERE clause in SQLite
con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
con.row_factory = sqlite3.Row
rows = con.execute("""
    SELECT id, empId, deductionType, status, deletedAt, effectiveMonth,
           monthlyDeductionAmount, remainingBalance, recurringUntil
    FROM Advance
    WHERE empId = ? AND deductionType='recurring' AND status='active'
      AND deletedAt IS NULL AND effectiveMonth <= '2026-09'
""", (JOHN,)).fetchall()
print(f'\nDB query (replicated WHERE): {len(rows)} rows')
for r in rows:
    print('  ', dict(r))
con.close()

# 3. Call /api/accounts for Sep and dump John-related entries
res = api('GET', '/api/accounts?month=2026-09&year=2026')


def scan(node, path=''):
    if isinstance(node, dict):
        if node.get('empId') == JOHN or node.get('empName') == 'John Doe':
            keys = {k: node[k] for k in ('empId', 'advance', 'balanceSalary') if k in node}
            sr = node.get('salaryRecord')
            if sr is not None and isinstance(sr, dict) and 'advance' in sr:
                keys['sr.advance'] = sr['advance']
                keys['site'] = sr.get('siteName')
            if keys:
                print('  John entry @', path, '->', keys)
        for k, v in node.items():
            scan(v, f'{path}.{k}')
    elif isinstance(node, list):
        for i, v in enumerate(node):
            scan(v, f'{path}[{i}]')


print('\n/api/accounts 2026-09 John entries:')
scan(res)

# 4. Same for December (no salary records month)
res = api('GET', '/api/accounts?month=2026-12&year=2026')
print('\n/api/accounts 2026-12 John entries:')
scan(res)

# 5. Cleanup
con = sqlite3.connect(DB)
con.execute('DELETE FROM Advance WHERE empId=? AND amount=500.0', (JOHN,))
con.commit()
con.close()
print('\ncleaned up', len(ids), 'rows; remaining:',
      sqlite3.connect(DB).execute('SELECT COUNT(*) FROM Advance').fetchone()[0])
