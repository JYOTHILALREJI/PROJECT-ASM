#!/bin/bash
# Ensures ONE next dev server is running on :3000 (restarts stale instances).
# Usage: bash /home/z/my-project/scripts/dev-server.sh
cd /home/z/my-project

probe() { curl -s -o /dev/null -w "%{http_code}" --max-time 20 http://localhost:3000/ 2>/dev/null; }

code=$(probe)
if [ "$code" != "200" ]; then
  # kill any stale servers first (readonly-db inode rule: never two servers)
  pkill -f "next dev" 2>/dev/null
  sleep 1
  nohup node node_modules/next/dist/bin/next dev -p 3000 > /tmp/next-dev.log 2>&1 &
  # wait for readiness (compile can take a while on first hit)
  for i in $(seq 1 30); do
    sleep 2
    code=$(probe)
    if [ "$code" = "200" ]; then break; fi
  done
fi
echo "server_status=$code"
