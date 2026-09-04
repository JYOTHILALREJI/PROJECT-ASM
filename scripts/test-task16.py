#!/usr/bin/env python3
"""
Task 16 API test suite — notifications (mark as read / actor), fines currency,
global settings API with super-admin gate.
Run against a live dev server on :3000.
"""
import json
import time
import urllib.request
import urllib.error

BASE = 'http://localhost:3000'
PASS = 0
FAIL = 0
FAILURES = []

def req(method, path, body=None, expect=200, label=''):
    global PASS, FAIL
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={'Content-Type': 'application/json'} if data else {})
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            status = resp.status
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        status = e.code
        try:
            payload = json.loads(e.read().decode())
        except Exception:
            payload = {}
    ok = status in expect if isinstance(expect, tuple) else status == expect
    if ok:
        PASS += 1
        print(f"  PASS  {label or path} [{status}]")
    else:
        FAIL += 1
        FAILURES.append(label or path)
        print(f"  FAIL  {label or path} — expected {expect}, got {status}: {str(payload)[:200]}")
    return payload

def check(cond, label, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        FAILURES.append(label)
        print(f"  FAIL  {label} {extra}")

# ── Identify users ──────────────────────────────────────────────────────────
import sqlite3
con = sqlite3.connect('file:/home/z/my-project/db/custom.db?mode=ro', uri=True)
cur = con.cursor()
cur.execute("SELECT id FROM User WHERE email='admin@asm.com' AND role='super_admin' LIMIT 1")
SUPER = cur.fetchone()[0]
con.close()

# Fresh QA admin for the 403 path — signup is disabled once a super admin
# exists, so insert the row directly (role='admin' is all the gate needs).
import sqlite3 as _sq
STAMP = str(int(time.time()))
con = _sq.connect('/home/z/my-project/db/custom.db')
c = con.cursor()
c.execute("INSERT INTO User (id, email, name, password, role, theme, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)",
          (f'qa16admin_{STAMP}', f'qa16-{STAMP}@asm.com', f'QA16 Admin {STAMP}', 'qa16-not-a-login', 'admin', 'dark', int(time.time()*1000), int(time.time()*1000)))
con.commit(); con.close()
ADMIN = f'qa16admin_{STAMP}'
check(bool(ADMIN), 'QA admin has id', extra=ADMIN)

# QA employee for warning/fine creation
created_emp = req('POST', '/api/employees',
                  {'fullName': f'QA16 Emp {STAMP}', 'employeeId': f'QA16-{STAMP}',
                   'trade': 'Technician', 'status': 'active'},
                  expect=(200, 201), label='create QA employee')
d = created_emp.get('data', {})
EMP = (d.get('employee') or d.get('employees') or d if isinstance(d, dict) else {}).get('id') \
    if isinstance(d, dict) else None
if not EMP and isinstance(d, list) and d:
    EMP = d[0].get('id')
check(bool(EMP), 'QA employee has id', extra=str(created_emp)[:150])

# ── 1. Settings API ─────────────────────────────────────────────────────────
print('\n── Settings API ──')
r = req('GET', '/api/settings', label='GET settings (defaults)')
s = r.get('data', {}).get('settings', {})
check(s.get('currency') == 'AED', 'default currency is AED (dirhams)', extra=str(s))
check('companyName' in s, 'companyName present')

r = req('PUT', '/api/settings', {'settings': {'currency': 'USD'}},
        expect=400, label='PUT without userId → 400')
r = req('PUT', '/api/settings', {'userId': ADMIN, 'settings': {'currency': 'USD'}},
        expect=403, label='PUT as plain admin → 403 (super admin gate)')
r = req('PUT', '/api/settings', {'userId': SUPER, 'settings': {'currency': 'XXY'}},
        expect=400, label='PUT invalid currency → 400')
r = req('PUT', '/api/settings', {'userId': SUPER, 'settings': {'companyName': ''}},
        expect=400, label='PUT empty companyName → 400')
r = req('PUT', '/api/settings', {'userId': SUPER, 'settings': {'hackerKey': 'x'}},
        expect=400, label='PUT unknown key → 400 (whitelist)')

r = req('PUT', '/api/settings', {'userId': SUPER, 'settings': {'currency': 'AED', 'companyName': f'QA Corp {STAMP}'}},
        label='PUT valid settings as super admin → 200')
check(r.get('data', {}).get('settings', {}).get('currency') == 'AED', 'settings persisted (currency)')
r = req('GET', '/api/settings', label='GET reflects saved settings')
check(r.get('data', {}).get('settings', {}).get('companyName') == f'QA Corp {STAMP}',
      'companyName persisted & returned')

# ── 2. Warnings/Fines actor + currency in notification message ──────────────
print('\n── Warnings / Fines: actor + currency ──')
r = req('POST', '/api/warnings',
        {'employeeId': EMP, 'reason': 'QA16 warning reason', 'createdById': SUPER},
        expect=201, label='POST warning')
r = req('POST', '/api/fines',
        {'employeeId': EMP, 'reason': 'QA16 fine reason', 'amount': 500, 'createdById': SUPER},
        expect=201, label='POST fine (500)')

r = req('GET', '/api/notifications?type=fine&limit=5', label='GET fine notifications')
notifs = r.get('data', {}).get('notifications', [])
fine_n = next((n for n in notifs if 'QA16 Emp' in n.get('message', '') and n.get('type') == 'fine'), None)
check(fine_n is not None, 'fine notification created')
if fine_n:
    check('500 AED' in fine_n['message'], 'fine message uses AED (dirhams), not SAR/$',
          extra=fine_n['message'][:120])
    actor = fine_n.get('actor')
    check(bool(actor) and actor.get('name') == 'Admin User', 'fine notification actor = correct creator name',
          extra=str(actor))

r = req('GET', '/api/notifications?type=warning&limit=5', label='GET warning notifications')
warn_n = next((n for n in r.get('data', {}).get('notifications', [])
               if 'QA16 warning reason' in n.get('message', '')), None)
check(warn_n is not None, 'warning notification created')
if warn_n:
    actor = warn_n.get('actor')
    check(bool(actor) and actor.get('name') == 'Admin User', 'warning notification actor = correct creator name',
          extra=str(actor))

# ── 3. Per-item mark as read ────────────────────────────────────────────────
print('\n── Mark as read (single item) ──')
r = req('GET', '/api/notifications?limit=100', label='GET notifications (feed)')
notifs = r.get('data', {}).get('notifications', [])
check(all('actor' in n for n in notifs), 'feed includes actor field on every item')
unread_before = r.get('data', {}).get('unreadCount', 0)
check(unread_before > 0, f'unreadCount > 0 before ({unread_before})')

target = fine_n or (notifs[0] if notifs else None)
if target and not target.get('read'):
    r = req('PUT', '/api/notifications', {'id': target['id']}, label=f'PUT mark single {target["id"][:8]} as read')
    r = req('GET', '/api/notifications?limit=100', label='GET after single mark')
    after = {n['id']: n for n in r.get('data', {}).get('notifications', [])}
    check(after.get(target['id'], {}).get('read') is True, 'target item now read=true')
    others_unread = [n for n in after.values() if not n['read']]
    check(len(others_unread) == unread_before - 1, 'only the ONE item was marked (others untouched)',
          extra=f'{len(others_unread)} vs {unread_before - 1}')
    check(r.get('data', {}).get('unreadCount') == unread_before - 1, 'unreadCount decremented by exactly 1')

# Idempotency: marking an already-read item again should not error
if target:
    req('PUT', '/api/notifications', {'id': target['id']}, label='PUT mark again (idempotent)')

# ── 4. Mark all read ────────────────────────────────────────────────────────
print('\n── Mark all read ──')
r = req('PUT', '/api/notifications', {'markAll': True}, label='PUT markAll')
check(r.get('data', {}).get('updated', 0) >= 0, 'markAll returns count')
r = req('GET', '/api/notifications?limit=5', label='GET after markAll')
check(r.get('data', {}).get('unreadCount') == 0, 'unreadCount == 0 after markAll')

# ── 5. Cleanup ──────────────────────────────────────────────────────────────
print('\n── Cleanup ──')
con = sqlite3.connect('/home/z/my-project/db/custom.db')
c = con.cursor()
# remove QA notifications
c.execute("DELETE FROM Notification WHERE message LIKE '%QA16 Emp%' OR message LIKE '%QA16 warning%' OR message LIKE '%QA16 fine%'")
print('  deleted QA notifications:', c.rowcount)
# remove QA warning/fine rows + employee
c.execute("DELETE FROM Warning WHERE reason LIKE '%QA16 warning reason%'")
c.execute("DELETE FROM Fine WHERE reason LIKE '%QA16 fine reason%'")
if EMP:
    c.execute("DELETE FROM Employee WHERE id=?", (EMP,))
if ADMIN:
    c.execute("DELETE FROM AdminPermission WHERE adminId=?", (ADMIN,))
    c.execute("DELETE FROM AdminMenuPermission WHERE userId=?", (ADMIN,))
    c.execute("DELETE FROM Notification WHERE userId=?", (ADMIN,))
    c.execute("DELETE FROM User WHERE id=?", (ADMIN,))
# restore settings baseline (remove QA corp name)
c.execute("DELETE FROM AppSetting WHERE key='companyName' AND value=?", (f'QA Corp {STAMP}',))
con.commit()
# verify
c.execute("SELECT COUNT(*) FROM Employee WHERE employeeId LIKE 'QA16-%'")
left_emp = c.fetchone()[0]
c.execute("SELECT COUNT(*) FROM User WHERE email LIKE 'qa16-%'")
left_user = c.fetchone()[0]
con.close()
check(left_emp == 0, 'QA employees purged')
check(left_user == 0, 'QA users purged')

# currency setting remains AED (explicitly set in test) — that's the desired default
r = req('GET', '/api/settings', label='final GET settings')
check(r.get('data', {}).get('settings', {}).get('currency') == 'AED', 'currency still AED at end')

print(f"\n{'='*60}\nRESULTS: {PASS} passed, {FAIL} failed")
if FAILURES:
    print('FAILED:', *FAILURES, sep='\n  - ')
