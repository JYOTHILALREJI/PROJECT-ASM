// Runtime SQLite schema introspection for the AI Assistant.
//
// The assistant answers questions by generating read-only SQL over the live
// database. To do that reliably it needs the EXACT table + column names that
// exist in SQLite right now (Prisma model names map 1:1 — there are no @@map
// renames in this project). We read them from sqlite_master + PRAGMA
// table_info and enrich them with a short hand-written data dictionary so the
// model understands the semantics (soft deletes, status enums, etc.).
//
// The result is cached in-memory for 5 minutes — the schema only changes when
// a migration runs, so per-request introspection would be wasted work.

import { db } from '@/lib/db';

interface TableInfo {
  name: string;
  columns: Array<{ name: string; type: string; notNull: boolean }>;
}

/** Semantic hints for the tables the assistant is most likely to be asked about. */
const TABLE_HINTS: Record<string, string> = {
  User: 'Admin/system login accounts (role: super_admin|admin). Not workers.',
  Employee: 'Workers/staff. employeeId is the human-facing code. deletedAt IS NOT NULL or status=deleted → soft-deleted (excluded from reports). currentSiteId → Site the worker is currently at. currentTotalWorkingHours is the manual lifetime-hours override. bedSpaceNumber = bed slot in the camp.',
  Site: 'Work sites/projects (name, location, status active|inactive). deletedAt IS NOT NULL → deleted.',
  Camp: 'Worker accommodation camps. Related bed/occupancy lives on Employee.campId + Employee.bedSpaceNumber.',
  Attendance: 'Daily attendance rows: employeeId, date (YYYY-MM-DD), status (P=present 10h, A=absent, camp_sitting=8h), hours, overtimeHours.',
  SalaryRecord: 'Salary ledger rows per employee/site/month: rateTier (standard ≤1000h, premium >1000h, camp_sitting, other), rate, hours, amount, month 1-12, year. deletedAt IS NOT NULL → voided.',
  Warning: 'Disciplinary warnings issued to employees (description, date, createdBy user).',
  Fine: 'Monetary fines issued to employees (amount, reason, date, createdBy user).',
  Advance: 'Salary advances given to employees (amount, remainingBalance, month/year deducted).',
  AdvanceRepayment: 'Installment repayments for advances (amount, month, year).',
  LeaveRequest: 'Leave requests (type, fromDate, toDate, status pending|approved|rejected, daysPaid).',
  CancellationRequest: 'Employee cancellation/termination requests; approving one soft-deletes the employee.',
  UniformRegistry: 'Uniform/materials issued to employees (item, size, quantity, documentNumber, issueDate).',
  StockItem: 'Warehouse stock items (name, category, quantity, unit).',
  EmployeeDocument: 'Employee passport/visa/labour-card documents with expiryDate + status.',
  NocDocument: 'NOC letters issued (nocNumber, employeeId, type, status).',
  TotalEmployeeWorkingHours: 'Aggregated lifetime working hours per employee.',
  EmpCountSitePerMonth: 'Head-count per site per month snapshot.',
  WorkLog: 'Task work-log entries.',
  TradeRate: 'Hourly rates per trade (trade, rate).',
  EmployeeTrade: 'Trade assignments per employee (junction Employee↔TradeRate).',
  BaseRate: 'Base standard/premium hourly rates used by the allocation engine.',
  AppSetting: 'App-wide settings key/value store: currency, companyName, brandName, brandLogo, aiName (the AI assistant name).',
  Notification: 'In-app notifications for admins (type: request|warning|fine, read flag).',
  ActivityLog: 'Audit trail of user actions (action, entity, userId, timestamp).',
  AttendanceShare: 'Share links for attendance sheets (token, expiry).',
  AttendanceVersion: 'Historical snapshots/versions of attendance data.',
  SiteMonthActivation: 'Which site/month combinations are open for editing.',
  Permission: 'Sidebar menu permission catalog (slug per menu).',
  AdminPermission: 'Granted menu permissions per admin user (junction).',
  AdminMenuPermission: 'Legacy per-user menu visibility flags.',
  EmployeeRateChangelog: 'History of hourly-rate changes per employee.',
  NocCompany: 'Companies referenced by NOC letters.',
  Stamp: 'Official stamp/seal definitions for NOC PDFs.',
  NocDocumentPackage: 'Bundled NOC document packages.',
  NocTemplate: 'Singleton NOC letter template configuration.',
};

let cache: { doc: string; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function introspect(): Promise<string> {
  const tables = (await db.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_migrations' ORDER BY name`
  )) as Array<{ name: string }>;

  const lines: string[] = [];
  for (const { name } of tables) {
    const cols = (await db.$queryRawUnsafe<Array<{ name: string; type: string; notnull: number; pk: number }>>(
      `PRAGMA table_info("${name.replace(/"/g, '""')}")`
    )) as Array<{ name: string; type: string; notnull: number; pk: number }>;
    const colText = cols
      .map((c) => `${c.name} ${c.type}${c.pk ? ' PK' : ''}${c.notnull ? ' NOT NULL' : ''}`)
      .join(', ');
    const hint = TABLE_HINTS[name];
    lines.push(hint ? `- ${name} (${colText}) — ${hint}` : `- ${name} (${colText})`);
  }
  return lines.join('\n');
}

/** Compact CREATE-TABLE style summary of the whole DB for LLM prompting. */
export async function getDbSchemaDoc(): Promise<string> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.doc;
  const doc = await introspect();
  cache = { doc, at: Date.now() };
  return doc;
}

/** Drop the cached schema doc (used after db push in dev if needed). */
export function invalidateSchemaDocCache(): void {
  cache = null;
}
