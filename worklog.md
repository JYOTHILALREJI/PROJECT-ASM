---
Task ID: 1
Agent: main (Z.ai Code)
Task: Clone https://github.com/hypernova-coder/asm-project.git and apply fixes/additions: rewrite Prisma with FK relations + cascade soft-delete, add custom current total working hours per employee, and Excel salary-sheet export with all sites in one sheet + merged cells.

Work Log:
- Cloned the repo into temp-clone, inspected the existing PostgreSQL-based Prisma schema and ~50 API routes + 15 components.
- Copied src/, prisma/, scripts/, and public assets from temp-clone into the current project. Removed temp-clone.
- Installed missing dependencies: bcryptjs, xlsx, html2canvas-pro, jspdf, mammoth, sweetalert2, pdf-parse, @types/bcryptjs.
- Rewrote prisma/schema.prisma for SQLite (environment only supports SQLite, not PostgreSQL).
  * Added proper FK relations: Employee.currentSiteId/teamLeaderSiteId/supervisorSiteId -> Site (named relations), and Site.salaryRecords back-relation. All child tables already had FK relations (Attendance, Warning, Fine, LeaveRequest, CancellationRequest, UniformRegistry, SalaryRecord, TotalEmployeeWorkingHours, EmpCountSitePerMonth, WorkLog).
  * Added `deletedAt DateTime?` to EVERY data model for consistent cascade soft-delete.
  * Added `currentTotalWorkingHours Float @default(0)` to Employee (custom current total working hours, settable at any point).
  * Kept legacy soft-delete flags (status='deleted', isHidden, isDeleted, deletedDate) for backward compatibility with existing queries.
- Ran `bun run db:push` — schema synced to SQLite, Prisma client generated.
- Reduced db.ts logging (was `log:['query']`, now error/warn only).
- Created src/lib/soft-delete.ts with cascadeSoftDeleteEmployee, cascadeSoftDeleteSite (+ restore helpers). Each cascade runs in a single transaction, stamps deletedAt on the parent and every child table, and also sets legacy flags so existing queries keep filtering correctly. No hard deletes ever.
- Updated deletion flows to use cascading soft-delete:
  * src/app/api/cancellation-requests/[id]/route.ts (approve) -> cascadeSoftDeleteEmployee
  * src/app/api/employees/[id]/route.ts DELETE -> cascadeSoftDeleteEmployee
  * src/app/api/sites/route.ts DELETE -> cascadeSoftDeleteSite (was previously a HARD delete); GET now filters deletedAt: null
- Updated src/app/api/employees/route.ts (POST) and [id]/route.ts (PUT) to accept currentTotalWorkingHours and keep currentSiteId FK in sync with currentSite name.
- Created src/app/api/salary-records/export-excel/route.ts: exports ONE single-sheet .xlsx with a merged title row, then for each site a merged site-name header row + column header + employee detail rows + a merged site-subtotal row, ending with a merged grand-total row. Uses SheetJS (xlsx) merges via ws['!merges']. Excludes soft-deleted records.
- Added the "Export Excel" button (with Download/Loader2 icons + loading state) to src/components/consolidated-salary/consolidated-salary-page.tsx next to the month/year selectors. Downloads the .xlsx blob client-side.
- Added the custom current total working hours field to the employee form (src/components/employees/employee-page.tsx): full edit form field + a quick inline editor in the employee details dialog (settable at any point), both calling PUT /api/employees/[id]. Added the field to the Employee interface.
- Verified end-to-end via curl + agent-browser:
  * Login, session, employees, sites APIs all return 200.
  * PUT currentTotalWorkingHours=450.5 persisted correctly (verified via GET).
  * Excel export returns a valid .xlsx (Microsoft Excel 2007+). Confirmed content: title row (merged), per-site merged header rows, column headers, employee rows (including split standard+premium tier merge), site subtotal rows, grand total row. Confirmed soft-deleted records are excluded after cascade delete.
  * Cascade soft-delete: deleting an employee sets status='deleted' + deletedAt on the employee AND isDeleted=true + deletedAt on all related salary records (verified). No hard deletes.
  * Browser: login page renders, login succeeds, dashboard + full sidebar render, Consolidated Salary page renders with the Export Excel button.
