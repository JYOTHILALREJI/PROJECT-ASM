// Static UI knowledge for the AI assistant / agent.
//
// APP_UI_MAP is injected into the model's system prompt so it can (a) answer
// "where do I find X?" questions and (b) drive the app as an agent. AGENT_VIEWS
// is the whitelist of screens the agent may navigate to — nothing outside the
// app is ever reachable, and every navigation target must be in this list.

export const AGENT_VIEWS = [
  'dashboard',
  'employees',
  'employee_add',
  'employee_batch_add',
  'employee_detail',
  'employee_hours_ledger',
  'sites',
  'camps',
  'camp_detail',
  'attendance',
  'attendance_copy',
  'documents',
  'accounts',
  'advance',
  'consolidated_salary',
  'uniform_registry',
  'leave_requests',
  'cancellation_requests',
  'notifications',
  'admins',
  'all_logs',
  'settings',
  'profile',
] as const;

export type AgentView = (typeof AGENT_VIEWS)[number];

export const VIEW_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  employees: 'Employees',
  employee_add: 'Add Employee form',
  employee_batch_add: 'Batch Add (drag & drop documents)',
  employee_detail: 'Employee details',
  employee_hours_ledger: 'Employee Hours ledger',
  sites: 'Sites',
  camps: 'Camps',
  camp_detail: 'Camp details',
  attendance: 'Attendance',
  attendance_copy: 'Attendance Copy',
  documents: 'Documents & NOC',
  accounts: 'Accounts',
  advance: 'Advances',
  consolidated_salary: 'Consolidated Salary',
  uniform_registry: 'Materials Registry',
  leave_requests: 'Leave Requests',
  cancellation_requests: 'Cancellations & Recycle Bin',
  notifications: 'Notifications',
  admins: 'Admin Management',
  all_logs: 'All Logs',
  settings: 'Settings',
  profile: 'Profile',
};

export const APP_UI_MAP = `APP UI MAP (single-page app — the agent can only move between these screens; view keys in brackets):

[dashboard] Dashboard — workforce stat cards (idle workers, active workers), quick action buttons "Add Employee", "Mark Attendance", "Accounts", and Sites Overview cards (per-site present/absent/hours).

[employees] Employees — searchable employee directory (search box, status filter). Row actions: view details. Buttons: "Add Employee" (opens the full employee form: name, employee ID, trade/position, site, camp, bed space, rates, current total working hours…), "Batch Add" (drag & drop many employee documents at once; auto-matches each document to an employee; mismatched documents can be reassigned). Clicking an employee opens [employee_detail].

[employee_detail] Employee details — tabs for personal info, documents (passport/visa uploads with expiry tracking), salary records, working hours, advances, warnings and fines. Inline quick-editor for current total working hours.

[employee_hours_ledger] Employee Hours — directory of employees with hours; click one to see their detailed hours ledger (standard/premium/camp-sitting tiers). Back button returns to the directory.

[sites] Sites — site cards/list (name, client, project, location, status). "Add Site" button; edit site (assign trades with rates, move employees); per-site attendance sheet view; delete site.

[camps] Camps — accommodation camps with occupancy. "Add Camp" button. Clicking a camp opens [camp_detail]: employee table with pagination/search/trade sort, "Assign Employee" / "Transfer" / "Remove" actions and inline-editable bed space numbers.

[attendance] Attendance — month + site selectors, Excel-style keyboard grid: P = present (10h), A = absent, C = camp sitting (8h), arrow keys/Enter/Tab move, Ctrl+Z undo; bulk-mark bar; moved-away employees show merged site labels; Excel export and share-link buttons. [attendance_copy] shows a read-only copy/print view of the same sheet.

[documents] Documents & NOC — tabs: "NOC", "Employee Docs", "Template" (letterhead settings), plus an overview. The overview tab has the "Create NOC" button. The NOC tab lists issued NOCs (search, view, edit draft, download). AGENT NOTE: for "create an NOC" requests do NOT walk this wizard manually — use the one-shot noc_create action (it opens the wizard, fills Client/Project/Date/Address/City/Country, adds every employee via search → tick → "Add selected" with a manual-row fallback for unknown names, then presses "Confirm & Generate NOC" and reads back the NOC-YYYY-NNNN number). Wizard layout (for reference when fixing things): step strip Details/Employees/Review/Preview/Complete, but steps 1-3 render on one screen — Recipient & Project Details (Issuing Company dropdown, Client Name, Project Name, NOC Date DD-MM-YYYY, Address Line 1/2, City, Country, stamp toggle, contacts), "Select Employees from Database" (search box → results with checkboxes → "Add selected (n)"; "Add manually" appends a blank row), and the Review Employee Table. Validation: client ≥ 2 chars, date DD-MM-YYYY, at least one named employee row.
"Employee Docs" tab: per-employee document directory with drag & drop upload, document type, issue/expiry dates and preview. "Template" tab: letterhead/company settings, NOC companies and the stamp library are managed here (NOC Settings).
[noc_view] — a single issued NOC opened full-screen (read-only viewer with print/download and stamp toggle).

[accounts] Accounts — monthly salary accounts grouped by site (search with jump-to-match), rate tiers and totals. "Advance" section/button moves to [advance]: issue salary advances (amount, deduction month/year, recurring advances with installments, balances).

[consolidated_salary] Consolidated Salary — month/year selectors, all sites in one salary sheet with per-employee rates (standard/premium/camp-sitting tiers), site subtotals, grand total, "Export Excel" button.

[uniform_registry] Materials Registry — uniform/material issue records (employee, item, size, quantity, document number, issue date). "Add Entry" button; employee picker auto-fills the saved document number; search.

[leave_requests] Leave Requests — leave cards with approve/reject (days paid editable on approval).

[cancellation_requests] Cancellations — cancellation requests with two approval options: "Move to Recycle Bin" (soft delete, restorable) or "Delete Permanently" (irreversible). Recycle Bin tab: restore / delete forever / empty bin, all confirmation-driven.

[notifications] Notifications — notification cards with "Mark as read" buttons; warnings and fines are issued from here (fines use the app currency).

[admins] Admin Management — create/edit admin users, roles, online presence, and per-menu permissions (expand a row: grouped permission switches, Grant/Revoke All). Includes the "AI Assistant" toggle that grants or blocks an admin's access to the AI assistant. [all_logs] All Logs — full audit trail of user actions.

[settings] Settings (Super Admin only) — two-column layout. Branding (company logo upload, glowing brand text, company name) | Currency picker; below, the full-width AI Assistant section: identity on the left (assistant name + live previews) and Model provider on the right (API key, base URL, searchable model dropdown loaded from the provider, saved key shown masked only). Applies app-wide instantly.

[profile] Profile — the signed-in user's own profile.

Rules for the agent:
- Navigate ONLY with the view keys above. There is no way — and no permission — to open anything outside this app.
- You can operate EVERY control a human can: all sidebar menus, page buttons, tabs, dropdowns, switches/checkboxes and every modal dialog. Add/Edit forms across the app open as modals or dedicated screens; delete and other destructive actions show a confirmation popup (SweetAlert) — complete it by clicking the red/confirm button, or press Escape to cancel.
- Pages open dialogs and dropdowns dynamically: after every click, run "read" to see what actually appeared before filling anything (modal fields are listed too, with an "OPEN MODAL" line naming the dialog).
- Forms are React-controlled: use the fill/select/toggle actions (they fire the right events); never assume a field exists without reading first. If content seems missing, scroll and read again.
- File uploads (drag & drop zones) are the one thing you cannot do — tell the user to drop the files themselves.`;
