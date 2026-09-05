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

// ── View access (shared by page routing AND the AI agent) ────────────────────
// The agent must obey exactly the same permission rules as the human UI: when
// it cannot open a screen it must SAY so ("I don't have access…") instead of
// silently failing mid-task.
export const ALWAYS_VISIBLE_VIEWS: readonly string[] = ['dashboard', 'profile'];

export const RESTRICTED_VIEWS: readonly string[] = [
  'employees', 'employee_add', 'employee_batch_add', 'sites', 'attendance', 'attendance_copy',
  'accounts', 'advance', 'consolidated_salary', 'employee_hours_ledger', 'employee_detail',
  'camps', 'camp_detail', 'uniform_registry', 'leave_requests', 'cancellation_requests',
  'notifications', 'admins', 'all_logs', 'documents', 'noc_view', 'settings',
];

// Views whose permission slug differs from their view id.
export const VIEW_PERMISSION_MAP: Record<string, string> = {
  employee_hours_ledger: 'employee_hours',
  advance: 'accounts',
  all_logs: 'admins',
  noc_view: 'documents',
};

// Screens that CHANGE app-wide / account configuration. Even a permission-
// granted admin cannot save them (the settings PATCH API is super-admin-only),
// so the agent treats them as super-admin-only outright.
export const SUPER_ADMIN_ONLY_VIEWS: readonly string[] = ['settings', 'admins'];

export function permissionSlugForView(view: string): string {
  return VIEW_PERMISSION_MAP[view] ?? view;
}

/** Mirror of page.tsx's isViewAllowed, usable from the agent executor too. */
export function isViewAllowedFor(role: string | undefined, grantedSlugs: readonly string[], view: string): boolean {
  if (!role) return false;
  if (role === 'super_admin') return true;
  if ((ALWAYS_VISIBLE_VIEWS as readonly string[]).includes(view)) return true;
  if (RESTRICTED_VIEWS.includes(view)) return grantedSlugs.includes(permissionSlugForView(view));
  return false;
}

/**
 * Deterministic "where do I …?" directions, one per screen. The planner's
 * navigate choice on a where-question tells us WHICH screen it meant; the
 * hint tells the user the exact tab/button path — no LLM needed, so the
 * directions are always precise and instant.
 */
export const VIEW_HINTS: Record<string, string> = {
  dashboard: 'the stat cards, quick actions ("Add Employee", "Mark Attendance", "Accounts") and the Sites Overview',
  employees: 'use "Add Employee" for the full form, "Batch Add" to drop many documents at once, and click a row for details',
  employee_add: 'the full form (name, ID, trade, site, camp, bed space, rates…)',
  employee_batch_add: 'drag & drop many employee documents at once',
  employee_detail: 'click the employee on **Employees** — tabs hold personal info, documents, salary records, hours, advances and warnings/fines',
  employee_hours_ledger: 'pick an employee to see their detailed hours ledger',
  sites: 'use "Add Site"; click a site to assign trades/rates, move employees or open its attendance sheet',
  camps: 'use "Add Camp"; click a camp for its employee table, Assign/Transfer/Remove and inline bed-space editing',
  camp_detail: 'the employee table has Assign / Transfer / Remove and inline bed-space editing',
  attendance: 'pick month + site, mark with the keyboard grid (P/A/C), use the bulk-mark bar or Excel export',
  attendance_copy: 'a read-only print view of the sheet',
  documents: 'the Dashboard tab holds "Create NOC", the NOC tab lists issued NOCs, Employee Documents handles uploads, NOC Settings has letterhead/stamps',
  accounts: 'monthly salary accounts grouped by site with rate tiers and totals',
  advance: 'issue advances on the "New Advance" tab and review them under "Pending for <month>"',
  consolidated_salary: 'month/year pickers, all sites in one sheet, "Export Excel" for the workbook',
  uniform_registry: 'switch to the **Stock Management** tab → "Add Stock" → fill Item Name / Size / Quantity / Min Qty → Save. Mind the tabs: "+ New Entry" sits on the Tokens tab and creates an employee TOKEN, not stock',
  leave_requests: 'approve or reject on each card (days paid is editable on approval)',
  cancellation_requests: 'approve with "Move to Recycle Bin" or "Delete Permanently"; the Recycle Bin tab restores, deletes forever or empties the bin',
  notifications: '"Mark as read" per card; warnings and fines are issued from here',
  admins: 'create/edit admins, per-menu permission switches and the AI Assistant toggle',
  all_logs: 'the full audit trail of user actions',
  settings: 'super admin only — Branding, Currency and the AI Assistant section',
  profile: 'your own account details',
};

