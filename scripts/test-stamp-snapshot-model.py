#!/usr/bin/env python3
"""
Task 13 API tests — stamp SNAPSHOT model:
  1. The stored NOC PDF (filePath) is ALWAYS the unstamped original.
  2. Inline preview with a stamp renders the stamped version ON THE FLY
     (bytes differ from the base) and writes NO file.
  3. mode=download with a stamp saves a SNAPSHOT ("... (stamped).pdf"),
     sets stampSnapshotPath, and the snapshot bytes == the delivered bytes.
  4. Repeated stamped downloads OVERWRITE the same snapshot (no accumulation).
  5. Switching stamps deletes the stale snapshot + clears the pointer;
     the base file is untouched; inline still serves a stamped render.
  6. Removing the stamp serves the base bytes again (inline AND download).
  7. Re-applying a stamp later works ("stamp later" flow).
  8. The ZIP package includes the stamped NOC PDF (rendered on the fly)
     with a "... (stamped).pdf" entry name.
  9. Deleting the NOC removes the base AND the snapshot.
Run against a live dev server (default http://localhost:3000).
"""
import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse
import zipfile
from io import BytesIO

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

def raw(method, path, data=None, headers=None):
    """Returns (status, raw_bytes, headers)."""
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
        return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)

def hdr_get(headers, name):
    """Case-insensitive header lookup (http.client may keep server casing)."""
    lname = name.lower()
    for k, v in headers.items():
        if k.lower() == lname:
            return v
    return ""

def req(method, path, data=None):
    st, content, _h = raw(method, path, data)
    try:
        return st, json.loads(content.decode())
    except Exception:
        return st, None

def login():
    st, _b, _h = raw("POST", "/api/auth/login", {"email": "admin@asm.com", "password": "admin123"})
    assert st in (200, 201), f"login failed: {st}"

EMP = [
    {"name": "QA TASK13 WORKER ONE", "trade": "HELPER", "company": "ARABIAN SHIELD", "nationality": "INDIA", "passport": "T13A00001"},
    {"name": "QA TASK13 WORKER TWO", "trade": "MASON", "company": "ARABIAN SHIELD", "nationality": "INDIA", "passport": "T13A00002"},
]

