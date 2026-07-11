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
