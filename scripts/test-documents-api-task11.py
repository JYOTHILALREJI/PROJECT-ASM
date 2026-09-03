#!/usr/bin/env python3
"""
Task 11 API tests — NOC ZIP package + stamp hardening + cleanup:
  1. Latest-valid-document resolver (old vs new passport → newest in ZIP)  §10-11,§53,§61
  2. Package structure: outer ZIP = NOC PDF + per-employee ZIPs            §23
  3. Normalized document names (Passport.pdf / Visa.pdf)                   §4,§22
  4. Missing documents never block (placeholder employee ZIP)              §18
  5. Duplicate employee names get a deterministic suffix                   §21
  6. Stamp/company validation: INVALID_STAMP_FOR_COMPANY                   §32
  7. stampRect persisted after stamping (§36-38 shared FE/BE geometry)
  8. Magic-byte upload validation (fake PDF rejected)                      §5-6
  9. Cleanup report marks replaced duplicates (§13-14,§64)
Run against a live dev server (default http://localhost:3000).
"""
import io
import json
import sys
import urllib.request
import urllib.error
import zipfile

BASE = "http://localhost:3000"

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
    url = BASE + path
    hdrs = dict(headers or {})
    body = raw_body
    if data is not None:
        body = json.dumps(data).encode()
        hdrs.setdefault("Content-Type", "application/json")
    r = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        resp = urllib.request.urlopen(r)
        content = resp.read()
        status = resp.status
    except urllib.error.HTTPError as e:
        content = e.read()
        status = e.code
    try:
        parsed = json.loads(content.decode())
    except Exception:
        parsed = None
    return status, parsed, content

def multipart(fields, files):
    boundary = "----asmtest11boundary"
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    for k, (fname, content, ctype) in files.items():
        out.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n\r\n".encode())
        out.write(content)
        out.write(b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), {"Content-Type": f"multipart/form-data; boundary={boundary}"}

def mini_pdf(marker: str) -> bytes:
    """Minimal valid PDF whose bytes carry a distinctive marker."""
    return (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n"
        b"4 0 obj<</Length 44>>stream\nBT /F1 12 Tf (" + marker.encode() + b") Tj ET\nendstream endobj\n"
        b"xref\n0 5\ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n9\n%%EOF" + marker.encode() + b"\n"
    )

