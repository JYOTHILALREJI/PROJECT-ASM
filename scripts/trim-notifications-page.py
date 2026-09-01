#!/usr/bin/env python3
"""Remove Leave Requests + Cancellation Requests tabs/components from the
Notifications page (they already exist as dedicated side-panel pages).
Deletes verified line ranges bottom-up so earlier ranges stay valid."""

PATH = '/home/z/my-project/src/components/notifications/notification-page.tsx'

with open(PATH, 'r', encoding='utf-8') as f:
    lines = f.readlines()  # 0-based; file line N == lines[N-1]

def assert_line(no: int, expected_prefix: str) -> None:
    actual = lines[no - 1].rstrip('\n')
    if not actual.strip().startswith(expected_prefix):
        raise SystemExit(f'Assertion failed at line {no}: expected prefix {expected_prefix!r}, got {actual!r}')

def assert_blank(no: int) -> None:
    actual = lines[no - 1].rstrip('\n')
    if actual.strip() != '':
        raise SystemExit(f'Assertion failed at line {no}: expected blank, got {actual!r}')

# ── verify boundaries (1-based) ──
assert_line(62, '// Leave Request')
assert_line(63, 'interface LeaveRequest {')
assert_line(105, '}')            # close of CancellationRequest
assert_line(107, '// Employee for dropdown')

assert_line(155, 'const MONTHS')
assert_line(172, 'const YEARS')

assert_line(183, 'function formatFormalDate')
assert_blank(191)
assert_line(192, 'function formatCurrency')

assert_blank(200)
assert_line(201, 'function calculateTotalDays')
assert_line(405, '}')            # close of printLeaveRequest
assert_line(407, '/* ───────── Skeleton Cards')

assert_line(430, '/* ───────── Generic Request Card')
assert_line(511, '}')            # close of RequestCard
assert_blank(512)
assert_line(513, '/* ───────── Employee Search Combobox')

assert_blank(576)
assert_line(577, '/* ───────── Leave Requests Sub-Tab')
assert_line(973, '}')            # close of CancellationRequestsTab
assert_blank(974)
assert_line(975, '/* ───────── Warnings Tab')

# ── delete bottom-up ──
ranges = [
    (576, 973),   # LeaveRequestsTab + CancellationRequestsTab (+ section comments)
    (430, 512),   # RequestCard + trailing blank
    (200, 405),   # calculateTotalDays + generateLeaveApplicationHtml + printLeaveRequest
    (183, 191),   # formatFormalDate + trailing blank
    (155, 172),   # MONTHS / currentYear / currentMonth / YEARS
    (62, 105),    # LeaveRequest + CancellationRequest types
]
for start, end in ranges:
    del lines[start - 1:end]

with open(PATH, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f'OK — {len(lines)} lines remain')
