#!/usr/bin/env python3
"""Inspect all salary records and working hours to trace the calculation bug."""
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

print('=== ALL salary records ===')
for r in q("""
    SELECT empName, siteName, month, year, rateTier, totalHours, rtPerHour, totalSalary, isDeleted, trade
    FROM SalaryRecord
    ORDER BY year DESC, month DESC, empName
"""):
    print(r)

print('\n=== TotalEmployeeWorkingHours ===')
for r in q("SELECT empId, empName, month, totalWorkingHours, rtPerHour, isCustom, previousCumulativeHours, hoursThreshold FROM TotalEmployeeWorkingHours ORDER BY month DESC LIMIT 30"):
    print(r)

print('\n=== Employees (non-deleted) ===')
for r in q("SELECT id, fullName, employeeId, trade, isTeamLeader, isSupervisor, customHourlyRate, hoursThreshold, currentTotalWorkingHours, status FROM Employee WHERE status IS NULL OR status != 'deleted' LIMIT 30"):
    print(r)

conn.close()
