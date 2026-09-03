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

---
Task ID: print-fix-badges-empcode
Agent: main (Z.ai Code)
Task: 1) Fix attendance print layout (stretched employee row) + wider signature column; 2) remove Leave/Cancellation Requests from the Notifications page + live count badges on sidebar items (incl. Notifications); 3) full EMP.CODE visible in the attendance grid

Work Log:
- attendance-sheet.tsx (print fix): root cause of the stretched row — `.main-table{height:100%}` inside a flex-1 wrapper distributes ALL leftover page height across only the real employee rows (1 employee = 1 giant row filling the sheet). Fix: blank ruled filler rows now complete every page grid (16 slots first page / 20 after, from FIRST_PAGE_ROWS_COUNT / ROWS_PER_PAGE), so leftover height is shared uniformly (~40px per row) and the sheet reads like a pre-ruled paper form. Applied to BOTH the print/PDF HTML builder (buildPageHtml) and the live React preview (preview filler tds fixed at 40px).
- Signature column widened 15% → 23% (widths now 7/37/16/17/23) in tableHeaderHtml (print/PDF), the preview main table, AND the preview EXTRA EMPLOYEES table (previously mismatched fixed px widths — now aligned to the same percentages everywhere).
- Verified by downloading the real PDF from the UI: employee row normal height, 15 uniform ruled fillers, wider signature column, extra-employees table column-aligned with the main table. (Note: a stale PDF from the earlier session exists in ~/Downloads — check timestamps before comparing.)
- notification-page.tsx: removed the "Requests" tab and the LeaveRequestsTab / CancellationRequestsTab components (~640 lines) plus now-unused RequestCard, generateLeaveApplicationHtml, printLeaveRequest, calculateTotalDays, formatFormalDate, MONTHS/YEARS constants, LeaveRequest/CancellationRequest types and FileText/CalendarDays/Ban/Printer/HourglassIcon/CheckCircle2/XCircle/Select imports (bulk deletions via scripts/trim-notifications-page.py with per-line boundary assertions). Notifications page = exactly two tabs: Warnings (default) + Fines; subtitle updated.
- app-sidebar.tsx: one combined counts fetcher (GET /api/notifications?limit=1 + /api/leave-requests?status=pending + /api/cancellation-requests?status=pending) refreshing every 30s, on window focus, AND on a new custom window event 'asm:refresh-badge-counts'. Generic per-item badge rendering: Notifications = blue (unread), Leave Requests = amber (pending), Cancellations = red (pending); expanded = count Badge, collapsed = compact top-right dot (min-w-4, "9+" overflow). Verified in both sidebar states via DOM + screenshots (the attendance active-pill was correctly distinguished from badges during checks).
- leave-request-page.tsx + cancellation-request-page.tsx: dispatch 'asm:refresh-badge-counts' after successful create/review so sidebar badges update instantly.
- attendance-page.tsx: Emp. Code column w-24 → w-28 (header + cells), truncation removed (whitespace-nowrap) — "ASM-2025-001" fully visible in the grid.
- Browser verification: badges appear/clear live with real pending requests created via API; notifications page shows only Warnings/Fines; sheet preview + downloaded PDF correct; full emp code visible. eslint: 0 errors (1 pre-existing warning in use-search-navigation.ts, untouched).
- Test data fully cleaned: scripts/cleanup-badge-test-data.ts + scripts/cleanup-badge-test-2.ts removed both test requests, all test notifications, and restored the employee to active; API counts re-verified 0/0/0.

Stage Summary:
- Attendance print/PDF no longer stretches a single employee row across the page — every page renders as a uniform pre-ruled grid with a 23% signature column; preview, print and PDF all match.
- Notifications page is now Warnings + Fines only; leave/cancellation management lives exclusively in their side-panel pages.
- Sidebar shows live count badges on Notifications / Leave Requests / Cancellations (expanded + collapsed), refreshing every 30s, on focus, and instantly on request create/review events.
- Attendance grid shows the full employee code without ellipsis.
- Session note: a tool-infrastructure outage occurred mid-verification; after recovery the remaining cleanup + this worklog entry were completed. No code changes were lost.

---
Task ID: attendance-print-a4-continuous-preview
Agent: main (Z.ai Code)
Task: Attendance print rows stretched too tall — make rows normal (keep only the signature column wide); preview = one long continuous page; print/PDF = properly chunked A4 pages; push to GitHub

Work Log:
- Root cause of the stretched print rows: getPrintCSS kept `.main-table { height:100% }` (+ tbody 100%) inside the flex page, so Chrome distributed the leftover page height across rows NON-uniformly (content rows grew far taller than the empty filler rows). The 16/20 row counts were also calibrated for stretched rows, leaving pages sparse.
- attendance-sheet.tsx rebuilt around two independent layouts:
  * PREVIEW (on-screen): ONE long continuous white sheet — letterhead, 2-col info block, then a single table listing ALL employees (serials 1..N, editable cells, sticky thead with inset-box-shadow borders so it stays readable while scrolled), then the EXTRA EMPLOYEES table. No A4 cards, no filler rows, no "PAGE x OF y". Toolbar gained a muted hint: "Continuous preview — Print / PDF splits it into A4 pages automatically".
  * PRINT/PDF: employees chunked by NEW chunkPrintPages() into A4 pages with capacities calibrated for normal 32px rows: single page 18 (extras below), first page 24, middle pages 28, last page 21 (reserves room for the extras block). Edge cases: 19-24 employees → page 1 takes all rows and extras get their own continuation page; last chunk always ≤ capacity. Each printed page completes its grid with blank ruled filler rows (&nbsp; cells) at the SAME 32px height, so filled and blank rows are indistinguishable in height.
- getPrintCSS: removed the height:100% stretching entirely; `tbody tr { height:32px; page-break-inside:avoid }`; td padding 8px→7px vertical; `.page` height 297mm→296.5mm (guards the sub-pixel rounding that emits a blank page after every sheet when printing). Column widths unchanged (7/37/16/17/23) — signature stays the only widened column at 23%.
- Global @media print fallback (Ctrl+P of the continuous sheet) now sets tr page-break-inside:avoid + thead display:table-header-group so the browser paginates the long table cleanly with a repeating header row.
- buildPageHtml takes a pre-computed fillerCount; pageRefs/chunkRows/A4_HEIGHT_MM/old row-count constants removed; serial offsets via reduce over printPages.
- Verified end-to-end with 30 temporary test employees added to Riyadh Tower Site (31 total): preview = single continuous table (37 tbody rows incl. info/extras), sticky header confirmed while scrolled; Download PDF → exactly 2 A4 pages (595.28×841.89pts) — page 1 = letterhead + info + rows 1-24 all at normal height; page 2 = date line + rows 25-31 + uniform ruled fillers + EXTRA EMPLOYEES block, nothing overflowing; signature column visibly the widest on both. Single-employee site re-verified after cleanup: exactly 1 A4 page — John Doe in row 1 at normal height + 17 identical ruled blanks + extras block. eslint clean; tsc: no errors in the file; no browser console errors.
- Test data removed (scripts/cleanup-sheet-test-data.mjs): 0 test employees / 0 month records remain; helper scripts committed under scripts/ per repo convention.

Stage Summary:
- Preview is now one long continuous page; Print/PDF chunks employees into properly filled A4 sheets (18/24/28/21 rows by page role) with uniform normal-height ruled rows — no more stretched rows; only the SIGNATURE column stays wide (23%). Filler rows, extras block and page numbers render on print pages only.