def main():
    # login (session cookie if the API uses one)
    st, _, _ = req("POST", "/api/auth/login", {"email": "admin@asm.com", "password": "admin123"})
    print("login:", st)

    # ── pre-clean leftovers from any crashed previous run ──
    st, data, _ = req("GET", "/api/documents/companies")
    for c in data.get("data", {}).get("companies", []):
        if c["name"].startswith("QA11"):
            req("DELETE", f"/api/documents/companies/{c['id']}?actorDisplayName=QA11")
    st, data, _ = req("GET", "/api/documents/stamps")
    for s in data.get("data", {}).get("stamps", []):
        if s["name"].startswith("QA11"):
            req("DELETE", f"/api/documents/stamps/{s['id']}?actorDisplayName=QA11")
    st, data, _ = req("GET", "/api/documents/noc?view=list&pageSize=50")
    for n in data.get("data", {}).get("nocs", []):
        if n["clientName"].startswith("QA11"):
            req("DELETE", f"/api/documents/noc/{n['id']}?actorDisplayName=QA11")

    uploaded_doc_ids = []

    # ── employees in DB ──
    st, data, _ = req("GET", "/api/employees?search=John&status=active&limit=5")
    john = (data.get("data", {}).get("employees") or [{}])[0]
    st, data, _ = req("GET", "/api/employees?search=Jyothi&status=active&limit=5")
    jyothi = (data.get("data", {}).get("employees") or [{}])[0]
    check("test employees found", bool(john.get("id")) and bool(jyothi.get("id")), f"{john.get('id')} {jyothi.get('id')}")

    # leftover test documents from crashed runs (by exact docName)
    for emp_id in (john.get("id"), jyothi.get("id")):
        if not emp_id:
            continue
        st, data, _ = req("GET", f"/api/documents/employee?employeeId={emp_id}")
        for d in data.get("data", {}).get("documents", []):
            if d.get("docName") in ("Passport OLD", "Passport NEW", "Visa scan"):
                req("DELETE", f"/api/documents/employee/{d['id']}?actorDisplayName=QA11")

    print("\n── upload documents (with markers) ──")
    # John: OLD passport then NEW passport (latest-valid must pick NEW)
    body, hdrs = multipart(
        {"employeeId": john["id"], "docType": "passport", "docName": "Passport OLD", "actorDisplayName": "QA11"},
        {"file": ("passport_old.pdf", mini_pdf("OLDEST-PASSPORT-MARKER"), "application/pdf")},
    )
    st, data, _ = req("POST", "/api/documents/employee", headers=hdrs, raw_body=body)
    check("upload old passport", st in (200, 201) and data.get("success"), f"{st} {data}")
    uploaded_doc_ids.append(data["data"]["document"]["id"])
    body, hdrs = multipart(
        {"employeeId": john["id"], "docType": "passport", "docName": "Passport NEW", "actorDisplayName": "QA11"},
        {"file": ("passport_new.pdf", mini_pdf("NEWEST-PASSPORT-MARKER"), "application/pdf")},
    )
    st, data, _ = req("POST", "/api/documents/employee", headers=hdrs, raw_body=body)
    check("upload new passport", st in (200, 201) and data.get("success"), f"{st} {data}")
    uploaded_doc_ids.append(data["data"]["document"]["id"])
    # Jyothilal: visa
    body, hdrs = multipart(
        {"employeeId": jyothi["id"], "docType": "visa", "docName": "Visa scan", "actorDisplayName": "QA11"},
        {"file": ("visa_scan.pdf", mini_pdf("VISA-MARKER-JR"), "application/pdf")},
    )
    st, data, _ = req("POST", "/api/documents/employee", headers=hdrs, raw_body=body)
    check("upload visa for Jyothilal", st in (200, 201) and data.get("success"), f"{st} {data}")
    uploaded_doc_ids.append(data["data"]["document"]["id"])

    print("\n── magic-byte upload validation (§5-6) ──")
    body, hdrs = multipart(
        {"employeeId": john["id"], "docType": "id_card", "actorDisplayName": "QA11"},
        {"file": ("fake.pdf", b"this is definitely not a pdf file body", "application/pdf")},
    )
    st, data, _ = req("POST", "/api/documents/employee", headers=hdrs, raw_body=body)
    check("fake PDF rejected with content error", st == 400 and "not a valid PDF" in (data or {}).get("error", ""), f"{st} {data}")

    print("\n── create the test NOC (3 employees incl. duplicate name + nobody) ──")
    st, data, _ = req("GET", "/api/documents/companies")
    company_a = data["data"]["companies"][0]["id"]
    employees = [
        {"name": "JOHN DOE", "trade": "MASON", "company": "ASM", "nationality": "KENYA", "passport": (john.get("passportNumber") or "JDOE11")},
        {"name": "JYOTHILAL REJI", "trade": "HELPER", "company": "ASM", "nationality": "INDIA", "passport": (jyothi.get("passportNumber") or "JREJI11")},
        {"name": "NOBODY NOBODY", "trade": "HELPER", "company": "ASM", "nationality": "NOWHERE", "passport": "XNONE11"},
        {"name": "JOHN DOE", "trade": "HELPER", "company": "ASM", "nationality": "KENYA", "passport": "XDUPE11"},  # duplicate name → suffix
    ]
    st, data, _ = req("POST", "/api/documents/noc", {
        "status": "final", "clientName": "QA11 PACKAGE CLIENT LLC", "projectName": "PKG PROJECT",
        "nocDate": "18-09-2026", "stampEnabled": False, "companyId": company_a, "employees": employees,
    })
    check("final NOC created", st in (200, 201) and data.get("success"), f"{st} {data}")
    noc = data["data"]["noc"]

    print("\n── generate the package (§16) ──")
    st, data, _ = req("POST", f"/api/documents/noc/{noc['id']}/package", {"actorDisplayName": "QA11"})
    check("package generated", st in (200, 201) and data.get("success"), f"{st} {data}")
    summary = data["data"]["summary"]
    pkg_id = data["data"]["package"]["id"]
    check("zip named after the NOC (§20)", summary["fileName"].startswith("NOC_QA11_PACKAGE_CLIENT_LLC_PKG_PROJECT_18-09-2026"), summary["fileName"])
    check("4 employee ZIPs created", summary["employeeZipsCreated"] == 4, str(summary["employeeZipsCreated"]))
    check("john matched the database", any(e["snapshotName"] == "JOHN DOE" and e["matched"] for e in summary["employees"][:1]), str([ (e['snapshotName'], e['matched']) for e in summary['employees'] ]))
    check("nobody has no docs and no error", any(e["snapshotName"] == "NOBODY NOBODY" and not e["matched"] and not e.get("error") for e in summary["employees"]))
    john_docs = [d for e in summary["employees"] if e["snapshotName"] == "JOHN DOE" for d in e["docs"]]
    check("john passport included", any(d["type"] == "passport" and d["included"] for d in john_docs))
    check("category counts add up", summary["documentsIncluded"] + summary["documentsMissing"] == 4 * 4, f"{summary['documentsIncluded']}+{summary['documentsMissing']}")

    print("\n── download + verify ZIP structure (§23) ──")
    st, _, zip_bytes = req("GET", f"/api/documents/noc/{noc['id']}/package?packageId={pkg_id}")
    check("package download 200 + zip bytes", st == 200 and zip_bytes[:2] == b"PK", f"{st} {zip_bytes[:4]}")
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    names = zf.namelist()
    check("outer contains the NOC PDF", any(n.endswith(".pdf") for n in names), str(names))
    check("outer contains JOHN DOE.zip", "JOHN DOE.zip" in names, str(names))
    check("duplicate-name suffix used (§21)", any(n.startswith("JOHN DOE - XDUPE11") for n in names), str(names))
    inner = zipfile.ZipFile(io.BytesIO(zf.read("JOHN DOE.zip")))
    inner_names = inner.namelist()
    check("normalized Passport.pdf inside (§22)", "Passport.pdf" in inner_names, str(inner_names))
    check("LATEST passport wins (§10-11)", b"NEWEST-PASSPORT-MARKER" in inner.read("Passport.pdf") and b"OLDEST-PASSPORT-MARKER" not in inner.read("Passport.pdf"))
    inner2 = zipfile.ZipFile(io.BytesIO(zf.read("JYOTHILAL REJI.zip")))
    check("visa normalized + present", "Visa.pdf" in inner2.namelist() and b"VISA-MARKER-JR" in inner2.read("Visa.pdf"), str(inner2.namelist()))
    inner3 = zipfile.ZipFile(io.BytesIO(zf.read("NOBODY NOBODY.zip")))
    check("empty employee gets placeholder ZIP (§18)", "NO DOCUMENTS ON FILE.txt" in inner3.namelist(), str(inner3.namelist()))

    print("\n── package history + latest + staleness (§25-27) ──")
    st, data, _ = req("GET", f"/api/documents/noc/{noc['id']}/package?view=latest")
    check("latest package metadata", st == 200 and data["data"]["package"]["id"] == pkg_id and data["data"]["stale"] is False)
    st, data, _ = req("GET", f"/api/documents/noc/{noc['id']}/package?view=history")
    check("history lists the package", st == 200 and len(data["data"]["packages"]) >= 1)
    # regenerate → still works (§26)
    st, data, _ = req("POST", f"/api/documents/noc/{noc['id']}/package", {"actorDisplayName": "QA11"})
    check("regeneration works", st in (200, 201) and data.get("success"))

    print("\n── stamp/company validation (§32) + stampRect (§36-38) ──")
    body, hdrs = multipart(
        {"name": "QA11 Company B", "contactPerson": "B Manager", "contactPhone": "050 000 0000", "contactEmail": "b@test.com", "actorDisplayName": "QA11"},
        {},
    )
    st, data, _ = req("POST", "/api/documents/companies", headers=hdrs, raw_body=body)
    check("company B created", st in (200, 201) and data.get("success"), f"{st} {data}")
    company_b = data["data"]["company"]["id"]
    import base64
    png_stamp = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    body, hdrs = multipart(
        {"name": "QA11 Stamp B", "companyId": company_b, "actorDisplayName": "QA11"},
        {"file": ("stamp-b.png", png_stamp + b"\x1a" + b"\x00" * 20, "image/png")},
    )
    st, data, _ = req("POST", "/api/documents/stamps", headers=hdrs, raw_body=body)
    check("stamp B created for company B", st in (200, 201) and data.get("success"), f"{st} {data}")
    stamp_b = data["data"]["stamp"]["id"]
    st, data, _ = req("GET", "/api/documents/stamps")
    stamp_a = data["data"]["stamps"][0]["id"]

    # NOC company A + stamp of company B → rejected
    st, data, _ = req("PATCH", f"/api/documents/noc/{noc['id']}", {"stampUpdate": True, "stampEnabled": True, "stampId": stamp_b, "actorDisplayName": "QA11"})
    check("wrong-company stamp rejected (§32)", st == 400 and data.get("code") == "INVALID_STAMP_FOR_COMPANY", f"{st} {data}")
    # correct-company stamp → applied + rect
    st, data, _ = req("PATCH", f"/api/documents/noc/{noc['id']}", {"stampUpdate": True, "stampEnabled": True, "stampId": stamp_a, "actorDisplayName": "QA11"})
    check("correct stamp applies", st == 200 and data.get("success"), f"{st} {data}")
    st, data, _ = req("GET", f"/api/documents/noc/{noc['id']}")
    detail = data["data"]["noc"]
    check("stampRect persisted (normalized 0..1)", detail.get("stampRect") and 0 < detail["stampRect"]["x"] < 1 and 0 < detail["stampRect"]["y"] < 1, str(detail.get("stampRect")))
    check("stampAppliedAt/By recorded (§51)", bool(detail.get("stampAppliedAt")) and detail.get("stampAppliedBy") == "QA11")
    # §45 — ZIP now uses the stamped rendition
    st, data, _ = req("POST", f"/api/documents/noc/{noc['id']}/package", {"actorDisplayName": "QA11"})
    pkg2 = data["data"]["package"]["id"]
    st, _, zip2 = req("GET", f"/api/documents/noc/{noc['id']}/package?packageId={pkg2}")
    zf2 = zipfile.ZipFile(io.BytesIO(zip2))
    pdf_name = [n for n in zf2.namelist() if n.endswith(".pdf")][0]
    check("ZIP includes the STAMPED rendition (§45)", len(zf2.read(pdf_name)) > 1000)

    print("\n── cleanup report (§13-14,§64) ──")
    st, data, _ = req("POST", "/api/documents/employee/cleanup", {"action": "report"})
    check("cleanup report runs", st == 200 and data.get("success"), f"{st} {data}")
    check("old duplicate passport flagged for REPLACED", data["data"]["toReplace"] >= 1, str(data["data"]["toReplace"]))
    st, data, _ = req("POST", "/api/documents/employee/cleanup", {"action": "clean"})
    check("cleanup marks replaced", st == 200 and data["data"]["markedReplaced"] >= 1, f"{st} {data}")
    # resolver unaffected: FRESH upload pair → newest packaged, REPLACED/marked skipped
    body, hdrs = multipart(
        {"employeeId": john["id"], "docType": "passport", "docName": "Passport OLD", "actorDisplayName": "QA11"},
        {"file": ("passport_old2.pdf", mini_pdf("OLD-AGAIN-MARKER"), "application/pdf")},
    )
    st, data, _ = req("POST", "/api/documents/employee", headers=hdrs, raw_body=body)
    uploaded_doc_ids.append(data["data"]["document"]["id"])
    st, data, _ = req("POST", f"/api/documents/noc/{noc['id']}/package", {"actorDisplayName": "QA11"})
    pkg3 = data["data"]["package"]["id"]
    st, _, zip3 = req("GET", f"/api/documents/noc/{noc['id']}/package?packageId={pkg3}")
    zf3 = zipfile.ZipFile(io.BytesIO(zip3))
    inner_j = zipfile.ZipFile(io.BytesIO(zf3.read("JOHN DOE.zip")))
    # OLD-AGAIN was uploaded LAST → it is now the newest ACTIVE passport and
    # must be the packaged one (the resolver always takes the latest upload)
    check("post-cleanup resolver picks the newest upload", b"OLD-AGAIN-MARKER" in inner_j.read("Passport.pdf") and b"NEWEST-PASSPORT-MARKER" not in inner_j.read("Passport.pdf"))

    print("\n── draft guard + cleanup of QA artifacts ──")
    st, data, _ = req("POST", "/api/documents/noc", {"status": "draft", "clientName": "QA11 DRAFT", "employees": [{"name": "X"}]})
    draft = data["data"]["noc"]
    st, data, _ = req("POST", f"/api/documents/noc/{draft['id']}/package", {})
    check("draft cannot be packaged (§15)", st == 400, f"{st}")
    req("DELETE", f"/api/documents/noc/{draft['id']}")

    req("DELETE", f"/api/documents/noc/{noc['id']}")
    req("DELETE", f"/api/documents/companies/{company_b}?actorDisplayName=QA11")
    req("DELETE", f"/api/documents/stamps/{stamp_b}?actorDisplayName=QA11")
    # remove the exact documents this run uploaded (by id — deterministic)
    for doc_id in uploaded_doc_ids:
        req("DELETE", f"/api/documents/employee/{doc_id}?actorDisplayName=QA11")
    print("QA artifacts removed")

    print(f"\n══════ RESULT: {PASS} passed, {FAIL} failed ══════")
    sys.exit(1 if FAIL else 0)

if __name__ == "__main__":
    main()
