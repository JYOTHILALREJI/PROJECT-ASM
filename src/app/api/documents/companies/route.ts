import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { ensureStorageDir, sanitizeFileName, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/companies — the issuing companies (multiple company names)
//   GET   — active companies
//   POST  — create a company (JSON or multipart with letterhead image)
// ---------------------------------------------------------------------------

const LETTERHEAD_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — letterheads are page-wide images

export async function GET() {
  try {
    const companies = await db.nocCompany.findMany({
      where: { deletedAt: null, active: true },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true, name: true, letterheadPath: true, contactPerson: true,
        contactPhone: true, contactEmail: true, createdAt: true,
      },
    });
    return NextResponse.json({ success: true, data: { companies } });
  } catch (error) {
    console.error('GET /api/documents/companies error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load companies' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let name = '';
    let contactPerson = 'Ms. Mafeeda Kader';
    let contactPhone = '050 797 4153';
    let contactEmail = 'mafeedaarabianshieldmanpower@gmail.com';
    let actorDisplayName = 'Admin';
    let actorUserId = '';
    let letterheadRelative: string | null = null;

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      name = (form.get('name') || '').toString().trim();
      contactPerson = (form.get('contactPerson') || contactPerson).toString().trim();
      contactPhone = (form.get('contactPhone') || contactPhone).toString().trim();
      contactEmail = (form.get('contactEmail') || contactEmail).toString().trim();
      actorDisplayName = (form.get('actorDisplayName') || actorDisplayName).toString().trim();
      actorUserId = (form.get('actorUserId') || '').toString().trim();
      const file = form.get('file');
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_FILE_BYTES) {
          return NextResponse.json({ success: false, error: 'Letterhead image exceeds the 10 MB limit.' }, { status: 400 });
        }
        const ext = path.extname(file.name).toLowerCase();
        if (!LETTERHEAD_EXTENSIONS.includes(ext)) {
          return NextResponse.json({ success: false, error: `Unsupported image type "${ext || 'unknown'}". Allowed: PNG, JPG, WEBP.` }, { status: 400 });
        }
        const dir = ensureStorageDir('letterheads');
        const absPath = uniqueFilePath(dir, sanitizeFileName(`${name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toUpperCase()}-LETTERHEAD${ext}`));
        fs.writeFileSync(absPath, Buffer.from(await file.arrayBuffer()));
        letterheadRelative = path.relative(process.cwd(), absPath).replace(/\\/g, '/');
      }
    } else {
      const body = (await request.json()) as {
        name?: string; contactPerson?: string; contactPhone?: string;
        contactEmail?: string; actorDisplayName?: string; actorUserId?: string;
      };
      name = (body.name || '').toString().trim();
      contactPerson = (body.contactPerson || contactPerson).toString().trim();
      contactPhone = (body.contactPhone || contactPhone).toString().trim();
      contactEmail = (body.contactEmail || contactEmail).toString().trim();
      actorDisplayName = (body.actorDisplayName || actorDisplayName).toString().trim();
      actorUserId = (body.actorUserId || '').toString().trim();
    }

    if (name.length < 3) {
      return NextResponse.json({ success: false, error: 'Company name is required (min 3 characters).' }, { status: 400 });
    }

    const existing = await db.nocCompany.findFirst({ where: { name, deletedAt: null } });
    if (existing) {
      return NextResponse.json({ success: false, error: `Company "${name}" already exists.` }, { status: 409 });
    }

    // A soft-deleted company still occupies the unique name — revive it.
    const softDeleted = await db.nocCompany.findFirst({ where: { name, deletedAt: { not: null } } });
    if (softDeleted) {
      const company = await db.nocCompany.update({
        where: { id: softDeleted.id },
        data: { letterheadPath: letterheadRelative, contactPerson, contactPhone, contactEmail, active: true, deletedAt: null },
      });

      await logActivity({
        userId: actorUserId || undefined,
        displayName: actorDisplayName,
        action: 'company_create',
        entityType: 'noc_company',
        entityId: company.id,
        entityName: company.name,
        description: `Re-added company "${company.name}" to the NOC company list`,
      }).catch(() => undefined);

      return NextResponse.json({ success: true, data: { company } }, { status: 201 });
    }

    const company = await db.nocCompany.create({
      data: { name, letterheadPath: letterheadRelative, contactPerson, contactPhone, contactEmail, active: true },
    });

    await logActivity({
      userId: actorUserId || undefined,
      displayName: actorDisplayName,
      action: 'company_create',
      entityType: 'noc_company',
      entityId: company.id,
      entityName: company.name,
      description: `Added company "${company.name}" to the NOC company list`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { company } }, { status: 201 });
  } catch (error) {
    console.error('POST /api/documents/companies error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create company' }, { status: 500 });
  }
}
