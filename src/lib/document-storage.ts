/**
 * document-storage.ts — filesystem storage for the Documents module.
 *
 * Binary files live under <project>/storage/ (git-ignored):
 *   storage/noc/<client-slug>/<YYYY-MM>/<file>.pdf   — generated NOC letters
 *   storage/employee-documents/<employeeId>/<file>   — passport/ID/visa scans
 *
 * The database keeps only relative paths (POSIX separators), so the storage
 * root can be relocated by changing STORAGE_ROOT here.
 */
import fs from 'fs';
import path from 'path';

export const STORAGE_ROOT = path.join(process.cwd(), 'storage');

/** Ensure a storage subdirectory exists and return its absolute path. */
export function ensureStorageDir(...segments: string[]): string {
  const dir = path.join(STORAGE_ROOT, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolve a stored relative path to an absolute filesystem path.
 * Accepts both forms found in the DB:
 *   "storage/noc/…" (project-relative, as written by the upload routes)
 *   "noc/…"         (storage-relative)
 */
export function resolveStoragePath(relativePath: string): string {
  let clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean === 'storage' || clean.startsWith('storage/')) {
    clean = clean.slice('storage/'.length);
  }
  return path.join(STORAGE_ROOT, clean);
}

/** Slugify a client name for use as a folder name. */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toUpperCase()
      .slice(0, 80) || 'UNSPECIFIED'
  );
}

/** Sanitize an uploaded file name — keeps the base name, drops path tricks. */
export function sanitizeFileName(name: string): string {
  const base = path.basename(name || 'document');
  return base.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document';
}

/**
 * Pick a non-colliding file name inside dir: appends " 2", " 3", … before the
 * extension when the file already exists.
 */
export function uniqueFilePath(dir: string, fileName: string): string {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} ${n}${ext}`);
    n += 1;
  }
  return candidate;
}