---
Task ID: attendance-site-move-fix
Agent: main (Z.ai Code)
Task: Fix attendance being marked at the WRONG site after a mid-month employee site transfer (mark Date 2 at Site 2's grid was showing up in Site 1); test all paths + edge cases; push to GitHub

Work Log:
- Reproduced the exact UI flow via API first (scripts/repro-site-move-bug.ts): DB writes were CORRECT when the client sent siteId — so the visible bug was the UI local-state layer, plus several real mis-attribution paths found by code review:
  * (UI, root cause of the report) attendance-page.tsx handleStatusChange updated/created the local attendance record WITHOUT siteId → after marking Date 2 in Site 2's grid the record rendered in Site 1's moved-away row too (the move day is in-range for BOTH grids) and polluted Site 1's hour totals until reload. Fix: local state now uses the SERVER-saved siteId (data.data.attendance.siteId).
  * (UI) Ctrl+Z undo dropped siteId → server fell back to employee.currentSiteId and re-attributed the restored record to the employee's NEW site. Fix: undo entries now record siteId (prev record's site, else the grid's site) and undo passes it through handleStatusChangeRef.
  * (UI) Bulk-mark "Mark all Present/Absent" didn't send the grid's siteId; server used each employee's currentSiteId. Fix: body now includes siteId; bulk-mark route validates it and tags ALL records with the grid site (falls back to currentSiteId only for global marks without site context); version capture grouped by the bulk site when provided.
  * (API) POST /api/attendance: explicit siteId is now VALIDATED to exist; bogus ids fall back to currentSiteId instead of causing an FK 500. Version capture now uses the RESOLVED site (the grid the mark was made in) instead of blindly employee.currentSiteId.
  * (lib) captureAttendanceVersion: snapshot now ALSO includes employees who have a record for that date tagged to that site but no longer have currentSite == site (moved employees), and the attendance fetch is scoped to (siteId match OR legacy siteId null) so records from a different site can't leak into the snapshot.
  * (API) PUT /api/employees/[id] site-move handler: when the employee had NO EmpCountSitePerMonth row for the current month at the old site, updateMany matched 0 rows and the old site silently lost the employee from its monthly headcount. New closeOutOldSite() helper backfills the old-site row (removedDate = now) and revives legacy soft-deleted rows.
- Disk corruption incident: 60+ tracked files (select.tsx, tsconfig.json, base-rates.ts, recalculation.ts, many route.ts, db/custom.db...) were found NUL-filled or truncated to 0 bytes in the working tree (fallout from the earlier tool-infrastructure outage). All restored from git HEAD via targeted git checkout; dev server restarted with a clean .next; tsc/eslint re-verified clean.
- Test suite (scripts/test-site-move-edge-cases.ts): 35/35 PASS covering — core scenario (D1@S1 → move → D2@S2 lands at S2); past-date mark at old-site grid while current site differs; bogus siteId fallback (no 500); no-siteId fallback; bulk-mark with/without siteId; move-back clears removedDate + marks at S1; undo path re-writes at ORIGINAL site; per-site salary split (10h/10h) and S2 salary removal after clearing; version capture attributed to the resolved site + moved employee present in snapshot; site-assignments API date ranges; double move S1→S2→S3 with chain of removed/active rows; cross-month isolation (prior-month record untouched); siteless employee; move with zero prior rows backfills old-site row.
- Browser verification (agent-browser, admin@asm.com): Riyadh grid — marked Sep 1 present; moved employee to Jeddah Mall Project; Jeddah grid shows merged "Riyadh Tower Site" cell for Sep 1 and editable Sep 2+; Riyadh row faded/read-only with its Sep-1 "10" and days 2+ merged as "Jeddah Mall Project"; marked Sep 2 in JEDDAH's grid → DB record siteId=JEDDAH, Jeddah Hrs=10, Riyadh Hrs unchanged; Ctrl+Z cleared the mark with site=JEDDAH (not the current-site fallback); reload → state persists. All test data cleaned afterwards (employee, records, assignments, salary, versions).
- eslint: 0 errors on all 5 modified files.

Stage Summary:
- Attendance marks now stick to the site grid they were made in — before AND after a mid-month transfer — across every path: cell mark/clear, keyboard marks, Ctrl+Z undo, bulk mark-all, share links, and the version history. The old site keeps the employee's historical marks and headcount, the new site owns everything from the move date, and salary hours split per site exactly along the same boundary.

---
Task ID: 2
Agent: main (Z.ai Code)
Task: Fix "attempt to write a readonly database" error when adding attendance (user screenshot showed ConnectorError on POST /api/attendance); push the code.

Work Log:
- Read the user's screenshot: error toast "Invalid ... invocation ... const attendance = await ... Error occurred during query execution: ConnectorError(message: Some(\"attempt to write a readonly database\"))" — a SQLite write-permission failure, not app-logic.
- Diagnosed environment: .env DATABASE_URL=file:/home/z/my-project/db/custom.db; db dir/file owned by z:z with write bits; direct python sqlite3 write to the file SUCCEEDED (so the file itself was writable).
- Found root cause via /proc/<next-server-pid>/fd: the dev server (started 06:46) held file descriptors to DELETED inodes of custom.db ("custom.db (deleted)") — the db file had been deleted+recreated by the earlier disk-corruption `git checkout` restore (db mtime 07:02) while the server kept running. SQLite refused writes through the stale handle state → "attempt to write a readonly database".
- Restarted the Next.js dev server (killed stale process tree; relaunched `node node_modules/next/dist/bin/next dev -p 3000`, log at scripts/dev-server.log). Note: `npm exec next dev -p 3000` misparses `-p` in this env (npm exec swallows it → next treats 3000 as a directory); use the direct binary path instead.
- Wrote persistent E2E test scripts/test-attendance-write.py: reads a real site+employee from SQLite (ro), POSTs attendance through the HTTP API, asserts 200 + DB row with correct siteId, then deletes the test row.
- API verification: POST /api/attendance → 200 {"success": true}; DB row confirmed (present, correct siteId); test row cleaned.
- Browser verification (agent-browser, admin@asm.com/admin123): login OK → Attendance page → Jeddah Mall Project grid (John Doe, Sep 2) → focused day-2 cell, pressed P → DB row (2026-09-02, present, siteId=Jeddah cmrfzfzkj0002pfrj370a03qo) — mark lands in the grid it was made in, no error toast; screenshot scripts/attendance-mark-verified.png; Ctrl+Z undo works; all test rows/tombstones removed afterwards (John Doe Sep-2 clean).
- Confirmed no stray records; total attendance rows back to 8.
- Committed db/custom.db data sync as b0a4916 and pushed with PAT: 5012161..b0a4916 main -> main; git fetch refreshed tracking; remote HEAD verified b0a4916.

Stage Summary:
- Readonly-db error was environmental (stale deleted-inode fds after the corruption restore), NOT a code bug — no source changes needed. Dev server restarted with a fresh handle on the current custom.db; attendance add verified working via both API and real UI grid flow (including correct site attribution and undo).
- Ops notes for future sessions: (1) after ANY git operation that replaces db/custom.db (checkout/restore/pull) or any `db:push`, restart the dev server or writes fail as readonly; (2) start the dev server with `node node_modules/next/dist/bin/next dev -p 3000`, not `npm exec` (arg parsing bug); (3) `db/custom.db` is git-tracked and is the data-sync mechanism to the user's GitHub.

---
Task ID: 3
Agent: main (Z.ai Code)
Task: Hide an employee's name from a site's attendance grid when they have NO attendance data there — records at the OTHER site (and not_marked tombstones) must not count as attendance data. Push the code.

Work Log:
- Diagnosed the leak with live data: John Doe's currentSite=Riyadh, but a STALE Jeddah assignment row (EmpCountSitePerMonth, removedDate=NULL) existed from earlier move tests. Grid logic computed movedAway = !isCurrentSite && !!removedDate → false → John rendered as a fully active, editable row at Jeddah where his only records were not_marked tombstones (Sep 2-4).
- Fix in src/components/attendance/attendance-page.tsx (employeesBySite useMemo):
  1. movedAway = !isCurrentSite (stale rows without removedDate now count as moved away → existing no-data skip applies to them).
  2. New consolidated VISIBILITY RULE: moved-away employees stay at the old site only with P/A/C/O marks tagged to THAT site; currently-assigned employees are hidden in PAST months with zero marks at the site; the CURRENT month always keeps the roster visible so people can be marked. hasMeaningfulData() treats not_marked/no_site and other-site siteIds as NOT data.
  3. Early-skip assignments whose createdDate > viewed month end (stops clampToMonth from faking activeFrom inside past months — phantom rows).
  4. activeUntil fallback for moved-away rows without removedDate (lastMarkedDate ?? monthEndStr).
  5. Pass-2 (currentSite fallback) gets the same past-month no-data guard (siteId resolved via new siteIdByName map; sites added to useMemo deps).
  6. CRITICAL bug found while testing: pass 1 add()ed the (emp,site) dedupe key BEFORE skipping, so skipped rows blocked the pass-2 fallback → John vanished from Riyadh in August too. Fixed with added.delete() at every skip site.
- eslint 0 errors; tsc clean for the file.
- Browser verification (agent-browser, admin@asm.com):
  * September (current): Jeddah panel = "0 employees / No active employees assigned to this site" (John gone); Riyadh = John with Sep-1 present "10" intact (screenshot scripts/verify-sept-after-fix.png, verify-sept-riyadh.png).
  * August (past): Riyadh = John with Aug 1/3/4/5 "10" cells (data-driven history); Jeddah = none (screenshot scripts/verify-august-riyadh.png).
  * Found + fixed the dedupe-key collision above, re-verified August shows John again.
- Pushed: b0a4916..3e314b7 (platform auto-commit dfb5d3d + fix 79c21f3 + db sync 3e314b7); remote main verified, tracking in sync.

Stage Summary:
- A site's grid now shows only employees with REAL attendance data at that site (P/A/C/O with matching siteId). not_marked/no_site tombstones and other-site records never keep a row alive. Stale assignment rows without removedDate no longer create active phantom rows. Current-month roster stays visible for marking; past months become fully data-driven. AttendanceSheet and bulk-mark inherit the same list automatically.

---
Task ID: 4
Agent: main (Z.ai Code)
Task: Consolidated Salary Sheet — Rate column must show the rate ACTUALLY used for each employee's salary (only 7 if 7 was used, only 3.5 if 3.5 was used), not a blanket "3.5/7". Push the code.

Work Log:
- Traced the label to src/components/consolidated-salary/consolidated-salary-page.tsx: old logic `lowRate === highRate ? lowRate.toFixed(2) : "${lowRate}/${highRate}"` printed "3.5/7" for EVERY base-rate employee because baseLow (3.5) never equals helperHigh/tradeHigh (6/7) — regardless of which tier actually produced the salary.
- Verified live data: John Doe (Mason, cum 1050h) has Feb–Jun 2026 standard records (all hours at 3.5) and Aug–Sep 2026 premium records (all at 7.0); no straddle months exist. All rows wrongly displayed "3.5/7".
- New rateLabel logic (rows in the flat table): only below-threshold hours → lowRate only ("3.5"); only above-threshold hours → highRate only ("7"); both tiers present (rare threshold-straddle month) → both "3.5/7" (accurate); camp_sitting hours counted as low-rate usage (they're charged at lowRate); zero hours → unchanged tier preview. Rates formatted without trailing zeros (parseFloat(toFixed(2)) → "3.5"/"7"/"6"/"5.5").
- Updated the Rate cell tooltip and the bottom legend to describe the new behavior.
- Fixed pre-existing TS error surfaced by tsc (present on HEAD): FlatEmployee was missing isTeko/tekoInfo so the TEKO badge could never render — added fields to the interface and carried them through buildFlatEmployees.
- eslint 0 errors; tsc clean for the file.
- Browser verification (agent-browser, admin@asm.com → Consolidated Salary):
  * September 2026: John Doe Below 0 / Above 20 → Rate "7", gross 140 (screenshot scripts/verify-rate-sept-row.png).
  * February 2026: Below 40 / Above 0 → Rate "3.5", gross 140 (screenshot scripts/verify-rate-feb-row.png).
  * August 2026: Below 0 / Above 40 → Rate "7", gross 280.
  * No console/page errors.

Stage Summary:
- Rate column now reflects the actual rate applied to each employee's salary for the selected month; "3.5/7" appears only in the genuine straddle case (hours on both sides of the 1000h threshold in one month). Custom-rate and trade-rate employees keep showing their single effective rate. Also fixed the latent TEKO-badge type gap in the same file.

---
Task ID: 5
Agent: main (Z.ai Code)
Task: (1) Fix "attempt to write a readonly database" error when adding an advance; (2) Recurring advances must support an end month/year until which the deduction runs; test all cases and edge cases. Push the code.

Work Log:
- Readonly-db regression: identical to Task 2 — running next-server held fds to a deleted db/custom.db inode (db file replaced by git ops while server lived). Restarted dev server; write test (scripts/test-attendance-write.py) passed. NOTE: git stash/stash-pop during tsc-baselining replaced the db inode AGAIN mid-session and silently re-broke writes — had to restart once more. Rule reinforced: ANY working-tree db replacement (checkout/restore/stash/pull) requires a dev-server restart before write paths are trusted.
- Feature implementation:
  * prisma/schema.prisma: Advance.recurringUntil String? (YYYY-MM, inclusive end month; null = legacy "until repaid"). db:push + client regenerated.
  * src/lib/advance-deduction.ts: eligibility now skips advances whose recurringUntil < monthKey (inclusive end); RecurringAdvance carries recurringUntil.
  * /api/advances POST: normalizeRecurringUntil() validates format (YYYY-MM) and end>=effective; one_time ignores the field (stored NULL); bulk + single modes store it.
  * /api/advances/[id] PATCH: accepts recurringUntil (set/clear/null), validates format and >= effective month.
  * /api/advances/pending-by-month GET: new recurringAdvances[] array (active recurring starting that month, with monthlyDeductionAmount/remainingBalance/recurringUntil) — totalPending/byEmployee semantics untouched (Accounts badge unaffected). Also fixed pre-existing currentSite type gap.
  * advance-page.tsx: "Deduct until (optional)" UI (Set end month toggle -> month+year selects, defaults to effective+12mo), client validation (end >= effective, monthly amount > 0), toast mentions the end month, handleSave deps fixed (stale closure on deductionType/monthly amounts), Pending Advances tab now renders a violet "Recurring advances starting <month>" section with DHS/mo · until X · remaining badges + delete.
- PRE-EXISTING BUG FOUND while testing (fixed): /api/accounts merged recurring deductions into pendingByEmp AFTER the salary-record merge had consumed the map — recurring deductions never appeared in months where the employee already had salary records. Restructured: one-time + recurring fill pendingByEmp first, then the merge runs (condition changed from pendingAdvances.length>0 to pendingByEmp.size>0).
- PRE-EXISTING BUG FOUND while testing (fixed): accounts-page.tsx + consolidated-salary-page.tsx mergeApiEntries read deduction/advance only from the STANDARD-tier record — premium-only months (e.g. John Sep 2026) showed "-" for advance. Now falls back premium -> camp, mirroring the server merge (standard first, else first record).
- Also fixed pre-existing tsc gaps in accounts/route.ts (missing isTeko in missing-employees select; stub entry missing isTeko) — tsc now clean for every touched file; remaining errors (advances/apply, scripts/repro-site-move-bug.ts) are untouched pre-existing.
- Tests: scripts/test-recurring-until.py — 31 checks, ALL PASS:
  * POST validation: until<effective 400; invalid format 400; invalid effectiveMonth 400; one_time ignores until; until==effective OK; mixed bucket OK.
  * PATCH: set/extend/shorten/clear; <effective 400 keeps value; invalid format 400.
  * Eligibility via /api/accounts (real display path, John's record months): 13.13-until-Apr present Feb/Mar/Apr (INCLUSIVE), gone May+; no-end 13.14 continues Feb..Sep; one-time 77.77 in May only; start-month advance appears in Sep; months without salary records show nothing (pre-existing semantics — deductions apply at salary save/pay time).
  * pending-by-month recurring section + untouched totalPending; zero AdvanceRepayment rows and untouched remainingBalance after all GETs; hard cleanup leaves Advance table empty.
- Browser verification (admin@asm.com): added John via bucket -> Recurring -> Set end month (Dec 2026, defaulted Sep 2027) -> Save succeeded (user's original error flow now clean); Pending tab shows violet recurring card "50.00 DHS/mo · until December 2026 · remaining 100.00"; Accounts Sep shows John Advance 50.00 and Net 20.00 (70-50); UI delete of the test advance works (soft); test row hard-deleted afterwards.

Stage Summary:
- Adding advances works again (root cause environmental, fixed by dev-server restart; ops rule: restart after ANY db file replacement).
- Recurring advances now support an optional inclusive "deduct until" month/year end — enforced in the deduction engine (single source of truth used by /api/accounts display, bulk-save and toggle-paid), validated at both create and edit, visible on the Advance page.
- Two pre-existing advance-display bugs fixed along the way (recurring merge ordering in /api/accounts; premium-only months losing advance/deduction display on Accounts + Consolidated pages).

---
Task ID: 6
Agent: main (Z.ai Code)
Task: Side panel (sidebar) menus are not scrollable on smaller or bigger screens. Fix and push.

Work Log:
- Reproduced with agent-browser at 1280x620 (admin@asm.com): nav ScrollArea viewport measured clientH=656 == scrollH=656 (canScroll=false); last item "All Logs" bottom at 795px vs 577px window — bottom items and the user footer were unreachable on short viewports.
- Root cause: in src/components/layout/app-sidebar.tsx the nav <ScrollArea className="flex-1"> is a flex child; flex items default to min-height:auto, so the scroll box grew to its CONTENT height instead of being capped by the leftover space. The Radix viewport (h=100% of root) therefore equalled the content height and never scrolled; the footer was pushed off-screen whenever 15 nav items exceeded the viewport height (short laptops, zoomed browsers, phones).
- Fix (app-sidebar.tsx only):
  * Nav ScrollArea: className "min-h-0 flex-1 overflow-hidden px-3 py-4" — min-h-0 lets the flex item shrink to the available space so the viewport gets a bounded height and scrolls; overflow-hidden keeps content clipped inside the rail.
  * Logo header and user footer sections: added shrink-0 so they keep natural height and the nav area always takes the remainder.
- Verification (agent-browser, all via real layout measurements + screenshots):
  * 1280x620: canScroll=true (clientH 335 < scrollH 656); scrolled to bottom -> "All Logs" visible + footer visible (scripts/verify-sidebar-scroll-short.png).
  * 1920x1080: fits without scrolling, footer pinned (no unnecessary scrollbar).
  * 1280x400 (extreme): canScroll=true, bottom reachable, footer pinned (scripts/verify-sidebar-400.png).
  * Collapsed 72px rail: canScroll=true, footer pinned.
  * Mobile 390x700 Sheet: canScroll=true, "All Logs" reachable, footer pinned (scripts/verify-sidebar-mobile.png).
  * Real trusted input: focus inside nav + PageDown scrolls 0 -> 278 (full range). Synthetic wheel events are untrusted and never scroll anything; agent-browser scroll targets the window, so keyboard input was the conclusive real-input test.
- eslint 0 errors; tsc clean for the file.

Stage Summary:
- Sidebar navigation now scrolls within the available height on ANY screen size (short laptops, zoomed browsers, mobile sheet) and in both expanded/collapsed states; logo, online-presence chip and user footer stay pinned. No API/db/schema changes.

---
Task ID: 7
Agent: main (Z.ai Code)
Task: New "Documents" side panel menu with automated NOC creation (exact reference format, editable/sortable employee table, A4 PDF, download + print, archive grouped client → month/year) plus employee document storage (passport/ID/visa scans + named other documents). Push.

Work Log:
- Analysed the 4 reference NOC PDFs (PROSCAPE ARABIAN RANCHES / DAMAC LAGON / GREEN AND MORE WARSAN / INTERMASS JOURI HILL): shared letterhead (EN name + black ASM shield box + Arabic side + contacts), To/Date block, Subject/Project, standard liability paragraph, bordered 6-column table (Sn.No | Name | Trade | Company | Nationality | Passport #), signature block with stamp, footer motto "Combination of Skills, Strength, Life & Ethics" on every page. Letterhead/stamps are Word-stretched images, so exact 300-DPI region snapshots were taken from the rendered reference pages (scripts/snapshot-noc-regions.py → src/assets/noc/).
- src/lib/noc-pdf.ts: pdf-lib generator replicating the reference — A4, Times family, pixel-identical letterhead band (119pt), To/Date right-aligned, client block, Subject/Project, rich bold/regular body wrap, table with reference column ratios ([.083,.222,.112,.3097,.1404,.1329]), 8pt cells, line-count-driven row heights, page breaks mid-table, signature block placed on page 1 when it fits (10-row case) else page 2 (20-row case, exactly like the references), Procurement/Signed/None stamp options, footer on every page. Verified against references: 20-row NOC = 2 pages (all 20 rows on p1, signature p2), 10-row NOC = 1 page with signature.
- Prisma: NocDocument (clientName/projectName/clientAddress/nocDate DD-MM-YYYY/monthKey YYYY-MM/contact block/stampType/employeesJson snapshot/employeeCount/fileName/filePath/soft delete) + EmployeeDocument (employeeId/docType passport|id_card|visa|other/docName/fileName/filePath/mime/size/soft delete). db:push + dev server restarted (storage-inode rule).
- src/lib/document-storage.ts: storage/ root (git-ignored), uniqueFilePath dedupe ("file 2.pdf"), slugified client folders. Fixed a double "storage/storage/" resolution bug found by tests (resolveStoragePath now accepts both project-relative and storage-relative forms).
- APIs (all tested): /api/documents/noc GET/POST (validation: client, DD-MM-YYYY date, ≥1 named employee ≤500, stamp; PDF generated + stored under storage/noc/<CLIENT>/<YYYY-MM>/), /api/documents/noc/[id] GET/DELETE (soft + file removal), /api/documents/noc/[id]/pdf GET (inline/download; auto-regenerates from the employee snapshot if the file is missing), /api/documents/noc/preview POST (PDF without saving), /api/documents/employee GET/POST (multipart upload ≤20MB, pdf/img/doc), /api/documents/employee/[id] PATCH rename/DELETE, /api/documents/employee/[id]/file GET inline/download. Activity logged for create/delete/upload.
- UI src/components/documents/documents-page.tsx: two tabs. NOC tab: client details form (date defaults today DD-MM-YYYY, contact prefilled from reference), DB employee picker (debounced search), editable table (all fields inline-edit, uppercase like the reference, add blank row, duplicate row, remove) with click-to-sort on every column, Preview NOC (blob PDF in sticky viewer) and Confirm & Prepare NOC; viewer has Print (hidden-iframe window.print) and Download PDF; archive grouped client folder → month/year (e.g. "September 2026") with view/print/download/delete per NOC. Employee Documents tab: employee picker + Passport/ID Card/Visa/Other groups, upload per group (optional custom name for Other), rename, view, download, delete with confirm.
- Wired 'documents' AppView everywhere: app-store union, page.tsx (RESTRICTED_VIEWS + case), sidebar nav (FolderOpen icon, grantable 'documents' permission), permissions seed, admin-page permission list, app-header title map, command palette.
- Fixed pdf-lib not being a declared dependency (Turbopack module-not-found → npm install pdf-lib@1.17.1).
- Tests: scripts/test-documents-api.py — 39 checks ALL PASS (validation edge cases incl. bad date/empty rows/bad stamp/unknown employee/disallowed ext; creation; monthKey; M/S filename; file dedupe; inline+download serve; delete-file-then-regenerate; preview writes nothing; soft delete + file cleanup; upload/rename/rename-validation/delete; permissions seed). UI one-shot script (scripts/ui-test-documents.sh) verified end-to-end in the browser: login → Documents menu → builder → picker → edit/sort/add/remove rows → preview blob → save → archive grouping (client folder + September 2026) → print iframe → employee docs upload/rename/delete. eslint clean, tsc clean for touched files.
- Left one clean demo NOC (the user's PROSCAPE ARABIAN RANCHES reference data) in the archive; all API-test artifacts removed.

Stage Summary:
- Documents module shipped: NOC automation with exact reference layout (A4, letterhead, stamps), editable+sortable employee table pulled from the database, preview/save/download/print, archive grouped by client folder → month/year, and scanned employee document storage (passport/ID/visa/other) with naming, view, download, delete. Files persist under storage/ (regenerable from DB snapshots); access grantable per admin via the existing permission system.

---
Task ID: 8
Agent: main (Z.ai Code)
Task: Upgrade the Documents module to the full PRD (uploaded spec): dashboard, NOC numbering/drafts/versions/duplicate, multi-select picker, reorder + replace + validation warnings, header repeat on every PDF page, template settings, fine-grained in-module permissions, employee documents expiry/notes/replace, and documents on the employee detail page + registration-time upload.

Work Log:
- PRD delta analysis (upload/Pasted Content_1788425131445.txt): mapped all 73 sections against the shipped v1 and implemented the gaps.
- Prisma: NocDocument +nocNumber (unique per nocNumber+version — versions share the number), +status draft|final, +version; EmployeeDocument +expiryDate, +notes; new NocTemplate singleton (bodyText with {{company}} token, companyName, signatory contact). db:push (--accept-data-loss for the index change) + dev-server restart rule honoured.
- src/lib/noc-pdf.ts: table header now REPEATS on every continuation page (PRD §21/§70 acceptance), body text comes from the template with {{company}} rendered bold, standardized file name "NOC - CLIENT - PROJECT - DD-MM-YYYY.pdf" (§24/§56).
- src/lib/noc-template.ts: getNocTemplate/upsertNocTemplate with reference defaults.
- APIs: POST /api/documents/noc creates DRAFT (metadata only, no PDF, tolerant validation) or FINAL (full validation + PDF + storage); sequential NOC-YYYY-NNNNNN numbering; PATCH /api/documents/noc/[id] updates drafts and finalizes them (409 on final — never silently overwrite, §45); POST .../version creates the next VERSION draft of a final (same number, original PDF retained); POST .../duplicate copies client/project/employees into a new draft with a NEW number and today's date (§46); /api/documents/noc-template GET/PUT; draft PDFs are never served (404 — only finalized letters).
- Employee documents: upload accepts expiryDate (YYYY-MM-DD) + notes; stored files standardized to {DOC_TYPE}_{EMPLOYEE_NAME}.ext (§56); PATCH updates name/expiry/notes; new POST .../replace swaps the stored file keeping metadata (§33); GET ?stats=1 feeds the dashboard.
- Permissions (user requirement): new slugs documents_noc / documents_employee_docs / documents_delete (group "documents") seeded via the existing Permission system, with a one-time flag migration (__migration_documents_v1__) auto-granting them to admins who already had "documents"; Admin Management page lists them; the Documents page fetches grants and gates the NOC tab, Employee Documents tab and every delete action (super_admin bypasses).
- Documents UI rebuilt (documents-page.tsx ~1750 lines): Dashboard tab (summary cards Total NOCs / This Month / Draft NOCs / Employees With Documents, quick actions, recent documents §5); NOC tab = searchable/filterable list (search across NOC number/client/project/employee/passport, status + year filters, per-row view/print/download/duplicate/edit/delete, version badges) + client-folder archive (client → year → month per §26/§27) + guided Create/Edit workspace with ① Details ② Employees ③ Review ④ Preview ⑤ Complete step indicator (§50); recipient fields Address 1/2/City/Country (§8); multi-select employee picker with checkboxes and "Add selected"; editable table with per-column sort (third click resets), Move up/down, Reset order, per-row Change-employee (replace in place), duplicate, remove-with-confirm (§13/§16/§51); live warnings for missing/duplicate passports and duplicate names (§17/§53, warnings not blocks); drafts auto-save every 1.5s with "Draft saved HH:MM" + beforeunload guard (§54); preview via the same PDF engine (§23/§60); generate → Complete step with print/download/new-NOC actions; NOC Template tab (super_admin only) edits the controlled wording/signatory (§20/§62).
- Employee integration: employee-detail-page.tsx embeds the new shared EmployeeDocumentsPanel (categories with Available/Missing status, expiry badges with days/months colouring §36, upload modal with type/name/expiry/notes, preview/download/rename/replace/delete); employee ADD form gained a "Documents" tab that stages passport/ID/visa/other scans (+expiry) and uploads them right after the employee is created (registration-time upload, user requirement).
- Fixed: pdf-lib module-not-found regression (installed as direct dependency earlier — unaffected here); nocNumber unique constraint redesigned to (nocNumber, version); PATCH-final 409 guard; draft PDF 404.
- Tests: scripts/test-documents-api.py extended to 68 checks — ALL PASS (validation, drafts, numbering sequence, standard filenames, finalize, 409 guard, versioning with retained v1, duplicate with today's date, template GET/PUT used by preview, employee docs expiry/notes/stats/replace-ready, permissions seed). Browser E2E (scripts/ui-test-documents2.sh): dashboard cards, list+folders, workspace multi-select → 2 rows → preview blob → generate (NOC-2026-000019 stored), template save, employee-detail documents section with Missing indicators. eslint/tsc clean for all touched files (remaining employee-page errors verified pre-existing via git stash).
- Final state: archive holds exactly one clean demo NOC (NOC-2026-000020, the PROSCAPE ARABIAN RANCHES reference); template wording restored to the approved default.

Stage Summary:
- Documents module now implements the PRD's Phase-1 checklist end to end: dashboard, NOC numbering, drafts/auto-save, versions on edit, duplicate, search/filter lists, client→year→month folders, header-repeat multi-page A4 PDFs from a configurable template, print/download, fine-grained in-module permissions, and the employee document repository surfaced in Documents, on the employee detail page and at registration time.

---
Task ID: 9
Agent: main (Z.ai Code)
Task: Documents fixes + upgrades per user feedback: (1) NOC View button broken in All NOCs + client folders and dashboard view positioned oddly → open NOCs in a SEPARATE PAGE with back button + print + download instead of a modal; (2) stamps must NOT always be applied — per-NOC stamp toggle after the final draft; (3) store MULTIPLE stamps in the database and choose WHICH stamp per NOC; (4) multiple company names — choose the issuing company per NOC; (5) Employee Documents must list all employees as cards whose documents expand from the card; search must work; STRICT pagination everywhere; (6) NOC footer must carry the manager name, number and email as in the reference NOCs. Push.

Work Log:
- Root-caused the broken View: the old modal viewer only rendered when `tab !== 'noc'`, so View clicks in the NOC tab (All NOCs list + client folders) set state but painted nothing; from the dashboard it fell back to a fixed-position overlay. Removed the modal entirely and replaced it with a dedicated route-level page.
- NocViewPage (src/components/documents/noc-view-page.tsx) + AppView 'noc_view' + store.selectedNocId wired through app-store.ts, page.tsx (RESTRICTED_VIEWS + VIEW_PERMISSION_MAP→'documents' + case) and app-header title map. Full-page viewer: Back to Documents, Print (hidden-iframe), Download to device; the PDF iframe fills the viewport (calc(100vh-205px)). Drafts show a notice + "Continue editing" (draft PDFs stay 404 by design). All view entry points (dashboard recent, All NOCs rows, client-folder rows, workspace Complete step "Open NOC Page") route here.
- Schema (db:push + dev-server restart per storage-inode rule): NocDocument +stampEnabled (default FALSE — stamps are now opt-in) +stampId FK +companyId FK; new Stamp model (name, imagePath builtin:|storage-relative, isDefault, active, soft delete); new NocCompany model (unique name, optional letterheadPath, manager contactPerson/Phone/Email, active, soft delete). scripts/seed-stamps-companies.py (idempotent, also run post-commit-safe): seeds "Procurement stamp" (default) + "Signature stamp" as builtins, seeds company "ARABIAN SHIELD A/C. UNITS FIX. CONT" with the reference manager block (Ms. Mafeeda Kader / 050 797 4153 / mafeedaarabianshieldmanpower@gmail.com), migrates legacy rows (stampEnabled = stampType!='none', stampId ← matching builtin, companyId ← default company).
- noc-pdf.ts: stampEnabled=false draws NO stamp whatever the legacy type; explicit stampImagePath (Stamp row) wins over legacy procurement/signature assets; optional per-company letterheadPath falls back to the ASM letterhead. The signature/footer block (Thanks & Regards → company → manager name → number → email) is rendered exactly like the reference NOCs, now sourced from the chosen company with per-NOC overrides. noc-pdf-server.ts resolveNocAssets() centralises company/stamp/template resolution for create/finalize/regenerate/preview (never throws — falls back to template defaults).
- Stamp management APIs: GET/POST /api/documents/stamps (multipart upload ≤5MB png/jpg/webp → storage/stamps/, optional default), PATCH /api/documents/stamps/[id] (rename/set-default with single-default invariant), DELETE (soft, file cleanup for non-builtins), GET .../[id]/image (thumbnail serving for builtins + uploads).
- Company APIs: GET/POST /api/documents/companies (JSON or multipart incl. optional letterhead ≤10MB → storage/letterheads/), PATCH/DELETE /[id]. POST revives a soft-deleted duplicate instead of hitting the unique-name constraint (bug found by the test run: 500 on re-create after delete → fixed).
- Stamp toggle AFTER finalize: PATCH /api/documents/noc/[id] accepts { stampUpdate: true, stampEnabled, stampId } on FINAL NOCs — validates the stamp exists, re-renders the stored PDF in place (old file removed, new written, legacy stampType kept in sync), logs noc_stamp_update; every other PATCH on a final stays 409. The NocViewPage header exposes a Stamp switch + stamp picker; toggling re-fetches the PDF with a cache-buster.
- Strict pagination + light rows everywhere (employeesJson — the heavy column — is NEVER sent in lists any more): GET /api/documents/noc became view-based — view=stats (dashboard counters incl. employeesWithDocuments via distinct), view=recent (limit ≤20), view=list (page/pageSize ≤100/search across nocNumber/client/project/date/createdBy/employeesJson/status/year filters + total/totalPages), view=folders (client→year→month counts only), view=month (one client-month, paginated). UI: NocList is server-paginated with First/Prev/Next/Last + page-size (10/20/50) + debounced server search + status/year filters; NocFolderView lazy-loads each month on expand with "Load more" inside the month.
- Employee Documents rebuilt as a directory: GET /api/documents/employee?view=employees (page/pageSize ≤60/search name|empId|passport|trade|company/filter=all|with_docs) returns employees + per-type docCounts (groupBy). employee-docs-directory.tsx renders employee cards (initials avatar, doc-count pills per Passport/ID/Visa/Other, "No documents" badge) with strict pagination (12/24/48 + First/Prev/Next/Last); clicking a card expands the employee's documents inline via the existing EmployeeDocumentsPanel (upload per category, view, download, rename, replace, delete) — single-expanded accordion. Search is server-side and debounced; the old client-only picker (which drove the "search doesn't work" complaint) is gone from this tab; the panel remains reused on the employee detail page.
- NOC workspace: Details step gains Issuing Company select (drives letterhead/signature/{{company}}/manager footer) and the Apply-stamp switch (OFF by default + which-stamp picker when on); contact block auto-seeds from the chosen company; payload carries companyId/stampEnabled/stampId. Complete step adds "Open NOC Page".
- NOC Settings tab (super_admin): template editor (fallback company/contact fields renamed) + Issuing Companies manager (add with optional letterhead, manager name/number/email per company, remove) + Stamp Library (thumbnails via image endpoint, add with scan upload + default flag, set default, remove).
- Tests: scripts/test-documents-api-task9.py — 51 checks ALL PASS (stamps CRUD+image+default invariant+ext guard; companies CRUD+dupe409+revive; draft with company+stamp off; finalize; PDF served; stampUpdate apply/switch/remove/bad-stamp-400; final non-stamp PATCH still 409; all 5 list views incl. pagination math, light-row shape, search hitting employeesJson, month params guard; employee directory pagination math/search/upload/with_docs/per-employee listing/cleanup). Legacy scripts/test-documents-api.py updated to the new light-row contract (+detail-parse check) — 69/69 PASS. Verified the stamp toggle visually: same NOC rendered without stamp vs with the ASM Procurement stamp; footer block intact in both. Browser E2E (agent-browser): dashboard View → separate page; All NOCs View → separate page; client-folder month lazy load + View → separate page; Back from all; stamp switch on the view page re-renders (toast "Stamp removed/applied…"); PDF file on disk loses/regains the stamp image; Create NOC → company preselected, stamp off, manager block auto-filled, preview → generate → Open NOC Page (switch off, clean footer); employee directory cards + expansion + server search ("jyothi" → 1 row) + pagination controls; NOC Settings renders companies + both stamp thumbnails + add forms. eslint clean on all touched files; tsc 0 errors for documents scope (pre-existing unrelated errors untouched; page.tsx:114 setState-in-effect error verified pre-existing at HEAD).
- Cleanup: test NOCs/companies/stamps deleted, leftover client folders removed, demo NOC NOC-2026-000020 restored to its issued state (original file name, Procurement stamp back on the rendered PDF, correct filePath).

Stage Summary:
- NOCs now open in a dedicated full page (never a modal) with Back / Print / Download, from every entry point — fixing the dead View buttons and the odd top-positioned viewer.
- Stamps became a database library: per-NOC opt-in toggle (off by default, changeable after issue with in-place PDF re-render) and choice of WHICH stamp; two reference stamps seeded as defaults.
- Multiple company names supported end-to-end: company manager (letterhead optional, manager name/number/email for the footer, signature + {{company}}) selectable per NOC, manageable in NOC Settings.
- Employee Documents is now a paginated, server-searched employee card directory with per-employee expandable documents; NOC list and client folders are strictly paginated with light payloads so the module scales to large archives.
- The NOC footer/signature block carries the manager name, number and email exactly like the reference NOCs on every generated letter.

---
Task ID: 10
Agent: main (Z.ai Code)
Task: Implement the remaining gaps from the user's full NOC/Documents production spec (the core — dedicated NOC view page, DB stamp library with per-NOC toggle + choice, multi-company with manager footer, paginated employee directory — was already shipped in Task 9 and pushed as ecbe243). This task closed: (1) delete flow hardening §21-24, (2) stamping animation §10, (3) original as-issued PDF preservation §37, (4) exact draft resume point §28, (5) offline resilience with localStorage backup + auto re-sync §29-30, (6) database indexes §41, plus Back-returns-to-originating-list §39. Push.

Work Log:
- Gap 1 (§21-24): DELETE /api/documents/noc/[id] now returns { success:true, id } and 404 { code:"NOC_NOT_FOUND" }; NocList.doDelete removes the row from local state IMMEDIATELY after a successful response (no stale row / "NOC not found" on second delete); the page-edge case after deletion now lands on the LAST valid page (setPage(totalPages)) instead of jumping to page 1 in NocList and EmployeeDocsDirectory.
- Gap 2 (§10): NocViewPage gained a cosmetic stamping animation (~850ms): the chosen stamp image (served from the stamp library endpoint) drops from above with rotation, lands with a small impact bounce and ink fade-in, plus a "NOC Stamped — <name>" chip; fired via CSS keyframes (noc-stamp-drop/noc-stamp-ink/noc-stamp-chip); the PATCH runs in parallel and is never delayed; removal has no animation.
- Gap 3 (§37): schema +originalFilePath on NocDocument. Finalizing now ALWAYS writes the unstamped ORIGINAL as-issued PDF (standard "NOC - CLIENT - PROJECT - DATE.pdf" name) and, when a stamp is enabled, a separate active rendition "... (stamped).pdf". Stamp update on a final NOC never destroys the original: switching stamps regenerates only the (stamped) rendition; removing the stamp reverts the active rendition to the byte-identical original file; legacy rows adopt their current file as the preserved original on first stamp change. NOC delete removes BOTH files. POST create + PATCH finalize + PATCH stampUpdate all follow this model (renderNocBytes helper, stampedVariantName).
- Gap 4 (§28): schema +currentStep (default 1). Workspace buildPayload sends currentStep (capped 1..3), POST create-draft and PATCH draft persist it, GET detail returns it, and reopening a draft resumes at the saved step (clamped to 1..3). Step navigation uses goToStep() which saves immediately on transition (§33). Verified in browser: draft left at step 3 reopens at step 3 with client + employee rows intact.
- Gap 5 (§29-30): workspace keeps a localStorage mirror ("noc-draft-local-backup") written on EVERY change before the debounced server save; cleared on successful server save. Header status shows: "⚠ Offline — changes saved locally on this device (local copy HH:MM:SS)" / "↻ Syncing draft…" / "✓ Draft saved HH:MM". On a real offline→online transition the workspace auto-flushes and toasts "Draft synchronized". On open, an unsynced copy from a previous session raises a "Unsynced changes found — Restore/Discard" banner; Restore hydrates all fields + rows + step and re-syncs. Verified in browser with Playwright offline mode: offline edit persisted locally, reconnect auto-synced to the server (client name + currentStep=3 present in DB afterwards).
- Gap 6 (§41): new indexes — NocDocument(status), NocDocument(nocDate), Employee(fullName), Employee(passportNumber), Employee(companyName), EmployeeDocument(expiryDate), NocCompany(name) on top of the existing set; db:push + dev-server restart (storage-inode rule).
- §39: DocumentsPage remembers the last tab in sessionStorage; NocViewPage's Back sets a "documents-return" flag so returning lands on the originating NOC list (fresh sidebar navigation still opens the Dashboard).
- Bug found & fixed during E2E: the new selectedNocId consume-effect (Continue-editing hand-off from the NOC page) also consumed the id during openNocPage's view switch, so the viewer never opened — guarded with currentView !== 'noc_view'. Also wired the previously-dead hand-off: DocumentsPage now consumes a parked selectedNocId, fetches the draft and opens the workspace directly (only for drafts).
- Tests: new scripts/test-documents-api-task10.py — 45 checks ALL PASS (currentStep persistence, DELETE contract + repeat-delete 404 code, original+stamped renditions on disk, stamp switch preserves original bytes + removes old rendition, stamp removal reverts to the original file, re-apply later, plain finalize single-file, delete cleans both renditions, all 8 new indexes). Legacy suites re-run: test-documents-api.py 69/69 (fileName regex updated for the (stamped) active rendition), test-documents-api-task9.py 51/51.
- Browser E2E (agent-browser): View from All NOCs + client folder month → dedicated page (Back + Print + Download + stamp controls, PDF visible); stamp toggle ON renders the animation (verified overlay DOM: animationName noc-stamp-drop, stamp image from library, "NOC Stamped" chip) and re-renders the PDF; Back returns to the NOC tab; employee directory cards + expand (Passport/ID/Visa panels + 4 upload buttons) + server search by name ("jyothi") and employee ID ("ASM-123") each narrowing to 1 row; draft restore banner + hydration; offline edit → local copy → reconnect sync. Demo archive left clean: exactly NOC-2026-000020 (PROSCAPE ARABIAN RANCHES); all QA NOCs/rows/files/localStorage removed; empty QA storage folders deleted. Environment note: a stale next-dev process held the pre-migration db inode → "readonly database" on writes mid-session; killed all node dev processes and restarted ONE server (ops rule re-confirmed).
- eslint clean on all touched files; tsc 0 errors in documents scope (profile/dashboard/page.tsx errors verified pre-existing at HEAD via git stash).

Stage Summary:
- The full production spec is now implemented end to end: dedicated NOC page from every entry point with print/download/back; stamps opt-in per NOC with a database stamp library, per-NOC stamp choice, post-finalize stamping, and a physical stamp-drop animation; multi-company with the manager name/number/email footer; server-side pagination everywhere with light payloads; employee-centric documents directory with expandable cards and working search; delete flow with immediate UI removal, NOC_NOT_FOUND contract and last-page correction; original as-issued PDFs preserved as audit copies beside stamped renditions; drafts that auto-save server-side AND locally, survive crashes/offline, and resume at the exact step with employee edits and ordering intact; database indexes ready for large archives.

---
Task ID: 12
Agent: main (Z.ai Code)
Task: Implement the uploaded PRD "Documents, NOC ZIP Package & Stamp System — Enhancement and Fix Specification": (Phase 5) NOC ZIP package — outer ZIP named after the NOC holding the NOC PDF + one nested ZIP per employee with their latest valid documents; (Phase 4 completion) two-column employee document cards + in-app document preview; stamp hardening (company validation, exact-image rendering, confirm dialog with preview) and a position-accurate stamp animation; storage cleanup; upload integrity validation. Push.

Work Log:
- Schema: Stamp +companyId (company-scoped stamps; null = universal) +mime; EmployeeDocument +status (ACTIVE|REPLACED|DELETED|INVALID, §52); NocDocument +stampAppliedAt +stampAppliedBy +stampRect (normalized placement JSON); new NocDocumentPackage model (nocId/fileName/storagePath/fileSize/employeeCount/documentsIncluded/documentsMissing/summaryJson/status GENERATING|COMPLETED|FAILED/generatedBy, §25). db:push + dev-server restart rule honoured.
- noc-pdf.ts: generateNocPdf(data, meta?) now REPORTS where the stamp physically landed — { page, x, y, w, h, rotation } normalized 0..1 with y from the page TOP (StampRectMeta) — shared by the renderer and the UI animation so both always agree (§36-38).
- src/lib/noc-package.ts: (a) latest-valid resolver — ACTIVE records only, physical file must exist and be non-empty, newest first (createdAt DESC, id DESC) (§10-12,§53,§61); (b) buildNocPackage — server-side ZIP via archiver: NOC PDF (the ACTIVE rendition = stamped when stamped, §45; mandatory — unreadable NOC PDF fails the package, §55) + one nested ZIP per employee with normalized names Passport.pdf / Emirates ID.jpg / Visa.pdf / Medical.pdf (§4,§22); duplicate employee names get the deterministic "NAME - PASSPORT.zip" suffix (§21); employees with no valid documents still get a ZIP with a "NO DOCUMENTS ON FILE.txt" placeholder (§18); per-employee failures never abort the package (§55); snapshot→DB employee matching by passport then case-insensitive name (SQLite '=' is case-sensitive via Prisma — matched in JS); read-only operation, never mutates records (§24).
- Package APIs: POST /api/documents/noc/[id]/package (final-only guard, GENERATING→COMPLETED/FAILED history row, summary + downloadUrl); GET ?packageId streams the stored ZIP with Content-Disposition + noc_package_downloaded audit; GET ?view=latest (with staleness vs noc.updatedAt, §26-27) and ?view=history. Packages stored under storage/noc-packages/{nocNumber}/ — never public (§49); noc_package_created/downloaded audit-logged (§50).
- Stamp hardening: company validation on stampUpdate + draft PATCH — mismatch → 400 { code: "INVALID_STAMP_FOR_COMPANY" } (§32); stampAppliedAt/By recorded (§51); stampRect persisted on every stamped render; renderNocBytes now renders with the UPDATED stamp decision — fixing a REAL BUG where stamping a NOC finalized WITHOUT a stamp (the §9 "stamp later" flow) silently produced an unstamped PDF because the render used the stale stampId=null row; corrupt/unreadable stamp image → clear 400 (never silently stamps with a different image, §28). Stamps API: POST accepts companyId (validated), GET returns companyId/companyName. Seeded builtins assigned to the default ASM company; NOC Settings add-stamp form gained the company selector.
- Upload integrity (§5-6): magic-byte sniffing (PDF/JPEG/PNG/WEBP/OLE2-doc/zip-docx) — content must match the declared type, "corrupted or renamed file" rejected before storage.
- Cleanup (§13-14,§64): POST /api/documents/employee/cleanup {action:report|clean} — older duplicates of the same employee+category marked REPLACED (kept on disk, audit-safe), missing-file records marked INVALID, soft-deleted rows' leftover files purged + rows removed; historical NOCs unaffected (finalized NOCs are snapshots and never reference these files).
- NocViewPage: [ZIP Documents] button (final-only) + Prepare dialog — working phase ("Documents are being collected…"), then the §19 summary (package name, employee ZIP count, 4 per-category included/missing cards, failed-employee note, per-employee detail expander) and [Download ZIP]; "Last package" info line with staleness warning (§26); stamp state chip "Stamp: {name | Not Applied}" (§42); stamp application now goes through a confirm dialog with the EXACT stamp image + company + replace-warning (§33,§43).
- Stamp animation rebuilt (§34-41,§63): the PDF stays visible behind a subtle dim; the stamp image appears above the document, travels to the EXACT stored stampRect (mapped through the same geometry the browser viewer uses: fit-width page + toolbar offset), impacts with scale compression + shadow, ink impression appears at the final position, success chip. Five phases (noc-stamp-dim/shadow/travel/ink/success, ~1.1s), purely cosmetic — never delays the PATCH.
- EmployeeDocumentsPanel rebuilt to §8/§66: two-column category grid in fixed order (Passport | ID Card, Visa | Medical/Other) in BOTH modes; each card shows the LATEST document (thumbnail for images, name/size/upload date/expiry badge) with always-visible [Preview] [Download] + rename/replace/delete; "+N older documents" expander keeps history; missing categories show "⚠ Not Available" + [+ Upload] and are never hidden. New shared DocumentPreviewModal (§7): PDF embedded viewer / image with zoom in-out-fit, Download + Close — no download needed just to inspect.
- Tests: scripts/test-documents-api-task11.py — 36 checks ALL PASS (latest-valid with marker PDFs, outer/inner ZIP structure verified with Python zipfile, normalized names, dup-name suffix, placeholder ZIP, draft guard, stamped-rendition-in-package, package history/latest/staleness/regeneration, INVALID_STAMP_FOR_COMPANY, stampRect persisted + appliedAt/By, magic-byte rejection, cleanup report/clean + resolver unaffected). Regression: task10 45/45, task9 54/54 (updated for company-scoped stamps + real PNG stamps — the fake-PNG-as-PNG stamps now legitimately fail embedding, which also proves the stamp actually renders), legacy 69/69. Fixed flaky cross-run test artifacts (name-based cleanup → id-based).
- Browser E2E (agent-browser): ZIP dialog full flow on a live NOC (ready state with category counts + Download button); two-column grid with Available/Not Available + "+19 older documents" expander; DocumentPreviewModal rendering a real 2-page NOC PDF in-app; stamp confirm dialog with exact stamp preview + company; full 5-phase animation verified via computed styles (dim/shadow/travel/ink/success); "Last package" line visible. QA artifacts purged (DB rows, files, storage folders, package history, localStorage) — archive left with exactly the demo PROSCAPE NOC.
- eslint clean + tsc 0 errors across the whole documents scope.

Stage Summary:
- The Documents module now covers the full PRD lifecycle end-to-end: finalized NOC → (optional, company-validated, position-accurate animated) stamp → ZIP DOCUMENTS package (NOC PDF + per-employee latest-valid document ZIPs with summary + audited download), backed by package history, storage cleanup, upload integrity checks, two-column employee document cards and in-app preview. One real bug found and fixed on the way: post-finalize stamping ("stamp later") previously re-rendered without the stamp.

---
Task ID: 13
Agent: main (Z.ai Code)
Task: User-reported fixes: (1) CAMPS -> View Camp — "Add Employee" search shows no employees when typing; (2) the stamp toggle in the NOC view only displays correctly after a page refresh; (3) stamp model rework — one company can have multiple switchable stamps, switching must NOT keep copies of old stamped PDFs, the stored PDF must ALWAYS remain unstamped, and a snapshot of the stamped PDF is saved only once it is stamped AND downloaded. Push.

Work Log:
- Camp fix: /api/employees GET returns rows under data.data.employees but the camp detail dialog read data.employees -> searchResults were ALWAYS empty ("No employees found"). Fixed the response shape in camp-detail-page.tsx; also deferred the camp fetch with setTimeout(0) to satisfy react-hooks/set-state-in-effect (pre-existing lint error in this file).
- Stamp toggle fix: applyStampChange updated only the noc.* header chip state but never the standalone stampEnabled state driving the Switch -> the toggle visually lagged one action behind until refresh. Now setStampEnabled(nextEnabled) + setStampId(nextStampId) run on PATCH success; both the Switch, the Select and the header chip reflect the decision immediately (verified in-browser without reload).
- NEW SNAPSHOT MODEL (schema + APIs):
  * prisma: NocDocument +stampSnapshotPath (last downloaded stamped snapshot, overwritten each stamped download); filePath/originalFilePath comments updated (filePath = ALWAYS the unstamped as-issued PDF).
  * PATCH stampUpdate (final NOC) is now DB-ONLY: validates the stamp against the company, runs a pure in-memory render to validate the stamp image (§28) and capture stampRect for the animation, normalizes legacy rows (filePath pointing at an old "(stamped)" rendition is reverted to the preserved original and the rendition file is deleted), and REMOVES any previous download snapshot + pointer (no old stamped copies kept when switching). No stamped file is ever written here.
  * Finalize (PATCH draft->final and POST create-final) writes ONLY the plain original; stamp-enabled finalize/creation validates the stamp image via a pure render (no file).
  * GET [id]/pdf reworked: base = preserved original (regenerated UNSTAMPED if missing); when stampEnabled the stamped version is rendered ON THE FLY (inline preview falls back to base if the stamp image is broken; mode=download fails 400 loudly — never silently delivers an unstamped PDF as stamped). mode=download with a stamp writes the DETERMINISTIC snapshot "... (stamped).pdf" (overwritten, never accumulated), persists stampSnapshotPath + fresh stampRect, and streams with a "(stamped)" Content-Disposition.
  * DELETE removes base + legacy original + snapshot files.
  * ZIP package: buildNocPackage now renders the stamped NOC PDF ON THE FLY (extra fields passed from the route) and names the entry "... (stamped).pdf"; a broken stamp image degrades to the unstamped original inside the package instead of failing it.
- Stamp picker UX: the view-page Select is company-aware — a NOC with a company sees its own company's stamps + universal ones ("No stamps for this company" when none); a NOC WITHOUT a company sees ALL stamps (mirrors server validation). Found + fixed the root cause of a REAL 400 while E2E-testing: the demo NOC carried a legacy companyId='1' that matches no NocCompany row -> validateStampForCompany now only enforces the mismatch when the NOC's company actually EXISTS; cleaned the invalid companyId in DB; soft-deleted the two leftover "QA Company Stamp" rows belonging to an already-deleted QA company.
- Updated test scripts to the new model: task10 stamp sections (stored PDF stays plain, switch is DB-only, no renditions) and a NEW scripts/test-stamp-snapshot-model.py — 45 checks ALL PASS (on-the-fly inline render differs from base with NO file written; download writes snapshot with stampSnapshotPath set and bytes == delivered; repeated downloads overwrite ONE snapshot; switching stamps deletes the stale snapshot + clears the pointer and the base bytes are untouched; removal serves base bytes on inline AND download; re-apply later works; the ZIP package contains a "(stamped)" NOC PDF entry ~ the stamped render; DELETE removes base + snapshot). Regression: task10 43/43, task9 54/54, task11 36/36, legacy 69/69 — 247 checks green.
- Browser E2E (agent-browser): camp add-employee search now lists employees ("jyothi" -> row + Assign -> occupancy 800->799 -> listed under Employees in this Camp (1) -> removed + state restored); NOC stamp toggle OFF -> switch false + chip "Stamp: Not Applied" WITHOUT reload; toggle ON -> confirm dialog (new copy: PDF on file stays unstamped, snapshot saved on download) -> animation fires -> switch true + chip "Stamp: Procurement stamp" WITHOUT reload; switched Procurement -> Signature via the Select (replace-warning shows the no-copy rule) -> chip updates instantly, storage still holds exactly ONE plain file; switched back to Procurement; stamped download from the UI created the "(stamped)" snapshot + DB pointer (then cleaned); demo NOC left stamped with Procurement stamp, single plain PDF, no snapshot. QA leftovers (2 legacy "DRAFT TEST" NOCs + all QA storage/package folders) purged.
- eslint clean on all touched files; tsc 0 errors in the documents/camps/noc scope (54 remaining project errors verified pre-existing in unrelated files).

Stage Summary:
- Camp occupancy management works again end to end (the search never received results due to an API response-shape mismatch).
- The stamp system now follows the user's exact model: the issued PDF on disk is ALWAYS the unstamped original; stamps are a pure per-NOC decision that can be toggled or switched (multiple stamps per company) instantly and without refresh; switching leaves NO old stamped copies; and every stamped download persists a fresh audit snapshot "... (stamped).pdf" while the original stays untouched. The animation still lands on the exact renderer position, and corrupt stamp images fail loudly at the moments that matter (apply, download, package).

---
Task ID: 14
Agent: main (Z.ai Code)
Task: Camps -> View Camp — replace the employee card grid with a proper table: paginated, searchable, trade-based sorting, inline-editable bed space number per employee, name + ID stacked in the same column, and an always-visible Remove action. Push.

Work Log:
- Schema: Employee +bedSpaceNumber (bed number inside the assigned camp); db:push honoured, dev server restarted (readonly-inode rule).
- APIs: GET /api/camps/[id] now returns bedSpaceNumber per employee. NEW PATCH /api/camps/[id]/assign-employee sets/updates/clears a bed space (trim + 50-char cap, employee-must-be-in-this-camp guard, camp existence 404). POST assign now RESETS bedSpaceNumber (a fresh assignment never inherits a bed from a previous camp — incl. confirmed transfers) and DELETE (remove from camp) also clears it.
- camp-detail-page.tsx rebuilt employee section: dark <Table> with # / Employee / Trade / Current Site / Bed Space / Actions columns; name + employeeId stacked in ONE column (2 rows) with avatar, TL/Sup badges; row numbers continue across pages.
- Trade header is a 3-state sort cycle (none -> asc -> desc) with ArrowUp/Down/UpDown indicator; employees without a trade always sort last, ties broken by name.
- Search box filters by name / employeeId / trade / currentSite / bedSpaceNumber (client-side, resets page); "No employees match your search" empty state with Clear search; "Showing X–Y of Z (filtered from N)".
- Pagination: 10/20/50 per-page Select, First/Prev/Next/Last buttons, "Page X of Y", page-edge correction when the filtered list shrinks.
- BedSpaceCell: click to edit, Enter or blur commits, Escape cancels (skipBlur guard vs double-fire), draft re-initialized at each edit start (no setState-in-effect — lint clean), optimistic update + server reconcile + revert on failure, saving spinner in the cell.
- Remove: always-visible red Remove button per row (was hover-only X on cards), optimistic row removal + stats adjustment + silent refetch (no loading flash), revert on failure.
- Tests: scripts/test-camp-bedspace.py — 31 checks ALL PASS (set/trim, update, clear via ""/null, missing employeeId/non-string/51-char/unknown-employee/unknown-camp errors, isolation, remove clears bed, transfer resets bed, fresh assign starts null, cleanup). QA artifacts (camp + employees) hard-purged from DB.
- Browser E2E (agent-browser): table renders with all columns; bed edit B-12 via Enter (toast + DB) and Escape-cancel path; clear via keyboard -> "Not set" + DB null; 12 QA employees -> pagination (Page 1 of 2, Showing 11-14, last page), Trade asc (Carpenter->...->Mason) / desc / none cycle verified, search "Electrician" (3 rows, filtered-from note) / "John" (1 row) / no-match empty state; UI Remove -> row gone, count 14->13, DB campId+bed null. All QA data removed afterwards; Yousuf Camp back to baseline (2 employees, occupancy 2/798/800).
- eslint clean (fixed react-hooks/set-state-in-effect by event-driven draft init); tsc 54 errors = exact pre-existing baseline, zero new.

Stage Summary:
- View Camp now manages residents through a real data table: instantly searchable, trade-sortable, paginated, with per-employee editable bed space numbers that never leak across camps (assign/transfer/remove all reset them), and one-click removal — all with optimistic UI that reconciles with the server.

---
Task ID: 15
Agent: main (Z.ai Code)
Task: Full A-to-Z test of the whole app, fix all errors/bugs/mismatches, verify every DB relation, performance hardening for thousands of concurrent users, walkthrough of ALL sidebar menus, NEW FEATURE: batch drag & drop employee-document upload with auto-matching + mismatch fixing, seed 200 workers + 5 camps + all tables, full re-test, push, detailed report.

Work Log:
- SEEDING (scripts/seed-database.py): 200 workers, 4 new camps (+existing = 5), 4 new sites (6 total), 2 branches, 4 trade rates, 100 employee-trade links, 4210 attendance rows (21 days), 2 attendance versions + 2 share links, 609 working-hours rows (3 months), 376 salary records (2 months), 5 one-time + 3 recurring advances with 6 repayment rows, 10 warnings, 8 fines, 12 leave requests, 5 cancellations, 8 stock items, 10 uniform tokens, 6 notifications, 183 site-history rows, 6 month activations, 100 work logs, 10 rate changelogs, 162 employee documents (real PDF files on disk). DETERMINISTIC 'seed_' id prefix → idempotent reseed + trivial audit/cleanup.
- BUG #1 (seed): writing 'now' strings into DATETIME columns broke Prisma with P2023 "Inconsistent column data" → notifications/leave-requests/cancellations/documents-cleanup ALL returned 500. Root-caused via dev-log, fixed by seeding epoch-ms integers (matches Prisma's own storage). Verified endpoints recovered.
- DB AUDIT (scripts/db-audit.py): 40 FK relations checked, 18 duplicate checks, business rules (denormalized currentSite sync, TL/Sup uniqueness per site, camp capacity, advance balance sanity, soft-delete hygiene), orphan-files-on-disk, index coverage. Found + fixed: 2 ACTIVE docs with missing files → app's own cleanup marked INVALID (+37 REPLACED normalized); Employee @@index([status]) added (db:push + restart); audit rule tightened (only ACTIVE rows require files; only non-deleted NOCs must reference live stamp/company — the 15 flagged rows were soft-deleted QA rows). FINAL: 0 errors, 0 warnings.
- A-to-Z API SUITE (scripts/test-atoz.py, 81 checks): auth/session/presence, employees CRUD+search+pagination, sites/camps/branches, attendance (mark/bulk/share/versions/export/site-assignments), hours/worklogs/site-history, advances (one-time+recurring+pending-by-month+edit+cancel), accounts/salary save+dup-guard, warnings/fines, leave+cancellations review flows, uniforms/stock, notifications/admins/permissions/menu-permissions/activity-logs/trades/rates, documents read paths.
- BUG #2 (REAL app bug): /api/admin-menu-permissions selected a NON-EXISTENT `menuId` field (model has menuKey) → GET always 500 and PUT createMany broken. Fixed both paths to menuKey (+allowed:true filter). 
- BUG #3 (REAL app bug): PATCH /api/advances/[id] let the `amount` of an ACTIVE RECURRING advance change WITHOUT adjusting remainingBalance → advance could never complete (amount 260 vs balance 900 nonsense state). Fix: balance shifts by the same delta (repayments preserved), auto-completes at 0, reactivates if raised again. Regression tests added (edit 900→1200→800 → balance follows 1200→400).
- BUG #4 (app resilience): one orphaned SalaryRecord/TotalEmployeeWorkingHours/EmpCountSitePerMonth row (from out-of-band deletes) made /api/salary-records, /api/site-history, /api/accounts/working-hours hard-500 ("Field employee is required... got null"). Purged orphans; root-cause note: in-app deletes are soft so this cannot occur through the app — integrity enforced by Prisma cascade + audit tooling.
- PERFORMANCE: enabled WAL journal mode (persistent, readers never block the writer), Prisma connection pool tuning (connection_limit=10, pool/pool/socket timeouts) in src/lib/db.ts, Employee.status index, salary-records GET payload trimmed ~33% (heavy `employee` include now opt-in via ?withEmployee=1 — no UI consumer uses it; rows already carry denormalized fields). Benchmarks (production build): every endpoint 6-54ms; load test 100 clients → 93 rps p50 540ms; 200 clients → 89 rps p50 1088ms; 10,400 requests, ZERO errors. Dev-mode ceiling ~57 rps (event loop bound) — production mode is the deployable target.
- UI WALKTHROUGH: all 16 sidebar menus (Dashboard → All Logs) render headings + data with ZERO console/page errors (checked rows/tables/cards per page). Screenshots verified.
- NEW FEATURE — BATCH DOCUMENTS (drag & drop + auto-match + mismatch fixing):
  * POST /api/documents/employee/batch — JSON body = INSPECT (docType detection + employee matching from the file name: employee-code hit 1.0 > full name 0.9 > all-name-tokens 0.7, top-3 candidates; codes matched dash-aware "ASM-SEED-001"), multipart = UPLOAD (files[] + aligned mappings[], magic-byte validated, standardized {DOC_TYPE}_{EMPLOYEE_NAME} storage, per-file isolation — one corrupt/unmapped file never aborts the batch, cap 100 files/20MB each).
  * PATCH /api/documents/employee/[id] + targetEmployeeId = REASSIGN: row moves, physical file moves to the new employee's folder with the standardized name, old copy removed, audit-logged (employee_document_reassign), rename now optional when reassigning.
  * UI BatchDocUploadDialog (Documents → Employee Documents → Batch Upload): drag & drop many files → review grid (type select, matched-employee chip with Auto·ID/Auto·Name/Likely/Needs-review badges, change/pick via searchable employee list, remove) → upload → per-file result summary. Unassigned files block upload (explicit choice).
  * UI Move action on every document card (ArrowRightLeft icon) → search employee → move — the "fix the mismatch later" path.
  * scripts/test-batch-docs.py — 26 checks ALL PASS (matching matrix incl. the dash-code bug found + fixed, per-file isolation, mapping alignment 400, physical file moves, audit log, cleanup).
- REGRESSION: ALL suites green after every fix — batch 26, camp-bedspace 31, stamp-snapshot 45, task11 36, task10 43, task9 54, legacy documents 69, A-to-Z 81 = 385 checks, 0 failures. eslint clean, tsc 54 = exact pre-existing baseline.
- Browser E2E for the batch feature: full drag&drop flow with 3 files (Auto·ID, Auto·Name, Pick-employee assignment via search), upload → all 3 created, directory counts updated, Move flow (passport 005→006) with toast + audit log. E2E + QA artifacts fully cleaned (DB + files), audit still 0/0.

Stage Summary:
- The database is verified accurate at scale: 40/40 relations intact, no duplicates, all business rules hold, all hot paths indexed, WAL + tuned pooling + payload trims deliver ~90 rps at 200 concurrent clients with zero errors (production mode), every sidebar page renders clean, and the whole API surface (385 checks) passes.
- Two REAL user-facing bugs are fixed for good: the Admin Management menu-permissions feature (was a guaranteed 500) and recurring-advance amount edits silently corrupting the repayment balance.
- Batch documents is live: drag & drop many employees' scans at once, automatic matching by employee code/name with an explicit review step, per-file error isolation, and a one-click Move to fix any mismatch later — files follow the employee, never the other way around.
