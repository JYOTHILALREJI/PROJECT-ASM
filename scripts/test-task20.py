#!/usr/bin/env python3
"""Task 20 API tests: named breakdowns, UI knowledge, in-app agent actions."""
import json
import sys
import urllib.request

BASE = 'http://localhost:3000'
PASS, FAIL = 0, 0


def call(method, path, body=None, timeout=180):
    req = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, data, timeout=timeout) as r:
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


def chat(uid, sid, **kw):
    payload = {'userId': uid, 'sessionId': sid}
    payload.update(kw)
    return call('POST', '/api/ai/chat', payload)


def main():
    s, d = call('POST', '/api/auth/login', {'email': 'admin@asm.com', 'password': 'admin123'})
    uid = (d.get('data', {}).get('user') or d.get('user') or {}).get('id')
    check('admin login', bool(uid))
    s, d = call('GET', f'/api/ai/sessions?userId={uid}&ensureToday=1')
    sid = d['data']['today']['id']
    check('today session', bool(sid))

    print('== 1. named breakdown: supervisors ==')
    s, d = chat(uid, sid, content='How many supervisors do we have?', view='dashboard')
    check('chat 200', s == 200, str(s))
    msg = d['data']['assistantMessage']['content']
    print('  answer:', json.dumps(msg, ensure_ascii=False)[:500])
    low = msg.lower()
    check('no bare "you have"', 'you have' not in low)
    check('companion we-voice', 'we have' in low)
    check('names listed (table or rows)', '|' in msg or 'site' in low)

    print('== 2. UI knowledge: where to create an NOC ==')
    s, d = chat(uid, sid, content='Where do I go to create an NOC letter?', view='dashboard')
    check('chat 200', s == 200)
    msg = d['data']['assistantMessage']['content']
    print('  answer:', json.dumps(msg, ensure_ascii=False)[:400])
    low = msg.lower()
    check('mentions documents', 'document' in low)
    check('mentions create noc', 'create noc' in low or 'noc' in low)
    a2 = d['data'].get('action') or {}
    helpful = (not a2) or (a2.get('type') == 'navigate' and a2.get('view') == 'documents')
    check('helpful (answer or navigate-to-documents)', helpful, repr(a2))

    print('== 3. agent action: navigate ==')
    s, d = chat(uid, sid, content='Open the documents page for me please.', view='dashboard')
    check('chat 200', s == 200)
    data = d['data']
    action = data.get('action')
    print('  action:', json.dumps(action), '| thought:', data.get('thought'))
    check('returns navigate action', bool(action) and action.get('type') == 'navigate', repr(action))
    check('navigates to documents', bool(action) and action.get('view') == 'documents', repr(action))
    check('step line persisted', 'Opening' in (data.get('assistantMessage', {}).get('content') or ''))
    check('flagged as agent', data.get('agent') is True)

    print('== 4. observation loop: click Create NOC after navigating ==')
    s, d = chat(uid, sid, observation='Navigated to the "Documents & NOC" screen.', view='documents')
    check('chat 200', s == 200)
    data = d['data']
    print('  action:', json.dumps(data.get('action')), '| msg:', json.dumps((data.get('assistantMessage') or {}).get('content', ''))[:200])
    a = data.get('action') or {}
    ok_next = (
        (a.get('type') == 'click' and 'noc' in (a.get('text') or '').lower())
        or (a.get('type') == 'read')
        or (not a and 'noc' in ((data.get('assistantMessage') or {}).get('content') or '').lower())
    )
    check('sensible next step (click/read/answer)', ok_next, repr(a))

    print('== 5. navigation whitelist enforced server-side ==')
    # The model cannot request it, but the validator must reject unknown views.
    s, d = chat(uid, sid, content='Please navigate to https://google.com for me.', view='dashboard')
    check('chat 200', s == 200)
    data = d['data']
    a = data.get('action') or {}
    check('no action returned for external nav', not a, repr(a))
    print('  answer:', json.dumps((data.get('assistantMessage') or {}).get('content', ''))[:220])

    print(f'\n== {PASS} passed, {FAIL} failed ==')
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
