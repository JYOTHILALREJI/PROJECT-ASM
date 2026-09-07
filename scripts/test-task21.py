#!/usr/bin/env python3
"""Task 21 API tests — AI Assistant permission gate + ai_assistant permission seed.

Covers:
  1. Permission seed: GET /api/permissions lists "AI Assistant" (ai_assistant).
  2. Normal admin without the grant: /api/ai/chat and /api/ai/sessions → 403.
  3. Grant via POST /api/permissions → sessions API works again.
  4. Revoke → 403 again (frontend face disappears via its 15s poll).
  5. Super admin always passes the gate without any grant row.
"""
import json
import time
import urllib.request

BASE = 'http://localhost:3000'
SUPER = ('admin@asm.com', 'admin123')
ADMIN = ('qa2-1788516075@asm.com', 'qa2Pass123!')
SUPER_ID = 'cmrfz988v0000pfug6bayl9lb'

results = []


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, data, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def check(name, ok, extra=''):
    results.append((name, ok))
    print(('PASS' if ok else 'FAIL') + f' — {name}' + (f' [{extra}]' if extra and not ok else ''))


# ── login both accounts ──────────────────────────────────────────────────────
st, d = call('POST', '/api/auth/login', {'email': ADMIN[0], 'password': ADMIN[1]})
check('admin login', st == 200 and d.get('data', {}).get('user', {}).get('id'), st)
admin_id = d.get('data', {}).get('user', {}).get('id', '')

# ── 1. permission seed visible ───────────────────────────────────────────────
st, d = call('GET', '/api/permissions')
perms = d.get('data', {}).get('permissions', []) if st == 200 else []
ai = next((p for p in perms if p.get('slug') == 'ai_assistant'), None)
check('ai_assistant seeded in permissions API', ai is not None and ai.get('group') == 'general')
check('ai_assistant is configurable (not always-visible)', ai is not None and ai.get('isAlwaysVisible') is False)
check('dashboard still always-visible', any(p.get('slug') == 'dashboard' and p.get('isAlwaysVisible') for p in perms))

# ── clean slate: make sure the grant starts revoked ─────────────────────────
st, d = call('POST', '/api/permissions', {'adminId': admin_id, 'permissionSlug': 'ai_assistant', 'granted': False})
check('revoke to clean state', st == 200, st)
time.sleep(0.3)

# ── 2. blocked without the grant ────────────────────────────────────────────
st, d = call('POST', '/api/ai/chat', {'userId': admin_id, 'sessionId': 'dummy-session', 'content': 'hello'})
check('chat 403 without grant', st == 403 and 'super admin' in d.get('error', ''), (st, d.get('error', '')))
st, d = call('GET', f'/api/ai/sessions?userId={admin_id}')
check('sessions 403 without grant', st == 403 and 'super admin' in d.get('error', ''), st)

# ── 3. grant → allowed ──────────────────────────────────────────────────────
st, d = call('POST', '/api/permissions', {'adminId': admin_id, 'permissionSlug': 'ai_assistant', 'granted': True})
check('grant via permissions API', st == 200, st)
time.sleep(0.3)
st, d = call('GET', f'/api/ai/sessions?userId={admin_id}&ensureToday=1')
check('sessions allowed after grant', st == 200 and d.get('data', {}).get('today', {}).get('id'), st)
session_id = d.get('data', {}).get('today', {}).get('id', '')

# granted flag visible in the permission grid payload
st, d = call('GET', f'/api/permissions?adminId={admin_id}')
ai = next((p for p in d.get('data', {}).get('permissions', []) if p.get('slug') == 'ai_assistant'), {})
check('granted flag true in permission grid', st == 200 and ai.get('granted') is True, ai)

# ── 4. revoke → blocked again ───────────────────────────────────────────────
st, d = call('POST', '/api/permissions', {'adminId': admin_id, 'permissionSlug': 'ai_assistant', 'granted': False})
check('revoke via permissions API', st == 200, st)
time.sleep(0.3)
st, d = call('POST', '/api/ai/chat', {'userId': admin_id, 'sessionId': session_id, 'content': 'hello'})
check('chat 403 after revoke', st == 403, st)
st, d = call('GET', f'/api/ai/sessions?userId={admin_id}')
check('sessions 403 after revoke', st == 403, st)

# ── 5. super admin bypasses the gate (no grant row exists) ──────────────────
st, d = call('POST', '/api/auth/login', {'email': SUPER[0], 'password': SUPER[1]})
check('super admin login', st == 200, st)
st, d = call('POST', '/api/ai/chat', {'userId': SUPER_ID, 'sessionId': 'definitely-not-a-session', 'content': 'hello'})
check('super admin passes AI gate', st == 404 and 'Session not found' in d.get('error', ''), (st, d.get('error', '')))
st, d = call('GET', f'/api/ai/sessions?userId={SUPER_ID}')
check('super admin sessions allowed', st == 200, st)

# ── summary ─────────────────────────────────────────────────────────────────
fails = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(fails)}/{len(results)} passed" + (f"; FAILED: {fails}" if fails else ' — all green'))
exit(1 if fails else 0)