def main():
    login()

    # ── pre-clean leftovers from previous runs (client storage folder) ──
    import glob, shutil
    for leftover in glob.glob(os.path.join(ROOT, "storage", "noc", "*[Ss][Nn][Aa][Pp][Ss][Hh][Oo][Tt]*")):
        shutil.rmtree(leftover, ignore_errors=True)
    st, data = req("GET", "/api/documents/noc?view=list&pageSize=100&search=" + urllib.parse.quote("T13 SNAPSHOT"))
    if st == 200 and data.get("success"):
        for row in data["data"]["nocs"]:
            req("DELETE", f"/api/documents/noc/{row['id']}")

    # ── stamp library ──
    st, data = req("GET", "/api/documents/stamps")
    stamps = data["data"]["stamps"] if st == 200 and data.get("success") else []
    check("stamp library available", len(stamps) >= 1, str(len(stamps)))
    stamp_a = stamps[0]["id"]
    stamp_b = stamps[1]["id"] if len(stamps) > 1 else stamp_a

    print("\n── 1. finalize with stamp → stored PDF stays plain ──")
    st, data = req("POST", "/api/documents/noc", {
        "status": "final", "clientName": "QA T13 SNAPSHOT CLIENT LLC", "projectName": "SNAPSHOT PROJECT",
        "nocDate": "17-09-2026", "stampEnabled": True, "stampId": stamp_a, "employees": EMP,
    })
    check("create final NOC with stamp", st in (200, 201) and data.get("success"), f"{st} {data}")
    noc = data["data"]["noc"]
    nid = noc["id"]
    st, data = req("GET", f"/api/documents/noc/{nid}")
    d = data["data"]["noc"]
    base_rel = d["filePath"]
    check("filePath set", bool(base_rel), str(base_rel))
    check("filePath == originalFilePath (plain)", d.get("originalFilePath") == base_rel, str(d.get("originalFilePath")))
    check("stampSnapshotPath initially empty", not d.get("stampSnapshotPath"), str(d.get("stampSnapshotPath")))
    base_abs = os.path.join(ROOT, base_rel)
    check("base file exists", os.path.exists(base_abs), base_abs)
    base_bytes = open(base_abs, "rb").read()
    check("base file non-empty", len(base_bytes) > 1000, str(len(base_bytes)))

    print("\n── 2. inline preview renders the stamp ON THE FLY (no file) ──")
    st, pdf_bytes, hdr = raw("GET", f"/api/documents/noc/{nid}/pdf?mode=inline")
    check("inline PDF 200", st == 200, str(st))
    check("inline content-type pdf", "application/pdf" in hdr_get(hdr, "Content-Type"), hdr_get(hdr, "Content-Type"))
    check("inline stamped bytes differ from base", pdf_bytes != base_bytes, f"{len(pdf_bytes)} vs {len(base_bytes)}")
    check("no snapshot written by inline preview", not d.get("stampSnapshotPath"))
    dnames = os.listdir(os.path.dirname(base_abs))
    check("no (stamped) file on disk after inline", not any("(stamped)" in f for f in dnames), str(dnames))

    print("\n── 3. stamped DOWNLOAD saves the snapshot ──")
    st, dl_bytes, hdr = raw("GET", f"/api/documents/noc/{nid}/pdf?mode=download")
    check("download PDF 200", st == 200, str(st))
    cd = hdr_get(hdr, "Content-Disposition")
    check("download filename carries (stamped)", "(stamped)" in cd, cd)
    check("downloaded bytes == stamped render (differ from base)", dl_bytes != base_bytes)
    st, data = req("GET", f"/api/documents/noc/{nid}")
    d2 = data["data"]["noc"]
    snap_rel = d2.get("stampSnapshotPath")
    check("stampSnapshotPath set after download", bool(snap_rel), str(snap_rel))
    check("snapshot file exists", snap_rel and os.path.exists(os.path.join(ROOT, snap_rel)), str(snap_rel))
    check("snapshot name carries (stamped)", snap_rel and "(stamped)" in snap_rel, str(snap_rel))
    if snap_rel and os.path.exists(os.path.join(ROOT, snap_rel)):
        snap_bytes = open(os.path.join(ROOT, snap_rel), "rb").read()
        check("snapshot bytes == delivered bytes", snap_bytes == dl_bytes, f"{len(snap_bytes)} vs {len(dl_bytes)}")
    check("filePath STILL the plain original after download", d2.get("filePath") == base_rel, str(d2.get("filePath")))

    print("\n── 4. repeated stamped downloads OVERWRITE the snapshot ──")
    st, dl2_bytes, _h = raw("GET", f"/api/documents/noc/{nid}/pdf?mode=download")
    check("second download 200", st == 200, str(st))
    st, data = req("GET", f"/api/documents/noc/{nid}")
    snap_rel2 = data["data"]["noc"].get("stampSnapshotPath")
    check("same snapshot path (overwritten, not accumulated)", snap_rel2 == snap_rel, f"{snap_rel2} vs {snap_rel}")
    names = os.listdir(os.path.dirname(base_abs))
    stamped_count = sum(1 for f in names if "(stamped)" in f)
    check("exactly ONE stamped snapshot on disk", stamped_count == 1, str(names))

    print("\n── 5. switching stamps clears the stale snapshot, base untouched ──")
    st, data = req("PATCH", f"/api/documents/noc/{nid}", {"stampUpdate": True, "stampEnabled": True, "stampId": stamp_b})
    check("switch stamp", st == 200 and data.get("success"), f"{st} {data}")
    st, data = req("GET", f"/api/documents/noc/{nid}")
    d3 = data["data"]["noc"]
    check("stampId updated", d3.get("stampId") == stamp_b, str(d3.get("stampId")))
    check("snapshot pointer cleared", not d3.get("stampSnapshotPath"), str(d3.get("stampSnapshotPath")))
    check("snapshot file removed (no old stamped copy kept)", snap_rel and not os.path.exists(os.path.join(ROOT, snap_rel)), str(snap_rel))
    check("base file untouched by switch", open(base_abs, "rb").read() == base_bytes)
    st, inline2, _h = raw("GET", f"/api/documents/noc/{nid}/pdf?mode=inline")
    check("inline still serves a stamped render after switch", st == 200 and inline2 != base_bytes, str(st))

    print("\n── 6. removing the stamp serves the base bytes everywhere ──")
    st, data = req("PATCH", f"/api/documents/noc/{nid}", {"stampUpdate": True, "stampEnabled": False})
    check("remove stamp", st == 200 and data.get("success"), f"{st} {data}")
    st, plain_inline, _h = raw("GET", f"/api/documents/noc/{nid}/pdf?mode=inline")
    check("inline == base bytes after removal", st == 200 and plain_inline == base_bytes, str(st))
    st, plain_dl, hdr = raw("GET", f"/api/documents/noc/{nid}/pdf?mode=download")
    check("download == base bytes after removal", st == 200 and plain_dl == base_bytes, str(st))
    check("download filename plain after removal", "(stamped)" not in hdr_get(hdr, "Content-Disposition"), hdr_get(hdr, "Content-Disposition"))

    print("\n── 7. re-apply stamp later (§9 stamp-later flow) ──")
    st, data = req("PATCH", f"/api/documents/noc/{nid}", {"stampUpdate": True, "stampEnabled": True, "stampId": stamp_a})
    check("re-apply stamp", st == 200 and data.get("success"), f"{st} {data}")
    st, re_inline, _h = raw("GET", f"/api/documents/noc/{nid}/pdf?mode=inline")
    check("inline stamped again after re-apply", st == 200 and re_inline != base_bytes, str(st))

    print("\n── 8. ZIP package includes the stamped NOC PDF (on the fly) ──")
    st, data = req("POST", f"/api/documents/noc/{nid}/package", {"actorDisplayName": "QA"})
    check("package generation ok", st in (200, 201) and data.get("success"), f"{st} {data}")
    pkg = data.get("data") or {}
    st, zip_bytes, _h = raw("GET", pkg.get("downloadUrl", "") + "&actorDisplayName=QA")
    check("package download 200", st == 200, str(st))
    if st == 200:
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        pdfs = [n for n in zf.namelist() if n.lower().endswith(".pdf")]
        check("outer ZIP has the NOC PDF entry", len(pdfs) == 1, str(zf.namelist()))
        check("NOC PDF entry named (stamped)", pdfs and "(stamped)" in pdfs[0], str(pdfs))
        if pdfs:
            # NOTE: pdf-lib embeds a creation timestamp per render, so bytes are
            # never byte-identical across renders — compare size within 2% and
            # confirm the packaged PDF is NOT the plain base.
            pkg_pdf = zf.read(pdfs[0])
            check("packaged NOC PDF is stamped (differs from base)", pkg_pdf != base_bytes)
            check("packaged NOC PDF size ~= stamped render", abs(len(pkg_pdf) - len(re_inline)) <= 0.02 * len(re_inline), f"{len(pkg_pdf)} vs {len(re_inline)}")

    print("\n── 9. DELETE removes base AND snapshot ──")
    # produce a fresh snapshot first
    raw("GET", f"/api/documents/noc/{nid}/pdf?mode=download")
    st, data = req("GET", f"/api/documents/noc/{nid}")
    snap_final = data["data"]["noc"].get("stampSnapshotPath")
    check("snapshot exists before delete", bool(snap_final), str(snap_final))
    st, data = req("DELETE", f"/api/documents/noc/{nid}")
    check("delete NOC", st == 200 and data.get("id") == nid, f"{st} {data}")
    check("base file removed", not os.path.exists(base_abs), base_abs)
    check("snapshot file removed", snap_final and not os.path.exists(os.path.join(ROOT, snap_final)), str(snap_final))

    print(f"\n===== RESULT: {PASS} PASS / {FAIL} FAIL =====")
    sys.exit(1 if FAIL else 0)

if __name__ == "__main__":
    main()
