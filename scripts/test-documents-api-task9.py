#!/usr/bin/env python3
"""
Task 9 API tests — Documents upgrades:
  1. NOC list views: stats / recent / list pagination + search / folders / month
  2. Stamp toggle on a FINAL NOC (stampUpdate PATCH) with PDF regeneration
  3. Stamps CRUD (list, upload, default, delete)
  4. Companies CRUD (list, create, dupe guard, delete)
  5. NOC create with companyId + stampEnabled/stampId
  6. Employee directory: view=employees pagination + search + with_docs filter
Run against a live dev server (default http://localhost:3000).
"""
import io
import json
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:3000"
COOKIE = None

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

def req(method, path, data=None, headers=None, raw_body=None):
    """Returns (status, headers, body_bytes or parsed json dict/list)."""
    global COOKIE
    url = BASE + path
    hdrs = dict(headers or {})
    if COOKIE:
        hdrs["Cookie"] = COOKIE
    body = None
    if raw_body is not None:
        body = raw_body
    elif data is not None:
        body = json.dumps(data).encode()
        hdrs.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        resp = urllib.request.urlopen(r)
        set_cookie = resp.headers.get("Set-Cookie")
        if set_cookie:
            COOKIE = set_cookie.split(";")[0]
        content = resp.read()
        status = resp.status
        rh = dict(resp.headers)
    except urllib.error.HTTPError as e:
        content = e.read()
        status = e.code
        rh = dict(e.headers)
    try:
        parsed = json.loads(content.decode())
    except Exception:
        parsed = None
    # case-insensitive header dict
    rh_lower = {k.lower(): v for k, v in rh.items()}
    return status, rh_lower, parsed if parsed is not None else content

def login():
    status, _, data = req("POST", "/api/auth/login", {"email": "admin@asm.com", "password": "admin123"})
    assert status == 200 and data.get("success"), f"login failed: {status} {data}"
    print("logged in as admin@asm.com")

def make_pdf_bytes():
    # minimal valid PDF for upload endpoints
    return b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n9\n%%EOF"

def multipart(fields, files):
    boundary = "----asmtestboundary42"
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    for k, (fname, content, ctype) in files.items():
        out.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n\r\n".encode())
        out.write(content)
        out.write(b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), {"Content-Type": f"multipart/form-data; boundary={boundary}"}

def cleanup_leftovers():
    """Remove QA artifacts from any previous crashed run and restore state."""
    # previous NOCs
    st, _, data = req("GET", "/api/documents/noc?view=list&search=" + urllib.request.quote("QA STAMP CLIENT") + "&pageSize=50")
    if st == 200 and data.get("success"):
        for n in data["data"]["nocs"]:
            if n["clientName"] == "QA STAMP CLIENT LLC":
                req("DELETE", f"/api/documents/noc/{n['id']}?actorDisplayName=QA")
                print(f"  cleanup: removed leftover NOC {n['nocNumber']}")
    # previous stamp + company
    st, _, data = req("GET", "/api/documents/stamps")
    if st == 200 and data.get("success"):
        for s in data["data"]["stamps"]:
            if s["name"].startswith("Test Stamp QA"):
                req("DELETE", f"/api/documents/stamps/{s['id']}?actorDisplayName=QA")
                print(f"  cleanup: removed leftover stamp {s['name']}")
    st, _, data = req("GET", "/api/documents/companies")
    if st == 200 and data.get("success"):
        for c in data["data"]["companies"]:
            if c["name"] == "QA SECOND COMPANY LLC":
                req("DELETE", f"/api/documents/companies/{c['id']}?actorDisplayName=QA")
                print("  cleanup: removed leftover company")
    # restore the procurement stamp as the default (previous runs may have moved it)
    st, _, data = req("GET", "/api/documents/stamps")
    if st == 200 and data.get("success"):
        proc = next((s for s in data["data"]["stamps"] if s["name"] == "Procurement stamp"), None)
        if proc and not proc["isDefault"]:
            req("PATCH", f"/api/documents/stamps/{proc['id']}", {"isDefault": True})
            print("  cleanup: restored Procurement stamp as default")

