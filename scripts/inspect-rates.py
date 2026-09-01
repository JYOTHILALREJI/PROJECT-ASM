#!/usr/bin/env python3
"""Inspect the DB for rate-related data: BaseRate, TradeRate, salary records."""
import sqlite3

DB = '/home/z/my-project/db/custom.db'
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

def q(sql, params=()):
    try:
        return [dict(r) for r in cur.execute(sql, params).fetchall()]
    except Exception as e:
        return [{'error': str(e)}]

print('=== BaseRate singleton ===')
for r in q("SELECT * FROM BaseRate"):
    print(r)

print('\n=== TradeRate table ===')
for r in q("SELECT * FROM TradeRate LIMIT 25"):
    print(r)

print('\n=== EmployeeTrade table (sample) ===')
for r in q("SELECT * FROM EmployeeTrade LIMIT 25"):
    print(r)

print('\n=== Salary records: rate distribution by tier (2025) ===')
for r in q("""
    SELECT rateTier, rtPerHour, COUNT(*) as cnt, SUM(totalHours) as hours, SUM(totalSalary) as salary
    FROM SalaryRecord
    WHERE isDeleted = 0 AND year = 2025
    GROUP BY rateTier, rtPerHour
    ORDER BY rateTier, rtPerHour
"""):
    print(r)

print('\n=== Premium-tier records with low rates (possible bug) ===')
for r in q("""
    SELECT empName, siteName, month, year, totalHours, rtPerHour, totalSalary, trade
    FROM SalaryRecord
    WHERE isDeleted = 0 AND rateTier = 'premium' AND rtPerHour < 4
    ORDER BY year DESC, month DESC
    LIMIT 20
"""):
    print(r)

print('\n=== Distinct trades on salary records ===')
for r in q("SELECT trade, COUNT(*) cnt FROM SalaryRecord WHERE isDeleted=0 GROUP BY trade ORDER BY cnt DESC LIMIT 20"):
    print(r)

print('\n=== Employees: customHourlyRate set ===')
for r in q("SELECT id, fullName, trade, customHourlyRate, isTeamLeader, isSupervisor, hoursThreshold FROM Employee WHERE customHourlyRate IS NOT NULL AND status != 'deleted' LIMIT 20"):
    print(r)

conn.close()