- Lint passes clean (eslint . with no errors).

Stage Summary:
- Prisma schema fully rewritten for SQLite with explicit FK relations (Employee<->Site via currentSiteId/teamLeaderSiteId/supervisorSiteId; Site<->SalaryRecord added) and a uniform `deletedAt` soft-delete column on every model.
- Cascade soft-delete implemented via src/lib/soft-delete.ts and wired into employee deletion (DELETE + cancellation-request approval) and site deletion. Confirmed no hard deletes occur; child records are stamped with deletedAt + legacy flags.
- Custom current total working hours: new `Employee.currentTotalWorkingHours` field, settable at any point via the employee edit form AND a quick inline editor in the details dialog.
- Excel salary-sheet export: GET /api/salary-records/export-excel produces a single-sheet .xlsx with all sites, each under a merged site-name header, employee details + merged site subtotals, and a merged grand total. Button added to the Consolidated Salary page.
- Dev server runs on port 3000. Test admin account created: admin@asm.com / admin123 (plus sample site + employee for demonstration).

---
Task ID: attendance-trade-fix
Agent: main (Z.ai Code)
Task: Fix trade not displaying in attendance PDF sheet (trade assigned from Sites page wasn't appearing in the printable attendance sheet)

Work Log:
- Traced the data flow: AttendanceSheet component receives employee objects with a `position` field and only reads `emp.position` (legacy field). When trades are assigned from the Sites page, they go into the `EmployeeTrade` junction table and surface as `assignedTrade` on the employee object — but AttendanceSheet ignored `assignedTrade` and `trade`, so the printed/PDF sheet showed an empty trade cell whenever the employee had no legacy `position` set.
- Added a `resolveTrade()` helper in attendance-sheet.tsx with priority: assignedTrade → trade → position (matches the rest of the app).
- Widened the AttendanceSheetProps.employees type to accept `assignedTrade?` and `trade?` optional fields.
- Updated employeeData initialization in AttendanceSheet to use resolveTrade(emp) for both the `position` (display value) and the `isSupervisor` derivation.
- Updated attendance-page.tsx `attendanceSheetEmployees` mapping to pass through position/assignedTrade/trade separately instead of collapsing them into a single string. This keeps the resolver in AttendanceSheet as the single source of truth.
- Updated the AttendanceSheetLazy wrapper type to allow position: string | null and the optional trade fields.
- Sites page already passes raw employee objects (which include assignedTrade/trade/position) directly to AttendanceSheet, so the resolver now picks up assignedTrade automatically — no change needed there.

Stage Summary:
- Root cause: AttendanceSheet only read `emp.position` (legacy) and ignored `assignedTrade` (from EmployeeTrade junction) and `trade` (legacy Employee.trade). Trades assigned from the Sites page live in EmployeeTrade and surface as `assignedTrade`, so they were invisible in the PDF.
- Fix: centralised trade resolution in AttendanceSheet via resolveTrade(emp) using the same priority as everywhere else (assignedTrade → trade → position). Both call paths (Attendance page and Sites page) now display the correct trade.

---
Task ID: attendance-excel-grid
Agent: main
Task: Replace the circular-button + dropdown attendance UI with an Excel-style keyboard-only grid

Work Log:
- Removed StatusDropdown + StealthKeyboardIndicator components
- Added ExcelCell component (module-scope, React.memo) — keyboard-focusable button
- P = solid green '10' (10h), A = solid red 'A' (0h), Backspace = clear
- Arrow keys / Enter / Tab move focus between cells, skip moved-away employees
- Auto-advance after marking P/A: next day on same row, wrap to next employee
- Total Hrs column at the right (present*10 + overtime hours)
- Preserved: site header, bulk-mark bar, moved-away handling, Friday/recent tint, TL/SUP badges
- Preserved: Excel export (independent of grid), share-link flow (writes to same attendance table)
- Removed unused STATUS_OPTIONS constant

Stage Summary:
- File: src/components/attendance/attendance-page.tsx
- Net delta: +377 / -777 lines
- Commit: fbb9b20
- Pushed to origin/main

---
Task ID: attendance-excel-grid-v2
Agent: main
Task: Excel attendance grid improvements — plain dates, camp_sitting, undo, merged site cells

Work Log:
- Replaced Today/Yesterday labels with plain day numbers (1..31)
- Changed day order from reversed (today first) to sequential (1 first, left-to-right)
- Changed P/A auto-advance from RIGHT (next day) to DOWN (next employee, same day)
- If last in-range employee after marking, STAY in current cell (re-focus)
- Tightened row height: cells w-8 h-6, no vertical padding on row containers
- Added Ctrl+Z undo (100-entry stack, Undo button in header with count)
- Removed Overtime badge from bottom legend
- Added 'C' key → camp_sitting status (solid orange, 8h, not in lifetime)
- Added MergedSiteCell component for site-move merged cells
- Added nextSite/nextSiteDays computation in employeesBySite
- Out-of-range cells now merge into a single wide non-editable cell showing
  the exact DB site name (previousSite at start, nextSite at end)
- Back-end: computeMonthlyHoursFromAttendance returns {regularHours, campSittingHours}
- Back-end: syncEmployeeSalaryFromAttendance creates separate rateTier='camp_sitting' SalaryRecord
- Back-end: allocation-engine excludes camp_sitting from previousCumulative + siteMap
- Accounts + Consolidated Salary: mergeApiEntries includes camp_sitting in totals

Stage Summary:
- Files: attendance-page.tsx, attendance-sync.ts, allocation-engine.ts,
  accounts-page.tsx, consolidated-salary-page.tsx
- Commit: 2d201d6
- Pushed to origin/main

---
Task ID: attendance-grid-v3
Agent: main
Task: Fix camp_sitting error, weekdays, faded moved attendance, camp hrs, Ctrl+Z, edit trade

Work Log:
- API: added 'camp_sitting' to validStatuses in /api/attendance, /api/attendance/[id], /api/attendance/bulk-mark
- Header: shows weekday (SU/MO/TU/WE/TH/FR/SA) below each day number
- Moved-away employees: out-of-range cells show faded attendance (P=10/A/C) if record exists
- Site name shown as overlay label on first/last out-of-range cell (not merged cell)
- Removed MergedSiteCell component
- Added 'Camp Hrs' column (C × 8) to the right of 'Total Hrs'
- Added computeCampSittingHours helper
- Fixed Ctrl+Z: capture phase + e.code='KeyZ' + uppercase Z + stopPropagation
- Sites page: Edit Trade dropdown in employee table (select from /api/trade-rates)
- Sites page: POST /api/employee-trades on save, DELETE on clear, refresh on success

Stage Summary:
- Files: attendance/route.ts, attendance/[id]/route.ts, attendance/bulk-mark/route.ts,
  attendance-page.tsx, sites-page.tsx
- Commit: c7ca6d0
- Pushed to origin/main

---
Task ID: attendance-moved-away-fix
Agent: main
Task: Moved-away rows show S1 attendance faded + merged S2 label; site-aware salary sync

Work Log:
- Brought back MergedSiteCell component for out-of-range merged cells
- Moved-away employee rows: in-range cells show S1 attendance (faded, read-only)
  Out-of-range cells at end: MERGED with next-site name (e.g. "SITE S2")
  Out-of-range cells at start: MERGED with previous-site name
- Whole row has opacity-40 (faded) for moved-away employees
- Removed per-day faded attendance in out-of-range cells (was showing wrong site's data)
- New helper: computeMonthlyHoursPerSite() — splits hours across sites using
  EmpCountSitePerMonth date ranges
- syncEmployeeSalaryFromAttendance rewritten to be site-aware:
  * Creates separate SalaryRecord (standard + camp_sitting) for EACH site
  * Soft-deletes records for sites with no hours
  * Grand total → TotalEmployeeWorkingHours
  * EmpCountSitePerMonth + WorkLog upserted per site
- Ensures NO hour is missed: S1 days → S1 salary record, S2 days → S2 salary record
- Falls back to legacy behaviour when no EmpCountSitePerMonth records exist

Stage Summary:
- Files: attendance-page.tsx, attendance-sync.ts
- Commit: 0dd679d
- Pushed to origin/main

---
Task ID: ux-animation-overhaul
Agent: main (Z.ai Code)
Task: Clone JYOTHILALREJI/PROJECT-ASM and make it more user-friendly, feature-rich, with more animations and smoothness

Work Log:
- Cloned the repo, merged it into the sandbox root project (rsync src/, prisma/, scripts/, public/, db/, configs) and preserved its git history by swapping the repo .git into the project root.
- Installed deps (bun install), pushed Prisma schema (db:push), restarted dev server.
- Created src/components/motion/index.tsx — reusable framer-motion kit: PageTransition, StaggerContainer/StaggerItem, AnimatedNumber (spring count-up), FadeIn, PulseDot, shared spring physics constants.
- src/app/page.tsx: AnimatePresence + PageTransition keyed on currentView (smooth blur/fade/slide between ALL views), floating ScrollToTop button (appears after 400px), animated LoadingScreen with shimmer skeletons + spring logo, mounted global CommandPalette.
- NEW src/components/layout/command-palette.tsx: Ctrl/Cmd+K global palette — navigate all pages, live employee search (debounced /api/employees), site search, quick actions (toggle sidebar, profile, logout); built on cmdk so ↑↓/↵ keyboard nav works; fuzzy-friendly, grouped results, external open event (asm:open-command-palette).
- app-sidebar.tsx: staggered nav entrance (StaggerContainer), layoutId "asm-nav-active-pill" that springs between active items, icon hover scale/lift, pulsing unread badge, gradient ASM logo text, CSS tooltips when collapsed, logo hover rotate.
- app-header.tsx: animated title crossfade (AnimatePresence on view change), live clock widget (seconds + date, desktop only), online-presence chip (PulseDot + count via /api/presence/online), Ctrl+K search trigger button with kbd hint, notification bell popover (recent 6, unread highlight, mark-all-read via PUT {markAll:true}, spring badge pop, ring animation when unread), motion avatar.
- dashboard-page.tsx: AnimatedNumber count-up metrics, staggered metric cards + TL/SUP pills, hover lift/tap on cards, new Quick Actions row (Add Employee / Mark Attendance / Accounts).
- login-page.tsx: animated ambient gradient blobs (asm-float keyframes), staggered entrance (logo spring → branding → card), gradient ASM wordmark, spring error alert.
- globals.css: ASM Animation Kit — shimmer, float/blob drift, glow pulse, bell ring, gradient pan keyframes + reduced-motion support, selection color, smooth scroll.
- UX fixes: mobile sidebar Sheet no longer auto-opens on load (MainLayout closes it once on mobile); fixed palette fuzzy filter flooding results with keyword matches; fixed markAllRead to use bulk API; fixed pre-existing crash in /api/accounts (tekoInfoMap was never defined — stub-employee path threw ReferenceError); cleaned pre-existing lint errors in scripts/seed.ts (require→await import) and src/lib/base-rates.ts (Function→typed).
- Verified with agent-browser: login → dashboard renders (clock, presence, palette trigger, quick actions, animated stats), Ctrl+K opens palette, live search "john" → John Doe (ASM-2025-001) → Enter navigates to Employee Detail, attendance + employees pages transition cleanly, notification popover opens, mobile viewport renders correctly with closed sidebar. Lint: 0 errors.

Stage Summary:
- Animation system: src/components/motion/index.tsx + globals.css keyframes (one place to tune feel).
- New feature: global command palette (Ctrl/Cmd+K) with live employee/site search.
- Header: live clock, online-presence chip, notification popover with mark-all-read, animated title.
- Dashboard: count-up stats, staggered cards, quick actions. Login: animated ambient background.
- Bug fixes: accounts API tekoInfoMap crash, mobile sidebar auto-open, palette filter, pre-existing lint errors.
- Dev server runs on port 3000. Test account: admin@asm.com / admin123.

---
Task ID: base-rate-3.5-premium-6-7
Agent: main (Z.ai Code)
Task: Change the base rate to 3.5; after the threshold 6 for Helpers and 7 for other trades; make the hour and salary calculation stronger

Work Log:
- Mapped the full rate pipeline: BaseRate singleton, rate-resolver.ts (canonical priority), allocation-engine.ts, recalculation.ts, attendance-sync.ts, client-rate-resolver.ts, and every API/UI consumer.
- prisma/schema.prisma: BaseRate reworked from 6 role fields (standard/tl/sup × low/high) to 3 trade-based fields — baseLow(3.5), helperHigh(6.0), tradeHigh(7.0). Ran `prisma db push` + regenerated client.
- src/lib/payroll-math.ts (NEW): single source of truth for payroll arithmetic — roundMoney/roundHours (NaN/Infinity/negative guards), computeThresholdSplit (the ONE canonical drift-free split used everywhere), computeSalary, computeBalance (clamped ≥ 0), composeSalaryRecord, safeNonNegative/safeRate.
- src/lib/trade-utils.ts (NEW): pure isHelperTrade/normalizeTrade shared by server & client.
- rate-resolver.ts: applyPriority now trade-aware — below threshold baseLow for everyone; above threshold helperHigh (Helpers) vs tradeHigh (other trades). resolveRateSync/resolveEmployeeRate/resolveRateMapForMonth take/derive isHelper. Custom rate + changelog override + defined TradeRate(+0.5 TL/Sup) still win.
- client-rate-resolver.ts: mirrored trade-aware logic + DEFAULT_CLIENT_BASE_RATES (3.5/6/7); resolveClientRate takes trade name.
- allocation-engine.ts: uses payroll-math everywhere (per-site hour accumulation rounded, splits via computeThresholdSplit, totals via composeSalaryRecord); camp_sitting rtPerHour calc trade-aware; computeAllocationSplit takes trade; NEW isDefaultLikeRate() — stored rates matching any shipped default (2.5/3.0/5.0/5.5 or current baseLow/helperHigh/tradeHigh) are re-priced on every run, genuine manual overrides preserved; fixed latent `tradeRate!` undefined-var bug (reuse resolver lowRate which already includes +0.5).
- recalculation.ts: getEmployeeRates trade-aware (also fixed async return type); computeMonthSplit delegates to payroll-math; all salary writes rounded/clamped via payroll-math.
- attendance-sync.ts, api/accounts (both record paths + stubs), api/accounts/employee-monthly: pass isHelper; baseLow fallbacks.
- api/base-rates: 3-field validation (finite, > 0), rounded, returns updated rates on PUT.
- api/working-hours: removed hardcoded `?? 2.5` fallbacks — new resolveDefaultLowRate() resolves custom > trade > baseLow per employee; hours/rates rounded.
- api/salary-records: GET computeGrossSalary uses canonical resolver (was hardcoded 2.5/5.0 ÷ divisors 3.0/5.5); POST resolves real low rate + effective trade (was 2.5/divisor + hardcoded 'Helper' trade) and UPSERTS instead of blind create — fixes unique-constraint crash when a soft-deleted row occupies the key; PUT recomputes totalSalary/balance via payroll-math.
- api/salary-records/export-excel: DB rates + trade-aware computeGrossSalary (was hardcoded constants); balances clamped.
- api/employees/hours-summary: rate labels ("Base (3.5)", "Helper premium (6)"), isHelper in payload; rate filters now semantic (base / helper_premium / trade_premium / Custom) instead of hardcoded '2.5'/'5.0'/'3.0'/'5.5'.
- accounts-page.tsx: Manage Rates dialog 3 fields (Base Rate / Helper Premium / Trade Premium); trade-change reset sets baseLow + helper-or-trade premium; editable grid recomputes via payroll-math + canonical split; headers "Base Rate 3.5" / "Premium 6 (Helper) / 7 (Trade)".
- consolidated-salary-page.tsx, employee-hours-ledger.tsx, employee-hours-directory.tsx: new BaseRates shape, trade-aware resolution, API-driven rate badges, semantic filters.
- scripts/migrate-rates.mjs (NEW): upserts BaseRate singleton (3.5/6/7) and re-prices every existing month; re-priced old default rates 2.5/3.0 → 3.5 and 5.0/5.5 → 6/7 by trade while preserving genuine custom rates. Result: 878.00h preserved exactly, salary 2195.00 → 3073.00, distribution standard@3.5.
- Verified end-to-end via APIs + browser: /api/base-rates returns 3.5/6/7; hours-summary shows Helper above threshold @ 6; created a Mason trade worker with 1200h → allocation split 1000h@3.5 + 200h@7.0 = 4900 ✓; switched to Helper → re-allocation to 200h@6.0 = 4700 ✓; Excel export 40h×3.5=140 ✓; Accounts page renders new headers + 3-field rates dialog; test data cleaned up (final: 878h = 3073 salary).
- eslint clean on all modified files (0 errors); next build succeeds; tsc error count reduced vs baseline (fixed base-rates casts + async signature).

Stage Summary:
- New pay structure live: base rate 3.5 below threshold for everyone; after the cumulative threshold, Helpers earn 6.0 and other trades 7.0. Custom rates, per-month changelog overrides and defined TradeRates (+0.5 TL/Sup) still take priority.
- Salary math centralized in payroll-math.ts — consistent 2dp rounding, drift-free threshold splits, clamped balances, no hardcoded rates anywhere in the pipeline.
- All existing salary data re-priced to the new structure with hours verified unchanged (878.00h).
- Commit: b0fb769

---
Task ID: threshold-terminology-rename
Agent: main (Z.ai Code)
Task: Remove all user-facing "Premium"/"Basic"/"Standard" tier terminology — it's just a threshold, display 1000

Work Log:
- Kept all internal data identifiers (rateTier: 'standard'|'premium', premiumRecordId, filter values helper_premium/trade_premium) untouched for DB/API compatibility; only user-visible strings changed.
- employee-hours-ledger.tsx: milestone gauge "Current Tier" stat (Premium/Standard) now displays the threshold value (1000) labelled "Threshold (hrs)"; bottom summary "Rate Tier" card likewise shows 1000 / "Threshold (hrs)"; both custom-rate-cleared toasts reworded to "Base rate will apply again (6/7 after the 1000h threshold)". Role badge "Standard" (Supervisor/TL/Standard) kept — role, not rate.
- accounts-page.tsx: grid header "Premium 6 (Helper) / 7 (Trade)" → "After 1000h — 6 (Helper) / 7 (Trade)"; Manage Base Rates dialog description rewritten without "premium"; sections now "Base Rate (Below 1000h)" / "After 1000h — Helpers" (label "Helpers") / "After 1000h — Other Trades" (label "Other Trades").
- employee-hours-directory.tsx: rate filter options → "Below 1000h (Base)", "Helpers — After 1000h", "Other Trades — After 1000h" (values unchanged).
- api/employees/hours-summary: rateLabel now `After ${threshold}h (6)` / `Below ${threshold}h (3.5)` using the dynamic threshold variable (was "Helper premium (6)" / "Base (3.5)").
- employee-page.tsx: custom-rate help text → "overrides ALL rates (3.5 base rate and the 6/7 rates after the 1000h threshold)"; placeholder → "Leave empty to use default rates".
- Verified via curl + agent-browser: filter dropdown options render correctly; directory badges show "After 1000h (6)" / "Below 1000h (3.5)"; John Doe (1050h) ledger shows threshold stat 1000; Accounts headers + rates dialog verified with 3.5/6/7 fields; eslint clean on all 5 modified files.

Stage Summary:
- All UI copy now speaks in plain threshold terms: 3.5 below 1000h, 6/7 after 1000h. No "Premium"/"Basic"/tier names anywhere user-visible; internal rateTier identifiers unchanged.

---
Task ID: attendance-pdf-header-ux-colors-merge
Agent: main (Z.ai Code)
Task: 1) Attendance PDF totals in a 2-column info block; 2) UI fixes (dashboard date, attendance switcher, accounts search/header, presence chip); 3) calmer accounts palette, muted attendance hints, global site-assignment persistence + proper merged columns for moved employees

