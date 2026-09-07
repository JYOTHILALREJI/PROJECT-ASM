#!/usr/bin/env python3
"""Task 20-c API tests: one-shot noc_create agent action (value fidelity + loop closure)."""
import json
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


MSG = (
    'HELP ME CREATE THIS NOC\n'
    'CLIENT: M/S NPC LLC\n'
    'PROJECT NAME : NPC SHOBHA\n'
    'EMPLOYEES :\n'
    'SEED WORKER 001\n'
    'SEED WORKER 002\n'
    'SEED WORKER 003\n'
    'SEED WORKER 004\n'
    'SEED WORKER 005'
)


def main():
    s, d = call('POST', '/api/auth/login', {'email': 'admin@asm.com', 'password': 'admin123'})
    uid = (d.get('data', {}).get('user') or d.get('user') or {}).get('id')
    check('admin login', bool(uid))
    s, d = call('GET', f'/api/ai/sessions?userId={uid}&ensureToday=1')
    sid = d['data']['today']['id']
    check('today session', bool(sid))

    print('== 1. pasted NOC message → one-shot noc_create with VERBATIM values ==')
    s, d = chat(uid, sid, content=MSG, view='dashboard')
    check('chat 200', s == 200, str(s))
    action = (d.get('data', {}) or {}).get('action') or {}
    print('  action:', json.dumps(action, ensure_ascii=False)[:400])
    check('action type noc_create', action.get('type') == 'noc_create', action.get('type', ''))
    check('client verbatim "M/S NPC LLC"', action.get('client') == 'M/S NPC LLC', repr(action.get('client')))
    check('project verbatim "NPC SHOBHA"', action.get('project') == 'NPC SHOBHA', repr(action.get('project')))
    emps = action.get('employees') or []
    check('5 employees extracted', len(emps) == 5, str(len(emps)))
    check('employee names verbatim', emps == [f'SEED WORKER 00{i}' for i in range(1, 6)], str(emps))
    check('no date invented (omitted → defaults to today)', not action.get('date'), repr(action.get('date')))
    check('no placeholder junk in payload', 'PROSCAPE' not in json.dumps(action) and 'Business Bay' not in json.dumps(action))
    if s == 200:
        step = d['data']['assistantMessage']['content']
        check('friendly step line persisted', '🛠️' in step and 'M/S NPC LLC' in step, step[:120])
        check('agent flag true', d['data'].get('agent') is True)

    print('== 2. observation loop closes: macro success → final confirmation answer ==')
    s, d = chat(uid, sid, view='documents',
                observation='Filled the details: Client "M/S NPC LLC", Project "NPC SHOBHA", Date 05-09-2026.\n'
                            'Employees: 5/5 on the NOC table (SEED WORKER 001, SEED WORKER 002, SEED WORKER 003, SEED WORKER 004, SEED WORKER 005).\n'
                            '✅ NOC generated: NOC-2026-0042 — M/S NPC LLC · NPC SHOBHA · 5 employee(s). '
                            'It is stored in Documents → NOC and the page offers Print / Download PDF.')
    check('chat 200', s == 200, str(s))
    msg = (d.get('data', {}) or {}).get('assistantMessage', {}).get('content', '')
    print('  answer:', json.dumps(msg, ensure_ascii=False)[:300])
    a2 = (d.get('data', {}) or {}).get('action') or {}
    check('final answer (no further action)', not a2, str(a2))
    low = msg.lower()
    check('mentions the NOC number', 'noc-2026-0042' in low or 'noc generated' in low or 'created' in low)
    check('we-voice confirmation', 'we' in low or 'i' in low)

    print('== 3. missing employees → asks, never invents ==')
    s, d = chat(uid, sid, content='Create an NOC for M/S AL AMIN LLC please.', view='dashboard')
    check('chat 200', s == 200, str(s))
    a3 = (d.get('data', {}) or {}).get('action') or {}
    msg3 = (d.get('data', {}) or {}).get('assistantMessage', {}).get('content', '')
    print('  action:', json.dumps(a3, ensure_ascii=False)[:200])
    print('  answer:', json.dumps(msg3, ensure_ascii=False)[:250])
    if a3:
        check('if it acts, it does not invent employees', a3.get('type') != 'noc_create' or not (a3.get('employees') or []))
    else:
        low3 = msg3.lower()
        check('asks for the employee list', ('employee' in low3 or 'worker' in low3 or 'name' in low3) and len(msg3) > 20)

    print(f'\nRESULT: {PASS} PASS / {FAIL} FAIL')
    raise SystemExit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
