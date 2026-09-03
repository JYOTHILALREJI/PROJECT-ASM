#!/usr/bin/env python3
"""
Task 10 API tests — spec hardening:
  1. DELETE response contract: {success:true, id} + 404 {code:"NOC_NOT_FOUND"}
  2. Original as-issued PDF preserved: finalize with stamp -> originalFilePath
     (unstamped) + filePath (stamped) BOTH exist on disk (spec §37)
  3. Stamp switch on a final NOC keeps the original untouched
  4. Stamp removal on a final NOC reverts the active rendition to the original
  5. currentStep persisted on draft save + returned by GET detail (§28)
  6. Finalize without stamp: filePath == originalFilePath (one plain file)
  7. Database indexes present (§41)
Run against a live dev server (default http://localhost:3000).
"""
import json
import os
import sqlite3
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:3000"
COOKIE = None
ROOT = "/home/z/my-project"

PASS = 0
FAIL = 0
def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name} {extra}")

def req(method, path, data=None, headers=None):
    global COOKIE
    url = BASE + path
    hdrs = dict(headers or {})
    if COOKIE:
        hdrs["Cookie"] = COOKIE
    body = json.dumps(data).encode() if data is not None else None
    if data is not None:
        hdrs.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        resp = urllib.request.urlopen(r)
        set_cookie = resp.headers.get("Set-Cookie")
        if set_cookie:
            COOKIE = set_cookie.split(";")[0]
        content = resp.read()
        status = resp.status
    except urllib.error.HTTPError as e:
        content = e.read()
        status = e.code
    try:
        parsed = json.loads(content.decode())
    except Exception:
        parsed = None
    return status, parsed

EMP = [
    {"name": "QA TASK10 WORKER ONE", "trade": "HELPER", "company": "ARABIAN SHIELD", "nationality": "BURUNDI", "passport": "T10A00001"},
    {"name": "QA TASK10 WORKER TWO", "trade": "MASON", "company": "ARABIAN SHIELD", "nationality": "BURUNDI", "passport": "T10A00002"},
]

