import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { resolveStoragePath, ensureStorageDir } from '@/lib/document-storage';
import type { NocEmployeeRow } from '@/lib/noc-pdf';

/**
 * NOC ZIP package builder (PRD §1-27, §45, §59).
 *
 * Outer ZIP  = NOC PDF (stamped rendition when the NOC is stamped, §45)
 *              + one nested ZIP per NOC employee.
 * Employee ZIP = latest VALID document per category, normalized names:
 *                Passport.pdf / Emirates ID.jpg / Visa.pdf / Medical.pdf.
 * Missing documents NEVER block or exclude an employee (§18) — an employee
 * with no documents at all gets an explanatory placeholder file.
 * Latest-valid rule (§10-12, §53): only ACTIVE records, file must exist on
 * disk and be readable, newest first (createdAt DESC, id DESC).
 */

export const DOC_CATEGORIES = [
  { type: 'passport', label: 'Passport', zipBase: 'Passport' },
  { type: 'id_card', label: 'Emirates ID', zipBase: 'Emirates ID' },
  { type: 'visa', label: 'Visa', zipBase: 'Visa' },
  { type: 'other', label: 'Medical / Other', zipBase: 'Medical' },
] as const;

export type DocCategoryType = (typeof DOC_CATEGORIES)[number]['type'];

export interface CategoryPick {
  docId: string;
  docType: string;
  zipName: string; // normalized, e.g. "Passport.pdf"
  sourceName: string; // original upload file name
  absPath: string;
  size: number;
  createdAt: Date;
}

export interface EmployeePackageSummary {
  snapshotName: string;
  passport: string;
  matched: boolean; // snapshot matched a database employee
  zipName: string;
  docs: Array<{ type: string; label: string; included: boolean; zipName?: string; sourceName?: string }>;
  error?: string; // per-employee failure — never aborts the package (§55)
}

export interface PackageSummary {
  fileName: string;
  employeeCount: number;
  employeeZipsCreated: number;
  employeesFailed: string[];
  documentsIncluded: number;
  documentsMissing: number;
  byCategory: Record<string, { included: number; missing: number }>;
  employees: EmployeePackageSummary[];
  nocPdfIncluded: boolean;
}

/** Extension for a stored document, from the original file name or MIME type. */
function docExtension(fileName: string, mime: string): string {
  const ext = path.extname(fileName || '').replace('.', '').toLowerCase();
  if (ext) return ext;
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'dat';
}

