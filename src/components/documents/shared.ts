/**
 * shared.ts — helpers and types shared by the Documents module components.
 */
export interface NocLightRow {
  id: string;
  nocNumber: string;
  status: 'draft' | 'final';
  version: number;
  clientName: string;
  projectName: string;
  nocDate: string;
  monthKey: string;
  employeeCount: number;
  fileName: string;
  createdBy: string | null;
  stampEnabled: boolean;
  stampId: string | null;
  stampName?: string | null;
  companyId: string | null;
  companyName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NocEmployeeRow {
  uid: string;
  employeeId?: string; // DB employee id when picked from the database
  source: 'database' | 'manual';
  name: string;
  trade: string;
  company: string;
  nationality: string;
  passport: string;
}

export interface NocTemplateData {
  bodyText: string;
  companyName: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
}

export interface CompanyOption {
  id: string;
  name: string;
  letterheadPath?: string | null;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
}

export interface StampOption {
  id: string;
  name: string;
  imagePath: string;
  companyId?: string | null;
  companyName?: string | null;
  isDefault: boolean;
}

let uidCounter = 0;
export const nextUid = () => `row-${Date.now()}-${uidCounter++}`;

export function todayDMY(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Print a PDF URL directly: load it into a hidden iframe and print. */
export function printPdf(url: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = url;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      window.open(url, '_blank');
    }
    setTimeout(() => iframe.remove(), 60_000);
  };
  document.body.appendChild(iframe);
}

/** Trigger a browser download for a NOC PDF. */
export function downloadNocPdf(noc: { id: string; fileName?: string | null }): void {
  const a = document.createElement('a');
  a.href = `/api/documents/noc/${noc.id}/pdf?mode=download&_=${Date.now()}`;
  a.download = noc.fileName || 'NOC.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const inputCls = 'bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-500 focus-visible:ring-blue-500/40';