def main():
    login()

    # ── stamps for the switch test ──
    st, data = req("GET", "/api/documents/stamps")
    stamps = data["data"]["stamps"] if st == 200 and data.get("success") else []
    check("stamp library available", len(stamps) >= 1, str(len(stamps)))
    stamp_a = stamps[0]["id"]
    stamp_b = stamps[1]["id"] if len(stamps) > 1 else stamp_a

    print("\n── 1. currentStep persistence on drafts (§28) ──")
    st, data = req("POST", "/api/documents/noc", {
        "status": "draft", "clientName": "QA T10 STEP CLIENT LLC", "projectName": "STEP PROJECT",
        "nocDate": "15-09-2026", "currentStep": 3, "employees": EMP[:1],
    })
    check("create draft with currentStep=3", st in (200, 201) and data.get("success"), f"{st} {data}")
    draft = data["data"]["noc"]
    st, data = req("GET", f"/api/documents/noc/{draft['id']}")
    check("GET detail returns currentStep=3", data and data["data"]["noc"].get("currentStep") == 3, str(data and data["data"]["noc"].get("currentStep")))
    st, data = req("PATCH", f"/api/documents/noc/{draft['id']}", {
        "clientName": "QA T10 STEP CLIENT LLC", "nocDate": "15-09-2026", "currentStep": 2, "employees": EMP,
    })
    check("PATCH draft with currentStep=2", st == 200 and data.get("success"), f"{st} {data}")
    st, data = req("GET", f"/api/documents/noc/{draft['id']}")
    check("resume point updated to 2", data["data"]["noc"]["currentStep"] == 2, str(data["data"]["noc"].get("currentStep")))

    print("\n── 2. DELETE response contract (§23) ──")
    st, data = req("DELETE", f"/api/documents/noc/{draft['id']}")
    check("DELETE returns success+id", st == 200 and data.get("success") and data.get("id") == draft["id"], f"{st} {data}")
    st, data = req("DELETE", f"/api/documents/noc/{draft['id']}")
    check("repeat DELETE -> 404 with code NOC_NOT_FOUND", st == 404 and data and data.get("code") == "NOC_NOT_FOUND", f"{st} {data}")
    st, data = req("GET", f"/api/documents/noc/{draft['id']}")
    check("GET deleted draft -> 404", st == 404, str(st))

    print("\n── 3. finalize WITH stamp: original + stamped renditions (§37) ──")
    st, data = req("POST", "/api/documents/noc", {
        "status": "final", "clientName": "QA T10 RENDITION CLIENT LLC", "projectName": "RENDITION PROJECT",
        "nocDate": "16-09-2026", "stampEnabled": True, "stampId": stamp_a, "employees": EMP,
    })
    check("finalize with stamp", st in (200, 201) and data.get("success"), f"{st} {data}")
    noc = data["data"]["noc"]
    st, data = req("GET", f"/api/documents/noc/{noc['id']}")
    detail = data["data"]["noc"]
    fp, ofp = detail.get("filePath"), detail.get("originalFilePath")
    check("originalFilePath set (unstamped original)", bool(ofp), str(ofp))
    check("active rendition differs from original when stamped", fp and ofp and fp != ofp, f"{fp} vs {ofp}")
    check("original file name is plain", ofp and "(stamped)" not in ofp, str(ofp))
    check("active file name carries (stamped)", fp and "(stamped)" in fp, str(fp))
    check("original file exists on disk", ofp and os.path.exists(os.path.join(ROOT, ofp)), str(ofp))
    check("stamped file exists on disk", fp and os.path.exists(os.path.join(ROOT, fp)), str(fp))
    st, headers2 = req("GET", f"/api/documents/noc/{noc['id']}/pdf?mode=inline")
    check("PDF serves for stamped final", st == 200, str(st))

    print("\n── 4. stamp SWITCH keeps the original untouched (§37) ──")
    orig_size = os.path.getsize(os.path.join(ROOT, ofp))
    st, data = req("PATCH", f"/api/documents/noc/{noc['id']}", {"stampUpdate": True, "stampEnabled": True, "stampId": stamp_b})
    check("switch stamp A->B", st == 200 and data.get("success"), f"{st} {data}")
    st, data = req("GET", f"/api/documents/noc/{noc['id']}")
    d2 = data["data"]["noc"]
    check("originalFilePath unchanged after switch", d2.get("originalFilePath") == ofp, f"{d2.get('originalFilePath')} vs {ofp}")
    check("original file bytes untouched", os.path.getsize(os.path.join(ROOT, ofp)) == orig_size)
    check("stamped rendition updated", d2.get("filePath") != fp, f"{d2.get('filePath')} vs {fp}")
    check("old stamped rendition removed (no orphan)", os.path.exists(os.path.join(ROOT, fp)) == False, str(fp))
    fp = d2.get("filePath")

    print("\n── 5. stamp REMOVAL reverts to the byte-identical original (§37) ──")
    st, data = req("PATCH", f"/api/documents/noc/{noc['id']}", {"stampUpdate": True, "stampEnabled": False})
    check("remove stamp on final", st == 200 and data.get("success"), f"{st} {data}")
    st, data = req("GET", f"/api/documents/noc/{noc['id']}")
    d3 = data["data"]["noc"]
    check("active rendition reverted to original", d3.get("filePath") == d3.get("originalFilePath") == ofp, f"{d3.get('filePath')} / {d3.get('originalFilePath')}")
    check("original still on disk", os.path.exists(os.path.join(ROOT, ofp)))
    check("stamped rendition cleaned up", os.path.exists(os.path.join(ROOT, fp)) == False, str(fp))
    st, _ = req("GET", f"/api/documents/noc/{noc['id']}/pdf?mode=inline")
    check("PDF still serves after removal", st == 200)

    print("\n── 6. stamp RE-APPLY on the same final ──")
    st, data = req("PATCH", f"/api/documents/noc/{noc['id']}", {"stampUpdate": True, "stampEnabled": True, "stampId": stamp_a})
    check("re-apply stamp later (§9)", st == 200 and data.get("success"), f"{st} {data}")
    st, data = req("GET", f"/api/documents/noc/{noc['id']}")
    d4 = data["data"]["noc"]
    check("original STILL preserved", d4.get("originalFilePath") == ofp and os.path.exists(os.path.join(ROOT, ofp)), str(d4.get("originalFilePath")))
    check("stamped rendition active again", d4.get("filePath") != d4.get("originalFilePath"), str(d4.get("filePath")))

    print("\n── 7. finalize WITHOUT stamp: single plain file ──")
    st, data = req("POST", "/api/documents/noc", {
        "status": "final", "clientName": "QA T10 PLAIN CLIENT LLC", "projectName": "PLAIN PROJECT",
        "nocDate": "16-09-2026", "stampEnabled": False, "employees": EMP[:1],
    })
    check("finalize without stamp", st in (200, 201) and data.get("success"), f"{st} {data}")
    plain = data["data"]["noc"]
    st, data = req("GET", f"/api/documents/noc/{plain['id']}")
    pd = data["data"]["noc"]
    check("filePath == originalFilePath (no stamp)", pd.get("filePath") == pd.get("originalFilePath"), f"{pd.get('filePath')} vs {pd.get('originalFilePath')}")
    check("plain file exists", pd.get("filePath") and os.path.exists(os.path.join(ROOT, pd["filePath"])))

    print("\n── 8. DELETE removes BOTH renditions + page-edge data ──")
    st, data = req("DELETE", f"/api/documents/noc/{noc['id']}")
    check("delete rendition NOC", st == 200 and data.get("id") == noc["id"], f"{st} {data}")
    check("original file removed from disk", os.path.exists(os.path.join(ROOT, ofp)) == False, str(ofp))
    st, data = req("DELETE", f"/api/documents/noc/{plain['id']}")
    check("delete plain NOC", st == 200 and data.get("id") == plain["id"], f"{st} {data}")
    check("plain file removed from disk", os.path.exists(os.path.join(ROOT, pd["filePath"])) == False)
    st, data = req("GET", "/api/documents/noc?view=list&page=1&pageSize=10")
    check("list still consistent after deletes", st == 200 and data["data"]["totalPages"] >= 1)

    print("\n── 9. database indexes (§41) ──")
    con = sqlite3.connect(f"file:{ROOT}/db/custom.db?mode=ro", uri=True)
    cur = con.cursor()
    def has_index(table, col):
        rows = cur.execute(f'PRAGMA index_list("{table}")').fetchall()
        for idx in rows:
            idx_name = idx[1]
            cols = [r[2] for r in cur.execute(f'PRAGMA index_info("{idx_name}")').fetchall()]
            if cols == [col]:
                return True
        return False
    check("NocDocument.status indexed", has_index("NocDocument", "status"))
    check("NocDocument.nocDate indexed", has_index("NocDocument", "nocDate"))
    check("NocDocument.clientName indexed", has_index("NocDocument", "clientName"))
    check("NocDocument.monthKey indexed", has_index("NocDocument", "monthKey"))
    check("Employee.fullName indexed", has_index("Employee", "fullName"))
    check("Employee.passportNumber indexed", has_index("Employee", "passportNumber"))
    check("Employee.companyName indexed", has_index("Employee", "companyName"))
    check("EmployeeDocument.expiryDate indexed", has_index("EmployeeDocument", "expiryDate"))
    con.close()

    print(f"\n══════ RESULT: {PASS} passed, {FAIL} failed ══════")
    sys.exit(1 if FAIL else 0)

def login():
    st, data = req("POST", "/api/auth/login", {"email": "admin@asm.com", "password": "admin123"})
    assert st == 200 and data.get("success"), f"login failed: {st} {data}"
    print("logged in as admin@asm.com")

if __name__ == "__main__":
    main()
