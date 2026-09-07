#!/usr/bin/env python3
"""Case-insensitivity regression tests (user report: agent is too case-sensitive).

Covers the server-side matchers a user's arbitrary casing can reach:
  1. /api/attendance/bulk-mark — status "PRESENT" (was: 400 Invalid status),
     siteName "RIYADH TOWER SITE" (was: exact-match miss → could 404 or fall
     through), siteName "riyadh" lowercase substring.
  2. Chat SQL path — ALL-CAPS data question must still find rows (planner
     CASE-INSENSITIVE rule + deterministic case-relax LIKE retry).
"""
import json
import urllib.request

BASE = 'http://localhost:3000'
COOKIES = []


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if COOKIES:
        req.add_header('Cookie', '; '.join(COOKIES))
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data, timeout=180) as res:
        set_cookie = res.headers.get('Set-Cookie')
        if set_cookie:
            COOKIES.append(set_cookie.split(';')[0])
        return res.status, json.loads(res.read().decode())


def check(name, ok, detail=''):
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f' — {detail}' if detail else ''))
    return ok


results = []

# ── login
status, data = call('POST', '/api/auth/login', {'email': 'admin@asm.com', 'password': 'admin123'})
results.append(check('login', status == 200 and data.get('success')))

# ── 1) bulk-mark: status + siteName in FULL CAPS (previously strict)
status, data = call('POST', '/api/attendance/bulk-mark', {
    'date': '2026-09-07',
    'status': 'PRESENT',
    'siteName': 'RIYADH TOWER SITE',
})
ok = status == 200 and data.get('success')
detail = ''
if ok:
    d = data['data']
    detail = f"updated={d.get('updated')} skipped={d.get('skipped')} sites={d.get('sites')}"
    # restricted to Riyadh only: sites list must be exactly Riyadh Tower Site
    ok = d.get('sites') == ['Riyadh Tower Site']
    if not ok:
        detail += '  <-- site restriction WRONG'
results.append(check('bulk-mark status="PRESENT" siteName="RIYADH TOWER SITE"', ok, detail))

# ── 2) bulk-mark: lowercase substring site name
status, data = call('POST', '/api/attendance/bulk-mark', {
    'date': '2026-09-07',
    'status': 'present',
    'siteName': 'riyadh',
})
ok = status == 200 and data.get('success') and data.get('data', {}).get('sites') == ['Riyadh Tower Site']
results.append(check('bulk-mark siteName="riyadh" (substring, lowercase)', ok,
                     f"sites={data.get('data', {}).get('sites')}" if status == 200 else str(data)))

# ── 3) Chat SQL path is covered by the browser E2E (needs real user/session ids).

print()
print(f"{sum(results)}/{len(results)} PASS")
raise SystemExit(0 if all(results) else 1)
