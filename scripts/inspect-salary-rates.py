#!/usr/bin/env python3
"""Inspect SalaryRecord rate tiers to understand the 3.5/7 rate display issue."""
import sqlite3
import json

con = sqlite3.connect('file:/home/z/my-project/db/custom.db?mode=ro', uri=True)
con.row_factory = sqlite3.Row

# 1. Distribution of rateTier
print("=== SalaryRecord rateTier distribution (isDeleted=0) ===")
for r in con.execute("SELECT rateTier, COUNT(*) cnt FROM SalaryRecord WHERE isDeleted=0 GROUP BY rateTier"):
    print(f"  {r['rateTier']}: {r['cnt']}")

# 2. All salary records grouped by employee — see who has standard vs premium
print("\n=== Per-employee tier composition (isDeleted=0) ===")
rows = con.execute("""
    SELECT empId, MAX(empName) empName,
           GROUP_CONCAT(DISTINCT month || '/' || year) months,
           SUM(CASE WHEN rateTier='standard' THEN 1 ELSE 0 END) std_cnt,
           SUM(CASE WHEN rateTier='premium' THEN 1 ELSE 0 END) prem_cnt,
           SUM(CASE WHEN rateTier='camp_sitting' THEN 1 ELSE 0 END) camp_cnt,
           GROUP_CONCAT(DISTINCT rtPerHour) rates
    FROM SalaryRecord WHERE isDeleted=0
    GROUP BY empId ORDER BY empName
""").fetchall()
for r in rows:
    print(f"  {r['empName']:<20} months={r['months']:<12} std={r['std_cnt']} prem={r['prem_cnt']} camp={r['camp_cnt']} rates={r['rates']}")

# 3. Distinct rtPerHour values
print("\n=== Distinct rtPerHour values ===")
for r in con.execute("SELECT DISTINCT rtPerHour FROM SalaryRecord WHERE isDeleted=0 ORDER BY rtPerHour"):
    print(f"  {r['rtPerHour']}")

# 4. base-rates / trade tables if any
tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
print("\n=== Tables ===")
print(" ", tables)

for t in tables:
    if 'rate' in t.lower() or 'trade' in t.lower():
        cols = [c[1] for c in con.execute(f"PRAGMA table_info({t})")]
        print(f"\n=== {t} ({cols}) ===")
        for r in con.execute(f"SELECT * FROM {t} LIMIT 20"):
            print(" ", dict(r))

con.close()