/** Sanitize a file name for the ZIP entries / outer file name (§20). */
export function sanitizeZipName(raw: string): string {
  return (raw || 'file')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Latest VALID document per category for one employee (§10-12, §53):
 * ACTIVE records only → file exists and is non-empty → newest first.
 */
export async function resolveLatestEmployeeDocs(employeeId: string): Promise<Map<string, CategoryPick>> {
  const picks = new Map<string, CategoryPick>();
  const docs = await db.employeeDocument.findMany({
    where: { employeeId, deletedAt: null, status: 'ACTIVE' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  for (const cat of DOC_CATEGORIES) {
    const found = docs.find((d) => d.docType === cat.type);
    if (!found) continue;
    const abs = resolveStoragePath(found.filePath);
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size === 0) continue; // missing/empty file → invalid (§12)
      picks.set(cat.type, {
        docId: found.id,
        docType: found.docType,
        zipName: `${cat.zipBase}.${docExtension(found.fileName, found.mimeType)}`,
        sourceName: found.fileName,
        absPath: abs,
        size: st.size,
        createdAt: found.createdAt,
      });
    } catch {
      // unreadable file → skip this record, older valid ones remain eligible
      continue;
    }
  }
  return picks;
}

/** Outer ZIP name: NOC_{CLIENT}_{PROJECT}_{DATE}.zip (§20). */
export function buildPackageZipName(noc: { clientName: string; projectName: string; nocDate: string }): string {
  const stripMs = (s: string) => s.replace(/^M\s*\/?\s*S\.?\s+/i, '').trim();
  const parts = [
    'NOC',
    sanitizeZipName(stripMs(noc.clientName)).replace(/\s+/g, '_'),
    noc.projectName ? sanitizeZipName(noc.projectName).replace(/\s+/g, '_') : '',
    noc.nocDate.replace(/\s+/g, '_'),
  ].filter(Boolean);
  return `${parts.join('_')}.zip`;
}

/**
 * Build the full NOC package ZIP. Returns the ZIP buffer plus the summary
 * shown in the UI before download (§19). Read-only — never mutates employee
 * records or NOC snapshots (§24).
 */
export async function buildNocPackage(noc: {
  id: string; nocNumber: string; clientName: string; projectName: string; nocDate: string;
  fileName: string; filePath: string | null; stampEnabled: boolean;
  employeesJson: string;
}): Promise<{ buffer: Buffer; summary: PackageSummary; zipName: string }> {
  const zipName = buildPackageZipName(noc);
  const snapshots = JSON.parse(noc.employeesJson || '[]') as NocEmployeeRow[];

  // ── 0. resolve snapshot → database employees (passport first, then name) ──
  // Name comparison happens in JS (case-insensitive) because SQLite '=' via
  // Prisma is case-sensitive. The employee table is small; one lightweight
  // query (id/name/passport only) is cheaper than N per-snapshot queries.
  const matched = new Map<number, { id: string; fullName: string; passportNumber: string | null } | null>();
  const allEmployees = await db.employee.findMany({
    where: { deletedAt: null },
    select: { id: true, fullName: true, passportNumber: true },
  });
  const byName = new Map(allEmployees.map((e) => [e.fullName.trim().toUpperCase(), e]));
  const byPassport = new Map(allEmployees.filter((e) => e.passportNumber).map((e) => [e.passportNumber!.trim().toUpperCase(), e]));
  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const name = (snap.name || '').trim().toUpperCase();
    const pass = (snap.passport || '').trim().toUpperCase();
    const emp = (pass && byPassport.get(pass)) || (name && byName.get(name)) || null;
    matched.set(i, emp);
  }

  const summary: PackageSummary = {
    fileName: zipName,
    employeeCount: snapshots.length,
    employeeZipsCreated: 0,
    employeesFailed: [],
    documentsIncluded: 0,
    documentsMissing: 0,
    byCategory: Object.fromEntries(DOC_CATEGORIES.map((c) => [c.type, { included: 0, missing: 0 }])),
    employees: [],
    nocPdfIncluded: false,
  };

  // ── 1. NOC PDF — mandatory (§55) ──
  let nocPdfBytes: Buffer | null = null;
  if (noc.filePath) {
    try {
      nocPdfBytes = fs.readFileSync(resolveStoragePath(noc.filePath));
    } catch {
      nocPdfBytes = null;
    }
  }
  if (!nocPdfBytes) {
    throw new Error('The NOC PDF file could not be read — the package cannot be built without the NOC itself.');
  }
  summary.nocPdfIncluded = true;

  // ── 2. employee ZIPs (nested buffers) ──
  const employeeZipEntries: Array<{ name: string; buffer: Buffer }> = [];
  const usedZipNames = new Set<string>();

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const emp = matched.get(i) ?? null;
    const empSummary: EmployeePackageSummary = {
      snapshotName: snap.name || `Employee ${i + 1}`,
      passport: snap.passport || '',
      matched: !!emp,
      zipName: '',
      docs: DOC_CATEGORIES.map((c) => ({ type: c.type, label: c.label, included: false })),
    };
    try {
      const picks = emp ? await resolveLatestEmployeeDocs(emp.id) : new Map<string, CategoryPick>();

      // deterministic ZIP name: "{NAME}.zip", duplicates get " - {PASSPORT}.zip" (§21)
      const baseName = sanitizeZipName((snap.name || `Employee ${i + 1}`).toUpperCase());
      let entryName = `${baseName}.zip`;
      if (usedZipNames.has(entryName.toLowerCase())) {
        const suffix = (snap.passport || emp?.passportNumber || `EMP${i + 1}`).toUpperCase();
        entryName = sanitizeZipName(`${baseName} - ${suffix}`) + '.zip';
      }
      let dupGuard = 2;
      while (usedZipNames.has(entryName.toLowerCase())) {
        entryName = sanitizeZipName(`${baseName} (${dupGuard++})`) + '.zip';
      }
      usedZipNames.add(entryName.toLowerCase());
      empSummary.zipName = entryName;

      const inner = archiver('zip', { zlib: { level: 6 } });
      const chunks: Buffer[] = [];
      inner.on('data', (c: Buffer) => chunks.push(c));
      const done = new Promise<void>((resolve, reject) => {
        inner.on('end', resolve);
        inner.on('error', reject);
      });

      let includedAny = false;
      for (const cat of DOC_CATEGORIES) {
        const pick = picks.get(cat.type);
        if (pick) {
          inner.file(pick.absPath, { name: pick.zipName });
          includedAny = true;
          summary.documentsIncluded += 1;
          summary.byCategory[cat.type].included += 1;
          const slot = empSummary.docs.find((d) => d.type === cat.type)!;
          slot.included = true;
          slot.zipName = pick.zipName;
          slot.sourceName = pick.sourceName;
        } else {
          summary.documentsMissing += 1;
          summary.byCategory[cat.type].missing += 1;
        }
      }
      if (!includedAny) {
        // employee with no valid documents still gets a ZIP (§18)
        inner.append(
          `No documents are currently on file for ${snap.name || 'this employee'}.\n` +
          `Generated as part of ${noc.nocNumber} (${noc.clientName} — ${noc.projectName}) on ${new Date().toISOString().slice(0, 10)}.\n`,
          { name: 'NO DOCUMENTS ON FILE.txt' },
        );
      }
      await inner.finalize();
      await done;
      employeeZipEntries.push({ name: entryName, buffer: Buffer.concat(chunks) });
      summary.employeeZipsCreated += 1;
    } catch (e) {
      // per-employee failure never destroys the package (§55)
      empSummary.error = e instanceof Error ? e.message : 'Employee ZIP creation failed';
      summary.employeesFailed.push(empSummary.snapshotName);
    }
    summary.employees.push(empSummary);
  }

  // ── 3. outer ZIP ──
  const outer = archiver('zip', { zlib: { level: 6 } });
  const outChunks: Buffer[] = [];
  outer.on('data', (c: Buffer) => outChunks.push(c));
  const outDone = new Promise<void>((resolve, reject) => {
    outer.on('end', resolve);
    outer.on('error', reject);
  });
  outer.append(nocPdfBytes, { name: zipName.replace(/\.zip$/i, '.pdf') });
  for (const entry of employeeZipEntries) {
    outer.append(entry.buffer, { name: entry.name });
  }
  await outer.finalize();
  await outDone;

  return { buffer: Buffer.concat(outChunks), summary, zipName };
}

/** Persist a generated package under storage/noc-packages/{nocNumber}/. */
export function storePackage(nocNumber: string, zipName: string, buffer: Buffer): { absPath: string; relPath: string } {
  const dir = ensureStorageDir('noc-packages', nocNumber);
  const absPath = path.join(dir, zipName);
  fs.writeFileSync(absPath, buffer);
  return { absPath, relPath: path.relative(process.cwd(), absPath).replace(/\\/g, '/') };
}