Work Log:
- attendance-sheet.tsx: info section rebuilt as a bordered 2-column table (print HTML + live preview):
  Col 1 = CLIENT NAME / PROJECT NAME / DATE; Col 2 = STRENGTH / TOTAL PRESENT / TOTAL ABSENT.
  Added editable presentInput/absentInput states, threaded through buildPageHtml + generateAllPagesHtml.
- dashboard-page.tsx: removed the green date line under the "Dashboard" title (todayDisplay + CalendarDays chip); verified both still used elsewhere (no unused imports).
- attendance-page.tsx: removed the duplicate Year/Month <Select> dropdowns (chevron month navigation remains; it already handles year rollover); removed now-unused YEARS constant.
- app-header.tsx: removed the notification bell popover, the user dropdown (username), and the online-presence chip; header-controls-slot now flex-1 (no max-w-md) so page search bars use the full header width without overlapping the right-side action buttons. Profile/logout live in the sidebar user card.
- app-sidebar.tsx: presence fetch moved here; online chip renders directly below the company logo in BOTH states — expanded: labeled chip "N online"; collapsed: compact dot + count centered in the rail. Collapsed user card now stacks avatar (click = Profile) + logout button.
- accounts-page.tsx (calm palette): SITE_HEADER_COLORS reduced to one neutral slate scheme; header action buttons uniform slate-700 (emerald reserved for Save All; no glows); month pills selected = light slate; summary cards + grand totals card neutral icon boxes with semantic colors only (Paid=emerald, Unpaid=red, negative balance=red); table headers and rate/salary columns neutral slate; removed cyan/amber/emerald/violet cell tints; Teko badge + TL marker + custom-rate text muted.
- attendance-page.tsx (hints muted): page subtitle, "Mark all" label, keyboard-hint paragraph (italic slate-600), legend (slate-500 + subtle kbd chips), site action buttons (Add Employee/Share/Sheet → slate), Total Hrs / Camp Hrs headers → neutral slate.
- Global assignment persistence: dialog text + success toast now state the assignment is global until moved/removed (PUT /api/employees/[id] already updates Employee.currentSite + currentSiteId, stamps removedDate on the old site's EmpCountSitePerMonth, and creates the new site's record + zero-hour WorkLog).
- Proper merged columns for moved employees (employeesBySite): per-site active ranges instead of always-full-month — movedAway rows: activeUntil = clamp(removedDate); current-site rows joined mid-month: activeFrom = latest other-site removedDate (movedHereOn). Safety extensions use siteId-tagged marks (firstMarkedDate/lastMarkedDate) so no mark is ever hidden by a merge; nextSite falls back to emp.currentSite; movedAway visibility now requires marks belonging to THAT site.
- Verified end-to-end in browser: sheet shows the 2-column totals block and PDF/print generation runs clean; dashboard has no green date; attendance has a single month switcher + muted hints; accounts header buttons aligned with full-width search (no overlay) and calm palette; sidebar chip correct expanded AND collapsed; simulated a mid-month move (Riyadh→Jeddah, day 15, marks Sep 3 @Riyadh + Sep 20 @Jeddah): Riyadh row = faded marks to day 15 then ONE merged "JEDDAH MALL PROJECT" cell; Jeddah row = ONE merged "RIYADH TOWER SITE" cell for days 1-14 then editable days; totals per site correct; test data reverted (John back at Riyadh, records cleaned).
- eslint: 0 errors across src (1 pre-existing warning in use-search-navigation.ts, untouched).

Stage Summary:
- Attendance PDF now prints Strength/Total Present/Total Absent in a 2-column partitioned header block (editable fields, PDF/print/preview all in sync).
- Header decluttered (no username/bell/presence); presence chip lives under the logo and survives sidebar collapse; page search bars use full header width.
- Accounts page re-skinned to a calm slate + single-accent system; attendance instructions downgraded to subtle hints.
- Site assignment from Attendance is global (until changed/removed) and mid-month moves render with exact merged site-name columns on both old and new site grids.
