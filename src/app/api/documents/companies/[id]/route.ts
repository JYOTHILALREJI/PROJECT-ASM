import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activity-logger';
import { ensureStorageDir, resolveStoragePath, sanitizeFileName, uniqueFilePath } from '@/lib/document-storage';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// /api/documents/companies/[id]
//   PATCH  — update fields and/or upload a new letterhead (multipart or JSON)
//   DELETE — remove the company (soft; NOCs keep working with SetNull)
// ---------------------------------------------------------------------------

const LETTERHEAD_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const company = await db.nocCompany.findFirst({ where: { id, deletedAt: null } });
    if (!company) {
      return NextResponse.json({ success: false, error: 'Company not found' }, { status: 404 });
    }

    let name = company.name;
    let contactPerson = company.contactPerson;
    let contactPhone = company.contactPhone;
    let contactEmail = company.contactEmail;
    let actorDisplayName = 'Admin';
    let actorUserId = '';
    let letterheadRelative: string | null = company.letterheadPath;

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      name = (form.get('name') || name).toString().trim();
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
      if ((form.get('removeLetterhead') || '').toString() === '1') {
        letterheadRelative = null;
      }
    } else {
      const body = (await request.json()) as {
        name?: string; contactPerson?: string; contactPhone?: string;
        contactEmail?: string; letterheadPath?: string | null;
        actorDisplayName?: string; actorUserId?: string;
      };
      name = (body.name || name).toString().trim();
      contactPerson = (body.contactPerson || contactPerson).toString().trim();
      contactPhone = (body.contactPhone || contactPhone).toString().trim();
      contactEmail = (body.contactEmail || contactEmail).toString().trim();
      if (body.letterheadPath !== undefined) letterheadRelative = body.letterheadPath;
      actorDisplayName = (body.actorDisplayName || actorDisplayName).toString().trim();
      actorUserId = (body.actorUserId || '').toString().trim();
    }

    if (name.length < 3) {
      return NextResponse.json({ success: false, error: 'Company name is required (min 3 characters).' }, { status: 400 });
    }
    if (name.toUpperCase() !== company.name.toUpperCase()) {
      const dupe = await db.nocCompany.findFirst({ where: { name, deletedAt: null, id: { not: id } } });
      if (dupe) {
        return NextResponse.json({ success: false, error: `Company "${name}" already exists.` }, { status: 409 });
      }
    }

    const updated = await db.nocCompany.update({
      where: { id },
      data: { name, contactPerson, contactPhone, contactEmail, letterheadPath: letterheadRelative },
    });

    await logActivity({
      userId: actorUserId || undefined,
      displayName: actorDisplayName,
      action: 'company_update',
      entityType: 'noc_company',
      entityId: company.id,
      entityName: updated.name,
      description: `Updated NOC company "${updated.name}"`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: { company: updated } });
  } catch (error) {
    console.error('PATCH /api/documents/companies/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update company' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const company = await db.nocCompany.findFirst({ where: { id, deletedAt: null } });
    if (!company) {
      return NextResponse.json({ success: false, error: 'Company not found' }, { status: 404 });
    }
    const nocsUsing = await db.nocDocument.count({ where: { companyId: id, deletedAt: null } });

    await db.nocCompany.update({ where: { id }, data: { deletedAt: new Date(), active: false } });

    if (company.letterheadPath) {
      try {
        const abs = resolveStoragePath(company.letterheadPath);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch {
        // best effort
      }
    }

    const actorDisplayName = request.nextUrl.searchParams.get('actorDisplayName') || 'Admin';
    const actorUserId = request.nextUrl.searchParams.get('actorUserId') || undefined;
    await logActivity({
      userId: actorUserId,
      displayName: actorDisplayName,
      action: 'company_delete',
      entityType: 'noc_company',
      entityId: company.id,
      entityName: company.name,
      description: `Removed NOC company "${company.name}"${nocsUsing > 0 ? ` (${nocsUsing} NOC(s) keep their issued copy)` : ''}`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/documents/companies/[id] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete company' }, { status: 500 });
  }
}
