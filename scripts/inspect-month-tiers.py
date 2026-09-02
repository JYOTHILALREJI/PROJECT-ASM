#!/usr/bin/env python3
"""Check per-month tier composition and employee trade info."""
import sqlite3

con = sqlite3.connect('file:/home/z/my-project/db/custom.db?mode=ro', uri=True)
con.row_factory = sqlite3.Row

print("=== John Doe per-month tier composition ===")
for r in con.execute("""
    SELECT month, year, rateTier, totalHours, rtPerHour, totalSalary, siteId
    FROM SalaryRecord WHERE isDeleted=0
    ORDER BY year, month, rateTier
"""):
    print(f"  {r['month']}/{r['year']}  {r['rateTier']:<8} hours={r['totalHours']:<8} rate={r['rtPerHour']:<5} salary={r['totalSalary']}")

print("\n=== Employee info (trade, TL/Sup) ===")
for r in con.execute("""
    SELECT id, fullName, trade, isTeamLeader, isSupervisor, currentTotalWorkingHours
    FROM Employee WHERE deletedAt IS NULL
"""):
    print(f"  {r['fullName']:<20} trade={r['trade']!r} TL={r['isTeamLeader']} Sup={r['isSupervisor']} cumHours={r['currentTotalWorkingHours']}")

print("\n=== TotalEmployeeWorkingHours (threshold tracking) ===")
cols = [c[1] for c in con.execute("PRAGMA table_info(TotalEmployeeWorkingHours)")]
print("  cols:", cols)
for r in con.execute("SELECT * FROM TotalEmployeeWorkingHours LIMIT 10"):
    print(" ", dict(r))

con.close()
