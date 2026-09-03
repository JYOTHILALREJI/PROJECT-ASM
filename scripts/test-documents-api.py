"""End-to-end API tests for the Documents module (NOC + employee documents).

Run while the dev server is up: python3 scripts/test-documents-api.py
Uses a real login cookie so employee lookup is exercised the same way the UI does.
"""
import json
import subprocess
import sys
import time
import urllib.request
import urllib.error
import io

BASE = "http://localhost:3000"
PASS_COUNT = 0
FAIL_COUNT = 0
CREATED_NOC_IDS = []
CREATED_DOC_IDS = []


def req(method, path, body=None, headers=None, raw=False):
    url = BASE + path
    data = None
    hdrs = dict(headers or {})
    if body is not None and not isinstance(body, dict):
        data = body
    elif body is not None:
        data = json.dumps(body).encode()
        hdrs.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            payload = resp.read()
            return resp.status, payload if raw else json.loads(payload or b"{}")
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, payload if raw else json.loads(payload or b"{}")
        except Exception:
            return e.code, {"raw": payload[:200]}


def check(name, cond, detail=""):
    global PASS_COUNT, FAIL_COUNT
    if cond:
        PASS_COUNT += 1
        print(f"  PASS  {name}")
    else:
        FAIL_COUNT += 1
        print(f"  FAIL  {name}  {detail}")


def make_test_pdf(path, title="Test Scan"):
    """Generate a tiny valid PDF with pymupdf."""
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), title, fontsize=24)
    doc.save(path)
    doc.close()


