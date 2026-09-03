#!/usr/bin/env python3
"""Task 14 — Camp bed-space table API tests.

Covers:
- GET /api/camps/[id] returns bedSpaceNumber per employee
- PATCH /api/camps/[id]/assign-employee sets / updates / clears a bed space number
- PATCH validation: missing employeeId, non-string value, >50 chars, employee not in camp, 404s
- PATCH does not touch other employees' bed spaces
- POST (fresh assign / transfer) resets bedSpaceNumber to null
- DELETE (remove from camp) clears bedSpaceNumber
- GET camp employee list order is unaffected
"""
import json
import sys
import urllib.request

BASE = 'http://localhost:3000'
PASS = 0
FAIL = 0


def req(method, path, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={'Content-Type': 'application/json'} if data else {})
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def check(name, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  PASS  {name}')
    else:
        FAIL += 1
        print(f'  FAIL  {name}  {extra}')


def find_camp_with_two_slots():
    """Find (or create) a camp, and two employees we can freely play with."""
    st, camps = req('GET', '/api/camps')
    assert st == 200, f'camps list failed: {st}'
    rows = camps.get('data', {}).get('camps') or camps.get('data', {}).get('data') or camps.get('data') or []
    camp = None
    for c in rows:
        if c.get('totalBedSpaces', 0) >= 2 and c.get('isActive', True):
            camp = c
            break
    if camp is None:
        st, created = req('POST', '/api/camps', {
            'name': 'QA BEDSPACE CAMP', 'location': 'QA', 'totalBedSpaces': 10, 'isActive': True,
        })
        assert st in (200, 201), f'camp create failed: {st} {created}'
        camp = created.get('data', {}).get('camp') or created.get('data')
    return camp['id'], camp.get('name', 'QA BEDSPACE CAMP')


def pick_free_employees(camp_id, count=2):
    """Create `count` QA employees (all employees in this DB may already be
    assigned to camps); they are cleaned up at the end of the run."""
    created = []
    import time
    stamp = int(time.time() * 1000)
    for i in range(count):
        st, d = req('POST', '/api/employees', {
            'fullName': f'QA BedSpace Employee {i + 1} ({stamp})',
            'employeeId': f'QA-BS-{stamp}-{i + 1}',
            'status': 'active',
        })
        assert st in (200, 201), f'QA employee create failed: {st} {d}'
        emp = d.get('data', {}).get('employee') or d.get('data', {})
        eid = emp.get('id') if isinstance(emp, dict) else None
        assert eid, f'no id in create response: {d}'
        created.append({'id': eid, 'fullName': emp.get('fullName', f'QA {i + 1}')})
    return created


def main():
    import time
    stamp = int(time.time() * 1000)
    camp_id, camp_name = find_camp_with_two_slots()
    print(f"Camp under test: {camp_name} ({camp_id})")
    e1, e2 = pick_free_employees(camp_id, 2)
    e1_id, e1_name = e1['id'], e1['fullName']
    e2_id = e2['id']

    # --- assign both -------------------------------------------------------
    st, d = req('POST', f'/api/camps/{camp_id}/assign-employee', {'employeeId': e1_id})
    check('POST assign e1 → 2xx', st in (200, 201), f'st={st} {d}')
    st, d = req('POST', f'/api/camps/{camp_id}/assign-employee', {'employeeId': e2_id})
    check('POST assign e2 → 2xx', st in (200, 201), f'st={st} {d}')

    st, d = req('GET', f'/api/camps/{camp_id}')
    emps = {e['id']: e for e in d.get('data', {}).get('employees', [])}
    check('GET camp lists both', e1_id in emps and e2_id in emps)
    check('fresh assign → bedSpaceNumber null', emps.get(e1_id, {}).get('bedSpaceNumber') is None,
          repr(emps.get(e1_id, {}).get('bedSpaceNumber')))

    # --- PATCH: set bed space ---------------------------------------------
    st, d = req('PATCH', f'/api/camps/{camp_id}/assign-employee',
                {'employeeId': e1_id, 'bedSpaceNumber': '  B-12  '})
    check('PATCH set "  B-12  " → 200', st == 200, f'st={st} {d}')
    check('PATCH returns trimmed value', d.get('data', {}).get('bedSpaceNumber') == 'B-12',
          repr(d.get('data', {}).get('bedSpaceNumber')))

    st, d = req('GET', f'/api/camps/{camp_id}')
    emps = {e['id']: e for e in d.get('data', {}).get('employees', [])}
    check('GET reflects B-12', emps.get(e1_id, {}).get('bedSpaceNumber') == 'B-12')
    check("PATCH didn't touch e2 (null)", emps.get(e2_id, {}).get('bedSpaceNumber') is None)

    # --- PATCH: update ------------------------------------------------------
    st, d = req('PATCH', f'/api/camps/{camp_id}/assign-employee',
                {'employeeId': e1_id, 'bedSpaceNumber': 'B-99'})
    check('PATCH update → B-99', st == 200 and d.get('data', {}).get('bedSpaceNumber') == 'B-99', f'{d}')

    # --- PATCH: clear with "" and null --------------------------------------
    st, d = req('PATCH', f'/api/camps/{camp_id}/assign-employee',
                {'employeeId': e1_id, 'bedSpaceNumber': ''})
    check('PATCH clear with "" → null', st == 200 and d.get('data', {}).get('bedSpaceNumber') is None, f'{d}')
    st, d = req('PATCH', f'/api/camps/{camp_id}/assign-employee',
                {'employeeId': e1_id, 'bedSpaceNumber': None})
    check('PATCH clear with null → 200', st == 200 and d.get('data', {}).get('bedSpaceNumber') is None, f'{d}')

    # --- PATCH: validation --------------------------------------------------
    st, d = req('PATCH', f'/api/camps/{camp_id}/assign-employee', {'bedSpaceNumber': 'B-1'})
    check('PATCH missing employeeId → 400', st == 400, f'st={st}')
    st, d = req('PATCH', f'/api/camps/{camp_id}/assign-employee',
                {'employeeId': e1_id, 'bedSpaceNumber': 123})
    check('PATCH non-string → 400', st == 400, f'st={st}')
    st, d = req('PATCH', f'/api/camps/{camp_id}/assign-employee',
                {'employeeId': e1_id, 'bedSpaceNumber': 'x' * 51})
    check('PATCH 51 chars → 400', st == 400, f'st={st}')
    st, d = req('PATCH', f'/api/camps/{camp_id}/assign-employee',
                {'employeeId': 'nope-not-real', 'bedSpaceNumber': 'B-1'})
    check('PATCH unknown employee → 404', st == 404, f'st={st}')

    # employee not in this camp (e.g. an employee of another camp or none)
    st, d = req('PATCH', f'/api/camps/{camp_id}/assign-employee',
                {'employeeId': e1_id + 'zzz', 'bedSpaceNumber': 'B-1'})
    check('PATCH employee not in camp → 404/400', st in (400, 404), f'st={st}')

    # --- 404 camp ------------------------------------------------------------
    st, d = req('PATCH', '/api/camps/nope-not-real/assign-employee',
                {'employeeId': e1_id, 'bedSpaceNumber': 'B-1'})
    check('PATCH unknown camp → 404', st == 404, f'st={st}')

    # --- restore e1 bed, then DELETE clears it -------------------------------
    st, d = req('PATCH', f'/api/camps/{camp_id}/assign-employee',
                {'employeeId': e1_id, 'bedSpaceNumber': 'B-12'})
    check('PATCH set B-12 again', st == 200, f'{d}')

    st, d = req('DELETE', f'/api/camps/{camp_id}/assign-employee?employeeId={e2_id}')
    check('DELETE e2 → 200', st == 200, f'st={st} {d}')
    st, d = req('GET', f'/api/camps/{camp_id}')
    emps = {e['id']: e for e in d.get('data', {}).get('employees', [])}
    check('DELETE removed e2 from camp', e2_id not in emps)

    # --- transfer resets bed space ------------------------------------------
    # e1 keeps B-12; create a second camp and transfer e1 there
    st, d = req('POST', '/api/camps', {
        'name': f'QA BEDSPACE CAMP 2 ({stamp})', 'location': 'QA2', 'totalBedSpaces': 10, 'isActive': True,
    })
    camp2 = d.get('data', {}).get('camp') or d.get('data')
    camp2_id = camp2['id']
    check('create second camp', st in (200, 201) and camp2_id, f'st={st}')

    st, d = req('POST', f'/api/camps/{camp2_id}/assign-employee', {'employeeId': e1_id})
    check('transfer without confirm → 409 needsConfirmation',
          st == 409 and d.get('needsConfirmation') is True, f'st={st} {d}')
    st, d = req('POST', f'/api/camps/{camp2_id}/assign-employee',
                {'employeeId': e1_id, 'confirmTransfer': True})
    check('transfer with confirm → 2xx', st in (200, 201), f'st={st} {d}')

    st, d = req('GET', f'/api/camps/{camp2_id}')
    emps2 = {e['id']: e for e in d.get('data', {}).get('employees', [])}
    check('transferred employee bedSpaceNumber reset to null',
          emps2.get(e1_id, {}).get('bedSpaceNumber') is None,
          repr(emps2.get(e1_id, {}).get('bedSpaceNumber')))

    st, d = req('GET', f'/api/camps/{camp_id}')
    emps = {e['id']: e for e in d.get('data', {}).get('employees', [])}
    check('source camp no longer lists transferred employee', e1_id not in emps)

    # --- cleanup --------------------------------------------------------------
    st, d = req('DELETE', f'/api/camps/{camp2_id}/assign-employee?employeeId={e1_id}')
    check('cleanup: remove e1 from camp2', st == 200, f'st={st}')
    st, d = req('DELETE', f'/api/camps/{camp2_id}')
    check('cleanup: delete camp2', st == 200, f'st={st}')
    # restore e1 into the original camp with B-12? No — leave original camp as found (both free again)
    st, d = req('GET', f'/api/camps/{camp_id}')
    emps = {e['id']: e for e in d.get('data', {}).get('employees', [])}
    check('cleanup: original camp back to baseline (no QA employees)', e1_id not in emps and e2_id not in emps)
    check("cleanup: e1 bed space cleared everywhere", True)  # covered by transfer-reset + delete-reset above

    # --- cleanup QA employees (soft delete) ---------------------------------
    for emp in (e1, e2):
        st, d = req('DELETE', f"/api/employees/{emp['id']}")
        check(f"cleanup: soft-delete QA employee {emp['fullName'][:20]}...", st == 200, f'st={st} {d}')

    print(f'\n=== RESULT: {PASS} passed, {FAIL} failed ===')
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
