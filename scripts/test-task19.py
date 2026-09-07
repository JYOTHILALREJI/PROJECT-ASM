#!/usr/bin/env python3
"""Task 19 API tests: cute assistant name setting + companion-voice AI answers."""
import json
import sys
import urllib.request

BASE = 'http://localhost:3000'
PASS, FAIL = 0, 0


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, data, timeout=180) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  PASS  {name}')
    else:
        FAIL += 1
        print(f'  FAIL  {name}  {detail}')


def login(email, password):
    s, d = call('POST', '/api/auth/login', {'email': email, 'password': password})
    if s != 200:
        return None
    u = d.get('data', {}).get('user') or d.get('user') or {}
    return u.get('id')


def main():
    print('== login ==')
    admin_id = login('admin@asm.com', 'admin123')
    check('admin login', bool(admin_id), repr(admin_id))
    if not admin_id:
        sys.exit(1)

    print('== settings: aiName ==')
    s, d = call('GET', '/api/settings')
    settings = d.get('data', {}).get('settings', {})
    check('GET settings 200', s == 200)
    check('aiName present (default Nova)', settings.get('aiName') == 'Nova', repr(settings.get('aiName')))

    s, d = call('PUT', '/api/settings', {'userId': admin_id, 'settings': {'aiName': 'Robi'}})
    check('PUT aiName=Robi 200', s == 200, f'{s} {d}')
    check('PUT returns Robi', (d.get('data', {}).get('settings') or {}).get('aiName') == 'Robi')

    s, d = call('PUT', '/api/settings', {'userId': admin_id, 'settings': {'aiName': '   '}})
    check('PUT empty aiName 400', s == 400, str(s))

    s, d = call('PUT', '/api/settings', {'userId': admin_id, 'settings': {'aiName': 'x' * 25}})
    check('PUT 25-char aiName 400', s == 400, str(s))

    s, d = call('PUT', '/api/settings', {'userId': admin_id, 'settings': {'aiName': 'Zippy'}})
    check('PUT aiName=Zippy 200', s == 200, str(s))

    # restore default
    s, d = call('PUT', '/api/settings', {'userId': admin_id, 'settings': {'aiName': 'Nova'}})
    check('restore aiName=Nova', s == 200)

    print('== ai chat: companion voice + detail ==')
    s, d = call('GET', '/api/ai/sessions?userId=' + admin_id + '&ensureToday=1')
    check('GET sessions 200', s == 200, str(s))
    today = (d.get('data', {}) or {}).get('today') or {}
    sid = today.get('id')
    check('today session exists', bool(sid), repr(d))

    s, d = call('POST', '/api/ai/chat', {
        'userId': admin_id, 'sessionId': sid, 'content': 'How many sites do we have?',
    })
    check('chat POST 200', s == 200, f'{s} {json.dumps(d)[:300]}')
    msg = ((d.get('data', {}) or {}).get('assistantMessage') or {}).get('content', '')
    meta = ((d.get('data', {}) or {}).get('meta') or {})
    print('  answer:', json.dumps(msg, ensure_ascii=False)[:600])
    print('  meta:', json.dumps(meta)[:200])
    low = msg.lower()
    check('no "you have" phrasing', 'you have' not in low, msg[:120])
    check('companion "we" phrasing', ('we have' in low) or ('we currently' in low) or ('we run' in low) or ('we operate' in low), msg[:120])
    check('detailed (table or named rows)', ('|' in msg) or ('site' in low and any(c.isdigit() for c in msg)), msg[:200])
    check('rows fetched from DB', (meta.get('rowsFetched') or 0) >= 1, repr(meta))

    print(f'\n== {PASS} passed, {FAIL} failed ==')
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
