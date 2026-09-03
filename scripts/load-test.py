#!/usr/bin/env python3
"""Concurrent load test for the ASM API (read-heavy admin workload).
Levels of concurrent clients; each client walks a mixed endpoint loop.
Reports per-level throughput, p50/p95/max latency and error rate."""
import json
import statistics
import sys
import threading
import time
import urllib.request
from collections import defaultdict

BASE = 'http://localhost:3000'

# read-heavy mix with one light write (presence heartbeat)
ENDPOINTS = [
    '/api/employees?limit=100',
    '/api/employees?search=Worker&limit=50',
    '/api/camps',
    '/api/camps/cmsa5r1lo0000u8iskaotwc2i',
    '/api/attendance?month=2026-09&year=2026',
    '/api/employees/hours-summary?month=2026-09',
    '/api/accounts?month=2026-09',
    '/api/salary-records?month=2026-09',
    '/api/accounts/working-hours',
    '/api/activity-logs?limit=50',
    '/api/documents/employee',
    '/api/notifications?limit=20',
    '/api/leave-requests',
]

ROUNDS = 4
LEVELS = [int(x) for x in (sys.argv[1].split(',') if len(sys.argv) > 1 else ['50', '100', '200'])]


def worker(results, errors, start_gate):
    lat = []
    login_req = urllib.request.Request(
        BASE + '/api/auth/login',
        data=json.dumps({'email': 'admin@asm.com', 'password': 'admin123'}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    urllib.request.urlopen(login_req, timeout=60).read()
    start_gate.wait()
    for _ in range(ROUNDS):
        for path in ENDPOINTS:
            t0 = time.time()
            try:
                with urllib.request.urlopen(BASE + path, timeout=120) as r:
                    r.read()
                lat.append(time.time() - t0)
            except Exception as e:
                errors.append(f'{path}: {e}')
                lat.append(time.time() - t0)
    results.extend(lat)


for level in LEVELS:
    results, errors = [], []
    gate = threading.Event()
    threads = [threading.Thread(target=worker, args=(results, errors, gate)) for _ in range(level)]
    t0 = time.time()
    for t in threads:
        t.start()
    gate.set()
    for t in threads:
        t.join()
    wall = time.time() - t0
    total = level * ROUNDS * len(ENDPOINTS)
    lat_sorted = sorted(results)
    p50 = lat_sorted[int(len(lat_sorted) * 0.5)] * 1000
    p95 = lat_sorted[int(len(lat_sorted) * 0.95)] * 1000
    p99 = lat_sorted[min(len(lat_sorted) - 1, int(len(lat_sorted) * 0.99))] * 1000
    mx = lat_sorted[-1] * 1000
    print(f'clients={level:>4}  reqs={total:>6}  wall={wall:6.1f}s  rps={total / wall:7.1f}  '
          f'p50={p50:7.0f}ms  p95={p95:7.0f}ms  p99={p99:7.0f}ms  max={mx:7.0f}ms  errors={len(errors)}')
    if errors:
        seen = set()
        for e in errors[:5]:
            key = e.split(':')[0]
            if key not in seen:
                seen.add(key)
                print('   ERR sample:', e[:120])
print('LOAD TEST DONE')