export const APP_UI_MAP = `APP UI MAP (single-page app — the agent can only move between these screens; view keys in brackets):

[dashboard] Dashboard — workforce stat cards (idle workers, active workers), quick action buttons "Add Employee", "Mark Attendance", "Accounts", and Sites Overview cards (per-site present/absent/hours).

[employees] Employees — searchable employee directory (search box, status filter). Row actions: view details. Buttons: "Add Employee" (opens the full employee form: name, employee ID, trade/position, site, camp, bed space, rates, current total working hours…), "Batch Add" (drag & drop many employee documents at once; auto-matches each document to an employee; mismatched documents can be reassigned). Clicking an employee opens [employee_detail].

[employee_detail] Employee details — tabs for personal info, documents (passport/visa uploads with expiry tracking), salary records, working hours, advances, warnings and fines. Inline quick-editor for current total working hours.

[employee_hours_ledger] Employee Hours — directory of employees with hours; click one to see their detailed hours ledger (standard/premium/camp-sitting tiers). Back button returns to the directory.

[sites] Sites — site cards/list (name, client, project, location, status). "Add Site" button; edit site (assign trades with rates, move employees); per-site attendance sheet view; delete site.

[camps] Camps — accommodation camps with occupancy. "Add Camp" button. Clicking a camp opens [camp_detail]: employee table with pagination/search/trade sort, "Assign Employee" / "Transfer" / "Remove" actions and inline-editable bed space numbers.

[attendance] Attendance — month + site selectors, Excel-style keyboard grid: P = present (10h), A = absent, C = camp sitting (8h), arrow keys/Enter/Tab move, Ctrl+Z undo; each site section has its own bulk-mark bar (date input, Present/Absent toggle, "Mark all as Present/Absent" button); moved-away employees show merged site labels; Excel export and share-link buttons. AGENT NOTE: for "mark all/everyone present/absent (in all sites)" requests do NOT click the per-site buttons one by one — use the one-shot attendance_mark action (it marks every eligible employee across ALL sites in one step; add "site":"<name>" ONLY for one specific site). [attendance_copy] shows a read-only copy/print view of the same sheet.

[documents] Documents & NOC — tabs: "NOC", "Employee Docs", "Template" (letterhead settings), plus an overview. The overview tab has the "Create NOC" button. The NOC tab lists issued NOCs (search, view, edit draft, download). AGENT NOTE: for "create an NOC" requests do NOT walk this wizard manually — use the one-shot noc_create action (it opens the wizard, fills Client/Project/Date/Address/City/Country, adds every employee via search → tick → "Add selected" with a manual-row fallback for unknown names, then presses "Confirm & Generate NOC" and reads back the NOC-YYYY-NNNN number). Wizard layout (for reference when fixing things): step strip Details/Employees/Review/Preview/Complete, but steps 1-3 render on one screen — Recipient & Project Details (Issuing Company dropdown, Client Name, Project Name, NOC Date DD-MM-YYYY, Address Line 1/2, City, Country, stamp toggle, contacts), "Select Employees from Database" (search box → results with checkboxes → "Add selected (n)"; "Add manually" appends a blank row), and the Review Employee Table. Validation: client ≥ 2 chars, date DD-MM-YYYY, at least one named employee row.
"Employee Docs" tab: per-employee document directory with drag & drop upload, document type, issue/expiry dates and preview. "Template" tab: letterhead/company settings, NOC companies and the stamp library are managed here (NOC Settings).
[noc_view] — a single issued NOC opened full-screen (read-only viewer with print/download and stamp toggle).

[accounts] Accounts — monthly salary accounts grouped by site (search with jump-to-match), rate tiers and totals. "Advance" section/button moves to [advance]: TWO tabs — "New Advance" (issue new advances: employee picker, amount, deduction month/year, recurring advances with installments, balances) and "Pending for <month>" (review/approve the month's pending advances).

[consolidated_salary] Consolidated Salary — month/year selectors, all sites in one salary sheet with per-employee rates (standard/premium/camp-sitting tiers), site subtotals, grand total, "Export Excel" button.

[uniform_registry] Materials Registry — TWO TABS on one page (tab strip: "Tokens" | "Stock Management"), each tab with its OWN buttons:
  • "Tokens" tab (default/active on arrival) — uniform/material ISSUE records (employee, item, size, quantity, document number, issue date). Buttons: "+ New Entry" (opens the New Token Creation wizard — an employee issue record, NOT stock; employee picker auto-fills the saved document number), per-row View Details / Renew / Delete. Search box + All Sites filter + Reset.
  • "Stock Management" tab — material INVENTORY. Buttons: "+ Add Stock" (opens an INLINE form — not a modal — with fields Item Name*, Size, Quantity*, Min Qty (alert) and "Save" / "Cancel" buttons), per-row minus/plus quantity steppers and a delete (confirm). Stock quantities are automatically reduced when tokens are issued.
  AGENT NOTE: "add material / add stock / add item" requests belong to the STOCK MANAGEMENT tab — use the one-shot stock_add action (it switches tabs, opens Add Stock, fills Item Name/Size/Quantity/Min Qty, saves). NEVER click "+ New Entry" for material/stock requests — it lives on the Tokens tab and creates a TOKEN.

[leave_requests] Leave Requests — leave cards with approve/reject (days paid editable on approval).

[cancellation_requests] Cancellations — cancellation requests with two approval options: "Move to Recycle Bin" (soft delete, restorable) or "Delete Permanently" (irreversible). Recycle Bin tab: restore / delete forever / empty bin, all confirmation-driven.

[notifications] Notifications — notification cards with "Mark as read" buttons; warnings and fines are issued from here (fines use the app currency).

[admins] Admin Management — create/edit admin users, roles, online presence, and per-menu permissions (expand a row: grouped permission switches, Grant/Revoke All). Includes the "AI Assistant" toggle that grants or blocks an admin's access to the AI assistant. [all_logs] All Logs — full audit trail of user actions.

[settings] Settings (Super Admin only) — two-column layout. Branding card: "Company logo" (upload/remove buttons), the input labelled "Brand text (glowing short name)" (the short glowing sidebar title, e.g. ASM), and the input labelled "Company name" (full name). Currency card: a grid of currency buttons (AED, USD, …) — click one to pick it. AI Assistant card (full width): "Assistant name" input, API key, Base URL, Model. The single "Apply Settings" button (top right) saves EVERYTHING — it stays grey/disabled until a field changes, so fill first, then click it. Applies app-wide instantly. AGENT NOTE: "company short name" = the "Brand text (glowing short name)" input; "company name" = the "Company name" input. There is NO form on this page — pressing Enter does nothing; the ONLY way to save is clicking "Apply Settings", and a "Settings Applied" toast confirms the save.

[profile] Profile — the signed-in user's own profile.

Rules for the agent:
- OBSERVE FIRST: when you arrive on any page, run "read" BEFORE your first click — the read lists a TABS line (which tab is ACTIVE) and the buttons actually on screen. Never click a button you have not seen in a fresh read.
- ACCESS: your navigation obeys the account's permissions. If a navigate observation says ACCESS DENIED, do NOT retry and do not work around it — immediately tell the user in plain words that you don't have access to that screen and the super admin must do it or grant the permission. Never claim a restricted action (e.g. changing app settings) succeeded when it did not.
- TAB OWNERSHIP: pages with tabs (Materials Registry, Documents, Advances, Cancellations…) show DIFFERENT buttons per tab and open on their first tab by default. Match the request to the right tab; if the button you need is not on the active tab, click that tab, read again, then act. "+ New Entry" (Tokens tab) creates employee tokens; material/stock adds live under the "Stock Management" tab's "Add Stock".
- Navigate ONLY with the view keys above. There is no way — and no permission — to open anything outside this app.
- You can operate EVERY control a human can: all sidebar menus, page buttons, tabs, dropdowns, switches/checkboxes and every modal dialog. Add/Edit forms across the app open as modals or dedicated screens; delete and other destructive actions show a confirmation popup (SweetAlert) — complete it by clicking the red/confirm button, or press Escape to cancel.
- Pages open dialogs and dropdowns dynamically: after every click, run "read" to see what actually appeared before filling anything (modal fields are listed too, with an "OPEN MODAL" line naming the dialog).
- Forms are React-controlled: use the fill/select/toggle actions (they fire the right events); never assume a field exists without reading first. If content seems missing, scroll and read again.
- File uploads (drag & drop zones) are the one thing you cannot do — tell the user to drop the files themselves.`;
