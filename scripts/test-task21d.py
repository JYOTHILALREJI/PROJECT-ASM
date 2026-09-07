#!/usr/bin/env python3
"""Task 21-d API tests: model identity, all-sites attendance macro, settings key handling.

Covers the user's bug reports:
  1. "which model do you use now?" got "the model that powers Nova" — no name.
     Now the prompts carry the REAL model identity (GLM / saved provider model).
  2. "mark all employees present for today in all sites" stopped after site 1:
     the page has one "Mark all as Present" button PER SITE, so a text click
     hit site 1 and its success toast ended the task. Now a one-shot
     attendance_mark action covers ALL sites in a single step, and a
     MULTI-TARGET guard keeps the loop going for any other multi-site request.
  3. Saving API settings wiped the key from the page: PUT /api/settings used
     to return the RAW key (and no mask). Now it mirrors GET (masked only).
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
        s, d = call('GET', f'/api/ai/sessions?userId={uid}&ensureToday=1')
        sid = d['data']['today']['id']
    TEST_SESSIONS.append(sid)
    return sid


def chat(uid, sid, **kw):
    payload = {'userId': uid, 'sessionId': sid}
    payload.update(kw)
    # The built-in provider rate-limits per minute — pace the calls and retry
    # patiently on 502 (the route already backoffs internally for ~95s).
    time.sleep(35)
    s, d = call('POST', '/api/ai/chat', payload)
    if s != 200:
        print(f'  … chat returned {s}, waiting 70s and retrying once')
        time.sleep(70)
        s, d = call('POST', '/api/ai/chat', payload)
    return s, d


def cleanup():
    con = sqlite3.connect(DB)
    for sid in TEST_SESSIONS:
        con.execute('DELETE FROM AiChatMessage WHERE sessionId=?', (sid,))
        con.execute('DELETE FROM AiChatSession WHERE id=?', (sid,))
    con.commit()
    con.close()


PART = __import__('sys').argv[1] if len(__import__('sys').argv) > 1 else 'ALL'


def main():
    global TEST_SESSIONS
    print('== 0. setup ==')
    admin_uid = login('admin@asm.com', 'admin123')
    check('super admin login', bool(admin_uid))
    today = time.strftime('%Y-%m-%d')
    print('  today:', today)
    time.sleep(30)  # let the provider quota cool before the first LLM call

    if PART in ('ALL', 'A'):
        # ── 1. Model identity: a REAL model name, never a vague dodge ──
        print('== 1. model identity question ==')
        sid = fresh_session(admin_uid)
        s, d = chat(admin_uid, sid, content='which model do you use now?', view='dashboard')
        check('chat 200', s == 200, str(s))
        answer = ((d.get('data', {}) or {}).get('assistantMessage') or {}).get('content', '')
        print('  answer:', answer[:220].replace('\n', ' '))
        low = answer.lower()
        check('names a concrete model (glm / gpt / claude / gemini / qwen / deepseek / llama / kimi)',
              any(k in low for k in ('glm', 'gpt', 'claude', 'gemini', 'qwen', 'deepseek', 'llama', 'kimi', 'mock-model')),
              answer[:200])
        check('does NOT dodge ("the model that powers" with no name)',
              not ('model that powers' in low and not any(k in low for k in ('glm', 'gpt', 'claude', 'gemini', 'qwen', 'deepseek', 'llama', 'kimi', 'mock-model'))),
              answer[:200])
        check('no SQL was needed', not ((d.get('data', {}) or {}).get('meta', {}) or {}).get('sqlUsed'))

        # ── 2. All-sites attendance → ONE attendance_mark action ──
        print('== 2. all-sites attendance → attendance_mark macro ==')
        sid = fresh_session(admin_uid)
        s, d = chat(admin_uid, sid, content='mark all employees present for today in all sites', view='dashboard')
        data = d.get('data', {}) or {}
        action = data.get('action') or {}
        print('  action:', json.dumps(action, ensure_ascii=False)[:200])
        check('chat 200', s == 200, str(s))
        check('returns an ACTION', bool(action), json.dumps(d)[:300])
        check('action is attendance_mark (not per-site clicks)', action.get('type') == 'attendance_mark', str(action.get('type')))
        check('status present', action.get('status', 'present') == 'present', str(action.get('status')))
        check('no site restriction (ALL sites)', not action.get('site'), repr(action.get('site')))

        # 2b. macro success observation → immediate final confirmation
        print('== 2b. macro success → final confirmation, no extra steps ==')
        s, d = chat(admin_uid, sid, view='attendance',
                    observation='✅ Bulk attendance complete — 202 employee(s) marked as Present (10h) for '
                                + today + ' across ALL sites. Covered: Site A, Site B, Site C, Site D, Site E, Site F, Site G. '
                                'The Attendance grid has been refreshed.')
        data = d.get('data', {}) or {}
        answer = (data.get('assistantMessage') or {}).get('content', '')
        print('  answer:', answer[:200].replace('\n', ' '))
        check('no further ACTION after macro success', not data.get('action'), json.dumps(data.get('action'))[:150])
        check('final answer confirms the bulk mark', bool(answer) and ('202' in answer or 'present' in answer.lower()), answer[:200])

    if PART in ('ALL', 'B'):
        # ── 3. MULTI-TARGET guard: per-site toast must NOT end an all-sites task ──
        print('== 3. multi-target continuation guard ==')
        sid = fresh_session(admin_uid)
        s1, d1 = chat(admin_uid, sid, content='mark all employees present for today in all sites', view='dashboard')
        s, d = chat(admin_uid, sid, view='attendance',
                    observation='Clicked "Mark all as Present" for Site Alpha. Toast: "Bulk mark complete — '
                                '12 employee(s) marked as present for ' + today + ' for Site Alpha".')
        data = d.get('data', {}) or {}
        action = data.get('action') or {}
        print('  action:', json.dumps(action, ensure_ascii=False)[:160])
        check('task CONTINUES with an action (not a final answer)', bool(action), json.dumps({'answer': data.get('assistantMessage', {}).get('content', '')})[:220])

        # ── 4. single-site request → attendance_mark with site name ──
        print('== 4. single-site attendance_mark ==')
        sid2 = fresh_session(admin_uid)
        s, d = chat(admin_uid, sid2, content='mark all employees present today at Site A', view='dashboard')
        data = d.get('data', {}) or {}
        action = data.get('action') or {}
        print('  action:', json.dumps(action, ensure_ascii=False)[:200])
        check('attendance_mark action', action.get('type') == 'attendance_mark', str(action.get('type')))
        check('site restriction carried', isinstance(action.get('site'), str) and 'site a' in action.get('site', '').lower(), repr(action.get('site')))

    if PART in ('ALL', 'C'):
        # ── 5. Settings PUT: raw key never returned, mask present ──
        print('== 5. settings PUT masks the API key ==')
        fake_key = 'sk-test-abcdef1234567890qwerty'
        s, d = call('PUT', '/api/settings', {'userId': admin_uid, 'settings': {'aiApiKey': fake_key}})
        check('PUT 200', s == 200, str(s))
        returned = ((d.get('data', {}) or {}).get('settings') or {})
        check('PUT response does NOT contain the raw key', fake_key not in json.dumps(d), json.dumps(d)[:200])
        check('PUT response carries aiApiKeyMasked', returned.get('aiApiKeyMasked', '').endswith('erty'), repr(returned.get('aiApiKeyMasked')))
        s, d = call('GET', '/api/settings')
        got = ((d.get('data', {}) or {}).get('settings') or {})
        check('GET still returns the mask', got.get('aiApiKeyMasked', '').endswith('erty'), repr(got.get('aiApiKeyMasked')))
        check('GET never leaks the raw key', fake_key not in json.dumps(d))
        # restore: remove the test key
        call('PUT', '/api/settings', {'userId': admin_uid, 'settings': {'aiApiKey': ''}})
        s, d = call('GET', '/api/settings')
        got = ((d.get('data', {}) or {}).get('settings') or {})
        check('key removal works (mask empty again)', got.get('aiApiKeyMasked', '') == '', repr(got.get('aiApiKeyMasked')))

        # ── 6. bulk-mark API: siteName restriction + sites list in response ──
        print('== 6. bulk-mark API siteName support ==')
        con = sqlite3.connect(DB)
        site_row = con.execute("SELECT id, name FROM Site WHERE deletedAt IS NULL ORDER BY name LIMIT 1").fetchone()
        con.close()
        site_id, site_name = site_row
        s, d = call('POST', '/api/attendance/bulk-mark', {'date': today, 'status': 'present', 'siteName': site_name})
        check('bulk-mark with siteName 200', s == 200, str(s))
        data = d.get('data', {}) or {}
        print('  updated:', data.get('updated'), 'skipped:', data.get('skipped'), 'sites:', data.get('sites'))
        check('sites list in response names only that site', data.get('sites') == [site_name], repr(data.get('sites')))
        con = sqlite3.connect(DB)
        total_at_site = con.execute(
            "SELECT COUNT(*) FROM Employee WHERE status='active' AND (currentSiteId=? OR currentSite=?)",
            (site_id, site_name)).fetchone()[0]
        con.close()
        check('marked + skipped == employees currently at that site',
              data.get('updated', 0) + data.get('skipped', 0) == total_at_site,
              f"{data.get('updated')}+{data.get('skipped')} vs {total_at_site}")
        # unknown site name → clear 404
        s, d = call('POST', '/api/attendance/bulk-mark', {'date': today, 'status': 'present', 'siteName': 'NO SUCH SITE QA'})
        check('unknown siteName → 404 with clear error', s == 404 and 'no site found' in str(d.get('error', '')).lower(), f'{s} {json.dumps(d)[:150]}')

    cleanup()
    print(f'\nRESULT: {PASS} passed, {FAIL} failed')
    raise SystemExit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
