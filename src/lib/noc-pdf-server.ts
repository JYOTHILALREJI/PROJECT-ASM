/**
 * noc-pdf-server.ts — server-side resolution of the assets and wording used
 * when generating a NOC PDF:
 *   company (NocCompany row)  → letterhead image + {{company}} + signature
 *                               block defaults (manager name/phone/email)
 *   stamp   (Stamp row)       → the stamp image actually drawn
 *   template (NocTemplate)    → legal body wording fallback
 *
 * Precedence per field:
 *   company name     : company.name > template.companyName > default
 *   manager block    : noc.contact* > company.contact* > template.contact*
 *   letterhead       : company.letterheadPath (absolute) > default ASM asset
 *   stamp image      : stamp.imagePath ("builtin:" or storage-relative)
 */
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { getNocTemplate } from '@/lib/noc-template';
import { resolveStoragePath } from '@/lib/document-storage';
import type { NocEmployeeRow } from '@/lib/noc-pdf';

export interface ResolvedNocAssets {
  bodyText: string;
  companyName: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  stampEnabled: boolean;
  stampImagePath?: string;
  letterheadPath?: string;
}

/** Absolute path of a stamp image reference ("builtin:x.png" | storage-relative). */
export function stampImageAbsolutePath(imagePath: string): string | undefined {
  if (!imagePath) return undefined;
  if (imagePath.startsWith('builtin:')) {
    const p = path.join(process.cwd(), 'src', 'assets', 'noc', imagePath.slice('builtin:'.length));
    return fs.existsSync(p) ? p : undefined;
  }
  const abs = resolveStoragePath(imagePath);
  return fs.existsSync(abs) ? abs : undefined;
}

/** Absolute path of a company letterhead reference (storage-relative). */
function letterheadAbsolutePath(letterheadPath?: string | null): string | undefined {
  if (!letterheadPath) return undefined;
  const abs = resolveStoragePath(letterheadPath);
  return fs.existsSync(abs) ? abs : undefined;
}

export interface NocResolutionInput {
  companyId?: string | null;
  stampId?: string | null;
  stampEnabled?: boolean | null;
  stampType?: string | null; // legacy
  contactPerson?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

/**
 * Resolve everything needed to render a NOC PDF. Never throws — any DB/
 * lookup failure falls back to the reference defaults so PDF generation is
 * always possible.
 */
export async function resolveNocAssets(input: NocResolutionInput): Promise<ResolvedNocAssets> {
  const [template, company, stamp] = await Promise.all([
    getNocTemplate().catch(() => null),
    input.companyId
      ? db.nocCompany.findFirst({ where: { id: input.companyId, deletedAt: null } }).catch(() => null)
      : Promise.resolve(null),
    input.stampId
      ? db.stamp.findFirst({ where: { id: input.stampId, deletedAt: null } }).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Legacy rows (no stampEnabled flag): interpret the old stampType so the
  // historical letters keep their stamp.
  const stampEnabled =
    input.stampEnabled === true ||
    (input.stampEnabled === undefined && (input.stampType ?? 'procurement') !== 'none');

  return {
    bodyText: template?.bodyText || '',
    companyName: company?.name || template?.companyName || 'ARABIAN SHIELD A/C. UNITS FIX. CONT',
    contactPerson: input.contactPerson || company?.contactPerson || template?.contactPerson || 'Ms. Mafeeda Kader',
    contactPhone: input.contactPhone || company?.contactPhone || template?.contactPhone || '050 797 4153',
    contactEmail: input.contactEmail || company?.contactEmail || template?.contactEmail || 'mafeedaarabianshieldmanpower@gmail.com',
    stampEnabled,
    stampImagePath: stampEnabled && stamp ? stampImageAbsolutePath(stamp.imagePath) : undefined,
    letterheadPath: letterheadAbsolutePath(company?.letterheadPath),
  };
}
