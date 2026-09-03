/**
 * noc-template.ts — access to the admin-controlled NOC letter configuration.
 * Falls back to the reference defaults when the singleton row does not exist.
 */
import { db } from '@/lib/db';

export interface NocTemplateData {
  bodyText: string;
  companyName: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  updatedAt?: Date;
}

const DEFAULTS: NocTemplateData = {
  bodyText:
    'We would like the following workers of our organization to work with your company. Our company takes full responsibility for our workers as regards to their salary, welfare and any other requirements. In case of any injury or untoward incident at site we M/s {{company}}., take all Liabilities & Claims and take full responsibility for our workers.',
  companyName: 'ARABIAN SHIELD A/C. UNITS FIX. CONT',
  contactPerson: 'Ms. Mafeeda Kader',
  contactPhone: '050 797 4153',
  contactEmail: 'mafeedaarabianshieldmanpower@gmail.com',
};

export async function getNocTemplate(): Promise<NocTemplateData> {
  try {
    const row = await db.nocTemplate.findUnique({ where: { id: 'singleton' } });
    if (!row) return { ...DEFAULTS };
    return {
      bodyText: row.bodyText || DEFAULTS.bodyText,
      companyName: row.companyName || DEFAULTS.companyName,
      contactPerson: row.contactPerson || DEFAULTS.contactPerson,
      contactPhone: row.contactPhone || DEFAULTS.contactPhone,
      contactEmail: row.contactEmail || DEFAULTS.contactEmail,
      updatedAt: row.updatedAt,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function upsertNocTemplate(data: Partial<NocTemplateData>): Promise<NocTemplateData> {
  const existing = await db.nocTemplate.findUnique({ where: { id: 'singleton' } });
  const merged = {
    bodyText: (data.bodyText ?? existing?.bodyText ?? DEFAULTS.bodyText).trim(),
    companyName: (data.companyName ?? existing?.companyName ?? DEFAULTS.companyName).trim(),
    contactPerson: (data.contactPerson ?? existing?.contactPerson ?? DEFAULTS.contactPerson).trim(),
    contactPhone: (data.contactPhone ?? existing?.contactPhone ?? DEFAULTS.contactPhone).trim(),
    contactEmail: (data.contactEmail ?? existing?.contactEmail ?? DEFAULTS.contactEmail).trim(),
  };
  const row = await db.nocTemplate.upsert({
    where: { id: 'singleton' },
    update: merged,
    create: { id: 'singleton', ...merged },
  });
  return {
    bodyText: row.bodyText,
    companyName: row.companyName,
    contactPerson: row.contactPerson,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    updatedAt: row.updatedAt,
  };
}
