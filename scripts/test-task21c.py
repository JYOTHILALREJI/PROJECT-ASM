#!/usr/bin/env python3
"""Task 21-c API tests: settings-change agent flow + permission-aware refusals.

Covers the user's bug report:
  "IN SETTINGS CHANGE COMPANY SHORT NAME TO BCC" used to end with a fake
  step line ("🛠️ Updating company short name to BCC in Settings…") and never
  acted. Now: action intent recognises change/update verbs, the planner must
  emit real actions, and accounts without Settings access get a clear
  "I don't have access" answer instead of a silent failure.
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


def login(email, password):
    s, d = call('POST', '/api/auth/login', {'email': email, 'password': password})
    uid = (d.get('data', {}).get('user') or d.get('user') or {}).get('id')
    return uid


def fresh_session(uid):
    s, d = call('POST', '/api/ai/sessions', {'userId': uid})
    sid = (d.get('data', {}).get('session') or d.get('session') or {}).get('id') if isinstance(d.get('data'), dict) else None
    if not sid:
        # fallback: GET list
        s, d = call('GET', f'/api/ai/sessions?userId={uid}&ensureToday=1')
        sid = d['data']['today']['id']
    TEST_SESSIONS.append(sid)
    return sid


def chat(uid, sid, **kw):
    payload = {'userId': uid, 'sessionId': sid}
    payload.update(kw)
    return call('POST', '/api/ai/chat', payload)


def main():
    print('== 0. logins ==')
    admin_uid = login('admin@asm.com', 'admin123')
    check('super admin login', bool(admin_uid))
    qa_uid = login('qa2-1788516075@asm.com', 'qa2Pass123!')
    check('qa admin (ai permitted) login', bool(qa_uid))

    print('== 1. SUPER ADMIN: settings change request → REAL action, never a fake step line ==')
    sid = fresh_session(admin_uid)
    s, d = chat(admin_uid, sid, content='IN SETTINGS CHANGE COMPANY SHORT NAME TO BCC', view='dashboard')
    check('chat 200', s == 200, str(s))
    data = d.get('data', {}) or {}
    action = data.get('action') or {}
    print('  action:', json.dumps(action, ensure_ascii=False)[:200])
    check('returns an ACTION (not prose)', bool(action), json.dumps(d)[:300])
    check('action is navigate/read', action.get('type') in ('navigate', 'read'), str(action.get('type')))
    if action.get('type') == 'navigate':
        check('navigates to settings', action.get('view') == 'settings', repr(action.get('view')))

    print('== 2. planner chain: navigate observation → read → fill BCC verbatim → Apply Settings ==')
    s, d = chat(admin_uid, sid, view='settings',
                observation='Navigated to the "Settings" screen. Heading: "Settings".')
    action = (d.get('data', {}) or {}).get('action') or {}
    print('  action:', json.dumps(action, ensure_ascii=False)[:200])
    check('next step is read (OBSERVE FIRST)', action.get('type') == 'read', json.dumps(action)[:150])

    read_obs = ('Current screen: "settings" — Settings.\n'
                'Visible elements:\n'
                '[heading] settings\n'
                '[btn] apply settings\n'
                '[input] label="Brand text (glowing short name)" placeholder="ASM" VALUE="ASM"\n'
                '[input] label="Company name" placeholder="Arabian Shield Manpower" VALUE="Arabian Shield Manpower"\n'
                '[input] label="Assistant name" placeholder="Nova" VALUE="Nova"\n'
                '[btn] aed\n[btn] usd')
    s, d = chat(admin_uid, sid, view='settings', observation=read_obs)
    action = (d.get('data', {}) or {}).get('action') or {}
    print('  action:', json.dumps(action, ensure_ascii=False)[:220])
    check('fill action planned', action.get('type') == 'fill', json.dumps(action)[:200])
    check('fill value VERBATIM "BCC"', action.get('value') == 'BCC', repr(action.get('value')))
    check('fill targets brand/short-name field', action.get('field') and ('brand' in action['field'].lower() or 'short' in action['field'].lower()), repr(action.get('field')))

    s, d = chat(admin_uid, sid, view='settings',
                observation='Filled "Brand text (glowing short name)" with "BCC".')
    action = (d.get('data', {}) or {}).get('action') or {}
    print('  action:', json.dumps(action, ensure_ascii=False)[:200])
    check('click Apply Settings planned', action.get('type') == 'click' and 'apply' in (action.get('text') or '').lower(), json.dumps(action)[:200])

    s, d = chat(admin_uid, sid, view='settings',
                observation='Clicked "apply settings". Screen heading is now: "settings". '
                            'Page toast: "settings applied your changes are now live across every page of the app".')
    data = d.get('data', {}) or {}
    action = data.get('action') or {}
    answer = ((data.get('assistantMessage') or {}).get('content', ''))
    print('  action:', json.dumps(action, ensure_ascii=False)[:150])
    print('  answer:', answer[:200])
    check('final confirmation (no more actions)', not action, json.dumps(action)[:120])
    check('confirmation mentions BCC', 'bcc' in answer.lower(), answer[:150])

    print('== 3. where-question regression: directions, never a bare navigate ==')
    sid2 = fresh_session(admin_uid)
    s, d = chat(admin_uid, sid2, content='Where do I change the company short name?', view='dashboard')
    data = d.get('data', {}) or {}
    answer = (data.get('assistantMessage') or {}).get('content', '')
    check('answered with directions (no action)', not data.get('action'), json.dumps(data.get('action') or {})[:120])
    check('mentions Settings/brand text', ('setting' in answer.lower() or 'brand' in answer.lower()), answer[:150])

    print('== 4. QA ADMIN (no Settings permission): request → clear no-access ANSWER, no actions ==')
    sid3 = fresh_session(qa_uid)
    s, d = chat(qa_uid, sid3, content='IN SETTINGS CHANGE COMPANY SHORT NAME TO BCC', view='dashboard')
    check('chat 200', s == 200, str(s))
    data = d.get('data', {}) or {}
    action = data.get('action') or {}
    answer = (data.get('assistantMessage') or {}).get('content', '')
    print('  action:', json.dumps(action, ensure_ascii=False)[:150])
    print('  answer:', answer[:220])
    check('NO action toward Settings', not action, json.dumps(action)[:150])
    check('final answer given', bool(answer))
    check('answer mentions lack of access / super admin', any(k in answer.lower() for k in ('access', 'super admin', 'permission', 'only the super')), answer[:200])

    print('== 5. QA ADMIN: navigate demand → ACCESS DENIED handled gracefully ==')
    sid4 = fresh_session(qa_uid)
    s, d = chat(qa_uid, sid4, content='OPEN THE SETTINGS PAGE AND CHANGE THE CURRENCY TO USD', view='dashboard')
    data = d.get('data', {}) or {}
    action = data.get('action') or {}
    answer = (data.get('assistantMessage') or {}).get('content', '')
    print('  action:', json.dumps(action, ensure_ascii=False)[:150])
    print('  answer:', answer[:220])
    check('no navigate-to-settings action', not (action.get('type') == 'navigate' and action.get('view') == 'settings'), json.dumps(action)[:120])
    ok_no_access = (not action) or bool(answer)
    check('responds without breaking protocol', ok_no_access)

    print('== 6. super admin data path untouched ==')
    sid5 = fresh_session(admin_uid)
    s, d = chat(admin_uid, sid5, content='how many sites do we have?', view='dashboard')
    print('  status:', s, json.dumps(d, ensure_ascii=False)[:200])
    data = d.get('data', {}) or {}
    rows = (data.get('meta') or {}).get('rowsFetched', 0)
    check('sql answered with rows', s == 200 and rows >= 1, f'status={s} rows={rows}')
    check('no action for data question', not data.get('action'))

    print(f'\nRESULT: {PASS} passed, {FAIL} failed')


def cleanup():
    """Purge chat rows created by this test run."""
    if not TEST_SESSIONS:
        return
    con = sqlite3.connect(DB)
    cur = con.cursor()
    ph = ','.join('?' * len(TEST_SESSIONS))
    cur.execute(f'DELETE FROM AiChatMessage WHERE sessionId IN ({ph})', TEST_SESSIONS)
    cur.execute(f'DELETE FROM AiChatSession WHERE id IN ({ph})', TEST_SESSIONS)
    con.commit()
    print(f'cleanup: removed {len(TEST_SESSIONS)} test sessions')
    con.close()


if __name__ == '__main__':
    try:
        main()
    finally:
        cleanup()
