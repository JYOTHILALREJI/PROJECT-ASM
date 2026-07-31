#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# fix-advance-table.sh
# ---------------------------------------------------------------------------
# One-shot script to create the missing `Advance` table in the local SQLite
# database. Run this if you see:
#
#   "The table `main.Advance` does not exist in the current database."
#
# Usage (from project root):
#   bash scripts/fix-advance-table.sh
#
# Or simply:
#   npm run db:push
# ---------------------------------------------------------------------------

set -e

echo "→ Syncing Prisma schema to database (creating missing tables)..."
npx prisma db push

echo ""
echo "→ Regenerating Prisma Client..."
npx prisma generate

echo ""
echo "✓ Done. The 'Advance' table has been created."
echo ""
echo "  Restart your dev server (Ctrl+C then 'npm run dev') to pick up"
echo "  the regenerated Prisma Client."
