#!/bin/bash
# End-to-end verification of the threshold/trade-rate fix.
set -u
cd /home/z/my-project

# 1. Start dev server
setsid nohup npx next dev -p 3000 > /tmp/nextdev.log 2>&1 < /dev/null &
SERVER_PID=$!

# 2. Wait until it responds
for i in $(seq 1 40); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null)
  if [ "$CODE" = "200" ]; then break; fi
  sleep 2
done
echo "Server ready (root=$CODE)"

# 3. Login
LOGIN=$(curl -s -w "\nHTTP:%{http_code}" -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@asm.com","password":"admin123"}' \
  -c /tmp/cookies.txt)
echo "LOGIN: $LOGIN" | tail -c 300

# 4. Run allocation for August 2026
echo; echo "=== RUN ALLOCATION 2026-08 ==="
curl -s -X POST http://localhost:3000/api/accounts/allocate \
  -H "Content-Type: application/json" \
  -b /tmp/cookies.txt \
  -d '{"month":"2026-08","year":2026}' | head -c 800
echo

# 5. Check DB records after allocation
echo; echo "=== AFTER: August 2026 salary records ==="
python3 -c "
import sqlite3
conn = sqlite3.connect('/home/z/my-project/db/custom.db')
conn.row_factory = sqlite3.Row
for r in conn.execute(\"SELECT empName, rateTier, totalHours, rtPerHour, totalSalary FROM SalaryRecord WHERE month='2026-08' AND isDeleted=0\"):
    print(dict(r))
"

# 6. Fetch accounts API and inspect rate fields
echo; echo "=== /api/accounts 2026-08: rate fields ==="
curl -s "http://localhost:3000/api/accounts?month=2026-08&year=2026" -b /tmp/cookies.txt | python3 -c "
import json,sys
d = json.load(sys.stdin)
if not d.get('success'):
    print('API ERROR:', d); sys.exit(1)
for s in d['data']['sites']:
    for e in s['employees']:
        wh = e.get('workingHours') or {}
        print({
            'name': e['empName'],
            'tier': e['rateTier'],
            'recHours': e['salaryRecord']['totalHours'] if e.get('salaryRecord') else None,
            'recRate': e['salaryRecord']['rtPerHour'] if e.get('salaryRecord') else None,
            'recSalary': e['salaryRecord']['totalSalary'] if e.get('salaryRecord') else None,
            'prevCumulative': wh.get('previousCumulativeHours'),
            'threshold': wh.get('hoursThreshold'),
        })
"
echo "DONE"