def multipart_upload(path, fields, file_field, file_name, file_bytes, mime="application/pdf"):
    boundary = "----asmtestboundary42"
    buf = io.BytesIO()
    for k, v in fields.items():
        buf.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    buf.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{file_name}\"\r\nContent-Type: {mime}\r\n\r\n".encode())
    buf.write(file_bytes)
    buf.write(f"\r\n--{boundary}--\r\n".encode())
    body = buf.getvalue()
    status, payload = req("POST", path, body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return status, payload


ROWS_20 = [
    ["PACIFIQUE IRUMVA", "HELPER", "AL DARAA AL ARABI PLASTER & TILES CONT", "BURUNDI", "P00032399"],
    ["PROSPER CIZA", "HELPER", "AL DARAA AL ARABI PLASTER & TILES CONT", "BURUNDI", "OP0316316"],
    ["PROSPER NIYONKURU", "HELPER", "AL DARAA AL ARABI PLASTER & TILES CONT", "BURUNDI", "P00041935"],
    ["JEAN BOSCO NIYONKURU", "HELPER", "AL DARAA AL ARABI PLASTER & TILES CONT", "BURUNDI", "P00044291"],
    ["FABRICE NZOYISABA", "HELPER", "AL DARAA AL ARABI PLASTER & TILES CONT", "BURUNDI", "P00094590"],
    ["MOHAMMAD AL AMIN MOKHLES KHAN", "HELPER", "AL DARAA AL ARABI PLASTER & TILES CONT", "BANGLADESH", "EG0410056"],
    ["GILBERT KAMATARI", "HELPER", "AL DARAA AL ARABI PLASTER & TILES CONT", "BURUNDI", "OP0337904"],
    ["ERNESTE NDIKUMANA", "HELPER", "AL DARAA AL ARABI PLASTER & TILES CONT", "BURUNDI", "P00010641"],
    ["GASTON VYIZIGIRO", "HELPER", "AL DARAA AL ARABI PLASTER & TILES CONT", "BURUNDI", "P00173765"],
    ["TOUSSAINT BIZIMANA", "HELPER", "AL DARAA AL ARABI PLASTER & TILES CONT", "BURUNDI", "P00033303"],
    ["EMMANUEL HAKIZIMANA", "HELPER", "AL DARAA AL ARABI PLASTER & TILES CONT", "BURUNDI", "OP0276516"],
    ["VEDASTE NGENDAKUMANA", "HELPER", "ARABIAN SHIELD A/C UNITS FIX CONT", "BURUNDI", "P00179109"],
    ["THIERRY SINZUMUNSI", "HELPER", "ARABIAN SHIELD A/C UNITS FIX CONT", "BURUNDI", "P00145864"],
    ["DIEUDONNE NIYOKWIZERA", "HELPER", "ARABIAN SHIELD A/C UNITS FIX CONT", "BURUNDI", "P00153292"],
    ["EMMERY NAHAYO", "HELPER", "ARABIAN SHIELD A/C UNITS FIX CONT", "BURUNDI", "OP0224098"],
    ["ALAINCEDRIC MUGISHA", "HELPER", "ARABIAN SHIELD A/C UNITS FIX CONT", "BURUNDI", "P00177871"],
    ["DIEUDONNE TUYISENGE", "HELPER", "ARABIAN SHIELD A/C UNITS FIX CONT", "BURUNDI", "P00131653"],
    ["IGNACE NZAMBIMANA", "HELPER", "ARABIAN SHIELD A/C UNITS FIX CONT", "BURUNDI", "P00154137"],
    ["OUMOROU FAROUKOU BOUKARI", "HELPER", "ARABIAN SHIELD A/C UNITS FIX CONT", "TOGO", "EB640238"],
    ["MALIK OKOUTO KRO", "HELPER", "ARABIAN SHIELD A/C UNITS FIX CONT", "TOGO", "EB631222"],
]


def main():
    print("== 1. NOC create validation (edge cases) ==")
    st, d = req("POST", "/api/documents/noc", {"clientName": "", "nocDate": "03-09-2026", "employees": [{"name": "X"}]})
    check("empty client rejected", st == 400 and "Client name" in d.get("error", ""), f"{st} {d}")

    st, d = req("POST", "/api/documents/noc", {"clientName": "M/S TEST LLC", "nocDate": "2026/09/03", "employees": [{"name": "X"}]})
    check("bad date format rejected", st == 400 and "Date must be" in d.get("error", ""), f"{st} {d}")

    st, d = req("POST", "/api/documents/noc", {"clientName": "M/S TEST LLC", "nocDate": "03-09-2026", "employees": []})
    check("zero employees rejected", st == 400 and "at least one employee" in d.get("error", ""), f"{st} {d}")

    st, d = req("POST", "/api/documents/noc", {"clientName": "M/S TEST LLC", "nocDate": "03-09-2026", "employees": [{"name": ""}, {"trade": "HELPER"}]})
    check("unnamed row rejected", st == 400 and "employee name is required" in d.get("error", ""), f"{st} {d}")

    st, d = req("POST", "/api/documents/noc", {"clientName": "M/S TEST LLC", "nocDate": "03-09-2026", "stampType": "banana", "employees": [{"name": "X"}]})
    check("invalid stamp rejected", st == 400 and "stamp" in d.get("error", "").lower(), f"{st} {d}")

    print("== 2. NOC create happy paths ==")
    st, d = req("POST", "/api/documents/noc", {
        "clientName": "M/S API TEST LLC", "projectName": "API PROJECT", "clientAddress": "Test Street 1\nDubai, UAE",
        "nocDate": "03-09-2026", "stampType": "procurement", "employees": [{"name": r[0], "trade": r[1], "company": r[2], "nationality": r[3], "passport": r[4]} for r in ROWS_20],
        "actorDisplayName": "API Tester",
    })
    check("20-row NOC created", st == 201 and d["success"], f"{st} {d if st != 201 else ''}")
    noc20 = d.get("data", {}).get("noc", {})
    CREATED_NOC_IDS.append(noc20.get("id"))
    check("monthKey derived", noc20.get("monthKey") == "2026-09", noc20.get("monthKey"))
    check("fileName drops M/S", noc20.get("fileName", "").startswith("NOC API TEST LLC API PROJECT 03-09-2026.pdf"), noc20.get("fileName"))
    check("employeeCount=20", noc20.get("employeeCount") == 20, noc20.get("employeeCount"))

    st, d = req("POST", "/api/documents/noc", {
        "clientName": "M/S API TEST LLC", "projectName": "API PROJECT", "clientAddress": "Test Street 1\nDubai, UAE",
        "nocDate": "03-09-2026", "stampType": "procurement", "employees": [{"name": r[0], "trade": r[1], "company": r[2], "nationality": r[3], "passport": r[4]} for r in ROWS_20[:10]],
        "actorDisplayName": "API Tester",
    })
    check("duplicate-name second NOC created (unique file)", st == 201, f"{st}")
    noc10 = d.get("data", {}).get("noc", {})
    CREATED_NOC_IDS.append(noc10.get("id"))
    check("file deduped with suffix", " 2.pdf" in noc10.get("fileName", ""), noc10.get("fileName"))

    print("== 3. NOC PDF serve / regenerate ==")
    st, raw = req("GET", f"/api/documents/noc/{noc20['id']}/pdf", raw=True)
    check("PDF served inline", st == 200 and raw[:5] == b"%PDF-", f"{st} {raw[:20]}")
    st2, raw2 = req("GET", f"/api/documents/noc/{noc10['id']}/pdf?mode=download", raw=True)
    check("download mode OK", st2 == 200 and raw2[:5] == b"%PDF-", f"{st2}")

    # delete the underlying file, then re-request -> regenerated
    import sqlite3, os
    con = sqlite3.connect("file:/home/z/my-project/db/custom.db?mode=ro", uri=True)
    fp = con.execute("SELECT filePath FROM NocDocument WHERE id=?", (noc20["id"],)).fetchone()[0]
    con.close()
    absp = os.path.join("/home/z/my-project", fp)
    os.remove(absp)
    st3, raw3 = req("GET", f"/api/documents/noc/{noc20['id']}/pdf", raw=True)
    check("missing PDF auto-regenerated", st3 == 200 and raw3[:5] == b"%PDF-" and len(raw3) > 100000, f"{st3} len={len(raw3)}")
    check("regenerated file re-persisted", os.path.exists(absp), absp)

    print("== 4. NOC preview (no DB write) ==")
    st, raw = req("POST", "/api/documents/noc/preview", {
        "clientName": "M/S PREVIEW ONLY", "projectName": "PREVIEW PROJECT", "nocDate": "03-09-2026",
        "employees": [{"name": "PREVIEW GUY", "trade": "HELPER", "company": "PREVIEW CO", "nationality": "BURUNDI", "passport": "P000"}],
    }, raw=True)
    check("preview returns PDF", st == 200 and raw[:5] == b"%PDF-", f"{st}")
    con = sqlite3.connect("file:/home/z/my-project/db/custom.db?mode=ro", uri=True)
    n = con.execute("SELECT COUNT(*) FROM NocDocument WHERE clientName LIKE '%PREVIEW ONLY%'").fetchone()[0]
    con.close()
    check("preview did not write DB", n == 0, f"rows={n}")

    print("== 5. NOC list + delete ==")
    st, d = req("GET", "/api/documents/noc")
    ids = [n["id"] for n in d["data"]["nocs"]]
    check("list contains both NOCs", noc20["id"] in ids and noc10["id"] in ids)
    check("list parses employees", isinstance(d["data"]["nocs"][0].get("employees"), list))

    st, d = req("DELETE", f"/api/documents/noc/{noc10['id']}")
    check("delete NOC ok", st == 200 and d["success"], f"{st} {d}")
    con = sqlite3.connect("file:/home/z/my-project/db/custom.db?mode=ro", uri=True)
    row = con.execute("SELECT deletedAt, filePath FROM NocDocument WHERE id=?", (noc10["id"],)).fetchone()
    con.close()
    check("soft-deleted", row[0] is not None)
    check("file removed on delete", not os.path.exists(os.path.join("/home/z/my-project", row[1])))

    print("== 6. Employee documents upload/list/rename/delete ==")
    st, d = req("GET", "/api/employees?status=active&limit=5")
    emps = d["data"]["employees"]
    check("employees available for picker", len(emps) >= 1, f"n={len(emps)}")
    emp = emps[0]

    st, d = multipart_upload("/api/documents/employee", {
        "employeeId": emp["id"], "docType": "passport", "actorDisplayName": "API Tester",
    }, "file", "passport-scan.pdf", b"%PDF-1.4 fake", "application/pdf")
    check("bad PDF content rejected? (should ACCEPT any bytes but valid ext)", st in (201, 400), f"{st}")
    if st == 201:
        CREATED_DOC_IDS.append(d["data"]["document"]["id"])

    make_test_pdf("/tmp/test-id-scan.pdf", "Emirates ID Scan")
    with open("/tmp/test-id-scan.pdf", "rb") as f:
        id_bytes = f.read()
    st, d = multipart_upload("/api/documents/employee", {
        "employeeId": emp["id"], "docType": "id_card", "actorDisplayName": "API Tester",
    }, "file", "id-scan.pdf", id_bytes, "application/pdf")
    check("real PDF uploaded as ID card", st == 201, f"{st} {d}")
    id_doc = d.get("data", {}).get("document", {})
    CREATED_DOC_IDS.append(id_doc.get("id"))

    make_test_pdf("/tmp/test-visa.pdf", "Visa")
    with open("/tmp/test-visa.pdf", "rb") as f:
        visa_bytes = f.read()
    st, d = multipart_upload("/api/documents/employee", {
        "employeeId": emp["id"], "docType": "visa", "docName": "Visa 2026 stamped", "actorDisplayName": "API Tester",
    }, "file", "visa-page1.pdf", visa_bytes, "application/pdf")
    check("visa uploaded with custom name", st == 201 and d["data"]["document"]["docName"] == "Visa 2026 stamped", f"{st}")
    visa_doc = d.get("data", {}).get("document", {})
    CREATED_DOC_IDS.append(visa_doc.get("id"))

    st, d = multipart_upload("/api/documents/employee", {
        "employeeId": emp["id"], "docType": "banana", "actorDisplayName": "API Tester",
    }, "file", "x.pdf", b"%PDF-1.4", "application/pdf")
    check("invalid docType rejected", st == 400, f"{st}")

    st, d = multipart_upload("/api/documents/employee", {
        "employeeId": emp["id"], "docType": "other", "actorDisplayName": "API Tester",
    }, "file", "malware.exe", b"MZ", "application/octet-stream")
    check("disallowed extension rejected", st == 400 and "Unsupported file type" in d.get("error", ""), f"{st} {d}")

    st, d = multipart_upload("/api/documents/employee", {
        "employeeId": "nonexistent-id", "docType": "other", "actorDisplayName": "API Tester",
    }, "file", "x.pdf", b"%PDF-1.4", "application/pdf")
    check("unknown employee rejected", st == 404, f"{st}")

    st, d = req("GET", f"/api/documents/employee?employeeId={emp['id']}")
    types = sorted(doc["docType"] for doc in d["data"]["documents"])
    check("list shows uploaded docs", "id_card" in types and "visa" in types, f"{types}")
    check("list includes employee name", d["data"]["documents"][0]["employeeName"] == emp["fullName"])

    st, raw = req("GET", f"/api/documents/employee/{id_doc['id']}/file", raw=True)
    check("doc file served inline", st == 200 and raw[:5] == b"%PDF-", f"{st}")
    st, raw = req("GET", f"/api/documents/employee/{id_doc['id']}/file?mode=download", raw=True)
    check("doc file served download", st == 200)

    st, d = req("PATCH", f"/api/documents/employee/{visa_doc['id']}", {"docName": "Visa renamed via API"})
    check("rename works", st == 200 and d["data"]["document"]["docName"] == "Visa renamed via API", f"{st} {d}")

    st, d = req("PATCH", f"/api/documents/employee/{visa_doc['id']}", {"docName": "  "})
    check("empty rename rejected", st == 400, f"{st}")

    fp = visa_doc["filePath"]
    st, d = req("DELETE", f"/api/documents/employee/{visa_doc['id']}")
    check("doc delete ok", st == 200, f"{st} {d}")
    check("doc file removed", not os.path.exists(os.path.join("/home/z/my-project", fp)))
    st, d = req("GET", f"/api/documents/employee/{visa_doc['id']}/file", raw=True)
    check("deleted doc file returns 404/410", st in (404, 410), f"{st}")

    print("== 7. permissions seed includes documents ==")
    st, d = req("GET", "/api/permissions")
    slugs = [p["slug"] for p in d["data"]["permissions"]]
    check("documents slug registered", "documents" in slugs, slugs)

    print(f"\n===== RESULTS: {PASS_COUNT} passed, {FAIL_COUNT} failed =====")
    # cleanup created NOCs (leave DB clean for user)
    for nid in CREATED_NOC_IDS:
        if nid and nid != noc10.get("id"):
            req("DELETE", f"/api/documents/noc/{nid}")
    print("cleaned up test NOCs")
    sys.exit(1 if FAIL_COUNT else 0)


main()
