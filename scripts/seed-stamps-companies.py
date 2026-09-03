#!/usr/bin/env python3
"""
Seed the Stamp + NocCompany tables (Task 9) and migrate existing NOC rows:

- Stamps: the two reference stamps are registered as built-ins
    "Procurement stamp"  -> builtin:stamp-procurement.png (default)
    "Signature stamp"    -> builtin:stamp-signature.png
- Company: "ARABIAN SHIELD A/C. UNITS FIX. CONT" with the reference manager
  block (Ms. Mafeeda Kader / 050 797 4153 / mafeedaarabianshieldmanpower…).
- Existing NOC rows: stampEnabled = (stampType != 'none') so the historical
  behaviour (stamp always applied) is preserved for old letters, while NEW
  NOCs default to stampEnabled=false (stamps are opt-in, per the request).

Idempotent: safe to run multiple times.
"""
import sqlite3
import sys

DB = "/home/z/my-project/db/custom.db"

BUILTIN_STAMPS = [
    ("Procurement stamp", "builtin:stamp-procurement.png"),
    ("Signature stamp", "builtin:stamp-signature.png"),
]

DEFAULT_COMPANY = (
    "ARABIAN SHIELD A/C. UNITS FIX. CONT",
    "Ms. Mafeeda Kader",
    "050 797 4153",
    "mafeedaarabianshieldmanpower@gmail.com",
)


def main() -> int:
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    # -- seed built-in stamps ------------------------------------------------
    stamp_ids = {}
    for name, image in BUILTIN_STAMPS:
        cur.execute("SELECT id FROM Stamp WHERE name = ? AND deletedAt IS NULL", (name,))
        row = cur.fetchone()
        if row:
            stamp_ids[name] = row[0]
            print(f"stamp exists: {name} ({row[0]})")
        else:
            cur.execute(
                "INSERT INTO Stamp (id, name, imagePath, isDefault, active, createdAt, updatedAt) "
                "VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))), ?, ?, ?, 1, datetime('now'), datetime('now'))",
                (name, image, 1 if name == "Procurement stamp" else 0),
            )
            stamp_ids[name] = cur.lastrowid
            print(f"stamp seeded: {name} ({stamp_ids[name]})")

    # -- seed default company ------------------------------------------------
    cur.execute("SELECT id FROM NocCompany WHERE name = ? AND deletedAt IS NULL", (DEFAULT_COMPANY[0],))
    row = cur.fetchone()
    if row:
        company_id = row[0]
        print(f"company exists: {DEFAULT_COMPANY[0]} ({company_id})")
    else:
        cur.execute(
            "INSERT INTO NocCompany (id, name, contactPerson, contactPhone, contactEmail, active, createdAt, updatedAt) "
            "VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))), ?, ?, ?, ?, 1, datetime('now'), datetime('now'))",
            DEFAULT_COMPANY,
        )
        company_id = cur.lastrowid
        print(f"company seeded: {DEFAULT_COMPANY[0]} ({company_id})")

    # -- make sure exactly the procurement stamp is the default ---------------
    cur.execute("UPDATE Stamp SET isDefault = CASE WHEN name = 'Procurement stamp' THEN 1 ELSE 0 END WHERE deletedAt IS NULL")

    # -- migrate existing NOC rows --------------------------------------------
    cur.execute(
        "UPDATE NocDocument SET stampEnabled = CASE WHEN stampType = 'none' THEN 0 ELSE 1 END "
        "WHERE stampEnabled = 0 AND stampType != 'none'"
    )
    migrated = cur.rowcount
    # give historical stamped rows the matching built-in stamp so the picker
    # shows what they were issued with
    cur.execute(
        "UPDATE NocDocument SET stampId = ? WHERE stampEnabled = 1 AND stampId IS NULL AND stampType = 'signature'",
        (stamp_ids["Signature stamp"],),
    )
    cur.execute(
        "UPDATE NocDocument SET stampId = ? WHERE stampEnabled = 1 AND stampId IS NULL AND stampType = 'procurement'",
        (stamp_ids["Procurement stamp"],),
    )
    # NOCs without a company point at the default company
    cur.execute("UPDATE NocDocument SET companyId = ? WHERE companyId IS NULL", (company_id,))

    conn.commit()
    cur.execute("SELECT COUNT(*) FROM Stamp WHERE deletedAt IS NULL")
    print("active stamps:", cur.fetchone()[0])
    cur.execute("SELECT COUNT(*) FROM NocCompany WHERE deletedAt IS NULL")
    print("active companies:", cur.fetchone()[0])
    print("noc rows migrated to stampEnabled:", migrated)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
