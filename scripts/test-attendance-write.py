#!/usr/bin/env python3
"""E2E verification that the dev server can WRITE attendance (readonly-db regression test).

1. Reads a real site + employee from SQLite (read-only).
2. POSTs attendance through the HTTP API (the exact path that failed with
   'attempt to write a readonly database').
3. Verifies the row landed in the DB with the right siteId.
4. Cleans the test row up (direct SQLite DELETE) so user data is untouched.
"""
import json
import sqlite3
import urllib.request
from datetime import date

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"

def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data=data, timeout=30) as r:
        return r.status, json.loads(r.read().decode())

def main():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    site = cur.execute(
        "SELECT id, name FROM Site WHERE deletedAt IS NULL ORDER BY name LIMIT 1"
    ).fetchone()
    emp = cur.execute(
        "SELECT id, fullName, companyName, currentSiteId FROM Employee WHERE deletedAt IS NULL ORDER BY fullName LIMIT 1",
    ).fetchone()
    con.close()
    print(f"[1] using site '{site['name']}' ({site['id']}) and employee {emp['fullName']} ({emp['id']})")

    today = date.today().isoformat()
    status, res = api("POST", "/api/attendance", {
        "employeeId": emp["id"],
        "date": today,
        "status": "present",
        "siteId": site["id"],
        "actorUserId": "write-test",
        "actorDisplayName": "Write Test",
    })
    print(f"[2] POST /api/attendance -> {status}: {json.dumps(res)[:200]}")
    assert status == 200 and res.get("success"), f"WRITE STILL FAILING: {res}"

    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    row = con.execute(
        "SELECT id, siteId, status FROM Attendance WHERE employeeId = ? AND date = ?",
        (emp["id"], today),
    ).fetchone()
    assert row is not None, "record not found in DB"
    assert row["siteId"] == site["id"], f"siteId mismatch: {row['siteId']}"
    print(f"[3] DB row confirmed: status={row['status']} siteId={row['siteId']} (expected {site['id']})")
    con.close()

    # cleanup — remove the test mark so user data stays untouched
    con = sqlite3.connect(DB, timeout=10)
    con.execute("DELETE FROM Attendance WHERE id = ?", (row["id"],))
    con.commit()
    left = con.execute("SELECT COUNT(*) FROM Attendance WHERE id = ?", (row["id"],)).fetchone()[0]
    con.close()
    assert left == 0
    print("[4] test record cleaned up. ALL WRITE TESTS PASSED ✅")

if __name__ == "__main__":
    main()