def main():
    login()
    cleanup_leftovers()

    print("\n== 1. stamps API ==")
    st, _, data = req("GET", "/api/documents/stamps")
    check("GET stamps 200", st == 200 and data["success"])
    stamps = data["data"]["stamps"]
    check("2 seeded builtin stamps", len(stamps) >= 2, str(len(stamps)))
    proc = next((s for s in stamps if s["name"] == "Procurement stamp"), None)
    sig = next((s for s in stamps if s["name"] == "Signature stamp"), None)
    check("procurement is default", proc and proc["isDefault"])

    # stamp image serving
    st, rh, img = req("GET", f"/api/documents/stamps/{proc['id']}/image")
    check("stamp image served", st == 200 and str(rh.get("content-type", "")).startswith("image/"))

    # upload a new stamp
    body, hdrs = multipart({"name": "Test Stamp QA", "isDefault": "0", "actorDisplayName": "QA"}, {"file": ("stamp-qa.png", make_pdf_bytes(), "image/png")})
    st, _, data = req("POST", "/api/documents/stamps", raw_body=body, headers=hdrs)
    check("POST stamp upload 201", st == 201 and data["success"], str(data))
    qa_stamp = data["data"]["stamp"]
    st, _, img = req("GET", f"/api/documents/stamps/{qa_stamp['id']}/image")
    check("uploaded stamp image retrievable", st == 200)

    # rename + set default
    st, _, data = req("PATCH", f"/api/documents/stamps/{qa_stamp['id']}", {"name": "Test Stamp QA2", "isDefault": True})
    check("PATCH stamp rename+default", st == 200 and data["data"]["stamp"]["name"] == "Test Stamp QA2" and data["data"]["stamp"]["isDefault"])
    st, _, data = req("GET", "/api/documents/stamps")
    check("only one default stamp", sum(1 for s in data["data"]["stamps"] if s["isDefault"]) == 1)

    # invalid upload ext
    body, hdrs = multipart({"name": "Bad Ext"}, {"file": ("evil.exe", b"MZ", "application/x-msdownload")})
    st, _, data = req("POST", "/api/documents/stamps", raw_body=body, headers=hdrs)
    check("stamp upload rejects .exe", st == 400)

    print("\n== 2. companies API ==")
    st, _, data = req("GET", "/api/documents/companies")
    check("GET companies 200", st == 200 and data["success"])
    companies = data["data"]["companies"]
    check("default company seeded", any(c["name"] == "ARABIAN SHIELD A/C. UNITS FIX. CONT" for c in companies))

    st, _, data = req("POST", "/api/documents/companies", {"name": "QA SECOND COMPANY LLC", "contactPerson": "QA Manager", "contactPhone": "050 000 0000", "contactEmail": "qa@second.com"})
    check("POST company 201", st == 201 and data["success"], str(data))
    qa_company = data["data"]["company"]
    st, _, data = req("POST", "/api/documents/companies", {"name": "QA SECOND COMPANY LLC"})
    check("dupe company name rejected 409", st == 409)
    st, _, data = req("POST", "/api/documents/companies", {"name": "AB"})
    check("short company name rejected", st == 400)

    print("\n== 3. NOC create with company + stamp off (draft) ==")
    draft_payload = {
        "clientName": "QA STAMP CLIENT LLC",
        "projectName": "QA PROJECT",
        "nocDate": "15-09-2026",
        "companyId": qa_company["id"],
        "stampEnabled": False,
        "status": "draft",
        "employees": [{"name": "QA EMPLOYEE ONE", "trade": "HELPER", "company": "ASM", "nationality": "INDIA", "passport": "QA000001"}],
    }
    st, _, data = req("POST", "/api/documents/noc", draft_payload)
    check("POST draft 201", st == 201 and data["success"], str(data))
    draft = data["data"]["noc"]
    check("draft stampEnabled false", draft["stampEnabled"] is False)
    check("draft companyId stored", draft["companyId"] == qa_company["id"])

    print("\n== 4. finalize → stamp toggle on FINAL ==")
    st, _, data = req("PATCH", f"/api/documents/noc/{draft['id']}", {**draft_payload, "status": "final", "stampEnabled": False})
    check("finalize 200", st == 200 and data["success"], str(data))
    noc = data["data"]["noc"]
    check("final status", noc["status"] == "final")
    check("final stampEnabled false (opt-in)", noc["stampEnabled"] is False)

    # PDF must exist and have NO stamp → verify via page text (no Procurement box) — check page count & served OK
    st, rh, pdf = req("GET", f"/api/documents/noc/{noc['id']}/pdf?mode=inline")
    check("final PDF served", st == 200 and "application/pdf" in str(rh.get("content-type", "")) and isinstance(pdf, bytes) and len(pdf) > 1000, f"st={st} ct={rh.get('content-type')} len={len(pdf) if isinstance(pdf, bytes) else pdf}")

    # apply stamp via stampUpdate
    st, _, data = req("PATCH", f"/api/documents/noc/{noc['id']}", {"stampUpdate": True, "stampEnabled": True, "stampId": proc["id"], "actorDisplayName": "QA"})
    check("stampUpdate apply 200", st == 200 and data["success"], str(data))
    check("stampEnabled now true", data["data"]["noc"]["stampEnabled"] is True)
    st, _, data = req("GET", f"/api/documents/noc/{noc['id']}")
    check("detail shows stampName", data["data"]["noc"]["stampName"] == "Procurement stamp")

    # switch which stamp
    st, _, data = req("PATCH", f"/api/documents/noc/{noc['id']}", {"stampUpdate": True, "stampEnabled": True, "stampId": sig["id"], "actorDisplayName": "QA"})
    check("stampUpdate switch stamp 200", st == 200 and data["success"])
    st, _, data = req("GET", f"/api/documents/noc/{noc['id']}")
    check("stampName switched", data["data"]["noc"]["stampName"] == "Signature stamp")

    # remove stamp again
    st, _, data = req("PATCH", f"/api/documents/noc/{noc['id']}", {"stampUpdate": True, "stampEnabled": False, "stampId": None, "actorDisplayName": "QA"})
    check("stampUpdate remove 200", st == 200 and data["success"])
    check("stampEnabled false again", data["data"]["noc"]["stampEnabled"] is False)

    # stampUpdate with a deleted/nonexistent stamp → 400
    st, _, data = req("PATCH", f"/api/documents/noc/{noc['id']}", {"stampUpdate": True, "stampEnabled": True, "stampId": "nonexistent-id"})
    check("stampUpdate bad stamp 400", st == 400)

    # other edits to final still 409
    st, _, data = req("PATCH", f"/api/documents/noc/{noc['id']}", {"clientName": "CHANGED"})
    check("final non-stamp PATCH still 409", st == 409)

    print("\n== 5. list views + pagination ==")
    st, _, data = req("GET", "/api/documents/noc?view=stats")
    check("view=stats", st == 200 and {"totalFinal", "thisMonth", "drafts", "employeesWithDocuments"} <= set(data["data"].keys()))
    st, _, data = req("GET", "/api/documents/noc?view=recent&limit=3")
    check("view=recent", st == 200 and len(data["data"]["nocs"]) <= 3)
    st, _, data = req("GET", "/api/documents/noc?view=list&page=1&pageSize=2")
    check("view=list paginated", st == 200 and data["data"]["pageSize"] == 2 and len(data["data"]["nocs"]) <= 2 and "totalPages" in data["data"])
    light = data["data"]["nocs"]
    check("light rows have no employeesJson", all("employees" not in n for n in light))
    st, _, data = req("GET", "/api/documents/noc?view=list&search=" + urllib.request.quote("QA STAMP CLIENT"))
    check("view=list search hits", st == 200 and data["data"]["total"] >= 1)
    st, _, data = req("GET", "/api/documents/noc?view=list&search=" + urllib.request.quote("QA000001"))
    check("view=list searches employeesJson", st == 200 and data["data"]["total"] >= 1)
    st, _, data = req("GET", "/api/documents/noc?view=folders")
    check("view=folders groups", st == 200 and isinstance(data["data"]["clients"], list))
    qa_client = next((c for c in data["data"]["clients"] if c["clientName"] == "QA STAMP CLIENT LLC"), None)
    check("folders include QA client", qa_client is not None)
    if qa_client:
        month = qa_client["years"][0]["months"][0]["monthKey"]
        st, _, data = req("GET", f"/api/documents/noc?view=month&client=QA%20STAMP%20CLIENT%20LLC&month={month}&page=1&pageSize=10")
        check("view=month records", st == 200 and data["data"]["total"] >= 1 and len(data["data"]["nocs"]) >= 1)
    st, _, data = req("GET", "/api/documents/noc?view=month")
    check("view=month requires params 400", st == 400)

    print("\n== 6. employee directory ==")
    st, _, data = req("GET", "/api/documents/employee?view=employees&page=1&pageSize=5")
    check("view=employees paginated", st == 200 and data["success"] and data["data"]["pageSize"] == 5, str(data)[:200])
    check("employees carry docCounts", all("docCounts" in e for e in data["data"]["employees"]))
    total_employees = data["data"]["total"]
    check("total matches totalPages math", data["data"]["totalPages"] == max((total_employees + 4) // 5, 1))

    # search
    st, _, all_data = req("GET", "/api/documents/employee?view=employees&page=1&pageSize=5")
    if all_data["data"]["employees"]:
        first = all_data["data"]["employees"][0]
        probe = first["fullName"][:4]
        st, _, sdata = req("GET", f"/api/documents/employee?view=employees&search={urllib.request.quote(probe)}")
        check("employee search finds", st == 200 and sdata["data"]["total"] >= 1)

    # upload a doc for the first employee then check with_docs filter + per-employee listing
    if all_data["data"]["employees"]:
        emp = all_data["data"]["employees"][0]
        body, hdrs = multipart({
            "employeeId": emp["id"], "docType": "passport", "docName": "QA Passport",
            "actorDisplayName": "QA", "actorUserId": "",
        }, {"file": ("qa-pass.pdf", make_pdf_bytes(), "application/pdf")})
        st, _, up = req("POST", "/api/documents/employee", raw_body=body, headers=hdrs)
        check("upload employee doc 201", st == 201 and up["success"], str(up)[:200])
        doc_id = up["data"]["document"]["id"]

        st, _, wdata = req("GET", "/api/documents/employee?view=employees&filter=with_docs&page=1&pageSize=5")
        check("with_docs filter", st == 200 and all(e["docCounts"]["total"] > 0 for e in wdata["data"]["employees"]))

        st, _, edata = req("GET", f"/api/documents/employee?employeeId={emp['id']}")
        check("per-employee docs listing", st == 200 and any(d["id"] == doc_id for d in edata["data"]["documents"]))

        # cleanup: delete the test doc
        st, _, del_data = req("DELETE", f"/api/documents/employee/{doc_id}")
        check("delete test doc", st == 200 and del_data["success"])

    print("\n== 7. cleanup QA artifacts ==")
    st, _, _ = req("DELETE", f"/api/documents/noc/{noc['id']}?actorDisplayName=QA")
    check("delete QA final NOC", st == 200)
    st, _, _ = req("DELETE", f"/api/documents/companies/{qa_company['id']}?actorDisplayName=QA")
    check("delete QA company", st == 200)
    st, _, _ = req("DELETE", f"/api/documents/stamps/{qa_stamp['id']}?actorDisplayName=QA")
    check("delete QA stamp", st == 200)
    # restore procurement as default
    req("PATCH", f"/api/documents/stamps/{proc['id']}", {"isDefault": True})

    print(f"\n=========================\nRESULT: {PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0

if __name__ == "__main__":
    sys.exit(main())
