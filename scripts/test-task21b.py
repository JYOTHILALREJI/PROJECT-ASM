#!/usr/bin/env python3
"""Task 21-b API tests: tab-aware agent (stock_add macro + observe-first/tab rules)."""
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


MSG = 'HELP ME ADD MATERIAL, SAFETY VEST SIZE :M, QUANTITY 50'


def main():
    s, d = call('POST', '/api/auth/login', {'email': 'admin@asm.com', 'password': 'admin123'})
    uid = (d.get('data', {}).get('user') or d.get('user') or {}).get('id')
    check('admin login', bool(uid))
    s, d = call('GET', f'/api/ai/sessions?userId={uid}&ensureToday=1')
    sid = d['data']['today']['id']
    check('today session', bool(sid))

    print('== 1. exact user message → one-shot stock_add with VERBATIM values ==')
    s, d = chat(uid, sid, content=MSG, view='dashboard')
    check('chat 200', s == 200, str(s))
    action = (d.get('data', {}) or {}).get('action') or {}
    print('  action:', json.dumps(action, ensure_ascii=False)[:300])
    check('action type stock_add', action.get('type') == 'stock_add', action.get('type', ''))
    check('itemName verbatim "SAFETY VEST"', action.get('itemName') == 'SAFETY VEST', repr(action.get('itemName')))
    check('size verbatim "M"', action.get('size') == 'M', repr(action.get('size')))
    check('quantity 50', action.get('quantity') == 50, repr(action.get('quantity')))
    check('no minQuantity invented', not action.get('minQuantity'), repr(action.get('minQuantity')))
    if s == 200:
        step = d['data']['assistantMessage']['content']
        check('friendly step line persisted', '📦' in step and 'SAFETY VEST' in step, step[:120])
        check('agent flag true', d['data'].get('agent') is True)

    print('== 2. observation loop closes: macro success → final confirmation answer ==')
    s, d = chat(uid, sid, view='uniform_registry',
                observation='Switched to the "Stock Management" tab.\n'
                            'Filled: Item "SAFETY VEST" · Size "M" · Qty 50.\n'
                            '✅ Stock saved: SAFETY VEST (size M) — quantity 50. '
                            'Materials Registry → Stock Management now lists it (re-adding an existing item adds to its quantity).')
    check('chat 200', s == 200, str(s))
    msg = (d.get('data', {}) or {}).get('assistantMessage', {}).get('content', '')
    print('  answer:', json.dumps(msg, ensure_ascii=False)[:300])
    a2 = (d.get('data', {}) or {}).get('action') or {}
    check('final answer (no further action)', not a2, str(a2))
    low = msg.lower()
    check('mentions the added stock', 'safety vest' in low and ('50' in low or 'added' in low or 'saved' in low))
    check('we-voice confirmation', 'we' in low or 'i' in low)

    print('== 3. missing item name → asks, never invents ==')
    s, d = chat(uid, sid, content='Add some material to the stock please.', view='dashboard')
    check('chat 200', s == 200, str(s))
    a3 = (d.get('data', {}) or {}).get('action') or {}
    msg3 = (d.get('data', {}) or {}).get('assistantMessage', {}).get('content', '')
    print('  action:', json.dumps(a3, ensure_ascii=False)[:200])
    print('  answer:', json.dumps(msg3, ensure_ascii=False)[:250])
    if a3:
        check('if it acts, it does not invent an item', a3.get('type') != 'stock_add' or not (a3.get('itemName') or '').strip())
    else:
        low3 = msg3.lower()
        check('asks which item/material', ('item' in low3 or 'material' in low3 or 'which' in low3) and len(msg3) > 20)

    print('== 4. regression: NOC one-shot still preferred for NOC requests ==')
    s, d = chat(uid, sid, content='Create an NOC for M/S TEST REGRESSION LLC, employees SEED WORKER 001 and SEED WORKER 002.', view='dashboard')
    check('chat 200', s == 200, str(s))
    a4 = (d.get('data', {}) or {}).get('action') or {}
    print('  action:', json.dumps(a4, ensure_ascii=False)[:250])
    check('action type noc_create', a4.get('type') == 'noc_create', str(a4.get('type')))
    check('client verbatim', a4.get('client') == 'M/S TEST REGRESSION LLC', repr(a4.get('client')))
    check('employees extracted', (a4.get('employees') or []) == ['SEED WORKER 001', 'SEED WORKER 002'], str(a4.get('employees')))

    print('== 5. where-question → UI-map answer names the Stock Management tab ==')
    s, d = chat(uid, sid, content='Where do I add material stock in the app?', view='dashboard')
    check('chat 200', s == 200, str(s))
    msg5 = (d.get('data', {}) or {}).get('assistantMessage', {}).get('content', '')
    a5 = (d.get('data', {}) or {}).get('action') or {}
    print('  answer:', json.dumps(msg5, ensure_ascii=False)[:250])
    low5 = msg5.lower()
    check('mentions stock management', 'stock management' in low5)
    check('mentions materials registry page', 'materials' in low5 or 'uniform' in low5)

    print(f'\nRESULT: {PASS} PASS / {FAIL} FAIL')
    raise SystemExit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
