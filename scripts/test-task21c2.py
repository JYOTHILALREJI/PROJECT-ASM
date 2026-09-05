#!/usr/bin/env python3
"""Task 21-c follow-up: paced re-checks (provider rate-limits bursts).

1) success toast → immediate final confirmation (no extra read loops)
2) data question still answered with fresh SQL
"""
import json
import sqlite3
import time
import urllib.request

BASE = 'http://localhost:3000'
DB = '/home/z/my-project/db/custom.db'
PASS, FAIL = 0, 0
TEST_SESSIONS = []


def call(method, path, body=None, timeout=240):
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


def paced_chat(uid, sid, **kw):
    """Chat with 429/502 backoff — up to 4 tries, 25s between attempts."""
    for attempt in range(4):
        s, d = call('POST', '/api/ai/chat', {'userId': uid, 'sessionId': sid, **kw})
        if s == 200:
            return s, d
        print(f'   … attempt {attempt + 1} → {s}, backing off')
        time.sleep(25)
    return s, d


def main():
    s, d = call('POST', '/api/auth/login', {'email': 'admin@asm.com', 'password': 'admin123'})
    uid = (d.get('data', {}).get('user') or d.get('user') or {}).get('id')
    check('admin login', bool(uid))

    s, d = call('GET', f'/api/ai/sessions?userId={uid}&ensureToday=1')
    sid = d['data']['today']['id']
    TEST_SESSIONS.append(sid)
    time.sleep(15)

    print('== 1. Apply-Settings toast → immediate final confirmation ==')
    s, d = paced_chat(uid, sid, view='settings',
                      observation='Filled "Brand text (glowing short name)" with "BCC".')
    a1 = (d.get('data', {}) or {}).get('action') or {}
    print('  after fill:', json.dumps(a1, ensure_ascii=False)[:160])
    time.sleep(15)
    s2, d2 = paced_chat(uid, sid, view='settings',
                        observation='Clicked "apply settings". Screen heading is now: "settings". '
                                    'Page toast: "settings applied your changes are now live across every page of the app".')
    data = d2.get('data', {}) or {}
    action = data.get('action') or {}
    answer = (data.get('assistantMessage') or {}).get('content', '')
    print('  final answer:', answer[:220])
    check('no more actions after success toast', not action, json.dumps(action)[:150])
    check('confirmation mentions BCC', 'bcc' in answer.lower(), answer[:200])

    time.sleep(15)
    print('== 2. data question still fresh SQL ==')
    s3, d3 = paced_chat(uid, sid, content='how many sites do we have?', view='dashboard')
    data = d3.get('data', {}) or {}
    rows = (data.get('meta') or {}).get('rowsFetched', 0)
    answer = (data.get('assistantMessage') or {}).get('content', '')
    print('  status:', s3, '| rows:', rows, '| answer:', answer[:150])
    check('sql answered with rows', s3 == 200 and rows >= 1, f'status={s3} rows={rows}')
    check('no action for data question', not data.get('action'))

    print(f'\nRESULT: {PASS} passed, {FAIL} failed')


def cleanup():
    if not TEST_SESSIONS:
        return
    con = sqlite3.connect(DB)
    cur = con.cursor()
    ph = ','.join('?' * len(TEST_SESSIONS))
    cur.execute(f'DELETE FROM AiChatMessage WHERE sessionId IN ({ph})', TEST_SESSIONS)
    cur.execute(f'DELETE FROM AiChatSession WHERE id IN ({ph})', TEST_SESSIONS)
    con.commit()
    print('cleanup done')
    con.close()


if __name__ == '__main__':
    try:
        main()
    finally:
        cleanup()
